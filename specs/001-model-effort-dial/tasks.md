# Tasks: Model / Effort Dial

**Input**: [spec.md](spec.md), [plan.md](plan.md)

**Status**: migrated. Completed tasks reflect what is in the code. Open tasks are gaps found during migration.

## Phase 1: Setup / Measurement

- [x] T001 Measure the screen states, tty of the statusline / hooks and `/model` confirmation on Claude Code 2.1.306
- [x] T002 [P] Capture fixtures in test/fixtures/screen-*.txt and test/fixtures/claude-help.txt
- [ ] T003 Measure same-window tab selection by `do script` (design fact 13, left unmeasured)

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
- [ ] T018 Test the `/statusline` endpoint in src/plugin.js: Origin rejected, a bad X-Claude-TTY ignored (plugin.js has no tests)
- [ ] T019 Test the strip rendering of the tune action (states `no session`, `busy`, `no claude`, `no access`, `—`)
- [ ] T020 pi/tune.html is checked only by hand. Decide whether a test is worth it
