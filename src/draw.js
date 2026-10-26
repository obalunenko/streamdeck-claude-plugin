// Drawing for the deck: SVG keys and touch-strip segments as data URIs. Pure:
// every function takes what it shows and returns the image.

const COLORS = {
  idle: '#2b2b2b',
  picked: '#2e7d32',
  blank: '#000000',
  option: '#6a1b9a',
  status: '#d97757',
  allow: '#2e7d32',
  always: '#1565c0',
  deny: '#c62828',
  disabled: '#3a3a3a',
  muted: '#e0d4ec',
  // an open answer on the review strip
  open: '#b9a3cf',
};

const FONT = '-apple-system, Helvetica, Arial';
// Average glyph width relative to the font size, close enough for Cyrillic.
const GLYPH = 0.6;
// Line breaks go at ordinary whitespace only, so a no-break space keeps the
// picked mark on the label's line.
const BREAK = /[ \t\n]+/;

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function clip(s, n) {
  s = String(s);
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

// Greedy word wrap into at most `max` lines of `width` characters.
function wrap(text, width, max) {
  const lines = [];
  let line = '';
  for (const word of String(text).split(BREAK)) {
    const next = line ? `${line} ${word}` : word;
    if (next.length <= width || !line) {
      line = next;
      continue;
    }
    lines.push(line);
    line = word;
  }
  if (line) lines.push(line);
  if (lines.length > max) {
    lines.length = max;
    lines[max - 1] = clip(`${lines[max - 1]}…`, width);
  }
  return lines.map((l) => clip(l, width));
}

// Breaks words longer than `width` in two hyphenated halves; null when a
// word needs more than two lines.
function hyphenate(text, width) {
  const words = [];
  for (const w of String(text).split(BREAK)) {
    if (w.length <= width) {
      words.push(w);
      continue;
    }
    if (w.length > 2 * width - 1) return null;
    const half = Math.ceil(w.length / 2);
    words.push(`${w.slice(0, half)}-`, w.slice(half));
  }
  return words.join(' ');
}

// The largest size from `sizes` at which `text` fits `maxLines` lines of
// `boxWidth` pixels: whole words first, then hyphenated; the smallest size
// truncates.
function fit(text, boxWidth, maxLines, sizes) {
  const widthAt = (size) => Math.floor(boxWidth / (size * GLYPH));
  for (const size of sizes) {
    const width = widthAt(size);
    const lines = wrap(text, width, Infinity);
    if (lines.length <= maxLines && String(text).split(BREAK).every((w) => w.length <= width)) return { size, lines };
  }
  for (const size of sizes) {
    const split = hyphenate(text, widthAt(size));
    const lines = split && wrap(split, widthAt(size), Infinity);
    if (lines && lines.length <= maxLines) return { size, lines };
  }
  const size = sizes[sizes.length - 1];
  return { size, lines: wrap(text, widthAt(size), maxLines) };
}

function textEl(x, y, t, size, weight = 'normal', anchor = 'middle', fill = '#fff') {
  return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(t)}</text>`;
}

function svgURI(width, height, bg, body, viewBox = `0 0 ${width} ${height}`) {
  const image = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${viewBox}"><rect x="-1000" y="-1000" width="3000" height="3000" fill="${bg}"/>${body}</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(image).toString('base64')}`;
}

// A 144×144 key with centred lines of [text, size, weight].
function key(bg, lines) {
  const largest = Math.max(...lines.map(([, size]) => size));
  const step = lines.length === 1 ? 0 : Math.min(108 / lines.length, largest * 1.3);
  const top = 72 - (step * (lines.length - 1)) / 2;
  const body = lines.map(([t, size, weight], i) => textEl(72, top + i * step + size / 3, t, size, weight)).join('');
  return svgURI(144, 144, bg, body);
}

function fittedKey(bg, text) {
  const { size, lines } = fit(text, 130, 3, [30, 26, 22, 18, 15]);
  return key(bg, lines.map((l) => [l, size, 'bold']));
}

// The question view on the 800×100 strip, laid out like the request detail:
// the head line with a muted note on the right, then up to three lines of the
// question or the option's description, or a line per answer.
function questionStrip(view) {
  const headSize = view.kind === 'option' ? 20 : 17;
  const sideWidth = view.side ? view.side.length * 15 * GLYPH + 20 : 0;
  const head = fit(view.head, 780 - sideWidth, 1, [headSize, 15]);
  let body = textEl(10, 22, head.lines[0], head.size, 'bold', 'start') + textEl(790, 22, view.side, 15, 'normal', 'end', COLORS.muted);
  if (view.rows) {
    // Four answers (the most a question prompt has) end at 93.
    const [size, step] = view.rows.length > 3 ? [15, 17] : [17, 22];
    view.rows.forEach((r, i) => {
      body += textEl(10, 42 + i * step, fit(r.text, 780, 1, [size]).lines[0], size, 'normal', 'start', r.open ? COLORS.open : '#fff');
    });
    return body;
  }
  const { size, lines } = fit(view.text, 780, 3, [20, 17, 15, 13]);
  return body + lines.map((l, i) => textEl(10, 44 + i * (size + 4), l, size, 'normal', 'start')).join('');
}

// One 200×100 segment for a Model / Effort dial: what it changes, the value
// (blue while turning) or a notice, and the target project.
function tuneStrip(view) {
  const text = view.notice || view.value || '—';
  const one = fit(text, 184, 1, [30, 26, 22, 18]);
  const { size, lines } = one.lines.join(' ') === text ? one : fit(text, 184, 2, [22, 18]);
  const lineH = size * 1.1;
  const top = 56 - (lines.length * lineH) / 2 + size * 0.8;
  const project = view.project ? `${clip(view.project, view.chosen ? 11 : 20)}${view.chosen ? ' · chosen' : ''}` : '';
  const body =
    textEl(100, 22, view.kind === 'effort' ? 'Effort' : 'Model', 17, 'bold') +
    lines.map((l, i) => textEl(100, top + i * lineH, l, size, 'bold')).join('') +
    textEl(100, 92, project, 15, 'normal', 'middle', COLORS.muted);
  return svgURI(200, 100, view.pending ? COLORS.always : COLORS.idle, body);
}

// Threshold colours of the Usage scale; white text stays readable on each.
const LEVEL = { green: '#2e7d32', yellow: '#b28704', red: '#c62828' };
const TRACK = '#444444';
const DIM = '#888888';

// A Usage key: the whole key fills from the bottom up to the percentage.
function usageKey(view) {
  const fill = view.pct === null ? '' : `<rect x="0" y="${144 - (144 * view.pct) / 100}" width="144" height="${(144 * view.pct) / 100}" fill="${LEVEL[view.level]}"/>`;
  const muted = view.pct === null ? DIM : '#fff';
  const body =
    fill +
    textEl(72, 32, clip(view.label, 11), 20, 'bold') +
    textEl(72, 86, view.pct === null ? '—' : `${view.pct}%`, 40, 'bold', 'middle', muted) +
    textEl(72, 130, clip(view.sub, 15), 15, 'normal', 'middle', muted);
  return svgURI(144, 144, COLORS.idle, body);
}

// A Usage strip segment: label and position dots on top, the percentage and
// the bottom line on one row, a bar along the bottom.
function usageStrip(view, picked, shown) {
  const dots = picked.length > 1 ? picked.map((m) => (m === shown ? '●' : '○')).join(' ') : '';
  const bar = view.pct === null ? '' : `<rect x="12" y="74" width="${(176 * view.pct) / 100}" height="14" rx="7" fill="${LEVEL[view.level]}"/>`;
  const body =
    textEl(12, 24, clip(view.label, 12), 17, 'bold', 'start') +
    textEl(188, 24, dots, 12, 'normal', 'end', COLORS.muted) +
    textEl(12, 60, view.pct === null ? '—' : `${view.pct}%`, 30, 'bold', 'start', view.pct === null ? DIM : '#fff') +
    textEl(188, 60, clip(view.sub, 14), 14, 'normal', 'end', view.pct === null ? DIM : COLORS.muted) +
    `<rect x="12" y="74" width="176" height="14" rx="7" fill="${TRACK}"/>` +
    bar;
  return svgURI(200, 100, COLORS.idle, body);
}

module.exports = { COLORS, clip, wrap, fit, textEl, svgURI, key, fittedKey, questionStrip, tuneStrip, usageKey, usageStrip };
