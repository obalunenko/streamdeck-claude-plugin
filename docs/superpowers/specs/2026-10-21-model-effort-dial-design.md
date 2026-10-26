# Model and effort dial — design

Date: 2026-10-21 · Branch: `develop` · Claude Code measured: 2.1.306

## Intent

Switch the model and the reasoning effort of a **running** Claude Code session
from a Stream Deck + dial, without going to the terminal and typing `/model` or
`/effort`. One dial turns through models, another through effort levels; the
touch strip above it shows the current value and which session it goes to.

## Goals

- A new encoder action, **Model / Effort**. Its settings (Property Inspector)
  choose what this dial changes: `model` or `effort`. Two instances side by
  side give one dial for each.
- Rotating changes the value in the running session; no restart.
- The strip shows the session's real current value (from Claude Code) and the
  target session (project folder name).
- Lists come from Claude Code where it offers them; nothing hardcoded that
  Claude Code can tell us.

## Non-goals

- Terminals other than Terminal.app (iTerm2, Ghostty, kitty, WezTerm, tmux).
- Changing defaults for new sessions on purpose (see `/effort` below — it does
  that as a side effect, and we accept Claude Code's behaviour).
- Fast mode, ultracode, thinking toggles, permission mode.
- Putting the action into the bundled **Claude** profile. That profile replaces
  the deck while a hook request waits, so the dial is unavailable exactly then —
  which is what the user wants.

## Anti-goals (a failure even if it "works")

- Typing into the wrong tab, or into a prompt the user is half-way through.
- Sending a command per rotation tick while the user scrolls through the list.
- Typing anything that did not come from the plugin's own list
  (see Security).

## Measured facts (2.1.306)

Recorded here because the design rests on them; re-check after upgrades and copy
into CLAUDE.md "Hook behaviour" once built.

1. Editing `model` / `effortLevel` in a settings file does **not** reach a
   running session (tested: a live session kept Sonnet / high after the file
   said haiku / low). Docs agree: these keys are read once at start.
2. Typing `/model opus` + Enter and `/effort medium` + Enter into the session's
   tty changes it at once; the statusline JSON shows the new `model.id` and
   `effort.level` on the next render.
3. `/effort <level>` also saves the level as the default for the current model
   under `modelSettings` in `~/.claude/settings.json`.
4. No hook output can set model or effort (`PreModelSwitch` can only block).
5. Terminal.app AppleScript: each tab has `tty`; `do script "<text>" in <tab>`
   types the text plus Enter into the running program in that tab (tested:
   a prompt sent this way was submitted and answered). `history` of the tab
   returns its screen text, also with the fullscreen TUI. `busy` is always true
   while `claude` runs, so it is useless. `do script … in <tab>` into a
   **background window** delivers the text and does not raise it (tested with
   two windows running `cat`: the front window stayed in front).
6. The statusline command receives JSON with `session_id`, `cwd`,
   `model.{id,display_name}`, `effort.level` (absent when the model has no
   effort), `transcript_path`, `version`, …
7. `claude --help` lists effort levels: `--effort <level> … (low, medium, high,
   xhigh, max)`. It names model aliases only as examples (`'fable', 'opus', or
   'sonnet'`). Claude Code has **no** command or JSON that lists models; the
   `/model` picker is interactive only.

8. **The screen cannot tell busy from idle.** While a reply streams, the bottom
   of `history` is the same as when idle (`─── / ❯ / ─── / status`); the spinner
   does not show in the text. A command typed then is **queued** (`Press up to
   edit queued messages`). Busy comes from hooks: `UserPromptSubmit` starts a
   turn, `Stop` ends it. **Esc does not fire `Stop`** (neither on a reply nor on
   a permission dialog); the screen then shows `⎿  Interrupted · What should
   Claude do instead?` as the last line above the input box.
9. **Typed text and Claude's grey suggestions look the same** in `history`
   (`❯ hello draft` vs `❯ Write another story…`, `❯ Try "how does <filepath>
   work?"` in a fresh session); no colour, no extra hint for one-line text.
10. **Ctrl+S (`chat:stash`)**: non-empty input → stashed and cleared; empty
    input with a stash → the stash is popped back; empty input, no stash →
    nothing. Grey suggestions are not input. After a submit the stash comes
    back by itself. Tested: draft `hello draft`, then Ctrl+S + `/model sonnet` +
    Enter → the command ran, the draft came back. A held stash shows a
    persistent `› stashed` line just above the input box.
11. **`/model` mid-conversation shows a confirmation** with `❯ 1. Yes, switch to
    <Model>` highlighted and `2. No, go back`; a second Enter would confirm
    it. Dialogs (this one, permission prompts) replace the input box: the
    bottom of the screen no longer has the `─── / ❯ / ───` frame.
12. The statusline command's `$PPID` is `claude` itself (`ps -o tty= -p $PPID`
    → `ttys006`); hook commands likewise. The statusline process has no tty.
13. Same-window tab selection by `do script` could not be measured (creating a
    tab needs keystrokes macOS refused); the send restores the previously
    selected tab in any case.

Fixtures of these screens live in `test/fixtures/screen-*.txt`.

## How it works

### Sessions registry

The plugin keeps `sessions: Map<session_id, {tty, cwd, model, modelName, effort, seen}>`.

- **Statusline → `POST /statusline`.** The user's statusline script forwards
  its stdin JSON to the plugin, with the tty of its `claude` ancestor in a
  header (e.g. `X-Claude-TTY: ttys005`). Async, `-m 1`, failures ignored, so a
  stopped Stream Deck never slows the statusline. This is the source of current
  model and effort, refreshed on every render.
- **Hooks.** `SessionEnd` (already POSTed to `/event`) removes the session.
  `UserPromptSubmit` and `Stop` (already POSTed) mark the turn busy / idle;
  `StopFailure` is added to `hooks.json` for the same reason.
- Liveness is "the tab with this tty still runs `claude`", checked when the
  dial is used — not a timeout: the statusline may stay quiet while a session
  idles, and idle sessions are exactly the ones the plugin can send to.
- A new `session_id` on a known tty (after `/clear`, `/resume` or a restarted
  `claude` in the same tab) replaces the old entry for that tty.

The README documents the one line to add to an existing statusline script and
a minimal statusline command for users who have none. The plugin never edits
the user's settings or scripts.

### Target session — "front tab, else chosen on the deck"

Decided by the user (option 1 with fallback to option 3):

1. Ask Terminal for the selected tab of the front window. If its tty belongs to
   a registered session, that is the target. The strip shows
   `<value> → <project>`. This holds **even when Terminal is not the active
   app** (decided by the user): with an editor in front, the dial still goes
   to the Terminal tab last in front; the strip makes the target visible.
2. Otherwise the target is the session **chosen on the deck**. Pressing the dial
   (or tapping its strip segment) cycles through registered sessions; the
   choice is shared by both dials. The strip shows `<value> → <project> (chosen)`.
3. The choice is a **Terminal tab** (tty), not a `session_id` (my call): it
   survives `/clear`, `/resume` and restarting `claude` in that tab, which is
   still the tab the user picked. When the tab no longer runs `claude`, the
   choice is cleared: the strip shows `no session` and rotating sends nothing.
   No silent jump to another tab.
4. The target is fixed at the first rotation tick; if it differs at send time
   (the user switched tabs meanwhile), nothing is sent.

Pressing while the front tab is a Claude session does nothing visible but an
alert (my call; avoids a hidden choice that only matters later).

### Values

- **Effort levels:** parsed from `claude --help` at plugin start (absolute path:
  `~/.local/bin/claude`, then the usual install locations — Stream Deck starts
  the plugin without the shell's PATH, same as glab). If parsing fails, the
  effort dial shows `no claude` and does nothing.
- **Models:** an editable list in the dial's Property Inspector, one alias or
  full model name per line. Default: the aliases parsed from `claude --help`
  (`fable`, `opus`, `sonnet` today). My call: Claude Code offers no list, and
  the user can add `haiku`, `opus[1m]`, `opusplan`, full IDs, etc. The list
  belongs to the dial instance (its action settings).
- When the session reports no effort (the model has none), the effort dial
  shows `—` and does nothing.
- Model wraps around at the ends; effort stops at `low` and at the top
  (my call: it is a scale).
- The starting point of a rotation is the session's current value from the
  statusline (matched by alias or ID where possible; otherwise the first item).

### Sending

- Rotation updates a **pending** value on the strip only. When the dial has been
  still for ~500 ms, the plugin sends once.
- Before sending, it checks that Claude is idle and the prompt is free.
  Otherwise the strip shows `busy` for a moment and the pending value is
  dropped (my call: no queue; the user turns again). Two sources:
  - **Turn state from hooks** (fact 8): a session is busy from
    `UserPromptSubmit` until `Stop` / `StopFailure`, or until its screen shows
    the `Interrupted` line as the last line above the input box.
  - **Screen** (`history`): a positive match on the input-box frame at the
    bottom; no frame (a dialog: permission prompt, question, the `/model`
    confirmation — `do script` always sends Enter, which would answer it) or a
    `› stashed` line above it reads as busy.
- A draft in the prompt is kept by stashing it: the typed text is Ctrl+S, then
  the command, then Enter (fact 10). Claude Code brings the draft back after
  the command. A held stash blocks the send, because Ctrl+S would pop it
  into the command.
- It also checks that the target tab still has that tty and runs `claude`
  (`processes` of the tab).
- The command is `/model <item>` or `/effort <level>`, sent with
  `osascript` → `tell application "Terminal" to do script ((character id 19)
  & "…") in <tab>`, the tab found by tty; the previously selected tab of that
  window is selected again afterwards.
- If Claude shows a confirmation for the model switch, the plugin does not
  answer it; the user confirms in the terminal (my call). The strip goes back
  to the real value on the next statusline report.
- macOS asks once to let Stream Deck control Terminal (Automation). A denial
  shows `no access` on the strip; README explains where to allow it.

### Strip rendering

One 200×100 segment per dial (not the 800-pixel spread used by **Strip**):
the line on top is what the dial changes (`Model` / `Effort`), the value large
in the middle (pending value highlighted while turning), the target project at
the bottom. States: `no session`, `busy`, `no claude`, `no access`.

## Security

- Only values from the plugin's own lists are typed: effort levels from
  `claude --help`, models from the Property Inspector. Nothing from an HTTP
  body is ever typed. Items are checked against a strict pattern
  (`^[A-Za-z0-9._\[\]-]+$`) before they go into the AppleScript string.
- The HTTP server keeps rejecting requests with an `Origin` header.
  `/statusline` only reports state; a spoofed report can at most point the
  registry at another tab, and the plugin still types only into a Terminal tab
  whose processes include `claude`.
- No endpoint triggers a send; sends come only from dial rotation.

## Constraints

- Node 20, plain Stream Deck WebSocket protocol over `ws`, no Elgato SDK — the
  Property Inspector is plain HTML/JS using `connectElgatoStreamDeckSocket`.
  It is the first Property Inspector in the repo.
- Keep the plugin UUID; the new action gets a new action UUID
  (`com.obalunenko.claudeperm.tune` or similar).
- Comments and user-facing strings in English.
- Binaries by absolute path (`osascript`, `claude`).
- Raise `Version` in `manifest.json` for local test builds (fourth number).

## Left to the builder

- Code structure (a separate `src/tune.js` next to `update.js` fits the repo).
- The busy / input-not-empty markers, measured on the real screen.
- Debounce and stale-session timings.
- Icon for the action (`scripts/icons.sh`).
- README section, CLAUDE.md "measured" facts, `hooks.json` change if needed.
- Work on `develop`; commits follow the repo's style.
