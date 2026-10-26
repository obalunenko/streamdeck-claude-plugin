# Feature Specification: Usage Meter

**Feature Branch**: `develop` (built before Spec Kit; no feature branch)

**Created**: 2026-10-22 (design) · migrated 2026-10-26

**Status**: migrated

**Input**: Reverse-engineered from `docs/superpowers/specs/2026-10-22-usage-meter-design.md` (removed after migration; in git history), its plan, `src/usage.js`, the Usage rendering in `src/plugin.js`, and `test/usage.test.js`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See how full the context is (Priority: P1)

A key or dial shows the target session's context fill as a green, yellow or
red scale, with the project folder underneath. The user knows when to run
`/compact` without reading the statusline.

**Why this priority**: Context fill is the value that changes most within a session.

**Independent Test**: "level switches at 75 and above 85 on the rounded value", "usageView shows no session, no data and the project for context".

**Acceptance Scenarios**:

1. **Given** a session reporting 80 % context, **When** the key renders, **Then** it fills 80 % from the bottom in yellow and shows the project.
2. **Given** no target session, **When** the key renders, **Then** it shows `no session`. **Given** a `null` percentage, **Then** it shows `—` and `no data`.

---

### User Story 2 - See plan limits that never lie about a reset (Priority: P1)

A key or dial shows the 5h, 7d or model-scoped weekly limit with a countdown to
the reset. Readings from every session's statusline and from the cache file
are merged, so an idle session's old report cannot hide current usage.

**Why this priority**: The design's anti-goal is showing a stale number as if it were current.

**Independent Test**: the `Limits` tests (later window, higher within a window, earlier window ignored, passed reset shows 0).

**Acceptance Scenarios**:

1. **Given** a held 90 % for the current window, **When** an idle session reports 10 % for the previous window, **Then** the key stays at 90 %.
2. **Given** a held value whose reset has passed, **When** the key renders, **Then** it shows `0 %` with no countdown until a reading of the new window arrives.
3. **Given** the cache file's `weekly_scoped` entry, **When** shown, **Then** the label is `<display_name> 7d`. Without a name the label is `Model 7d`.

---

### User Story 3 - Switch between metrics (Priority: P2)

The Property Inspector picks any of Context, 5h, 7d and the scoped limit (at
least one). On a dial, rotation moves through the picked metrics, and push or
touch moves forward. On a key, a press moves forward. The metric shown
survives a restart.

**Why this priority**: One action covers all metrics. Several actions show several metrics at once.

**Independent Test**: "parseMetrics keeps known ids in fixed order and defaults to all", "cycle wraps both ways", "shownMetric falls back to the first picked".

**Acceptance Scenarios**:

1. **Given** three picked metrics, **When** the dial is turned by −1 from the first, **Then** it shows the third.
2. **Given** one picked metric, **When** the key is pressed, **Then** nothing changes.

### Edge Cases

- An API-key login has no `rate_limits`: 5h and 7d show `no data` until the cache file has them.
- A missing or unreadable cache file adds nothing and fails silently.
- A reading without `resets_at` counts only when nothing is held yet.
- A model change in the scoped limit replaces the held value.
- Percentages are clamped to 0–100 for drawing, and thresholds apply to the rounded number, so 85 % is not red.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The action `com.obalunenko.claudeperm.usage` MUST work on a key (`Keypad`) and on a dial (`Encoder`, layout `$A0`, full canvas).
- **FR-002**: Settings MUST pick metrics among `context`, `five_hour`, `seven_day` and `scoped`, in that fixed order. The default is all four, and the last checked box MUST NOT be uncheckable.
- **FR-003**: Colour MUST be green below 75, yellow from 75 to 85 inclusive, and red above 85, on the rounded percentage.
- **FR-004**: Context MUST come from the target session: the front tab, else the chosen tab, else the most recent session.
- **FR-005**: 5h / 7d MUST be merged from every statusline report and the cache file. A later window replaces the held value. Within the same window (resets less than 10 min apart), the higher value wins. An earlier window is ignored.
- **FR-006**: The scoped limit MUST come from the first `limits[kind=weekly_scoped]` entry of `~/.claude/cache/oauth-usage.json`.
- **FR-007**: A held value whose reset has passed MUST show 0 % with no countdown.
- **FR-008**: The countdown format MUST be `↻ 45m`, `↻ 1h12m` or `↻ 2d 3h`.
- **FR-009**: The cache file MUST be read when a Usage action appears and every 60 s while one shows a limit. The plugin MUST only read it.
- **FR-010**: The front-tab lookup MUST run only while a Usage action with Context picked, or a Model / Effort dial, is on the deck (`wantsContext`).
- **FR-011**: The key MUST fill from the bottom in the level colour. The dial MUST show a bar, position dots (when more than one metric is picked), the value and the bottom line.
- **FR-012**: Statusline numbers MUST be checked with `Number.isFinite`, and strings MUST be escaped when drawn.

### Key Entities

- **Reading**: metric, percent, `resetsAt` (ms) or none, and a label for the scoped limit.
- **Limits**: one held reading per limit, folded by window.
- **Metric selection**: the picked ids plus the shown id, saved in action settings.

### Deck Surface

- **Usage (`.usage`)**: a 144×144 key with a bottom-up fill, label on top, large percent and a small bottom line. A 200×100 dial segment with label, dots, percent, right-aligned bottom line and a rounded bar. Property Inspector `pi/usage.html`. Not in the bundled Claude profile.

### Claude Code Integration

- **Source**: statusline `context_window.used_percentage` and `rate_limits.{five_hour,seven_day}.{used_percentage,resets_at}` (Unix seconds); `oauth-usage.json` `five_hour` / `seven_day` `.utilization` and `limits[weekly_scoped]` (ISO `resets_at`).
- **Measured on**: Claude Code 2.1.306, on the user's machine.
- **Hooks config change**: none.

### Terminal Interaction

- None typed. Only the front-tab lookup runs, under FR-010.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A limit whose window has reset never shows red.
- **SC-002**: A Usage action that shows only limits never triggers a Terminal Automation prompt.
- **SC-003**: The threshold boundaries 74 / 75 / 85 / 86 render green / yellow / yellow / red.

## Assumptions

- The user's statusline writes `oauth-usage.json`. The plugin never calls the OAuth API or touches the Keychain.
- Credits and extra-usage, several scoped limits, history and notifications are out of scope.
- The label text in the code is `Model 7d` until the cache file names the model. The design called it "Fable 7d".
