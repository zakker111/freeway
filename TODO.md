# Plan

Ticked items are in the shipped build. Every step ends the same way: full test suite,
rebuilt single file, rebuilt ZIP, and a redeploy to the same public link. The live URL and
the three archives with their checksums are in `../CURRENT-LINK.txt`; the cloud site is open
to visitors, no password — only the `/api` data routes ask you to sign in.

## Done — 1.8.1

- [x] Show the running version in the header (`v1.8.1`), read from `/api/config`
- [x] `AGENTS.md`, `TODO.md`, `VERSIONS.md`

## Done — 1.9.0 · right rail: Files + Secrets

- [x] `lib/workspace.mjs` — one opted-in root folder; `realpath` containment so `../`
      and symlinks cannot escape; 256 KB read, 1 MB write, binary refusal
- [x] `lib/secrets.mjs` — `secrets.json` at 0600; API returns `{name, hint}` only
- [x] Routes: `GET /api/fs`, `GET /api/fs/read`, `POST /api/fs/write`,
      `GET|POST|DELETE /api/secrets`
- [x] Tools: `list_files`, `read_file`, `write_file` (only offered when a root is set)
- [x] Confirm round-trip: `POST /api/chat/confirm`; Allow / Deny in the UI; a dropped
      connection or 3-minute timeout counts as deny
- [x] UI: right rail with Files and Secrets tabs, header toggle, workspace folder field
      in Settings
- [x] Tests: traversal, symlink escape, size caps, secret masking, stale confirm
- [x] Bump to 1.9.0, bundle, ZIP, redeploy
- [x] Simulation coverage for the approval round-trip (allow writes, deny does not)

## Done — 1.10.0 · GitHub panel

- [x] Fine-grained PAT stored as a secret; browse repos, issues, PRs, recent commits
- [x] `github_*` tools behind the same confirm gate for anything that writes

## Done — 1.11.0 · Preview panel

- [x] iframe against a local dev server, remembered per thread
- [x] Explain framing refusals (`X-Frame-Options` / `frame-ancestors`) instead of a
      blank box
- [x] Fixed the rail show/hide rule that kept the 1.10.0 GitHub body hidden

## Done — 1.12.0 · Command runner

- [x] Allowlisted commands, confirm per call, stdout streamed over SSE

## Done — 1.12.4 · Windows hardening

- [x] `run_command` resolves `PATH`/`PATHEXT` and runs `.cmd` shims through cmd.exe
- [x] Main-module check compares canonical, case-folded paths
- [x] Browser fallback when Edge is absent; retry the atomic save on Windows locks
- [x] `start.cmd` launches the packaged exe and only then Node

## Done — 1.12.5 · easy first run

- [x] `--doctor`: Node, config folder, port, key, OpenRouter reachability, then exit
- [x] A busy port is identified before claiming "already running"
- [x] README: five-minute walkthrough, test checklist, troubleshooting table

## Done — 1.13.0 · status page

- [x] `lib/status.mjs`: bounded in-memory attempt log, no disk writes
- [x] Per-attempt timing around the upstream call (network, HTTP failure, stream, ok)
- [x] `GET /api/status`: summary, cooldowns, recent attempts, catalog age, limits
- [x] Status tab in the rail: summary line, cooling models, last dozen attempts
- [x] Unit tests for the log and a CLI check for the route

## Next — 1.13.0 · Windows `.exe`

- [x] `build/bundle.mjs` also emits `openrouter-chat.cjs`; Node SEA cannot load an ESM main
- [x] `.github/workflows/build-windows.yml` + `sea-config.json`: bundle, test, blob, inject, strip signature, smoke-test, attach to release
- [x] Pipeline proven locally: blob → inject → the binary serves the page and the API

- [x] Node SEA build shipped as `dist/OpenRouterChat-1.25.7-windows-x64.zip`
      (cross-built from Linux: Windows `node.exe` + blob + `postject`, signature directory
      cleared; documented in `RELEASING.md`)
- [ ] Launch the cross-built `.exe` on a real Windows machine (cannot be executed in this VM)

## Done — 1.13.1 · tool turns answer

- [x] After tool calls and an empty message, ask once more with no tools attached
- [x] A still-empty follow-up reports that tools ran, not the generic "No model answered"
- [x] Simulation case: tool call → empty → forced answer

## Providers — 1.14.0 (shipped)

- [x] `lib/providers.mjs`: one table for OpenRouter, Groq and Gemini (AI Studio)
- [x] 1.25.0: Mistral AI, Cohere and SambaNova added with free-tier allowlists and fallback model lists
- [x] free rule per provider: pricing (OpenRouter) or allow/deny patterns (Groq, Gemini)
- [x] header switcher, per-provider key dialog, `verified free` / `free tier` badge
- [x] `/api/providers`, provider-aware `/api/models` and `/api/chat`
- [x] Copilot Free listed as unavailable — no public chat API (GitHub Models retired 2026-07-30)
- [ ] live smoke test with real Groq and Gemini keys (routing is covered by a mock)
- [x] cross-provider fallback: OpenRouter free → Groq → Gemini, then Mistral, Cohere
      and SambaNova (1.28.0, both editions)
- [x] Cloud edition: the same providers behind the Worker (1.14.0-cloud.3)

## Cloud edition — 1.14.0-cloud.1 (shipped)

- [x] `cloud/worker.mjs`: page, free-model catalog, one proxied chat turn, free-only check
- [x] `cloud/public/index.html`: same black-and-white look, model picker, per-request key
- [x] `cloud/dev.mjs`: run the Worker under Node to test routes without Wrangler
- [x] `cloud/deploy.json`: Sites manifest; deployed and published as its own project
- [x] Streaming answers in the cloud edition (desktop already streams)
- [x] Server-side key for the deployment so visitors never paste one
      (`OPENROUTER_API_KEY` / `GROQ_API_KEY` / `GEMINI_API_KEY` in Sites secrets)

## Done — 1.24.0 · parity and the audit pass

- [x] Cloud streaming ([done 1.15.0]), searchable/pinnable model picker, prompt library,
      Markdown transcript export, saved chats and the browser workspace tools
- [x] Desktop gained the prompt library and Markdown export, so both editions match
- [x] All three providers are selectable in both editions, keyless ones marked `add key`
- [x] Deployment-held keys: the cloud page no longer asks for a key the Worker already has
- [x] Audit fixes: the post-tool answer request no longer sends OpenRouter's `usage` field to
      Groq/Gemini, an unknown provider is a 400 instead of a silent OpenRouter fallback,
      tool mode keeps the workspace file context, and per-provider model choices stick

## Done — 1.25.5 · counts, archives, first-run docs

- [x] Footer counts messages (or capped free requests) and total tokens; each answer shows its
      model, seconds and `in` / `out` tokens; OpenRouter's free-today pill refreshes after each reply
- [x] Cloud shows `sent · tokens`, per-answer token splits and a Status total
- [x] A source ZIP for GitHub alongside the normal Windows ZIP, both documented
- [x] README "Which file do I use?" and "Counts you can see" sections

## Done — 1.28.0 · one turn, several providers

- [x] `fallbackOrder` + `firstFreeModel` in `lib/providers.mjs`: the chosen provider first,
      then every other provider with a key, each picking its own free model
- [x] Desktop: the whole turn walks that list — rate limit, credits, rejected key or a
      withdrawn model move to the next provider; OpenRouter-only fields never follow it
- [x] Cloud: up to four providers per turn, server-held keys only — a key pasted in the page
      is never handed to a different service
- [x] Both pages say when the turn moved: desktop logs `OpenRouter: … failed; asking Groq`,
      cloud marks the answer `via groq`
- [x] Tests: ordering/picking units, plus a simulation with a real second provider

## Done — 1.29.0 · cloud accounts and chat history

- [x] Sign in with Freebuff on the cloud edition (`@freebuff/auth` wrapped around the Worker)
- [x] `/api/me` for display only; the server checks the session on every data route
- [x] D1 `chats` table keyed by `(sub, id)`: list, upsert, delete; the 30-chat ceiling was raised to 200 in 1.38.0
- [x] Saved chats push to the account when signed in and merge back on load; signed out keeps
      the browser-local behaviour unchanged
- [x] Same-origin check on writes, 401 when signed out, `no-store` on personalized responses
- [x] `cloud/build.mjs` bundles the Worker with esbuild (the deployer uploads files, not deps)
- [ ] Signed-in end-to-end click test in a browser (needs a real account; not available here)

## Done — 1.38.0 · every chat, not the newest 30

- [x] Cloud history keeps **200 chats per account** instead of deleting the 31st-oldest on save
- [x] `GET /api/threads` lists the whole account history, bounded by the same `MAX_THREADS`
      constant as retention (it was hard-coded `LIMIT 30` in two places)
- [x] Fixed the cloud chats dialog raising `ReferenceError: pins is not defined` before it drew a
      single row, which is why the list looked empty; each row now has the ☆/📌 pin toggle
- [x] The browser copy merges up to 200 chats after sign-in, so older chats cannot be hidden by
      a shorter local list
- [x] Desktop needed no change: it already lists every saved chat with pins

## Done — 1.39.0 · cloud chats reach the desktop panel

- [x] Cloud Settings → **Export chats (.json)** writes `{app, source, exportedAt, threads[]}`,
      the same shape `/api/import` and the desktop **Import…** button already accept
- [x] Export ids are validated against the desktop's `^[A-Za-z0-9_-]{6,64}$` pattern and derived
      deterministically when they do not match, so a repeated import updates rather than duplicates
- [x] Command palette entry "Export all chats for the desktop app" and a banner naming the next step
- [x] Store test covers a cloud-shaped payload: merge, stable id, and a re-import that stays at
      the same total
- [ ] Automatic account sync (desktop signing in to pull cloud chats by itself) — not attempted:
      it needs a real browser sign-in plus a way to keep a session out of the repo, neither
      available in this sandbox; the file hand-off is the credential-free equivalent

## Done — 1.40.0 · find a chat by what was said in it

- [x] Desktop sidebar search now calls `/api/threads?q=` (titles filter instantly, message-text
      matches merge in after 250 ms) — the server had supported this all along and nothing used it
- [x] Cloud chats dialog gained a search field covering titles and every message, over the 200
      chats the browser copy holds, with a distinct empty state for "no matches"
- [x] Store test: a body-only match is found, case-insensitively
- [x] Search across the account server-side: `/api/threads?q=` filters `lower(title)` and
      `lower(messages)` for the signed-in user and the page merges hits into its local copy
      (1.41.0); `likePattern()` escapes `%`, `_` and `\` so a search cannot turn into a wildcard

## Done — 1.42.0 · Ctrl+K opens chats too

- [x] Desktop palette lists every saved chat as "Open chat: …" (newest 50) and opens it directly
- [x] Cloud palette does the same from the browser copy, including chats pulled in by search
- [x] No new request: the list is the one the page already holds
- [x] Palette keyboard model unchanged (↑/↓ walk, Enter runs, Esc closes)

## Done — 1.42.1 · audit: chat pin bug

- [x] Cloud `togglePin` declared twice — model pin shadowed the chat pin; renamed to `toggleModelPin`
- [x] Regression test: duplicate top-level functions, dangling `$("id")` lookups, shared pin keys
- [x] Audit of both pages: 108 / 70 functions, none unused, no missing element ids
- [x] Audit of loaders: all `/api` paths the pages call are handled by worker and app
- [x] SQL audit: every statement binds values; `LIKE` pattern escaped with `ESCAPE '\\'`

## Done — 1.43.0 · rename and delete a chat from the palette

- [x] Ctrl+K gained **Rename this chat…** and **Delete this chat…** in both editions
- [x] A renamed chat keeps its name: desktop `customTitle`, cloud override keyed to the chat id
- [x] A stored title that differs from the first message is reopened as a deliberate name, no
      schema change and no migration for older chats
- [x] Delete clears the override, so the next chat cannot inherit the previous name
- [x] Both rows report the outcome (status line / banner); the desktop save still sends `ifRev`

## Done — 1.43.1 · the answer survives a closed tab

- [x] The stream teardown saves a thread when the chat has none yet and the client is gone —
      previously only a *draft* was kept, which needs a thread to attach to
- [x] Only on a dead client, so a live tab's debounced save still wins and no stale-rev
      question appears for a normal turn
- [x] Probe-verified with a slow mock upstream: abort on first delta → chat saved at `rev 1`;
      live client → nothing saved by the server (`404`)
- [x] Covered by a paused-upstream simulation in 1.43.2

## Done — 1.43.2 · the rescue has a test

- [x] `slow` mode in the mock upstream: one delta, a 700 ms pause, then the rest
- [x] The check hangs up on the first delta and asserts the chat survives with the answer
- [x] Simulation 19/19 on `app.mjs` and on the single-file build; no application code changed

## Plan ahead — after 1.43.0

What the 2026-11-04 verification run established: desktop filesystem, secrets, chat-stream and
chat-store routes behave over real HTTP; the cloud page carries the same design tokens and
most of the same labels; production currently has **no deployment key**, so the live site
answers only when a visitor pastes their own.

### Next — the cloud edition answers without a visitor key (needs one secret)
- [ ] Add `OPENROUTER_API_KEY` under Sites → Secrets (production, then preview). `/api/config`
      then reports `hasKey: true` and a non-empty `serverKeys`, and the key overlay stops
      appearing. Needs the owner's key; it never passes through chat.
- [ ] With the key in place: one full streamed answer signed out, `/api/quota` reading the
      deployment key, and the daily free-model cap honoured.
- [ ] Blocked until that secret exists — the code path itself is already shipped.

### 1.47.0 — the release path
- [x] Run `.github/workflows/build-windows.yml` on GitHub Actions: run 41940445555 passed
      unit, CLI, SEA, smoke-test, package and artifact upload on commit `94715e4`.
- [ ] Download the `windows-client` artifact, attach it to the release, and launch it on
      Windows. Attaching and launching remain blocked in this sandbox.

## Done — 1.44.0 · the shared key is guarded

- [x] Origin fence on `/api/chat` for deployment-key turns: 403 `foreign_origin`, enforced only
      when `APP_ORIGIN` is set
- [x] Per-visitor daily budget in D1 (`budget` table, UTC day + `cf-connecting-ip`), 40 turns,
      `VISITOR_DAILY_LIMIT` override, 429 `visitor_budget` that names the visitor's own key;
      a missing database or IP allows the turn
- [x] Per-turn ceiling of 1024 `max_tokens` when the deployment pays
- [x] **Shared key** row in the cloud Status panel and `guard` in `/api/config`
- [x] `cloud/test.mjs`: 5 checks against the real Worker, mock upstream, `node:sqlite` D1
- [x] Answered the open question: no sign-in gate on `/api/chat`. The budget is per visitor, so
      a stranger cannot drain the key, and the page still works signed out.
- [x] Fixed two faults the test found: the catalog ignored `OPENROUTER_BASE_URL`, and the cached
      auth app handed a second env the first env's key and database

## Done — 1.45.0 · the budget is visible

- [x] `GET /api/budget`: this visitor's `{active, limit, used, remaining, day}`, private and
      no-store, never spending a turn
- [x] One `budgetRow()` behind both the report and the enforcement
- [x] Status **Shared key** row shows turns left today, refreshed at boot, on open and after a
      turn
- [x] `cloud/test.mjs` at 7 checks, including "reading the budget spent a turn" and a keyless
      deployment
- [x] The next move once `OPENROUTER_API_KEY` exists: watch this number fall on production

## Done — 1.46.0 · one shell for both editions

- [x] Cloud chats panel: the desktop's left-docked column, not a centred dialog
- [x] Docked above 900 px, drawer with backdrop below, preference remembered
- [x] Header button, Alt+H, the palette row and the settings shortcut all open the panel
- [x] `historyDialog` removed, so there is one way to reach a saved chat
- [x] `lib/pages.test.mjs` fails if either edition loses the panel or moves it off the left edge
- [x] Sweep: syntax on every file, no duplicate function declarations, every `$("id")` resolves,
      all suites green

## Done — 1.47.0 · Aion Labs and the free-plan rule

- [x] `aionlabs` provider in both editions: allowlist, media denied, standing free tier
- [x] `freePlan` on every provider, with a test that rejects trial/credit values
- [x] 402 upstream becomes `no_free_plan`, never a retry
- [x] Drift test: the desktop and Worker provider tables must carry the same ids and plans
- [x] Absent-list documents DashScope, ModelScope and card-gated credits with reasons
- [x] Qwen stays available through Groq, SambaNova, OpenRouter and (1.48.0) OVHcloud

## Done — 1.48.0 · OVHcloud, the keyless provider

- [x] `anonymous` free plan and provider (no account, no card, no key)
- [x] Allowlist: Llama, Mistral, Qwen 3.x and gpt-oss chat models only
- [x] No `Authorization` header at all for a keyless provider
- [x] Keyless turns bypass the shared-key origin fence and visitor budget
- [x] Anonymous providers excluded from silent fallback (2 req/min demo budget)
- [x] Both editions say "no key needed" instead of opening the key dialog

## Done — 1.49.0 · Free plans, in words

- [x] `freePlanLabel()` for all five plans, with a neutral fallback
- [x] `planLabel` in `publicView` and the Worker's `providerList`
- [x] Desktop picker and policy pill name the plan; cloud options too
- [x] Drift test compares the wording between editions
- [x] Unknown plan values never read as unlimited

## Done — 1.50.0 · No stray "free tier" copy

- [x] Provider notes in both editions open with `Free plan:` and keep their numbers
- [x] Desktop policy tooltip, key dialog and quota pill use the plan wording
- [x] Cloud badge names the plan; the model count says "free models"
- [x] Guard test: a provider note that says "free tier" fails the suite
- [x] README quotes the wording the UI actually shows

## Done — 1.51.0 · The numbers behind each plan

- [x] `limits` per provider (minute/day/month/tokens) and `limitLines()`
- [x] No invented caps: Gemini and Mistral say they publish none
- [x] Desktop key dialog + Status **Free plans** section
- [x] Cloud key dialog + Status list from `providerList`
- [x] Drift test compares the lines, not just the label

## Done — 1.51.1 · the copy matches the table

- [x] Cloud notice, PWA description, README and CURRENT-LINK: eight hosted providers, not six
- [x] README lists `AION_API_KEY`; OVHcloud documented as keyless
- [x] Both pages' fallback provider carries `limitLines`

## Later

- [x] [1.36.0] Local Ollama, and a fallback chain that can cross providers
- ~~[ ] Optional paid-model mode, clearly labelled and off by default~~ — **rejected 2026-11-04.**
      It contradicts the core rule that a paid model id is never sent (AGENTS.md invariant 1). The
      owner chose to keep the app free-only, so this is not planned.
- [x] [1.35.0] Status page: answering models, latency, cooldowns, today's usage (desktop rail;
      cloud Status panel adds per-model latency and the free quota)
- [x] [1.32.0] Ctrl+K command palette
- [x] [1.33.0] Per-message request cost (`free` / `$x` per answer)
- [x] [1.33.0] Thread pinning (pinned chats sort first; pins are per browser)

## Next up — make it powerful (in order)

1. **[done] Stream on the cloud edition.** The Worker relays SSE deltas and the page
   paints them as they land; `stream:false` still returns one JSON reply.
2. **[done, 1.34.0] Pin, search and recent models.** The picker searches, groups Pinned / Recent /
   All free models, pins with a star, and walks with the arrow keys in both editions.
3. **[done] Prompt library + import/export.** Save prompts, export a transcript as Markdown,
   import chats back (desktop JSON import; the cloud keeps chats in this browser).
4. **[done, 1.29.0] Sign in with Freebuff + server-side key + D1 history.** Then the site works on
   a phone with no key pasting, conversations follow the account, and keys stay out of the
   browser entirely. Signed out, chats remain browser-local.
5. **[done, browser workspace] Tool parity in the cloud.** list/read/write run against the
   browser workspace with the same Allow/Deny card as the desktop app; web search/fetch is
   still desktop-only.
6. **[done, 1.30.0] Installable PWA + offline shell.** Manifest, icons and a cached shell; the
   page registers the worker after first paint and never caches `/api` or `/auth`.
7. **[done, 1.31.0 / 1.31.1] Usage meter.** `/api/quota` plus a Status panel with tokens and the
   free daily quota, read with the deployment key or the visitor's own, so rate limits are visible
   before they bite.
8. **Ship the Windows .exe.** The workflow exists; it needs a GitHub remote with credentials
   (blocked in this sandbox).

## Done — 1.52.0 · agent-grade edits

- [x] `search_files`: workspace grep with line numbers, literal or regex, case option,
      result cap; skips `node_modules`, `.git`, `dist`, `build`, `coverage`, `.next`,
      caches and virtualenvs; 2,000 files / 256 KB per file
- [x] `read_many`: up to 8 files in one call, 320 KB total, per-file errors instead of
      failing the whole batch
- [x] `apply_patch`: exact-text edits in an existing file; every `find` must occur
      exactly once, edits apply in order, 20 edits / 1 MB cap
- [x] **Real diff before approval**: `previewPatch` validates and builds a unified diff
      without writing; the confirm event carries it; the card shows it in monospace
- [x] The same `previewPatch` is re-run on apply, so a file edited between the card and
      the click cannot be patched against stale text
- [x] Tests: search skip/line/limit/regex, batch errors, ambiguous and absent patches,
      preview-does-not-write, escaping paths, diff headers, simulated approval
- [x] Bump to 1.52.0, bundle, both ZIPs, redeploy

## Roadmap after 1.52.0 — from chat to coding agent

- [x] **1. Workspace search + multi-file read + diffed edits** (1.52.0) — the model can
      locate code, load the relevant files together, and change them through a reviewable
      diff instead of rewriting whole files.
- [~] **2. Long-conversation memory** — 1.53.0 ships deterministic compaction at 6,000
      estimated tokens: the original request plus recent older turns become one system
      note, the newest 10 messages stay verbatim, and the full history is untouched. The
      UI shows the note in the turn meta (`memory: N earlier messages summarised`), in
      both editions. Remaining: per-project thread groups and making the note editable.
- [x] **3. Test loop** — `run_tests` over the existing allowlisted runner; parse common
      failure formats (node:test, pytest, cargo, go test) into file/line/message; feed the
      failures back for one repair round; show a pass/fail summary card. Reuse the
      per-call approval and the 60 s/output caps. Acceptance: a failing fixture is
      repaired end to end, and a passing suite stops the loop immediately.
- [~] **4. Everyday UX** — edit/regenerate/branch any message without losing the rest of
      the thread; attachments: text files first (reuse the sandbox read path), then images
      through free vision models with a per-model capability check. Acceptance: branch
      keeps both histories, image turns are only offered to models that accept images.
- [~] **5. Provider health and budget** — Status shows remaining budget and retry-after
      per provider/model in addition to the plan's limit lines; surface the existing
      cooldown log; one-click "try this model now". Acceptance: a 429 shows a countdown,
      and the next turn skips the cooling model instead of learning the hard way.
- [ ] **6. Shared-key cloud path** — add `OPENROUTER_API_KEY` under Sites → Secrets and
      run the signed-out quota/stream smoke test. Blocked on the owner's key, not code.

## Done — 1.53.0 · long-conversation memory

- [x] `lib/memory.mjs`: deterministic compaction shared by desktop and the Worker bundle
- [x] Trigger at 6,000 estimated tokens; keep the newest 10 messages verbatim, starting
      at a user turn; first user request always anchors the note
- [x] The note is a system message, capped at 1,800 characters, with an omitted count
- [x] The full history is never deleted: only the upstream payload is shaped, so reopening
      a thread and the UI transcript stay complete
- [x] Desktop meta event and cloud `x-memory-*` headers tell the page what was folded
- [x] Tests: short chats untouched, first-goal retention, newest message verbatim,
      token reduction, simulated desktop turn, cloud bundle rebuild
- [x] Bump to 1.53.0, bundle, both ZIPs, redeploy

## Done — 1.53.1 · cloud memory reaches the compactor

- [x] Cloud `MAX_TOTAL_CHARS` raised 24,000 → 56,000 (inside the 64 KB body cap); long
      chats are now compacted instead of rejected before `compactMessages` runs
- [x] Desktop unchanged: its 60,000-character sanitise limit already allowed compaction
- [x] Rebuilt both bundles, redeployed production and preview

## Done — 1.54.0 · the test loop

- [x] `run_tests`: uses the allowlisted command runner, approved per run, `shell: false`
- [x] `lib/testparse.mjs`: node:test TAP, pytest, cargo and go failures become
      `{test, file, line, message}`; green runs are a clean pass
- [x] Failures return to the model in the same tool loop, so it can patch and rerun within
      the existing three-round limit
- [x] Confirmation card shows the exact program, arguments and working folder
- [x] Tests: all four parsers, generic non-zero exit, green run, tool wiring

## Done — 1.55.0 · branching and text attachments

- [x] **Branch** from any message in both editions: the prefix becomes a new chat,
      the original stays saved; the branch is saved on the next send
- [x] Cloud gains the desktop message actions: Copy, Edit (user), Regenerate (assistant),
      Branch; desktop already had Copy/Edit/Regenerate
- [x] **Attach a text file** (📎) in both composers, up to 200 KB, inserted as
      `[Attached file: name]` plus its text; no upload leaves the machine/browser
- [x] Tests: page scripts still parse, both suites green, archives rebuilt

## Done — 1.55.1 · cloud live actions

- [x] Cloud user messages and the streaming assistant message get Copy/Edit or
      Copy/Regenerate/Branch immediately; no reopen required
- [x] Same index guard as reopened threads; clicks stay blocked while an answer streams
- [x] Suites and archives rebuilt, both environments redeployed

## Done — 1.56.0 · projects and editable memory

- [x] **Project groups**: every saved chat row has a project button; the rail
      groups chats under their project, with Ungrouped last-first by name
- [x] Groups are browser-local in both editions (same key `orc.projects.v1`),
      so no account or D1 schema change is needed
- [x] **Editable memory note** per chat, from the composer's `memory` button,
      capped at 4,000 characters
- [x] The note is prepended as a system message only to the outbound request;
      saved history, exports and the auto-compaction note are untouched
- [x] Suites and archives rebuilt, both editions redeployed

## Done — 1.57.0 · provider health

- [x] Status is now **Health** in both editions
- [x] Provider readiness rows show key state and free-plan label
- [x] Per-model rows show attempts, failures, average latency and last latency;
      cloud now records failed attempts per model instead of only totals
- [x] Desktop keeps its cooling list and recent attempt timestamps
- [x] Suites and archives rebuilt, both editions redeployed

## Done — 1.57.1 · health readiness labels

- [x] Cloud Health marks OVHcloud **no key needed** instead of asking for a key
- [x] Cloud names a deployment-held key and the current visitor key correctly
- [x] Desktop Health marks Ollama and keyless providers **no key needed**
- [x] Roadmap checkboxes corrected: test loop shipped; everyday UX and provider
      health are explicitly partial pending images and retry/countdown controls

## Done — 1.58.0 · retry controls

- [x] Desktop cooling rows expose a real `until` deadline from `Retry-After`
      (60 s rate-limit / 30 s upstream fallback) and count down live
- [x] Desktop **Try** selects the cooling model and focuses the composer
- [x] Cloud records 429/rate-limit/visitor-budget failures in a tab-local cooling map
- [x] Cloud shows the same countdown and **Try** button in Health
- [x] Cloud skips a cooling model when another free model is available
- [x] Suites and archives rebuilt, both editions redeployed


## Done — 1.60.0 · vision images + real retry limits

- [x] One PNG/JPEG/WebP per turn, compressed in the browser to 320 KB and validated in both servers
- [x] OpenRouter free vision models only; text-only and non-OpenRouter turns fail with an actionable 400
- [x] Images preserved through compaction, desktop storage, cloud D1, branch, reopen and rendering
- [x] Only the two newest images are resent; older previews remain in the visible chat
- [x] Provider `Retry-After` forwarded exactly, visitor budgets reset at UTC midnight
- [x] Health shows exact cooldowns and each provider's published plan limits
- [x] 159 units, 24 CLI, 21+21 simulation, 14 cloud checks

## Done — 2.0.1 · publish readiness

- [x] `cloud/package-lock.json` identifies as `freeway-cloud` 2.0.1
- [x] `release.sh` bumps the cloud package and lockfile too
- [x] `.gitignore` covers `Freeway.exe` and the generated bundles
- [x] README key/file tables complete; `.exe` and tag examples current
- [x] AGENTS/RELEASING say five suites
- [x] 159 units, 24 CLI, 21+21 simulation, 14 cloud checks — all green

## Done — 2.0.0 · Freeway rename

- [x] Product name changed from OpenRouter Chat to Freeway in both editions,
      the PWA, exports, Windows executable and documentation
- [x] `Freeway.exe`, `freeway.mjs` / `freeway.cjs`, and `Freeway-2.0.0*.zip`
- [x] Existing `OpenRouterChat` config folders copy to `Freeway`; old data remains
      readable if copying fails
- [x] `orc.*` browser storage keys and legacy chat JSON imports remain compatible
- [x] Production and preview URLs unchanged; no provider/model behaviour changed
- [x] 159 units, 24 CLI, 21+21 simulation, 14 cloud checks — all green on 2.0.0
- [x] `Freeway-2.0.0*.zip` built and hashed; Windows `.exe` cross-built
- [x] Both editions redeployed at 2.0.0 / 2.0.0-cloud; port 3002 restarted
- [x] Config migration verified: copy forward keeps key/chats, failed copy falls
      back to the `OpenRouterChat` folder

## Done — 2.1.0 · try it before a key

- [x] Both key dialogs select the anonymous provider in one click ("Try OVHcloud — no key")
- [x] Button hidden when the current provider is already keyless; limits shown before sending
- [x] Desktop attach listener registered once, so repeated key saves cannot attach twice
- [x] Page test guards the affordance in both editions
- [x] Suites, bundles, archives and redeploy

## Done — 2.1.1 · release refresh

- [x] Version 2.1.1 in the app, cloud Worker and both packages
- [x] Single file, `Freeway.exe` and all three archives rebuilt
- [x] Production and preview redeployed; public links and checksums rewritten

## Done — 2.2.0 · cloud files

- [x] Upload, download and IndexedDB persistence for the browser workspace
- [x] Sandboxed HTML/SVG preview without same-origin access
- [x] Remote preview explains embedding refusals and offers a new tab
- [x] Account files in R2 + D1, scoped by session subject, with quotas and origin fence
- [x] Cloud file API tests; page test guards upload, preview and sync controls
- [x] R2 provisioned for preview and production, suites green, archives and deploy

## Done — 2.2.1 · Files list repair

- [x] Removed the undefined desktop `pins` access from cloud file rows
- [x] Page test isolates `renderFiles()` and rejects chat-pin references
- [x] 13/13 Playwright checks, 10/10 real D1/R2 checks, and all five suites green
- [x] Version 2.2.1 in both editions, archives rebuilt and both sites redeployed

## Done — 2.4.1 · Node 22 CI discovery

- [x] Unit tests run under Node 22 when the 14 files are passed explicitly
- [x] `test.yml`, `release.sh`, `npm test` and `AGENTS.md` use `lib/*.test.mjs`; the Windows workflow discovers the files in PowerShell
- [x] All five suites pass on Node 22
- [x] 2.4.1 on 3002; production and preview on 2.4.1-cloud
- [x] Source, GitHub-source and Windows archives rebuilt; release links updated

## Done — 2.4.0 · cloud model retries and CI

- [x] Same-provider model chain in the cloud Worker, capped at three models
- [x] Retry only on network failures, 404, 429 and 5xx; never after streaming starts
- [x] Image and tool turns stay on the selected model
- [x] `retriedFrom` metadata and visible `retried from <model>` note
- [x] Cloud tests for success, stream, key errors, exhausted retries and images
- [x] Linux CI workflow added; its 2.4.0 run exposed Node 22 test discovery, fixed in 2.4.1
- [x] Live keyless smoke on local, production and preview; keyed paths skipped without keys
- [x] Source, GitHub-source and Windows archives rebuilt; release links updated
- [x] 2.4.0 on 3002; production and preview on 2.4.0-cloud

## Done — 2.3.5 · Freeway project name

- [x] Renamed the source tree from `openrouter-chat` to `freeway`
- [x] Updated release, push, E2E and documentation paths
- [x] Renamed the GitHub repository to `zakker111/freeway` and corrected its description
- [x] Kept the OpenRouter provider name and legacy settings migration intact
- [x] 2.3.5 on 3002; production and preview on 2.3.5-cloud
- [x] Source, GitHub-source and Windows archives rebuilt; release links updated

## Done — 2.3.4 · strict provider choice

- [x] Removed cross-provider attempts from the desktop app and the cloud Worker
- [x] Same-provider model retries remain; `fallbackOrder` now returns only the chosen provider
- [x] Source and single-file simulations assert a usable second provider is never called
- [x] Cloud regression keeps a rate-limited OpenRouter turn off a configured Groq key
- [x] 169 units, 24 CLI, 21+21 simulation, 20 cloud checks
- [x] 2.3.4 on 3002; production and preview on 2.3.4-cloud
- [x] Source, GitHub-source and Windows archives rebuilt; release links updated

## Done — 2.3.3 · keyless stays put

- [x] Anonymous primary is terminal in `fallbackOrder`; desktop and Worker skip cross-provider fallback
- [x] Regression tests: provider order unit and OVHcloud-429 cloud turn with an OpenRouter server key
- [x] 169 units, 24 CLI, 21+21 simulation, 19 cloud checks
- [x] 2.3.3 on 3002; production and preview on 2.3.3-cloud; live keyless request verified
- [x] Source, GitHub-source and Windows archives rebuilt; release links updated

## Done — 2.3.2 · sample page and stale shell repair

- [x] Files → Sample writes `sample/index.html` + `sample/style.css` and previews them in both editions
- [x] Desktop local preview inlines relative CSS and uses a sandbox without same-origin access
- [x] Removed the cloud `saveThread()` pin lookup; page test isolates `renderFiles()` and `saveThread()`
- [x] Network-first service worker v3, old-cache cleanup and no-store `sw.js`; live production verified
- [x] 168 units, 24 CLI, 21+21 simulation, 18 cloud, 14 browser and 10 real D1/R2 checks
- [x] 2.3.2 desktop on 3002; all three archives rebuilt; production and preview redeployed

## Done — 2.3.1 · link and file audit

- [x] Verified public/local pages, provider console links and the private source path
- [x] Corrected README's stale 2.2.2 copy and opening provider list
- [x] Rebuilt and checked all three archives and their checksums
- [x] Full suites plus browser and real D1/R2 checks are green
- [x] 2.3.1 deployed to production and preview, local 3002 restarted

## Done — 2.3.0 · two more free providers

- [x] Z.AI `glm-4.7-flash` allowlist and Cloudflare Workers AI free-model allowlist
- [x] Account-ID storage and validation in the desktop config and cloud tab session
- [x] Account field in both key dialogs, with missing-account errors before upstream calls
- [x] Provider parity, page and cloud credential tests; all suites green
- [x] 2.3.0 in app, Worker and both packages; archives and both sites refreshed

## Done — 2.2.2 · Health formatting

- [x] Rail tabs stay on one line at 330 px; every label renders in full
- [x] Cloud health rows stack the name above status and limit text
- [x] Page test guards the tab layout
- [x] 163 units, 24 CLI, 21+21 simulation, 17 cloud, 13 browser and 10 storage checks
- [x] Archives, Windows executable, production and preview rebuilt/redeployed
