const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { Sessions, Tuner, parseModelList, matchModel, step } = require('../src/tune');
const { TerminalAccessError } = require('../src/terminal');

const screen = (n) => fs.readFileSync(path.join(__dirname, `fixtures/screen-${n}.txt`), 'utf8');

const LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];
const MODEL = { context: 'm', kind: 'model', items: ['fable', 'opus', 'sonnet'] };
const EFFORT = { context: 'e', kind: 'effort', items: [] };

const status = (id, dir, effort = 'high') => ({
  session_id: id,
  cwd: dir,
  model: { id: 'claude-opus-5-5', display_name: 'Opus 5.5' },
  ...(effort ? { effort: { level: effort } } : {}),
});

// Collects timer callbacks; flush() runs the ones pending now and awaits them.
function fakeTimers() {
  let now = 0;
  let id = 0;
  const pending = new Map();
  return {
    setTimeout: (fn) => (pending.set(++id, fn), id),
    clearTimeout: (h) => pending.delete(h),
    now: () => now,
    advance: (ms) => (now += ms),
    async flush() {
      for (const fn of this.take()) await fn();
    },
    // The pending callbacks, removed; the caller runs them.
    take() {
      const fns = [...pending.values()];
      pending.clear();
      return fns;
    },
  };
}

function setup({ front = 'ttys1', levels = LEVELS, effortA = 'high', pending } = {}) {
  const sessions = new Sessions();
  sessions.report('ttys1', status('A', '/Users/me/proj-a', effortA));
  sessions.report('ttys2', status('B', '/Users/me/proj-b'));
  const fake = {
    front,
    infos: {
      ttys1: { processes: ['login', '-zsh', 'claude'], screen: screen('idle') },
      ttys2: { processes: ['login', '-zsh', 'claude'], screen: screen('idle') },
    },
    typeError: null,
  };
  const sent = [];
  const terminal = {
    frontTab: async () => fake.front,
    tabInfo: async (tty) => fake.infos[tty] ?? null,
    typeInto: async (tty, text) => {
      if (fake.typeError) throw fake.typeError;
      sent.push([tty, text]);
    },
  };
  const timers = fakeTimers();
  const changes = { count: 0 };
  const tuner = new Tuner({ sessions, terminal, levels: () => levels, onChange: () => changes.count++, timers, pending });
  return { sessions, fake, sent, timers, changes, tuner };
}

async function turn(tuner, dial, ticks, times) {
  for (let i = 0; i < times; i++) await tuner.rotate(dial, ticks);
}

test('parseModelList drops blank and unsafe lines', () => {
  assert.deepEqual(parseModelList(' opus \n\nsonnet[1m]\nbad value\nx;y\nopus\n'), ['opus', 'sonnet[1m]']);
});

test('matchModel prefers the exact id, then a contained alias', () => {
  assert.equal(matchModel(['opus', 'claude-opus-5-5'], { id: 'claude-opus-5-5', name: 'Opus 5.5' }), 1);
  assert.equal(matchModel(['sonnet', 'opus'], { id: 'claude-opus-5-5', name: 'Opus 5.5' }), 1);
  assert.equal(matchModel(['fable'], { id: 'claude-opus-5', name: 'Opus 5' }), -1);
  // Of two contained items the first wins, as the Property Inspector hint says.
  assert.equal(matchModel(['claude-opus-5', 'opus'], { id: 'claude-opus-5-5' }), 0);
  assert.equal(matchModel(['opus', 'claude-opus-5'], { id: 'claude-opus-5-5' }), 0);
});

test('step from unknown lands on the first item', () => assert.equal(step(3, -1, 5, true), 0));

test('step wraps models and clamps effort', () => {
  assert.equal(step(3, 2, 1, true), 0);
  assert.equal(step(5, 4, 3, false), 4);
  assert.equal(step(5, 0, -2, false), 0);
});

test('Sessions replaces the entry when a tty reports a new session', () => {
  const sessions = new Sessions();
  sessions.report('ttys1', status('A', '/Users/me/proj-a'));
  sessions.report('ttys1', status('B', '/Users/me/proj-b'));
  assert.equal(sessions.get('ttys1').sessionId, 'B');
  assert.deepEqual(sessions.ttys(), ['ttys1']);
});

test('Sessions keeps only string fields of a statusline report', () => {
  const sessions = new Sessions();
  const odd = { toString: 1 };
  sessions.report('ttys1', {
    session_id: 'A',
    cwd: odd,
    workspace: { current_dir: '/Users/me/proj-a' },
    model: { id: 'claude-opus-5-5', display_name: odd },
    effort: { level: odd },
  });
  assert.deepEqual(sessions.get('ttys1'), {
    tty: 'ttys1',
    sessionId: 'A',
    project: 'proj-a',
    model: { id: 'claude-opus-5-5', name: null },
    effort: null,
    context: null,
    busy: false,
  });
  sessions.report('ttys2', { session_id: 'B', cwd: 7, workspace: { current_dir: [] }, model: { id: odd }, effort: { level: 'x;y' } });
  assert.deepEqual(sessions.get('ttys2'), { tty: 'ttys2', sessionId: 'B', project: null, model: null, effort: null, context: null, busy: false });
  sessions.report('ttys2', { session_id: 'B', effort: { level: 3 } });
  assert.equal(sessions.get('ttys2').effort, null);
});

test('Sessions ignores a report without a string session_id', () => {
  const sessions = new Sessions();
  sessions.report('ttys1', status('A', '/Users/me/proj-a'));
  for (const bad of [[], { session_id: 1 }, { session_id: { toString: 1 } }, { cwd: '/x' }]) sessions.report('ttys1', bad);
  sessions.report('ttys2', []);
  sessions.report('ttys2', { session_id: null, cwd: '/Users/me/proj-b' });
  assert.equal(sessions.get('ttys1').sessionId, 'A');
  assert.equal(sessions.get('ttys1').project, 'proj-a');
  assert.equal(sessions.get('ttys2'), undefined);
});

test('Sessions keeps a numeric context percentage only', () => {
  const sessions = new Sessions();
  sessions.report('ttys1', { ...status('A', '/Users/me/proj-a'), context_window: { used_percentage: 42.5 } });
  assert.equal(sessions.get('ttys1').context, 42.5);
  sessions.report('ttys1', { ...status('A', '/Users/me/proj-a'), context_window: { used_percentage: '42' } });
  assert.equal(sessions.get('ttys1').context, null);
  sessions.report('ttys1', status('A', '/Users/me/proj-a'));
  assert.equal(sessions.get('ttys1').context, null);
});

test('Sessions latest falls back to the next most recent session', () => {
  const sessions = new Sessions();
  assert.equal(sessions.latest(), null);
  sessions.report('ttys1', status('A', '/Users/me/proj-a'));
  sessions.report('ttys2', status('B', '/Users/me/proj-b'));
  assert.equal(sessions.latest().tty, 'ttys2');
  sessions.drop('ttys2');
  assert.equal(sessions.latest().tty, 'ttys1');
  sessions.report('ttys2', status('B', '/Users/me/proj-b'));
  sessions.report('ttys1', status('A', '/Users/me/proj-a'));
  sessions.end('A');
  assert.equal(sessions.latest().tty, 'ttys2');
  sessions.end('B');
  assert.equal(sessions.latest(), null);
});

test('Tuner view holds only strings or null after a malformed report', async () => {
  const { sessions, tuner } = setup();
  const odd = { toString: 1 };
  sessions.report('ttys1', { session_id: 'A', cwd: odd, model: { id: 'claude-opus-5-5', display_name: odd }, effort: { level: odd } });
  await tuner.refresh();
  for (const dial of [MODEL, EFFORT]) {
    const v = tuner.view(dial);
    for (const key of ['value', 'project', 'notice']) assert.ok(v[key] === null || typeof v[key] === 'string', `${dial.kind}.${key}`);
  }
  assert.equal(tuner.view(MODEL).value, 'claude-opus-5-5');
});

test('Tuner sends one command after the dial stops', async () => {
  const { sent, timers, tuner } = setup();
  await turn(tuner, MODEL, 1, 2); // opus → sonnet → fable
  assert.equal(tuner.view(MODEL).value, 'fable');
  assert.equal(tuner.view(MODEL).pending, true);
  await timers.flush();
  assert.deepEqual(sent, [['ttys1', '/model fable']]);
  assert.equal(tuner.view(MODEL).pending, false);
});

test('Tuner counts ticks that arrive while the target is looked up', async () => {
  const { sent, timers, tuner } = setup();
  await Promise.all([tuner.rotate(MODEL, 1), tuner.rotate(MODEL, 1)]);
  await timers.flush();
  assert.deepEqual(sent, [['ttys1', '/model fable']]);
});

test('Tuner moves on the first tick', async () => {
  const { sent, timers, tuner } = setup();
  await tuner.rotate(MODEL, 1);
  assert.equal(tuner.view(MODEL).value, 'sonnet');
  await timers.flush();
  assert.deepEqual(sent, [['ttys1', '/model sonnet']]);
});

test('Tuner sends nothing when the dial ends on the current value', async () => {
  const { sent, timers, tuner } = setup();
  await tuner.rotate(MODEL, 1);
  await tuner.rotate(MODEL, -1);
  assert.equal(tuner.view(MODEL).value, 'opus');
  await timers.flush();
  assert.deepEqual(sent, []);
});

test('Tuner does not send when the target changed', async () => {
  const { fake, sent, timers, tuner } = setup();
  await turn(tuner, MODEL, 1, 2);
  fake.front = 'ttys2';
  await timers.flush();
  assert.deepEqual(sent, []);
  assert.equal(tuner.view(MODEL).pending, false);
});

test('Tuner view follows a front-tab change without rotation', async () => {
  const { fake, timers, changes, tuner } = setup();
  await tuner.refresh();
  assert.equal(tuner.view(MODEL).project, 'proj-a');
  changes.count = 0;
  fake.front = 'ttys2';
  timers.advance(2000);
  await tuner.refresh();
  assert.equal(tuner.view(MODEL).project, 'proj-b');
  assert.equal(changes.count, 1);
});

test('Tuner shows busy and drops the value on a blocked screen', async () => {
  const { fake, sent, timers, tuner } = setup();
  fake.infos.ttys1.screen = screen('dialog');
  await turn(tuner, MODEL, 1, 2);
  await timers.flush();
  assert.deepEqual(sent, []);
  assert.equal(tuner.view(MODEL).notice, 'busy');
  assert.equal(tuner.view(MODEL).pending, false);
  await turn(tuner, MODEL, 1, 2); // turning again replaces the notice
  assert.equal(tuner.view(MODEL).notice, null);
  assert.equal(tuner.view(MODEL).pending, true);
});

test('Tuner shows busy during a turn even though the screen looks ready', async () => {
  const { fake, sessions, sent, timers, tuner } = setup();
  sessions.turn('A', true);
  fake.infos.ttys1.screen = screen('streaming');
  await turn(tuner, MODEL, 1, 2);
  await timers.flush();
  assert.deepEqual(sent, []);
  assert.equal(tuner.view(MODEL).notice, 'busy');
});

test('Tuner treats an interrupted turn as over', async () => {
  const { fake, sessions, sent, timers, tuner } = setup();
  sessions.turn('A', true);
  fake.infos.ttys1.screen = screen('interrupted');
  await turn(tuner, MODEL, 1, 2);
  await timers.flush();
  assert.deepEqual(sent, [['ttys1', '/model fable']]);
  assert.equal(sessions.get('ttys1').busy, false);
});

test('Tuner view shows no session for an unregistered front tab', async () => {
  const { sent, timers, tuner } = setup({ front: 'ttys9' });
  await tuner.refresh();
  assert.equal(tuner.view(MODEL).notice, 'no session');
  await turn(tuner, MODEL, 1, 2);
  await timers.flush();
  assert.deepEqual(sent, []);
  assert.equal(tuner.view(MODEL).notice, 'no session');
});

test('Tuner falls back to the session chosen on the deck', async () => {
  const { sent, timers, tuner } = setup({ front: null });
  assert.equal(await tuner.press(), true);
  assert.equal(tuner.view(MODEL).project, 'proj-a'); // ttys1, the first reported
  await turn(tuner, MODEL, 1, 2);
  await timers.flush();
  assert.deepEqual(sent, [['ttys1', '/model fable']]);
  assert.equal(tuner.view(MODEL).chosen, true);
});

test('Tuner press alerts when the front tab is a session', async () => {
  const { tuner } = setup();
  assert.equal(await tuner.press(), false);
});

test('Tuner clears the chosen tab when it no longer runs claude', async () => {
  const { fake, sessions, sent, timers, tuner } = setup({ front: null });
  await tuner.press();
  fake.infos.ttys1.processes = ['-zsh'];
  await turn(tuner, MODEL, 1, 2);
  await timers.flush();
  assert.deepEqual(sent, []);
  assert.equal(tuner.view(MODEL).notice, 'no session');
  assert.equal(sessions.get('ttys1'), undefined);
});

test('Tuner effort dial without effort shows dash', async () => {
  const { sent, timers, tuner } = setup({ effortA: null });
  await tuner.refresh();
  assert.equal(tuner.view(EFFORT).notice, '—');
  await turn(tuner, EFFORT, 1, 2);
  await timers.flush();
  assert.deepEqual(sent, []);
});

test('Tuner effort dial without levels shows no claude', async () => {
  const { sent, timers, tuner } = setup({ levels: [] });
  await tuner.refresh();
  assert.equal(tuner.view(EFFORT).notice, 'no claude');
  await turn(tuner, EFFORT, 1, 2);
  await timers.flush();
  assert.deepEqual(sent, []);
});

test('Tuner clamps effort at the top', async () => {
  const { sent, timers, tuner } = setup();
  await turn(tuner, EFFORT, 1, 6); // high → xhigh → max, then stays
  await timers.flush();
  assert.deepEqual(sent, [['ttys1', '/effort max']]);
});

test('Tuner never sends into a dialog opened by the other dial', async () => {
  const { fake, sent, timers, tuner } = setup();
  const later = () => new Promise((resolve) => setImmediate(resolve));
  const terminal = tuner.terminal;
  const { tabInfo, typeInto } = terminal;
  terminal.tabInfo = async (tty) => (await later(), tabInfo(tty));
  terminal.typeInto = async (tty, text) => {
    await later();
    await typeInto(tty, text);
    if (text.startsWith('/model ')) fake.infos[tty].screen = screen('dialog'); // the /model confirmation
  };
  await tuner.rotate(MODEL, 1);
  await tuner.rotate(EFFORT, 1);
  const [model, effort] = timers.take().map((fire) => fire()); // both debounce timers at once
  await model;
  for (let i = 0; i < 5; i++) await later();
  assert.equal(tuner.view(EFFORT).pending, true); // held until the settle delay ends
  await timers.flush(); // the settle delay after the model send
  await effort;
  assert.deepEqual(sent, [['ttys1', '/model sonnet']]);
  assert.equal(tuner.view(EFFORT).notice, 'busy');
});

test('Tuner reports no access when Terminal refuses', async () => {
  const { fake, sent, timers, tuner } = setup();
  fake.typeError = new TerminalAccessError();
  await turn(tuner, MODEL, 1, 2);
  await timers.flush();
  assert.deepEqual(sent, []);
  assert.equal(tuner.view(MODEL).notice, 'no access');
});

test('Tuner holds the next send for the settle delay when a send fails after typing', async () => {
  const { sent, timers, tuner } = setup();
  const later = () => new Promise((resolve) => setImmediate(resolve));
  const terminal = tuner.terminal;
  const { typeInto } = terminal;
  let boom = false;
  terminal.typeInto = async (tty, text) => {
    await typeInto(tty, text);
    boom = true; // the render after this send throws
  };
  tuner.onChange = () => {
    if (!boom) return;
    boom = false;
    throw new Error('render failed');
  };
  await tuner.rotate(MODEL, 1);
  await tuner.rotate(EFFORT, 1);
  const [model, effort] = timers.take().map((fire) => fire());
  assert.equal(await model, true); // typed, though the attempt threw afterwards
  for (let i = 0; i < 5; i++) await later();
  assert.deepEqual(sent, [['ttys1', '/model sonnet']]); // held until the settle delay ends
  assert.equal(tuner.view(EFFORT).pending, true);
  await timers.flush(); // the settle delay after the model send
  await effort;
  assert.deepEqual(sent, [
    ['ttys1', '/model sonnet'],
    ['ttys1', '/effort xhigh'],
  ]);
});

test('Tuner types nothing while the session has a request on the deck', async () => {
  const asked = [];
  const { sent, timers, tuner } = setup({ pending: (id) => (asked.push(id), true) });
  await turn(tuner, MODEL, 1, 2);
  await timers.flush();
  assert.deepEqual(sent, []);
  assert.deepEqual(asked, ['A']);
  assert.equal(tuner.view(MODEL).notice, 'busy');
});

test('Tuner types when no request of the session is on the deck', async () => {
  const { sent, timers, tuner } = setup({ pending: (id) => id === 'B' });
  await turn(tuner, MODEL, 1, 2);
  await timers.flush();
  assert.deepEqual(sent, [['ttys1', '/model fable']]);
});

test('Tuner session is the target session', async () => {
  const { tuner } = setup();
  await tuner.refresh();
  assert.equal(tuner.session().sessionId, 'A');
});

test('Tuner session falls back to null without a target', async () => {
  const { tuner } = setup({ front: 'ttys9' });
  await tuner.refresh();
  assert.equal(tuner.session(), null);
});
