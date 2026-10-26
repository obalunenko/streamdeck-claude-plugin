# Tasks: Questions Answered Through the Terminal

**Input**: [spec.md](spec.md), [plan.md](plan.md)

**Status**: migrated. Completed tasks reflect what is in the code. Open tasks are gaps found during migration.

## Phase 1: Setup / Measurement

- [x] T001 Measure the dialog under `do script` on Claude Code 2.1.308 (18 facts)
- [x] T002 [P] Save dialog fixtures as test/fixtures/ask-*.txt

## Phase 2: Foundational

- [x] T003 `pressKeys` types only arrow runs into a ttysNNN tab in src/terminal.js; refusals tested in test/terminal.test.js
- [x] T004 [P] `parseDialog` (tab bar, page, items, button slot, review) in src/ask.js; fixture tests in test/ask.test.js
- [x] T005 `matches` / `pageOf` / `planPress` (no wrap, no guesses, no submit with an open question) in src/ask.js

## Phase 3: User Story 1 - Answer through the terminal (P1) 🎯 MVP

- [x] T006 [US1] `Asker.attach` detects the dialog and picks the path in src/ask.js
- [x] T007 [US1] `Asker.press` re-reads, plans, types, settles; serialised in src/ask.js
- [x] T008 [US1] Wire the path per request, key gating, Back disabled in src/plugin.js
- [x] T009 [P] [US1] Tests: attach, press, stale page, request closed mid-press, after-press ordering

## Phase 4: User Story 2 - Deck follows the keyboard (P2)

- [x] T010 [US2] Follow loop (1 s) and pick forgetting on keyboard page changes; review-page picks
- [x] T011 [P] [US2] Touch strip view, dots and option peek in src/strip.js; tests in test/strip.test.js

## Phase 5: User Story 3 - Hook fallback (P1)

- [x] T012 [US3] Hook path for an unknown session, a foreign dialog, no claude, refused access; grace fallback
- [x] T013 [P] [US3] Tests for each fallback and once-only logging of refused access

## Phase N: Polish

- [x] T014 CLAUDE.md measured facts; README note on Automation access
- [ ] T015 Test the plugin.js key gating: Deny on a terminal / probing request answers through the hook, Back alerts on the terminal path
- [ ] T016 Test `deckQuestions` (more than 4 options left to the terminal) in src/plugin.js
- [ ] T017 Move the measured facts that ask.js cites from the docs/superpowers design into specs/002 or CLAUDE.md only (ask.js header points at the old path)
