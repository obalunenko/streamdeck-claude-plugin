# Implementation Plan: Usage Meter

**Branch**: `develop` | **Date**: 2026-10-22 (built) · migrated 2026-10-26 | **Spec**: [spec.md](spec.md)

**Status**: migrated. The plan as executed is `docs/superpowers/plans/2026-10-22-usage-meter.md`.

## Summary

`src/usage.js` holds pure helpers. They turn statusline JSON and the OAuth
cache file into readings, fold the readings into `Limits` by reset window,
apply thresholds and countdowns, and build the view. `plugin.js` re-renders
Usage actions on statusline reports, on context-target changes and on a 60 s
timer, and draws a key fill or a dial bar.

## Technical Context

**Language/Version**: JavaScript, Node 20, CommonJS

**Primary Dependencies**: `ws`; esbuild

**Storage**: action settings (`metrics`, `shown`); reads `~/.claude/cache/oauth-usage.json`

**Testing**: `node --test` in `test/usage.test.js`

**Target Platform**: macOS, Stream Deck keys and Stream Deck + dials

**Project Type**: Stream Deck plugin

**Claude Code Version Measured On**: 2.1.306

**Performance Goals**: 60 s cache reread and countdown refresh

**Constraints**: no network, no Keychain, no Terminal access unless Context is picked

**Scale/Scope**: 1 module, 1 action, 1 Property Inspector, 18 tests

## Constitution Check

- [x] **I.** No endpoint added. Nothing decides a request.
- [x] **II.** Nothing typed.
- [x] **III.** Data sources measured on the user's machine and recorded in CLAUDE.md.
- [x] **IV.** `usage.js` is pure and fully tested. The rendering lives in `plugin.js` and is untested (see tasks).
- [x] **V.** No new dependency.
- [x] **VI.** New action UUID `.usage`.
- [x] **VII.** Header comments and English strings.

## Project Structure

```text
src/
├── usage.js      (new)      readingsFromStatus, readingsFromCache, Limits, level, countdown,
│                            parseMetrics, shownMetric, cycle, wantsContext, usageView
├── tune.js       (modified) Sessions keep the context percentage; latest(); Tuner exposes its session
└── plugin.js     (modified) Usage action, key fill / dial bar rendering, cache timer, wantsContext gate

test/
├── usage.test.js  (new)
└── tune.test.js   (modified) context percentage, latest()

com.obalunenko.claudeperm.sdPlugin/
├── manifest.json  (modified) action .usage, Keypad + Encoder
└── pi/usage.html  (new)
```

**Structure Decision**: the merge and the view are pure in `usage.js`. The Context target reuses the Tuner's target logic.

## Deviations from the Design

- The scoped-limit fallback label is `Model 7d`. The design said "Fable 7d", and that text appears only when the cache names Fable.

## Complexity Tracking

None.
