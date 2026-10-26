// Terminal.app bridge: the one place that talks to Terminal. Finds tabs by tty,
// reads their screen and process list, types a slash command into one, and
// moves through a question dialog with arrow keys.
//
// Everything that reaches AppleScript (tty, text) travels as an `argv` item of
// `on run argv`, never spliced into the script source.

const { execFile } = require('node:child_process');

const OSASCRIPT = '/usr/bin/osascript';
// A hung osascript would hold the send queue of every dial.
const OSASCRIPT_TIMEOUT = 5000;

// The only values ever typed after /model and /effort.
const SAFE_VALUE = /^[A-Za-z0-9._\[\]-]+$/;

const TTY = /^ttys\d+$/;
const COMMAND = /^\/(?:model|effort) ([^]*)$/;
// Up / down arrows: the only keys typed into a question dialog.
const KEY_UP = '\x1b[A';
const KEY_DOWN = '\x1b[B';
const ARROWS = /^(?:\x1b\[[AB])*$/;
const RULE = /^─{20,}\s*$/;
// Terminal's text has a no-break space after the ⎿.
const INTERRUPTED = /^\s*⎿\s+Interrupted/;
// A dialog's selected option (`❯ 1. Yes`), even when drawn between two rules.
const NUMBERED_OPTION = /^❯\s*\d+\.\s/;
const STASH_LOOKBACK = 3; // the effort hint can sit between the stash line and the rule
const MAX_STATUS_LINES = 3;
const RS = '\x1e'; // separates the process list from the screen in tabInfo's output
const US = '\x1f'; // separates the processes

class TerminalAccessError extends Error {
  constructor(message = 'Not authorised to control Terminal') {
    super(message);
    this.name = 'TerminalAccessError';
  }
}

function commandText(kind, value) {
  if (kind !== 'model' && kind !== 'effort') throw new Error(`Unknown command kind: ${kind}`);
  if (typeof value !== 'string' || !SAFE_VALUE.test(value)) throw new Error(`Unsafe ${kind} value`);
  return `/${kind} ${value}`;
}

// Index of the top rule of the input-box frame at the bottom of the screen, or
// -1. The frame is a rule, a `❯` line (plus continuation lines, possibly
// blank), a second rule, then up to three status lines. Dialogs replace it.
function inputBoxTop(lines) {
  let end = lines.length;
  while (end > 0 && lines[end - 1].trim() === '') end--;
  let bottom = -1;
  for (let i = end - 1; i >= 0 && end - 1 - i <= MAX_STATUS_LINES; i--) {
    if (RULE.test(lines[i])) {
      bottom = i;
      break;
    }
  }
  if (bottom < 0) return -1;
  let top = bottom - 1;
  while (top >= 0 && !RULE.test(lines[top])) top--;
  if (top < 0 || !lines[top + 1].startsWith('❯') || NUMBERED_OPTION.test(lines[top + 1])) return -1;
  return top;
}

// 'ready' only when the bottom of the screen is the input box and no draft is
// held in the stash. It says nothing about a reply streaming (spec fact 8).
function screenState(screen) {
  const lines = String(screen).split('\n');
  const top = inputBoxTop(lines);
  if (top < 0) return 'blocked';
  if (lines.slice(Math.max(0, top - STASH_LOOKBACK), top).some((l) => l.includes('› stashed'))) return 'blocked';
  return 'ready';
}

// Esc on a reply or a dialog fires no hook; the screen says so instead.
function interrupted(screen) {
  const lines = String(screen).split('\n');
  let i = inputBoxTop(lines) - 1;
  if (i < -1) return false;
  while (i >= 0 && lines[i].trim() === '') i--;
  return i >= 0 && INTERRUPTED.test(lines[i]);
}

function osascript(script, argv = []) {
  return new Promise((resolve, reject) => {
    execFile(OSASCRIPT, ['-e', script, ...argv], { maxBuffer: 16 * 1024 * 1024, timeout: OSASCRIPT_TIMEOUT }, (err, stdout, stderr) => {
      if (!err) return resolve(stdout);
      const detail = `${stderr || ''} ${err.message || ''}`;
      reject(/-1743\b/.test(detail) ? new TerminalAccessError() : err);
    });
  });
}

function checkTty(tty) {
  if (typeof tty !== 'string' || !TTY.test(tty)) throw new Error('Invalid tty');
}

const FRONT_TAB = `
on run argv
  if application "Terminal" is not running then return ""
  tell application "Terminal"
    if (count of windows) is 0 then return ""
    return tty of selected tab of front window
  end tell
end run`;

const TAB_INFO = `
on run argv
  if application "Terminal" is not running then return ""
  set wanted to "/dev/" & item 1 of argv
  tell application "Terminal"
    repeat with w in windows
      repeat with t in tabs of w
        if tty of t is wanted then
          set AppleScript's text item delimiters to (character id 31)
          set procs to (processes of t) as text
          set AppleScript's text item delimiters to ""
          return procs & (character id 30) & (history of t)
        end if
      end repeat
    end repeat
  end tell
  return ""
end run`;

// Types item 2 plus Enter into the tab with tty item 1. The window's selected
// tab is restored in any case.
const DO_SCRIPT_IN = `
on run argv
  if application "Terminal" is not running then return ""
  set wanted to "/dev/" & item 1 of argv
  tell application "Terminal"
    repeat with w in windows
      repeat with t in tabs of w
        if tty of t is wanted then
          set previous to selected tab of w
          do script (item 2 of argv) in t
          set selected tab of w to previous
          return "ok"
        end if
      end repeat
    end repeat
  end tell
  return ""
end run`;

// Ctrl+S stashes a draft before a command; Claude Code brings it back after.
const STASH = '\x13';

async function doScriptIn(tty, text, run = osascript) {
  const out = await run(DO_SCRIPT_IN, [tty, text]);
  if (!out.startsWith('ok')) throw new Error(`No Terminal tab with tty ${tty}`);
}

// tty ("ttysNNN") of the selected tab of Terminal's front window; null when
// Terminal is not running or has no window. Never launches Terminal.
async function frontTab() {
  const tty = (await osascript(FRONT_TAB)).trim().replace(/^\/dev\//, '');
  return TTY.test(tty) ? tty : null;
}

// { processes, screen } of the tab with that tty, or null when there is none.
async function tabInfo(tty) {
  checkTty(tty);
  const out = (await osascript(TAB_INFO, [tty])).replace(/\n$/, '');
  const cut = out.indexOf(RS);
  if (cut < 0) return null;
  const procs = out.slice(0, cut);
  return { processes: procs ? procs.split(US) : [], screen: out.slice(cut + 1) };
}

// Types text plus Enter into the tab with that tty. The caller builds the text
// with commandText; it is checked again here because it lands in a terminal.
// `run` stands in for osascript in tests.
async function typeInto(tty, text, run = osascript) {
  checkTty(tty);
  const m = typeof text === 'string' ? COMMAND.exec(text) : null;
  if (!m || !SAFE_VALUE.test(m[1])) throw new Error('Refusing to type that text');
  await doScriptIn(tty, STASH + text, run);
}

// Types a run of up / down arrows plus Enter (do script always adds it) into
// the tab with that tty. Anything else is refused: in a dialog every key acts.
async function pressKeys(tty, keys) {
  checkTty(tty);
  if (typeof keys !== 'string' || !ARROWS.test(keys)) throw new Error('Refusing to type those keys');
  await doScriptIn(tty, keys);
}

module.exports = {
  SAFE_VALUE,
  KEY_UP,
  KEY_DOWN,
  commandText,
  screenState,
  interrupted,
  TerminalAccessError,
  frontTab,
  tabInfo,
  typeInto,
  pressKeys,
};
