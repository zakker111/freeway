# Freeway

Freeway is a local chat app for **free** models across OpenRouter, Groq, Gemini,
Mistral, Cohere, SambaNova, Aion Labs, Z.AI, Cloudflare Workers AI, OVHcloud and local
Ollama. When the model you picked is
rate-limited, it retries the next free model on the same provider automatically and tells
you which one answered. It never changes provider unless you do. The model can also use
tools: read the clock, do exact arithmetic, and fetch public web pages.

Existing settings and chats from earlier versions are carried forward automatically.

The first screen is not a key wall: press **Try OVHcloud — no key** and send a message
straight away. OVHcloud publishes a public demo endpoint with no account, no card and a
2-requests-a-minute-per-model budget, so you can judge the app before signing up anywhere.
At that demo limit the app reports the limit and keeps OVHcloud selected; it does not silently
switch the answer to a different provider.

Dark, easy-on-the-eyes interface, no build step, no accounts, no telemetry. Your API key stays in
the local server process and is never sent to the browser.

## Requirements

Node.js 20.11 or newer — <https://nodejs.org/en/download> (LTS installer). The single
`Freeway.exe` needs no Node at all; see below.

### Which file do I use?

- **`Freeway-<version>.zip`** — the normal download. Unzip it and double-click
  `start.cmd` on Windows (or `start.sh` on macOS/Linux). This is the one to try first.
- **`Freeway-<version>-windows-x64.zip`** — the same app as one `Freeway.exe`,
  with Node inside. Use it if you do not want to install Node.
- **`Freeway-<version>-github.zip`** — the source tree for uploading to GitHub; it has
  no build output and no keys.

In either edition, **Files → Sample** writes `sample/index.html` and `sample/style.css`
into the workspace and opens the result in Preview.

### The one executable (no Node, no installer)

`Freeway.exe` is the whole app with Node inside it: one file, no dependencies, no
installer. A build copies a Windows `node.exe`, injects the app as a Node SEA blob with
`postject`, then clears the Authenticode signature that appending broke. The GitHub Actions
workflow (`.github/workflows/build-windows.yml`) does that on `windows-latest`; the 2.3.5
download was cross-built from Linux with the exact same steps (see `RELEASING.md`).

Get it:

1. Unzip `Freeway-<version>-windows-x64.zip` anywhere.
2. Double-click **`Freeway.exe`**. SmartScreen may warn because it is unsigned:
   **More info → Run anyway**.
3. Your browser opens at <http://127.0.0.1:3002>. Paste a key, pick a model, type.

The 2.3.5 `.exe` was assembled outside Windows and could not be launched in the build
machine, so treat its first run as a smoke test. If it refuses to start, use
`Freeway-<version>.zip` with `start.cmd` (fully tested), and rebuild through Actions:

1. Push this folder to GitHub (the workflow is at `.github/workflows/build-windows.yml`).
2. **Actions → Windows client → Run workflow**.
3. Download the **windows-client** artifact: `Freeway-<version>-windows.zip`.
4. Unzip anywhere and double-click **`start.cmd`** (it prefers the `.exe`) or
   **`Freeway.exe`**. SmartScreen may warn because it is unsigned: **More info →
   Run anyway**.
5. Your browser opens at <http://127.0.0.1:3002>. Paste a key, pick a model, type.

Tagging a release (`git tag v2.3.5 && git push --tags`) attaches the same ZIP to the
GitHub release.

### Start it on your computer — exact steps

1. **Install Node.js 20.11+** (skip for the `.exe`): <https://nodejs.org/en/download>, take
   the LTS installer, accept the defaults, then reopen any terminal.
2. **Unzip** `Freeway-<version>.zip` into a normal folder, for example
   `C:\Users\you\freeway`. Do not run it from the ZIP preview window.
3. **Double-click `start.cmd`**. On macOS/Linux run `bash start.sh`.
4. The console prints the version and the config path, and the browser opens
   <http://127.0.0.1:3002>.
5. Paste a key — OpenRouter `sk-or-…`, or switch to Groq/Gemini and paste theirs — then press
   **Save**. No key yet? Press **Try OVHcloud — no key** and type immediately; you can add a
   key later from the quota pill or Settings.
6. Choose a model with the model button (or **Ctrl+M**), type a message, press **Enter**.
   **Ctrl+K** is the command palette: every saved chat, plus **Rename this chat…** and
   **Delete this chat…**.
7. Optional: **Settings ⚙** → workspace folder, so Files and the file tools have a folder.

If port 3002 is taken: `start.cmd --port 3003`. If the window vanishes: run `start.cmd` from a
`cmd` prompt so the error stays visible. `start.cmd --doctor` checks Node, the config folder,
the port and OpenRouter reachability without starting the app.

## Test it on your computer — five minutes

**Windows, from the ZIP:**

1. Unzip it somewhere real, for example `Desktop\freeway`. Do not run it from
   inside the ZIP preview window — Windows extracts to a temporary folder and the app
   cannot write its config there.
2. Install Node.js **20.11 or newer** if you do not have it:
   <https://nodejs.org/en/download> (take the LTS installer, then reopen the folder).
3. Double-click **`start.cmd`**. A console window opens and prints the version, the
   address and where the config file lives; your browser opens at
   <http://127.0.0.1:3002>.
4. Paste your OpenRouter key (`sk-or-…`) into the first screen and press **Save** — or press
   **Try OVHcloud — no key** to send a message with no account at all.
5. Type `hello` and press Enter. An answer appears with `answered by <model>` under it.

Close the console window to stop the app. Nothing is installed, no service is left
running, and no files are written outside that folder and your user profile.

### Check the install without starting a chat

```bat
start.cmd --doctor
```

(or `node app.mjs --doctor`). It verifies the Node version, that the config folder is
writable, whether the port is free, whether a key is saved, and whether OpenRouter
answers — then exits. No browser, no server, no prompt sent.

```text
Freeway 2.3.5 — self-check
  config file: C:\Users\you\AppData\Roaming\Freeway\config.json
  ok   Node.js 22.11.0
  ok   Config folder …\Freeway — writable
  ok   Port 3002 on 127.0.0.1 — available
  --   OpenRouter key — not set yet; the first screen asks for one
  ok   OpenRouter reachable — HTTP 200

Everything needed to start is in place. Run it without --doctor.
```

### What to try, in order

| # | Do this | It works when |
|---|---|---|
| 1 | Send `hello` | An answer streams in; the small line under it names the model |
| 2 | Click the model button (or Ctrl+M; Ctrl+K is commands and chats) | Only free models are listed, each with a `free` badge |
| 3 | Type two messages quickly | The second shows as a dashed *queued* bubble and sends itself |
| 4 | Press **Stop** mid-answer | The text stops and the line says `stopped` |
| 5 | Reload the page (F5) | The conversation comes back, from `threads.json` |
| 6 | Settings → **Export all chats** | A `freeway-<date>.json` downloads |
| 7 | Settings → workspace folder → Save, then the Files tab | That folder is listed; clicking a file opens it |
| 8 | Ask `what time is it?` | A `⚙ get_current_time` chip appears under the answer |
| 9 | With a workspace set, ask it to write a file | An **Allow / Deny** card appears first; Deny leaves the disk untouched |
| 10 | Settings → allow commands, allowlist `node`, then ask it to run `node -v` | Allow card, then output streamed into the answer |
| 11 | Open the **Status** tab after a few messages | Attempts, latencies and any cooling-down model are listed |
| 12 | Header → quit | The page says the app stopped and the console window ends |

### If something goes wrong

| Message | What to do |
|---|---|
| `Port 3002 is already used by another program` | `start.cmd --port 3003`, then open the address it prints |
| `Freeway needs Node.js 20.11 or newer` | Install the LTS build from nodejs.org and reopen the window |
| No browser window appears | Open <http://127.0.0.1:3002> yourself — the console prints the address |
| `No API key configured yet` | Click the quota pill in the header and paste a key |
| Model list is empty | No route to openrouter.ai, or the catalog call failed; reload once |
| The page says it is out of date | The server restarted; reload the tab (it does this once by itself) |
| The console window flashes and disappears | Run `start.cmd` from a `cmd` window so the error stays visible |

## Start

**Windows:** double-click `start.cmd`.

**macOS / Linux:**

```bash
bash start.sh
```

(Use `bash start.sh` rather than `./start.sh`: a downloaded ZIP usually loses the
executable bit.)

Your browser opens at <http://127.0.0.1:3002>. The first screen asks for an OpenRouter
key; it is stored on this computer and reused next time.

### Options

```bash
node app.mjs --port 8080                    # a different port
node app.mjs --host 0.0.0.0                 # reachable from other machines (see the warning)
node app.mjs --config ~/dotfiles/openrouter # keep the key, settings and chats in one folder
node app.mjs --help                         # every flag
```

`--port` and `--host` fall back to `$PORT` and `$HOST`, and the flag always wins. The
default is `127.0.0.1:3002`. `start.cmd` and `start.sh` pass their arguments through, so
`start.cmd --port 8080` works too.

Binding to `0.0.0.0` is for containers and virtual machines. There is no password, so
anyone who can reach the port can spend your OpenRouter credits — the app prints a warning
when you do it.

### One file

`freeway.mjs` is the whole program — server, tools, model logic and the UI — in a
single file. Copy it anywhere with Node 20.11+ and run it:

```bash
node freeway.mjs --port 8080
```

It reads the same config file and key as the folder version. Regenerate it after changing
the sources with `npm run build:single`.

## Getting a key

1. <https://openrouter.ai/settings/keys> → **Create key**
2. Set a credit limit on it — a runaway agent should not be able to spend your balance.
3. Paste it into the app.

Free models need no credits, but a negative balance blocks even them.

## What it does

### Ten hosted providers, straight from the picker

**OpenRouter** (`sk-or-…`, free model ids only), **Groq** (`gsk_…`), **Gemini** (`AIza…`),
**Mistral AI**, **Cohere**, **SambaNova**, **Aion Labs**, **Z.AI**, **Cloudflare Workers AI**
and **OVHcloud** are all in the header picker from the first start —
the desktop app and the cloud edition offer the same ten hosted providers. The desktop app adds an
eleventh, **Ollama (local)**, which runs on your own machine and needs no key; the cloud edition
cannot reach your computer, so it does not appear there. A provider without a key is still
listed, marked `— add key`: select it and the key screen shows that provider's console link.
Switching provider loads its free-model list. Z.AI admits only `glm-4.7-flash`; Cloudflare
Workers AI needs its API token and the 32-character Account ID shown in the dashboard, and only
admits the listed free Workers AI chat models.

The chosen provider is the only provider a turn is sent to. Rate limits, exhausted credits, a
rejected key or a withdrawn model are reported for that provider; they never hand the
conversation to another service. Switch provider yourself if you want a different one. Within
the selected provider the app can still retry another free model, and nothing is streamed
until a model accepts, so you either get one clean answer or one honest error.

Each new provider has a real free tier with no card: Mistral's "Experiment" plan (rate-limited
per key), Cohere's trial key (1,000 calls/month, 20 requests/min) and SambaNova's no-payment
tier (20 requests/min, 20/day per model). Those caps are deliberately small — they are useful
for a quick test, not all-day drivers.

### Counts you can see

- **Free requests left today:** the header pill on OpenRouter shows the number the key reports
  (`N free today`, or credits when the key has them) and refreshes after every answer, so a
  shrinking allowance is visible before the next send. Groq, Gemini, Mistral, Cohere and
  SambaNova publish no remaining-quota endpoint, so there the pill names the plan instead —
  `free · daily quota`, or `free · monthly quota` for Cohere.
- **This chat:** the footer counts your messages (or `used of cap free requests` when a cap is
  set) plus the tokens the providers reported, e.g. `6 messages · 4,812 tokens`. Each answer
  line names the model and its `in` / `out` tokens.
- **Cloud:** the footer shows `N sent · N tokens` for the tab, each answer carries its token
  split, and **Status** in the rail totals requests, answers, failures and tokens.
- Counts reset on **New chat**; saved chats keep their per-answer token lines and the footer
  total is rebuilt from them when the chat is reopened, including after a restart.

### Prompts and transcript export

**Settings ⚙ → Saved chats** now matches the cloud page: **Prompts…** saves whatever is in the
message box and puts any saved prompt back into it (`×` deletes, stored in this browser only),
and **Export this chat (.md)** downloads the open conversation as Markdown with the provider and
model in the header. The JSON **Export all chats / Import…** buttons still move every saved chat
between machines.

- **Free-only.** Paid models are never sent, even if you search for one.
- **Automatic model retry.** Within the selected provider, OpenRouter's `models` array can
  fail over server-side and the app retries the next free model itself — at most 3 attempts,
  never after text has started streaming. The provider is never changed for you.
- **Honest stopping.** If every model is rate-limited you get one clear error with the
  number of free requests left today, not an infinite retry loop.
- **Failure memory.** A model that returns 429 or a server error is skipped for the rest
  of the session, so every new turn does not walk into the same wall. New Chat forgets
  it; if everything is cooling down the memory is cleared rather than refusing to answer.
- **“What happened”.** A collapsed, monospace line under an answer that switched models:
  `Switched to mock/beta-free after mock/alpha-free returned 429.` Turn it off in
  Settings for a quieter screen.
- **Status tab.** What this run actually did: attempts, success rate, average and slowest
  latency, which models are cooling down and why, and the last dozen attempts with their
  outcome and duration. In memory only, so a restart starts clean and no usage history is
  written to disk.
- **Request budget.** Set a soft cap on free requests per conversation; the footer counts
  up and warns as you approach it. It warns, it never blocks.
- **Tools.** Clock, exact calculator, and public web fetch (see below). Only offered to
  models whose catalog entry supports tool calling; if a model rejects the parameter the
  app retries once without tools.
- **Real chat controls.** Copy, regenerate, edit a prompt, new chat, stop mid-stream, and
  the thread survives a reload (kept in `localStorage`).
- **Nothing lost to a refresh.** If an answer is cut off — tab closed, page reloaded,
  connection dropped — the words received so far are kept on the server as a draft, and
  opening the chat again offers to keep them.
- **Two tabs, one chat.** Every chat carries a revision number. If another tab saved first,
  the app asks whether to keep this tab's version or load the newer one instead of
  silently overwriting it.
- **Survives a restart.** A restarted server issues a new app token; an open tab notices
  and reloads itself once, so you are not left clicking a page that silently fails.
- **Queue messages.** Keep typing while the model answers: the message appears at once as a
  dashed "queued" bubble and is sent automatically when the current answer finishes. Stop
  pauses the queue; **Send now** resumes it and **Clear** discards it.
- **Saved chats.** A sidebar lists every conversation by its first message, newest first,
  with search that covers titles and message text. Chats are stored on the server in
  `threads.json`, so they survive a cleared browser and show up in any browser.
- **Backup.** Settings → **Export all chats** writes one JSON file with every chat, your
  settings and the model choice. **Import** restores the settings and merges the chats
  back, or replaces them all.
- **Settings.** System prompt, temperature, max output tokens, tools, the retry-log
  switch, the per-chat request cap, the workspace folder and — off by default — the
  command allowlist. Saved to the config file, not to the page.
- **Model picker.** Searchable, filterable by tools / vision / context, with live
  per-million pricing from the catalog (never hardcoded).
- **Quota meter.** The header pill shows free requests left today. Click it to replace a
  key; a rejected key reopens the key screen by itself.

## Tools the model can call

| Tool | What it does | Safety |
| --- | --- | --- |
| `get_current_time` | Current date, time and weekday in any IANA timezone | Local computation only |
| `calculate` | Exact arithmetic: `+ - * / % ^`, parentheses, decimals | Hand-written parser, never `eval` |
| `fetch_url` | Reads a public page and returns its text | http(s) only, private/local addresses refused, 8s timeout, 20k char cap |
| `list_files` | Lists a folder in the workspace | Opt-in root, `node_modules`/`.git` skipped, 500 entries |
| `read_file` | Reads a text file from the workspace | realpath containment, 256 KB cap, binaries refused |
| `write_file` | Writes a text file in the workspace | **approved per call**, 1 MB cap, realpath containment |
| `search_files` | Greps text across the workspace, with line numbers | literal by default or regex, generated folders skipped, 2,000 files, 80 matches |
| `read_many` | Reads up to 8 files in one call | 320 KB total, per-file errors reported |
| `apply_patch` | Replaces exact text in an existing file | **approved per call with a real unified diff**, every find must be unique, 1 MB cap |
| `github_list` | Repositories, issues, pulls or commits | read-only, 20 rows, 12s timeout |
| `github_create_issue` | Opens an issue | **approved per call** |
| `run_command` | Runs one allowlisted program in the workspace | **approved per call**, `shell: false`, filtered env, 60s, 64 KB, streamed output |

Tool loops are bounded: at most 3 rounds and 4 calls per round, so a confused model cannot
spin forever. Turn tools off entirely in Settings. Anything that writes or executes —
`write_file`, `apply_patch`, `github_create_issue`, `run_command` — stops at an Allow / Deny card first,
and a dropped connection or a three-minute wait counts as Deny.

`run_command` has no shell at all, so `&&`, pipes and `>` are just text passed to the
program. It is off until you tick *Allow the model to run commands* and name the programs
(for example `node, npm, git`); anything else is refused before a process starts.

Adding a tool: describe it in `TOOL_DEFINITIONS` and handle it in `runTool`, both in
`lib/tools.mjs`.

## Files

| Path | Role |
| --- | --- |
| `app.mjs` | HTTP server, OpenRouter proxy, SSE streaming, tool loop, config |
| `lib/models.mjs` | pure catalog filtering and chain building |
| `lib/providers.mjs` | the provider table: base URLs, key rules, free-plan checks |
| `lib/memory.mjs` | long-chat compaction into one memory note |
| `lib/tools.mjs` | tool schemas, calculator, URL guard, HTML-to-text |
| `lib/testparse.mjs` | parses test output into file/line failures |
| `lib/redact.mjs` | scrubs `sk-…` secrets from logs and errors |
| `lib/models.test.mjs` | unit tests for model selection |
| `lib/tools.test.mjs` | unit tests for the tools |
| `lib/workspace.mjs` | the one folder tools may touch; realpath containment, size caps |
| `lib/secrets.mjs` | `secrets.json` at 0600; only names and hints reach the page |
| `lib/github.mjs` | GitHub REST client behind the panel and the `github_*` tools |
| `lib/commands.mjs` | allowlisted program runner: `shell: false`, filtered env, caps |
| `lib/commands.test.mjs` | unit tests for the runner |
| `lib/store.mjs` | saved chats: list, search, import/export |
| `lib/status.mjs` | in-memory attempt log behind the Status tab and `/api/status` |
| `lib/store.test.mjs` | unit tests for saved chats |
| `test/simulate.mjs` | end-to-end test against a mock OpenRouter, including a tool round-trip |
| `public/index.html` | the whole UI — no build step |
| `freeway.mjs` | generated: the entire app in one file |
| `build/bundle.mjs` | builds that single file |
| `test/cli.mjs` | tests the flags and the single-file build |

## Commands

```bash
npm start            # run the app
node app.mjs --doctor  # check the install, then exit
npm test             # unit tests for selection and tools
npm run simulate     # mock upstream + real app: retries, tools, errors
npm run test:cli     # flags, flag precedence, the single-file build
npm run build:single # regenerate freeway.mjs
```

## Configuration

- Key: `OPENROUTER_API_KEY` environment variable, or the first-run screen.
- Config folder: `%APPDATA%\Freeway` on Windows, `~/.config/Freeway` elsewhere.
  `config.json` and `threads.json` live there, written with owner-only permissions.
  The first 2.0 run copies an existing pre-Freeway config folder forward automatically;
  if that copy fails, the old folder stays in use rather than losing data. Move both
  with `--config <folder>` (or a `.json` file) or the `OPENROUTER_LOCAL_CONFIG_DIR`
  environment variable — handy for dotfiles or syncing.
- `--port` / `--host` (or `PORT` / `HOST`), `OPENROUTER_BASE_URL`, `MAX_OUTPUT_TOKENS`
  (default 1200), `NO_OPEN=1` to stop the browser from opening automatically.

## Security notes

- The server binds to `127.0.0.1` by default, so nothing on your network can reach it.
  `--host 0.0.0.0` changes that deliberately; the warning it prints is not decorative.
- Every state-changing request needs a per-run token injected into the page, which blocks
  other websites from driving your key through your browser.
- The key is stored as plain text in your user profile. That is normal for a personal
  tool, but anyone with access to your Windows/macOS account can read it.
- `fetch_url` refuses loopback, private ranges, `.local`/`.internal` hosts and non-http
  schemes. DNS rebinding is not fully preventable without pinning IPs, so treat fetched
  pages as untrusted text.
- Saved chats are plain text in `threads.json`, next to `config.json`, readable by anyone
  who can read your user profile. That is the price of a file you can back up.
- Every response carries a strict `Content-Security-Policy` (`default-src 'self'`, no
  frames, no external origins), plus `nosniff` and `no-referrer`.
- A chat request body over 1.5 MB is rejected with 413 before anything is sent to
  OpenRouter. Backup imports keep the larger limit, since they are local files.
- Keys are scrubbed from error messages and logs: `sk-or-…` becomes `sk-or-[redacted]`.

## Get your API keys

Everything here runs on free tiers; none of the supported providers needs a card for the
models this app will send.

| Provider | Create the key at | Looks like | What stays free |
|---|---|---|---|
| **OpenRouter** | <https://openrouter.ai/settings/keys> → **Create key** | `sk-or-v1-…` | every model priced `$0` in the live catalog; paid ids are refused server-side |
| **Groq** | <https://console.groq.com/keys> → **Create API key** | `gsk_…` | about 30 requests/min and 1,000/day; `gpt-oss`, `qwen`, `llama`, `moonshotai` only |
| **Gemini (AI Studio)** | <https://aistudio.google.com/apikey> → **Create API key** | `AIza…` | free tier; `flash` and `gemma` only, `pro` and media models are blocked |
| **Mistral AI** | <https://console.mistral.ai/api-keys> → **Create new key** | opaque | free "Experiment" plan, rate-limited per key; small and ministral models only |
| **Cohere** | <https://dashboard.cohere.com/api-keys> → **Trial key** | opaque | trial key: 1,000 calls/month, 20 requests/min; chat models only |
| **SambaNova** | <https://cloud.sambanova.ai/apis> → **Create API key** | opaque | no-payment tier: 20 requests/min, 20/day per model |
| **Aion Labs** | <https://www.aionlabs.ai/> → console | opaque | free plan: 15 requests/min, 20,000 tokens/day |
| **OVHcloud** | none — keyless | — | public demo endpoint: 2 requests/min per model, no account |

1. Open the link for the provider you want, sign in, and create a key.
2. Copy it immediately — most consoles show it only once.
3. Paste it where the app expects it (below), then press the model button and pick a model
   whose badge names the plan, like **free · always** or **free · daily quota**.

**Where to paste it**

- **Desktop:** header key button (or the provider's key action) → choose the provider →
  paste → **Save**. It is written to `config.json` with mode 0600 and never reaches the
  browser.
- **Cloud, just for you:** choose the provider, press **key**, paste. It stays in that tab's
  `sessionStorage` and is sent per request; the Worker does not store it.
- **Cloud, for every visitor:** add `OPENROUTER_API_KEY`, `GROQ_API_KEY`,
  `GEMINI_API_KEY`, `MISTRAL_API_KEY`, `COHERE_API_KEY`, `SAMBANOVA_API_KEY` or
  `AION_API_KEY` under **Sites → Secrets**. Visitors then need no key at all;
  OVHcloud works with no secret.

Never paste a key into chat, an issue, a screenshot or a commit. If one leaks, revoke it in
the provider console and create another.

**Groq is not Grok.** Groq (`gsk_…`) is a free inference provider. xAI's Grok is billed per
token, has no free tier, and is not offered here; a `grok_…` key is rejected by the Groq
field. **GitHub Copilot** is not offered either — it has no public chat API.

Groq, Gemini, Mistral, Cohere and SambaNova expose no pricing in their model lists, so "free"
there means "included in the free plan": the header badge names the plan
(`free · daily quota`) instead of `free · always`. Gemini Pro, Mistral Large/Medium, embedding, rerank, OCR and audio models are excluded
deliberately — a key with billing enabled must not be able to spend money from here. Keys are
stored in `config.json` (0600); the page only ever learns whether a key exists.

Environment overrides, mostly for tests: `GROQ_BASE_URL`, `GEMINI_BASE_URL`,
`MISTRAL_BASE_URL`, `COHERE_BASE_URL`, `SAMBANOVA_BASE_URL`, `OPENROUTER_BASE_URL`, plus
`GROQ_API_KEY` / `GEMINI_API_KEY` / `MISTRAL_API_KEY` / `COHERE_API_KEY` /
`SAMBANOVA_API_KEY` / `OPENROUTER_API_KEY` to skip the saved file.

## If the workspace folder is missing

Files, the command runner and preview need a folder. If it is unset, deleted or unreadable,
the app still starts and chats: the page loads, providers and models work, and the Files tab
answers `The workspace folder does not exist.` instead of failing. That is the same
chat-only behaviour as the cloud edition, which makes the UI testable on a machine with no
usable disk. Verified by starting the app against a missing path: page 200, `/api/fs` 400
with that message, chat still answering, settings still saving, nothing in the server log.

## Cloud edition (chat in a browser tab)

The desktop app needs Node because it writes threads, reads files and runs commands. The
`cloud/` folder is a smaller program for people who just want to chat: one Cloudflare
Worker serves the page, lists free models and proxies a single turn to OpenRouter.

- **No key on the deployment?** The page asks for one, keeps it in that tab
  (`sessionStorage`) and sends it per request. The Worker never stores or echoes it. The
  same dialog offers **Try OVHcloud — no key**, which selects the keyless provider and
  starts a chat without an account.
- **Key on the deployment?** Add `OPENROUTER_API_KEY`, `GROQ_API_KEY`, `GEMINI_API_KEY`,
  `MISTRAL_API_KEY`, `COHERE_API_KEY` or `SAMBANOVA_API_KEY` under **Sites → Secrets** and
  visitors never see a key field for that provider.
- **Free only, checked on the server:** the requested id must still be free in the live
  OpenRouter catalog, so a hand-edited request cannot reach a paid model.
- **Different by design:** chats, prompts, the file workspace and Markdown export all live in
  this browser (`localStorage`/`sessionStorage`), not on a disk. The command runner and the
  desktop GitHub panel have no cloud equivalent.

Run it locally (no Wrangler needed):

```bash
cd cloud
node dev.mjs                 # http://127.0.0.1:3100, paste a key in the page
OPENROUTER_API_KEY=sk-or-… node dev.mjs   # pretend the deployment has a key
```

Routes: `GET /`, `GET /healthz`, `GET /api/config`, `GET /api/models?provider=…`,
`POST /api/chat`.

`POST /api/chat` streams Server-Sent Events: `{"delta":"…"}` frames as tokens arrive, then one
`{"done":true,"model":…,"ms":…}` frame. Pass `stream:false` for the old single JSON reply.

The page also keeps a prompt library, a saved-chat history (30 newest) and exports the current
chat as Markdown; all three are browser-local (`localStorage`) and need no route, key or account.

**Files in the cloud edition** have two homes. **This browser** is a text workspace in
IndexedDB; names always travel with a request, and ticking a file includes up to 12,000
characters of its text. You can upload text/HTML/SVG, download the editor, and preview `.html`,
`.htm` or `.svg` in a sandboxed iframe that cannot reach the session or this site's API. Signed
in, **Account files** stores the same text in R2 under your subject — 1 MB per file, 40 files and
8 MB per account — so it follows you to another device. Both workspaces are text-only; images
belong in the composer. On the desktop the model reads real files through tools, with an
Allow/Deny card before anything is written.

The cloud edition carries the **same ten hosted providers** as the desktop app. A key comes
from a Sites secret (`OPENROUTER_API_KEY`, `GROQ_API_KEY`, `GEMINI_API_KEY`, `MISTRAL_API_KEY`,
`COHERE_API_KEY`, `SAMBANOVA_API_KEY`, `AION_API_KEY`, `ZAI_API_KEY`, `CLOUDFLARE_API_TOKEN`,
`CLOUDFLARE_ACCOUNT_ID`) or, when no secret is set, from the page — kept in that tab's
`sessionStorage` and sent as `x-provider-key`; Cloudflare's account ID travels as
`x-provider-account`. OVHcloud needs no key at all, and Z.AI only admits its free
`glm-4.7-flash` model. The free-plan rules are enforced on the
server: OpenRouter by live pricing, the others by allow/deny lists, so `whisper-*`,
embeddings, rerankers, Gemini `pro` and Mistral Large are refused there too.

Publish it yourself:

1. Launch the app, open the **Sites** panel, create a project.
2. Deploy with the manifest at `cloud/deploy.json` (entry `worker.mjs`, assets `public/`).
3. Check the preview URL: page loads, model list fills, a chat turn answers or says why not.
4. Production → **Publish**, then add `OPENROUTER_API_KEY` under **Sites → Secrets**.
5. Account files need an R2 bucket bound as `FILES` (Sites → Storage, preview and production
   separately; deploy again after creating it). Without it the panel says account files are not
   enabled, and the browser workspace still works.
6. Revisit the production URL; the key field should be gone and chat should just work.

## Known limits

- Free-model limits are **account-wide per day**, not per model. Switching models helps
  with per-model rate limits and outages; it cannot extend the shared daily allowance.
  The allowance resets at 00:00 UTC and the header shows what is left.
- Free models vary a lot in quality, and many do not support tool calling. The
  "answered by" line and the tool chips tell you exactly what happened.
- The queue lives in the page, so reloading drops anything still waiting behind an answer.
- Markdown rendering is deliberately small: headings, lists, quotes, links, bold, italic,
  inline code and fenced code with a copy button. No tables, no syntax colouring.
- Some free variants route to providers with different data-retention policies. Do not
  paste secrets into prompts.

## Releasing

`./release.sh <version>` bumps both editions, rebuilds, tests and zips. Every change then ships
to the desktop app, cloud production and cloud preview — see [RELEASING.md](RELEASING.md).
