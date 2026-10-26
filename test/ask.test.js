const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parseDialog, matches, pageOf, planPress, Asker } = require('../src/ask');
const { KEY_UP, KEY_DOWN, TerminalAccessError } = require('../src/terminal');
const { Sessions } = require('../src/tune');

const ask = (n) => fs.readFileSync(path.join(__dirname, `fixtures/ask-${n}.txt`), 'utf8');
const screen = (n) => fs.readFileSync(path.join(__dirname, `fixtures/screen-${n}.txt`), 'utf8');

test('parseDialog reads a fresh single-select page', () => {
  const d = parseDialog(ask('color'));
  assert.deepEqual(d.tabs, [
    { header: 'Color', answered: false },
    { header: 'Snacks', answered: false },
    { header: 'Size', answered: false },
  ]);
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
  // ❯ on Next cannot be captured through do script (spec fact 17); move it there by hand
  const onNext = parseDialog(ask('snacks').replace('❯ 1. [✔] Chips', '  1. [✔] Chips').replace(/^ {5}Next$/m, '   ❯ Next'));
  assert.equal(onNext.items[onNext.highlight].kind, 'next');
});

test('parseDialog reads a four-option page', () => {
  const d = parseDialog(ask('four'));
  assert.deepEqual(d.items.filter((i) => i.kind === 'option').map((i) => i.label), ['Hammer', 'Saw', 'Drill', 'Tape']);
  assert.equal(d.items.findIndex((i) => i.kind === 'next'), 5);
});

test('parseDialog reads the review page', () => {
  const d = parseDialog(ask('review'));
  assert.deepEqual(d.page, {
    kind: 'review',
    answers: [
      { question: 'Which color for the probe?', answer: 'Red' },
      { question: 'Which snacks for the probe?', answer: 'Chips' },
      { question: 'Which size for the probe?', answer: 'Large' },
    ],
  });
  assert.deepEqual(d.items.map((i) => i.kind), ['submit', 'cancel']);
  assert.equal(d.highlight, 0);
});

test('parseDialog reads a review page with an open question', () => {
  const d = parseDialog(ask('review-open'));
  assert.deepEqual(d.tabs.map((t) => t.answered), [false, true]);
  assert.deepEqual(d.page.answers, [{ question: 'Which size for the probe?', answer: 'Large' }]);
});

test('parseDialog reads a one-question set with its short tab bar', () => {
  const d = parseDialog(ask('one'));
  assert.deepEqual(d.tabs, [{ header: 'Color', answered: false }]);
  assert.deepEqual(d.page, { kind: 'question', question: 'Which color for the probe?', multi: false });
  assert.equal(d.highlight, 0);
});

test('parseDialog ignores a dialog left in the scrollback', () => {
  const rule = '─'.repeat(40);
  assert.equal(parseDialog(`${ask('color')}\n⏺ User declined to answer questions\n${rule}\n❯ \n${rule}\n`), null);
  for (const n of ['idle', 'dialog', 'model-confirm']) assert.equal(parseDialog(screen(n)), null, n);
  assert.equal(parseDialog(''), null);
});

test('parseDialog joins a wrapped question and keeps option numbers', () => {
  const narrow = ask('color').replace('Which color for the probe?', 'Which color for\nthe probe?').replace('2. Green', '2. Gr\n     een');
  const d = parseDialog(narrow);
  assert.equal(d.page.question, 'Which color for the probe?');
  assert.deepEqual(d.items.filter((i) => i.kind === 'option').map((i) => i.option), [0, 1, 2]);
});

test('parseDialog needs exactly one highlighted item', () => {
  assert.equal(parseDialog(ask('color').replace('❯ 1. Red', '  1. Red')), null);
  assert.equal(parseDialog(ask('color').replace('  2. Green', '❯ 2. Green')), null);
});

const QS = [
  { question: 'Which color for the probe?', header: 'Color', multiSelect: false, options: [{ label: 'Red' }, { label: 'Green' }, { label: 'Blue' }] },
  { question: 'Which snacks for the probe?', header: 'Snacks', multiSelect: true, options: [{ label: 'Chips' }, { label: 'Nuts' }, { label: 'Fruit' }] },
  { question: 'Which size for the probe?', header: 'Size', multiSelect: false, options: [{ label: 'Small' }, { label: 'Large' }] },
];
const TOOLS = [
  { question: 'Which tools for the probe?', header: 'Tools', multiSelect: true, options: ['Hammer', 'Saw', 'Drill', 'Tape'].map((label) => ({ label })) },
  QS[2],
];

test('matches only this request', () => {
  assert.equal(matches(parseDialog(ask('color')), QS), true);
  assert.equal(matches(parseDialog(ask('review')), QS), true);
  assert.equal(matches(parseDialog(ask('one')), [QS[0]]), true);
  assert.equal(matches(parseDialog(ask('color')), [QS[0], QS[2], QS[1]]), false);
  assert.equal(matches(parseDialog(ask('color')), [{ ...QS[0], options: [{ label: 'Pink' }, { label: 'Green' }, { label: 'Blue' }] }, QS[1], QS[2]]), false);
  assert.equal(matches(parseDialog(ask('color')), [{ ...QS[0], options: QS[0].options.slice(0, 2) }, QS[1], QS[2]]), false);
  assert.equal(matches(parseDialog(ask('one')), QS), false);
  assert.equal(matches(null, QS), false);
});

test('pageOf names the page', () => {
  assert.equal(pageOf(parseDialog(ask('color')), QS), 0);
  assert.equal(pageOf(parseDialog(ask('snacks')), QS), 1);
  assert.equal(pageOf(parseDialog(ask('size')), QS), 2);
  assert.equal(pageOf(parseDialog(ask('review')), QS), 3);
  assert.equal(pageOf(parseDialog(ask('four')), QS), -1);
});

test('planPress moves down or up without wrapping', () => {
  const color = parseDialog(ask('color')); // ❯ on Red
  assert.equal(planPress(color, QS, { kind: 'option', option: 0 }), '');
  assert.equal(planPress(color, QS, { kind: 'option', option: 2 }), KEY_DOWN + KEY_DOWN);
  const other = parseDialog(ask('snacks-other')); // ❯ on Type something
  assert.equal(planPress(other, QS, { kind: 'option', option: 0 }), KEY_UP.repeat(3));
  assert.equal(planPress(other, QS, { kind: 'next' }), KEY_DOWN);
  assert.equal(planPress(parseDialog(ask('four')), TOOLS, { kind: 'next' }), KEY_DOWN.repeat(5));
});

test('planPress refuses what would need a guess', () => {
  const color = parseDialog(ask('color'));
  // single-select: the deck's memory of a pick may be stale; the option key moves on instead
  assert.equal(planPress(color, QS, { kind: 'next' }, 1), null); // even with a remembered pick
  assert.equal(planPress(color, QS, { kind: 'submit' }), null);
  assert.equal(planPress(color, QS, { kind: 'option', option: 3 }), null); // no such option
  assert.equal(planPress(parseDialog(ask('review')), QS, { kind: 'submit' }), '');
  assert.equal(planPress(parseDialog(ask('review')), QS, { kind: 'option', option: 0 }), null);
  assert.equal(planPress(parseDialog(ask('review')), QS, { kind: 'next' }), null);
  assert.equal(planPress(parseDialog(ask('four')), QS, { kind: 'option', option: 0 }), null); // not this request
});

test('planPress does not submit while a question is open', () => {
  assert.equal(planPress(parseDialog(ask('review-open')), TOOLS, { kind: 'submit' }), null);
});

// A Terminal tab that shows `screens` one per read (the last one stays), and
// records what is typed into it.
function fakeTerminal(screens, processes = ['login', '-zsh', 'claude']) {
  const calls = { reads: 0, typed: [] };
  return {
    calls,
    tabInfo: async () => {
      const s = screens[Math.min(calls.reads++, screens.length - 1)];
      if (s instanceof Error) throw s;
      if (s === null) return null; // no tab with that tty
      return { processes, screen: s };
    },
    pressKeys: async (tty, keys) => {
      calls.typed.push([tty, keys]);
    },
  };
}

// Virtual time: a timer fires at once and moves the clock by its delay.
function clock() {
  let now = 0;
  return {
    now: () => now,
    setTimeout: (fn, ms) => {
      now += ms;
      Promise.resolve().then(fn);
    },
    advance: (ms) => (now += ms),
  };
}

function asker(screens, { processes, session = 's1', onChange, log } = {}) {
  const sessions = new Sessions();
  sessions.report('ttys005', { session_id: session, cwd: '/tmp/probe' });
  const terminal = fakeTerminal(screens, processes);
  const timers = clock();
  return { asker: new Asker({ sessions, terminal, timers, onChange, log }), terminal, timers };
}

const request = (questions = QS) => ({
  session: 's1',
  questions,
  step: 0,
  picked: questions.map(() => new Set()),
  path: 'probing',
  closed: false,
  tty: null,
  answered: null,
  own: false,
  lostAt: null,
});

test('attach puts the request on the terminal path when the tab shows its dialog', async () => {
  const { asker: a } = asker([ask('color')]);
  const req = request();
  assert.equal(await a.attach(req), true);
  assert.equal(req.path, 'terminal');
  assert.equal(req.tty, 'ttys005');
  assert.deepEqual(req.answered, [false, false, false]);
});

test('attach leaves an unknown session or a foreign dialog on the hook path', async () => {
  const unknown = asker([ask('color')], { session: 'other' });
  const req = request();
  assert.equal(await unknown.asker.attach(req), false);
  assert.equal(req.path, 'hook');
  assert.equal(unknown.terminal.calls.reads, 0);

  const foreign = asker([ask('four')]);
  const req2 = request();
  assert.equal(await foreign.asker.attach(req2), false);
  assert.equal(req2.path, 'hook');
  assert.ok(foreign.terminal.calls.reads > 1, 'kept looking until detectFor');
});

test('press types the planned keys and follows the next page', async () => {
  const { asker: a, terminal } = asker([ask('color'), ask('color'), ask('snacks')]);
  const req = request();
  await a.attach(req);
  assert.equal(await a.press(req, { kind: 'option', option: 1 }, 0), true);
  assert.deepEqual(terminal.calls.typed, [['ttys005', KEY_DOWN]]);
  assert.equal(req.step, 1);
  assert.deepEqual([...req.picked[0]], [1]);
  assert.deepEqual([...req.picked[1]], [0]); // Chips is checked on the screen
});

test('a press made on a page the terminal has left types nothing', async () => {
  const { asker: a, terminal } = asker([ask('color'), ask('snacks')]);
  const req = request();
  await a.attach(req);
  assert.equal(await a.press(req, { kind: 'option', option: 0 }, 0), false);
  assert.deepEqual(terminal.calls.typed, []);
  assert.equal(req.step, 1, 'the deck follows the terminal instead');
});

test('a tab without claude or a refused Terminal sends the request to the hook path', async () => {
  const gone = asker([ask('color')]);
  const req = request();
  await gone.asker.attach(req);
  gone.terminal.tabInfo = async () => ({ processes: ['login', '-zsh'], screen: ask('color') });
  assert.equal(await gone.asker.press(req, { kind: 'option', option: 0 }, 0), false);
  assert.equal(req.path, 'hook');
  assert.deepEqual(gone.terminal.calls.typed, []);

  const refused = asker([ask('color'), new TerminalAccessError()]);
  const req2 = request();
  await refused.asker.attach(req2);
  assert.equal(await refused.asker.press(req2, { kind: 'option', option: 0 }, 0), false);
  assert.equal(req2.path, 'hook');
  assert.deepEqual(refused.terminal.calls.typed, []);
});

test('a keyboard page change forgets the deck\'s single-select pick', async () => {
  const { asker: a } = asker([ask('color'), ask('snacks')]);
  const req = request();
  await a.attach(req);
  req.picked[0] = new Set([1]);
  await a.follow(req);
  assert.equal(req.picked[0].size, 0);

  const own = asker([ask('color'), ask('snacks')]);
  const req2 = request();
  await own.asker.attach(req2);
  req2.picked[0] = new Set([1]);
  req2.own = true;
  await own.asker.follow(req2);
  assert.deepEqual([...req2.picked[0]], [1]);
});

test('follow takes the picks from the review page', async () => {
  const { asker: a } = asker([ask('color'), ask('review')]);
  const req = request();
  await a.attach(req);
  await a.follow(req);
  assert.equal(req.step, 3);
  assert.deepEqual(req.picked.map((p) => [...p]), [[0], [0], [1]]);
});

test('follow falls back to the hook path only after the grace period', async () => {
  const { asker: a, timers } = asker([ask('color'), screen('idle')]);
  const req = request();
  await a.attach(req);
  await a.follow(req);
  assert.equal(req.path, 'terminal');
  timers.advance(2000);
  await a.follow(req);
  assert.equal(req.path, 'hook');
  assert.equal(req.answered, null);
});

const ONE_MULTI = [QS[1]];
const LAST_MULTI = [QS[0], QS[1]];

test('the multi-select button reads Submit on the last page and still means Next', () => {
  for (const [n, qs] of [['last-multi', LAST_MULTI], ['one-multi', ONE_MULTI]]) {
    const d = parseDialog(ask(n));
    assert.deepEqual(d.items.map((i) => i.kind), ['option', 'option', 'option', 'other', 'next', 'chat'], n);
    assert.equal(matches(d, qs), true, n);
    assert.equal(planPress(d, qs, { kind: 'next' }), KEY_DOWN.repeat(4), n);
  }
});

test('parseDialog takes the button only in its slot after Type something', () => {
  // an option description that reads "Next" is not an item: Later stays one step down
  const d = parseDialog(ask('color').replace(/^ {5}warm$/m, '     Next'));
  assert.deepEqual(d.items.map((i) => i.kind), ['option', 'option', 'option', 'other', 'chat']);
  assert.equal(planPress(d, QS, { kind: 'option', option: 1 }), KEY_DOWN);
  // a multi-select page without its button, or a single-select page with one, is not a dialog we know
  assert.equal(parseDialog(ask('snacks').replace(/^ {5}Next$/m, '')), null);
  assert.equal(parseDialog(ask('color').replace('  4. Type something.', '  4. Type something.\n     Next')), null);
});

test('parseDialog reads the review items only below its question', () => {
  // a wrapped answer that looks like a numbered item does not become one
  const d = parseDialog(ask('review').replace('   → Large', '   → Large\n     2. test'));
  assert.deepEqual(d.items.map((i) => i.kind), ['submit', 'cancel']);
  assert.equal(planPress(d, QS, { kind: 'submit' }), '');
  assert.equal(parseDialog(ask('review').replace('  2. Cancel', '  2. Cancel\n  3. More')), null);
});

test('matches needs the same kind of question', () => {
  assert.equal(matches(parseDialog(ask('color')), [{ ...QS[0], multiSelect: true }, QS[1], QS[2]]), false);
});

test('attach gives up at once when the tab does not run claude or is gone', async () => {
  for (const [screens, processes] of [[[ask('color')], ['login', '-zsh']], [[null], undefined]]) {
    const { asker: a, terminal } = asker(screens, { processes });
    const req = request();
    assert.equal(await a.attach(req), false);
    assert.equal(req.path, 'hook');
    assert.equal(terminal.calls.reads, 1);
  }
});

test('a request closed while a press reads the screen types nothing', async () => {
  const { asker: a, terminal } = asker([ask('color')]);
  const req = request();
  await a.attach(req);
  const read = terminal.tabInfo;
  terminal.tabInfo = async () => {
    req.closed = true; // a deck Deny answered it meanwhile
    return read();
  };
  assert.equal(await a.press(req, { kind: 'option', option: 1 }, 0), false);
  assert.deepEqual(terminal.calls.typed, []);
});

test('after runs once the press in flight is done', async () => {
  const { asker: a, terminal } = asker([ask('color'), ask('color'), ask('snacks')]);
  const req = request();
  await a.attach(req);
  const order = [];
  const type = terminal.pressKeys;
  terminal.pressKeys = async (...args) => {
    order.push('typed');
    return type(...args);
  };
  await Promise.all([a.press(req, { kind: 'option', option: 1 }, 0), a.after(() => order.push('deny'))]);
  assert.deepEqual(order, ['typed', 'deny']);
});

test('a failing redraw never rejects a press or a follow', async () => {
  const logged = [];
  const onChange = () => {
    throw new Error('render failed');
  };
  const { asker: a } = asker([ask('color'), ask('color'), ask('snacks'), ask('review')], { onChange, log: (m) => logged.push(m) });
  const req = request();
  await a.attach(req);
  await assert.doesNotReject(a.press(req, { kind: 'option', option: 1 }, 1)); // wrong page: syncs, redraws
  await assert.doesNotReject(a.follow(req));
  assert.ok(logged.some((m) => m.includes('render failed')));
});

test('a follow still reading is not queued again', async () => {
  const { asker: a, terminal } = asker([ask('color')]);
  const req = request();
  await a.attach(req);
  const before = terminal.calls.reads;
  await Promise.all([a.follow(req), a.follow(req), a.follow(req)]);
  assert.equal(terminal.calls.reads - before, 1);
});

test('a keyboard arrival forgets the deck\'s pick on the page it lands on', async () => {
  // ← + Enter in the terminal may have changed Color between two reads
  const { asker: a } = asker([ask('snacks'), ask('color')]);
  const req = request();
  await a.attach(req);
  req.picked[0] = new Set([1]);
  await a.follow(req);
  assert.equal(req.step, 0);
  assert.equal(req.picked[0].size, 0);
});

test('refused access is logged once until Terminal answers again', async () => {
  const logged = [];
  const refused = new TerminalAccessError();
  const { asker: a } = asker([refused, refused, ask('color'), refused], { log: (m) => logged.push(m) });
  const count = () => logged.filter((m) => /refused/.test(m)).length;
  await a.attach(request());
  await a.attach(request());
  assert.equal(count(), 1);
  const req = request();
  assert.equal(await a.attach(req), true);
  await a.follow(req);
  assert.equal(req.path, 'hook');
  assert.equal(count(), 2);
});

test('a press typed before access was refused still counts', async () => {
  const { asker: a, terminal } = asker([ask('color'), ask('color'), new TerminalAccessError()]);
  const req = request();
  await a.attach(req);
  assert.equal(await a.press(req, { kind: 'option', option: 1 }, 0), true);
  assert.deepEqual(terminal.calls.typed, [['ttys005', KEY_DOWN]]);
  assert.equal(req.path, 'hook');
});
