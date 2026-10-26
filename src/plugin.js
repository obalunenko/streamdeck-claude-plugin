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
const os = require('node:os');
const path = require('node:path');
const WebSocket = require('ws');
const { Updater } = require('./update');
const { findClaude, readHelp, parseEffortLevels, parseModelAliases } = require('./claude-cli');
const { frontTab, tabInfo, typeInto, pressKeys } = require('./terminal');
const { Sessions, Tuner, parseModelList } = require('./tune');
const { Asker } = require('./ask');
const { dots, stripView, Peek } = require('./strip');
const { Limits, readingsFromStatus, readCache, parseMetrics, shownMetric, cycle, usageView } = require('./usage');
const { ACTIONS, OPTION_ACTIONS, deckQuestions, terminalKey, needsFrontTab, needsUsageCache } = require('./deck');
const { createServer } = require('./server');
const { COLORS, clip, wrap, fit, textEl, svgURI, key, fittedKey, questionStrip, tuneStrip, usageKey, usageStrip } = require('./draw');

const PORT = 47823;

const PROFILE = 'Claude';
const STREAM_DECK_PLUS = 7;
// Switching back to "the previous profile" without having switched would move
// the deck somewhere unexpected, so nothing switches until the profile ships.
const PROFILE_BUNDLED = fs.existsSync(path.join(__dirname, '..', `${PROFILE}.streamDeckProfile`));

const DENY_MESSAGE = 'Denied from Stream Deck';

const VERSION = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8')).Version;
const FIRST_UPDATE_CHECK = 30 * 1000;
const UPDATE_CHECK_EVERY = 12 * 60 * 60 * 1000;

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

/** @type {{id:number, session:string, agent:string, cwd:string, tool:string, input:object, inputKey:string, suggestions:object[], questions:object[]|null, step:number, picked:Set<number>[], path:'probing'|'terminal'|'hook', closed:boolean, tty:string|null, answered:boolean[]|null, own:boolean, lostAt:number|null, res:import('node:http').ServerResponse}[]} */
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
  const press = terminalKey(req, action);
  if (press === 'alert') {
    send('showAlert', { context });
    return;
  }
  if (press && press !== 'hook') {
    pressInTerminal(req, press, context);
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
  const visible = needsFrontTab(contexts.values());
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

function readUsageCache() {
  if (!needsUsageCache(contexts.values())) return;
  readCache(USAGE_CACHE).then((readings) => {
    foldReadings(readings);
    renderUsage();
  });
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

const server = createServer({
  onPermission,
  onEvent,
  // Only state: what a session runs and in which tab. Nothing here is typed.
  onStatusline: (tty, body) => {
    sessions.report(tty, body);
    foldReadings(readingsFromStatus(body));
    refreshTune();
    renderUsage();
  },
});
server.on('error', (e) => log(`server error: ${e.message}`));
server.listen(PORT, '127.0.0.1');

// ---------- rendering ----------

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
