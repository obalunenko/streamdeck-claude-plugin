// The claude binary: where it lives and what `claude --help` says about the
// effort levels and model aliases this version accepts.

const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Stream Deck starts the plugin without the login shell's PATH.
const CLAUDE_PATHS = [
  path.join(os.homedir(), '.local', 'bin', 'claude'),
  '/opt/homebrew/bin/claude',
  '/usr/local/bin/claude',
  path.join(os.homedir(), '.claude', 'local', 'claude'),
];

const HELP_TIMEOUT = 5000;

function findClaude(exists = fs.existsSync) {
  return CLAUDE_PATHS.find((p) => exists(p)) || null;
}

function readHelp(bin) {
  return new Promise((resolve, reject) => {
    execFile(bin, ['--help'], { maxBuffer: 4 * 1024 * 1024, timeout: HELP_TIMEOUT }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
}

// The text of one option in the help: its line plus the indented lines that
// continue it, up to the next option line.
function optionText(help, flag) {
  const lines = help.split('\n');
  const start = lines.findIndex((l) => l.trimStart().startsWith(`${flag} `));
  if (start < 0) return '';
  let end = start + 1;
  while (end < lines.length && !/^\s*-/.test(lines[end])) end++;
  return lines.slice(start, end).join(' ');
}

// "--effort <level>  Effort level (low, medium, high, xhigh, max)"
function parseEffortLevels(help) {
  const list = optionText(help, '--effort').match(/\(([^()]*)\)/);
  return list ? list[1].split(',').map((s) => s.trim()).filter(Boolean) : [];
}

// "--model <model>  ... (e.g. 'fable', 'opus', or 'sonnet') ..."
function parseModelAliases(help) {
  return [...optionText(help, '--model').matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

module.exports = { findClaude, readHelp, parseEffortLevels, parseModelAliases };
