<!--
Sync Impact Report
- Version: 1.0.1 → 1.0.2 (PATCH: the HTTP server lives in src/server.js)
- Previous: 1.0.0 → 1.0.1 (commit rule names its source); template → 1.0.0 (first ratification, from /speckit-brownfield-bootstrap)
- Principles: all seven new, each traced to CLAUDE.md or the code
- Templates updated: spec-template.md, plan-template.md, tasks-template.md
- Deferred: none
-->

# streamdeck-claude-plugin Constitution

A Stream Deck plugin (UUID `com.obalunenko.claudeperm`) that answers Claude Code
from the deck: permission requests, `AskUserQuestion` prompts, a Model / Effort
dial and a Usage meter. A single Node 20 process (CommonJS, JavaScript) on
macOS. It talks to Stream Deck over the plain WebSocket protocol, to Claude
Code hooks over HTTP on `127.0.0.1:47823`, and to Terminal.app through
`osascript`.

## Core Principles

### I. Decisions Come Only From the Deck (NON-NEGOTIABLE)

- A permission or question is decided only by a key press or dial action on
  the device. The HTTP server MUST NOT expose any endpoint that decides a
  request.
- The server MUST reject every request carrying an `Origin` header
  (`src/server.js`). Browsers always send one; hooks (`curl`) never do.
- **Never send more than the key shows.** `Always` sends exactly the one
  suggestion it labels, never the whole `permission_suggestions` array.
- An empty 200 releases a request without deciding it. That is the only
  fallback, and it hands the dialog back to Claude Code.

### II. Only the Plugin's Own Values Are Typed (NON-NEGOTIABLE)

- Text typed into a terminal is limited to `/model <v>` / `/effort <v>`, where
  `<v>` comes from `claude --help` or the dial's list and matches `SAFE_VALUE`
  (`src/terminal.js`). It is passed to `osascript` as argv, never spliced
  into script source.
- Into a question dialog, only ↑ / ↓ runs and Enter are typed. This happens
  only while that tab's screen, read just before, shows this request's
  dialog on the deck's page.
- Binaries (`claude`, `osascript`, `open`) are called by absolute path, because
  Stream Deck starts the plugin without the shell's PATH.

### III. Measured, Not Assumed

- Claude Code and Terminal.app behaviour that the plugin relies on MUST be
  measured on a real session. It MUST be recorded in CLAUDE.md under the
  Claude Code version it was measured on.
- Every screen state the code parses MUST have a captured fixture in
  `test/fixtures/` (`screen-*.txt`, `ask-*.txt`, `claude-help.txt`), and a
  test that reads it.
- After a Claude Code upgrade, re-measure before relying on recorded
  behaviour.

### IV. Pure Helpers, Injected I/O, a Test per Module

- Parsers, planners and view builders are pure functions or classes with
  their I/O injected (the Tuner and the Asker receive the Terminal bridge),
  so they run under `node --test` without a terminal, a deck or a network.
- Each `src/<module>.js` with logic has a `test/<module>.test.js` that uses
  `node:test` and `node:assert/strict`.
- `src/plugin.js` is the wiring point. It alone owns the WebSocket, the
  request queue and the HTTP server, which it starts from `src/server.js`'s
  `createServer` with its handlers. Other modules MUST NOT require `plugin.js`,
  and they MAY require the pure leaf `src/terminal.js`.

### V. Minimal Runtime, Single Bundle

- Runtime: Node 20 (the version Stream Deck ships), CommonJS `require` with
  `node:`-prefixed built-ins, and macOS only.
- The only runtime dependency is `ws`. The Elgato SDK is not used. Adding a
  runtime dependency needs a justification in the plan's Complexity
  Tracking. Dev tools (esbuild) are pinned exactly.
- esbuild bundles everything into
  `com.obalunenko.claudeperm.sdPlugin/bin/plugin.js`. Build output is never
  committed.
- Property Inspectors are plain HTML in `com.obalunenko.claudeperm.sdPlugin/pi/`
  with no SDK.

### VI. Stable Identity and Versioning

- The plugin UUID `com.obalunenko.claudeperm` MUST NOT change, because the
  installed profile and the keys on the device are bound to it.
- Releases are `X.Y.Z.0` from a `vX.Y.Z` tag, set by CI. Local builds raise
  only the fourth number of `manifest.json` `Version`, because Stream Deck
  never installs a version that is not higher.
- Profile switching happens only when `Claude.streamDeckProfile` ships with
  the plugin.
- Updates come from public GitHub releases with an unauthenticated `fetch`. A
  failed check is only logged.

### VII. Plain, English, Matching the Surroundings

- Comments and user-facing strings are in English.
- Source files are kebab-case `.js`. Each module opens with a header comment
  that states its role. Constants are `UPPER_CASE`.
- New code matches the surrounding code's comment density, naming and idiom.
  No linter or formatter is configured, so review enforces this.

## Quality Gates

- `task check` (`npm test` plus the Spec Kit update-checker tests) MUST pass
  before a change merges. CI (`.github/workflows/ci.yml`) runs the same suites
  and `npm run package` on every push and pull request.
- A change to parsing of a terminal screen or to hook handling MUST come with a
  fixture and a test (Principle III).
- A change that alters measured behaviour MUST update CLAUDE.md in the same
  change.

## Development Workflow

- `master` is the default branch and `develop` the working branch.
  Feature specs live in `specs/NNN-feature-name/` (sequential numbering via the
  `feature-numbering` extension).
- Commit subjects use Conventional Commit prefixes, because
  `scripts/release-notes.sh` relies on them: it leaves `docs:`, `chore:` and
  `test:` commits out of the release notes.
- Before installing a local build: `task package`, then raise the manifest
  version's fourth number.

## Governance

This constitution supersedes ad-hoc practice. CLAUDE.md stays the runtime
guidance and the record of measured behaviour, and the two MUST NOT
contradict each other. Plans MUST pass the Constitution Check, and every
violation MUST be justified in Complexity Tracking. Amendments bump the
version: MAJOR when a principle is removed or redefined, MINOR when one is
added or materially expanded, PATCH for wording.

**Version**: 1.0.2 | **Ratified**: 2026-10-26 | **Last Amended**: 2026-10-26
