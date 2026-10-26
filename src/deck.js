// The deck's actions: their UUIDs, which question prompts fit the option keys,
// what a key does to a question on the terminal path, and which background
// work the actions on the deck need.

const { parseMetrics, wantsContext } = require('./usage');

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

// The deck answers the questions one after another when each has at most
// four options; any other AskUserQuestion call is left to the terminal.
function deckQuestions(input) {
  const qs = input.questions;
  if (!Array.isArray(qs) || qs.length === 0) return null;
  const fits = (q) => Array.isArray(q.options) && q.options.length > 0 && q.options.length <= OPTION_ACTIONS.length;
  return qs.every(fits) ? qs : null;
}

// A key on a question that is being probed or answered through the terminal:
// a press to type, 'hook' for Deny (it answers through the hook on every
// path), or 'alert'. null on the hook path, where the deck answers itself.
function terminalKey(req, action) {
  if (req.path !== 'probing' && req.path !== 'terminal') return null;
  if (action === ACTIONS.deny) return 'hook';
  if (req.path === 'probing') return 'alert';
  const option = OPTION_ACTIONS.indexOf(action);
  if (option !== -1) return { kind: 'option', option };
  if (action === ACTIONS.allow) return { kind: req.step === req.questions.length ? 'submit' : 'next' };
  return 'alert'; // ‹ Back
}

// Terminal is asked about its front tab only for a dial or a Usage action
// showing Context, so a deck without them never makes macOS ask for
// Automation access. `contexts` holds {action, settings}.
function needsFrontTab(contexts) {
  return [...contexts].some((c) => c.action === ACTIONS.tune || (c.action === ACTIONS.usage && wantsContext(c.settings)));
}

// The cache file is read only while a Usage action shows a limit.
function needsUsageCache(contexts) {
  return [...contexts].some((c) => c.action === ACTIONS.usage && parseMetrics(c.settings).some((m) => m !== 'context'));
}

module.exports = { PLUGIN, ACTIONS, OPTION_ACTIONS, deckQuestions, terminalKey, needsFrontTab, needsUsageCache };
