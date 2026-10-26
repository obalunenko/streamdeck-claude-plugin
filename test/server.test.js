const test = require('node:test');
const assert = require('node:assert/strict');

const { createServer } = require('../src/server');

// A server on a free port whose handlers record what reaches them.
async function start(t) {
  const calls = [];
  const server = createServer({
    onPermission: (body, res) => {
      calls.push(['permission', body]);
      res.end('{}');
    },
    onEvent: (body) => calls.push(['event', body]),
    onStatusline: (tty, body) => calls.push(['statusline', tty, body]),
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const post = (url, { headers = {}, body = '{"a":1}', method = 'POST' } = {}) =>
    fetch(`http://127.0.0.1:${server.address().port}${url}`, { method, headers, body: method === 'GET' ? undefined : body });
  return { calls, post };
}

test('a request with an Origin header reaches no handler', async (t) => {
  const { calls, post } = await start(t);
  for (const url of ['/permission', '/event', '/statusline']) {
    const res = await post(url, { headers: { Origin: 'http://evil.example', 'X-Claude-TTY': 'ttys001' } });
    assert.equal(res.status, 403, url);
  }
  assert.deepEqual(calls, []);
});

test('only POST is accepted', async (t) => {
  const { calls, post } = await start(t);
  assert.equal((await post('/event', { method: 'GET' })).status, 403);
  assert.deepEqual(calls, []);
});

test('a body that is not JSON is refused', async (t) => {
  const { calls, post } = await start(t);
  assert.equal((await post('/permission', { body: 'nope' })).status, 400);
  assert.deepEqual(calls, []);
});

test('the statusline needs a ttysNNN in X-Claude-TTY', async (t) => {
  const { calls, post } = await start(t);
  assert.equal((await post('/statusline')).status, 400);
  assert.equal((await post('/statusline', { headers: { 'X-Claude-TTY': '/dev/ttys001' } })).status, 400);
  assert.equal((await post('/statusline', { headers: { 'X-Claude-TTY': 'ttys001; rm' } })).status, 400);
  assert.equal((await post('/statusline', { headers: { 'X-Claude-TTY': 'ttys001' } })).status, 204);
  assert.deepEqual(calls, [['statusline', 'ttys001', { a: 1 }]]);
});

test('hook requests reach their handlers; anything else is 404', async (t) => {
  const { calls, post } = await start(t);
  assert.equal(await (await post('/permission')).text(), '{}');
  assert.equal((await post('/event')).status, 204);
  assert.equal((await post('/decide')).status, 404);
  assert.deepEqual(calls, [
    ['permission', { a: 1 }],
    ['event', { a: 1 }],
  ]);
});
