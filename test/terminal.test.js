const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { SAFE_VALUE, KEY_UP, KEY_DOWN, commandText, screenState, interrupted, tabInfo, typeInto, pressKeys } = require('../src/terminal');

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

test('screenState needs the frame at the bottom, not just somewhere', () => {
  const rule = '─'.repeat(30);
  const frame = `${rule}\n❯ \n${rule}\n  probe\n`;
  assert.equal(screenState(frame), 'ready');
  assert.equal(screenState(`${frame}a\nb\nc\nd\n`), 'blocked'); // more than 3 status lines
  assert.equal(screenState(`${rule}\nhello\n${rule}\n  probe\n`), 'blocked'); // no ❯ line
  assert.equal(screenState(`${'─'.repeat(5)}\n❯ \n${'─'.repeat(5)}\n`), 'blocked'); // rules too short
});

test('screenState sees a stash line a few lines above the input box', () => {
  const rule = '─'.repeat(30);
  const body = `${rule}\n❯ \n${rule}\n  probe\n`;
  assert.equal(screenState(`text\n  › stashed\n  ◐ medium · /effort\n${body}`), 'blocked');
  assert.equal(screenState(`› stashed\n\n\n\n${body}`), 'ready'); // too far above to belong to the box
  assert.equal(screenState(`  ◐ medium · /effort\n${body}`), 'ready');
});

test('screenState reads a numbered-option dialog between two rules as blocked', () => {
  const rule = '─'.repeat(30);
  assert.equal(screenState([rule, '❯ 1. Yes', '  2. No', rule, 'Esc to cancel'].join('\n')), 'blocked');
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

test('SAFE_VALUE is the documented character set', () => {
  assert.equal(SAFE_VALUE.source, '^[A-Za-z0-9._\\[\\]-]+$');
});

test('tabInfo and typeInto refuse anything but a ttysNNN before touching AppleScript', async () => {
  for (const tty of ['', '/dev/ttys001', 'ttys', 'ttys1; rm', 'tty001', 'ttys1\n']) {
    await assert.rejects(tabInfo(tty), /tty/, `tabInfo ${JSON.stringify(tty)}`);
    await assert.rejects(typeInto(tty, '/model opus'), /tty/, `typeInto ${JSON.stringify(tty)}`);
  }
});

test('typeInto refuses text that is not a /model or /effort command', async () => {
  for (const text of ['', 'hello', '/model', '/model ', '/clear', '/model a b', '/model "x"', '/effort x\n', '/model a\n/clear', 'rm -rf /']) {
    await assert.rejects(typeInto('ttys001', text), /text/, JSON.stringify(text));
  }
});

test('pressKeys refuses anything but arrow runs before touching AppleScript', async () => {
  for (const keys of ['x', '\r', '\x1b', '\x1b[C', '\x1b[D', '1', `${KEY_DOWN}\n`, `${KEY_UP}a`, '/model opus', undefined]) {
    await assert.rejects(pressKeys('ttys001', keys), /keys/, JSON.stringify(keys));
  }
});

test('pressKeys refuses a bad tty', async () => {
  for (const tty of ['', '/dev/ttys001', 'ttys1; rm']) await assert.rejects(pressKeys(tty, KEY_DOWN), /tty/, JSON.stringify(tty));
});
