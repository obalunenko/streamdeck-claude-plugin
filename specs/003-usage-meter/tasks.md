# Tasks: Usage Meter

**Input**: [spec.md](spec.md), [plan.md](plan.md)

**Status**: migrated. Completed tasks reflect what is in the code. Open tasks are gaps found during migration.

## Phase 1: Setup / Measurement

- [x] T001 Record the statusline `context_window` / `rate_limits` fields and the oauth-usage.json shape

## Phase 2: Foundational

- [x] T002 Readings from statusline and cache file in src/usage.js
- [x] T003 `Limits` merge by window (10 min), passed reset → 0 in src/usage.js
- [x] T004 [P] Tests for readings, merge, scoped model change in test/usage.test.js

## Phase 3: User Story 1 - Context fill (P1) 🎯 MVP

- [x] T005 [US1] Sessions keep a numeric context percentage; `latest()` fallback in src/tune.js
- [x] T006 [US1] Thresholds on the rounded value; usageView for context in src/usage.js
- [x] T007 [P] [US1] Tests: 74/75/85/86, no session, no data, project line

## Phase 4: User Story 2 - Plan limits (P1)

- [x] T008 [US2] Cache file read on appear and every 60 s while a limit is shown, in src/plugin.js
- [x] T009 [US2] Countdown and scoped label in src/usage.js; tests

## Phase 5: User Story 3 - Switch metrics (P2)

- [x] T010 [US3] parseMetrics, shownMetric, cycle in src/usage.js; tests
- [x] T011 [US3] Usage action (key press, dial rotate / push / touch), shown metric saved in settings, in src/plugin.js
- [x] T012 [US3] Manifest action and pi/usage.html (last box cannot be unchecked)

## Phase N: Polish

- [x] T013 README section with the cache-file snippet; CLAUDE.md data-source facts
- [ ] T014 Test the key fill / dial bar rendering in src/plugin.js (level colours, clamp, dots hidden for one metric)
- [ ] T015 Test that a limits-only Usage action does no front-tab lookup (wantsContext gate in src/plugin.js)
- [ ] T016 Test the cache-file read path: missing or invalid file adds nothing
