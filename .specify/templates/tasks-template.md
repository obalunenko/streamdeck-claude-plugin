---

description: "Task list template for feature implementation"
---

# Tasks: [FEATURE NAME]

**Input**: Design documents from `/specs/[###-feature-name]/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Required for new or changed logic (Constitution IV), plus a fixture for every parsed screen (Constitution III). Run with `npm test`.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Logic**: `src/<module>.js` (pure, I/O injected); wiring only in `src/plugin.js`
- **Tests**: `test/<module>.test.js`; fixtures `test/fixtures/<area>-<state>.txt`
- **Deck**: `com.obalunenko.claudeperm.sdPlugin/manifest.json`, `pi/*.html`, icons via `scripts/icons.sh`
- **Hooks**: `hooks.json`; measured behaviour in `CLAUDE.md`

<!--
  ============================================================================
  IMPORTANT: The tasks below are SAMPLE TASKS for illustration purposes only.

  The /speckit-tasks command MUST replace these with actual tasks based on:
  - User stories from spec.md (with their priorities P1, P2, P3...)
  - Feature requirements from plan.md
  - Entities from data-model.md
  - Endpoints from contracts/

  Tasks MUST be organized by user story so each story can be:
  - Implemented independently
  - Tested independently
  - Delivered as an MVP increment

  DO NOT keep these sample tasks in the generated tasks.md file.
  ============================================================================
-->

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [ ] T001 Install dependencies with `npm ci` and confirm `npm test` is green
- [ ] T002 [P] Measure the Claude Code / Terminal.app behaviour the feature relies on; note the Claude Code version
- [ ] T003 [P] Capture the screens / statusline JSON as fixtures in test/fixtures/

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Pure helpers and wiring that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

Examples of foundational tasks (adjust based on your project):

- [ ] T004 Add the pure parser / state helper in src/[module].js with a header comment
- [ ] T005 [P] Test it against the fixtures in test/[module].test.js
- [ ] T006 Add the action / encoder layout to com.obalunenko.claudeperm.sdPlugin/manifest.json
- [ ] T007 Wire the module into src/plugin.js (inject Terminal bridge / clock)
- [ ] T008 [P] Update hooks.json if a new hook or endpoint is needed

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - [Title] (Priority: P1) 🎯 MVP

**Goal**: [Brief description of what this story delivers]

**Independent Test**: [How to verify this story works on its own]

### Tests for User Story 1 ⚠️

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [ ] T009 [P] [US1] Fixture-driven test for [screen state] in test/[module].test.js
- [ ] T010 [P] [US1] Test for [view / planner output] in test/[module].test.js

### Implementation for User Story 1

- [ ] T011 [P] [US1] Implement [parser / planner] in src/[module].js
- [ ] T012 [P] [US1] Implement [view] in src/[module].js
- [ ] T013 [US1] Handle [key press / dial event] in src/plugin.js (depends on T011, T012)
- [ ] T014 [US1] Guard typing with a screen read + SAFE_VALUE check (if it types)
- [ ] T015 [US1] Handle errors (TerminalAccessError, missing session) with a shown notice

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - [Title] (Priority: P2)

**Goal**: [Brief description of what this story delivers]

**Independent Test**: [How to verify this story works on its own]

### Tests for User Story 2 ⚠️

- [ ] T016 [P] [US2] Fixture-driven test for [screen state] in test/[module].test.js

### Implementation for User Story 2

- [ ] T017 [P] [US2] Implement [logic] in src/[module].js
- [ ] T018 [US2] Wire [event] in src/plugin.js
- [ ] T019 [US2] Add Property Inspector setting in com.obalunenko.claudeperm.sdPlugin/pi/[action].html (if needed)
- [ ] T020 [US2] Integrate with User Story 1 components (if needed)

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently

---

## Phase 5: User Story 3 - [Title] (Priority: P3)

**Goal**: [Brief description of what this story delivers]

**Independent Test**: [How to verify this story works on its own]

### Tests for User Story 3 ⚠️

- [ ] T021 [P] [US3] Fixture-driven test for [screen state] in test/[module].test.js

### Implementation for User Story 3

- [ ] T022 [P] [US3] Implement [logic] in src/[module].js
- [ ] T023 [US3] Wire [event] in src/plugin.js

**Checkpoint**: All user stories should now be independently functional

---

[Add more user story phases as needed, following the same pattern]

---

## Phase N: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [ ] TXXX [P] Record measured behaviour (with Claude Code version) in CLAUDE.md
- [ ] TXXX [P] Update README.md and the CLAUDE.md layout if modules or actions changed
- [ ] TXXX [P] Regenerate icons with `task icons` (if imgs changed)
- [ ] TXXX Run `task check` (node tests + Spec Kit checker tests)
- [ ] TXXX Raise the fourth number of manifest.json `Version`, `task package`, install and try on the device
- [ ] TXXX Run quickstart.md validation

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
  - User stories can then proceed in parallel (if staffed)
  - Or sequentially in priority order (P1 → P2 → P3)
- **Polish (Final Phase)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - May integrate with US1 but should be independently testable
- **User Story 3 (P3)**: Can start after Foundational (Phase 2) - May integrate with US1/US2 but should be independently testable

### Within Each User Story

- Measure and capture fixtures before writing parsers
- Tests MUST be written and FAIL before implementation
- Pure module logic before wiring in src/plugin.js
- Core implementation before integration
- Story complete before moving to next priority

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel
- All Foundational tasks marked [P] can run in parallel (within Phase 2)
- Once Foundational phase completes, all user stories can start in parallel (if team capacity allows)
- All tests for a user story marked [P] can run in parallel
- Models within a story marked [P] can run in parallel
- Different user stories can be worked on in parallel by different team members

---

## Parallel Example: User Story 1

```bash
# Launch all tests for User Story 1 together:
Task: "Fixture-driven test for [screen state] in test/[module].test.js"
Task: "Test for [view / planner output] in test/[module].test.js"

# Launch independent pure helpers together:
Task: "Implement [parser / planner] in src/[module].js"
Task: "Implement [view] in src/[module].js"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Test User Story 1 independently
5. Deploy/demo if ready

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Deploy/Demo (MVP!)
3. Add User Story 2 → Test independently → Deploy/Demo
4. Add User Story 3 → Test independently → Deploy/Demo
5. Each story adds value without breaking previous stories

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: User Story 1
   - Developer B: User Story 2
   - Developer C: User Story 3
3. Stories complete and integrate independently

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Verify tests fail before implementing
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Avoid: vague tasks, same file conflicts, cross-story dependencies that break independence
