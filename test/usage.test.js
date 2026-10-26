const test = require('node:test');
const assert = require('node:assert/strict');

const {
  METRICS,
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
} = require('../src/usage');

const MIN = 60_000;
const HOUR = 60 * MIN;
const T = Date.parse('2026-10-22T01:10:00Z');

// The cache file as the user's statusline writes it, trimmed.
const CACHE = {
  five_hour: { utilization: 4.0, resets_at: '2026-10-22T01:10:00.470736+00:00' },
  seven_day: { utilization: 13.0, resets_at: '2026-10-24T08:00:00.470754+00:00' },
  limits: [
    { kind: 'session', percent: 2, resets_at: '2026-10-22T01:10:00.351270+00:00', scope: null },
    { kind: 'weekly_all', percent: 13, resets_at: '2026-10-24T08:00:00.351289+00:00', scope: null },
    {
      kind: 'weekly_scoped',
      percent: 0,
      resets_at: '2026-10-24T08:00:00+00:00',
      scope: { model: { id: null, display_name: 'Fable' }, surface: null },
    },
  ],
};

test('level switches at 75 and above 85 on the rounded value', () => {
  assert.equal(level(0), 'green');
  assert.equal(level(74.4), 'green');
  assert.equal(level(74.5), 'yellow');
  assert.equal(level(75), 'yellow');
  assert.equal(level(85), 'yellow');
  assert.equal(level(85.4), 'yellow');
  assert.equal(level(85.5), 'red');
  assert.equal(level(100), 'red');
});

test('countdown formats minutes, hours and days', () => {
  assert.equal(countdown(45 * MIN, 0), '45m');
  assert.equal(countdown(72 * MIN, 0), '1h12m');
  assert.equal(countdown(51 * HOUR + 5 * MIN, 0), '2d 3h');
  assert.equal(countdown(0, 0), '');
  assert.equal(countdown(-MIN, 0), '');
  assert.equal(countdown(null, 0), '');
});

test('readingsFromStatus reads rate limits in ms', () => {
  const r = readingsFromStatus({
    rate_limits: {
      five_hour: { used_percentage: 78, resets_at: 1800000000 },
      seven_day: { used_percentage: 13.5, resets_at: 1800500000 },
    },
  });
  assert.deepEqual(r, {
    five_hour: { pct: 78, resetsAt: 1800000000000 },
    seven_day: { pct: 13.5, resetsAt: 1800500000000 },
  });
});

test('readingsFromStatus skips non-numbers', () => {
  assert.deepEqual(readingsFromStatus({}), {});
  assert.deepEqual(readingsFromStatus(null), {});
  assert.deepEqual(readingsFromStatus({ rate_limits: 'x' }), {});
  assert.deepEqual(
    readingsFromStatus({ rate_limits: { five_hour: { used_percentage: '78', resets_at: 1 }, seven_day: { used_percentage: null } } }),
    {},
  );
  assert.deepEqual(readingsFromStatus({ rate_limits: { five_hour: { used_percentage: 5, resets_at: 'soon' } } }), {
    five_hour: { pct: 5, resetsAt: null },
  });
});

test('readingsFromCache reads five_hour, seven_day and the scoped limit', () => {
  assert.deepEqual(readingsFromCache(CACHE), {
    five_hour: { pct: 4, resetsAt: Date.parse('2026-10-22T01:10:00.470736+00:00') },
    seven_day: { pct: 13, resetsAt: Date.parse('2026-10-24T08:00:00.470754+00:00') },
    scoped: { pct: 0, resetsAt: Date.parse('2026-10-24T08:00:00+00:00'), label: 'Fable 7d' },
  });
});

test('readingsFromCache skips bad entries', () => {
  assert.deepEqual(readingsFromCache(null), {});
  assert.deepEqual(readingsFromCache({ five_hour: { utilization: 'x' }, limits: 'nope' }), {});
  assert.deepEqual(readingsFromCache({ seven_day: { utilization: 20, resets_at: 'nope' }, limits: [{ kind: 'weekly_all', percent: 1 }] }), {
    seven_day: { pct: 20, resetsAt: null },
  });
  assert.deepEqual(readingsFromCache({ limits: [null, { kind: 'weekly_scoped', percent: 7, scope: { model: { display_name: 3 } } }] }), {
    scoped: { pct: 7, resetsAt: null },
  });
});

test('Limits replaces the value with a later window', () => {
  const limits = new Limits();
  limits.fold('five_hour', { pct: 90, resetsAt: T });
  limits.fold('five_hour', { pct: 3, resetsAt: T + 5 * HOUR });
  assert.deepEqual(limits.get('five_hour', T - HOUR), { pct: 3, resetsAt: T + 5 * HOUR });
});

test('Limits keeps the higher value within a window', () => {
  const limits = new Limits();
  limits.fold('five_hour', { pct: 80, resetsAt: T });
  limits.fold('five_hour', { pct: 60, resetsAt: T + 120 });
  assert.equal(limits.get('five_hour', T - HOUR).pct, 80);
  limits.fold('five_hour', { pct: 82, resetsAt: T - 1000 });
  assert.deepEqual(limits.get('five_hour', T - HOUR), { pct: 82, resetsAt: T });
});

test('Limits ignores a reading of an earlier window', () => {
  const limits = new Limits();
  const now = T + HOUR;
  limits.fold('five_hour', { pct: 90, resetsAt: T + 5 * HOUR });
  // An idle session still holds the window that ended at T.
  limits.fold('five_hour', { pct: 40, resetsAt: T });
  const held = limits.get('five_hour', now);
  assert.equal(held.pct, 90);
  assert.equal(level(held.pct), 'red');
});

test('Limits shows 0 with no reset once the window has passed', () => {
  const limits = new Limits();
  limits.fold('scoped', { pct: 91, resetsAt: T, label: 'Fable 7d' });
  assert.deepEqual(limits.get('scoped', T - 1), { pct: 91, resetsAt: T, label: 'Fable 7d' });
  assert.deepEqual(limits.get('scoped', T), { pct: 0, resetsAt: null, label: 'Fable 7d' });
  assert.equal(limits.get('seven_day', T), null);
});

test('Limits takes a reading without reset only into an empty slot', () => {
  const limits = new Limits();
  limits.fold('seven_day', { pct: 10, resetsAt: null });
  assert.deepEqual(limits.get('seven_day', T), { pct: 10, resetsAt: null });
  limits.fold('seven_day', { pct: 20, resetsAt: T + HOUR });
  limits.fold('seven_day', { pct: 99, resetsAt: null });
  limits.fold('seven_day', { pct: NaN, resetsAt: T + 9 * HOUR });
  assert.deepEqual(limits.get('seven_day', T), { pct: 20, resetsAt: T + HOUR });
});

test('Limits replaces the scoped value when the model changes', () => {
  const limits = new Limits();
  limits.fold('scoped', { pct: 91, resetsAt: T, label: 'Fable 7d' });
  limits.fold('scoped', { pct: 10, resetsAt: T - 400, label: 'Opus 7d' });
  assert.deepEqual(limits.get('scoped', T - HOUR), { pct: 10, resetsAt: T - 400, label: 'Opus 7d' });
});

test('parseMetrics keeps known ids in fixed order and defaults to all', () => {
  assert.deepEqual(parseMetrics({ metrics: ['scoped', 'context', 'bogus', 'context'] }), ['context', 'scoped']);
  assert.deepEqual(parseMetrics({ metrics: [] }), METRICS);
  assert.deepEqual(parseMetrics({ metrics: 'context' }), METRICS);
  assert.deepEqual(parseMetrics({}), METRICS);
  assert.deepEqual(parseMetrics(undefined), METRICS);
});

test('shownMetric falls back to the first picked', () => {
  assert.equal(shownMetric({ metrics: ['seven_day', 'scoped'], shown: 'context' }), 'seven_day');
  assert.equal(shownMetric({ metrics: ['seven_day', 'scoped'], shown: 'scoped' }), 'scoped');
  assert.equal(shownMetric({}), 'context');
});

test('cycle wraps both ways', () => {
  const p = ['context', 'five_hour', 'scoped'];
  assert.equal(cycle(p, 'scoped', 1), 'context');
  assert.equal(cycle(p, 'context', -1), 'scoped');
  assert.equal(cycle(p, 'context', 5), 'scoped');
  assert.equal(cycle(p, 'seven_day', 1), 'five_hour');
});

test('wantsContext only when context is picked', () => {
  assert.equal(wantsContext({ metrics: ['five_hour'] }), false);
  assert.equal(wantsContext({ metrics: ['five_hour', 'context'] }), true);
  assert.equal(wantsContext({}), true);
});

test('usageView shows no session, no data and the project for context', () => {
  const limits = new Limits();
  assert.deepEqual(usageView('context', { limits, session: null, now: T }), { label: 'Context', pct: null, level: null, sub: 'no session' });
  assert.deepEqual(usageView('context', { limits, session: { context: null, project: 'p' }, now: T }), {
    label: 'Context',
    pct: null,
    level: null,
    sub: 'no data',
  });
  assert.deepEqual(usageView('context', { limits, session: { context: 41.6, project: 'proj-a' }, now: T }), {
    label: 'Context',
    pct: 42,
    level: 'green',
    sub: 'proj-a',
  });
  assert.equal(usageView('context', { limits, session: { context: 140, project: null }, now: T }).pct, 100);
});

test('usageView shows the countdown and the scoped label for limits', () => {
  const limits = new Limits();
  assert.deepEqual(usageView('five_hour', { limits, session: null, now: T }), { label: '5h', pct: null, level: null, sub: 'no data' });
  assert.equal(usageView('scoped', { limits, session: null, now: T }).label, 'Model 7d');
  limits.fold('five_hour', { pct: 78.2, resetsAt: T + 72 * MIN });
  limits.fold('seven_day', { pct: 13, resetsAt: T });
  limits.fold('scoped', { pct: 91, resetsAt: T + 51 * HOUR, label: 'Fable 7d' });
  assert.deepEqual(usageView('five_hour', { limits, session: null, now: T }), { label: '5h', pct: 78, level: 'yellow', sub: '↻ 1h12m' });
  assert.deepEqual(usageView('seven_day', { limits, session: null, now: T }), { label: '7d', pct: 0, level: 'green', sub: '' });
  assert.deepEqual(usageView('scoped', { limits, session: null, now: T }), { label: 'Fable 7d', pct: 91, level: 'red', sub: '↻ 2d 3h' });
});
