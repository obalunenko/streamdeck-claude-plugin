// The model / effort dial: a registry of running Claude Code sessions (fed by
// the statusline and the hooks) and the Tuner that turns dial rotation into
// one debounced `/model` or `/effort` command typed into the target tab.
//
// The Tuner gets the Terminal bridge injected; only the pure helpers are
// required here.

const path = require('node:path');
const { SAFE_VALUE, commandText, screenState, interrupted, TerminalAccessError } = require('./terminal');

const REFRESH_EVERY = 2000; // front-tab lookups outside dial use

const NOTICE = {
  session: 'no session',
  busy: 'busy',
  claude: 'no claude',
  access: 'no access',
  effort: '—',
};

// The dial's model list from its settings: one item per line.
function parseModelList(text) {
  const items = String(text || '')
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s && SAFE_VALUE.test(s));
  return [...new Set(items)];
}

// Index of the item naming the session's model: the full id, else the first
// alias the id contains (`opus` in `claude-opus-5-5`); -1 when none does.
function matchModel(items, model) {
  if (!model || typeof model.id !== 'string') return -1;
  const exact = items.indexOf(model.id);
  if (exact >= 0) return exact;
  const id = model.id.toLowerCase();
  return items.findIndex((item) => id.includes(item.toLowerCase()));
}

// Moves an index by ticks: models wrap around, effort stops at both ends. From
// an unknown value it lands on the first item.
function step(length, index, ticks, wrap) {
  if (index === -1) return 0;
  const next = index + ticks;
  if (wrap) return ((next % length) + length) % length;
  return Math.min(length - 1, Math.max(0, next));
}

const isString = (v) => typeof v === 'string';

// Running sessions by the tty of their Terminal tab.
class Sessions {
  constructor() {
    this.byTty = new Map();
    this.recent = []; // ttys, the one that reported last at the end
  }

  // status: the statusline JSON. A new session_id on a known tty (`/clear`,
  // `/resume`, a restarted claude) replaces the entry and keeps its place.
  // Only strings, and the context fill as a finite number, are kept: the
  // strip renders them, and anything else in the body is null. A report
  // without a session_id is ignored.
  report(tty, status) {
    if (!status || typeof status !== 'object' || typeof status.session_id !== 'string') return;
    const prev = this.byTty.get(tty);
    const dir = [status.cwd, status.workspace?.current_dir].find(isString);
    const model = status.model && isString(status.model.id) ? status.model : null;
    const effort = status.effort?.level;
    const context = status.context_window?.used_percentage;
    this.byTty.set(tty, {
      tty,
      sessionId: status.session_id,
      project: (dir && path.basename(dir)) || null,
      model: model ? { id: model.id, name: isString(model.display_name) ? model.display_name : null } : null,
      effort: isString(effort) && SAFE_VALUE.test(effort) ? effort : null,
      context: typeof context === 'number' && Number.isFinite(context) ? context : null,
      busy: prev && prev.sessionId === status.session_id ? prev.busy : false,
    });
    this.recent = this.recent.filter((t) => t !== tty).concat(tty);
  }

  end(sessionId) {
    for (const [tty, s] of this.byTty) if (s.sessionId === sessionId) this.drop(tty);
  }

  turn(sessionId, busy) {
    for (const s of this.byTty.values()) if (s.sessionId === sessionId) s.busy = busy;
  }

  get(tty) {
    return this.byTty.get(tty);
  }

  drop(tty) {
    this.byTty.delete(tty);
    this.recent = this.recent.filter((t) => t !== tty);
  }

  ttys() {
    return [...this.byTty.keys()];
  }

  // The session that reported last among those still registered.
  latest() {
    for (let i = this.recent.length - 1; i >= 0; i--) {
      const s = this.byTty.get(this.recent[i]);
      if (s) return s;
    }
    return null;
  }
}

// Turns rotation into a pending value per dial and sends it once the dial has
// been still for `delay` ms. Target: the front Terminal tab when it is a
// registered session, else the tab chosen on the deck (shared by all dials).
class Tuner {
  constructor({
    sessions,
    terminal,
    levels,
    onChange = () => {},
    // (sessionId) => true while the session has a request waiting on the deck.
    pending = () => false,
    timers = { setTimeout, clearTimeout, now: Date.now },
    delay = 500,
    noticeFor = 2000,
    settle = 1000,
  }) {
    Object.assign(this, { sessions, terminal, levels, onChange, pending, timers, delay, noticeFor, settle });
    this.front = null;
    this.frontAt = -Infinity;
    this.refreshing = false;
    this.chosen = null;
    this.dials = new Map(); // context → { gesture, notice }
    // Sends from all dials run one after another, so a send checks the screen
    // only after the previous one (and the dialog it may open) has landed.
    this.sends = Promise.resolve();
    this.shown = this.targetKey();
  }

  async rotate(dial, ticks) {
    const state = this.dial(dial.context);
    const g = state.gesture;
    if (!g) return this.start(dial, state, ticks);
    if (g.locking) g.ticks += ticks;
    else if (!g.firing) this.move(state, g, ticks);
  }

  // false when the front tab is a session (pressing would choose nothing that
  // matters now) or there is no session to choose.
  async press() {
    await this.readFront().catch(() => {});
    const ttys = this.sessions.ttys();
    if ((this.front && this.sessions.get(this.front)) || !ttys.length) return false;
    this.chosen = ttys[(ttys.indexOf(this.chosen) + 1) % ttys.length];
    this.changed();
    return true;
  }

  // Calls onChange when the target or what the strip shows of it changed.
  // Terminal is asked at most once per REFRESH_EVERY.
  async refresh() {
    if (!this.refreshing && this.timers.now() - this.frontAt >= REFRESH_EVERY) {
      this.refreshing = true;
      await this.readFront().catch(() => {});
      this.refreshing = false;
    }
    if (this.targetKey() !== this.shown) this.changed();
  }

  // The session the dials go to now, or null; asks Terminal nothing.
  session() {
    const t = this.target();
    return (t && this.sessions.get(t.tty)) || null;
  }

  view(dial) {
    const state = this.dials.get(dial.context);
    const g = state && state.gesture;
    const pending = !!g && !g.locking && g.index >= 0;
    const target = pending ? { tty: g.tty, chosen: g.chosen } : this.target();
    const session = target && this.sessions.get(target.tty);
    let notice = (state && state.notice && state.notice.text) || null;
    if (!notice) {
      if (dial.kind === 'effort' && !this.safeLevels().length) notice = NOTICE.claude;
      else if (!session) notice = NOTICE.session;
      else if (dial.kind === 'effort' && session.effort === null) notice = NOTICE.effort;
    }
    let value = null;
    if (pending) value = g.items[g.index];
    else if (session) value = dial.kind === 'model' ? (session.model && (session.model.name || session.model.id)) || null : session.effort;
    return {
      kind: dial.kind,
      value,
      pending,
      project: (session && session.project) || null,
      chosen: !!session && target.chosen,
      notice,
    };
  }

  // Internals.

  dial(context) {
    let state = this.dials.get(context);
    if (!state) this.dials.set(context, (state = { gesture: null, notice: null }));
    return state;
  }

  safeLevels() {
    return (this.levels() || []).filter((v) => SAFE_VALUE.test(v));
  }

  target() {
    if (this.front && this.sessions.get(this.front)) return { tty: this.front, chosen: false };
    if (this.chosen && this.sessions.get(this.chosen)) return { tty: this.chosen, chosen: true };
    return null;
  }

  targetKey() {
    const t = this.target();
    const s = t && this.sessions.get(t.tty);
    return s ? JSON.stringify([t.tty, t.chosen, s.sessionId, s.project, s.model, s.effort]) : '';
  }

  changed() {
    this.shown = this.targetKey();
    this.onChange();
  }

  async readFront() {
    this.frontAt = this.timers.now();
    try {
      this.front = await this.terminal.frontTab();
    } catch (err) {
      this.front = null;
      throw err;
    }
  }

  notify(state, text) {
    const notice = { text };
    state.notice = notice;
    this.timers.setTimeout(() => {
      if (state.notice !== notice) return;
      state.notice = null;
      this.onChange();
    }, this.noticeFor);
  }

  // The first tick of a gesture locks the target; it and the ticks that arrive
  // during the lookup all move the value.
  async start(dial, state, ticks) {
    const kind = dial.kind;
    const items = kind === 'effort' ? this.safeLevels() : (dial.items || []).filter((v) => SAFE_VALUE.test(v));
    if (!items.length) return this.onChange();
    const g = { kind, items, ticks, locking: true, firing: false, timer: null };
    state.gesture = g;
    state.notice = null;
    try {
      await this.readFront();
    } catch (err) {
      state.gesture = null;
      if (err instanceof TerminalAccessError) this.notify(state, NOTICE.access);
      return this.changed();
    }
    const target = this.target();
    const session = target && this.sessions.get(target.tty);
    if (!session || (kind === 'effort' && session.effort === null)) {
      state.gesture = null;
      return this.changed();
    }
    const start = kind === 'model' ? matchModel(items, session.model) : items.indexOf(session.effort);
    Object.assign(g, { tty: target.tty, chosen: target.chosen, start, index: start, locking: false });
    this.move(state, g, g.ticks);
  }

  move(state, g, ticks) {
    g.index = step(g.items.length, g.index, ticks, g.kind === 'model');
    if (g.timer !== null) this.timers.clearTimeout(g.timer);
    g.timer = this.timers.setTimeout(() => this.fire(state, g), this.delay);
    this.onChange();
  }

  // Queues the send behind the previous one. After a command is typed the
  // queue waits `settle` ms, so a dialog it opens (the `/model` confirmation)
  // is on the screen before the next send reads it, also when the attempt
  // threw after typing. Returns the attempt's promise (never rejects; true
  // when the command was typed), without the settle wait.
  fire(state, g) {
    g.firing = true;
    const done = this.sends.then(() => this.attempt(state, g)).catch(() => !!g.typed);
    this.sends = done.then((typed) => typed && new Promise((resolve) => this.timers.setTimeout(resolve, this.settle)));
    return done;
  }

  // true when the command was typed.
  async attempt(state, g) {
    try {
      const notice = await this.send(g);
      if (notice) this.notify(state, notice);
    } catch (err) {
      this.notify(state, err instanceof TerminalAccessError ? NOTICE.access : NOTICE.session);
    }
    if (state.gesture === g) state.gesture = null;
    this.changed();
    return !!g.typed;
  }

  // A notice to show, or null when sent or dropped quietly.
  async send(g) {
    if (g.index === g.start) return null;
    await this.readFront();
    const target = this.target();
    if (!target || target.tty !== g.tty) return null;
    const info = await this.terminal.tabInfo(g.tty);
    if (!info || !info.processes.includes('claude')) {
      this.sessions.drop(g.tty);
      if (this.chosen === g.tty) this.chosen = null;
      return NOTICE.session;
    }
    const session = this.sessions.get(g.tty);
    if (session.busy) {
      if (!interrupted(info.screen)) return NOTICE.busy;
      this.sessions.turn(session.sessionId, false);
    }
    if (screenState(info.screen) !== 'ready') return NOTICE.busy;
    // A request of this session on the deck (a background subagent asks while
    // the main turn is idle) means a dialog is about to open, or already has.
    if (this.pending(session.sessionId)) return NOTICE.busy;
    await this.terminal.typeInto(g.tty, commandText(g.kind, g.items[g.index]));
    g.typed = true;
    return null;
  }
}

module.exports = { Sessions, Tuner, parseModelList, matchModel, step };
