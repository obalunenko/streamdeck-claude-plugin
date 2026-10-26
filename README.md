# streamdeck-claude-plugin

A Stream Deck plugin that answers Claude Code from the deck: allow or deny a
tool call, and pick an option in an `AskUserQuestion` prompt. The terminal
dialog stays up as usual — whichever answer comes first wins. A dial on the
Stream Deck + changes the model or the effort of a running session.

Claude Code hooks talk to the plugin over `http://127.0.0.1:47823`. On a
Stream Deck + the plugin switches the device to its own **Claude** profile while
something is waiting for an answer, and switches back afterwards.

## Quick Start

> First time? Do this once and you're good to go.

**1. Install the plugin.** Download `streamdeck-claude-plugin.streamDeckPlugin`
from the [latest release](https://github.com/obalunenko/streamdeck-claude-plugin/releases/latest)
and open it — the Stream Deck app installs it.

**2. Add the hooks** from [`hooks.json`](hooks.json) to `~/.claude/settings.json`.
This appends them to the hooks already there and keeps a backup:

```bash
git clone https://github.com/obalunenko/streamdeck-claude-plugin.git
cd streamdeck-claude-plugin
cp ~/.claude/settings.json ~/.claude/settings.json.bak
jq -s '.[0] as $s | .[1].hooks as $h | $s
  | .hooks = (reduce ($h | keys[]) as $k ((.hooks // {}); .[$k] = ((.[$k] // []) + $h[$k])))' \
  ~/.claude/settings.json.bak hooks.json > ~/.claude/settings.json
```

`PermissionRequest` waits for the deck; the other events tell the plugin a
request was answered in the terminal, and when a session is busy.

**3. Restart your Claude Code sessions** — hooks are read at startup.

**4. Stream Deck + only:** on the first request the app asks to install the
**Claude** profile. Confirm it; the dialog may open behind other windows.

**5. Check it.** In a session started with `claude --permission-mode default`,
ask Claude to run `touch x.txt`: the deck lights up, **Allow** runs the command.

If the Stream Deck app is not running, `curl` fails at once and Claude Code shows
its usual dialog.

---

## Actions

| Action | What it does |
|---|---|
| **Pending request** | Shows the tool, its command or file, and the project. With several requests pending, a press switches to the next one |
| **Allow** | Allows the call once. On a question it turns into **Next**, and into **Submit** once every question is answered |
| **Always** | Allows and applies one rule the dialog suggested — a rule, then a directory, then a mode, narrowest first. The key shows exactly what is applied. On a question it turns into **‹ Back** |
| **Deny** | Denies the call and stops Claude, like **No** in the terminal |
| **Option 1–4** | Answer an `AskUserQuestion` prompt with that option; on a multi-select question, pick or unpick it |
| **Strip** (encoder) | One quarter of the Stream Deck + touch strip; four of them show across the whole strip the full command, or the whole question with its position and which questions are answered. Tap, press or turn right to see the description of the option above for 4 s; tap again or turn left to see the question. On the terminal dialog's review page the strip lists the answers |
| **Model / Effort** (encoder) | Changes the model or the effort of the Claude session in the front Terminal tab; see [Model and effort dial](#model-and-effort-dial) |
| **Usage** (key or encoder) | Shows the context fill of a session or a plan limit (5h, 7d, Fable 7d) as a green / yellow / red scale; see [Usage meter](#usage-meter) |

The deck walks through the questions of a prompt like the tabs of the terminal
dialog. The status key shows the current one (`2/3`) and which are answered
(`●[○]○`). A single-choice option answers its question and moves on; on a
multi-select question the options toggle. Chosen options are green with a ✓ and
stay chosen when you come back. **‹ Back** and **Next** move between
questions; **Submit** sends the answers once every question has one. A prompt with
one single-choice question is sent as soon as you choose. **Deny** drops the whole
prompt. A free-text **Other** answer is not available on the deck: type it in the
terminal.

When the session reports through the statusline (see
[Model and effort dial](#model-and-effort-dial)) and its Terminal tab shows the
prompt, the deck answers **in the terminal dialog**: each press is typed there
as arrow keys plus Enter, so the terminal turns to the page the deck shows, and
you can read the whole question and the option descriptions there. The deck
follows the dialog, also when you answer with the keyboard. Then:

- **‹ Back** does not move between questions: in the dialog that would change
  an answer. Go back with the keyboard; the deck follows.
- **Next** is off on a single-choice question: press the option to answer it
  and move on, also on a question answered before.
- After the last question the dialog shows its review page; **Submit** sends the
  answers from there once every question is answered. A prompt with one
  multi-select question takes **Next**, then **Submit**.

Without the statusline, in another terminal, or without access to Terminal, the
deck answers through the hook as described above.

## How answers behave

- **Yes** in the terminal does not cancel the hook; the keys clear once the tool
  has run.
- **No** or **Esc** in the terminal cancels the hook; the keys clear at once.
- With no answer in 600 s the hook is cancelled and the terminal dialog stays.
- In `auto` permission mode the hook fires only when auto mode would really ask.
- A background subagent that cannot show a dialog waits for the deck until the
  timeout, then gets a denial.

## Model and effort dial

**Model / Effort** turns through models or effort levels and switches a running
Claude Code session in Terminal.app, without a restart. Put it on two dials:
in the Property Inspector set **Changes** to **Model** on one and to **Effort**
on the other. The model dial goes through its **Models** list, one alias or
model name per line (empty: the aliases from `claude --help`); the effort dial
goes through the levels `claude --help` lists. Models wrap around; effort stops
at both ends.

The strip shows what the dial changes, the session's current value and its
project. Turning shows the new value in blue; once the dial has been still for
half a second, the plugin types `/model <value>` or `/effort <value>` into the
session's tab. A draft in the prompt is stashed first (Ctrl+S) and comes back
after the command. When you decline the `/model` confirmation, the draft can stay
in the stash (`› stashed` above the prompt; the dial then reads `busy`): press
Ctrl+S on an empty prompt to get it back.

The dial goes to the selected tab of Terminal's front window, even with another
app in front. When that tab is not a Claude session, press the dial (or tap the
strip) to choose one of the running sessions; the strip then shows `· chosen`.
The dial is not in the bundled **Claude** profile: while a request waits for an
answer, the deck shows that profile instead, and a turn made just before types
nothing into a session whose request waits.

Claude Code's own behaviour applies: `/effort` also saves the level as the
default for the current model, and `/model` in the middle of a conversation asks
to confirm — confirm it in the terminal.

### Setup

**1. Report the session to the plugin from the statusline.** The plugin learns
each session's tab, model and effort from Claude Code's statusline. Add these
lines to your statusline script, after the line that reads its input into
`$input` (`input=$(cat)`):

```bash
# Stream Deck: report model, effort and this session's tty to the plugin.
tty=$(p=$PPID; while [ "${p:-1}" -gt 1 ]; do case "$(ps -o comm= -p "$p")" in (claude|*/claude) ps -o tty= -p "$p" | tr -d ' '; break ;; esac; p=$(ps -o ppid= -p "$p" | tr -d ' '); done)
printf '%s' "$input" | curl -sf -m 1 -o /dev/null -H "X-Claude-TTY: $tty" --data-binary @- http://127.0.0.1:47823/statusline >/dev/null 2>&1 &
```

Finding the tab takes a couple of `ps` calls; the report itself runs in the
background, so a stopped Stream Deck app does not hold up the statusline. No
statusline yet? Save this as `~/.claude/statusline.sh` and
run `chmod +x ~/.claude/statusline.sh`:

```bash
#!/bin/sh
input=$(cat)
# Stream Deck: report model, effort and this session's tty to the plugin.
tty=$(p=$PPID; while [ "${p:-1}" -gt 1 ]; do case "$(ps -o comm= -p "$p")" in (claude|*/claude) ps -o tty= -p "$p" | tr -d ' '; break ;; esac; p=$(ps -o ppid= -p "$p" | tr -d ' '); done)
printf '%s' "$input" | curl -sf -m 1 -o /dev/null -H "X-Claude-TTY: $tty" --data-binary @- http://127.0.0.1:47823/statusline >/dev/null 2>&1 &
printf '%s' "$input" | jq -r '"\(.model.display_name) · \(.effort.level // "no effort")"'
```

and point Claude Code at it in `~/.claude/settings.json`:

```json
"statusLine": { "type": "command", "command": "~/.claude/statusline.sh" }
```

**2. Add the `StopFailure` hook.** It ends a turn that failed, so the dial does
not take the session for busy. A fresh install from Quick Start already has it.
If you merged `hooks.json` before, add just this hook — running the merge again
would add every hook twice:

```bash
cp ~/.claude/settings.json ~/.claude/settings.json.bak
jq '.hooks.StopFailure = ((.hooks.StopFailure // []) + input.hooks.StopFailure)' \
  ~/.claude/settings.json.bak hooks.json > ~/.claude/settings.json
```

**3. Restart your Claude Code sessions.**

**4. Let Stream Deck control Terminal.** macOS asks once, when a **Model /
Effort** dial first shows on the deck: from then on the plugin watches
Terminal's front tab. It also asks the first time a question prompt arrives for
a session that reports through the statusline, which the deck then answers in
the Terminal dialog. Without the dial and without the statusline it never asks
Terminal anything. If you denied it, a turn shows `no access` for 2 s, and at rest the
strip reads `no session`: allow it in **System Settings → Privacy & Security →
Automation → Stream Deck → Terminal**.

### What the strip says

| Notice | Meaning |
|---|---|
| `no session` | The front tab is not a Claude session that reported through the statusline, and no session is chosen — or the chosen tab no longer runs `claude`, or macOS does not let Stream Deck control Terminal (step 4). Nothing is typed |
| `busy` | Claude is answering, a dialog is open in the session, a request of the session waits on the deck, or a draft is held in the stash (Ctrl+S). Nothing is typed; turn again once it is free |
| `no claude` | The plugin could not read the effort levels from `claude --help` |
| `no access` | For 2 s after a turn: macOS does not let Stream Deck control Terminal. At rest the strip then reads `no session` |
| `—` | On the effort dial: the session's model has no effort setting. On the model dial: the session reported no model |

After the plugin restarts, a session shows up again on its next statusline
update.

## Usage meter

**Usage** shows one number at a time as a scale: the context fill of a Claude
session, or how much of a plan limit is used.

| Metric | What it is | Bottom line |
|---|---|---|
| **Context** | How full the session's context window is | The project |
| **5h** | The 5-hour limit | Time until it resets (`↻ 1h12m`) |
| **7d** | The weekly limit | Time until it resets |
| **Fable 7d** | The weekly limit of one model; the name comes from Claude | Time until it resets |

The scale is green below 75 %, yellow from 75 % to 85 %, red above 85 %. On a
key the whole key fills from the bottom; on a dial a bar runs along the strip.
Pick the metrics in the Property Inspector. With more than one, a key press, a
turn, a push or a tap switches to the next; the dots on the strip show which one
is on. For all of them at once, put one Usage action per metric on the deck.

Where the numbers come from:

- **Context** — the statusline of the session the Model / Effort dial goes to
  (the front Terminal tab, else the chosen one), else of the session that
  reported last. It needs the statusline lines from [Setup](#setup) step 1. A
  Usage action showing Context watches Terminal's front tab, so macOS asks for
  Automation access as for the dial (step 4); without it, Context follows the
  session that reported last.
- **5h / 7d** — the `rate_limits` every session's statusline reports, and the
  cache file below. Each session reports its own copy, so the meter keeps the
  latest window and the highest value in it; an idle session's old copy does not
  win. Once a window has reset, it shows 0 % until a new number comes.
- **Fable 7d** — only from `~/.claude/cache/oauth-usage.json`, read once a
  minute. The plugin never reads your login token; your statusline writes the
  file. Add this to your statusline script to have it (it asks the OAuth usage
  API at most once a minute, in the background):

```bash
CACHE="$HOME/.claude/cache/oauth-usage.json"
mkdir -p "$(dirname "$CACHE")"
if [ ! -e "$CACHE" ] || [ -n "$(find "$CACHE" -mtime +60s 2>/dev/null)" ]; then
  touch "$CACHE" # the next minute's statuslines skip the fetch, also when it fails
  (
    TOKEN=$(security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null \
      | jq -r '.claudeAiOauth.accessToken // empty')
    [ -n "$TOKEN" ] && RESP=$(curl -s --max-time 3 https://api.anthropic.com/api/oauth/usage \
      -H "Authorization: Bearer $TOKEN" -H "anthropic-beta: oauth-2025-04-20")
    if printf '%s' "$RESP" | jq -e '.limits' >/dev/null 2>&1; then
      printf '%s' "$RESP" > "$CACHE.tmp" && mv "$CACHE.tmp" "$CACHE"
    fi
  ) >/dev/null 2>&1 &
fi
```

Until a number arrives (the plugin just started, an API-key login, no session
yet), the meter shows `—` and `no data`; Context without any session shows
`no session`.

## Updates

The plugin checks the latest release 30 seconds after it starts and then every
12 hours. When a newer one is out, a dialog offers to **Install** it (the package
is downloaded and handed to Stream Deck, which asks to confirm), ask again
**Later**, or **Skip this version**. While nothing is pending, the status key
shows **Update** with the version; a press brings the dialog back.

The check asks the GitHub API for the latest release of this repository; it
needs no login. Without network access it stays silent.

## Development

Workflows run through [Task](https://taskfile.dev) `v3.54.0`, pinned as a Go
tool; `make tools` installs it (needs Go 1.27).

```bash
make tools         # install the pinned Task
task --list        # all tasks
task deps          # npm ci
task test          # unit tests (node --test)
task build         # src/plugin.js → com.obalunenko.claudeperm.sdPlugin/bin/plugin.js
task icons         # redraw the static icons from scripts/icons.sh (macOS sips)
task package       # build + dist/streamdeck-claude-plugin.streamDeckPlugin
task check         # local quality gates
task speckit:install        # pinned Spec Kit + extensions (needs uv)
task speckit:update:check   # report newer Spec Kit / extension releases
```

Open the package from `dist/` to install a local build. Raise `Version` in
`manifest.json` first: Stream Deck skips a package whose version is not higher
than the installed one, and it never downgrades. Releases are `X.Y.Z.0`, taken
from the tag; for local builds raise only the fourth number (`1.1.0.1`,
`1.1.0.2`, …) so the next release still installs over them.

`Claude.streamDeckProfile` is exported from the Stream Deck app. To change the
layout, rebuild the profile in the app, export it over the file, and raise the
version.

Keep the plugin UUID `com.obalunenko.claudeperm`: the profile and the keys on the
device are bound to it.

## Release

Raise `Version` in `manifest.json` to `X.Y.Z.0` in the change itself, then push a
`vX.Y.Z` tag. CI builds the package with that version and publishes a GitHub
release with the package attached. The release notes
list the commits since the previous tag (`scripts/release-notes.sh`, the
goreleaser changelog format): write commit subjects for them, and prefix
housekeeping commits with `docs:`, `chore:` or `test:` to keep them out.

## Uninstall

1. Remove the hooks from `~/.claude/settings.json`, or disable them via `/hooks`.
2. Remove the Stream Deck lines from your statusline script.
3. Uninstall the plugin in the Stream Deck app.

## License

[MIT](LICENSE)
