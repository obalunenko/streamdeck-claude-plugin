// The Usage meter: the context fill of a session and the plan limits (5h, 7d,
// the model-scoped weekly limit), each drawn as a green / yellow / red scale.
//
// Readings come from two places: every statusline report (`rate_limits`) and
// ~/.claude/cache/oauth-usage.json, which the user's statusline script writes
// from the OAuth usage API. Each claude process reports its own copy of the
// limits, and an idle session's copy can be old, so `Limits` merges readings
// per limit instead of keeping the last one.

const METRICS = ['context', 'five_hour', 'seven_day', 'scoped'];

// Two resets this close are the same window: the API and the statusline
// report the same reset a fraction of a second apart.
const SAME_WINDOW = 10 * 60 * 1000;

const LABELS = { context: 'Context', five_hour: '5h', seven_day: '7d', scoped: 'Model 7d' };

const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);

// Thresholds apply to the whole number the key shows, so 85 % is never red.
function level(pct) {
  const p = Math.round(pct);
  if (p > 85) return 'red';
  if (p >= 75) return 'yellow';
  return 'green';
}

// Time left until a reset: `45m`, `1h12m`, `2d 3h`; empty when unknown or past.
function countdown(resetsAt, now) {
  if (!isNumber(resetsAt) || resetsAt <= now) return '';
  const minutes = Math.floor((resetsAt - now) / 60_000);
  const hours = Math.floor(minutes / 60);
  if (hours < 1) return `${minutes}m`;
  if (hours < 24) return `${hours}h${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function reading(pct, resetsAt) {
  if (!isNumber(pct)) return null;
  return { pct, resetsAt: isNumber(resetsAt) ? resetsAt : null };
}

function isoTime(s) {
  const t = typeof s === 'string' ? Date.parse(s) : NaN;
  return Number.isNaN(t) ? null : t;
}

// Collects the non-null readings into an object keyed by metric.
function collect(entries) {
  const out = {};
  for (const [key, r] of entries) if (r) out[key] = r;
  return out;
}

// The statusline JSON: `rate_limits.<limit>.used_percentage`, resets in Unix seconds.
function readingsFromStatus(status) {
  const rl = status && typeof status === 'object' ? status.rate_limits : null;
  if (!rl || typeof rl !== 'object') return {};
  const of = (k) => {
    const l = rl[k];
    if (!l || typeof l !== 'object') return null;
    return reading(l.used_percentage, isNumber(l.resets_at) ? l.resets_at * 1000 : null);
  };
  return collect([
    ['five_hour', of('five_hour')],
    ['seven_day', of('seven_day')],
  ]);
}

// The OAuth usage JSON: `five_hour` / `seven_day` utilization and the first
// `weekly_scoped` limit, resets as ISO strings.
function readingsFromCache(json) {
  if (!json || typeof json !== 'object') return {};
  const of = (l) => (l && typeof l === 'object' ? reading(l.utilization, isoTime(l.resets_at)) : null);
  let scoped = null;
  const entry = Array.isArray(json.limits) ? json.limits.find((l) => l && l.kind === 'weekly_scoped') : null;
  if (entry) {
    scoped = reading(entry.percent, isoTime(entry.resets_at));
    const name = entry.scope?.model?.display_name;
    if (scoped && typeof name === 'string') scoped.label = `${name} 7d`;
  }
  return collect([
    ['five_hour', of(json.five_hour)],
    ['seven_day', of(json.seven_day)],
    ['scoped', scoped],
  ]);
}

// One merged value per limit. A later window replaces the held one; within a
// window usage only grows, so the higher value wins; an earlier window is an
// idle session's old copy and is ignored. A scoped limit that names another
// model replaces the held one.
class Limits {
  constructor() {
    this.held = new Map();
  }

  fold(key, r) {
    if (!r || !isNumber(r.pct)) return;
    const held = this.held.get(key);
    // Another model's scoped limit is another limit, whatever its window.
    const otherModel = r.label !== undefined && held && held.label !== undefined && r.label !== held.label;
    if (!held || otherModel || (held.resetsAt === null && r.resetsAt !== null)) {
      this.held.set(key, { ...r });
      return;
    }
    if (r.resetsAt === null) return;
    const d = r.resetsAt - held.resetsAt;
    if (d >= SAME_WINDOW) {
      this.held.set(key, { ...r });
    } else if (d > -SAME_WINDOW) {
      const merged = { pct: Math.max(held.pct, r.pct), resetsAt: held.resetsAt };
      const label = r.label ?? held.label;
      if (label !== undefined) merged.label = label;
      this.held.set(key, merged);
    }
  }

  // A window whose reset has passed shows 0 until a reading of the next one.
  get(key, now) {
    const held = this.held.get(key);
    if (!held) return null;
    if (held.resetsAt !== null && held.resetsAt <= now) return { ...held, pct: 0, resetsAt: null };
    return { ...held };
  }
}

// The metrics an action shows, from its settings, in fixed order; all of them
// when none are picked.
function parseMetrics(settings) {
  const picked = Array.isArray(settings?.metrics) ? settings.metrics : [];
  const known = METRICS.filter((m) => picked.includes(m));
  return known.length ? known : [...METRICS];
}

function shownMetric(settings) {
  const picked = parseMetrics(settings);
  return picked.includes(settings?.shown) ? settings.shown : picked[0];
}

// Moves `ticks` metrics on, wrapping both ways.
function cycle(picked, shown, ticks) {
  const i = Math.max(0, picked.indexOf(shown));
  const n = picked.length;
  return picked[(((i + ticks) % n) + n) % n];
}

function wantsContext(settings) {
  return parseMetrics(settings).includes('context');
}

// What one key or strip segment shows. `session` is the Context target (a
// Sessions entry) or null.
function usageView(metric, { limits, session, now }) {
  const view = (label, pct, sub) => {
    if (pct === null) return { label, pct: null, level: null, sub };
    const p = Math.round(Math.min(100, Math.max(0, pct)));
    return { label, pct: p, level: level(p), sub };
  };
  if (metric === 'context') {
    if (!session) return view(LABELS.context, null, 'no session');
    if (!isNumber(session.context)) return view(LABELS.context, null, 'no data');
    return view(LABELS.context, session.context, session.project || '');
  }
  const held = limits.get(metric, now);
  const label = (held && held.label) || LABELS[metric];
  if (!held) return view(label, null, 'no data');
  const left = countdown(held.resetsAt, now);
  return view(label, held.pct, left ? `↻ ${left}` : '');
}

module.exports = {
  METRICS,
  SAME_WINDOW,
  level,
  countdown,
  readingsFromStatus,
  readingsFromCache,
  Limits,
  parseMetrics,
  shownMetric,
  cycle,
  wantsContext,
  usageView,
};
