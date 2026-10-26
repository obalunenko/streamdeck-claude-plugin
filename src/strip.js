// The touch strip of the Strip dials while a question is pending: the
// question across all four segments, the option above a touched or turned dial
// for a few seconds, the answers on the review page. Choosing and moving
// between questions are left to the keys. plugin.js draws the view.

const PEEK_FOR = 4000;

// ● answered, ○ open; the current one is bracketed.
function dots(answered, step) {
  return answered.map((a, i) => (i === step ? `[${a ? '●' : '○'}]` : a ? '●' : '○')).join('');
}

// What the strip shows for a question request: `picked` and `answered` per
// question as the deck holds them, `option` the peeked option or -1.
// A typed answer from the terminal is answered without a picked option.
function stripView({ questions, step, picked, answered }, option = -1) {
  const n = questions.length;
  const q = questions[step];
  if (!q) {
    return {
      kind: 'review',
      head: 'Review your answers',
      side: `${answered.filter(Boolean).length}/${n} answered`,
      rows: questions.map((x, i) => {
        const labels = x.options.filter((_, o) => picked[i].has(o)).map((o) => o.label);
        const answer = labels.length ? labels.join(', ') : answered[i] ? '✓' : '—';
        return { text: `${x.header || 'Question'} → ${answer}`, open: !answered[i] };
      }),
    };
  }
  const position = n > 1 ? `${q.header || 'Question'} · ${step + 1}/${n}` : q.header || 'Question';
  const o = q.options[option];
  if (o) {
    const chosen = picked[step].has(option);
    return {
      kind: 'option',
      head: `${chosen ? '✓ ' : ''}${option + 1} · ${o.label}`,
      side: position,
      text: o.description || '',
      picked: chosen,
    };
  }
  return { kind: 'question', head: position, side: n > 1 ? dots(answered, step) : '', text: q.question };
}

// The option a dial asked to see. It belongs to the request page it was asked
// on, so moving on hides it without a reset; so do the peek time, a second
// touch and clear(). It does not come back with the page.
class Peek {
  constructor({ onChange, ms = PEEK_FOR, timers = { setTimeout, clearTimeout } }) {
    this.onChange = onChange;
    this.ms = ms;
    this.timers = timers;
    this.shown = null;
    this.timer = null;
  }

  // Shows `option` of the request's current page, or hides it when shown.
  toggle(req, option) {
    if (this.option(req) === option) this.clear();
    else this.show(req, option);
  }

  // Shows `option` of the request's current page for the peek time.
  show(req, option) {
    this.stop();
    this.shown = { id: req.id, step: req.step, option };
    this.timer = this.timers.setTimeout(() => {
      this.timer = null;
      this.shown = null;
      this.onChange();
    }, this.ms);
    this.onChange();
  }

  clear() {
    if (!this.shown) return;
    this.stop();
    this.shown = null;
    this.onChange();
  }

  // The option shown for this request's current page, or -1. A read from
  // another page drops it, so coming back shows the question.
  option(req) {
    const s = this.shown;
    if (!s) return -1;
    if (req && s.id === req.id && s.step === req.step) return s.option;
    this.stop();
    this.shown = null;
    return -1;
  }

  stop() {
    if (this.timer !== null) this.timers.clearTimeout(this.timer);
    this.timer = null;
  }
}

module.exports = { dots, stripView, Peek };
