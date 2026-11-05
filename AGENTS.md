# AGENTS.md — how to work on this repo

Freeway is a local chat app for **free** models across providers. One Node process serves one page and
proxies the model calls. No framework, no bundler, no dependencies, no user build step.

## Commands

| What | Command |
|---|---|
| Unit tests | `node --test lib/*.test.mjs` (or `npm test`) |
| CLI + HTTP suite | `node test/cli.mjs` |
| End-to-end simulation | `node test/simulate.mjs` |
| Simulation against the single file | `APP_PATH=freeway.mjs node test/simulate.mjs` |
| Rebuild the single file | `node build/bundle.mjs` |
| Run | `node app.mjs` or `node freeway.mjs` |

Run all five suites (unit, CLI, both simulations, cloud) before bumping the version, and always rebuild
`freeway.mjs` after `app.mjs`, `lib/` or `public/` changes — the bundle is
generated, never edited by hand.

## Invariants — breaking these is a bug

1. **Free models only.** Never send a model id that is not `:free` / `openrouter/free`.
   A provider may be added only if it has a standing free plan: no card required, and the
   free-ness must not expire into paid usage. Trials, promo credits and card-gated quotas are
   not free plans — Model Studio's 90-day quota and ModelScope's phone-verified 2,000/day both
   stay out on that basis.
   There is no paid mode and none is planned: the roadmap idea was rejected on 2026-11-04
   because it contradicts this rule. Do not add a toggle that lets a priced id through.
2. **The key never reaches the browser.** It lives in `config.json` (0600); the API
   exposes only `hasKey`.
3. **No CDNs, no external scripts, no frames.** The CSP in `SECURITY_HEADERS` allows
   `'self'` only, so any asset must be inlined or served by this app.
4. **Default bind is `127.0.0.1`.** `--host 0.0.0.0` prints a warning because there is
   no password. With file or command tools this becomes remote code execution.
5. **Every mutating route requires `x-app-token`.** The token is per-run and injected
   into the page; the client reloads once when it goes stale.
6. **The model never writes or executes anything without a click.** Any state-changing
   tool must go through the confirm round-trip (`POST /api/chat/confirm`), and a
   timeout or dropped connection counts as *deny*.
7. **Secrets are write-only from the browser.** The API returns names and a four
   character hint; values never leave the process.
8. **Version sync.** `VERSION` in `app.mjs` and `version` in `package.json` must be
   identical — `test/cli.mjs` asserts it.
9. **Every provider declares how free is decided.** `lib/providers.mjs` holds the only
   table: `pricing` (OpenRouter, checked per id) or `allowlist` (every other hosted
   provider, with its own patterns). No route may hard-code a provider URL, and no model id
   reaches a provider that is not allowed.
   Provider keys live in `config.json` (0600) or the environment, never in the page or logs.
10. **Preview adapters stay honest.** Markdown is rendered as escaped, script-free HTML.
    TypeScript, JSX, SCSS/Sass, Less, Vue, Svelte and Astro are never treated as CSS/JS: the
    shared core raises `BUILD_REQUIRED` and names the project's own command. Do not add a
    partial compiler that may silently render the wrong page.
    `build/sync-preview.mjs` must use a function replacer; a string replacement interprets
    `$'` inside the core as the rest of the page. Keep the page-boundary test.

## Layout

| Path | Purpose |
|---|---|
| `app.mjs` | CLI, config, HTTP routes, SSE chat loop, tool wiring |
| `lib/models.mjs` | catalog filtering, free-model chain, token estimate |
| `lib/tools.mjs` | tool definitions and implementations (no I/O except `fetch`) |
| `lib/tool-prompt.mjs` | shared system instruction for turns that actually offer tools |
| `lib/store.mjs` | `threads.json`: threads, drafts, `rev` for conflict detection |
| `lib/redact.mjs` | strips `sk-…` secrets from logs, SSE errors and 5xx bodies |
| `lib/memory.mjs` | deterministic long-chat compaction (no model call, no history loss) |
| `lib/workspace.mjs` | the one folder tools may touch; realpath containment, size caps |
| `lib/preview-server.mjs` | loopback preview origin: token cookie, workspace containment, MIME, SPA fallback |
| `lib/preview-bridge.mjs` | shared runtime-error bridge, injected into srcdoc and served previews |
| `shared/preview.js` | one preview core: static bundler, Markdown renderer, build adapters |
| `build/sync-preview.mjs` | inlines the shared core into both pages; function replacer required |
| `lib/github.mjs` | GitHub REST client behind the panel and the `github_*` tools |
| `lib/commands.mjs` | allowlisted program runner; `shell: false`, filtered env, timeouts |
| `lib/secrets.mjs` | `secrets.json` at 0600; the API exposes names and hints only |
| `lib/status.mjs` | bounded in-memory attempt log behind the Status tab and `/api/status` |
| `public/index.html` | the entire UI — markup, CSS and JS in one file |
| `build/bundle.mjs` | inlines libs + app + page into `freeway.mjs` |
| `test/cli.mjs` | flags, routes, CSP, body limits, thread conflicts |
| `test/simulate.mjs` | mock OpenRouter upstream: fallback, tools, streaming |
| `VERSIONS.md` | changelog and version policy |
| `TODO.md` | the plan, in steps |

## The commands tool

`run_command` is the only tool that starts another program, so its invariants are strict:

- Off unless `settings.allowCommands` is true **and** `commandAllowlist` names a program.
  With either missing the tool is removed from the list sent to the model.
- `spawn(program, args, { shell: false })` always. Arguments are literal, so `&&`, pipes
  and redirection cannot do anything. Never add `shell: true`.
- A program name is matched against the allowlist and may not be a path.
- The child gets a filtered environment. Never add a secret to `CMD_ENV_KEEP`.
- Every call needs the Allow / Deny card; a timeout or dropped connection denies.
- Caps: 60 s, 64 KB of combined output, 40 arguments of 500 characters, and the working
  folder must resolve inside the workspace, symlinks included.

## Style

- Plain ESM `.mjs`, no dependencies, no TypeScript, no build tooling beyond the bundler.
- Dark, eye-strain-aware theme: near-black page and cards, grey secondary surfaces and
  borders, soft-white text (never pure white on pure black); primary actions are light
  fills with dark text; every colour comes from the tokens at the
  top of the `<style>` block in `public/index.html`, mirrored in `cloud/public/index.html`.
  Adding a raw hex colour outside those tokens is a bug — both editions must stay in step.
- Comments explain *why*. Error messages must be actionable and never echo a key.
- The UI is one file: keep CSS, markup and script in their existing sections.

## Release

1. Bump `VERSION` and `package.json` (patch = fix, minor = feature, major = breaking).
2. **Rebuild the bundle first** (`node build/bundle.mjs`) — `test/cli.mjs` compares the
   single file's reported version against `package.json`, so running the suite before
   the rebuild reports a false failure. Then run every suite, then rebuild
   `dist/Freeway-<version>.zip` (exclude `config.json`, `threads.json`,
   `secrets.json`, `.env*`, `node_modules`).
3. Add an entry to `VERSIONS.md` and tick the item in `TODO.md`.
4. Restart **the app only** on port 3002. The test tunnel forwards to that port, so the
   public URL survives a redeploy; restart the tunnel only if it actually died.

## Releases — every change, every site

Every change gets a version bump and is shipped to **all** sites: the desktop app, cloud
**production** and cloud **preview**. A fix that only exists in the workspace is not shipped,
and production lagging preview is a bug.

```bash
cd freeway && ./release.sh <version>
```

That bumps `app.mjs`, `package.json` and `cloud/worker.mjs` (cloud = `<version>-cloud`),
rebuilds the bundle, runs all five suites and rebuilds the ZIP. Then deploy `cloud/` to
production **and** preview, restart the preview server on 3002, and verify all three report the
new version. Full checklist: `RELEASING.md`.

## Workspace editing tools

- `search_files` and `read_many` are read-only and run without a confirmation, like
  `read_file`. Both are bounded (2,000 files / 80 matches, 8 files / 320 KB).
- `apply_patch` is state-changing and must go through `runToolConfirmed`. The server
  calls `previewPatch` first: it validates every exact-text match and returns the unified
  diff sent on the confirm event. The page shows that diff; `runTool` applies the patch
  only after approval, and `applyPatch` validates again against the current file.
- Never let a patch create a file (use `write_file` for that) and never accept a `find`
  that occurs zero or multiple times. Do not add a whole-file overwrite path that skips
  the diff card.
- Search must never follow symlinks out of the root; `search` uses `resolveInside` and
  only walks regular files and directories.

## Long-conversation memory

- `compactMessages` runs on a copy of the sanitised messages, after validation and
  before model selection. It must never mutate or persist the thread: the desktop store,
  the browser transcript and D1 keep the full history.
- Any change to the token trigger or keep window belongs in `lib/memory.mjs`; the Worker
  imports the same module, so the two editions cannot drift.
- The note is a `system` message and must keep the first user request, the newest
  messages verbatim, and an explicit omitted count. Do not add a second model call.

## Test loop

- `run_tests` must use `ctx.commands.run` (allowlist, `shell: false`, timeout/output caps)
  and must go through `runToolConfirmed`; never spawn a test process directly.
- Parsing lives in `lib/testparse.mjs` and is pure. Add a format there, not in the route.
- The result string must keep failure file/line/message so the next repair round is
  actionable; a failing suite is `ok: false`.
