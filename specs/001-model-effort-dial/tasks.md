# Tasks: Model / Effort Dial

**Input**: [spec.md](spec.md), [plan.md](plan.md)

**Status**: migrated. Completed tasks reflect what is in the code. Open tasks are gaps found during migration.

## Phase 1: Setup / Measurement

- [x] T001 Measure the screen states, tty of the statusline / hooks and `/model` confirmation on Claude Code 2.1.306
- [x] T002 [P] Capture fixtures in test/fixtures/screen-*.txt and test/fixtures/claude-help.txt
- [x] T003 Measure same-window tab selection by `do script` (design fact 13, left unmeasured)

## Phase 2: Foundational

- [x] T004 [P] Parse effort levels and model aliases in src/claude-cli.js; tests in test/claude-cli.test.js
- [x] T005 [P] Terminal bridge (frontTab, tabInfo, typeInto, screenState, interrupted, SAFE_VALUE) in src/terminal.js; tests in test/terminal.test.js

## Phase 3: User Story 1 - Turn a dial (P1) 🎯 MVP

- [x] T006 [US1] Sessions registry from statusline reports in src/tune.js
- [x] T007 [US1] Tuner debounce, step (wrap / clamp), matchModel in src/tune.js
- [x] T008 [P] [US1] Tests for send-once, no-op on current value, tick counting in test/tune.test.js
- [x] T009 [US1] `/statusline` endpoint with X-Claude-TTY and the .tune action in src/plugin.js
- [x] T010 [US1] Manifest action, pi/tune.html, icon in scripts/icons.sh

## Phase 4: User Story 2 - Choose the session (P2)

- [x] T011 [US2] Press / touch cycles the chosen tab; alert when the front tab is a session (src/tune.js)
- [x] T012 [P] [US2] Tests: chosen fallback, cleared choice, press alert in test/tune.test.js

## Phase 5: User Story 3 - Never type into the wrong place (P1)

- [x] T013 [US3] Busy from UserPromptSubmit → Stop / StopFailure, interrupted line; StopFailure in hooks.json
- [x] T014 [US3] Screen gates (frame, dialog, stash), target-change check, Ctrl+S stash in src/tune.js / src/terminal.js
- [x] T015 [US3] Settle delay and serialised sends; no typing while the session has a request on the deck
- [x] T016 [P] [US3] Tests for busy, blocked screen, target change, dialog from the other dial, no access

## Phase N: Polish

- [x] T017 README statusline snippet; CLAUDE.md measured facts
- [x] T018 Test the `/statusline` endpoint in src/plugin.js: Origin rejected, a bad X-Claude-TTY ignored (plugin.js has no tests)
- [x] T019 Test the strip rendering of the tune action (states `no session`, `busy`, `no claude`, `no access`, `—`)
- [x] T020 pi/tune.html is checked only by hand. Decide whether a test is worth it

## Phase 6: Convergence

- [x] T021 Make the chosen-tab liveness check and US2/AC2 agree: either clear a chosen tab whose claude has exited on refresh (tabInfo in Tuner.refresh, src/tune.js), or keep the design's check-on-dial-use and narrow AC2 to "When the dial is turned" per US2/AC2 (partial)
- [x] T022 Align the chosen-session suffix: the strip draws `· chosen` (src/draw.js tuneStrip, test/draw.test.js) while the spec's Deck Surface says `(chosen)` per spec Deck Surface (contradicts)

## Phase 7: Convergence

- [x] T023 Amend the constitution (PATCH) so Principle I names src/server.js as the place that rejects an `Origin` header and Principle IV says plugin.js wires the HTTP server that src/server.js creates; the server moved out of plugin.js in T018, and CLAUDE.md already lists src/server.js per Constitution I, IV (contradicts)
- [x] T024 Test that typeInto sends Ctrl+S (`\x13`) before `/model <v>` / `/effort <v>`, e.g. by letting src/terminal.js take an injected osascript runner, in test/terminal.test.js per FR-009 (partial)
