# Usage Meter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Stream Deck key / dial action, **Usage**, that shows the context fill of the current Claude Code session or one of the plan limits (5h, 7d, the scoped weekly limit) as a green / yellow / red scale.

**Architecture:** A new `src/usage.js` holds the pure parts: readings from the statusline JSON and from `~/.claude/cache/oauth-usage.json`, a `Limits` store that merges them per limit (later window wins, same window keeps the higher value), thresholds, countdown, metric settings and cycling, and a `usageView` that turns it all into what one key / segment shows. `Sessions` in `tune.js` additionally keeps each session's context percentage and which tty reported last; the `Tuner` exposes the session it targets. `plugin.js` routes events of the new action, draws the key (fill) and the segment (bar), reads the cache file once a minute and saves the shown metric in the action's settings.

**Tech Stack:** Node 20, `ws`, esbuild, `node:test`, plain HTML Property Inspector, `sips` for icons.

**Spec:** `docs/superpowers/specs/2026-10-22-usage-meter-design.md`

## Global Constraints

- Node 20, plain Stream Deck WebSocket protocol over `ws`, no Elgato SDK, no new npm dependencies.
- Keep plugin UUID `com.obalunenko.claudeperm`; new action UUID `com.obalunenko.claudeperm.usage`, Controllers `Keypad` and `Encoder`, encoder layout `$A0`, full-canvas feedback.
- Thresholds on the percentage rounded to a whole number: green `< 75`, yellow `75–85` inclusive, red `> 85`.
- Two `resets_at` are the same window when they differ by less than 10 minutes.
- Staleness is only "reset passed": that limit shows `0 %` with no countdown.
- The plugin never reads the Keychain, never calls the network for this feature, only reads the cache file.
- Without a Context-showing Usage action or a Model / Effort dial on the deck, the plugin never asks Terminal anything.
- Comments and user-facing strings in English. Strings shown: `Context`, `5h`, `7d`, `<display_name> 7d` (`Model 7d` before any data), `no data`, `no session`, `—`, `↻ <countdown>`.
- Commits: plain imperative subject for the feature commit(s), `test:` / `docs:` prefixes for test-only / doc-only commits. End with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Branch `develop`.

## Review Focus

1. **An idle session reports an old window after the active one** (its `resets_at` already passed) — the key must stay on the active window's value, not drop to a green `0 %`. Test: `Limits ignores a reading of an earlier window` (Task 1).
2. **Malformed statusline / cache JSON** (strings for numbers, `null`, missing `rate_limits`, unparsable `resets_at`) — no `NaN%`, the metric shows `no data` or keeps the held value. Tests: `readingsFromStatus skips non-numbers`, `readingsFromCache skips bad entries` (Task 1).
3. **Settings from an older PI or edited by hand** (unknown ids, empty list, `shown` not among the picked) — falls back to all metrics / the first picked. Test: `parseMetrics keeps known ids in fixed order and defaults to all`, `shownMetric falls back to the first picked` (Task 1).
4. **A Usage action showing only limits** — never starts the Terminal front-tab lookup. Test: `wantsContext only when context is picked` (Task 1); used by `watchTune` in Task 3.
5. **The targeted tab closes or the plugin restarts** — Context falls back to the last reporting session, or `no session`; never a crash. Tests: `Sessions latest follows the last report and forgets a dropped tty`, `Tuner session falls back to null without a target` (Task 2).

---

### Task 1: `src/usage.js` — readings, merge, thresholds, view

**Files:**
- Create: `src/usage.js`
- Test: `test/usage.test.js`

**Interfaces:**
- Produces (all exported from `src/usage.js`):
  - `METRICS = ['context', 'five_hour', 'seven_day', 'scoped']` — fixed order, also the settings ids.
  - `SAME_WINDOW = 10 * 60 * 1000`
  - `type Reading = { pct: number, resetsAt: number|null /* ms */, label?: string }`
  - `level(pct: number): 'green'|'yellow'|'red'` — on `Math.round(pct)`.
  - `countdown(resetsAt: number|null, now: number): string` — `''` when null or not in the future; `<1h` → `45m`; `<24h` → `1h12m`; else `2d 3h` (floor).
  - `readingsFromStatus(status): { five_hour?: Reading, seven_day?: Reading }` — `rate_limits.<k>.used_percentage`, `resets_at` Unix seconds × 1000.
  - `readingsFromCache(json): { five_hour?: Reading, seven_day?: Reading, scoped?: Reading }` — `five_hour.utilization` / `seven_day.utilization` with ISO `resets_at`; `scoped` from the first `limits[]` entry with `kind === 'weekly_scoped'`: `percent`, `resets_at`, `label: '<scope.model.display_name> 7d'` (only when `display_name` is a string).
  - `class Limits { fold(key, reading): void; get(key, now): Reading|null }` — `get` returns `{ pct: 0, resetsAt: null, label }` once `resetsAt <= now`.
  - `parseMetrics(settings): string[]` — `settings.metrics` filtered to known ids, in `METRICS` order, deduped; empty or not an array → all four.
  - `shownMetric(settings): string` — `settings.shown` if among `parseMetrics(settings)`, else the first.
  - `cycle(picked: string[], shown: string, ticks: number): string` — wraps both ways; unknown `shown` counts as index 0.
  - `wantsContext(settings): boolean`
  - `usageView(metric, { limits, session, now }): { label: string, pct: number|null /* rounded, clamped 0–100 */, level: string|null, sub: string }`
    - `context`: `session` null → `{label:'Context', pct:null, level:null, sub:'no session'}`; `session.context` null → `sub:'no data'`; else `sub: session.project || ''`.
    - limits: labels `5h`, `7d`, scoped → held `label` or `Model 7d`; no held value → `sub:'no data'`; else `sub: countdown ? '↻ ' + countdown : ''`.

Merge rule for `fold` (the one non-obvious algorithm):

```js
// Ignore non-finite pct. Nothing held → take it. A reading without resetsAt
// only fills an empty slot. Held without resetsAt → replace.
// d = r.resetsAt - held.resetsAt:
//   d >= SAME_WINDOW  → later window: replace
//   d <= -SAME_WINDOW → earlier window: ignore
//   otherwise          → same window: pct = max(held.pct, r.pct); keep held.resetsAt;
//                        label = r.label ?? held.label
```

- [ ] **Step 1: Write the failing tests** in `test/usage.test.js` (style of `test/tune.test.js`: `node:test`, `assert/strict`):

```js
test('level switches at 75 and above 85 on the rounded value', () => {
  assert.equal(level(74.4), 'green');
  assert.equal(level(74.5), 'yellow');
  assert.equal(level(75), 'yellow');
  assert.equal(level(85), 'yellow');
  assert.equal(level(85.4), 'yellow');
  assert.equal(level(85.5), 'red');
  assert.equal(level(100), 'red');
});

test('countdown formats minutes, hours and days', () => {
  const m = 60_000;
  assert.equal(countdown(45 * m, 0), '45m');
  assert.equal(countdown(72 * m, 0), '1h12m');
  assert.equal(countdown((51 * 60 + 5) * m, 0), '2d 3h');
  assert.equal(countdown(0, 0), '');
  assert.equal(countdown(null, 0), '');
});

test('readingsFromStatus reads rate limits in ms', () => { /* five_hour 78 @ 1800000000 → {pct:78, resetsAt:1800000000000} */ });
test('readingsFromStatus skips non-numbers', () => { /* used_percentage '78', null, missing rate_limits → {} */ });
test('readingsFromCache reads five_hour, seven_day and the scoped limit', () => {
  // the shape from the spec; scoped → { pct: 0, resetsAt: Date.parse('2026-10-24T08:00:00+00:00'), label: 'Fable 7d' }
});
test('readingsFromCache skips bad entries', () => { /* utilization 'x', resets_at 'nope' → resetsAt null, limits not an array, no weekly_scoped */ });

test('Limits replaces the value with a later window', () => {});            // 90 @ T, then 3 @ T+5h → 3
test('Limits keeps the higher value within a window', () => {});            // 80 @ T, 60 @ T+0.12s → 80; 82 @ T-1s → 82
test('Limits ignores a reading of an earlier window', () => {
  // active: 90 @ T+5h; idle session: 40 @ T (already past at now) → get(now) is 90, level red
});
test('Limits shows 0 with no reset once the window has passed', () => {}); // get(key, resetsAt+1) → { pct: 0, resetsAt: null }
test('Limits takes a reading without reset only into an empty slot', () => {});

test('parseMetrics keeps known ids in fixed order and defaults to all', () => {
  assert.deepEqual(parseMetrics({ metrics: ['scoped', 'context', 'bogus', 'context'] }), ['context', 'scoped']);
  assert.deepEqual(parseMetrics({ metrics: [] }), METRICS);
  assert.deepEqual(parseMetrics({}), METRICS);
});
test('shownMetric falls back to the first picked', () => {
  assert.equal(shownMetric({ metrics: ['seven_day', 'scoped'], shown: 'context' }), 'seven_day');
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
  assert.equal(wantsContext({}), true);
});
test('usageView shows no session, no data and the project for context', () => {});
test('usageView shows the countdown and the scoped label for limits', () => {});
```

Fill the `{}` bodies with the values in their comments.

- [ ] **Step 2: Run** `node --test test/usage.test.js` — Expected: FAIL, `Cannot find module '../src/usage'`.
- [ ] **Step 3: Implement `src/usage.js`** with the interfaces above. Header comment in the style of `tune.js` (what the module is, where readings come from). Validation: `Number.isFinite` for numbers, `typeof === 'string'` for labels; `Date.parse` → `NaN` becomes `null`.
- [ ] **Step 4: Run** `npm test` — Expected: all suites PASS.
- [ ] **Step 5: Commit** `src/usage.js test/usage.test.js` — `Merge usage readings for the usage meter`.

---

### Task 2: Sessions keep the context percentage; the Tuner tells its session

**Files:**
- Modify: `src/tune.js` (`Sessions.report`, new `Sessions.latest`, new `Tuner.session`)
- Test: `test/tune.test.js`

**Interfaces:**
- Produces:
  - Session entries gain `context: number|null` — `status.context_window.used_percentage` when `Number.isFinite`, else `null`.
  - `Sessions.latest(): entry|null` — the entry of the tty that reported last (kept as `this.last`); `null` when that tty was dropped or its session ended.
  - `Tuner.session(): entry|null` — the session of `target()` (front tab, else chosen), else `null`. No Terminal call; uses the last known front.

- [ ] **Step 1: Update the failing tests.** Add `context: null` to the two `deepEqual` expectations in `Sessions keeps only string fields of a statusline report`. Add:

```js
test('Sessions keeps a numeric context percentage only', () => {
  // { context_window: { used_percentage: 42.5 } } → 42.5; '42' → null; missing → null
});
test('Sessions latest follows the last report and forgets a dropped tty', () => {
  // report ttys1, ttys2 → latest().tty === 'ttys2'; drop('ttys2') → null; end(<ttys1 session>) after reporting ttys1 last → null
});
test('Tuner session is the target session', async () => {
  // setup(); await tuner.refresh(); tuner.session().sessionId === 'A'
});
test('Tuner session falls back to null without a target', async () => {
  // setup({ front: 'ttys9' }); await tuner.refresh(); tuner.session() === null
});
```

- [ ] **Step 2: Run** `node --test test/tune.test.js` — Expected: the new tests FAIL.
- [ ] **Step 3: Implement** in `src/tune.js` as specified.
- [ ] **Step 4: Run** `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** — `Keep each session's context fill`.

---

### Task 3: The Usage action on the deck

**Files:**
- Modify: `src/plugin.js`, `com.obalunenko.claudeperm.sdPlugin/manifest.json`, `scripts/icons.sh`, `README.md`, `CLAUDE.md`
- Create: `com.obalunenko.claudeperm.sdPlugin/pi/usage.html`, `imgs/usage.png`, `imgs/usage@2x.png` (via `npm run icons`)

**Interfaces:**
- Consumes: everything from Task 1; `Sessions.latest`, `Tuner.session` from Task 2.

- [ ] **Step 1: Manifest.** Add the action after `tune`: UUID `com.obalunenko.claudeperm.usage`, Name `Usage`, Tooltip `Shows the context fill or a plan limit as a green / yellow / red scale`, Icon / State image `imgs/usage`, `PropertyInspectorPath: pi/usage.html`, Controllers `["Keypad", "Encoder"]`, Encoder layout `$A0`, TriggerDescription `Rotate`/`Push`/`Touch`: `Next metric`. Raise `Version` to `1.2.0.2`.
- [ ] **Step 2: Icon.** `icon usage '#2e7d32' '▮' 36` in `scripts/icons.sh`; run `npm run icons`; only `imgs/usage*.png` may change in `git status`.
- [ ] **Step 3: Property Inspector `pi/usage.html`.** Copy the look of `pi/tune.html`: one row `Shows` with four checkboxes (`Context`, `5h`, `7d`, `Fable 7d`) bound to `settings.metrics` ids from `METRICS`; default all; the last checked box cannot be unchecked (re-check it). Saving keeps the other settings keys (`shown`). Hint: `With more than one: turn, press or tap to switch.` and `Fable 7d needs the statusline to write ~/.claude/cache/oauth-usage.json (see README).`
- [ ] **Step 4: Plugin wiring** in `src/plugin.js`:
  - `ACTIONS.usage`; a `limits = new Limits()`; `USAGE_CACHE = path.join(os.homedir(), '.claude/cache/oauth-usage.json')`; `USAGE_REFRESH_EVERY = 60_000`.
  - `/statusline`: after `sessions.report`, fold `readingsFromStatus(body)` into `limits` and `renderUsage()` (renders all Usage contexts). `SessionEnd`: `renderUsage()` after `sessions.end`.
  - `readUsageCache()`: `fs.promises.readFile` + `JSON.parse`, fold `readingsFromCache`, `renderUsage()`; any error is ignored silently.
  - `watchUsage()` next to `watchTune()`: while any Usage action is on the deck, a 60 s interval that runs `readUsageCache()` and `renderUsage()` (countdown); called from `willAppear` / `willDisappear` / `didReceiveSettings`; `willAppear` of a Usage action reads the cache at once.
  - `watchTune()`: `visible` also when a Usage context has `wantsContext(settings)`; call it from `didReceiveSettings` too.
  - Context session: `tuner.session() || sessions.latest()`.
  - Input: `keyDown` on Usage → `cycle(picked, shown, 1)` when more than one metric is picked, else nothing; `dialRotate` → `cycle(…, ticks)`; `dialDown` / `touchTap` → `cycle(…, 1)`. The new `shown` goes into `c.settings` and `send('setSettings', { context, payload: c.settings })`, then `render(context)`.
  - `render`: Usage on an encoder (`msg.payload.controller === 'Encoder'`, store it in `contexts` at `willAppear`) → `setFeedback` `full-canvas: usageStrip(view, picked, shown)`; on a key → `setImage usageKey(view)`.
- [ ] **Step 5: Drawing.** `LEVEL = { green: '#2e7d32', yellow: '#b28704', red: '#c62828' }`, track `#444`, idle bg `COLORS.idle`.
  - `usageKey(view)` 144×144: fill rect from the bottom, height `144 * pct / 100`, colour `LEVEL[level]`; label 20 bold at top, `pct%` (or `—`) 40 bold in the middle, `sub` 15 at the bottom (`clip` to fit); `—` / `no data` in `#888`.
  - `usageStrip(view, picked, shown)` 200×100: label 17 bold top-left, dots (`●` shown / `○` others, only when `picked.length > 1`) 12 top-right, `pct%` 30 bold left, `sub` 14 right-aligned on that row, rounded bar `x=12 y=74 w=176 h=14 rx=7` on the track, width `176 * pct / 100`.
- [ ] **Step 6: Build and test.** `npm test` PASS; `npm run build` exits 0.
- [ ] **Step 7: Docs.** README: a row in the Actions table, a `## Usage meter` section (what each metric is, colours, switching, data sources, the reset rule, the cache-file snippet from the user's statusline for Fable 7d, the Terminal access note). CLAUDE.md: `src/usage.js` and `pi/` in Layout, the action in "What this is", the cache file under the measured facts.
- [ ] **Step 8: Commit** — `Show context and plan limits on a key or a dial`.
- [ ] **Step 9: Manual check (with the user).** `npm run package`, open the package, put Usage on a key and on a dial: colours at the current values, switching, the countdown moving after a minute, Context following the front tab.
