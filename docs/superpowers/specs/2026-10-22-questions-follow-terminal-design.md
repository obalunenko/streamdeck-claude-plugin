# Questions answered through the terminal — design

Date: 2026-10-22 · Branch: `develop` · Claude Code measured: 2.1.308

## Intent

When Claude asks an `AskUserQuestion` with several questions (pages), the
user reads the full question and the option descriptions in the terminal and
presses the answer on the deck, because the deck clips the text. Today the deck
keeps its own pages and answers through the hook once everything is
answered. Meanwhile the terminal dialog stays on the first page, so the text
the user reads belongs to a different question than the one on the deck.

The terminal must show the page the deck is on. The user chose to get there
by having the deck answer **through the terminal dialog**: a deck press is
typed into the dialog, so the terminal shows the result and moves to the next
page itself. The two cannot drift apart.

## Goals

- On a multi-page question set, every deck press that answers (pick a
  single-select option, toggle a multi-select option, Next, Submit) happens in
  the terminal dialog of that session. The terminal page and the deck page
  stay the same.
- Works with the Terminal window in the background and without new macOS
  permissions beyond the Automation access the dial already uses.
- The deck follows the terminal: while a question set is on the deck, the deck
  reads the dialog and shows the terminal's current page and its multi-select
  checks. If the user changes something with the keyboard, the deck shows it.
- When the terminal path is not available, the deck answers through the hook
  exactly as today.

## Non-goals

- Terminals other than Terminal.app.
- Permission dialogs (Bash, Edit, …): unchanged, still answered through the
  hook.
- Free-text answers ("Type something") and "Chat about this" from the deck.
- Question sets with more than four options on a question: still left to the
  terminal, as today.

## Anti-goals (a failure even if it "works")

- Typing into a tab whose screen does not show **this** dialog.
- An Enter that does something the user did not press: picking an option on
  another page, toggling an unrelated checkbox, "Chat about this", "Cancel".
  `do script` always ends with Enter, so every send must be planned so that the
  Enter is the user's action.
- The deck and the terminal showing different pages for longer than one
  refresh.
- Breaking the hook path. If anything in the terminal path is uncertain, fall
  back to the hook.

## Measured facts (2.1.308)

Measured in a throwaway session (`claude --model haiku --settings
'{"disableAllHooks":true}'`) with three questions: Color (single, Red / Green /
Blue), Snacks (multi, Chips / Nuts / Fruit), Size (single, Small / Large). Keys
were sent with `do script "<keys>" in <tab>`. Screens are in the session
scratchpad, `screens/0*.txt`, and become test fixtures. Copy these facts into
CLAUDE.md "Hook behaviour" once built.

1. Escape sequences pass through `do script`: `ESC[B` + Enter moved the
   highlight down and selected (trust dialog, the Size page). `ESC[D ESC[A` +
   Enter applied both arrows, then Enter.
2. Every `do script` ends with Enter, and in this dialog Enter always acts.
   No item takes an Enter without effect, so a page cannot be switched without
   answering something.
3. A digit on a single-select page picks that option and moves to the next
   page at once. The trailing Enter then acts on the next page: it toggled
   Chips on Snacks. **Digits are unusable**; arrows plus the Enter are the pick.
4. Enter on a single-select option picks it and moves to the next page. After
   the last page the dialog shows the review page (fact 9).
5. Multi-select: Enter toggles the highlighted option (`[✔]` / `[ ]`) and the
   page stays. The items are the options, `[ ] Type something`, then `Next`.
   ↓ from "Type something" reaches `Next`; Enter on `Next` goes to the next page.
6. Coming back to an answered page (←), the highlight was on option 1, not on
   the picked option (Green, picked by a digit). Enter then re-picked Red. The
   highlight position must be **read from the screen** (`❯`), never assumed.
7. ↑ on option 1 wraps around. On multi-select it went to "Type something";
   Enter there marked it `[✔]` with no text, and the answer kept only Chips. On
   single-select ↑ then Enter **declined the whole dialog** ("User declined to
   answer questions"). Moves never wrap: only ↓ / ↑ within the options.
8. The tab bar is one line, `←  ☐ Color  ☒ Snacks  ☐ Size  ✔ Submit  →`, with
   ☒ marking an answered question. The current tab is shown by colour only.
   The question line under the tab bar names the page.
9. The review page: `Review your answers`, then `● <question>` / `→ <answer>`
   per question, `Ready to submit your answers?`, `❯ 1. Submit answers` /
   `2. Cancel`. On it, `← ↑` + Enter ended in Cancel (declined).
10. Single-select pages draw `❯ N. <label>` with the description on the next
    line, then `N+1. Type something.`, a rule, `N+2. Chat about this`. The
    footer reads `Enter to select · Tab/Arrow keys to navigate · Esc to cancel`.
    A single-select pick is **not** marked on its page; only the tab bar's ☒
    and the review page show it.
11. A long text sent by `do script` arrives as a paste: its trailing Enter
    became a new line in the prompt instead of submitting. A short arrow
    sequence did not.

12. Five `ESC[B` plus Enter in one `do script` arrive as keys, not as a paste.
    On a four-option multi-select page the highlight went from option 1 to
    `Next`, and the Enter moved to the next page.
13. `Next` with nothing checked moves on and leaves the question open (☐). The
    review page then shows `⚠ You have not answered all questions`, lists only
    the answered questions, and still offers `Submit answers`.
14. A set with one question has a short tab bar, ` ☐ Color `, with no arrows
    and no Submit. Its footer reads `Enter to select · ↑/↓ to navigate · Esc to
    cancel`. A pick submits at once; there is no review page.
15. With the hooks on, the hook's connection to the plugin and the dialog on
    the screen appeared within about 0.15 s of each other, connection first.
16. A terminal Submit and a terminal Cancel each ended the hook's connection
    within 0.05 s.
17. A screen with ❯ on `Next` cannot be captured through `do script`: the
    Enter acts as soon as ❯ gets there.
18. On the last page of a set, and for a set of one multi-select question, the
    multi-select button reads `Submit` (`     Submit` after `Type something`).
    Enter on it opens the review page, also with another question open; it
    never submits at once. A lone multi-select question keeps the full tab bar
    (`←  ☐ Snacks  ✔ Submit  →`) with the `↑/↓ to navigate` footer.

## How it works

### Choosing the path per request

When a deck-sized `AskUserQuestion` request arrives (as `deckQuestions` today):

1. Find the session's tab: the statusline registry (`Sessions`) entry whose
   `sessionId` is the hook's `session_id`. No entry → **hook path**.
2. Read the tab (`tabInfo`) until its screen shows this dialog, with a short
   timeout of about two seconds (builder's call). "This dialog" means the tab
   bar lists the request's question headers in order, or, for a single
   question, the question text is on screen. The tab must also run `claude`.
   No match → **hook path**.
3. Match → **terminal path** for this request. Terminal access refused
   (`TerminalAccessError`) at any point → hook path, logged once.

A request never goes back from the hook path to the terminal path. A
terminal-path request falls back to the hook path when the dialog disappears
from the screen while the request is still open, after a short grace period
that covers the gap between the terminal's submit and `PostToolUse` (my call).
The deck's own record of the picks is kept, so a hook submit sends them.

Single-question sets take the terminal path too (my call). A pick submits them
at once (fact 14), so they still take one press, as today.

The terminal path runs for every session the statusline reports (my call).
Today the plugin touches Terminal only while a dial or a Context Usage action
is on the deck, so macOS never asks for Automation access without one. That
rule cannot hold here: the bundled Claude profile shows no dial. A user who
pipes the statusline to the plugin has opted into the Terminal bridge;
refused access sends the request to the hook path. The comment in `plugin.js`
and the README sentence about that rule are reworded.

### Following the terminal

While the request shown on the deck is on the terminal path, the plugin reads
its tab about once a second (builder's call) and sets from the screen:

- the current page (question line under the tab bar, or the review page);
- multi-select checks on that page;
- answered / open per question (tab bar ☒ / ☐).

Single-select picks are not visible on their page (fact 10). The deck keeps the
ones it sent itself, and forgets them for the page left and the page arrived
at when the terminal changes page without a deck send, since the keyboard may
have changed them, also within one read (my call). It never types from that
memory: Next is off on a single-select page. On the review page the deck takes every pick from the `→ <answer>`
lines. A question answered with the keyboard shows as answered on the status
key, with no option marked.

Polling stops when no terminal-path request is on the deck.

### Deck actions on the terminal path

Before each send the plugin reads the screen again. It sends only when the
screen shows this dialog **and** the page the deck shows. Otherwise it
refreshes the deck from the screen and shows an alert on the key; nothing is
typed. Sends are serialised, one at a time, and the deck is refreshed from the
screen after each.

Every send is ↓ or ↑ repeated from the highlighted item to the target item,
then the Enter that `do script` adds. No wrap-around, no digits, no ← / →:

| Deck press | Page | Target item | Effect of the Enter |
|---|---|---|---|
| option N | single-select | option N | picks N, next page |
| option N | multi-select | option N | toggles N, stays |
| Next | multi-select | `Next` | next page |
| Next | single-select | — | alert, nothing typed: the option key moves on (the deck's memory of a pick can be stale) |
| Submit | review page, every question answered | `Submit answers` | submits; Claude Code runs the tool |
| Submit | review page, a question open (fact 13) | — | alert, nothing typed (as the deck does today) |
| Submit | any other page | — | alert, nothing typed |

- **‹ Back** is disabled and the dial does not move between pages. Both would
  need an Enter that changes an answer (facts 2, 6). The user goes back with
  the keyboard, and the deck follows.
- **Deny** still answers through the hook (`behavior: "deny"`), which closes the
  dialog.
- The strip segments pick options like the option keys.
- When the terminal submits or declines, the open hook request ends as today:
  `PostToolUse` releases it, or the closed connection removes it.

### Hook path

Unchanged from today: the deck keeps its own pages, Back and the dial work,
and the submit sends `updatedInput` with `answers` through the hook.

## Security

- Only ↑ / ↓ escape sequences are ever typed on this path (plus the Enter
  `do script` adds). The terminal module refuses any other text, the same way
  `typeInto` accepts only `/model` / `/effort` with a safe value. Nothing from
  the hook body is typed.
- The target tab comes from the statusline registry, but the plugin types only
  when that tab's screen shows exactly this dialog, read just before the send,
  and the tab runs `claude`.
- No HTTP endpoint triggers a send; sends come only from key presses.

## Constraints

- Node 20, plain Stream Deck WebSocket protocol over `ws`, no Elgato SDK.
- `osascript` by absolute path; everything reaches AppleScript as `argv`.
- Comments and user-facing strings in English.
- Keep the plugin UUID and the existing action UUIDs.
- Raise `Version` in `manifest.json` for local test builds (fourth number).

## Left to the builder

- Module layout. A parser for the dialog screen and a pure key planner (screen
  state + deck press → keys, or nothing) fit a new `src/` module next to
  `terminal.js`, testable with the fixtures.
- Timings: dialog-detect timeout, poll interval, settle after a send.
- How the status key and the strip show "answered from the keyboard".
- The measurements listed above, CLAUDE.md "measured" facts, README note.
- Work on `develop`; commits follow the repo's style.
