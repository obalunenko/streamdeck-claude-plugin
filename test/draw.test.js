const test = require('node:test');
const assert = require('node:assert/strict');

const { tuneStrip, usageKey, usageStrip } = require('../src/draw');

// The SVG inside a data URI.
const svg = (uri) => Buffer.from(uri.replace(/^data:image\/svg\+xml;base64,/, ''), 'base64').toString('utf8');

const LEVEL = { green: '#2e7d32', yellow: '#b28704', red: '#c62828' };

test('a Usage key fills from the bottom up to the percentage in the level colour', () => {
  const image = svg(usageKey({ label: '5h', pct: 50, level: 'green', sub: '↻ 1h12m' }));
  assert.match(image, new RegExp(`<rect x="0" y="72" width="144" height="72" fill="${LEVEL.green}"/>`));
  assert.match(image, />50%</);
  assert.match(image, />↻ 1h12m</);
  assert.match(svg(usageKey({ label: '5h', pct: 90, level: 'red', sub: '' })), new RegExp(`fill="${LEVEL.red}"`));
  assert.match(svg(usageKey({ label: '5h', pct: 80, level: 'yellow', sub: '' })), new RegExp(`fill="${LEVEL.yellow}"`));
});

test('a Usage key without data shows a dash and no fill', () => {
  const image = svg(usageKey({ label: 'Context', pct: null, level: null, sub: 'no session' }));
  assert.match(image, />—</);
  assert.match(image, />no session</);
  assert.doesNotMatch(image, /<rect x="0" y="/);
});

test('a Usage strip shows the bar and dots only for several picked metrics', () => {
  const view = { label: '7d', pct: 25, level: 'green', sub: '↻ 2d 3h' };
  const one = svg(usageStrip(view, ['seven_day'], 'seven_day'));
  assert.match(one, new RegExp(`<rect x="12" y="74" width="44" height="14" rx="7" fill="${LEVEL.green}"/>`));
  assert.doesNotMatch(one, /[●○]/);
  const three = svg(usageStrip(view, ['context', 'seven_day', 'scoped'], 'seven_day'));
  assert.match(three, />○ ● ○</);
});

test('drawn text is escaped', () => {
  const image = svg(usageKey({ label: '<b>&', pct: null, level: null, sub: '"x"' }));
  assert.match(image, />&#60;b&#62;&#38;</);
  assert.doesNotMatch(image, /<b>/);
});

test('a tune strip shows what it changes, the value and the project', () => {
  const image = svg(tuneStrip({ kind: 'effort', value: 'high', project: 'streamdeck', chosen: false, pending: false }));
  assert.match(image, />Effort</);
  assert.match(image, />high</);
  assert.match(image, />streamdeck</);
  assert.match(image, /fill="#2b2b2b"/);
});

test('a pending value is drawn blue, a deck-chosen session is marked', () => {
  const image = svg(tuneStrip({ kind: 'model', value: 'opus', project: 'streamdeck', chosen: true, pending: true }));
  assert.match(image, />Model</);
  assert.match(image, /fill="#1565c0"/);
  assert.match(image, />streamdeck · chosen</);
});

test('a notice replaces the value, and no value shows a dash', () => {
  for (const notice of ['no session', 'busy', 'no claude', 'no access']) {
    assert.match(svg(tuneStrip({ kind: 'model', value: 'opus', notice })), new RegExp(`>${notice}<`));
  }
  assert.match(svg(tuneStrip({ kind: 'effort', value: null })), />—</);
});
