// The HTTP server the hooks and the statusline talk to. It only routes:
// /permission is held open for the handler to answer from the deck, /event and
// /statusline report state. Nothing here decides a request.

const http = require('node:http');

const TTY = /^ttys\d+$/;

function readJSON(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

// onPermission(body, res) owns the response; onEvent(body) and
// onStatusline(tty, body) only take state.
function createServer({ onPermission, onEvent, onStatusline }) {
  const server = http.createServer(async (req, res) => {
    // Hooks run curl, which sends no Origin; a browser always does.
    if (req.method !== 'POST' || req.headers.origin) {
      res.writeHead(403).end();
      return;
    }
    let body;
    try {
      body = await readJSON(req);
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (req.url === '/permission') {
      onPermission(body, res);
    } else if (req.url === '/event') {
      onEvent(body);
      res.writeHead(204).end();
    } else if (req.url === '/statusline') {
      const tty = req.headers['x-claude-tty'];
      if (typeof tty !== 'string' || !TTY.test(tty)) {
        res.writeHead(400).end();
        return;
      }
      onStatusline(tty, body);
      res.writeHead(204).end();
    } else {
      res.writeHead(404).end();
    }
  });
  // A permission request waits for a key press, however long that takes.
  server.requestTimeout = 0;
  server.headersTimeout = 10_000;
  return server;
}

module.exports = { createServer };
