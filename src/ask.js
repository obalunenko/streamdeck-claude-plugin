// Question dialogs answered through the terminal: reads Claude Code's
// AskUserQuestion dialog from a Terminal tab's screen, so a deck press can be
// typed into it as arrows plus the Enter `do script` adds.
//
// The screen facts this rests on are measured, not documented; they are listed
// in CLAUDE.md, and the behaviour in specs/002-questions-follow-terminal.

const { KEY_UP, KEY_DOWN, TerminalAccessError } = require('./terminal');

// `←  ☐ Color  ☒ Snacks  ✔ Submit  →`, or ` ☐ Color ` for a single question.
const TAB = /^([☐☒]) (.+)$/;
// An item starts at the left edge (`❯ 1.` / `  1.`); descriptions and wrapped
// labels are indented further.
const ITEM = /^(❯ | {2})(\d+)\.\s+(?:\[([✔ ])\]\s+)?(.*)$/;
// The multi-select button after "Type something": Next, Submit on the last page.
const BUTTON = /^(❯\s*)?(Next|Submit)$/;
const RULE = /^─+$/;
const FOOTER = /^Enter to select · /;
const REVIEW = 'Review your answers';
const READY = 'Ready to submit your answers?';
const OTHER = /^Type something\.?$/;
const CHAT = 'Chat about this';
// The end of a dialog sits within this many non-blank lines of the bottom.
const TAIL = 3;

const squash = (s) => s.replace(/\s+/g, ' ').trim();

// The tabs of a tab bar line, or null when the line is not one.
function tabBar(line) {
  const rest = line
    .trim()
    .replace(/^←\s+/, '')
    .replace(/\s+✔ Submit\s+→$/, '');
  if (!rest) return null;
  const tabs = [];
  for (const part of rest.split(/\s{2,}/)) {
    const m = TAB.exec(part);
    if (!m) return null;
    tabs.push({ header: m[2].trim(), answered: m[1] === '☒' });
  }
  return tabs;
}

function reviewAnswers(lines) {
  const answers = [];
  let entry = null;
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith('● ')) {
      entry = { question: t.slice(2), answer: null };
      answers.push(entry);
    } else if (entry && entry.answer === null && t.startsWith('→ ')) {
      entry.answer = t.slice(2);
    } else if (!t || t.startsWith('Ready to submit')) {
      entry = null;
    } else if (entry) {
      // a wrapped question or answer
      if (entry.answer === null) entry.question += ` ${t}`;
      else entry.answer += ` ${t}`;
    }
  }
  return answers.filter((a) => a.answer !== null).map((a) => ({ question: squash(a.question), answer: squash(a.answer) }));
}

// The items of a question page, in their fixed layout: the options numbered
// from 1, Type something, the button on a multi-select page, Chat about this.
// Anything else in item position means a dialog we do not know: null.
function questionItems(lines) {
  const items = [];
  let highlight = -1;
  let boxes = 0;
  let slot = false; // the line after Type something may be the button
  for (const line of lines) {
    const t = line.trim();
    if (!t || RULE.test(t)) continue;
    const m = ITEM.exec(line);
    const numbered = m && Number(m[2]) === items.filter((i) => i.kind !== 'next').length + 1;
    const button = slot && !numbered && BUTTON.exec(t);
    slot = false;
    if (!numbered && !button) continue; // a description or a wrapped label
    let item;
    if (button) item = { kind: 'next', label: button[2] };
    else if (OTHER.test(m[4])) item = { kind: 'other', label: m[4] };
    else if (m[4] === CHAT) item = { kind: 'chat', label: m[4] };
    else item = { kind: 'option', option: items.length, label: m[4] };
    if (numbered && m[3] !== undefined) {
      item.checked = m[3] === '✔';
      boxes++;
    }
    if (button ? button[1] : m[1].startsWith('❯')) {
      if (highlight !== -1) return null;
      highlight = items.length;
    }
    slot = item.kind === 'other';
    items.push(item);
  }
  const options = items.filter((i) => i.kind === 'option').length;
  const multi = boxes > 0;
  const layout = items.map((i) => i.kind).join(' ');
  const want = `${'option '.repeat(options)}other ${multi ? 'next ' : ''}chat`;
  if (highlight === -1 || !options || layout !== want || (multi && boxes !== options + 1)) return null;
  return { items, highlight, multi };
}

// The review page's two items, below its question: Submit answers, Cancel.
function reviewItems(lines) {
  const items = [];
  let highlight = -1;
  for (const line of lines) {
    if (!line.trim()) continue;
    const m = ITEM.exec(line);
    if (!m) return null;
    if (m[1].startsWith('❯')) {
      if (highlight !== -1) return null;
      highlight = items.length;
    }
    items.push({ kind: m[4] === 'Cancel' ? 'cancel' : 'submit', label: m[4] });
  }
  const layout = items.map((i) => i.label).join('|');
  return highlight === -1 || layout !== 'Submit answers|Cancel' ? null : { items, highlight };
}

// The AskUserQuestion dialog at the bottom of the screen, or null. Only the
// part after the last tab bar counts, and only when its end (the footer of a
// question page, Cancel of the review page) is at the bottom of the screen.
function parseDialog(screen) {
  const lines = String(screen)
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''));
  let top = -1;
  let tabs = null;
  for (let i = lines.length - 1; i >= 0 && !tabs; i--) {
    tabs = tabBar(lines[i]);
    top = i;
  }
  if (!tabs) return null;
  const body = lines.slice(top + 1);
  const tail = body.filter((l) => l.trim()).slice(-TAIL);
  const review = body.some((l) => l.trim() === REVIEW);
  if (review) {
    const ready = body.findIndex((l) => l.trim() === READY);
    if (ready === -1 || !tail.some((l) => /^(❯ | {2})2\.\s+Cancel$/.test(l))) return null;
    const found = reviewItems(body.slice(ready + 1));
    return found && { tabs, page: { kind: 'review', answers: reviewAnswers(body.slice(0, ready)) }, ...found };
  }
  if (!tail.some((l) => FOOTER.test(l.trim()))) return null;
  const first = body.findIndex((l) => {
    const m = ITEM.exec(l);
    return m && m[2] === '1';
  });
  if (first === -1) return null;
  const found = questionItems(body.slice(first).filter((l) => !FOOTER.test(l.trim())));
  if (!found) return null;
  const page = { kind: 'question', question: squash(body.slice(0, first).join(' ')), multi: found.multi };
  return { tabs, page, items: found.items, highlight: found.highlight };
}

// The question index the dialog shows, questions.length for the review page,
// -1 for anything else.
function pageOf(dialog, questions) {
  if (!dialog) return -1;
  if (dialog.page.kind === 'review') return questions.length;
  return questions.findIndex((q) => squash(String(q.question)) === dialog.page.question);
}

// True when the dialog is this request's: the same headers in order, and on a
// question page the same options (the screen shows a label's first line).
function matches(dialog, questions) {
  if (!dialog || dialog.tabs.length !== questions.length) return false;
  if (!dialog.tabs.every((t, i) => t.header === squash(String(questions[i].header)))) return false;
  const page = pageOf(dialog, questions);
  if (page === -1) return false;
  if (page === questions.length) return true;
  if (dialog.page.multi !== !!questions[page].multiSelect) return false;
  const shown = dialog.items.filter((i) => i.kind === 'option');
  const asked = questions[page].options;
  return shown.length === asked.length && shown.every((o, i) => o.label && squash(String(asked[i].label)).startsWith(squash(o.label)));
}

// The arrows that bring the highlight to the item a deck press means, so the
// Enter `do script` adds is that press; null when the press would need a guess.
// press: { kind: 'option', option } | { kind: 'next' } | { kind: 'submit' }.
// A single-select page has no Next: its pick is not on the screen, and the
// deck's memory of it can be stale, so the option key moves on instead.
function planPress(dialog, questions, press) {
  if (!matches(dialog, questions)) return null;
  const page = pageOf(dialog, questions);
  const review = page === questions.length;
  const find = (pred) => dialog.items.findIndex(pred);
  let target = -1;
  if (press.kind === 'option' && !review) {
    target = find((i) => i.kind === 'option' && i.option === press.option);
  } else if (press.kind === 'next' && !review && dialog.page.multi) {
    target = find((i) => i.kind === 'next');
  } else if (press.kind === 'submit' && review && dialog.tabs.every((t) => t.answered)) {
    target = find((i) => i.kind === 'submit');
  }
  if (target === -1) return null;
  const h = dialog.highlight;
  return target >= h ? KEY_DOWN.repeat(target - h) : KEY_UP.repeat(h - target);
}

// A question request's path: 'terminal' while the deck answers by typing into
// the session's dialog, 'hook' when it answers through the hook as before.
// The Asker reads and writes these fields of the plugin's request: path, tty,
// answered (the tab bar on the terminal path), own (the last page change came
// from a deck send), lostAt, step (questions.length on the review page) and
// picked. It reads closed, which the plugin sets when the request leaves the
// queue.
class Asker {
  constructor({
    sessions,
    terminal,
    onChange = () => {},
    log = () => {},
    timers = { setTimeout, now: Date.now },
    detectFor = 2000,
    detectEvery = 250,
    settleFor = 1000,
    settleEvery = 100,
    grace = 2000,
  }) {
    Object.assign(this, { sessions, terminal, onChange, log, timers, detectFor, detectEvery, settleFor, settleEvery, grace });
    this.chain = Promise.resolve();
  }

  // On the terminal path once the session's tab shows this dialog; resolves
  // true then. Without the tab, the dialog or Terminal access: the hook path.
  async attach(req) {
    req.tty = this.ttyOf(req.session);
    if (req.tty) {
      const until = this.timers.now() + this.detectFor;
      try {
        for (;;) {
          const { dialog, alive } = await this.read(req);
          if (!alive) break; // no such tab, or it does not run claude
          if (dialog) {
            req.path = 'terminal';
            this.sync(req, dialog);
            return true;
          }
          if (this.timers.now() >= until) break;
          await this.wait(this.detectEvery);
        }
      } catch (e) {
        this.trouble(e);
      }
    }
    req.path = 'hook';
    return false;
  }

  // One read of the tab: the deck takes the terminal's page and checks. A
  // dialog gone for longer than `grace` (a submit is released by PostToolUse
  // before that) sends the request to the hook path.
  // A follow still waiting for Terminal is not queued again, so slow reads do
  // not pile up in front of presses.
  follow(req) {
    if (this.following) return this.following;
    this.following = this.serial(async () => {
      if (req.path !== 'terminal') return;
      let found = { dialog: null, alive: true };
      try {
        found = await this.read(req);
      } catch (e) {
        this.trouble(e, req);
        if (req.path !== 'terminal') return;
      }
      if (!found.alive) return this.toHook(req);
      if (!found.dialog) {
        if (req.lostAt === null) req.lostAt = this.timers.now();
        if (this.timers.now() - req.lostAt >= this.grace) this.toHook(req);
        return;
      }
      req.lostAt = null;
      if (this.sync(req, found.dialog)) this.onChange();
    }).finally(() => {
      this.following = null;
    });
    return this.following;
  }

  // Types a deck press made on page `step` into the dialog; true when typed.
  // Nothing is typed unless the tab shows this dialog on that page.
  press(req, press, step) {
    return this.serial(async () => {
      if (req.path !== 'terminal') return false;
      let screen;
      try {
        const found = await this.read(req);
        const { dialog, alive } = found;
        screen = found.screen;
        if (!alive) {
          this.toHook(req);
          return false;
        }
        if (!dialog) return false;
        if (this.sync(req, dialog)) this.onChange();
        if (pageOf(dialog, req.questions) !== step) return false;
        const single = step < req.questions.length && !req.questions[step].multiSelect;
        const keys = planPress(dialog, req.questions, press);
        if (keys === null) return false;
        // A Deny may have answered the request while the screen was read.
        if (req.closed || req.path !== 'terminal') return false;
        await this.terminal.pressKeys(req.tty, keys);
        if (single && press.kind === 'option') req.picked[step] = new Set([press.option]);
        if ((single && press.kind === 'option') || press.kind === 'next') req.own = true;
      } catch (e) {
        this.trouble(e, req);
        return false;
      }
      // Typed: the press counts even when reading the result fails.
      try {
        await this.settle(req, screen);
      } catch (e) {
        this.trouble(e, req);
      }
      return true;
    });
  }

  // Runs fn once the press or follow in flight is done, so an answer from the
  // deck never lands between a screen read and the keys typed after it.
  after(fn) {
    return this.serial(fn);
  }

  // Internals.

  // One at a time; a failure is logged and resolves false, never rejects.
  serial(fn) {
    const run = this.chain.then(fn).catch((e) => {
      this.log(`question: ${e.message}`);
      return false;
    });
    this.chain = run;
    return run;
  }

  wait(ms) {
    return new Promise((resolve) => this.timers.setTimeout(resolve, ms));
  }

  // Refused Terminal access sends the request to the hook path, logged once
  // until Terminal answers again; any other failure is logged.
  trouble(e, req) {
    if (!(e instanceof TerminalAccessError)) {
      this.log(`question: ${e.message}`);
      return;
    }
    if (!this.refusedLogged) this.log('question: Terminal access refused, answering through the hook');
    this.refusedLogged = true;
    if (req && req.path === 'terminal') this.toHook(req);
  }

  ttyOf(sessionId) {
    return this.sessions.ttys().find((tty) => this.sessions.get(tty).sessionId === sessionId) || null;
  }

  // { dialog: this request's dialog or null, alive: the tab runs claude, screen }
  async read(req) {
    const info = await this.terminal.tabInfo(req.tty);
    this.refusedLogged = false;
    if (!info || !info.processes.includes('claude')) return { dialog: null, alive: false, screen: '' };
    const dialog = parseDialog(info.screen);
    return { dialog: matches(dialog, req.questions) ? dialog : null, alive: true, screen: info.screen };
  }

  // After a send: the first changed screen, or the last one after `settleFor`.
  async settle(req, before) {
    const until = this.timers.now() + this.settleFor;
    for (;;) {
      await this.wait(this.settleEvery);
      const found = await this.read(req);
      if (found.screen !== before || this.timers.now() >= until) {
        if (found.dialog) this.sync(req, found.dialog);
        this.onChange();
        return;
      }
    }
  }

  toHook(req) {
    req.path = 'hook';
    req.answered = null;
    req.step = Math.min(req.step, req.questions.length - 1);
    this.onChange();
  }

  // Takes the page, the answered marks and the visible picks from the dialog;
  // true when anything changed. A page change without a deck send means the
  // keyboard is at work, and it may have re-answered the page left or, within
  // one read, the page arrived at: the deck forgets its single-select picks of
  // both.
  sync(req, dialog) {
    const qs = req.questions;
    const state = () => JSON.stringify([req.step, req.answered, req.picked.map((p) => [...p].sort())]);
    const before = state();
    const page = pageOf(dialog, qs);
    req.answered = dialog.tabs.map((t) => t.answered);
    if (page !== req.step) {
      if (!req.own) {
        for (const i of [req.step, page]) if (i < qs.length && !qs[i].multiSelect) req.picked[i] = new Set();
      }
      req.step = page;
      req.own = false;
    }
    if (page < qs.length && qs[page].multiSelect) {
      req.picked[page] = new Set(dialog.items.filter((i) => i.kind === 'option' && i.checked).map((i) => i.option));
    }
    if (page === qs.length) {
      qs.forEach((q, i) => {
        const a = dialog.page.answers.find((x) => x.question === squash(String(q.question)));
        const labels = !a ? [] : q.multiSelect ? a.answer.split(', ') : [a.answer];
        req.picked[i] = new Set(labels.map((l) => q.options.findIndex((o) => o.label === l)).filter((o) => o !== -1));
      });
    }
    return state() !== before;
  }
}

module.exports = { parseDialog, pageOf, matches, planPress, Asker };
