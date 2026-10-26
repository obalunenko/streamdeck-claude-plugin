// Stream Deck plugin: answers Claude Code permission dialogs.
//
// Claude Code runs a PermissionRequest command hook that POSTs the request to
// http://127.0.0.1:47823/permission and waits. The request stays open until a
// key is pressed; the response body is the hook's JSON decision. The dialog in
// the terminal is shown at the same time, and whichever answer comes first wins.
//
// A "Yes" typed in the terminal does not cancel the hook, so other hook events
// (PostToolUse, PostToolUseFailure, Stop, StopFailure, UserPromptSubmit,
// SessionEnd) are POSTed to /event and clear the requests they make obsolete.
//
// While anything is pending, a Stream Deck + is switched to the bundled
// "Claude" profile and switched back once the queue is empty.
//
// The Model / Effort dial changes the model or the effort of a running session
// (see tune.js). The user's statusline POSTs its JSON to /statusline with the
// tty of its claude process, so the plugin knows each session's tab, model and
// effort; the turn hooks above say when a session is busy. Turning the dial
// types one `/model` or `/effort` command into the front Terminal tab, or the
// tab chosen on the deck, once the dial has been still for half a second.
//
// The Usage action shows the context fill of the session the dials target, or
// a plan limit (5h, 7d, the model-scoped weekly limit), as a green / yellow /
// red scale (see usage.js). The limits come from every statusline report and
// from ~/.claude/cache/oauth-usage.json, which the user's statusline writes.
//
// A question prompt of a session that reports through the statusline is
// answered through its Terminal tab when the tab shows the dialog: a press is
// typed into the dialog as arrows plus Enter, so the terminal shows the page
// the deck shows, and the deck follows the dialog (see ask.js). Otherwise the
// deck answers through the hook.
//
// The plugin also offers newer GitHub releases of itself (see update.js).

const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const WebSocket = require('ws');
const { Updater } = require('./update');
const { findClaude, readHelp, parseEffortLevels, parseModelAliases } = require('./claude-cli');
const { frontTab, tabInfo, typeInto, pressKeys } = require('./terminal');
const { Sessions, Tuner, parseModelList } = require('./tune');
const { Asker } = require('./ask');
const { dots, stripView, Peek } = require('./strip');
const { Limits, readingsFromStatus, readingsFromCache, parseMetrics, shownMetric, cycle, wantsContext, usageView } = require('./usage');

const PORT = 47823;
const PLUGIN = 'com.obalunenko.claudeperm';
const ACTIONS = {
  status: `${PLUGIN}.status`,
  allow: `${PLUGIN}.allow`,
  always: `${PLUGIN}.always`,
  deny: `${PLUGIN}.deny`,
  strip: `${PLUGIN}.strip`,
  tune: `${PLUGIN}.tune`,
  usage: `${PLUGIN}.usage`,
};
const OPTION_ACTIONS = [1, 2, 3, 4].map((n) => `${PLUGIN}.option${n}`);

const PROFILE = 'Claude';
const STREAM_DECK_PLUS = 7;
// Switching back to "the previous profile" without having switched would move
// the deck somewhere unexpected, so nothing switches until the profile ships.
const PROFILE_BUNDLED = fs.existsSync(path.join(__dirname, '..', `${PROFILE}.streamDeckProfile`));

const DENY_MESSAGE = 'Denied from Stream Deck';

const VERSION = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8')).Version;
const FIRST_UPDATE_CHECK = 30 * 1000;
const UPDATE_CHECK_EVERY = 12 * 60 * 60 * 1000;

const TTY = /^ttys\d+$/;
const TUNE_REFRESH_EVERY = 2000;

const USAGE_CACHE = path.join(os.homedir(), '.claude', 'cache', 'oauth-usage.json');
const USAGE_REFRESH_EVERY = 60 * 1000;

// ---------- Stream Deck connection ----------

const args = {};
for (let i = 2; i < process.argv.length - 1; i += 2) {
  args[process.argv[i].replace(/^-/, '')] = process.argv[i + 1];
}

const ws = new WebSocket(`ws://127.0.0.1:${args.port}`);
/** @type {Map<string, {action: string, column: number, encoder: boolean, settings: object}>} */
const contexts = new Map();
const plusDevices = new Set();

try {
  for (const d of JSON.parse(args.info || '{}').devices || []) {
    if (d.type === STREAM_DECK_PLUS) plusDevices.add(d.id);
  }
} catch {
  // The device list also arrives with deviceDidConnect.
}

function send(event, extra) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ event, ...extra }));
}

function log(message) {
  send('logMessage', { payload: { message: `[claudeperm] ${message}` } });
}

let globalSettings = {};

const updater = new Updater({
  currentVersion: VERSION,
  log,
  onChange: () => renderAll(),
  onSkip: (tag) => {
    globalSettings = { ...globalSettings, skippedVersion: tag };
    send('setGlobalSettings', { context: args.pluginUUID, payload: globalSettings });
  },
});

function checkForUpdate() {
  updater.check().then(() => updater.offer());
}

ws.on('open', () => {
  send(args.registerEvent, { uuid: args.pluginUUID });
  send('getGlobalSettings', { context: args.pluginUUID });
  setTimeout(checkForUpdate, FIRST_UPDATE_CHECK);
  setInterval(checkForUpdate, UPDATE_CHECK_EVERY);
  readClaudeHelp();
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  switch (msg.event) {
    case 'didReceiveGlobalSettings':
      globalSettings = msg.payload?.settings || {};
      updater.skipped = globalSettings.skippedVersion || '';
      break;
    case 'deviceDidConnect':
      if (msg.deviceInfo?.type === STREAM_DECK_PLUS) plusDevices.add(msg.device);
      break;
    case 'deviceDidDisconnect':
      plusDevices.delete(msg.device);
      break;
    case 'willAppear':
      contexts.set(msg.context, {
        action: msg.action,
        column: msg.payload?.coordinates?.column ?? 0,
        encoder: msg.payload?.controller === 'Encoder',
        settings: msg.payload?.settings || {},
      });
      render(msg.context);
      watchTune();
      watchUsage();
      if (msg.action === ACTIONS.usage) readUsageCache();
      break;
    case 'willDisappear':
      contexts.delete(msg.context);
      watchTune();
      watchUsage();
      break;
    case 'didReceiveSettings': {
      const c = contexts.get(msg.context);
      if (c) c.settings = msg.payload?.settings || {};
      render(msg.context);
      watchTune();
      if (msg.action === ACTIONS.usage) readUsageCache();
      break;
    }
    case 'keyDown':
      if (msg.action === ACTIONS.usage) onUsageStep(msg.context, 1);
      else onKey(msg.action, msg.context);
      break;
    case 'dialDown':
    case 'touchTap':
      if (msg.action === ACTIONS.tune) onTunePress(msg.context);
      else if (msg.action === ACTIONS.usage) onUsageStep(msg.context, 1);
      else onStrip(msg.context);
      break;
    case 'dialRotate':
      if (msg.action === ACTIONS.tune) logRejection(tuner.rotate(dialOf(msg.context), msg.payload?.ticks ?? 0));
      else if (msg.action === ACTIONS.usage) onUsageStep(msg.context, msg.payload?.ticks ?? 0);
      else onStripTurn(msg.context, msg.payload?.ticks ?? 0);
      break;
  }
});

ws.on('close', () => process.exit(0));

// ---------- request queue ----------

/** @type {{id:number, session:string, agent:string, cwd:string, tool:string, input:object, inputKey:string, suggestions:object[], questions:object[]|null, step:number, picked:Set<number>[], path:'probing'|'terminal'|'hook', closed:boolean, tty:string|null, answered:boolean[]|null, own:boolean, lostAt:number|null, res:http.ServerResponse}[]} */
const queue = [];
let cursor = 0;
let seq = 0;
let switched = false;

function current() {
  if (queue.length === 0) return null;
  if (cursor >= queue.length) cursor = 0;
  return queue[cursor];
}

// Without a profile name Stream Deck returns to the profile shown before.
function syncProfile() {
  const want = PROFILE_BUNDLED && queue.length > 0;
  if (want === switched) return;
  switched = want;
  for (const device of plusDevices) {
    send('switchToProfile', { context: args.pluginUUID, device, payload: want ? { profile: PROFILE, page: 0 } : {} });
  }
}

function changed() {
  syncProfile();
  renderAll();
}

function remove(req) {
  const i = queue.indexOf(req);
  if (i === -1) return;
  req.closed = true;
  queue.splice(i, 1);
  if (cursor > i) cursor--;
  watchFollow();
  changed();
}

function answer(req, decision) {
  const body = JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PermissionRequest', decision },
  });
  req.res.writeHead(200, { 'content-type': 'application/json' }).end(body);
  remove(req);
}

// Questions are answered in any order, like the tabs of the terminal dialog:
// `picked[i]` holds the options chosen for question i, and moving between
// questions keeps them.
function currentQuestion(req) {
  return req?.questions?.[req.step] ?? null;
}

function picked(req) {
  return req.picked[req.step];
}

// On the terminal path the dialog's tab bar says what is answered: a
// single-select pick made from the keyboard is not visible to the deck.
function isAnswered(req, i) {
  return req.answered ? req.answered[i] : req.picked[i].size > 0;
}

function allAnswered(req) {
  return req.picked.every((_, i) => isAnswered(req, i));
}

function answeredMarks(req) {
  return req.questions.map((_, i) => isAnswered(req, i));
}

function goTo(req, step) {
  if (step < 0 || step >= req.questions.length) return false;
  req.step = step;
  renderAll();
  return true;
}

// The answers go to Claude Code in the tool input, as the dialog sends them;
// a multi-select answer joins the labels with ", " in option order.
function submit(req) {
  const answers = {};
  req.questions.forEach((q, i) => {
    answers[q.question] = q.options
      .filter((_, o) => req.picked[i].has(o))
      .map((o) => o.label)
      .join(', ');
  });
  answer(req, { behavior: 'allow', updatedInput: { ...req.input, answers } });
}

// Next question, or the submit once every question is answered on the last one.
function forward(req) {
  if (req.step < req.questions.length - 1) return goTo(req, req.step + 1);
  if (allAnswered(req)) {
    submit(req);
    return true;
  }
  return goTo(req, req.picked.findIndex((p) => p.size === 0));
}

// A single-choice option answers its question and moves on; a multi-select
// option toggles.
function chooseOption(req, option) {
  const q = currentQuestion(req);
  if (!q?.options[option]) return false;
  if (q.multiSelect) {
    const p = picked(req);
    if (p.has(option)) p.delete(option);
    else p.add(option);
    renderAll();
    return true;
  }
  req.picked[req.step] = new Set([option]);
  return forward(req);
}

// Next / Submit: submits as soon as every question is answered, from any step.
function confirm(req) {
  if (allAnswered(req)) {
    submit(req);
    return true;
  }
  return picked(req).size > 0 && forward(req);
}

function onKey(action, context) {
  const req = current();
  if (action === ACTIONS.status) {
    if (!req) {
      updater.offer();
      return;
    }
    if (queue.length > 1) {
      cursor = (cursor + 1) % queue.length;
      renderAll();
    }
    return;
  }
  if (!req) {
    send('showAlert', { context });
    return;
  }
  // Deny goes through the hook on every path.
  if (req.path === 'probing' && action !== ACTIONS.deny) {
    send('showAlert', { context });
    return;
  }
  if (req.path === 'terminal' && action !== ACTIONS.deny) {
    const option = OPTION_ACTIONS.indexOf(action);
    if (option !== -1) pressInTerminal(req, { kind: 'option', option }, context);
    else if (action === ACTIONS.allow) pressInTerminal(req, { kind: req.step === req.questions.length ? 'submit' : 'next' }, context);
    else send('showAlert', { context }); // ‹ Back
    return;
  }
  const option = OPTION_ACTIONS.indexOf(action);
  if (option !== -1) {
    if (!chooseOption(req, option)) send('showAlert', { context });
    return;
  }
  switch (action) {
    case ACTIONS.allow:
      if (req.questions) {
        if (!confirm(req)) send('showAlert', { context });
        return;
      }
      answer(req, { behavior: 'allow' });
      break;
    case ACTIONS.always: {
      if (req.questions) {
        if (!goTo(req, req.step - 1)) send('showAlert', { context });
        return;
      }
      const suggestion = pickSuggestion(req);
      if (!suggestion) {
        send('showAlert', { context });
        return;
      }
      answer(req, { behavior: 'allow', updatedPermissions: [suggestion] });
      break;
    }
    case ACTIONS.deny:
      // After a press in flight: its keys would otherwise land in the prompt
      // the denied dialog leaves behind.
      if (req.path === 'terminal') {
        asker.after(() => {
          if (!req.closed) answer(req, { behavior: 'deny', message: DENY_MESSAGE, interrupt: true });
        });
        break;
      }
      answer(req, { behavior: 'deny', message: DENY_MESSAGE, interrupt: true });
      break;
    default:
      return;
  }
  send('showOk', { context });
}

// A strip dial shows the option above it across the whole strip: a touch or a
// press shows or hides it, a turn right shows it, a turn left the question.
// It decides nothing, so it works on every path.
const peek = new Peek({ onChange: () => renderAll() });

function onStrip(context) {
  const c = contexts.get(context);
  const req = current();
  if (!c || !currentQuestion(req)?.options[c.column]) send('showAlert', { context });
  else peek.toggle(req, c.column);
}

function onStripTurn(context, ticks) {
  const c = contexts.get(context);
  const req = current();
  if (ticks < 0) peek.clear();
  else if (ticks > 0 && c && currentQuestion(req)?.options[c.column]) peek.show(req, c.column);
}

// ---------- model / effort dial ----------

// From `claude --help`, read once at start; empty when claude is not found.
let effortLevels = [];
let modelAliases = [];

function readClaudeHelp() {
  const bin = findClaude();
  if (!bin) {
    log('claude not found: the effort dial is off, the model dial needs its own list');
    return;
  }
  readHelp(bin)
    .then((help) => {
      effortLevels = parseEffortLevels(help);
      modelAliases = parseModelAliases(help);
      if (!effortLevels.length) log('claude --help lists no effort levels');
      renderAll();
    })
    .catch((e) => log(`claude --help failed: ${e.message}`));
}

const sessions = new Sessions();
const tuner = new Tuner({
  sessions,
  terminal: { frontTab, tabInfo, typeInto },
  levels: () => effortLevels,
  onChange: () => renderAll(),
  // A session with a request on the deck is about to show, or shows, a dialog.
  pending: (id) => queue.some((r) => r.session === id),
});

function logRejection(promise) {
  promise.catch((e) => log(`dial: ${e.message}`));
}

// What a dial changes, from its settings; an empty model list means the
// aliases from claude --help.
function dialOf(context) {
  const settings = contexts.get(context)?.settings || {};
  const models = parseModelList(settings.models);
  return { context, kind: settings.kind === 'effort' ? 'effort' : 'model', items: models.length ? models : modelAliases };
}

function onTunePress(context) {
  logRejection(
    tuner.press().then((ok) => {
      if (!ok) send('showAlert', { context });
    }),
  );
}

// Terminal is asked about its front tab only while a dial, or a Usage action
// showing Context, is on the deck: the interval runs then, and the hooks
// refresh the strip only then too (refreshTune). Apart from them the plugin
// touches Terminal only for a question prompt of a session that reports through
// the statusline (see watchFollow), so without a dial, Context or the
// statusline macOS never asks for Automation access.
let tuneTimer = null;

function refreshTune() {
  if (tuneTimer) logRejection(tuner.refresh());
}

function watchTune() {
  const visible = [...contexts.values()].some(
    (c) => c.action === ACTIONS.tune || (c.action === ACTIONS.usage && wantsContext(c.settings)),
  );
  if (visible && !tuneTimer) {
    tuneTimer = setInterval(() => logRejection(tuner.refresh()), TUNE_REFRESH_EVERY);
    logRejection(tuner.refresh());
  } else if (!visible && tuneTimer) {
    clearInterval(tuneTimer);
    tuneTimer = null;
  }
}

// ---------- questions through the terminal ----------

const FOLLOW_EVERY = 1000;

const asker = new Asker({
  sessions,
  terminal: { tabInfo, pressKeys },
  onChange: () => renderAll(),
  log,
});

// Types a press into the dialog; an alert when nothing was typed (the terminal
// is on another page, the press would need a guess, the tab is gone).
function pressInTerminal(req, press, context) {
  asker
    .press(req, press, req.step)
    .then((ok) => {
      if (!ok) send('showAlert', { context });
      watchFollow();
    })
    .catch((e) => log(`question: ${e.message}`));
}

// While a question goes through the terminal, the deck reads its dialog once a
// second and shows the terminal's page and checks.
let followTimer = null;

function watchFollow() {
  const want = queue.some((r) => r.path === 'terminal');
  if (want && !followTimer) {
    followTimer = setInterval(() => {
      const req = current();
      if (req?.path === 'terminal') {
        asker
          .follow(req)
          .then(watchFollow)
          .catch((e) => log(`question: ${e.message}`));
      }
    }, FOLLOW_EVERY);
  } else if (!want && followTimer) {
    clearInterval(followTimer);
    followTimer = null;
  }
}

// ---------- usage meter ----------

const limits = new Limits();

const isUsage = (c) => c.action === ACTIONS.usage;

// Context follows the dials' session, else the session that reported last.
function contextSession() {
  return tuner.session() || sessions.latest();
}

function renderUsage() {
  for (const [context, c] of contexts) if (isUsage(c)) render(context);
}

function foldReadings(readings) {
  for (const [key, r] of Object.entries(readings)) limits.fold(key, r);
}

// Read only while a Usage action shows a limit; a missing or broken file
// adds nothing.
function readUsageCache() {
  if (![...contexts.values()].some((c) => isUsage(c) && parseMetrics(c.settings).some((m) => m !== 'context'))) return;
  fs.promises
    .readFile(USAGE_CACHE, 'utf8')
    .then((text) => {
      foldReadings(readingsFromCache(JSON.parse(text)));
      renderUsage();
    })
    .catch(() => {});
}

// While a Usage action is on the deck: the cache file once a minute, and a
// redraw so the countdown moves.
let usageTimer = null;

function watchUsage() {
  const visible = [...contexts.values()].some(isUsage);
  if (visible && !usageTimer) {
    usageTimer = setInterval(() => {
      readUsageCache();
      renderUsage();
    }, USAGE_REFRESH_EVERY);
  } else if (!visible && usageTimer) {
    clearInterval(usageTimer);
    usageTimer = null;
  }
}

// Moves the shown metric; it is saved with the action's settings so it
// survives a restart. One metric: nothing to switch to.
function onUsageStep(context, ticks) {
  const c = contexts.get(context);
  if (!c) return;
  const picked = parseMetrics(c.settings);
  if (picked.length < 2 || ticks === 0) return;
  c.settings = { ...c.settings, shown: cycle(picked, shownMetric(c.settings), ticks) };
  send('setSettings', { context, payload: c.settings });
  render(context);
}

// ---------- HTTP server for the hooks ----------

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

// The narrowest suggestion: a rule, then a directory, then a mode switch.
// The key shows exactly the one that is sent.
const SUGGESTION_ORDER = ['addRules', 'addDirectories', 'setMode'];

function pickSuggestion(req) {
  for (const type of SUGGESTION_ORDER) {
    const s = req.suggestions.find((x) => x.type === type);
    if (s) return s;
  }
  return null;
}

const QUESTION_TOOL = 'AskUserQuestion';

// The deck answers the questions one after another when each has at most
// four options; any other AskUserQuestion call is left to the terminal.
function deckQuestions(input) {
  const qs = input.questions;
  if (!Array.isArray(qs) || qs.length === 0) return null;
  const fits = (q) => Array.isArray(q.options) && q.options.length > 0 && q.options.length <= OPTION_ACTIONS.length;
  return qs.every(fits) ? qs : null;
}

// The answered AskUserQuestion input gains `answers`, so its PostToolUse is
// matched by the questions alone.
function inputKey(tool, input) {
  return JSON.stringify(tool === QUESTION_TOOL ? input.questions : input);
}

function onPermission(hook, res) {
  const input = hook.tool_input || {};
  const questions = hook.tool_name === QUESTION_TOOL ? deckQuestions(input) : null;
  if (hook.tool_name === QUESTION_TOOL && !questions) {
    res.end();
    return;
  }
  const req = {
    id: ++seq,
    session: hook.session_id,
    agent: hook.agent_id || '',
    cwd: hook.cwd || '',
    tool: hook.tool_name || '?',
    input,
    inputKey: inputKey(hook.tool_name, input),
    suggestions: Array.isArray(hook.permission_suggestions) ? hook.permission_suggestions : [],
    questions,
    step: 0,
    picked: (questions || []).map(() => new Set()),
    path: questions ? 'probing' : 'hook',
    closed: false,
    tty: null,
    answered: null,
    own: false,
    lostAt: null,
    res,
  };
  queue.push(req);
  // Claude Code closes the connection on a terminal "No", on Esc and on the
  // hook timeout.
  res.on('close', () => remove(req));
  changed();
  if (questions) {
    asker
      .attach(req)
      .then(() => {
        watchFollow();
        renderAll();
      })
      .catch((e) => log(`question: ${e.message}`));
  }
}

function onEvent(hook) {
  const sameSession = (r) => r.session === hook.session_id;
  // A background subagent keeps asking after the main turn ends, so the end of
  // the main turn clears only the main agent's requests.
  const mainAgent = (r) => sameSession(r) && r.agent === '';
  switch (hook.hook_event_name) {
    case 'PostToolUse':
    case 'PostToolUseFailure': {
      const key = inputKey(hook.tool_name, hook.tool_input || {});
      const agent = hook.agent_id || '';
      queue
        .filter((r) => sameSession(r) && r.agent === agent && r.tool === hook.tool_name && r.inputKey === key)
        .forEach(release);
      break;
    }
    case 'Stop':
      sessions.turn(hook.session_id, false);
      queue.filter(mainAgent).forEach(release);
      break;
    case 'StopFailure':
      sessions.turn(hook.session_id, false);
      break;
    case 'UserPromptSubmit':
      sessions.turn(hook.session_id, true);
      queue.filter(mainAgent).forEach(release);
      break;
    case 'SessionEnd':
      sessions.end(hook.session_id);
      refreshTune();
      renderUsage();
      queue.filter(sameSession).forEach(release);
      break;
  }
}

// Ends a request answered elsewhere: an empty response leaves the decision to
// the dialog, which already has it.
function release(req) {
  req.res.end();
  remove(req);
}

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
    // Only state: what a session runs and in which tab. Nothing here is typed.
    const tty = req.headers['x-claude-tty'];
    if (typeof tty !== 'string' || !TTY.test(tty)) {
      res.writeHead(400).end();
      return;
    }
    sessions.report(tty, body);
    foldReadings(readingsFromStatus(body));
    refreshTune();
    renderUsage();
    res.writeHead(204).end();
  } else {
    res.writeHead(404).end();
  }
});

server.requestTimeout = 0;
server.headersTimeout = 10_000;
server.on('error', (e) => log(`server error: ${e.message}`));
server.listen(PORT, '127.0.0.1');

// ---------- rendering ----------

const COLORS = {
  idle: '#2b2b2b',
  picked: '#2e7d32',
  blank: '#000000',
  option: '#6a1b9a',
  status: '#d97757',
  allow: '#2e7d32',
  always: '#1565c0',
  deny: '#c62828',
  disabled: '#3a3a3a',
  muted: '#e0d4ec',
  // an open answer on the review strip
  open: '#b9a3cf',
};

const FONT = '-apple-system, Helvetica, Arial';
// Average glyph width relative to the font size, close enough for Cyrillic.
const GLYPH = 0.6;
// Line breaks go at ordinary whitespace only, so a no-break space keeps the
// picked mark on the label's line.
const BREAK = /[ \t\n]+/;

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function clip(s, n) {
  s = String(s);
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

// Greedy word wrap into at most `max` lines of `width` characters.
function wrap(text, width, max) {
  const lines = [];
  let line = '';
  for (const word of String(text).split(BREAK)) {
    const next = line ? `${line} ${word}` : word;
    if (next.length <= width || !line) {
      line = next;
      continue;
    }
    lines.push(line);
    line = word;
  }
  if (line) lines.push(line);
  if (lines.length > max) {
    lines.length = max;
    lines[max - 1] = clip(`${lines[max - 1]}…`, width);
  }
  return lines.map((l) => clip(l, width));
}

// Breaks words longer than `width` in two hyphenated halves; null when a
// word needs more than two lines.
function hyphenate(text, width) {
  const words = [];
  for (const w of String(text).split(BREAK)) {
    if (w.length <= width) {
      words.push(w);
      continue;
    }
    if (w.length > 2 * width - 1) return null;
    const half = Math.ceil(w.length / 2);
    words.push(`${w.slice(0, half)}-`, w.slice(half));
  }
  return words.join(' ');
}

// The largest size from `sizes` at which `text` fits `maxLines` lines of
// `boxWidth` pixels: whole words first, then hyphenated; the smallest size
// truncates.
function fit(text, boxWidth, maxLines, sizes) {
  const widthAt = (size) => Math.floor(boxWidth / (size * GLYPH));
  for (const size of sizes) {
    const width = widthAt(size);
    const lines = wrap(text, width, Infinity);
    if (lines.length <= maxLines && String(text).split(BREAK).every((w) => w.length <= width)) return { size, lines };
  }
  for (const size of sizes) {
    const split = hyphenate(text, widthAt(size));
    const lines = split && wrap(split, widthAt(size), Infinity);
    if (lines && lines.length <= maxLines) return { size, lines };
  }
  const size = sizes[sizes.length - 1];
  return { size, lines: wrap(text, widthAt(size), maxLines) };
}

function textEl(x, y, t, size, weight = 'normal', anchor = 'middle', fill = '#fff') {
  return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(t)}</text>`;
}

function svgURI(width, height, bg, body, viewBox = `0 0 ${width} ${height}`) {
  const image = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${viewBox}"><rect x="-1000" y="-1000" width="3000" height="3000" fill="${bg}"/>${body}</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(image).toString('base64')}`;
}

// A 144×144 key with centred lines of [text, size, weight].
function key(bg, lines) {
  const largest = Math.max(...lines.map(([, size]) => size));
  const step = lines.length === 1 ? 0 : Math.min(108 / lines.length, largest * 1.3);
  const top = 72 - (step * (lines.length - 1)) / 2;
  const body = lines.map(([t, size, weight], i) => textEl(72, top + i * step + size / 3, t, size, weight)).join('');
  return svgURI(144, 144, bg, body);
}

function fittedKey(bg, text) {
  const { size, lines } = fit(text, 130, 3, [30, 26, 22, 18, 15]);
  return key(bg, lines.map((l) => [l, size, 'bold']));
}

function detail(req) {
  const i = req.input;
  if (typeof i.command === 'string') return i.command;
  if (typeof i.file_path === 'string') return path.basename(i.file_path);
  if (typeof i.url === 'string') return i.url.replace(/^https?:\/\//, '');
  if (typeof i.pattern === 'string') return i.pattern;
  return '';
}

function fullDetail(req) {
  const i = req.input;
  for (const k of ['command', 'file_path', 'url', 'pattern', 'query', 'prompt']) {
    if (typeof i[k] === 'string') return i[k];
  }
  return JSON.stringify(i);
}

function toolLabel(tool) {
  const m = /^mcp__(.+?)__(.+)$/.exec(tool);
  return m ? m[2] : tool;
}

function suggestionLabel(s) {
  switch (s.type) {
    case 'addRules':
      return (s.rules || []).map((r) => r.ruleContent || r.toolName).join(', ');
    case 'setMode':
      return s.mode;
    case 'addDirectories':
      return (s.directories || []).map((d) => path.basename(d)).join(', ');
    default:
      return s.type;
  }
}

function keyImage(action) {
  const req = current();
  switch (action) {
    case ACTIONS.status:
      if (!req && updater.available()) return key(COLORS.always, [['Update', 26, 'bold'], [updater.latest.tag, 22]]);
      if (!req) return key(COLORS.idle, [['Claude', 26, 'bold'], ['idle', 22]]);
      if (req.questions) {
        const q = currentQuestion(req);
        const marks = answeredMarks(req);
        if (!q) {
          const done = marks.filter(Boolean).length;
          return key(COLORS.option, [['Review', 24, 'bold'], [`${done}/${req.questions.length} answered`, 18], [dots(marks, req.step), 20]]);
        }
        if (req.questions.length === 1) {
          return key(COLORS.option, [[clip(q.header || 'Question', 10), 24, 'bold'], ...wrap(q.question, 14, 2).map((l) => [l, 18])]);
        }
        return key(COLORS.option, [
          [`${clip(q.header || 'Question', 7)} ${req.step + 1}/${req.questions.length}`, 22, 'bold'],
          [clip(q.question, 14), 18],
          [dots(marks, req.step), 20],
        ]);
      }
      return key(COLORS.status, [
        [clip(toolLabel(req.tool), 10), 28, 'bold'],
        [clip(detail(req), 14), 18],
        [`${clip(path.basename(req.cwd), 10)}${queue.length > 1 ? ` ${cursor + 1}/${queue.length}` : ''}`, 18],
      ]);
    case ACTIONS.allow: {
      if (req?.questions && req.path === 'terminal') {
        // Submit only on the review page; Next only on a multi-select page (a
        // single-select one moves on with its option key).
        const q = currentQuestion(req);
        if (!q) return key(allAnswered(req) ? COLORS.allow : COLORS.disabled, [['Submit', 30, 'bold']]);
        const lines = [['Next', 30, 'bold']];
        if (q.multiSelect) lines.push([`${picked(req).size} picked`, 18]);
        return key(q.multiSelect ? COLORS.allow : COLORS.disabled, lines);
      }
      if (req?.questions) {
        const done = allAnswered(req);
        const enabled = done || picked(req).size > 0;
        const lines = [[done ? 'Submit' : 'Next', 30, 'bold']];
        if (currentQuestion(req).multiSelect) lines.push([`${picked(req).size} picked`, 18]);
        return key(enabled ? COLORS.allow : COLORS.disabled, lines);
      }
      return key(req ? COLORS.allow : COLORS.disabled, [['Allow', 32, 'bold']]);
    }
    case ACTIONS.always: {
      if (req?.questions) return key(req.step > 0 && req.path !== 'terminal' ? COLORS.always : COLORS.disabled, [['‹ Back', 30, 'bold']]);
      const suggestion = req && pickSuggestion(req);
      if (!suggestion) return key(COLORS.disabled, [['Always', 30, 'bold']]);
      return key(COLORS.always, [['Always', 30, 'bold'], [clip(suggestionLabel(suggestion), 14), 18]]);
    }
    case ACTIONS.deny:
      return key(req ? COLORS.deny : COLORS.disabled, [['Deny', 32, 'bold']]);
  }
  const option = OPTION_ACTIONS.indexOf(action);
  if (option !== -1) {
    const label = currentQuestion(req)?.options[option]?.label;
    if (label === undefined) return key(COLORS.blank, []);
    return picked(req).has(option) ? fittedKey(COLORS.picked, `✓\u00a0${label}`) : fittedKey(COLORS.option, label);
  }
  return null;
}

// One 200×100 touch strip segment: its slice of the request detail, or of the
// question view (see strip.js), drawn across the whole 800-pixel strip.
function stripImage(column) {
  const req = current();
  if (!req) return svgURI(200, 100, COLORS.blank, '');
  const viewBox = `${column * 200} 0 200 100`;
  // Read for every request: a permission request shown in between drops it too.
  const option = peek.option(req);
  if (req.questions) {
    const view = stripView({ questions: req.questions, step: req.step, picked: req.picked, answered: answeredMarks(req) }, option);
    return svgURI(200, 100, view.picked ? COLORS.picked : COLORS.option, questionStrip(view), viewBox);
  }
  const head = `${toolLabel(req.tool)} · ${path.basename(req.cwd)}${queue.length > 1 ? ` · ${cursor + 1}/${queue.length}` : ''}`;
  const { size, lines } = fit(fullDetail(req), 780, 3, [20, 17, 15, 13]);
  const body = textEl(10, 22, head, 17, 'bold', 'start') + lines.map((l, i) => textEl(10, 44 + i * (size + 4), l, size, 'normal', 'start')).join('');
  return svgURI(200, 100, COLORS.status, body, viewBox);
}

// The question view on the 800×100 strip, laid out like the request detail:
// the head line with a muted note on the right, then up to three lines of the
// question or the option's description, or a line per answer.
function questionStrip(view) {
  const headSize = view.kind === 'option' ? 20 : 17;
  const sideWidth = view.side ? view.side.length * 15 * GLYPH + 20 : 0;
  const head = fit(view.head, 780 - sideWidth, 1, [headSize, 15]);
  let body = textEl(10, 22, head.lines[0], head.size, 'bold', 'start') + textEl(790, 22, view.side, 15, 'normal', 'end', COLORS.muted);
  if (view.rows) {
    // Four answers (the most a question prompt has) end at 93.
    const [size, step] = view.rows.length > 3 ? [15, 17] : [17, 22];
    view.rows.forEach((r, i) => {
      body += textEl(10, 42 + i * step, fit(r.text, 780, 1, [size]).lines[0], size, 'normal', 'start', r.open ? COLORS.open : '#fff');
    });
    return body;
  }
  const { size, lines } = fit(view.text, 780, 3, [20, 17, 15, 13]);
  return body + lines.map((l, i) => textEl(10, 44 + i * (size + 4), l, size, 'normal', 'start')).join('');
}

// One 200×100 segment for a Model / Effort dial: what it changes, the value
// (blue while turning) or a notice, and the target project.
function tuneStrip(view) {
  const text = view.notice || view.value || '—';
  const one = fit(text, 184, 1, [30, 26, 22, 18]);
  const { size, lines } = one.lines.join(' ') === text ? one : fit(text, 184, 2, [22, 18]);
  const lineH = size * 1.1;
  const top = 56 - (lines.length * lineH) / 2 + size * 0.8;
  const project = view.project ? `${clip(view.project, view.chosen ? 11 : 20)}${view.chosen ? ' · chosen' : ''}` : '';
  const body =
    textEl(100, 22, view.kind === 'effort' ? 'Effort' : 'Model', 17, 'bold') +
    lines.map((l, i) => textEl(100, top + i * lineH, l, size, 'bold')).join('') +
    textEl(100, 92, project, 15, 'normal', 'middle', COLORS.muted);
  return svgURI(200, 100, view.pending ? COLORS.always : COLORS.idle, body);
}

// Threshold colours of the Usage scale; white text stays readable on each.
const LEVEL = { green: '#2e7d32', yellow: '#b28704', red: '#c62828' };
const TRACK = '#444444';
const DIM = '#888888';

// A Usage key: the whole key fills from the bottom up to the percentage.
function usageKey(view) {
  const fill = view.pct === null ? '' : `<rect x="0" y="${144 - (144 * view.pct) / 100}" width="144" height="${(144 * view.pct) / 100}" fill="${LEVEL[view.level]}"/>`;
  const muted = view.pct === null ? DIM : '#fff';
  const body =
    fill +
    textEl(72, 32, clip(view.label, 11), 20, 'bold') +
    textEl(72, 86, view.pct === null ? '—' : `${view.pct}%`, 40, 'bold', 'middle', muted) +
    textEl(72, 130, clip(view.sub, 15), 15, 'normal', 'middle', muted);
  return svgURI(144, 144, COLORS.idle, body);
}

// A Usage strip segment: label and position dots on top, the percentage and
// the bottom line on one row, a bar along the bottom.
function usageStrip(view, picked, shown) {
  const dots = picked.length > 1 ? picked.map((m) => (m === shown ? '●' : '○')).join(' ') : '';
  const bar = view.pct === null ? '' : `<rect x="12" y="74" width="${(176 * view.pct) / 100}" height="14" rx="7" fill="${LEVEL[view.level]}"/>`;
  const body =
    textEl(12, 24, clip(view.label, 12), 17, 'bold', 'start') +
    textEl(188, 24, dots, 12, 'normal', 'end', COLORS.muted) +
    textEl(12, 60, view.pct === null ? '—' : `${view.pct}%`, 30, 'bold', 'start', view.pct === null ? DIM : '#fff') +
    textEl(188, 60, clip(view.sub, 14), 14, 'normal', 'end', view.pct === null ? DIM : COLORS.muted) +
    `<rect x="12" y="74" width="176" height="14" rx="7" fill="${TRACK}"/>` +
    bar;
  return svgURI(200, 100, COLORS.idle, body);
}

function render(context) {
  const c = contexts.get(context);
  if (!c) return;
  if (c.action === ACTIONS.usage) {
    const picked = parseMetrics(c.settings);
    const shown = shownMetric(c.settings);
    const view = usageView(shown, { limits, session: contextSession(), now: Date.now() });
    if (c.encoder) send('setFeedback', { context, payload: { 'full-canvas': usageStrip(view, picked, shown), title: '' } });
    else send('setImage', { context, payload: { image: usageKey(view), target: 0 } });
    return;
  }
  if (c.action === ACTIONS.tune) {
    send('setFeedback', { context, payload: { 'full-canvas': tuneStrip(tuner.view(dialOf(context))), title: '' } });
    return;
  }
  if (c.action === ACTIONS.strip) {
    send('setFeedback', { context, payload: { 'full-canvas': stripImage(c.column), title: '' } });
    return;
  }
  const img = keyImage(c.action);
  if (img) send('setImage', { context, payload: { image: img, target: 0 } });
}

function renderAll() {
  for (const context of contexts.keys()) render(context);
}
