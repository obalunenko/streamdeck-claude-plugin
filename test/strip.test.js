const test = require('node:test');
const assert = require('node:assert/strict');

const { dots, stripView, Peek } = require('../src/strip');

const QUESTIONS = [
  {
    header: 'Storage',
    question: 'Where should the history live?',
    options: [
      { label: 'JSON file', description: 'One file in the cache' },
      { label: 'Memory only', description: 'Lost on restart' },
    ],
  },
  {
    header: 'Format',
    question: 'Which formats?',
    multiSelect: true,
    options: [
      { label: 'Pretty', description: 'Indented' },
      { label: 'Compact', description: 'One line' },
      { label: 'Gzip', description: 'Compressed' },
    ],
  },
  {
    header: 'Cleanup',
    question: 'When to clean up?',
    options: [
      { label: 'Never', description: 'Keep all' },
      { label: 'Weekly', description: 'Drop old ones' },
    ],
  },
];

// A request as the queue holds it, with the answered marks the deck computes.
function request(step, picked, answered = picked.map((p) => p.length > 0)) {
  return { questions: QUESTIONS, step, picked: picked.map((p) => new Set(p)), answered };
}

test('dots mark answered questions and bracket the current one', () => {
  assert.equal(dots([true, false, false], 1), '●[○]○');
  assert.equal(dots([true, true, false], 0), '[●]●○');
  assert.equal(dots([true, false], 2), '●○');
});

test('the strip shows the question with its position and dots', () => {
  assert.deepEqual(stripView(request(1, [[0], [], []])), {
    kind: 'question',
    head: 'Format · 2/3',
    side: '●[○]○',
    text: 'Which formats?',
  });
});

test('a lone question shows its header without position or dots', () => {
  const req = { questions: [QUESTIONS[0]], step: 0, picked: [new Set()], answered: [false] };
  assert.deepEqual(stripView(req), { kind: 'question', head: 'Storage', side: '', text: 'Where should the history live?' });
});

test('a question without a header is called Question', () => {
  const req = { questions: [{ ...QUESTIONS[0], header: '' }, QUESTIONS[1]], step: 0, picked: [new Set(), new Set()], answered: [false, false] };
  assert.equal(stripView(req).head, 'Question · 1/2');
});

test('a peeked option shows its number, label and description', () => {
  assert.deepEqual(stripView(request(0, [[], [], []]), 1), {
    kind: 'option',
    head: '2 · Memory only',
    side: 'Storage · 1/3',
    text: 'Lost on restart',
    picked: false,
  });
});

test('a peeked option says whether it is picked', () => {
  const view = stripView(request(1, [[0], [0, 2], []]), 2);
  assert.equal(view.head, '✓ 3 · Gzip');
  assert.equal(view.picked, true);
});

test('a peek past the options of the page shows the question', () => {
  assert.equal(stripView(request(0, [[], [], []]), 2).kind, 'question');
});

test('the review page lists every answer, open ones dashed', () => {
  assert.deepEqual(stripView(request(3, [[1], [2, 0], []])), {
    kind: 'review',
    head: 'Review your answers',
    side: '2/3 answered',
    rows: [
      { text: 'Storage → Memory only', open: false },
      { text: 'Format → Pretty, Gzip', open: false },
      { text: 'Cleanup → —', open: true },
    ],
  });
});

test('an answer typed in the terminal shows as answered without a label', () => {
  // The terminal's review page maps answers back to options by label; a typed
  // one matches none, yet the tab bar marks the question answered.
  const view = stripView(request(3, [[0], [], []], [true, true, false]));
  assert.deepEqual(view.rows[1], { text: 'Format → ✓', open: false });
  assert.equal(view.side, '2/3 answered');
});

test('the review page ignores a peek', () => {
  assert.equal(stripView(request(3, [[0], [1], [0]]), 0).kind, 'review');
});

// Collects timer callbacks; fire() runs the ones pending now.
function fakeTimers() {
  const pending = new Map();
  let id = 0;
  return {
    pending,
    setTimeout: (fn, ms) => (pending.set(++id, { fn, ms }), id),
    clearTimeout: (t) => pending.delete(t),
    fire() {
      const due = [...pending.values()];
      pending.clear();
      for (const t of due) t.fn();
    },
  };
}

function setup() {
  const timers = fakeTimers();
  const changes = { count: 0 };
  const peek = new Peek({ onChange: () => changes.count++, ms: 4000, timers });
  return { timers, changes, peek };
}

test('a touch shows the option on the request page it was made on', () => {
  // Each read elsewhere drops the option, so every case starts afresh.
  for (const [other, why] of [
    [{ id: 7, step: 2 }, 'another page'],
    [{ id: 8, step: 1 }, 'another request'],
    [null, 'no request'],
  ]) {
    const { peek, changes } = setup();
    const req = { id: 7, step: 1 };
    peek.toggle(req, 2);
    assert.equal(peek.option(req), 2);
    assert.equal(changes.count, 1);
    assert.equal(peek.option(other), -1, why);
  }
});

test('coming back to the page shows the question, not the old option', () => {
  const { peek, timers } = setup();
  peek.toggle({ id: 7, step: 1 }, 2);
  assert.equal(peek.option({ id: 7, step: 2 }), -1);
  assert.equal(peek.option({ id: 7, step: 1 }), -1);
  assert.equal(timers.pending.size, 0);
});

test('a touch on the option shown hides it', () => {
  const { peek, timers, changes } = setup();
  const req = { id: 7, step: 0 };
  peek.toggle(req, 1);
  peek.toggle(req, 1);
  assert.equal(peek.option(req), -1);
  assert.equal(timers.pending.size, 0);
  assert.equal(changes.count, 2);
});

test('the option hides after the peek time', () => {
  const { peek, timers, changes } = setup();
  const req = { id: 7, step: 0 };
  peek.toggle(req, 0);
  assert.deepEqual([...timers.pending.values()].map((t) => t.ms), [4000]);
  timers.fire();
  assert.equal(peek.option(req), -1);
  assert.equal(changes.count, 2);
});

test('another option restarts the peek time', () => {
  const { peek, timers } = setup();
  const req = { id: 7, step: 0 };
  peek.toggle(req, 0);
  peek.toggle(req, 1);
  assert.equal(timers.pending.size, 1);
  assert.equal(peek.option(req), 1);
  timers.fire();
  assert.equal(peek.option(req), -1);
});

test('show keeps the option up and restarts the peek time', () => {
  // A turn of the dial arrives as several events: each one shows, none hides.
  const { peek, timers } = setup();
  const req = { id: 7, step: 0 };
  peek.show(req, 1);
  peek.show(req, 1);
  assert.equal(peek.option(req), 1);
  assert.equal(timers.pending.size, 1);
  peek.show(req, 3);
  assert.equal(peek.option(req), 3);
  assert.equal(timers.pending.size, 1);
  timers.fire();
  assert.equal(peek.option(req), -1);
});

test('clear hides the option at once and only reports a change once', () => {
  const { peek, timers, changes } = setup();
  const req = { id: 7, step: 0 };
  peek.toggle(req, 0);
  peek.clear();
  peek.clear();
  assert.equal(peek.option(req), -1);
  assert.equal(timers.pending.size, 0);
  assert.equal(changes.count, 2);
});
