# Implementation Plan: Model / Effort Dial

**Branch**: `develop` | **Date**: 2026-10-21 (built) · migrated 2026-10-26 | **Spec**: [spec.md](spec.md)

**Status**: migrated. The plan as executed is `docs/superpowers/plans/2026-10-21-model-effort-dial.md`.

## Summary

The statusline reports each session's model, effort and tty. The Tuner turns
dial rotation into one debounced `/model` or `/effort` command. It types the
command into the session's Terminal.app tab through `osascript do script`, after
checking turn state (hooks) and screen state (`history`).

## Technical Context

**Language/Version**: JavaScript, Node 20, CommonJS

**Primary Dependencies**: `ws`; esbuild

**Storage**: per-dial action settings (`kind`, `models`); in-memory session registry

**Testing**: `node --test`, using a fake terminal and fake timers in `test/tune.test.js`, and screen fixtures

**Target Platform**: macOS, Stream Deck +, Terminal.app

**Project Type**: Stream Deck plugin

**Claude Code Version Measured On**: 2.1.306

**Performance Goals**: 500 ms debounce; 1 s settle after a send; 2 s front-tab refresh outside dial use; 2 s notice

**Constraints**: absolute paths for `claude` (`~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin`) and `/usr/bin/osascript`; `osascript` timeout 5 s

**Scale/Scope**: 3 modules, 1 action, 1 Property Inspector, 10 fixtures

## Constitution Check

- [x] **I.** No endpoint sends. `/statusline` only reports state.
- [x] **II.** `commandText` and `typeInto` accept only `/model|/effort <SAFE_VALUE>`. The value is passed as argv after a `tabInfo` read.
- [x] **III.** The facts were measured on 2.1.306 and are recorded in CLAUDE.md, with fixtures in `test/fixtures/screen-*.txt`.
- [x] **IV.** `tune.js` gets the Terminal bridge injected. `claude-cli`, `terminal` and `tune` each have a test suite.
- [x] **V.** No new runtime dependency.
- [x] **VI.** New action UUID `.tune`; the plugin UUID is unchanged.
- [x] **VII.** Header comments and English strings.

## Project Structure

```text
src/
├── claude-cli.js    (new)      findClaude, readHelp, parseEffortLevels, parseModelAliases
├── terminal.js      (new)      frontTab, tabInfo, typeInto, screenState, interrupted, commandText, SAFE_VALUE
├── tune.js          (new)      Sessions, Tuner, parseModelList, matchModel, step
└── plugin.js        (modified) /statusline endpoint, tune action, strip rendering

test/
├── claude-cli.test.js, terminal.test.js, tune.test.js  (new)
└── fixtures/screen-*.txt, claude-help.txt              (new)

com.obalunenko.claudeperm.sdPlugin/
├── manifest.json    (modified) action .tune, Encoder, layout $A0
└── pi/tune.html     (new)      first Property Inspector, plain connectElgatoStreamDeckSocket

hooks.json           (modified) StopFailure
scripts/icons.sh     (modified) tune icon
```

**Structure Decision**: the pure parts (`claude-cli`, `terminal` helpers, `tune`) are separate modules. `plugin.js` only wires them to the WebSocket and HTTP.

## Deviations from the Design

- The Tuner also refuses to type while that session has a request on the deck. This was added with feature 002.
- The send queue waits a 1 s settle after a typed command, so a `/model` confirmation is seen by the next send.
- `Sessions` also keeps `context_window.used_percentage` and offers `latest()` for feature 003.

## Complexity Tracking

None.
