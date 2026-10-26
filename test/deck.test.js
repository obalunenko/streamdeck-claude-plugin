const test = require('node:test');
const assert = require('node:assert/strict');

const { ACTIONS, OPTION_ACTIONS, deckQuestions, terminalKey, needsFrontTab, needsUsageCache } = require('../src/deck');

const question = (n) => ({ question: 'q', header: 'h', options: Array.from({ length: n }, (_, i) => ({ label: `o${i}` })) });
const request = (path, step = 0) => ({ path, step, questions: [question(2), question(3)] });

test('deckQuestions takes sets whose questions all have one to four options', () => {
  const qs = [question(2), question(4)];
  assert.equal(deckQuestions({ questions: qs }), qs);
  assert.equal(deckQuestions({ questions: [question(2), question(5)] }), null);
  assert.equal(deckQuestions({ questions: [question(0)] }), null);
  assert.equal(deckQuestions({ questions: [{ question: 'q' }] }), null);
  assert.equal(deckQuestions({ questions: [] }), null);
  assert.equal(deckQuestions({}), null);
});

test('Deny answers through the hook on the probing and the terminal path', () => {
  assert.equal(terminalKey(request('probing'), ACTIONS.deny), 'hook');
  assert.equal(terminalKey(request('terminal'), ACTIONS.deny), 'hook');
});

test('while the dialog is probed every other key only alerts', () => {
  for (const action of [ACTIONS.allow, ACTIONS.always, ...OPTION_ACTIONS]) {
    assert.equal(terminalKey(request('probing'), action), 'alert');
  }
});

test('on the terminal path option keys and Allow become presses, Back alerts', () => {
  assert.deepEqual(terminalKey(request('terminal'), OPTION_ACTIONS[2]), { kind: 'option', option: 2 });
  assert.deepEqual(terminalKey(request('terminal', 1), ACTIONS.allow), { kind: 'next' });
  assert.deepEqual(terminalKey(request('terminal', 2), ACTIONS.allow), { kind: 'submit' });
  assert.equal(terminalKey(request('terminal', 1), ACTIONS.always), 'alert');
});

test('the hook path is left to the deck', () => {
  assert.equal(terminalKey(request('hook'), ACTIONS.deny), null);
  assert.equal(terminalKey(request('hook'), OPTION_ACTIONS[0]), null);
});

test('only a dial or a Usage action showing Context needs the front tab', () => {
  const usage = (metrics) => ({ action: ACTIONS.usage, settings: { metrics } });
  assert.equal(needsFrontTab([usage(['five_hour', 'seven_day', 'scoped'])]), false);
  assert.equal(needsFrontTab([{ action: ACTIONS.allow, settings: {} }]), false);
  assert.equal(needsFrontTab([]), false);
  assert.equal(needsFrontTab([usage(['context'])]), true);
  assert.equal(needsFrontTab([{ action: ACTIONS.tune, settings: {} }]), true);
});

test('the cache file is wanted only while a Usage action shows a limit', () => {
  assert.equal(needsUsageCache([{ action: ACTIONS.usage, settings: { metrics: ['context'] } }]), false);
  assert.equal(needsUsageCache([{ action: ACTIONS.tune, settings: {} }]), false);
  assert.equal(needsUsageCache([{ action: ACTIONS.usage, settings: { metrics: ['context', 'scoped'] } }]), true);
});
