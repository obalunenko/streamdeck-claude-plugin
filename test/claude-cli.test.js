const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { findClaude, parseEffortLevels, parseModelAliases } = require('../src/claude-cli');

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
