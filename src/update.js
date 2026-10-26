// Update check: asks GitHub for the project's latest release and offers to
// install a newer package with a macOS dialog. The releases are public, so no
// login is involved.

const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO = 'obalunenko/streamdeck-claude-plugin';
const LATEST_RELEASE = `https://api.github.com/repos/${REPO}/releases/latest`;
const FETCH_TIMEOUT = 60 * 1000;

function run(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 16 * 1024 * 1024, ...options }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
}

// "v1.2.0" and "1.2.0.0" both become [1, 2, 0, 0].
function parseVersion(v) {
  const parts = String(v).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  return [...parts, 0, 0, 0, 0].slice(0, 4);
}

function isNewer(a, b) {
  const [x, y] = [parseVersion(a), parseVersion(b)];
  for (let i = 0; i < 4; i++) {
    if (x[i] !== y[i]) return x[i] > y[i];
  }
  return false;
}

class Updater {
  constructor({ currentVersion, log, onChange, onSkip }) {
    this.currentVersion = currentVersion;
    this.log = log;
    this.onChange = onChange;
    this.onSkip = onSkip;
    this.latest = null; // { tag, url }
    this.skipped = '';
    this.dialogOpen = false;
  }

  async get(url, accept) {
    const res = await fetch(url, {
      headers: { Accept: accept, 'User-Agent': 'streamdeck-claude-plugin' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return res;
  }

  available() {
    return Boolean(this.latest && isNewer(this.latest.tag, this.currentVersion) && this.latest.tag !== this.skipped);
  }

  async check() {
    try {
      const release = await (await this.get(LATEST_RELEASE, 'application/vnd.github+json')).json();
      const asset = (release.assets || []).find((a) => a.name.endsWith('.streamDeckPlugin'));
      this.latest = asset ? { tag: release.tag_name, url: asset.browser_download_url } : null;
      this.onChange();
    } catch (e) {
      this.log(`update check failed: ${e.message}`);
    }
  }

  async offer() {
    if (this.dialogOpen || !this.available()) return;
    this.dialogOpen = true;
    const { tag } = this.latest;
    const script =
      `display dialog "Claude Permissions ${tag} is available (installed ${this.currentVersion})." ` +
      'with title "Stream Deck" buttons {"Skip this version", "Later", "Install"} default button "Install" giving up after 3600';
    try {
      const out = await run('/usr/bin/osascript', ['-e', script]);
      if (out.includes('button returned:Install')) await this.install();
      else if (out.includes('button returned:Skip this version')) {
        this.skipped = tag;
        this.onSkip(tag);
        this.onChange();
      }
    } catch (e) {
      this.log(`update failed: ${e.message}`);
    } finally {
      this.dialogOpen = false;
    }
  }

  // Opening the package hands it to Stream Deck, which asks to confirm the update.
  async install() {
    const pkg = Buffer.from(await (await this.get(this.latest.url, 'application/octet-stream')).arrayBuffer());
    const file = path.join(os.tmpdir(), `streamdeck-claude-plugin-${this.latest.tag}.streamDeckPlugin`);
    fs.writeFileSync(file, pkg);
    await run('/usr/bin/open', [file]);
  }
}

module.exports = { Updater, isNewer, parseVersion };
