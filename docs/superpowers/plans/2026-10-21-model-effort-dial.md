# Model and Effort Dial Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Stream Deck + encoder action that changes the model or the effort of a running Claude Code session by typing `/model …` / `/effort …` into its Terminal.app tab.

**Architecture:** The user's statusline forwards its JSON and its `claude` tty to a new `/statusline` endpoint; a `Sessions` registry keeps the current model and effort per tty. A `Tuner` turns dial rotation into a debounced pending value, resolves the target tab (front Terminal tab, else the one chosen on the deck), checks the tab's screen is idle and types the command through `osascript`. `plugin.js` routes dial events by action and renders the strip.

**Tech Stack:** Node 20, `ws`, esbuild, `node:test` (built in, no new dependencies), AppleScript via `/usr/bin/osascript`, plain HTML Property Inspector.

**Spec:** `docs/superpowers/specs/2026-10-21-model-effort-dial-design.md`

## Global Constraints

- Node 20 runtime (Stream Deck's), plain Stream Deck WebSocket protocol over `ws`, no Elgato SDK; no new npm dependencies.
- Keep plugin UUID `com.obalunenko.claudeperm`; new action UUID `com.obalunenko.claudeperm.tune`.
- Terminal.app only. Binaries by absolute path: `/usr/bin/osascript`; `claude` from `~/.local/bin/claude`, `/opt/homebrew/bin/claude`, `/usr/local/bin/claude`, `~/.claude/local/claude` (first that exists).
- Only values matching `^[A-Za-z0-9._\[\]-]+$` are ever typed, and only as `/model <v>` or `/effort <v>`. Nothing from an HTTP body is typed. The text reaches AppleScript as an `argv` item, never spliced into script source.
- HTTP server keeps rejecting any request with an `Origin` header; no endpoint triggers a send.
- Debounce 500 ms; `busy` notice 2 s; front-tab lookup throttled to once per 2 s outside dial use.
- Model list wraps; effort clamps at both ends.
- Comments and user-facing strings in English. Strip notices exactly: `no session`, `busy`, `no claude`, `no access`, `—`.
- Commits: plain imperative subjects for features (`Change model and effort from a dial`), `test:` / `docs:` prefixes for test-only / doc-only commits (release notes drop those). End with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Work on branch `develop`.

## Review Focus

1. **A dialog on screen** (permission prompt, `AskUserQuestion`, plan approval, the `/model` "history will be re-read" confirmation caused by the previous turn) — `do script` always sends Enter, which would pick the highlighted option and decide a request outside a key press. `screenState` is a positive match on the input-box frame: anything else reads `blocked`. Test: `screenState never reads a dialog or a held stash as ready` (Task 3).
2. **Plugin restarted while sessions run** — registry is empty until each session's statusline renders again; the dial shows `no session` for the front tab instead of guessing. Test: `Tuner view shows no session for an unregistered front tab` (Task 4).
3. **Model list with blank lines, spaces, quotes or `;`** — bad lines are dropped, never typed. Test: `parseModelList drops blank and unsafe lines` (Task 4) and `commandText rejects unsafe values` (Task 3).
4. **Tab switched between the first tick and the send, or while all sessions are quiet** — nothing is sent to the old tab, and the strip follows the new front tab within 2 s without a turn. Tests: `Tuner does not send when the target changed`, `Tuner view follows a front-tab change without rotation` (Task 4).
5. **Session model not in the list** (e.g. `claude-opus-5` with list `fable, sonnet`) — first tick lands on the first item. Test: `step from unknown lands on the first item` (Task 4).

Also covered by tests, lower risk: effort dial on a model without effort shows `—` (`Tuner effort dial without effort shows dash`).

## Execution note

Task 1 runs in the **main session with the user**, not in a subagent: one fixture needs text typed by hand, and auto mode has refused `do script` into a `claude` tab before ("Tmux Self Drive"). Either the user allows it for the probe window, or runs the probes themselves with `! osascript …`. Tasks 2–5 can then go to subagents or run natively.

---

### Task 1: Measure the screen and the tty (spike)

Throwaway probes; only fixtures and notes are kept. Use a scratch project dir and a **separate** Terminal window running `claude` (never the window of the session doing the work). `/effort` persists to `~/.claude/settings.json` — do not run it here; `/model` and plain prompts are enough.

**Files:**
- Create: `test/fixtures/screen-idle.txt`, `screen-busy.txt`, `screen-typing.txt`, `screen-dialog.txt`, `screen-model-confirm.txt`, `claude-help.txt` (all under `test/fixtures/`)
- Modify: `docs/superpowers/specs/2026-10-21-model-effort-dial-design.md` (move answered items from "Not measured yet" into "Measured facts")

- [ ] **Step 1: Capture screens.** In the test window: idle prompt → save `history` of the tab (`osascript -e 'tell application "Terminal" to get history of (first tab of (first window whose tty of tab 1 is "/dev/ttysNNN"))'`) to `screen-idle.txt`; while Claude answers a long prompt (`do script "Count slowly from 1 to 200, one number per line" in <tab>`) → `screen-busy.txt`; with `draft text` typed but not sent (send keystrokes with `do script` is not possible without Enter — type it by hand, or ask the user) → `screen-typing.txt`; with a permission prompt up (in a session started with `--permission-mode default`, prompt "run `touch x.txt`") → `screen-dialog.txt`. Trim each fixture to the last ~40 lines.
- [ ] **Step 2: Same-window tab selection.** Open a second tab in one window (both running `cat`), select tab A, `do script "x" in` tab B, read `selected` of both tabs. Record whether B became selected.
- [ ] **Step 3: tty of the statusline and hooks.** In the test project's `.claude/settings.local.json`, a statusline script that appends `$PPID`, `ps -o pid,ppid,tty,comm -p $PPID` and the ancestor chain to a file. Record which ancestor is `claude` and whether `ps -o tty=` of it is `ttysNNN`.
- [ ] **Step 4: `/model` mid-conversation.** After one exchanged prompt in the test session, `do script "/model sonnet" in <tab>`; save the screen as `screen-model-confirm.txt`. Record whether a confirmation appears and its text. Answer it in the terminal by hand.
- [ ] **Step 5: Save `claude --help` output** to `test/fixtures/claude-help.txt`.
- [ ] **Step 6: Update the spec's measured facts** with Steps 2–4 results.
- [ ] **Step 7: Commit**

```bash
git add test/fixtures docs/superpowers/specs/2026-10-21-model-effort-dial-design.md
git commit -m "test: capture Terminal screens and claude help for the dial"
```

---

### Task 2: Read effort levels and model aliases from `claude --help`

**Files:**
- Create: `src/claude-cli.js`, `test/claude-cli.test.js`
- Modify: `package.json` (add `"test": "node --test"`), `.gitlab-ci.yml` (run `npm test` after `npm ci` in `package`; add `"test/**/*"` to `.plugin-changes`)

**Interfaces:**
- Produces:
  - `findClaude(exists = fs.existsSync): string | null` — first existing candidate from Global Constraints (`~` = `os.homedir()`).
  - `readHelp(bin: string): Promise<string>` — `execFile(bin, ['--help'])`, stdout; rejects on failure.
  - `parseEffortLevels(help: string): string[]` — the comma list in parentheses inside the `--effort` option's description.
  - `parseModelAliases(help: string): string[]` — every `'quoted'` word in the `--model` option's description, up to the next option line.

- [ ] **Step 1: Write the failing tests** (`test/claude-cli.test.js`, fixture from Task 1):

```js
const help = fs.readFileSync(path.join(__dirname, 'fixtures/claude-help.txt'), 'utf8');
test('parseEffortLevels reads the --effort list', () => {
  assert.deepEqual(parseEffortLevels(help), ['low', 'medium', 'high', 'xhigh', 'max']);
});
test('parseModelAliases reads the quoted --model examples', () => {
  assert.deepEqual(parseModelAliases(help), ['fable', 'opus', 'sonnet']);
});
test('parsers return [] on unrelated text', () => {
  assert.deepEqual(parseEffortLevels('usage: foo'), []);
  assert.deepEqual(parseModelAliases('usage: foo'), []);
});
test('findClaude returns the first existing candidate', () => {
  const want = path.join(os.homedir(), '.local/bin/claude');
  assert.equal(findClaude((p) => p === want || p === '/usr/local/bin/claude'), want);
  assert.equal(findClaude(() => false), null);
});
```

- [ ] **Step 2: Run** `npm test` — Expected: FAIL, `Cannot find module '../src/claude-cli'`.
- [ ] **Step 3: Implement `src/claude-cli.js`** with the four exports above (CommonJS, like `update.js`).
- [ ] **Step 4: Run** `npm test` — Expected: 4 passing.
- [ ] **Step 5: Commit**

```bash
git add src/claude-cli.js test/claude-cli.test.js package.json .gitlab-ci.yml
git commit -m "Read effort levels and model aliases from claude --help"
```

---

### Task 3: Terminal.app bridge

**Files:**
- Create: `src/terminal.js`, `test/terminal.test.js`

**Interfaces:**
- Consumes: fixtures `screen-*.txt` (Task 1).
- Produces:
  - `SAFE_VALUE: RegExp` = `/^[A-Za-z0-9._\[\]-]+$/`
  - `commandText(kind: 'model' | 'effort', value: string): string` — `/model <value>` / `/effort <value>`; throws `Error` on another kind or a value failing `SAFE_VALUE`.
  - `screenState(screen: string): 'ready' | 'blocked'` — a **positive** match on the last non-blank lines (spec facts 8–11): `ready` only when the bottom holds the input-box frame — a line of `─` (20+), one or more lines starting with `❯` (the first) or continuation lines, a second `─` line, then at most 3 status lines — and the line just above the top `─` does not contain `› stashed`. Text after `❯` does not matter (draft or grey suggestion; the stash handles drafts). Anything else, including `''`, is `blocked`.
  - `interrupted(screen: string): boolean` — the last non-blank line above the input-box frame starts with `⎿  Interrupted`.
  - `class TerminalAccessError extends Error` — osascript error `-1743` (not authorised).
  - `frontTab(): Promise<string | null>` — tty (`ttysNNN`, no `/dev/`) of the selected tab of Terminal's front window; null when Terminal has no windows or is not running (do not launch it: check `application "Terminal" is running` first).
  - `tabInfo(tty: string): Promise<{processes: string[], screen: string} | null>` — null when no tab has that tty.
  - `typeInto(tty: string, text: string): Promise<void>` — `do script ((character id 19) & <text>) in <tab>` (Ctrl+S stashes a draft first, spec fact 10); rejects when no tab has that tty. Records the window's selected tab before and selects it again afterwards (fact 13: not measurable, always restore).
  - All three use `execFile('/usr/bin/osascript', ['-e', SCRIPT, ...argv])` with `on run argv`; tty and text arrive as `argv` items.

- [ ] **Step 1: Write the failing tests:**

```js
const screen = (n) => fs.readFileSync(path.join(__dirname, `fixtures/screen-${n}.txt`), 'utf8');
test('screenState is ready with the input box, whatever it holds', () => {
  // streaming reads ready too: the screen cannot tell (spec fact 8), hooks do
  for (const n of ['idle', 'idle-placeholder', 'typing', 'typing-multiline', 'interrupted', 'streaming']) {
    assert.equal(screenState(screen(n)), 'ready', n);
  }
});
test('screenState never reads a dialog or a held stash as ready', () => {
  for (const n of ['dialog', 'model-confirm', 'stashed']) assert.equal(screenState(screen(n)), 'blocked', n);
  assert.equal(screenState(''), 'blocked');
  assert.equal(screenState('random text\nno prompt here'), 'blocked');
});
test('interrupted sees the Interrupted line above the input box only', () => {
  assert.equal(interrupted(screen('interrupted')), true);
  for (const n of ['idle', 'streaming', 'dialog']) assert.equal(interrupted(screen(n)), false, n);
});
test('commandText builds the slash command', () => {
  assert.equal(commandText('model', 'opus[1m]'), '/model opus[1m]');
  assert.equal(commandText('effort', 'xhigh'), '/effort xhigh');
});
test('commandText rejects unsafe values', () => {
  for (const v of ['', 'opus sonnet', 'a"b', 'x;y', 'a\nb', '$(id)']) {
    assert.throws(() => commandText('model', v));
  }
  assert.throws(() => commandText('fast', 'on'));
});
```

- [ ] **Step 2: Run** `npm test` — Expected: FAIL, module not found.
- [ ] **Step 3: Implement `src/terminal.js`.**
- [ ] **Step 4: Run** `npm test` — Expected: all passing.
- [ ] **Step 5: Manual check** against a separate Terminal window running `cat` (ttys from `osascript -e 'tell application "Terminal" to get tty of tabs of windows'`):
  `node -e "const t=require('./src/terminal');t.frontTab().then(console.log);t.tabInfo('ttysNNN').then(i=>console.log(i.processes));t.typeInto('ttysNNN','/model opus')"` — Expected: front tty printed, `cat` among processes, `^S/model opus` reaches the `cat` window (check with `cat -v` instead of `cat`), front window unchanged. Close the window afterwards. Never point this at a tab running `claude` (auto mode refuses it, and it would change a real session).
- [ ] **Step 6: Commit**

```bash
git add src/terminal.js test/terminal.test.js
git commit -m "Type slash commands into a Terminal tab by tty"
```

---

### Task 4: Sessions registry and the tuner

**Files:**
- Create: `src/tune.js`, `test/tune.test.js`

**Interfaces:**
- Consumes: `commandText`, `screenState`, `interrupted`, `TerminalAccessError`, `SAFE_VALUE` from `src/terminal.js`.
- Produces:
  - `parseModelList(text: string): string[]` — one item per line, trimmed; drops empty lines, lines failing `SAFE_VALUE`, duplicates.
  - `matchModel(items: string[], model: {id: string, name: string} | null): number` — index of an item equal to `model.id`, else of the first item contained in `model.id` (case-insensitive), else `-1`.
  - `step(length: number, index: number, ticks: number, wrap: boolean): number` — `index === -1` → `0` regardless of ticks; wrap mod `length`; clamp to `[0, length-1]` otherwise.
  - `class Sessions`
    - `report(tty: string, status: object): void` — `status` is the statusline JSON. Stores `{tty, sessionId: status.session_id, project: basename(status.cwd || status.workspace?.current_dir), model: {id, name: display_name} | null, effort: status.effort?.level ?? null}`; a new `session_id` on a known tty replaces the entry.
    - `end(sessionId: string): void` — removes the entry with that session id.
    - `turn(sessionId: string, busy: boolean): void` — sets `busy` on the entry with that session id (no-op when unknown). Entries start with `busy: false`; a new `session_id` on a tty starts not busy.
    - `get(tty: string): Session | undefined`
    - `drop(tty: string): void`
    - `ttys(): string[]` — in first-report order.
  - `class Tuner`
    - `constructor({ sessions, terminal, levels: () => string[], onChange: () => void, timers = { setTimeout, clearTimeout, now: Date.now }, delay = 500, noticeFor = 2000 })` — `terminal` is `{ frontTab, tabInfo, typeInto }` from Task 3.
    - `rotate(dial: {context: string, kind: 'model' | 'effort', items: string[]}, ticks: number): Promise<void>` — `items` is ignored for `effort` (uses `levels()`).
    - `press(): Promise<boolean>` — false (caller shows an alert) when the front tab is a registered session; otherwise moves `chosen` to the next tty of `sessions.ttys()` (wrapping) and returns true.
    - `refresh(): Promise<void>` — re-reads `frontTab()`, at most once per 2 s; calls `onChange` when the target changes. Called from `/statusline` reports and from a 2 s interval in `plugin.js` (Task 5).
    - `view(dial): {kind, value: string | null, pending: boolean, project: string | null, chosen: boolean, notice: string | null}`
  - Target = front tab if `sessions.get(front)`; else `chosen` if set. `chosen` is cleared (notice `no session`) when `tabInfo` shows no `claude` in its processes or no tab.
  - Gesture: the first tick awaits the target and locks it (ticks arriving meanwhile accumulate); `pending` starts from the session's current value (`matchModel` / index in `levels()`) and moves by `step`; each tick restarts the 500 ms timer. On fire: target re-resolved — differs → drop pending, send nothing; `tabInfo` → not `claude` → clear, `no session`; session `busy` and not `interrupted(screen)` → `busy` for 2 s (when `interrupted`, call `sessions.turn(id, false)` and go on); `screenState` is `blocked` → `busy` for 2 s; else `typeInto(tty, commandText(kind, pending))`. `TerminalAccessError` → `no access`. Pending clears after the attempt; the real value comes with the next statusline report.
  - Notices: no levels → `no claude` (effort dial); session effort `null` → `—` (effort dial); no target → `no session`. With any of those, rotation sends nothing.

- [ ] **Step 1: Write the failing tests.** A fake terminal records `typeInto` calls; fake timers collect callbacks and run them on `flush()`.

```js
test('parseModelList drops blank and unsafe lines', () => {
  assert.deepEqual(parseModelList(' opus \n\nsonnet[1m]\nbad value\nx;y\nopus\n'), ['opus', 'sonnet[1m]']);
});
test('matchModel prefers the exact id, then a contained alias', () => {
  assert.equal(matchModel(['opus', 'claude-opus-5-5'], { id: 'claude-opus-5-5', name: 'Opus 5.5' }), 1);
  assert.equal(matchModel(['sonnet', 'opus'], { id: 'claude-opus-5-5', name: 'Opus 5.5' }), 1);
  assert.equal(matchModel(['fable'], { id: 'claude-opus-5', name: 'Opus 5' }), -1);
});
test('step from unknown lands on the first item', () => assert.equal(step(3, -1, 5, true), 0));
test('step wraps models and clamps effort', () => {
  assert.equal(step(3, 2, 1, true), 0);
  assert.equal(step(5, 4, 3, false), 4);
  assert.equal(step(5, 0, -2, false), 0);
});
test('Sessions replaces the entry when a tty reports a new session', () => { /* report A on ttys1, then B on ttys1 → get('ttys1').sessionId === 'B', ttys() === ['ttys1'] */ });
test('Tuner sends one command after the dial stops', async () => {
  // front = ttys1 (registered, model claude-opus-5-5); items ['fable','opus','sonnet']
  // rotate +1 three times, flush → typeInto called once with ('ttys1', '/model fable')
});
test('Tuner does not send when the target changed', async () => {
  // rotate on front ttys1; set front to ttys2 (registered); flush → no typeInto
});
test('Tuner view follows a front-tab change without rotation', async () => {
  // front ttys1, refresh → view().project === A's; front ttys2, advance clock 2 s, refresh → B's project, onChange called
});
test('Tuner shows busy and drops the value on a blocked screen', async () => {
  // tabInfo screen = fixture dialog → no typeInto; view().notice === 'busy'
});
test('Tuner shows busy during a turn even though the screen looks ready', async () => {
  // sessions.turn(id, true); screen = fixture streaming → no typeInto; notice 'busy'
});
test('Tuner treats an interrupted turn as over', async () => {
  // sessions.turn(id, true); screen = fixture interrupted → typeInto called; get(tty).busy === false
});
test('Tuner view shows no session for an unregistered front tab', async () => {
  // front ttys9 not in sessions, no chosen → view().notice === 'no session'; rotate → no typeInto
});
test('Tuner falls back to the session chosen on the deck', async () => {
  // front null; press() → true, chosen ttys1; rotate, flush → typeInto('ttys1', …); view().chosen === true
});
test('Tuner clears the chosen tab when it no longer runs claude', async () => {
  // chosen ttys1; tabInfo processes ['-zsh'] → no typeInto; view().notice === 'no session'
});
test('Tuner effort dial without effort shows dash', async () => {
  // session effort null → view({kind:'effort'}).notice === '—'; rotate → no typeInto
});
test('Tuner reports no access when Terminal refuses', async () => {
  // typeInto rejects TerminalAccessError → view().notice === 'no access'
});
```

Fill the commented bodies with the setup and assertions given in each comment.

- [ ] **Step 2: Run** `npm test` — Expected: FAIL, module not found.
- [ ] **Step 3: Implement `src/tune.js`.**
- [ ] **Step 4: Run** `npm test` — Expected: all passing.
- [ ] **Step 5: Commit**

```bash
git add src/tune.js test/tune.test.js
git commit -m "Turn dial rotation into a debounced model or effort change"
```

---

### Task 5: Wire the action into the plugin, the deck and the docs

**Files:**
- Modify: `src/plugin.js`, `hooks.json`, `com.obalunenko.claudeperm.sdPlugin/manifest.json`, `scripts/icons.sh`, `README.md`, `CLAUDE.md`
- Create: `com.obalunenko.claudeperm.sdPlugin/pi/tune.html`, `com.obalunenko.claudeperm.sdPlugin/imgs/tune.png`, `tune@2x.png` (generated)

**Interfaces:**
- Consumes: everything above.
- Produces: action settings `{kind: 'model' | 'effort', models: string}` (defaults `kind: 'model'`, `models: ''`; empty `models` → aliases from `parseModelAliases`).

- [ ] **Step 1: Manifest.** Add the action after `strip`:

```json
{
  "UUID": "com.obalunenko.claudeperm.tune",
  "Name": "Model / Effort",
  "Tooltip": "Turn to change the model or the effort of the Claude session in the front Terminal tab",
  "Icon": "imgs/tune",
  "PropertyInspectorPath": "pi/tune.html",
  "Controllers": ["Encoder"],
  "Encoder": {
    "layout": "$A0",
    "TriggerDescription": { "Rotate": "Change value", "Push": "Next session", "Touch": "Next session" }
  },
  "States": [{ "Image": "imgs/tune" }]
}
```

Set `Version` to `1.2.0.1` for test installs (local builds raise only the fourth number; the `v1.3.0` tag sets `1.3.0.0` in CI). Do **not** add the action to `Claude.streamDeckProfile`.

- [ ] **Step 2: Icon.** `icon tune '#1565c0' '◎' 36` in `scripts/icons.sh`; run `npm run icons`.
- [ ] **Step 3: Property Inspector `pi/tune.html`.** Plain HTML/JS, dark background like the Stream Deck app. Global `connectElgatoStreamDeckSocket(port, uuid, registerEvent, info, actionInfo)`: opens `ws://127.0.0.1:<port>`, sends `{event: registerEvent, uuid}`, reads `JSON.parse(actionInfo).payload.settings`. Controls: `Changes` select (`Model` / `Effort`); `Models` textarea, one per line, shown only for Model, placeholder `fable\nopus\nsonnet`, hint "Empty: the aliases from claude --help". On change sends `{event: 'setSettings', context: uuid, payload: settings}`.
- [ ] **Step 4: `plugin.js`.**
  - `ACTIONS.tune`; `contexts` entries gain `settings` (from `willAppear` `payload.settings`, updated on `didReceiveSettings`).
  - `dialRotate`, `dialDown`, `touchTap`: when `msg.action === ACTIONS.tune` go to the tuner (`rotate(dialOf(context), ticks)` / `press()` → `showAlert` on false); other actions keep today's handlers.
  - At start: `findClaude()` → `readHelp` → `levels` and `aliases` (failures logged once, `levels` stays `[]`).
  - `/statusline`: header `x-claude-tty` must match `/^ttys\d+$/` else 400; `sessions.report(tty, body)`; `tuner.refresh()`; 204.
  - `setInterval(() => tuner.refresh(), 2000)` while at least one tune context is visible (started on its `willAppear`, cleared when the last one disappears).
  - `onEvent`: `SessionEnd` also calls `sessions.end(hook.session_id)`; `UserPromptSubmit` → `sessions.turn(id, true)`; `Stop` and the new `StopFailure` → `sessions.turn(id, false)`.
  - `hooks.json`: add `StopFailure` → `/event`, same command and options as `Stop`. README's merge snippet already appends every hook key.
  - Render: `tuneStrip(view)` — one 200×100 `full-canvas` image: top line `Model` / `Effort` (17 px bold), the notice or value in the middle (`fit` with sizes `[30, 26, 22, 18]`, background `COLORS.always` while `pending`, else `COLORS.idle`), bottom line project name plus ` · chosen` when chosen (15 px, `COLORS.muted`). `renderAll` covers tune contexts; `onChange` → `renderAll`.
  - Update the header comment of `plugin.js` with one paragraph on the dial.
- [ ] **Step 5: Build and test** `npm test && npm run package` — Expected: tests pass, `dist/com.obalunenko.claudeperm.streamDeckPlugin` created.
- [ ] **Step 6: Docs.**
  - README: a `Model / Effort` row in the Actions table; a "Model and effort dial" section with the statusline line below, the Automation prompt ("System Settings → Privacy & Security → Automation → Stream Deck → Terminal"), and the notices.

```bash
# Stream Deck: report model, effort and this session's tty to the plugin.
tty=$(p=$PPID; while [ "${p:-1}" -gt 1 ]; do [ "$(ps -o comm= -p "$p")" = claude ] && { ps -o tty= -p "$p" | tr -d ' '; break; }; p=$(ps -o ppid= -p "$p" | tr -d ' '); done)
printf '%s' "$input" | curl -sf -m 1 -o /dev/null -H "X-Claude-TTY: $tty" --data-binary @- http://127.0.0.1:47823/statusline >/dev/null 2>&1 &
```

  (Adjust the ancestor walk to what Task 1 Step 3 measured.) Also a minimal statusline command for users without one.
  - CLAUDE.md: layout lines for `src/claude-cli.js`, `src/terminal.js`, `src/tune.js`, `pi/`, `test/`; `npm test` in Commands; the measured facts (spec facts 1–3, 5, 8–12, short) under "Hook behaviour"; a convention line: "**Only the plugin's own values are typed.** `/model` / `/effort` with a value from `claude --help` or the dial's list, checked against `SAFE_VALUE`, passed to osascript as argv."
- [ ] **Step 7: Manual check on the deck** (install the package):
  1. Two dials: Model, Effort. Two Claude sessions in two Terminal windows, both with the statusline line.
  2. Front window = session A: strip shows A's model and project; turn model dial two ticks → after ~0.5 s A's statusline shows the new model; B unchanged.
  3. Switch Terminal focus to an editor: dial still targets A (front Terminal window), strip shows A.
  4. Front tab a plain shell: strip `no session`; press → `… · chosen` B; turn effort → B changes.
  5. Type text in A's prompt without sending, make A front, turn → the model changes and the draft is back in the prompt afterwards. Stash a draft with Ctrl+S, turn → `busy`, nothing typed. While A answers a long prompt, turn → `busy`.
  6. A request arrives (permission hook): deck switches to the Claude profile; dial not there; after the answer it returns.
  7. In A, `/model` mid-conversation brings up the confirmation: a second turn right after shows `busy` and types nothing.
  8. With an editor in front, switch Terminal's front tab from A to B: within 2 s the strip shows B, no turn needed.
- [ ] **Step 8: Commit**

```bash
git add -A src com.obalunenko.claudeperm.sdPlugin scripts README.md CLAUDE.md
git commit -m "Change model and effort of a running session from a dial"
```
