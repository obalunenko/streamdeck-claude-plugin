# Feature Specification: Questions Answered Through the Terminal

**Feature Branch**: `develop` (built before Spec Kit; no feature branch)

**Created**: 2026-10-22 (design) · migrated 2026-10-26

**Status**: migrated

**Input**: Reverse-engineered from `docs/superpowers/specs/2026-10-22-questions-follow-terminal-design.md` (removed after migration; in git history), its plan, `src/ask.js`, `src/strip.js`, `pressKeys` in `src/terminal.js`, and their tests.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Answer a multi-page question through the terminal dialog (Priority: P1)

The deck clips question text, so the user reads the full question in the terminal
and presses the answer on the deck. Each deck press is typed into the
terminal's `AskUserQuestion` dialog as ↑ / ↓ runs plus Enter. This keeps the
terminal page and the deck page the same.

**Why this priority**: Before this feature the terminal stayed on page 1 while the deck moved on, so the user read the wrong question.

**Independent Test**: `test/ask.test.js` "press types the planned keys and follows the next page", "planPress moves down or up without wrapping".

**Acceptance Scenarios**:

1. **Given** a single-select page, **When** option N is pressed, **Then** the highlight moves from the `❯` item to N and Enter picks it. The dialog moves to the next page.
2. **Given** a multi-select page, **When** option N is pressed, **Then** N is toggled and the page stays. **When** Next is pressed, **Then** the highlight moves to `Next` / `Submit` and the dialog moves on.
3. **Given** the review page with every question answered, **When** Submit is pressed, **Then** `Submit answers` is chosen.
4. **Given** a question is still open, Next on a single-select page, or Submit off the review page, **When** pressed, **Then** the key shows an alert and nothing is typed.

---

### User Story 2 - The deck follows the keyboard (Priority: P2)

While a terminal-path request is on the deck, the plugin reads the tab about
once a second. The deck then shows the terminal's page, its multi-select
checks and which questions are answered, including changes made with the
keyboard.

**Why this priority**: Without it, the two views drift as soon as the user touches the keyboard.

**Independent Test**: "a keyboard page change forgets the deck's picks", "follow takes the picks from the review page", strip "an answer typed in the terminal shows as answered without a label".

**Acceptance Scenarios**:

1. **Given** the user changes page with the keyboard, **When** the next read comes, **Then** the deck shows that page and forgets its own picks for the page left and the page reached.
2. **Given** the review page, **When** it is read, **Then** the deck takes every pick from the `→ <answer>` lines.

---

### User Story 3 - Fall back to the hook when the terminal path is unsafe (Priority: P1)

If the session's tab is unknown, does not show this dialog within about 2 s,
does not run `claude`, or Terminal access is refused, the deck answers
through the hook as before: its own pages, a working Back key and dial, and
`updatedInput.answers`.

**Why this priority**: The design's anti-goal is breaking the hook path.

**Independent Test**: "attach leaves an unknown session or a foreign dialog on the hook path", "a tab without claude or a refused Terminal sends the request to the hook path", "follow falls back to the hook path only after the grace period".

**Acceptance Scenarios**:

1. **Given** no statusline entry for the hook's `session_id`, **When** a question arrives, **Then** the request takes the hook path.
2. **Given** a terminal-path request whose dialog disappears, **When** the 2 s grace has passed and the request is still open, **Then** it falls back to the hook path and keeps the deck's picks.
3. **Given** any request, **When** Deny is pressed, **Then** the deny goes through the hook (`behavior: "deny"`).

### Edge Cases

- One-question sets take the terminal path too, and a pick submits at once (no review page).
- On the last page, and for a lone multi-select question, the multi-select button reads `Submit` but still only opens the review page.
- A press made on a page the terminal has already left types nothing. The deck refreshes and alerts.
- A request closed while a press is reading the screen types nothing.
- While the plugin is still detecting the dialog (`probing`), only Deny acts. *(Built beyond the design.)*
- Refused Terminal access is logged once until Terminal answers again.
- A dialog left in the scrollback is ignored. A wrapped question line is joined.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The terminal path MUST be chosen only when the session's tab (from `Sessions`, matched by `session_id`) runs `claude` and shows this request's dialog within the detect timeout (2 s, polled every 250 ms).
- **FR-002**: "This dialog" MUST mean that the tab bar lists the request's question headers in order with the same kind (single / multi) of question, or, for one question, that the question text is on screen.
- **FR-003**: A request MUST NOT move from the hook path to the terminal path.
- **FR-004**: Before every send, the screen MUST be read again. A send MUST happen only if the screen shows this dialog on the deck's page.
- **FR-005**: The only keys typed MUST be ↑ / ↓ runs (`pressKeys` refuses anything else), plus the Enter that `do script` adds. Typing MUST NOT use digits, ← / → or wrap-around.
- **FR-006**: The highlight position MUST be read from the screen (`❯`), never assumed.
- **FR-007**: Sends MUST be serialised. After a send, the deck MUST refresh from the first changed screen, or from the last screen read within 1 s.
- **FR-008**: On the terminal path, ‹ Back MUST be disabled and the dial MUST NOT change pages.
- **FR-009**: The plugin MUST follow the screen every 1 s while a terminal-path request is on the deck, and stop following otherwise.
- **FR-010**: A terminal-path request MUST fall back to the hook path when its dialog has been gone for longer than the 2 s grace.
- **FR-011**: Deny MUST always answer through the hook.
- **FR-012**: The touch strip MUST show the question with its position and answered-dots. A touch MUST show an option (number, label, description, picked) for 4 s.
- **FR-013**: Question sets with more than four options on a question MUST be left to the terminal, as before.
- **FR-014**: Terminal access errors MUST send the request to the hook path. A press already typed MUST still count.

### Key Entities

- **Dialog state** (`parseDialog`): tabs with answered flags, current page, kind, items with highlight and checks, button, review answers.
- **Request path**: `probing` → `terminal` or `hook`.
- **Deck picks**: the per-page picks the deck sent itself. They are forgotten on a keyboard page change.

### Deck Surface

- **Option 1–4 keys**: pick or toggle. **Allow** (as Next / Submit), **‹ Back** (disabled on the terminal path), **Deny**, **Pending request** status key.
- **Strip (`.strip`)**: question view, option peek, and review list with open questions dashed.

### Claude Code Integration

- **Source**: `PermissionRequest` for `AskUserQuestion` via `/permission`; `PostToolUse` via `/event` releases a request that was submitted in the terminal; statusline registry for the tab.
- **Measured on**: Claude Code 2.1.308.
- **Hooks config change**: none.

### Terminal Interaction

- **Typed**: `ESC[A` / `ESC[B` runs + Enter via `pressKeys`.
- **Precondition**: `tabInfo` read just before shows `claude` running and this dialog on the deck's page.
- **Fixtures**: `test/fixtures/ask-{color,snacks,snacks-other,size,four,one,one-multi,last-multi,review,review-open}.txt`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After each deck press, the terminal and the deck show the same page within one refresh (≤ 1 s).
- **SC-002**: Every Enter that is typed is the user's own action. No send can pick, toggle, decline or cancel anything the user did not press (planner tests).
- **SC-003**: Every case that cannot be planned falls back to the hook path, and the request still gets answered.

## Assumptions

- Terminal.app only.
- Free-text answers ("Type something") and "Chat about this" are out of scope.
- Permission dialogs other than questions still go through the hook.
- A user who forwards the statusline has opted into the Terminal bridge, so macOS may ask for Automation access without a dial on the deck.
