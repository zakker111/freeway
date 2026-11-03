# OpenRouter Chat

A small local chat app for OpenRouter's free models. When the model you picked is
rate-limited, it moves to the next free model automatically and tells you which one
answered.

Runs entirely on your computer. Your API key stays in the local server process and is
never sent to the browser.

## Download

Grab the ZIP from the [latest release](https://github.com/zakker111/openrouter-chat/releases/latest), unzip it, and start it:

- **Windows:** double-click `start.cmd`
- **macOS / Linux:** `./start.sh`

Requires Node.js 20.11 or newer: <https://nodejs.org/en/download>

Then open <http://127.0.0.1:3002> and paste an OpenRouter key on the first screen.

## Getting a key

1. <https://openrouter.ai/settings/keys> → **Create key**
2. Set a credit limit on the key.
3. Paste it into the app. Free models need no credits, but a negative balance blocks even them.

## What it does

- **Free-only by default.** The chain is built from `:free` models, filtered by context
  size and capability, then ranked: free first, then tool-capable, then larger context.
- **Automatic fallback.** Requests carry OpenRouter's `models` array, so OpenRouter fails
  over between models server-side. If the whole request fails, the app retries with the
  next model — up to 3 attempts, never after text has started streaming.
- **Honest stopping.** If every model is rate-limited you get one clear error with the
  number of free requests left today, not a retry loop.
- **Quota meter.** `GET /api/key` drives the "free left today" pill.
- **Model picker.** Searchable, filterable by free / tools / vision / context, with live
  per-million pricing from the catalog.

## Files

| Path | Role |
| --- | --- |
| `app.mjs` | HTTP server, OpenRouter proxy, SSE streaming, config |
| `lib/models.mjs` | pure catalog filtering and chain building |
| `lib/models.test.mjs` | unit tests (`npm test`) |
| `test/simulate.mjs` | end-to-end test against a mock OpenRouter (`npm run simulate`) |
| `public/index.html` | the whole UI — no build step |

## Configuration

- Key: `OPENROUTER_API_KEY` environment variable, or the first-run screen.
- Config file: `%APPDATA%\OpenRouterChat\config.json` on Windows,
  `~/.config/OpenRouterChat/config.json` elsewhere, written with owner-only permissions.
- `PORT` (default 3002), `OPENROUTER_BASE_URL`, `MAX_OUTPUT_TOKENS` (default 1200),
  `NO_OPEN=1` to stop the browser opening automatically.

## Security notes

- The server binds to `127.0.0.1` only, so nothing on your network can reach it.
- State-changing requests need a per-run token injected into the page, which blocks other
  websites from driving your key through your browser.
- The key is stored as plain text in your user profile — normal for a personal tool, but
  anyone with access to your OS account can read it.

## Known limits

- Free-model limits are **account-wide per day**, not per model. Switching models helps
  with per-model rate limits and outages; it cannot extend the shared daily allowance,
  which resets at 00:00 UTC.
- Free models vary a lot in quality; the "answered by" line tells you which one replied.
- Some free variants route to providers with different data-retention policies. Do not
  paste secrets into prompts.
