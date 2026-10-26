const test = require('node:test');
const assert = require('node:assert/strict');

const { Updater, isNewer, parseVersion } = require('../src/update');

const updater = (currentVersion = '1.2.0.0') => {
  const logs = [];
  const u = new Updater({ currentVersion, log: (m) => logs.push(m), onChange: () => {}, onSkip: () => {} });
  return { u, logs };
};

test('parseVersion reads a tag and a manifest version as four numbers', () => {
  assert.deepEqual(parseVersion('v1.2.0'), [1, 2, 0, 0]);
  assert.deepEqual(parseVersion('1.2.0.3'), [1, 2, 0, 3]);
  assert.deepEqual(parseVersion('2'), [2, 0, 0, 0]);
  assert.deepEqual(parseVersion('v1.x.0'), [1, 0, 0, 0]);
});

test('isNewer compares number by number, not as text', () => {
  assert.equal(isNewer('v1.10.0', '1.9.0.0'), true);
  assert.equal(isNewer('v1.2.0', '1.2.0.0'), false);
  assert.equal(isNewer('v1.2.0', '1.2.0.1'), false); // a local build stays ahead of its release
  assert.equal(isNewer('v1.2.1', '1.2.0.5'), true);
});

test('available needs a newer release that was not skipped', () => {
  const { u } = updater();
  assert.equal(u.available(), false);
  u.latest = { tag: 'v1.3.0', url: 'x' };
  assert.equal(u.available(), true);
  u.skipped = 'v1.3.0';
  assert.equal(u.available(), false);
  u.latest = { tag: 'v1.2.0', url: 'x' };
  u.skipped = '';
  assert.equal(u.available(), false);
});

test('check takes the .streamDeckPlugin asset of the latest release', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    json: async () => ({
      tag_name: 'v1.3.0',
      assets: [
        { name: 'notes.txt', browser_download_url: 'https://example.invalid/notes.txt' },
        { name: 'streamdeck-claude-plugin.streamDeckPlugin', browser_download_url: 'https://example.invalid/p' },
      ],
    }),
  }));
  const { u } = updater();
  await u.check();
  assert.deepEqual(u.latest, { tag: 'v1.3.0', url: 'https://example.invalid/p' });
});

test('check without a package asset offers nothing', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ tag_name: 'v1.3.0', assets: [] }) }));
  const { u } = updater();
  await u.check();
  assert.equal(u.latest, null);
});

test('a failed check is only logged', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 403 }));
  const { u, logs } = updater();
  await u.check();
  assert.equal(u.latest, null);
  assert.match(logs[0], /^update check failed: .*HTTP 403$/);
});
