# Questions Answered Through the Terminal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deck press on an `AskUserQuestion` prompt is typed into the session's Terminal dialog (↑/↓ + Enter), so the terminal always shows the page the deck shows. The deck follows the terminal, and falls back to today's hook answer when the terminal path is unavailable.

**Architecture:** `src/terminal.js` gains `pressKeys`, which types only ↑/↓ sequences. A new `src/ask.js` holds a pure dialog-screen parser, a pure key planner, and an `Asker` class (like `Tuner`) with injected terminal, sessions and timers. The `Asker` puts a request on the terminal path, follows the screen and types presses. `src/plugin.js` routes question presses to the `Asker` when `req.path === 'terminal'` and keeps the hook path as is.

**Tech Stack:** Node 20, `node --test`, `osascript` (Terminal.app AppleScript), Stream Deck WebSocket protocol over `ws`.

**Spec:** `docs/superpowers/specs/2026-10-22-questions-follow-terminal-design.md`

## Global Constraints

- Node 20, plain Stream Deck WebSocket protocol over `ws`, no Elgato SDK.
- `osascript` by absolute path (`/usr/bin/osascript`); everything reaches AppleScript as `argv`.
- Only ↑ / ↓ escape sequences are ever typed on this path, plus the Enter `do script` adds. Nothing from the hook body is typed.
- Type only when that tab's screen, read just before the send, shows exactly this dialog and the tab runs `claude`.
- No HTTP endpoint triggers a send; sends come only from key presses.
- Moves never wrap, never use digits, never use ← / →.
- Comments and user-facing strings in English.
- Keep the plugin UUID and the existing action UUIDs.
- Local test build: `Version` in `manifest.json` = `1.4.0.1` (installed release is `1.4.0.0`).

## Review Focus

1. **The scrollback holds an old dialog** above the current input box. Expected: `parseDialog` returns `null`, and nothing is typed. Test in Task 3.
2. **A long question or label wraps over several lines** in a narrow terminal. Expected: the page is still recognised and option N is still option N. Test in Task 3.
3. **Two quick presses.** The second was pressed on the page the first one left. Expected: the second types nothing and the key alerts. Test in Task 5.
4. **The tab no longer runs `claude`, or Terminal access is revoked mid-prompt.** Expected: nothing is typed, the request goes to the hook path, and the next press answers through the hook. Test in Task 5.
5. **The user changes a single-select answer with the keyboard.** Expected: the deck forgets its own pick for that page, so Next cannot re-pick the old option. Test in Task 5.

---

## File Structure

- `src/terminal.js`: add `KEY_UP`, `KEY_DOWN`, `pressKeys`.
- `src/ask.js` (new): `parseDialog`, `pageOf`, `matches`, `planPress`, `Asker`.
- `src/plugin.js`: path per request, following timer, press routing, rendering of the terminal path and the review page.
- `test/ask.test.js` (new), `test/terminal.test.js`.
- `test/fixtures/ask-*.txt` (new): measured dialog screens.
- `CLAUDE.md`, `README.md`, `com.obalunenko.claudeperm.sdPlugin/manifest.json`.

### Task 1: Measure the open facts and save the dialog fixtures

No product code. The probe helper and the first captures are in the session scratchpad:
`/tmp/scratchpad/`
- `probe-tools/term.py`: `open <cmd>`, `send <tty> <keys>`, `screen <tty> [n]`.
- `probe-tools/launch.sh`: starts `claude --model haiku --settings '{"disableAllHooks":true}'` with the three-question prompt.
- `screens/0*.txt`.

**Files:**
- Create: `test/fixtures/ask-color.txt` (from `screens/01-q1.txt`: Color page, ❯ on 1, nothing answered)
- Create: `test/fixtures/ask-snacks.txt` (from `screens/02-after-2-enter.txt`: Snacks, Color and Snacks ☒, Chips `[✔]`, ❯ on 1)
- Create: `test/fixtures/ask-snacks-other.txt` (from `screens/04-after-up-enter.txt`: ❯ on `[✔] Type something`)
- Create: `test/fixtures/ask-size.txt` (from `screens/05-after-down-enter.txt`: Size page, last question)
- Create: `test/fixtures/ask-review.txt` (from `screens/06-submit-page.txt`)
- Create: `test/fixtures/ask-one.txt`, `test/fixtures/ask-four.txt` (new captures, below)
- Modify: `docs/superpowers/specs/2026-10-22-questions-follow-terminal-design.md` (append facts 12+ under "Measured facts")

A screen with ❯ on `Next` cannot be captured through `do script`: the Enter acts as soon as ❯ gets there. The parser accepts `Next` with or without ❯ (Task 3).

- [ ] **Step 1:** Copy the five captures to the fixture names above.
- [ ] **Step 2: Measure a long arrow run.** Ask for a multi-select question with four options. From ❯ on option 1, send `ESC[B` ×5 in one `do script`. Expected: ❯ lands on `Next`, then the Enter goes to the next page, so it arrives as keys and not as a paste. Save the four-option page before the send as `ask-four.txt`. If it arrives as a paste (the arrows ignored, or a literal newline), **stop and report**: the design rests on this.
- [ ] **Step 3: Measure a one-question set.** Ask for one single-select question. Save it as `ask-one.txt`. Is there a tab bar? Does an ↓ + Enter pick submit at once, or show a review page?
- [ ] **Step 4: Measure timing and release with the plugin's hooks on.** Launch without `disableAllHooks`; the installed plugin answers. Note the delay from the tool call until the dialog is on the screen. Then answer in the terminal: submit once, decline once. Each time, check that the plugin holds no open request: `lsof -nP -iTCP:47823 -sTCP:ESTABLISHED` prints nothing within a few seconds.
- [ ] **Step 5:** Append facts 12+ (steps 2–4) to the spec's "Measured facts". Remove the answered items from "Still to measure". Close the probe window.
- [ ] **Step 6: Commit**

```bash
git add test/fixtures/ask-*.txt docs/superpowers/specs/2026-10-22-questions-follow-terminal-design.md
git commit -m "test: Add measured question dialog screens"
```

### Task 2: `pressKeys` types only arrows into a tab

**Files:**
- Modify: `src/terminal.js`
- Test: `test/terminal.test.js`

**Interfaces:**
- Produces: `KEY_UP = '\x1b[A'`, `KEY_DOWN = '\x1b[B'`, `pressKeys(tty: string, keys: string): Promise<void>`. `keys` is zero or more of `KEY_UP` / `KEY_DOWN`; `do script` adds the Enter. Rejects with `/tty/` for a bad tty, `/keys/` for any other text, and `No Terminal tab with tty …` when none.

- [ ] **Step 1: Write the failing tests**

```js
test('pressKeys refuses anything but arrow runs before touching AppleScript', async () => {
  for (const keys of ['x', '\r', '\x1b', '\x1b[C', '\x1b[D', '1', `${KEY_DOWN}\n`, `${KEY_UP}a`, '/model opus']) {
    await assert.rejects(pressKeys('ttys001', keys), /keys/, JSON.stringify(keys));
  }
});

test('pressKeys refuses a bad tty', async () => {
  for (const tty of ['', '/dev/ttys001', 'ttys1; rm']) await assert.rejects(pressKeys(tty, KEY_DOWN), /tty/);
});
```

- [ ] **Step 2:** Run `node --test test/terminal.test.js`. Expected: FAIL, `pressKeys` is not a function.
- [ ] **Step 3:** Implement `pressKeys` in `src/terminal.js`. Use the same AppleScript as `TYPE_INTO`, without the Ctrl+S prefix (`PRESS_INTO`). Check against `/^(?:\x1b\[[AB])*$/` and reject with `Refusing to type those keys`. Export `KEY_UP`, `KEY_DOWN` and `pressKeys`. Extend the header comment: the bridge now also answers question dialogs.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/terminal.js test/terminal.test.js
git commit -m "Type arrow keys into a Terminal tab"
```

### Task 3: Parse the question dialog from the screen

**Files:**
- Create: `src/ask.js`
- Create: `test/ask.test.js`

**Interfaces:**
- Produces: `parseDialog(screen: string): Dialog | null`, where

```js
// Dialog = {
//   tabs: { header: string, answered: boolean }[],   // [] when there is no tab bar
//   page: { kind: 'question', question: string, multi: boolean }
//       | { kind: 'review', answers: { question: string, answer: string }[] },
//   items: { kind: 'option' | 'other' | 'next' | 'chat' | 'submit' | 'cancel',
//            option?: number,     // 0-based, kind 'option' only
//            label: string,       // first line of the label
//            checked?: boolean }[],   // multi-select options and 'other'
//   highlight: number,           // index into items of the ❯ line
// }
```

The dialog is the part of the screen after the **last** tab bar line, or the last `Review your answers` line, or, for a set without a tab bar, the last question block (shape from `ask-one.txt`). It counts only when it ends the screen:
- a question page has its footer (`Enter to select · …`) within the last 3 non-blank lines;
- a review page has its `Cancel` item within the last 3 non-blank lines.

Otherwise return `null`.

Item lines:
- `❯? N. [✔] label` / `❯? N. label`;
- `Type something` (with or without `[ ]` / `.`) is `other`;
- `Chat about this` is `chat`;
- a line that is only `Next`, with or without ❯, is `next`;
- `Submit answers` / `Cancel` are `submit` / `cancel`.

Indented lines without a number are descriptions or label wraps. A wrapped question is joined with single spaces. Exactly one item has ❯, otherwise return `null`.

- [ ] **Step 1: Write the failing tests** (fixture loader `const ask = (n) => fs.readFileSync(path.join(__dirname, \`fixtures/ask-${n}.txt\`), 'utf8')`)

```js
test('parseDialog reads a fresh single-select page', () => {
  const d = parseDialog(ask('color'));
  assert.deepEqual(d.tabs, [{ header: 'Color', answered: false }, { header: 'Snacks', answered: false }, { header: 'Size', answered: false }]);
  assert.deepEqual(d.page, { kind: 'question', question: 'Which color for the probe?', multi: false });
  assert.deepEqual(d.items.map((i) => i.kind), ['option', 'option', 'option', 'other', 'chat']);
  assert.deepEqual(d.items.slice(0, 3).map((i) => i.label), ['Red', 'Green', 'Blue']);
  assert.equal(d.highlight, 0);
});

test('parseDialog reads multi-select checks and the Next item', () => {
  const d = parseDialog(ask('snacks'));
  assert.equal(d.page.multi, true);
  assert.deepEqual(d.tabs.map((t) => t.answered), [true, true, false]);
  assert.deepEqual(d.items.filter((i) => i.kind === 'option').map((i) => i.checked), [true, false, false]);
  assert.deepEqual(d.items.map((i) => i.kind), ['option', 'option', 'option', 'other', 'next', 'chat']);
  assert.equal(parseDialog(ask('snacks-other')).highlight, 3);
  // ❯ on Next cannot be captured through do script (Task 1); move it there by hand
  const onNext = parseDialog(ask('snacks').replace('❯ 1. [✔] Chips', '  1. [✔] Chips').replace(/^ {5}Next$/m, '   ❯ Next'));
  assert.equal(onNext.items[onNext.highlight].kind, 'next');
});

test('parseDialog reads the review page', () => {
  const d = parseDialog(ask('review'));
  assert.deepEqual(d.page.answers, [
    { question: 'Which color for the probe?', answer: 'Red' },
    { question: 'Which snacks for the probe?', answer: 'Chips' },
    { question: 'Which size for the probe?', answer: 'Large' },
  ]);
  assert.deepEqual(d.items.map((i) => i.kind), ['submit', 'cancel']);
  assert.equal(d.highlight, 0);
});

test('parseDialog ignores a dialog left in the scrollback', () => {
  const rule = '─'.repeat(40);
  assert.equal(parseDialog(`${ask('color')}\n⏺ User declined to answer questions\n${rule}\n❯ \n${rule}\n`), null);
  assert.equal(parseDialog(screen('idle')), null); // test/fixtures/screen-idle.txt
});

test('parseDialog joins a wrapped question and keeps option numbers', () => {
  // ask-color with the question split over two lines and Green's label wrapped
  const narrow = ask('color').replace('Which color for the probe?', 'Which color for\nthe probe?').replace('2. Green', '2. Gr\n     een');
  const d = parseDialog(narrow);
  assert.equal(d.page.question, 'Which color for the probe?');
  assert.deepEqual(d.items.filter((i) => i.kind === 'option').map((i) => i.option), [0, 1, 2]);
});
```

Also: a test that `ask-one.txt` parses with `tabs: []`, in the shape Task 1 recorded.

- [ ] **Step 2:** Run `node --test test/ask.test.js`. Expected: FAIL, module not found.
- [ ] **Step 3:** Implement `parseDialog` in `src/ask.js`. Head comment: what the module does, and that the screen facts are in the spec. Compare text with whitespace collapsed.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/ask.js test/ask.test.js
git commit -m "Read the question dialog from the Terminal screen"
```

### Task 4: Match the dialog to the request and plan the keys

**Files:**
- Modify: `src/ask.js`
- Test: `test/ask.test.js`

**Interfaces:**
- Consumes: `Dialog` from Task 3. `KEY_UP` / `KEY_DOWN` from Task 2.
- Produces:
  - `matches(dialog: Dialog | null, questions: {question, header, options, multiSelect}[]): boolean`. With a tab bar: the headers equal the request's headers in order, and the page is one of the request's questions or the review page. Without one: one question whose text equals the page's. On a question page the option labels must also be prefixes of the request's labels, in order.
  - `pageOf(dialog, questions): number`: the question index, `questions.length` for the review page, `-1` otherwise.
  - `planPress(dialog, questions, press, known): string | null`. `press` is `{ kind: 'option', option: number } | { kind: 'next' } | { kind: 'submit' }`. `known` is the deck's pick for a single-select page (`number | null`). Returns the ↑/↓ run to the target item, or `null` when the spec's table says "alert, nothing typed".

Targets, from the spec's table:

| press | page | target |
|---|---|---|
| option N | question | the `option` item N |
| next | multi-select | `next` |
| next | single-select, `known !== null` | the `option` item `known` |
| submit | review | `submit` |

Anything else → `null`. The run is `KEY_DOWN.repeat(t - h)` or `KEY_UP.repeat(h - t)` for highlight `h` and target `t`. It never wraps; `t === h` gives `''`.

- [ ] **Step 1: Write the failing tests**

```js
const QS = [
  { question: 'Which color for the probe?', header: 'Color', multiSelect: false, options: [{ label: 'Red' }, { label: 'Green' }, { label: 'Blue' }] },
  { question: 'Which snacks for the probe?', header: 'Snacks', multiSelect: true, options: [{ label: 'Chips' }, { label: 'Nuts' }, { label: 'Fruit' }] },
  { question: 'Which size for the probe?', header: 'Size', multiSelect: false, options: [{ label: 'Small' }, { label: 'Large' }] },
];

test('matches only this request', () => {
  assert.equal(matches(parseDialog(ask('color')), QS), true);
  assert.equal(matches(parseDialog(ask('review')), QS), true);
  assert.equal(matches(parseDialog(ask('color')), [QS[0], QS[2], QS[1]]), false);
  assert.equal(matches(parseDialog(ask('color')), [{ ...QS[0], options: [{ label: 'Pink' }, { label: 'Green' }, { label: 'Blue' }] }, QS[1], QS[2]]), false);
  assert.equal(matches(null, QS), false);
});

test('pageOf names the page', () => {
  assert.equal(pageOf(parseDialog(ask('color')), QS), 0);
  assert.equal(pageOf(parseDialog(ask('snacks')), QS), 1);
  assert.equal(pageOf(parseDialog(ask('review')), QS), 3);
});

test('planPress moves down or up without wrapping', () => {
  const color = parseDialog(ask('color')); // ❯ on Red
  assert.equal(planPress(color, QS, { kind: 'option', option: 0 }, null), '');
  assert.equal(planPress(color, QS, { kind: 'option', option: 2 }, null), KEY_DOWN + KEY_DOWN);
  const other = parseDialog(ask('snacks-other')); // ❯ on Type something
  assert.equal(planPress(other, QS, { kind: 'option', option: 0 }, null), KEY_UP.repeat(3));
  assert.equal(planPress(other, QS, { kind: 'next' }, null), KEY_DOWN);
});

test('planPress refuses what would need a guess', () => {
  const color = parseDialog(ask('color'));
  assert.equal(planPress(color, QS, { kind: 'next' }, null), null); // single-select, pick unknown
  assert.equal(planPress(color, QS, { kind: 'next' }, 1), KEY_DOWN);
  assert.equal(planPress(color, QS, { kind: 'submit' }, null), null);
  assert.equal(planPress(color, QS, { kind: 'option', option: 3 }, null), null); // no such option
  assert.equal(planPress(parseDialog(ask('review')), QS, { kind: 'submit' }, null), '');
  assert.equal(planPress(parseDialog(ask('review')), QS, { kind: 'option', option: 0 }, null), null);
});
```

- [ ] **Step 2:** Run `node --test test/ask.test.js`. Expected: FAIL, the functions are not defined.
- [ ] **Step 3:** Implement `matches`, `pageOf` and `planPress` in `src/ask.js`, and export them.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/ask.js test/ask.test.js
git commit -m "Plan the keys for a deck press on a question dialog"
```

### Task 5: `Asker` attaches, follows and presses

**Files:**
- Modify: `src/ask.js`
- Test: `test/ask.test.js`

**Interfaces:**
- Consumes:
  - `Sessions` (`src/tune.js`): iterate `sessions.ttys()` and `sessions.get(tty).sessionId`;
  - `terminal.tabInfo(tty) → {processes, screen} | null`, `terminal.pressKeys(tty, keys)`, `TerminalAccessError` (`src/terminal.js`);
  - Tasks 3–4.
- Produces: `class Asker`

```js
new Asker({ sessions, terminal, onChange = () => {}, timers = { setTimeout, now: Date.now },
            detectFor = 2000, detectEvery = 250, settleFor = 1000, settleEvery = 100, grace = 2000 })
asker.attach(req): Promise<boolean>         // sets req.path 'terminal' | 'hook', req.tty
asker.follow(req): Promise<void>            // one read: syncs req, or falls back after `grace`
asker.press(req, press, step): Promise<boolean>   // serialised; true when typed
```

The request object from `plugin.js` gains these fields, set by the `Asker`:
- `path: 'probing' | 'terminal' | 'hook'`;
- `tty: string | null`;
- `answered: boolean[] | null`: the tab bar on the terminal path, `null` on the hook path;
- `own: boolean`: the last page change came from a deck send;
- `lostAt: number | null`.

It reads and writes the existing `req.step` (`questions.length` on the review page) and `req.picked`.

**Sync rules** (one function, used by `follow` and after each `press`):
- multi-select page `i`: `req.picked[i]` = the checked options on screen;
- page changed while `!req.own` and the old page was single-select: `req.picked[old] = new Set()`. Then `req.step = page` and `req.own = false`;
- review page: each `picked[i]` comes from the answers. Single-select: the option whose label equals the answer. Multi-select: the answer split on `', '`. Unknown labels are skipped;
- `req.answered` comes from `dialog.tabs`, or `[pageOf(...) === questions.length]` for a set without a tab bar;
- call `onChange()` only when something changed.

**`attach`:**
- find the tty whose `sessionId === req.session`;
- poll `tabInfo` every `detectEvery` up to `detectFor`;
- success needs `processes.includes('claude')` and `matches(...)`; then sync;
- otherwise `req.path = 'hook'`;
- `TerminalAccessError` → `'hook'`.

**`follow`:**
- no match → `req.lostAt ??= now`; `now - lostAt >= grace` → `req.path = 'hook'`, then `onChange()`;
- match → `req.lostAt = null`, then sync.

**`press`:**
- chain on one promise, so presses run one at a time;
- read, check `claude` and `matches`, sync;
- `pageOf !== step` → `false`;
- `keys = planPress(...)` with `known` = the single pick of `req.picked[step]` when the page is single-select and `size === 1`, else `null`. `null` → `false`;
- set `req.own = true` for presses that leave the page (single-select option, next);
- record a single-select option pick in `req.picked[step]` before typing;
- `pressKeys`, then poll every `settleEvery` up to `settleFor` until the screen changes, sync, `true`;
- `TerminalAccessError`, or a tab without `claude` → `req.path = 'hook'`, `false`.

Tests use a fake terminal whose `tabInfo` returns queued fixture screens and records `pressKeys` calls, and the `fakeTimers` pattern from `test/tune.test.js`.

- [ ] **Step 1: Write the failing tests:**
  - `attach puts the request on the terminal path when the tab shows its dialog`: `req.path === 'terminal'`, `req.tty === 'ttys005'`.
  - `attach leaves an unknown session or a foreign dialog on the hook path`: no session for the id → `'hook'`, `tabInfo` never called. A screen of another question set until `detectFor` → `'hook'`.
  - `press types the planned keys and follows the next page`: on `ask-color`, option 1 → `pressKeys('ttys005', KEY_DOWN)`. The next screen is `ask-snacks`, so `req.step === 1` and `req.picked[0]` is `{1}`.
  - `a press made on a page the terminal has left types nothing` (Review Focus 3): screen `ask-snacks`, `press(req, {kind:'option', option:0}, 0)` → `false`, no `pressKeys`.
  - `the tab without claude or a refused Terminal sends the request to the hook path` (Review Focus 4): processes `['zsh']` → `false`, `path === 'hook'`, no `pressKeys`. `tabInfo` rejecting `TerminalAccessError` → same.
  - `a keyboard page change forgets the deck's single-select pick` (Review Focus 5): `req.picked[0] = {1}`, `own = false`, `step = 0`; `follow` sees `ask-snacks` → `req.picked[0].size === 0`. With `own = true` the pick stays.
  - `follow takes picks from the review page`: `ask-review` → `picked` = `[{0}, {0}, {1}]`, `step === 3`.
  - `follow falls back to the hook path only after the grace period`: no match at t=0 → still `'terminal'`. At t=`grace` → `'hook'`.
- [ ] **Step 2:** Run `node --test test/ask.test.js`. Expected: FAIL, `Asker` is not a constructor.
- [ ] **Step 3:** Implement `Asker` in `src/ask.js` as specified above.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/ask.js test/ask.test.js
git commit -m "Answer question dialogs through the terminal tab"
```

### Task 6: Wire the terminal path into the plugin, docs, local build

**Files:**
- Modify: `src/plugin.js`
- Modify: `README.md`, `CLAUDE.md`, `com.obalunenko.claudeperm.sdPlugin/manifest.json`

**Interfaces:**
- Consumes: `Asker`, `pageOf`, `parseDialog` (Tasks 3–5), the plugin's existing `queue`, `current()`, `sessions`, `renderAll`, `answer`, `send`.

Behaviour in `src/plugin.js`:
- **`onPermission`.** A request with `questions` starts with `path: 'probing'`, `tty: null`, `answered: null`, `own: false`, `lostAt: null`. Then call `asker.attach(req).then(() => { watchFollow(); renderAll(); })`. Every other request gets `path: 'hook'`.
- **`watchFollow()`.** A `setInterval` of `FOLLOW_EVERY = 1000`. It runs while any queued request has `path === 'terminal'`, and on each tick calls `asker.follow(current())` when `current()` is on that path. Call it from `attach`'s callback and from `remove()`.
- **Presses** on `current()` by path:
  - `'probing'`: `showAlert`.
  - `'terminal'`:
    - Option key or strip tap → `asker.press(req, { kind: 'option', option }, req.step)`.
    - **Allow** → `{ kind: req.step === req.questions.length ? 'submit' : 'next' }`.
    - Each press calls `showAlert` when it resolves `false`, and `showOk` is not sent.
    - **‹ Back** → `showAlert`. Dial rotation does nothing.
    - **Deny** goes through the hook, unchanged.
  - `'hook'`: today's code, unchanged.
- **Rendering.**
  - Answered dots use `req.answered ? req.answered[i] : req.picked[i].size > 0`.
  - On the terminal path **‹ Back** draws disabled.
  - **Allow** reads `Submit` on the review page (enabled) and `Next` otherwise. `Next` is enabled on a multi-select page, or on a single-select page with a known pick.
  - Review page (`req.step === req.questions.length`): the status key shows `Review` and the dots, option keys and strip segments are blank. Guard every `currentQuestion(req)` use against `null`.
  - The `'probing'` state draws as the hook path.
- **Comment.** Reword the comment above `tuneTimer`: Terminal is asked only while a dial or Context Usage is on the deck, **or while a question prompt waits for a session that reports through the statusline**.

- [ ] **Step 1:** Implement the behaviour above in `src/plugin.js`.
- [ ] **Step 2:** Run `npm test && npm run build`. Expected: tests PASS, the build writes `com.obalunenko.claudeperm.sdPlugin/bin/plugin.js` with no errors.
- [ ] **Step 3: README.**
  - The questions paragraph (around lines 61–67): with the session's Terminal tab known, a press is typed into the terminal dialog; the terminal and the deck show the same page; **‹ Back** and the dials do not move pages then (use the keyboard; the deck follows); **Submit** works on the review page. Without the tab, everything works as before.
  - The one-question behaviour as measured in Task 1.
  - Step 4 (Terminal access): also asked the first time a question prompt arrives for a session that reports through the statusline.
- [ ] **Step 4: CLAUDE.md.** Add the measured dialog facts (spec facts 1–11 and Task 1's 12+) to "Hook behaviour", in the style of the Model / Effort block. Update the `src/` layout line for `src/ask.js`.
- [ ] **Step 5:** Set `Version` in `manifest.json` to `1.4.0.1`, then run `npm run package`. Expected: `dist/com.obalunenko.claudeperm.streamDeckPlugin`.
- [ ] **Step 6: Manual check by the user on the device** (Claude cannot press keys). Install the package, restart a Claude session in Terminal.app, ask for three questions as in the probe, and answer them on the deck:
  - the terminal turns pages with each pick;
  - the review page appears and **Submit** on the deck submits;
  - ← in the terminal moves the deck back;
  - with Terminal access denied, or in a non-Terminal session, the deck answers through the hook as before.
- [ ] **Step 7: Commit** after the user confirms.

```bash
git add src/plugin.js README.md CLAUDE.md com.obalunenko.claudeperm.sdPlugin/manifest.json
git commit -m "feat: Answer question prompts through the terminal so it shows the deck's page"
```
