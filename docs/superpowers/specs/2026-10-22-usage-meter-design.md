# Usage meter — design

Date: 2026-10-22 · Branch: `develop` · Claude Code measured: 2.1.306

## Intent

See at a glance on the deck how full the context of the current Claude Code
session is and how much of the plan limits is used (5-hour, 7-day, and the
model-scoped weekly limit — Fable 7d today), without reading the statusline.
Each value is a scale that turns from green to yellow to red as it fills, so
"time to `/compact`" or "slow down, the 5h window is almost gone" is visible
from the corner of the eye.

## Goals

- A new action, **Usage**, that goes both on a key and on a Stream Deck + dial.
- Its settings (Property Inspector) pick which metrics it shows: **Context**,
  **5h**, **7d**, **Fable 7d** (any combination, at least one).
- One metric is on screen at a time. With more than one picked:
  - dial: rotating, pushing or tapping the strip switches to another metric;
  - key: pressing switches to the next one.
  Several keys / dials, one metric each, show everything at once.
- Colour by the shown percentage: **green below 75 %, yellow from 75 % to 85 %
  inclusive, red above 85 %.**
- A bottom line with context: the project folder for Context, the time left
  until the reset for the limits.

## Non-goals

- Credits / extra-usage spend (the statusline shows it; not asked for).
- Several scoped weekly limits at once; history, charts, notifications.
- Putting the action into the bundled **Claude** profile (that profile replaces
  the deck while a request waits; same choice as the Model / Effort dial).
- The plugin calling the Anthropic OAuth usage API itself.

## Anti-goals (a failure even if it "works")

- The plugin reading the Keychain or holding an OAuth token. Same rule as glab:
  the plugin never handles a token.
- Showing a stale number as if it were current — a limit whose window has
  already reset must not stay red.
- A Usage action alone on the deck making macOS ask for Terminal Automation
  access when nothing on it needs Terminal.

## Data sources (measured on the user's machine)

1. **Statusline JSON**, already POSTed to `/statusline` with `X-Claude-TTY`:
   - `context_window.used_percentage` (number; may be `null` early in a
     session) — per session.
   - `rate_limits.five_hour.{used_percentage, resets_at}` and
     `rate_limits.seven_day.{used_percentage, resets_at}`; `resets_at` is Unix
     seconds. Account-wide; absent for API-key logins.
2. **`~/.claude/cache/oauth-usage.json`**, written by the user's statusline
   script from `GET https://api.anthropic.com/api/oauth/usage` at most once a
   minute. Shape (trimmed):

   ```json
   {"five_hour": {"utilization": 4.0, "resets_at": "2026-10-22T01:10:00.47+00:00"},
    "seven_day": {"utilization": 13.0, "resets_at": "2026-10-24T08:00:00.47+00:00"},
    "limits": [
     {"kind": "session", "percent": 2, "resets_at": "2026-10-22T01:10:00.35+00:00", "scope": null},
     {"kind": "weekly_all", "percent": 13, "resets_at": "…", "scope": null},
     {"kind": "weekly_scoped", "percent": 0, "resets_at": "2026-10-24T08:00:00+00:00",
      "scope": {"model": {"id": null, "display_name": "Fable"}}}
   ]}
   ```

   `resets_at` here is an ISO string. Used: `five_hour` and `seven_day`
   (`utilization`, account-wide, including claude.ai) for 5h / 7d, and the
   first `weekly_scoped` entry for the scoped limit. The file is the user's
   own convention; without it 5h / 7d still come from the statusline, and the
   scoped limit shows "no data".

The plugin needs no new hook and no change to `hooks.json`.

## How it works

### Metrics

| Metric    | Value                                   | Bottom line            | Source |
|-----------|-----------------------------------------|------------------------|--------|
| Context   | `context_window.used_percentage`        | project folder         | statusline of the target session |
| 5h        | `rate_limits.five_hour.used_percentage` / cache `five_hour.utilization` | `↻ 1h12m` | merged: every statusline report + the cache file |
| 7d        | `rate_limits.seven_day.used_percentage` / cache `seven_day.utilization` | `↻ 2d 3h` | merged: every statusline report + the cache file |
| Fable 7d  | first `weekly_scoped` entry's `percent` | `↻ 2d 3h`              | the cache file |

- The Fable label comes from the entry: `<display_name> 7d`. If the scope later
  names another model, the label follows. The settings name for this metric is
  generic (e.g. `scoped`), not `fable`. *(My call.)*
- **Target session for Context:** the same as the Model / Effort dial — the
  front Terminal tab when it is a registered session, else the tab chosen on the
  deck — and, failing both, the session whose statusline reported most
  recently. *(My call: a Usage dial cannot choose a session, its press switches
  metrics.)*
- **5h / 7d are merged, not "last report wins"** (decided by the user). Each
  `claude` process sends its own copy of `rate_limits`, and an idle session's
  copy can be old — even from a window that has already reset. Every reading
  (each statusline report, each cache read) is folded into one value per
  limit:
  - a reading of a **later window** (larger `resets_at`) replaces the held one;
  - within the **same window** the **higher** percentage wins (usage only grows
    inside a window);
  - a reading of an earlier window is ignored.

  Two `resets_at` belong to the same window when they differ by less than 10
  minutes *(my call: the API and the statusline report the same reset with
  sub-second differences, `…00.35` vs `…00.47`)*. A reading without
  `resets_at` counts only when nothing is held yet.
- The cache file is read when a Usage action appears and then once a minute,
  while a Usage action showing 5h, 7d or the scoped limit is on the deck. A
  missing or unreadable file, or a missing entry, adds nothing — silently.
- **Staleness = reset passed, nothing else** (decided by the user). When the
  held value's `resets_at` is in the past, that limit shows `0 %` with no
  countdown until a reading of the new window comes. *(The window really has
  reset; "no data" would hide a usable limit.)* Old but unreset values are
  shown as they are, without an age mark — they barely move while the user is
  not working.
- **Thresholds** are applied to the percentage rounded to a whole number, the
  same number the key shows (so `85 %` is never red). Values are clamped to
  0–100 for drawing.
- Countdown format: `↻ 45m`, `↻ 1h12m`, `↻ 2d 3h`.
- No data (plugin just started, API-key login, no session yet, `null`
  context): label, `—` instead of the percentage, `no data` at the bottom, no
  fill. Context with no target session: `no session`.

### Key (144×144) — fill

Chosen by the user (variant B in the mockup): the whole key fills from the
bottom up to the percentage, in the threshold colour, over the idle grey.
Label on top, the percentage large in the middle, the bottom line small at the
bottom. Text is white and must stay readable over all three fill colours —
the builder picks shades accordingly (a darker amber rather than a pale
yellow).

### Dial segment (200×100) — bar

As in the mockup: label top-left, position dots top-right (`○ ● ○` — which of
the picked metrics is shown; hidden when only one is picked), the percentage
large on the left, the bottom line right-aligned on the same row, a rounded
horizontal bar along the bottom in the threshold colour over a dark track.

### Switching

- Dial: rotate +n / −n moves n metrics forward / back among the picked ones,
  wrapping. Push and touch move one forward.
- Key: press moves one forward, wrapping. With one metric picked a press does
  nothing.
- The shown metric is saved in the action's settings, so it survives a plugin
  restart. *(My call.)*

### Settings (Property Inspector)

`pi/usage.html`, plain HTML like `pi/tune.html`: four checkboxes in the fixed
order Context, 5h, 7d, Fable 7d. Default: all four. The last checked box
cannot be unchecked.

### Refresh

The Usage actions re-render on:

- every `/statusline` report;
- a change of the Context target (front tab switched, chosen session changed,
  a session ended);
- the one-minute timer (cache file reread + countdown).

**Terminal access:** the front-tab lookup runs only while a Usage action with
Context picked, or a Model / Effort dial, is on the deck — the same rule that
keeps the plugin from touching Terminal otherwise. A Usage action showing only
limits never asks Terminal anything. When the lookup is denied, Context falls
back to the chosen / most recent session; no `no access` notice. *(My call.)*

## Security

- Nothing new is typed, and no endpoint is added. The statusline values are
  numbers and strings that are only drawn: numbers are checked with
  `Number.isFinite`, strings escaped as in the rest of the rendering.
- The cache file is only read; the plugin never touches the Keychain or the
  network for this feature.

## Constraints

- Node 20, plain Stream Deck WebSocket protocol over `ws`, no Elgato SDK, no new
  npm dependencies.
- Keep the plugin UUID; new action UUID `com.obalunenko.claudeperm.usage`,
  Controllers `Keypad` and `Encoder`, encoder layout `$A0` with full-canvas
  feedback like the other dial actions.
- Comments and user-facing strings in English.
- Raise `Version` in `manifest.json` for local test builds (fourth number).

## Left to the builder

- Code structure (a `src/usage.js` with pure helpers — metric extraction,
  colour, countdown, cycling — next to `tune.js` fits the repo), and how the
  Context target is shared with the Tuner.
- Exact colours, font sizes and the icon in `scripts/icons.sh`.
- Tests: threshold boundaries (74/75/85/86), reset-passed, null / absent data,
  cache file shapes, cycling with rotate ±n, and the merge (later window wins,
  same window keeps the higher value, an idle session's old-window report does
  not reset a red key to 0 %).
- README section (what the action shows; that Fable 7d needs the statusline to
  write the cache file, with the snippet), CLAUDE.md layout and facts.
- Commits follow the repo's style.
