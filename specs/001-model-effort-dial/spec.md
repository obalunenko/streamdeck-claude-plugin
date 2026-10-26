# Feature Specification: Model / Effort Dial

**Feature Branch**: `develop` (built before Spec Kit; no feature branch)

**Created**: 2026-10-21 (design) · migrated 2026-10-26

**Status**: migrated

**Input**: Reverse-engineered from `docs/superpowers/specs/2026-10-21-model-effort-dial-design.md`, its plan, `src/tune.js`, `src/terminal.js`, `src/claude-cli.js` and their tests.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Turn a dial to switch model or effort (Priority: P1)

A user with a running Claude Code session in Terminal.app turns a Stream Deck +
dial to change the session's model or reasoning effort without typing
`/model` or `/effort`. The touch strip shows the current value, the pending
value while turning, and the target project.

**Why this priority**: This is the reason the feature exists.

**Independent Test**: `test/tune.test.js` "Tuner sends one command after the dial stops", "step wraps models and clamps effort". On the device, turn the dial and see the statusline change.

**Acceptance Scenarios**:

1. **Given** an idle session in the front tab, **When** the dial is turned and left still for 500 ms, **Then** exactly one `/model <v>` or `/effort <v>` is typed into that tab.
2. **Given** the dial ends on the session's current value, **When** it stops, **Then** nothing is sent.
3. **Given** the model dial, **When** turned past either end, **Then** it wraps around. **Given** the effort dial, **Then** it stops at `low` and at the top level.

---

### User Story 2 - Choose the target session on the deck (Priority: P2)

When the front Terminal tab is not a registered session, pressing the dial or
tapping its strip cycles through registered sessions. Both dials share the choice.

**Why this priority**: Without it, the dial works only while the session's tab is in front.

**Independent Test**: "Tuner falls back to the session chosen on the deck", "Tuner clears the chosen tab when it no longer runs claude".

**Acceptance Scenarios**:

1. **Given** the front tab is a session, **When** the dial is pressed, **Then** it only alerts.
2. **Given** a chosen tab that no longer runs `claude`, **When** the view refreshes, **Then** the choice is cleared and the strip shows `no session`.

---

### User Story 3 - Never type into the wrong place (Priority: P1)

The dial types only when Claude is idle, the input box is free, and the
target has not changed since the first tick.

**Why this priority**: The design names wrong-tab and mid-prompt typing as anti-goals ("a failure even if it works").

**Independent Test**: "Tuner shows busy and drops the value on a blocked screen", "Tuner does not send when the target changed", "Tuner never sends into a dialog opened by the other dial", "Tuner types nothing while the session has a request on the deck".

**Acceptance Scenarios**:

1. **Given** a turn running (between `UserPromptSubmit` and `Stop` / `StopFailure`), **When** the dial stops, **Then** the strip shows `busy` and the value is dropped. An `Interrupted` line ends the turn.
2. **Given** a dialog on screen or a held stash (`› stashed`), **When** the dial stops, **Then** nothing is typed.
3. **Given** a draft in the prompt, **When** a command is sent, **Then** it is stashed with Ctrl+S first and Claude Code restores it afterwards.
4. **Given** a permission or question request of that session on the deck, **When** the dial stops, **Then** nothing is typed. *(Built beyond the design.)*

### Edge Cases

- The model has no effort: the effort dial shows `—` and does nothing.
- `claude --help` cannot be parsed: the effort dial shows `no claude`.
- Terminal Automation is refused: the strip shows `no access`.
- `/model` asks for confirmation mid-conversation: the plugin does not answer it, and the user confirms in the terminal.
- A send fails after typing: the next send waits the settle delay (1 s).
- A new `session_id` on a known tty (`/clear`, `/resume`, restart) replaces the entry.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The action `com.obalunenko.claudeperm.tune` MUST have a setting that chooses `model` or `effort`.
- **FR-002**: Effort levels MUST come from `claude --help`, found by absolute path.
- **FR-003**: Models MUST come from the Property Inspector list. An empty list MUST default to the aliases parsed from `claude --help`.
- **FR-004**: Unsafe or blank model lines MUST be dropped (`SAFE_VALUE`).
- **FR-005**: Rotation MUST update only a pending value, and MUST send once after 500 ms of stillness.
- **FR-006**: The target MUST be the front window's selected tab when it is a registered session. Otherwise it MUST be the tab chosen on the deck. The target MUST be fixed at the first tick.
- **FR-007**: The plugin MUST NOT send when the target changed, a turn is running, the screen lacks the input-box frame at the bottom, a stash is held, or the tab does not run `claude`.
- **FR-008**: The plugin MUST NOT send while that session has a request on the deck.
- **FR-009**: A draft MUST be preserved via Ctrl+S before the command.
- **FR-010**: The only typed text MUST be `/model <v>` or `/effort <v>` with `<v>` matching `SAFE_VALUE`, passed to `osascript` as argv.
- **FR-011**: Sessions MUST be registered from `POST /statusline` with `X-Claude-TTY` (`ttysNNN`), keeping only string fields. `SessionEnd` MUST remove a session.
- **FR-012**: Busy state MUST come from `UserPromptSubmit` → `Stop` / `StopFailure` (`hooks.json`).
- **FR-013**: The strip MUST show `no session`, `busy`, `no claude`, `no access`, and `—` where applicable.
- **FR-014**: Sends MUST be serialised, and each MUST wait a 1 s settle so that a dialog it opens is seen by the next send.

### Key Entities

- **Session**: `session_id`, tty, cwd, model id / name, effort level, context percentage, last seen. The key is the tty, and the latest session on a tty wins.
- **Chosen tab**: a tty shared by all dials. It survives `/clear` and `/resume`.
- **Pending value**: a per-dial value that is sent once the dial is still.

### Deck Surface

- **Model / Effort (`.tune`)**: encoder with a 200×100 strip segment. The top line is `Model` / `Effort`, the middle is the value (highlighted while pending) and the bottom is the project, with a `(chosen)` suffix for a deck-chosen session. Rotate changes the value. Push or touch cycles sessions. The Property Inspector is `pi/tune.html`. The action is not in the bundled Claude profile.

### Claude Code Integration

- **Source**: statusline JSON (`model`, `effort.level`, `cwd`, `session_id`), the hooks `UserPromptSubmit`, `Stop`, `StopFailure` and `SessionEnd` via `/event`, and `claude --help`.
- **Measured on**: Claude Code 2.1.306.
- **Hooks config change**: added `StopFailure`. The statusline forwards its JSON to `/statusline` (README snippet).

### Terminal Interaction

- **Typed**: an optional Ctrl+S, then `/model <v>` or `/effort <v>`, then Enter (`do script … in <tab>`). The tab is found by tty and is not raised.
- **Precondition**: `tabInfo` shows `claude` in the processes, the input-box frame at the bottom, no dialog and no stash line.
- **Fixtures**: `test/fixtures/screen-{idle,idle-placeholder,typing,typing-multiline,streaming,dialog,interrupted,stashed,model-confirm}.txt`, `claude-help.txt`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: One dial gesture produces at most one typed command.
- **SC-002**: No command is typed into a tab whose screen shows a dialog, a stash or a running turn (covered by the tune and terminal tests).
- **SC-003**: The strip shows the new value on the next statusline report after a send.

## Assumptions

- Terminal.app only, not iTerm2, Ghostty or tmux.
- The user's statusline forwards its JSON to the plugin. The plugin never edits user settings.
- `/effort` saving the level as the model default under `modelSettings` is accepted Claude Code behaviour.
- Same-window tab selection by `do script` was **not measured** (design fact 13).
