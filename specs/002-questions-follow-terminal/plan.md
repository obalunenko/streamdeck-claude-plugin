# Implementation Plan: Questions Answered Through the Terminal

**Branch**: `develop` | **Date**: 2026-10-22 (built) · migrated 2026-10-26 | **Spec**: [spec.md](spec.md)

**Status**: migrated. The plan as executed is `docs/superpowers/plans/2026-10-22-questions-follow-terminal.md`.

## Summary

`src/ask.js` parses the `AskUserQuestion` dialog from the tab's `history` and
matches it to the request. A pure planner turns a deck press plus the screen
state into an ↑ / ↓ run, or into nothing. The `Asker` attaches a request to
the terminal path, follows the screen, and sends planned keys through
`pressKeys`. Any doubt sends the request back to the unchanged hook path.

## Technical Context

**Language/Version**: JavaScript, Node 20, CommonJS

**Primary Dependencies**: `ws`; esbuild

**Storage**: in-memory request state (`path`, picks, last screen)

**Testing**: `node --test`, using `ask-*` fixtures, a fake terminal and fake timers

**Target Platform**: macOS, Stream Deck (keys + optional Stream Deck + strip), Terminal.app

**Project Type**: Stream Deck plugin

**Claude Code Version Measured On**: 2.1.308

**Performance Goals**: detect for 2 s at 250 ms; settle for 1 s at 100 ms; follow every 1 s; 2 s grace before falling back to the hook

**Constraints**: only arrow runs typed; screen re-read before every send; serialised sends

**Scale/Scope**: 2 modules (ask, strip) + `pressKeys`; 10 fixtures; 51 tests

## Constitution Check

- [x] **I.** Presses come only from the deck. Deny stays on the hook. No new endpoint.
- [x] **II.** `pressKeys` refuses anything but `(ESC[A|ESC[B])*` and a `ttysNNN`. The screen is read just before each send.
- [x] **III.** 18 facts measured on 2.1.308 and recorded in CLAUDE.md, with fixtures in `test/fixtures/ask-*.txt`.
- [x] **IV.** `parseDialog`, `matches`, `pageOf` and `planPress` are pure. `Asker` gets the terminal and timers injected.
- [x] **V.** No new dependency.
- [x] **VI.** Existing action UUIDs are kept.
- [x] **VII.** Header comments and English strings.

## Project Structure

```text
src/
├── ask.js        (new)      parseDialog, matches, pageOf, planPress, Asker
├── strip.js      (new)      dots, stripView, Peek (touch strip of a question)
├── terminal.js   (modified) pressKeys, KEY_UP / KEY_DOWN
└── plugin.js     (modified) path per request (probing / terminal / hook), follow loop, key gating

test/
├── ask.test.js, strip.test.js  (new)
├── terminal.test.js            (modified) pressKeys refusals
└── fixtures/ask-*.txt          (new)
```

**Structure Decision**: dialog parsing and key planning live apart from `terminal.js`, which stays the only module that talks to `osascript`.

## Deviations from the Design

- A `probing` state while the dialog is being detected. In it, only Deny acts.
- The Tuner (feature 001) types nothing while a request of its session is on the deck.

## Complexity Tracking

None.
