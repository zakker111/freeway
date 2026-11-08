# Versions

Semantic versioning: **patch** = fix, **minor** = new feature, **major** = breaking
change. The running app reports its version in the header badge and at `GET /api/config`.

| Version | Date | Summary |
|---|---|---|
| 2.17.2 | 2026-11-08 | Preview links are labelled by scope, and a missing file offers Open Files / Save sample & retry |
| 2.17.1 | 2026-11-08 | Preview deep links always open the panel and explain a missing browser file |
| 2.17.0 | 2026-11-08 | Release polish: share management, in-app dialogs, stable download and accessibility |
| 2.16.0 | 2026-11-08 | Account-backed preview links: a cloud preview opens on any signed-in device |
| 2.15.0 | 2026-11-08 | Preview links: the model can hand over a working preview URL in both editions |
| 2.14.4 | 2026-11-08 | Short-window lists keep their own scroll height while the editor stays whole |
| 2.14.3 | 2026-11-08 | Short-window file editor keeps its minimum height so its textarea is not clipped |
| 2.14.2 | 2026-11-08 | Scrollable Files/Secrets lists keep the editor and actions reachable on short screens |
| 2.14.1 | 2026-11-08 | Audit: tool calls are ignored when tools were not offered; `run_tests` follows the runner |
| 2.14.0 | 2026-11-08 | Opt-in Auto-approve Build actions plus a live UI audit and modal polish |
| 2.13.10 | 2026-11-08 | Audit: dead-code cleanup, correct cloud GitHub docs and working cloud test command |
| 2.13.9 | 2026-11-08 | Empty Saved chats panel offers a Start a new chat action |
| 2.13.8 | 2026-11-08 | Chats control is labelled; the panel no longer depends on an unlabeled icon |
| 2.13.7 | 2026-11-08 | Security hardening: request fences, secret denylist, scrubbed errors, pinned fetch |
| 2.13.6 | 2026-11-07 | Fluid phone-to-laptop scaling: 1040px reading column and larger phone text |
| 2.13.5 | 2026-11-07 | Phone composer gets a full-width row; header is three rows |
| 2.13.4 | 2026-11-07 | Header offset follows late wraps so Preview stays clickable |
| 2.13.3 | 2026-11-07 | Preview stays clickable below the rail; stale and cloud pages recover |
| 2.13.2 | 2026-11-07 | Preview recovers from stale entries and cloud reopens saved pages |
| 2.13.1 | 2026-11-07 | Preview finds the generated page again after a reload or chat switch |
| 2.13.0 | 2026-11-07 | Desktop Build verifies a preview with a local headless screenshot for vision models |
| 2.12.2 | 2026-11-07 | Keep the cloud account-files status and sign-in status in separate elements |
| 2.12.1 | 2026-11-07 | New chats appear in the sidebar before the first message, in both editions |
| 2.12.0 | 2026-11-07 | Build starts real dev servers: port detection, bounded logs, stop and cleanup |
| 2.11.0 | 2026-11-07 | Bounded Build verification: starter scaffold and local preview asset checks |
| 2.10.1 | 2026-11-07 | Chats with files but no messages survive a restart in both editions |
| 2.10.0 | 2026-11-06 | Every chat owns its files, account files and Preview |
| 2.9.2 | 2026-11-06 | One-click Preview in both editions opens a working sample |
| 2.9.1 | 2026-11-06 | Cloud chats reopen on reload and sync both ways with the signed-in account |
| 2.9.0 | 2026-11-05 | Plan mode: read-only planning with a persisted plan artifact, then Build |
| 2.8.5 | 2026-11-05 | Bigger, labelled image and text-file attachment buttons in both editions |
| 2.8.4 | 2026-11-05 | Cloud answers the page from cache and warms the catalog in the background |
| 2.8.3 | 2026-11-05 | Cloud requests are time-bounded so a cold deploy cannot answer 502 |
| 2.8.2 | 2026-11-05 | Audit fixes: malformed route ids are 400s, HEAD serves the page, healthz is read-only |
| 2.8.1 | 2026-11-05 | Tool turns follow the Settings switch and tell the model to use the offered tools |
| 2.8.0 | 2026-11-05 | Preview runtime diagnostics for script errors, failed assets and rejections |
| 2.7.2 | 2026-11-05 | Dependency-free browser regression test for preview cards |
| 2.7.1 | 2026-11-05 | Preview build cards hide the blank iframe; browser verification passed |
| 2.7.0 | 2026-11-05 | Markdown previews and build-aware TypeScript/JSX/SCSS adapters |
| 2.6.0 | 2026-11-05 | Desktop previews use a tokenised loopback server for modules and fetch |
| 2.5.0 | 2026-11-05 | Shared preview core bundles linked CSS/JS/SVG in both editions |
| 2.4.6 | 2026-11-05 | HTML writes open the preview automatically |
| 2.4.5 | 2026-11-05 | Keyless button names OVHcloud and says it switches provider |
| 2.4.4 | 2026-11-05 | Windows executable launched and served in CI; redirect-hop regression test |
| 2.4.3 | 2026-11-05 | Security and reliability audit: safe fetches, paired tool results, durable chat cache, private config |
| 2.4.2 | 2026-11-05 | Windows CI bundling and tests fixed; executable built and smoke-tested on Windows |
| 2.4.1 | 2026-11-04 | Node 22 CI test discovery fixed; retry behavior unchanged |
| 2.4.0 | 2026-11-04 | Cloud model retries stay inside the selected provider; Linux CI |
| 2.3.5 | 2026-11-04 | Project name and repository are Freeway everywhere |
| 2.3.4 | 2026-11-04 | Provider choice is strict: no automatic provider fallback |
| 2.3.3 | 2026-11-04 | Keyless demo stays on OVHcloud instead of falling back |
| 2.3.2 | 2026-11-04 | Files sample page, cloud pin crash repair, network-first shell |
| 2.3.1 | 2026-11-04 | Link, file and archive audit; stale 2.2.2 copy corrected |
| 2.3.0 | 2026-11-04 | Z.AI and Cloudflare Workers AI join the free provider list |
| 2.2.2 | 2026-11-04 | Health panel: one-line rail tabs and readable stacked cloud rows |
| 2.2.1 | 2026-11-04 | Cloud Files list stays visible after upload; browser regression coverage |
| 2.2.0 | 2026-11-04 | Cloud files: upload/download, sandboxed HTML preview, per-account R2 storage |
| 2.1.1 | 2026-11-04 | Release refresh: rebuilt archives and links, app behaviour unchanged |
| 2.1.0 | 2026-11-04 | First run can start on the keyless OVHcloud demo; attachment listener registered once |
| 2.0.1 | 2026-11-04 | Publish-readiness pass: lockfile identity, ignored build output, docs that match 2.0 |
| 2.0.0 | 2026-11-04 | Renamed to Freeway; existing config and chats migrate, no feature regressions |
| 1.60.0 | 2026-11-04 | One image per turn for free vision models, plus real Retry-After cooldowns and provider plan limits |
| 1.58.0 | 2026-11-04 | Retry-after countdowns, Try buttons and automatic skipping of cooling models |
| 1.57.1 | 2026-11-04 | Health readiness labels now distinguish keyless, deployment-key and visitor-key providers |
| 1.57.0 | 2026-11-04 | Provider readiness plus per-model attempts, failures and latency in both Health panels |
| 1.56.0 | 2026-11-04 | Project groups for saved chats and a per-chat editable memory note |
| 1.55.1 | 2026-11-04 | Cloud message actions appear on live messages, not only reopened chats |
| 1.55.0 | 2026-11-04 | Branch any message into a new chat, and attach text files in both editions |
| 1.54.0 | 2026-11-04 | `run_tests` turns a test run into file/line failures the model can fix |
| 1.53.1 | 2026-11-04 | Cloud memory can actually run: the pre-compaction cap no longer rejects long chats |
| 1.53.0 | 2026-11-04 | Long chats fold older turns into a memory note and keep the newest messages verbatim |
| 1.52.0 | 2026-11-04 | The model can search a workspace, read files in batches and patch code through a visible diff |
| 1.51.1 | 2026-11-04 | Copy caught up with the provider table; fallback shows limits |
| 1.51.0 | 2026-11-04 | Each plan shows the request numbers it allows, in the key dialog and Status |
| 1.50.0 | 2026-11-04 | The last "free tier" labels become plan names on both editions |
| 1.49.0 | 2026-11-04 | The free-plan kind is visible in the picker, not just in the data |
| 1.48.0 | 2026-11-04 | OVHcloud joins with no key at all — the first `anonymous` provider |
| 1.47.0 | 2026-11-04 | Aion Labs joins on its standing free tier; the free-plan rule is now data, not prose |
| 1.46.0 | 2026-11-04 | Cloud gets the same left-docked chats panel as Windows; one shell, one test |
| 1.45.0 | 2026-11-04 | The Status panel says how many shared-key turns are left today |
| 1.44.0 | 2026-11-04 | A shared deployment key is fenced, budgeted per visitor and capped per turn |
| 1.43.2 | 2026-11-04 | The closed-tab rescue is covered by a paused-upstream simulation, not a manual probe |
| 1.43.1 | 2026-11-04 | A chat whose tab dies on its first answer is saved with the reply instead of lost |
| 1.43.0 | 2026-11-04 | Rename and delete a chat from Ctrl+K, in both editions |
| 1.42.1 | 2026-11-04 | Cloud chat pin actually pins the chat again; pages now have a duplicate-definition test |
| 1.42.0 | 2026-11-04 | Ctrl+K is a quick switcher: every saved chat is a palette row that opens directly |
| 1.41.0 | 2026-11-04 | Cloud search asks the account too: `?q=` over titles and messages, found chats sync down |
| 1.40.0 | 2026-11-04 | Chat search covers message text, not just titles, in both editions |
| 1.39.0 | 2026-11-04 | Cloud chats export as JSON that the desktop app imports, so the two histories meet |
| 1.38.0 | 2026-11-04 | All chats in the cloud edition: no 30-chat cap, and the chats list no longer throws |
| 1.37.0 | 2026-11-04 | Desktop chats panel is docked by default, toggleable at every width, and remembers |
| 1.36.0 | 2026-11-04 | Ollama (local) provider in the desktop app; cloud stays six hosted providers |
| 1.35.1 | 2026-11-04 | Paid mode rejected; the free-only rule is now explicit in AGENTS.md |
| 1.35.0 | 2026-11-04 | Cloud Status panel lists per-model answers and latency |
| 1.34.0 | 2026-11-04 | Model picker: pinned/recent groups and arrow-key navigation on desktop too |
| 1.33.0 | 2026-11-04 | Per-answer cost label and chat pinning in both editions |
| 1.32.1 | 2026-11-04 | Footer hint names Ctrl+K commands and Ctrl+M models |
| 1.32.0 | 2026-11-04 | Ctrl+K command palette in both editions; model picker moves to Ctrl+M |
| 1.31.1 | 2026-11-04 | Quota meter works with a pasted key, not only a server key |
| 1.31.0 | 2026-11-04 | Usage meter: free requests left today, per-chat tokens |
| 1.30.0 | 2026-11-04 | Installable cloud app: offline shell, home-screen icon |
| 1.29.2 | 2026-11-04 | Chats are one click away: header button with a count, Alt+H |
| 1.29.1 | 2026-11-04 | Sign-in is a visible header button; sign-out is no longer blocked |
| 1.29.0 | 2026-11-04 | Cloud accounts: sign in with Freebuff, chats follow you |
| 1.28.0 | 2026-11-04 | Cross-provider fallback: a turn survives one provider's limits |
| 1.27.0 | 2026-11-04 | Dark theme: near-black surfaces, soft-white text, easy on the eyes |
| 1.26.1 | 2026-11-03 | White, grey and black: the green accent is gone |
| 1.26.0 | 2026-11-03 | A lighter, calmer interface: toned palette, clearer hierarchy, quick starts |
| 1.25.8 | 2026-11-03 | Free-only gate fails closed when the priced catalog is unavailable |
| 1.25.7 | 2026-11-03 | Token totals survive a restart; cloud rebuilds them from history; Windows `.exe` built |
| 1.25.6 | 2026-11-03 | The usage footer updates the moment an answer finishes |
| 1.25.5 | 2026-11-03 | Visible message/token counts, both ZIPs, first-run docs |
| 1.25.4 | 2026-11-03 | Cloud answers render Markdown, like Windows |
| 1.25.3 | 2026-11-03 | Cloud provider picker matches the desktop pill exactly |
| 1.25.2 | 2026-11-03 | Your own messages align left, with the answers |
| 1.25.1 | 2026-11-03 | Fix cloud key saving for the new providers; honest key rejection |
| 1.25.0 | 2026-11-03 | Six providers: Mistral, Cohere and SambaNova join the free tier |
| 1.24.1 | 2026-11-03 | Audit fixes: provider payloads, unknown-provider errors, server-key cloud |
| 1.24.0 | 2026-11-03 | Windows gains the prompt library and Markdown transcript export |
| 1.23.0 | 2026-11-03 | Cloud chrome matches desktop; README start + single-exe guide |
| 1.22.0 | 2026-11-03 | Cloud testing mode: workspace tools with Allow/Deny |
| 1.21.0 | 2026-11-03 | Cloud Files reach the model: names always, ticked contents on send |
| 1.20.0 | 2026-11-03 | Cloud gets the desktop rail: Files, Secrets, GitHub, Preview, Status, Settings |
| 1.19.1 | 2026-11-03 | Cloud version spans start blank instead of a stale number |
| 1.19.0 | 2026-11-03 | README key guide; missing-workspace fallback verified |
| 1.18.3 | 2026-11-03 | Cloud notice derives the desktop version; page served no-store |
| 1.18.2 | 2026-11-03 | Cloud key dialog links to each provider's key page |
| 1.18.1 | 2026-11-03 | Say plainly that Groq is not Grok when a key is rejected |
| 1.18.0 | 2026-11-03 | Cloud saved chats: reopen, switch provider, delete |
| 1.17.0 | 2026-11-03 | Cloud prompt library + Markdown transcript export |
| 1.16.0 | 2026-11-03 | Cloud model picker: search, pin, recent, keyboard |
| 1.15.0 | 2026-11-03 | Cloud replies stream token by token |
| 1.14.2 | 2026-11-03 | One version everywhere: release script + rule to ship every site |
| 1.14.1 | 2026-11-03 | Copilot removed from the picker; cloud gains the same providers |
| 1.14.0 | 2026-11-03 | Provider switcher: OpenRouter, Groq and Gemini (AI Studio) |
| 1.14.0-cloud.1 | 2026-11-03 | Cloud edition: the same free-only chat, deployed as a Worker |
| 1.13.2 | 2026-11-03 | A tool call the model wrote as text is now run instead of ignored |
| 1.13.1 | 2026-11-03 | Tool calls no longer end in "No model answered." |
| 1.13.0 | 2026-11-03 | Status tab: attempts, outcomes, latency and cooldowns for this run |
| 1.12.5 | 2026-11-03 | `--doctor` self-check; a busy port no longer opens someone else's app |
| 1.12.4 | 2026-11-03 | Windows fixes: `.cmd` shims run at all, no silent exit, real save failures reported |
| 1.12.3 | 2026-11-03 | New Chat clears the preview; no hard dependency on AbortSignal.timeout |
| 1.12.2 | 2026-11-03 | Gzip JSON too: the 80 KB model list stalled the boot over the test link |
| 1.12.1 | 2026-11-03 | Gzip the page: the shared link was timing out part-way through 109 KB |
| 1.12.0 | 2026-11-03 | `run_command`: allowlisted program, no shell, approved per call, output streamed |
| 1.11.0 | 2026-11-03 | Preview tab: a local dev server in a sandboxed frame, saved per chat |
| 1.10.0 | 2026-11-03 | GitHub panel and `github_*` tools; issues need approval |
| 1.9.0 | 2026-11-03 | Right rail: sandboxed Files panel, Secrets, and approval before model writes |
| 1.8.1 | 2026-11-03 | Version badge in the header; `AGENTS.md`, `TODO.md`, `VERSIONS.md` |
| 1.8.0 | 2026-11-03 | Survives a restart, recovers cut-off answers, refuses stale saves |
| 1.7.0 | 2026-11-03 | 256 KB chat body cap, strict CSP, secret redaction |

## 2.17.2 — 2026-11-08

- **The link scope is visible.** A saved page now shows a **Browser-only link** pill next to
  **copy link**. An account share shows **Portable link** instead. A browser-only link also
  offers **sign in for portable link** when auth and preview shares are enabled.
- **A missing preview file offers a way forward.** The panel now includes **open files** and,
  for `sample/index.html`, **save sample & retry**. Saving the sample immediately previews it
  and keeps the original hash link usable. Other missing files can be created in Files.
- **Checks.** 260 unit (including 53 page checks), 33 CLI, 28 + 28 simulations and 36 cloud
  checks pass. Desktop 2.17.2; production and preview report 2.17.2-cloud.

## 2.17.1 — 2026-11-08

- **A preview deep link always does something visible.** Opening `#preview=<file>` now opens
  the Preview panel. If the named file is not saved in this browser, the panel says so and
  keeps the link, instead of leaving the user on the app with no response. Browser-only links
  work only where the file exists; a signed-in account share is the cross-device option.
- **Checks.** All 2.17.1 gates pass: 259 unit (including 52 page checks), 33 CLI,
  28 + 28 simulations and 36 cloud checks. Desktop 2.17.1; production and preview report
  2.17.1-cloud.

## 2.17.0 — 2026-11-08

- **Account preview links are manageable.** The cloud rail has a **Shares** panel that lists
  every saved link with its file, date and size. Open or copy one, revoke one, or revoke all.
  Revoking the link that is currently previewed restores the browser `#preview=` copy link
  instead of leaving a dead account URL behind; signing out and deleting the account file do
  the same. `GET /api/previews` lists an account's links and `DELETE /api/previews` revokes
  them all; the existing single-link DELETE is unchanged.
- **One stable desktop download.** The cloud page's desktop link is now a stable
  `github.com/zakker111/freeway/releases/latest` URL served from `/api/config`, not a
  temporary `style.dev` tunnel. The desktop Settings screen has the same release link.
- **Prompts belong to the app.** Both editions replace native `prompt()` and `confirm()`
  with one in-app `<dialog>`: rename, project, memory, import, secret delete and quit all
  use it. Escape cancels, Enter submits, and the custom overlays are labelled and trap Tab.
- **Accessible status.** The header status and cloud banner are live regions, both pages
  expose a hidden `aria-live` region, and the dialogs have titles and focus handling.
- **Checks.** All 2.17.0 gates pass: 259 unit (including 52 page checks), 33 CLI,
  28 + 28 simulations and 36 cloud checks. Desktop 2.17.0; production and preview report
  2.17.0-cloud.

## 2.16.0 — 2026-11-08

- **A cloud preview link survives the device.** When signed in, `preview_link` packages the
  page as a self-contained HTML snapshot in the account's R2 space and returns
  `/preview/<id>` instead of a browser-only `#preview=` link. Re-sharing the same chat file
  updates the same URL; another device signed into the account renders it.
- **Owner-only, not a public share.** The snapshot row is keyed by the session subject and
  served under `sandbox` with a CSP, so the generated page cannot read the app's cookies or
  call its APIs. A signed-out visitor gets a sign-in page; another account gets 404.
- **Stable and revocable.** One share per chat file, 1.5 MB per snapshot, 40 shares / 8 MB
  per account. Deleting the account file also removes its snapshot. The Preview panel has a
  Share link button; Copy link creates the account link lazily when signed in. Signed out,
  the link stays the browser-only `#preview=` form.
- **Checks.** All 2.16.0 gates pass: 257 unit (including 50 page checks), 33 CLI,
  28 + 28 simulations and 35 cloud checks. Desktop 2.16.0; production and preview report
  2.16.0-cloud.

## 2.15.0 — 2026-11-08

- **The model can hand over a preview link.** Desktop Build offers `preview_link`, and every
  HTML or SVG write now returns its tokenised loopback preview URL in the same tool result,
  so even a model that never calls the tool can show the address. The Preview panel has a
  Copy link button, and asking to see a page opens the panel as well as returning the link.
- **Cloud links reopen the saved page.** Cloud Build offers `preview_link` for browser files;
  the URL carries the file in `#preview=` and reopens it in the Preview panel after a reload
  or when opened in a new tab. Cloud links stay in this browser — they are not public shares.
- **Checks.** All 2.15.0 gates pass: 257 unit (including 50 page checks), 33 CLI,
  28 + 28 simulations and 33 cloud checks. Desktop 2.15.0; production and preview report
  2.15.0-cloud.

## 2.14.4 — 2026-11-08

- **Long lists keep their space.** The file and secret lists no longer shrink when the
  editor is visible on a short screen. They stay at their bounded scroll height, and the
  panel body scrolls when both cannot fit, instead of reducing a 48-file list to 40px.
- **Checks.** All 2.14.4 gates pass: 255 unit (including 49 page checks), 33 CLI,
  28 + 28 simulations and 33 cloud checks. Desktop 2.14.4; production and preview report
  2.14.4-cloud.

## 2.14.3 — 2026-11-08

- **The short-window editor stays whole.** On windows under 640px, the desktop file
  editor now keeps a 170px minimum height. A long list and a short viewport can still
  scroll the rail, but the textarea no longer extends below the panel and gets clipped.
- **Checks.** All 2.14.3 gates pass: 255 unit (including 49 page checks), 33 CLI,
  28 + 28 simulations and 33 cloud checks. Desktop 2.14.3; production and preview report
  2.14.3-cloud.

## 2.14.2 — 2026-11-08

- **Files and Secrets scroll where it matters.** Long file and secret lists now have a
  bounded scroll area instead of stretching the rail and pushing the editor or actions
  below the fold. The panel body remains scrollable, with contained overscroll so reaching
  the end does not fling the chat behind it.
- **Opening a file brings the editor into view.** The desktop file browser scrolls the
  editor to the nearest edge and focuses it; the preview path reveals the buffer without
  stealing focus. Under 640px of height the rail compacts and shortens the editor/list.
- **Checks.** All 2.14.2 gates pass: 255 unit (including 49 page checks), 33 CLI,
  28 + 28 simulations and 33 cloud checks. Desktop 2.14.2; production and preview report
  2.14.2-cloud.

## 2.14.1 — 2026-11-08

- **Tools off is a hard stop.** When a provider returns a tool call in a response that was
  not offered tools, the call is ignored. This covers protocol `tool_calls`, calls written
  as `<tool_call>` text, and the automatic retry after a provider rejects the tools
  parameter. If there is no usable answer, the turn says the call was rejected.
- **`run_tests` follows the runner gate.** It disappears with `run_command` and
  `start_process` when no workspace, command switch or allowlist could run it, instead of
  being advertised and then failing every call. Its approval path is unchanged.
- **Checks.** All 2.14.1 gates pass: 254 unit, 33 CLI, 28 + 28 simulations and 33 cloud
  checks. Desktop 2.14.1; production and preview report 2.14.1-cloud.

## 2.14.0 — 2026-11-08

- **Approval shortcut, off by default.** Settings now has **Auto-approve Build actions**.
  When enabled, Build can write files, create GitHub issues, start or stop allowlisted
  processes and run allowlisted commands without an Allow / Deny card. Plan remains
  read-only; workspace containment and the command allowlist still apply. Every skipped
  card is marked in the transcript.
- **UI audit.** Fixed the API-key modal footer squeezing “Save and start” onto three lines,
  added the missing desktop favicon, made the numeric token field valid at its default
  value, and gave icon-only controls accessible names. The Settings text now names the
  approval trade-off and the remaining limits.
- **Checks.** 254 unit, 33 CLI, 26 + 26 simulations and 33 cloud checks pass. Desktop
  2.14.0; production and preview report 2.14.0-cloud.

## 2.13.10 — 2026-11-08

- **Dead code removed.** Dropped an unused `baseUrlFor` import in `app.mjs` and an unused
  `accountEnabled()` helper in the cloud page. No behaviour changes.
- **Cloud test command works.** `cloud/package.json` now points `npm test` at the real
  `cloud/test.mjs` suite instead of failing with “no test specified”; `npm run build`
  rebuilds the Worker bundle.
- **Cloud docs match the build.** The Worker header now lists the real routes and explains
  that chats, account files and the browser-side GitHub rail exist in the cloud edition;
  it no longer claims GitHub was dropped. README, AGENTS and RELEASING were updated for the
  cloud GitHub token, full route list, provider keys and current test commands.
- **Checks.** All 2.13.10 release gates pass: 253 unit, 33 CLI, 25 + 25 simulations and
  33 cloud checks. Desktop 2.13.10; production and preview report 2.13.10-cloud.

## 2.13.9 — 2026-11-08

- **The empty panel has an action.** When there are no saved chats, the sidebar now shows
  **Start a new chat** under the empty-state text in both editions. It calls the existing
  new-chat path, so the draft is saved and listed immediately; it is not shown for a search
  that simply has no matches.
- **Checks.** Both page tests require the action; all 2.13.9 release gates pass
  (253 unit, 33 CLI, 25 + 25 simulations, 33 cloud).

## 2.13.8 — 2026-11-08

- **Chats is visible.** The saved-chats control now reads **☰ Chats** in both the desktop and
  cloud editions, so reopening the panel no longer depends on recognizing an unlabeled icon.
  The label hides below 640px so the header still fits on phones.
- **Same panel, same behaviour.** The docked column, narrow-screen drawer, search, keyboard
  shortcut and empty state are unchanged.
- **Regression coverage.** Both page tests require the visible label; all 2.13.8 release gates
  pass (251 unit, 33 CLI, 25 + 25 simulations, 33 cloud).

## 2.13.7 — 2026-11-08

- **Local request fence.** Foreign `Host` headers and cross-origin mutations are refused,
  so a DNS-rebinding page cannot read the app token or drive the local API. A proxy host
  must be named in `FREEWAY_ALLOWED_HOSTS`.
- **Credential files stay out of tools.** Listing, reads, writes, search and previews
  refuse `.env*` (except examples), `secrets.*`, `credentials.*`, SSH keys and common key
  files; the preview server also refuses `config.json` and `threads.json`.
- **Quota and errors.** `/api/key` requires the app token. Provider error text is scrubbed
  there and in cloud chat errors; redaction covers OpenRouter, Groq, Gemini, GitHub, xAI,
  AWS and generic `sk-` key shapes.
- **Storage and transport.** `threads.json` is written `0600`, cloud pages send `nosniff`,
  preview HTML gets a restrictive CSP, regex search rejects catastrophic-backtracking
  shapes and is time-budgeted, and `fetch_url` pins validated DNS answers.
- **Checks.** 251 unit, 33 CLI, 25 + 25 simulations and 33 cloud checks pass. Desktop
  2.13.7; preview and production report **2.13.7-cloud**.

## 2.13.6 — 2026-11-07

- **The reading column scales with the screen.** It stays 860px on smaller
  laptops, grows to 1040px from 1200px wide, and the body text scales fluidly
  from 15px to 16.8px instead of changing only at breakpoints.
- **Phones get larger type and touch targets.** At 700px and below the page uses
  16px text, Send is 46px high, header controls are 40px high, and message
  bubbles use the full width.
- **Shared rules.** Desktop and cloud use the same `--content` token, type
  scale, phone breakpoint and touch sizes.
- **Checks.** 247 unit, 29 CLI, 25 + 25 simulations and 31 cloud checks pass.
- **Shipped everywhere.** Desktop 2.13.6; preview and production report
  **2.13.6-cloud**.

## 2.13.5 — 2026-11-07

- **The phone composer fits the screen.** At 700px and below the textarea takes
  a full-width row and the controls sit beneath it; Send moves to the right.
  At 432×822 the composer is 406px wide and the textarea is 406×50, with no
  horizontal overflow.
- **The desktop header is three rows, not four.** Capping the redundant quota
  pill at 640px keeps New, Settings, Preview, Files and Quit on one row. The
  header measures 141px, and Preview opens the rail at exactly that offset.
- **Checks.** 246 unit, 29 CLI, 25 + 25 simulations and 31 cloud checks pass.
- **Shipped everywhere.** Desktop 2.13.5; preview and production report
  **2.13.5-cloud**. The Windows SEA carries the same page.

## 2.13.4 — 2026-11-07

- **The header offset follows late wraps.** 2.13.3 measured the header once when the
  rail opened, but the provider and model rows can reflow afterwards (observed 141px
  becoming 184px on a 432px viewport). A `ResizeObserver` now keeps `--header-h` current,
  so the fixed rail starts below the whole header on both editions.
- **The click target was verified.** At 432×822 the centre of the header Preview button
  now resolves to the button itself, not a rail row. The rail begins at the final header
  height instead of partway through it.
- **Windows EXE rebuilt.** `Freeway-2.13.4-windows.zip` carries the Node v26.13.0 SEA
  executable built from the same `freeway.cjs`; the Linux SEA proxy of that blob reports
  2.13.4. The Windows PE is inspected but cannot be launched in this Linux VM.
- **Checks.** 245 unit, 29 CLI, 25 + 25 simulations and 31 cloud checks pass.
- **Shipped everywhere.** Desktop 2.13.4; preview and production report **2.13.4-cloud**.

## 2.13.3 — 2026-11-07

- **The header Preview button is clickable again.** On screens narrower than 1100px,
  the fixed right rail started at the top of the viewport and covered the header
  controls; a hit test at the Preview button resolved to a rail row. Both editions now
  start the rail below the measured header height and update it on resize.
- **Stale entries fall through.** Preview still tries the remembered page first, then a
  fresh workspace scan after a rename or delete. A real error stays visible instead of
  being replaced by the in-memory sample.
- **Cloud reopens the real page.** Cloud Preview picks the best saved HTML, SVG or
  Markdown entry after a reload or chat switch before using the sample.
- **Windows EXE rebuilt.** `Freeway-2.13.3-windows.zip` contains the Node v26.13.0 SEA
  executable built from the same `freeway.cjs`. The Linux SEA proxy of that blob serves
  2.13.3; the Windows PE is inspected but cannot be launched in this Linux VM.
- **Checks.** 245 unit, 29 CLI, 25 + 25 simulations and 31 cloud checks pass.
- **Shipped everywhere.** Desktop 2.13.3; preview and production report **2.13.3-cloud**.

## 2.13.2 — 2026-11-07

- **Stale entries fall through.** Preview remembers the last page, but that path can be
  renamed or deleted between turns. It now tries the remembered selection, then a fresh
  workspace scan, and only keeps an error after the real candidates fail. The in-memory
  sample never hides that error.
- **Cloud reopens the real page.** Cloud Preview now scans saved browser files for the
  best HTML, SVG or Markdown entry — index pages and shallow/public paths first — before
  falling back to the sample after a reload or chat switch.
- **Windows EXE rebuilt.** `Freeway-2.13.2-windows.zip` contains the Node v26.13.0 SEA
  executable built from the same `freeway.cjs`. The Linux SEA proxy of the same blob
  reported 2.13.2 and served `/api/config` and the page; the Windows PE was inspected but
  cannot be launched in this Linux VM.
- **Checks.** 243 unit, 29 CLI, 25 + 25 simulations and 31 cloud checks pass.
- **Shipped everywhere.** Desktop 2.13.2; preview and production report **2.13.2-cloud**.

## 2.13.1 — 2026-11-07

- **Preview finds the page again.** A reloaded tab or a switched chat keeps its generated
  files but loses the in-memory file selection, so Preview opened empty or fell back to the
  sample. The workspace now reports its best preview entry: `index.html` first, then other
  HTML, SVG and Markdown, with shallow and `public/` pages ranked ahead of docs and generated
  folders. A selected preview file still wins when the tab has one.
- **Bounded discovery.** The server scans at most four folder levels with a 400-candidate
  budget, skips hidden and generated directories (`node_modules`, `.git`, build output) and
  keeps every resolved path inside the active workspace.
- **The sample is not a file.** “sample (in memory)” is never stored as a workspace entry,
  so writing CSS or JS afterwards asks for a real page instead of reopening the sample.
- **Checks.** 241 unit, 29 CLI, 25 + 25 simulations and 31 cloud checks pass. The new API
  route is covered at the endpoint and workspace-unit level; reopening Preview is covered
  by the page test.
- **Shipped everywhere.** Desktop 2.13.1; preview and production report **2.13.1-cloud**.

## 2.13.0 — 2026-11-07

- **Build can see its own page.** `screenshot_preview` runs the static `preview_check` first,
  then starts a temporary loopback preview, captures an 800×600 PNG with an installed
  headless Edge or Chrome, and attaches the image to the model turn for layout, spacing,
  overflow and contrast inspection. At most two captures are allowed in one Build run.
- **Only when it can work.** Screenshot verification is on by default
  (`screenshotChecks: true`) with a Settings switch. It is offered only in desktop Build
  when the workspace is ready and every model in the OpenRouter fallback chain accepts
  images; Plan mode, non-vision chains and the switch being off remove the tool entirely.
  No image is sent when it is off.
- **Bounded and private.** No new dependency: the browser gets a temporary profile and a
  filtered environment that never contains a provider key. The PNG is validated and capped
  at 320 KB; the tool event shows it inline under the tool chips, while the saved chat keeps
  the text answer and tool summary.
- **Checks.** 238 unit, 29 CLI, 25 + 25 simulations and 31 cloud checks pass. Capture is
  covered with an injected browser spawn and a real PNG fixture; this Linux VM has no Edge
  or Chrome, so a live desktop capture was not possible here.
- **Shipped everywhere.** Desktop 2.13.0; preview and production report **2.13.0-cloud**.

## 2.12.2 — 2026-11-07

- **Account status lines no longer collide.** The cloud Files panel and the Settings
  account row both used `id="accountNote"`. `getElementById` resolved the Files note,
  and rendering the account row moved it into Settings, so the Files message vanished.
  The Files status now has its own `filesAccountNote` element; both stay in place.
- **Guard.** The page test now rejects duplicate element ids in either edition, so a
  future `$("id")` cannot silently target the wrong element. All five suites pass:
  225 unit, 29 CLI, 25 + 25 simulations and 31 cloud checks.
- **Shipped everywhere.** The desktop app reports 2.12.2; preview and production
  report **2.12.2-cloud**. Both cloud environments were published and checked.

## 2.12.1 — 2026-11-07

- **New Chat is visible immediately.** The desktop page adds a local sidebar summary
  before the debounced save and persists the empty thread; cloud `saveThread` accepts
  `allowEmpty`, so New Chat, a restored draft and a provider switch all keep a listed
  draft. The first message updates that same id and title instead of creating a second
  chat.
- **Checks.** New page regressions cover the desktop New Chat and boot paths plus the
  cloud New Chat save. 223 unit tests, 29/29 CLI checks, 25/25 source simulations,
  25/25 bundled simulations and 31/31 cloud checks pass. The desktop bundle and ZIP
  were rebuilt for 2.12.1.
- **Shipped everywhere.** The desktop app reports 2.12.1; preview and production report
  **2.12.1-cloud**. Both cloud environments were published and checked.

## 2.12.0 — 2026-11-07

- **A dev server can be started from Build.** `start_process` runs an allowlisted program in
  the workspace and keeps it alive after the turn. The port it prints is detected and offered
  in the composer's new dev-server bar, which opens it in Preview and stops it with one click.
  Output is captured as a bounded tail and read back with `process_logs`.
- **Nothing is left behind.** At most three managed processes run at once, a 30-minute TTL
  stops one nobody closed, and quitting the app kills the rest. `stop_process` ends one id or
  all of them. Both start and stop go through the Allow / Deny card; Plan mode offers neither.
- **Checks.** New port-detection and lifecycle regressions start a real loopback server,
  assert the port only appears once it accepts connections, and verify the port is free after
  a stop. The desktop bundle and ZIP were rebuilt for 2.12.0.
- **Shipped everywhere.** The desktop app reports 2.12.0, preview and production report
  **2.12.0-cloud**, and the ZIP was rebuilt after both deployments.

## 2.11.0 — 2026-11-07

- **Build is a bounded loop.** A Build turn can use up to 40 tool steps within 15 minutes.
  The composer shows the remaining step and time budget, and either limit stops the turn
  with a clear message. Plan keeps its small three-round cap and remains read-only.
- **Start from a page that works.** `scaffold_project` creates `index.html`, `styles.css`
  and `app.js` in a folder, with three themes, escaped copy and no dependencies. It refuses
  to overwrite an existing file and still goes through the Allow / Deny card.
- **Check before opening Preview.** `preview_check` follows local HTML, stylesheet, script
  and image references, reports missing files with the page or stylesheet that referenced
  them, and can be run again after a repair. It never fetches external URLs or executes
  JavaScript. Plan mode may use it because it only reads.
- **Checks.** 215 units, 28 CLI, 25 + 25 simulations and 31 cloud checks pass. The desktop
  bundle and ZIP were rebuilt, and preview and production now report **2.11.0-cloud** and
  remain published. Managed dev-server start/stop and screenshot verification remain the
  next Build slice.

## 2.10.1 — 2026-11-07

- **A chat with files and no messages survives.** The desktop page now saves the current
  chat after **Files → Sample**, an editor save or a successful tool write, even before the
  first message. A file-only chat is therefore still there after **New Chat** and after a
  restart, instead of being discarded because its message list was empty.
- **Cloud does the same.** The cloud page saves a file-only thread, refreshes the chat list
  immediately and keeps the chat when another one starts. The D1 thread cleaner accepts a
  zero-message thread while still enforcing the 200-message ceiling, so the account copy is
  not rejected.
- **New chat, not "Untitled".** An empty saved chat is labelled **New chat** until its first
  message gives it a title.
- **Checks.** 209 units, 28 CLI, 25 + 25 simulations, 31 cloud checks; both bundles and the
  ZIP were rebuilt. Preview and production now report **2.10.1-cloud** and both remain
  published. The deployed page serves the file-only save path; a signed-in account round
  trip was not available in this environment.

## 2.10.0 — 2026-11-06

- **A chat is a workspace.** New desktop chats get their own managed folder under the
  app config; files, file tools, local previews and turn context all use that folder.
  Existing chats keep the Settings folder, so an upgrade does not hide a project. The
  workspace policy is saved with the thread (`""` = managed, a path = explicit, absent =
  legacy), and a partial save cannot move a chat back to the legacy folder.
- **New Chat starts empty in the cloud too.** Browser files are stored in a per-chat
  IndexedDB namespace, and account files are scoped by chat in D1/R2. The first existing
  chat opened after the upgrade claims the old global namespace; a brand-new chat sees
  nothing from the previous one. Account quotas remain per account.
- **Preview belongs to the chat.** Switching chats closes the previous local preview
  server and clears the frame; the header button shows its sample in memory instead of
  writing sample files. Files → Sample remains the explicit write action.
- **Checks.** 209 units, 28 CLI, 25 + 25 simulation, 30 cloud checks; desktop and cloud
  builds are rebuilt together. One simulation turn also proves its files and saved
  workspace policy belong to that chat.

## 2.9.2 — 2026-11-06

- **Preview is one click.** A **Preview** button in the desktop and cloud header opens the
  preview rail and starts a working sample page when the chat has no preview yet. If a
  workspace page or URL is already open, it reopens that instead of replacing it.
- The starter is still written by **Files → Sample**; the new header action removes the
  setup steps.
- Checks: 207 units, 27 CLI, 24 + 24 simulations, 29 cloud checks; bundle, ZIP and both
  cloud environments rebuilt.

## 2.9.1 — 2026-11-06

- **A reload reopens what you were reading.** The cloud page remembered the chat list but
  always started a blank conversation. It now stores the active chat id and opens it (or the
  newest saved chat) after the account merge, so a refresh no longer looks like the chat was
  lost.
- **Signing in uploads local chats.** The old sync only pulled account rows into the browser;
  a chat created while signed out was never sent up. Sync now merges both sides and uploads
  browser-only or newer chats in small batches. Saved chats are namespaced per account, so a
  second account on the same browser cannot inherit the first one's history.
- **Long chats save.** The D1 thread cleaner accepted only 80 messages while the page keeps
  200; a long conversation was rejected with `400 bad_thread`. Both ceilings are now 200.
- **Checks.** A page regression test covers reopen, per-account keys and two-way upload; a
  cloud check saves a 200-message thread through the real cleaner. All suites pass.

## 2.9.0 — 2026-11-05

- **Plan before Build.** Every new desktop chat starts in **Plan**: the composer switch is
  `Plan | Build`, and Plan may read the workspace, the clock, public pages and GitHub
  issues, but it cannot write. The only output is a plan card in the transcript: goal,
  assumptions, ordered steps with files and a verification command, and risks. **Build this
  plan** switches to Build and sends the artifact as the task; writes still need the normal
  approval card.
- **The server enforces read-only.** Plan mode sends only the read tools plus the two plan
  tools, and `/api/chat` refuses any other call before it can show a confirmation card. The
  simulation makes a mock model call `write_file` in Plan and asserts no file and no
  approval request.
- **Plan survives.** `mode` and `plan` are saved with the thread and restored on reload or
  restart; threads saved before 2.9.0 keep opening in Build. `update_plan_step` moves the
  card through `pending → active → done` while Build works.
- **Live check.** A real desktop Plan turn with OVHcloud gpt-oss-20b called
  `propose_plan` and streamed a plan artifact with two ordered steps and verification
  commands, without a write or an approval card. Production cloud streamed a keyless
  2.9.0 turn with HTTP 200.
- **Limits.** Plan editing before Build and cloud/D1 plan mode are not in this release. A
  model without tool support can describe a plan in text but cannot create the artifact.
  Cloud remains chat + static preview.
- 205 units, 27 CLI, 24 + 24 simulations and 28 cloud checks pass. The single-file bundle
  and cloud worker were rebuilt, and both cloud environments were redeployed.

## 2.8.5 — 2026-11-05

- **Attachments are visible.** The image and text-file controls in the composer are now
  full-height buttons with an icon and a label instead of two small emoji chips; the image
  button carries the accent colour. Below 700 px the labels hide so the composer still
  fits a phone.
- Both editions use the same markup and CSS. Image compression, the one-image-per-turn
  rule, the accepted text types and every route are unchanged.
- 198 units, 27 CLI, 21 + 21 simulation, 28 cloud checks and the browser preview check pass.

## 2.8.4 — 2026-11-05

- **The shell never waits for the catalog.** 2.8.3 bounded the catalog fetch, but a cold
  production isolate still added that wait to its own startup and met the edge's ~5 s
  limit (5.1 s → 502, twice in a row, then 100 ms). `/api/config` now answers from the
  in-memory catalog — the page never reads the count it returns — warms the catalog with
  `ctx.waitUntil`, and lets `/api/models` deliver the real list. Preview's first request
  after deploy fell from 3.9 s to 1.6 s.
- **A regression check pins it.** The cloud suite points the catalog at a 3-second endpoint
  and asserts `/api/config` answers in under a second; the old code waited 2.5 s.
- 198 units, 27 CLI, 21 + 21 simulation, 28 cloud checks and the browser preview check pass.

## 2.8.3 — 2026-11-05

- **A cold deployment answers.** `/api/config` fetches the live OpenRouter catalog before
  replying, and that fetch had no deadline. On a cold isolate a slow catalog ran past
  Cloudflare's roughly 5 s edge limit, so the first visitor got `502 Site unavailable`
  (reproduced on the preview deployment: 5.07 s, then 200 in 0.16 s). The catalog fetch is
  now bounded at 2.5 s and falls back to the cached list with `catalogError` instead of
  failing the request.
- **Every outbound call is bounded.** Model-list calls, the Gemini native fallback, the
  quota lookup and the chat request now carry timeouts (15 s / 120 s), matching the
  desktop app, so a silent provider cannot hold a Worker open.
- 198 units, 27 CLI, 21 + 21 simulation, 27 cloud checks and the browser preview check pass.

## 2.8.2 — 2026-11-05

- **A bad URL is a client error, not a crash.** `GET /api/threads/%` and
  `POST /api/preview/%` used to throw `URIError: URI malformed` out of
  `decodeURIComponent` and answer 500. A shared `decodeId()` now answers 400 with a clear
  message; the cloud Worker has the same guard on `/api/threads/:id`.
- **HEAD works.** `HEAD /` answers 200 with the page headers instead of 404, so a monitor,
  a proxy or `curl -I` can check the app without downloading 222 KB. Node still sends no
  body for a HEAD response.
- **`/healthz` is read-only.** The cloud Worker answers 405 to a POST instead of 200, so a
  health check cannot double as a write probe.
- 198 units, 27 CLI, 21 + 21 simulation, 27 cloud checks and the browser preview check pass.

## 2.8.1 — 2026-11-05

- **The switch controls the prompt too.** Desktop and cloud now use the same
  instruction whenever tools are actually offered: use the available tools when they are
  more reliable than guessing, inspect files before describing or editing them, and never
  claim a call ran without its result. The prompt names the tools in that request.
- **No stale claim after a refusal.** The instruction is added to the outgoing payload, not
  the saved conversation. If a model rejects the tool parameter and the app retries once
  without tools, that retry carries no tool prompt either.
- **Cloud parity.** The cloud Worker adds the instruction only on the non-streaming path
  that can report tool calls; a normal streaming turn and a tools-off turn are unchanged.
  The page already routes a tools-on message through the tool loop and a tools-off message
  through streaming, and that split now has a page regression guard.
- **Settings say what happens.** Desktop lists the workspace/GitHub tools it can offer, and
  both editions state that the model is told to use them when the toggle is on. Cloud keeps
  its write approval unchanged.
- 198 units, 25 CLI, 21 + 21 simulation, 26 cloud checks and the browser preview check pass.

## 2.8.0 — 2026-11-05

- Added a shared preview diagnostics bridge. Script errors, resource-load failures and
  unhandled promise rejections now appear in a bounded problems card below the frame
  instead of leaving a silent blank page.
- The bridge is injected into both `srcdoc` previews and desktop loopback-server pages.
  The parent accepts messages only from the current frame, deduplicates them, caps the
  list, and renders every message with `textContent` rather than HTML.
- Remote http(s) previews stay cross-origin and expose no diagnostics; the page notes
  that limit instead of pretending it can inspect them.
- `lib/preview-bridge.mjs` is the single bridge source used by the pages and the server.
  The new `broken.html` browser fixture checks a thrown error and a missing image, and
  the problem card is cleared when another preview replaces it.
- 194 units, 25 CLI, 21+21 simulation, 24 cloud and the browser check pass.

## 2.7.2 — 2026-11-05

- Added `npm run test:ui`, a dependency-free Chrome DevTools Protocol test that starts a
  temporary Freeway instance and temporary workspace, then uses the real Files panel.
- It verifies that SCSS shows `BUILD_REQUIRED` with no visible empty frame, that Markdown
  restores the frame and renders a heading/table, and that a URL preview clears the stale
  build card. `CHROME_BIN` is the only requirement; a missing browser prints a clear skip.
- The test is separate from `npm test`; the normal unit and simulation suites keep their
  existing requirements. 192 units, 25 CLI, 21+21 simulation, 24 cloud and the browser
  check pass.

## 2.7.1 — 2026-11-05

- A preview that needs a build now hides the preview iframe instead of leaving a blank white
  panel above the `BUILD_REQUIRED` card. The frame starts hidden and is restored for Markdown,
  HTML and URL previews; a failed bundle hides it again.
- Loading a URL or another file after a build error clears the stale error card. The desktop
  URL path also resets frame visibility.
- Headless Chromium verification now passes with local Fontconfig: Files → Markdown renders
  headings, a table and code; SCSS shows `BUILD_REQUIRED` with `npx sass style.scss style.css`;
  the URL path restores the frame. Both page scripts still pass `node --check`.
- 192 units, 25 CLI, 21+21 simulation and 24 cloud checks pass.

## 2.7.0 — 2026-11-05

- Phase 3 adds a Markdown preview in both editions. Headings, lists, quotes, tables, links,
  images, bold/italic, inline code and fenced code render in a script-free sandboxed document.
  Raw HTML is escaped and `javascript:`/unsafe data URLs are dropped before links or images.
- Desktop previews `.md` from the editor, Save and model writes; cloud previews it on Save,
  Upload and account-file preview. Relative links and images are preserved but are not
  resolved by the browser workspace.
- TypeScript, JSX, SCSS/Sass, Less, Vue, Svelte and Astro are no longer mistaken for CSS or
  JavaScript. They show a `BUILD_REQUIRED` card instead of a broken page. HTML that links a
  `.scss` file, loads a `.tsx` script or declares `lang="scss"` gets the same card.
- The card reads `package.json` and detects Next.js, Nuxt, SvelteKit, Astro, Vite or Parcel,
  then names the project's dev/build command and output folder. Cloud explains that it cannot
  run npm/tsc/sass; desktop points to its dev-server URL or the emitted files.
- The app deliberately does not ship a partial TypeScript/JSX/SCSS compiler. Those need a real
  toolchain; a wrong transform is worse than an honest build instruction.
- `build/sync-preview.mjs` now uses a function replacer, so dollar sequences in the shared core
  are literal text. A page-boundary guard prevents the core from swallowing the document again.
- 191 units, 25 CLI, 21+21 simulation and 24 cloud checks pass.

## 2.6.0 — 2026-11-05

- Desktop HTML previews now load from a private loopback HTTP server instead of a
  `srcdoc` document, so relative ES modules, `fetch()` and absolute `/assets` paths work.
  The server binds `127.0.0.1`, exchanges a per-run 256-bit token for an HttpOnly,
  SameSite=Lax cookie, and serves only files inside the selected workspace.
- Directory indexes, nested entries and extensionless SPA routes work; SPA fallbacks
  inject a `<base>` so relative assets still resolve. JavaScript/module MIME types,
  8 MB assets, GET/HEAD only and `no-store` are enforced.
- Hidden paths, `node_modules`, outside symlinks and common secret file names are refused.
  A safe-looking symlink cannot expose a hidden target because the resolved path is checked
  too. Tests cover traversal, symlinks, token loss and directory redirects.
- The one shared static bundler remains the fallback for unsaved editor buffers, tunneled
  tabs and every cloud preview. The 2 MB static preview limit is unchanged.
- 185 units, 25 CLI, 21+21 simulation and 24 cloud checks pass.

## 2.5.0 — 2026-11-05

- One shared preview core (`shared/preview.js`) now drives desktop and cloud. It is inlined
  into both pages by `build/sync-preview.mjs`; the pages do not carry separate implementations.
- Static preview resolves relative paths and inlines linked stylesheets (including nested
  `@import`), classic scripts and SVG assets into one sandboxed document. Raster images and
  fonts are reported as external instead of silently breaking the page.
- Unsupported files now produce capability-aware errors instead of a blank frame: cloud says
  it cannot run Python/PHP/Go/etc., while desktop says the language needs a running server.
  CSS/JS without an HTML entry explain that a page is required; TypeScript/JSX explain that a
  compile step or dev server is needed.
- Auto-preview, Save and Upload use the same bundler. Writing a CSS/JS asset after the HTML
  refreshes the open preview, so a generated multi-file page appears assembled.
- Limits: 200 files and 2 MB per preview; relative ES-module graphs are rejected with a
  clear "needs a local server" error instead of rendering a broken page.
- 179 units, 24 CLI, 21+21 simulation and 24 cloud checks pass.

## 2.4.6 — 2026-11-05

- A model that writes or patches an `.html`, `.htm` or `.svg` file now opens its sandboxed
  preview immediately. The streamed tool event carries the written path, the page reads that
  file from the workspace and switches the rail to Preview, so no extra "make a preview"
  message is needed.
- Saving an HTML file from the desktop editor previews it too, and opens the rail if hidden.
- The cloud Files panel previews HTML/SVG on Save and on Upload; the sample page already did.
- New guard test requires the desktop path event and the cloud upload preview.
- 172 units, 24 CLI, 21+21 simulation and 24 cloud checks pass.

## 2.4.5 — 2026-11-05

- The key dialog's keyless button now reads "Use OVHcloud instead — no key". A note says the
  selected provider needs a key, the button switches to OVHcloud, and Cancel keeps the
  provider selected. The cloud page previously said "Try it now — no key", which looked like
  a keyless mode for Z.AI and other keyed providers.
- Both editions build the label and note from the anonymous provider, so a future keyless
  provider is named correctly instead of a hard-coded one.
- The page test rejects the vague label and requires the switch explanation.
- 171 units, 24 CLI, 21+21 simulation and 24 cloud checks pass.

## 2.4.4 — 2026-11-05

- The Windows workflow now launches `Freeway.exe` on `windows-latest`, reads
  `/api/config`, checks the served page and stops the process; `--version` alone
  never proved the executable starts.
- `fetchAsText` accepts an injected fetch so a regression test can prove a public URL
  redirecting to loopback or link-local is refused before the second request.
- The test also covers an initial private URL making no request and redirect loops
  staying bounded; the production call path is unchanged.
- 171 units, 24 CLI, 21+21 simulation and 24 cloud checks pass.

## 2.4.3 — 2026-11-05

- `fetch_url` follows redirects manually, checks every hop, rejects private/loopback,
  IPv4-mapped and DNS-private destinations, and caps the response body before decoding.
- Tool calls are capped before the assistant message is stored; every stored call has a
  matching tool result, including calls recovered from text.
- `threads.json` updates clone the changed thread and only replace the cache after the
  atomic rename succeeds; a failed save no longer appears successful in memory.
- Creating a chat with an existing id is refused instead of producing duplicate ids.
- Saving a config now chmods an existing file to 0600, not only a newly created one.
- The source ZIP excludes `.env*`, `config.json`, `threads.json`, `secrets.json` and
  temporary/log files; the Windows launcher propagates a non-zero exit.
- Removed an unused cloud Worker cache variable and a redundant Windows packaging copy.
- 170 units, 24 CLI, 21+21 simulation and 24 cloud checks pass.

## 2.4.2 — 2026-11-05

**Windows CI now builds the same bundle as Linux and can test the executable.**

- `build/bundle.mjs` normalizes CRLF before its import stripping and `pageHtml()`
  terminator search, so a Windows checkout no longer fails with
  `end of pageHtml() not found`.
- Windows unit tests now accept PATH-resolved executables (`echo.exe`), use a real
  outside temporary directory for the symlink escape, and skip the POSIX `0600`
  assertion where NTFS does not expose those bits. Behavior assertions are unchanged.
- 169 units, 24 CLI, 21+21 simulation and 24 cloud checks pass.
- The tag workflow builds and smoke-tests `Freeway-2.4.2-windows.zip` on
  `windows-latest` and attaches it to the release. No app runtime behavior change.
- 2.4.2 desktop; 2.4.2-cloud on production and preview; URLs unchanged.

## 2.4.1 — 2026-11-04

**Node 22 CI now finds the unit tests.**

- Node 22 treats `node --test lib` as a missing module, so the first 2.4.0 Linux CI
  run failed before any test ran. The unit suites now receive the individual test files:
  `test.yml`, `release.sh`, `npm test` and `AGENTS.md` use `lib/*.test.mjs`; the Windows
  workflow uses PowerShell discovery because that shell does not expand the glob.
- No runtime behavior changes: 2.4.1 carries the same same-provider retries as 2.4.0.
- 169 units, 24 CLI, 21+21 simulation and 24 cloud checks pass on Node 22; the release
  script also passes them on Node 26.
- 2.4.1 desktop; 2.4.1-cloud on production and preview; URLs unchanged.

## 2.4.0 — 2026-11-04

**Cloud turns retry another free model inside the selected provider.**

- The Worker now builds a same-provider chain capped at three models. OpenRouter uses
  its live free catalog; allowlist providers use their seeded fallbacks or `/models`.
- Retries happen only before streaming starts and only for network errors, `404`, `429`
  and `5xx`. `400`, `401`, `402` and `403` stop immediately. Image and tool turns stay
  on the selected model.
- A successful retry reports `retriedFrom`; the page shows `retried from <model>`.
- Added `.github/workflows/test.yml`: all five suites on every push to `main` and pull
  request, after rebuilding both bundles.
- Live smoke: local, production and preview keyless OVHcloud passed. Keyed paths were
  skipped because no keys were configured. Signed-in files remain pending, and the
  Windows archive was rebuilt but could not be launched from the Linux VM.
- 169 units, 24 CLI, 21+21 simulation and 24 cloud checks pass.
- 2.4.0 desktop; 2.4.0-cloud on production and preview; URLs unchanged.

## 2.3.5 — 2026-11-04

**Freeway is the project name everywhere.**

- The source tree is now `freeway/`; release, push, E2E and documentation paths follow it.
- The GitHub repository is now `zakker111/freeway`, with its description updated to match
  strict provider selection. The local folder, repository and product name agree.
- The OpenRouter provider, its API endpoints and its environment variables keep their names;
  they name a provider, not this project. Historical changelog entries and the pre-2.0
  `OpenRouterChat` data-folder migration are retained so existing installs keep their settings.
- 2.3.5 desktop; 2.3.5-cloud on production and preview; source, GitHub-source and Windows
  archives rebuilt.

## 2.3.4 — 2026-11-04

**The provider you choose is the only provider used.**

- A failed, rate-limited or unavailable turn no longer hands the conversation to another
  provider. The desktop app and the cloud Worker now contact only the selected provider;
  changing provider is a user action.
- Same-provider model retries are unchanged: OpenRouter can still use its `models` array and
  the app can retry another free model within the chosen provider.
- New regression coverage covers a keyed OpenRouter failure with a usable Groq key in both
  editions; it fails if Groq is called. The retry log replaces the old fallback-log label.
- 169 units, 24 CLI, 21+21 simulation and 20 cloud checks pass.
- 2.3.4 desktop; 2.3.4-cloud on production and preview; source, GitHub-source and Windows
  archives rebuilt.

## 2.3.3 — 2026-11-04

**A keyless turn stays on the keyless provider.**

- If OVHcloud is the chosen provider, a rate-limited or failed turn no longer falls back to a
  keyed provider. The provider label and the answer always agree; the user sees OVHcloud's own
  limit instead of a silent switch.
- The desktop fallback order treats an anonymous provider as terminal, and the cloud Worker
  builds no cross-provider attempts when the primary is anonymous.
- New unit coverage for `fallbackOrder('ovh', …)` and a cloud check where OVHcloud is
  rate-limited while OpenRouter has a deployment key; both fail if the turn moves.
- 169 units, 24 CLI, 21+21 simulation and 19 cloud checks pass. Browser and real D1/R2 suites
  were last green on 2.3.2 and are unchanged by this server-side fix.
- 2.3.3 desktop; 2.3.3-cloud on production and preview; source, GitHub-source and Windows
  archives rebuilt.

## 2.3.2 — 2026-11-04

**A sample page in Files, and a cloud shell that cannot stay stale.**

- Files → **Sample** writes `sample/index.html` and `sample/style.css` into the
  workspace and opens the result in Preview. Desktop reads both files from disk and
  previews them with relative CSS inlined; the cloud writes the same two files into the
  browser workspace. The preview remains sandboxed, with no same-origin access.
- Removed the remaining desktop-only `pins` lookup from the cloud `saveThread()` path.
  The page test now isolates individual functions and rejects pin references in both
  `renderFiles()` and `saveThread()`.
- Replaced the cache-first cloud shell with a network-first `freeway-shell-v3` service
  worker: navigations refresh from the network, `/api`, auth and `sw.js` are never cached,
  old shells are deleted, and registration checks updates with `updateViaCache: 'none'`.
- Fixed the desktop local preview so workspace HTML is rendered as `srcdoc`; relative
  stylesheets are inlined, and the frame keeps `allow-scripts allow-forms allow-popups`
  without `allow-same-origin`.
- 168 units, 24 CLI, 21+21 simulation, 18 cloud, 14 browser and 10 real D1/R2 checks
  pass, plus a live production smoke check. The Windows 2.3.2 executable was cross-built
  with Node SEA but cannot be launched on this Linux VM.
- 2.3.2 desktop, GitHub-source and Windows archives; 2.3.2-cloud on production and preview. URLs unchanged.

## 2.3.1 — 2026-11-04

**Release audit: links, files and artifacts.**

- Checked the public production and preview pages, the local desktop page, all provider
  console links, and the source/archive links. The private GitHub repository correctly
  returns 404 when signed out; the owner can open it while signed in.
- Fixed the README's stale 2.2.2 download/tag/self-check text and added Z.AI and Cloudflare
  Workers AI to the opening provider list.
- Rebuilt the normal, GitHub-source and Windows executable archives and verified every ZIP
  and checksum. No provider behavior changed in this refresh.
- 166 units, 24 CLI, 21+21 simulation, 18 cloud, 13 browser and 10 real D1/R2 checks pass.

## 2.3.0 — 2026-11-04

**Two more free hosts, in both editions.**

- **Z.AI** joins as a one-key, one-model provider: only `glm-4.7-flash` is admitted, on its
  standing free tier. No paid model or credit balance is reachable through it.
- **Cloudflare Workers AI** joins with its free daily Neuron allowance. It is the first
  provider that needs two credentials: an API token and the 32-character Account ID used in
  its API URL. The desktop stores the account beside the key in config; the cloud edition
  keeps it in the tab's `sessionStorage` and sends it as `x-provider-account`; deployments may
  instead set `CLOUDFLARE_ACCOUNT_ID`.
- Both editions share the same ten hosted providers. A key without its account, or an
  account without its key, is rejected with a clear message before any upstream request.
- Browser and Worker tests cover the account fields, provider parity and both missing-credential
  responses. All suites, archives, production and preview are refreshed for 2.3.0.

## 2.2.2 — 2026-11-04

**The Health panel fits its rail.**

- All five rail tabs stay on one line at the normal 330 px desktop width; the close
  button is pinned right, and “Secrets” and “Preview” are no longer ellipsized.
- Cloud Health rows now put the provider or model name above its status and limit text.
  Long names such as “Gemini (AI Studio)” and “OVHcloud (no key)” no longer truncate to
  make room for the key/plan string on the same line.
- The page test now guards `flex-wrap: nowrap` and shrinkable rail tabs, so the Health tab
  cannot silently fall onto its own row again.
- 163 units, 24 CLI, 21+21 simulation, 17 cloud, 13 browser and 10 real D1/R2 checks.

## 2.2.1 — 2026-11-04

**The Files list survives an upload.**

- Uploading a browser file repainted the cloud Files list through a row builder that
  referenced `pins`, a desktop chat-pin variable that does not exist in this page. The
  upload itself succeeded, but the repaint threw and the list could stop updating. The
  cloud file rows no longer touch the desktop pin code; the chat-history pin code is
  unchanged.
- `lib/pages.test.mjs` now isolates `renderFiles()` and fails if it references chat pins
  again, so this cannot return silently.
- Found by a real-browser Playwright run of the cloud page under its production CSP:
  13/13 checks pass, including upload, download, IndexedDB reload, sandboxed HTML preview,
  account upload/save/delete, remote-preview fallback and workspace writes.
- 161 units, 24 CLI, 21+21 simulation, 17 cloud and 10 real D1/R2 checks remain green.

## 2.2.0 — 2026-11-04

**Files that leave the tab.**

- The cloud Files panel can upload text/HTML/SVG, download the editor, and preview `.html`,
  `.htm` or `.svg` in a sandboxed `srcdoc` iframe. The sandbox deliberately omits
  `allow-same-origin`, so an uploaded page cannot read the session or call this site's API.
- The browser workspace moved from one localStorage string to IndexedDB; an existing
  `orc.files` map is copied forward once. Uploads are capped at 400 KB there.
- Signed in, **Account files** stores text in R2 (`FILES` binding) with a D1 listing, scoped by
  the session subject: 1 MB per file, 40 files and 8 MB per account. List, open, save, delete,
  download and preview are all in the panel. Writes require a same-origin request.
- Remote URL preview now says that many sites refuse embedding and offers an open-in-new-tab
  link, instead of leaving a blank frame unexplained.
- The Worker creates tables before indexes and tracks schema readiness per database binding,
  which also makes the file API testable against a fresh database.
- Cloud suite grows from 14 to 17 checks, including per-account isolation, traversal, binary
  rejection and foreign-origin refusal.

## 2.1.1 — 2026-11-04

**Release refresh.** No behaviour change: the single file, the `.exe` and all three archives
were rebuilt at 2.1.1, both cloud environments redeployed, and `CURRENT-LINK.txt` rewritten so
the public links and checksums match the files. The 2.1.0 keyless first run is unchanged.

## 2.1.0 — 2026-11-04

**A first run that does not begin with a key.**

- Both key dialogs now offer **Try OVHcloud — no key** whenever an `anonymous` provider is
  configured. One click selects it, loads its free models and drops into the composer; no
  account, card or key is involved. The provider choice is saved, the demo budget stays
  visible in the plan limits before the first send.
- The button hides itself when the active provider is already keyless, so the dialog never
  offers a no-op.
- Desktop: the file-attachment listener moved out of `start()`. That function runs again
  after a key is saved, so each save used to register another listener and attach the same
  file twice.
- Version 2.1.0 on the desktop app, both cloud environments and all three archives.

## 2.0.1 — 2026-11-04

**Publish-readiness pass.**

- `cloud/package-lock.json` now identifies as `freeway-cloud` 2.0.1. It still said
  `cloud@1.0.0`, so a clean `npm ci` started from a package that did not match
  `cloud/package.json`.
- `release.sh` bumps the cloud package and its lockfile alongside `app.mjs`,
  `package.json` and `cloud/worker.mjs`, so the next release cannot drift again.
- `.gitignore` covers `Freeway.exe` and the generated single-file bundles. It still
  ignored `OpenRouterChat.exe`, which risked committing a 96 MB binary.
- README: the config-folder bullet is readable, the key table names all eight hosted
  providers (OVHcloud is keyless), the file table lists every module in `lib/`, and the
  `.exe` and tag examples say 2.0.1.
- AGENTS.md and RELEASING.md say five suites, because the cloud suite has been part of
  every release since 1.14.
- No runtime behaviour changed: the 2.0.0 suites remain the regression baseline.

## 2.0.0 — 2026-11-04

**The app is now Freeway.**

- The name was describing one provider while the product supported eight hosted
  providers plus local Ollama. Freeway is the product; OpenRouter remains one
  provider inside it.
- Renamed everywhere visible: window title, header mark, PWA manifest and icons,
  transcript headings, export filenames, Windows executable, single-file bundles,
  archives and documentation.
- Existing data is preserved. The first 2.0 run copies an `OpenRouterChat` config
  folder to `Freeway`; if that copy fails, the old folder stays in use. Browser
  storage keys intentionally remain `orc.*`, so saved chats and settings survive.
- Older chat JSON exports remain importable; new exports identify as `freeway`.
- New artifacts: `freeway.mjs`, `freeway.cjs`, `Freeway.exe`, and
  `Freeway-2.0.0*.zip`. Production and preview URLs are unchanged.
- No model, provider, image, retry, tool or cloud behaviour changed. The 1.60.0
  suites remain the regression baseline.

## 1.60.0 — 2026-11-04

**See an image, and know exactly when a limit lifts.**

- Both composers accept one PNG, JPEG or WebP image per turn. The browser resizes it to at
  most 320 KB before sending; the desktop and cloud validate the same data-URL shape, so a
  hand-written request cannot smuggle a remote URL, a GIF, or a multi-megabyte payload.
- Image turns are offered only to OpenRouter free models whose live catalog advertises image
  input. Picking a text-only model, or switching to another provider, returns an actionable
  400 instead of silently dropping the picture. Attaching an image in either page switches
  to the first free vision model when necessary.
- Images survive compaction, local storage, D1 thread saves, branch, reopen and rendering.
  Only the two newest pictures are resent upstream; older previews stay visible in the chat.
- OpenAI/OpenRouter `image_url` content parts are built in one shared helper and covered by
  unit tests plus a cloud test that proves a vision model receives the picture and a
  text-only model is never called with it.
- Phase 2's retry contract ships in the same release: provider `Retry-After` is forwarded
  exactly, visitor budgets reset at UTC midnight, and both Health panels show the real
  cooldown plus each provider's published request limits.
- 159 units, 24 CLI, 21+21 simulation, 14 cloud checks.

## 1.51.1 — 2026-11-04

**Copy caught up with the provider table.**

- The cloud notice, PWA description, README and `CURRENT-LINK.txt` still said "six
  providers"; both editions ship eight hosted providers, and the desktop adds Ollama.
- The README's cloud paragraph now lists `AION_API_KEY` and says OVHcloud needs no key, and
  the cloud notice no longer claims the browser has no files panel.
- The degraded-state provider fallback in both pages carries `limitLines`, so a failed
  `/api/providers` cannot render an empty "What this plan allows" list.
- 137 units, 24 CLI, 19+19 simulation, 11 cloud checks.

## 1.51.0 — 2026-11-04

**The plan labels now carry their numbers.**

- Every provider declares `limits` — requests per minute, day or month, and tokens per day —
  and `limitLines()` turns them into short lines. Providers that publish no fixed number
  (Gemini, Mistral) say so instead of borrowing another provider's cap; OVHcloud's demo and
  local Ollama are named as such.
- Desktop: the key dialog lists what the plan allows, and the Status panel gains a **Free
  plans** section with each provider's plan label and caps.
- Cloud: the key dialog and Status panel show the same list, fed by `providerList()`.
- `limitLines` is in `publicView` and the Worker's config, and the drift test compares the
  lists between editions, so one number cannot differ between Windows and the web.
- 137 units, 24 CLI, 19+19 simulation, 11 cloud checks.

## 1.50.0 — 2026-11-04

**No surface says "free tier" any more.**

- Provider notes in both editions open with `Free plan:` and keep their numbers; those notes
  are what the picker tooltip and the key dialog show.
- Desktop: the policy tooltip names the plan, the key dialog says "the free plan needs no
  card", and the quota pill reads `Groq · free · daily quota` instead of `Groq · free tier`.
- Cloud: the badge beside the model picker carries the plan label, and the model count reads
  `10 free models`.
- A unit test fails if any provider note says "free tier" again; the cloud drift check holds
  the Worker's notes to the same rule.
- 136 units, 24 CLI, 19+19 simulation, 11 cloud checks.

## 1.49.0 — 2026-11-04

**"Free" now says which kind of free.**

- `freePlanLabel()` turns the machine field into words — `free · always`, `free · daily quota`,
  `free · monthly quota`, `free · no key`, `free · local` — and `publicView` and the Worker's
  `providerList` carry it as `planLabel`.
- The desktop provider picker reads `Groq — free · daily quota`, and still appends `· add key`
  when a hosted provider has none. The policy pill next to the model picker shows the same
  wording and keeps the provider's note as its tooltip.
- The cloud picker names the plan in each option, so a visitor can see that OVHcloud needs no key
  and that Cohere's allowance is monthly rather than daily.
- An unknown plan value renders as the neutral `free plan`; it never implies an unlimited tier.
- A test pins all five labels, checks every provider's `publicView` agrees with its `freePlan`,
  and the cloud drift check now compares wording as well as plan and id.
- 135 units, 24 CLI, 19+19 simulation, 11 cloud checks.

## 1.48.0 — 2026-11-04

**A provider with no account: OVHcloud's public endpoint, and the code to keep it honest.**

- `ovh` joins both tables at `https://oai.endpoints.kepler.ai.cloud.ovh.net/v1`. It needs no
  key, no signup and no card: the endpoint answered a keyless chat request with HTTP 200 while
  this release was built. Free plan: `anonymous`, 2 requests a minute per model.
- The allowlist keeps the roster to chat models — Llama 3.3, Mistral Nemo and Small, the Qwen 3.x
  family, gpt-oss — while embeddings, guard, TTS, Whisper and diffusion ids are denied.
- `headersFor` and the Worker's request builder now omit `authorization` entirely for an
  anonymous provider, instead of sending a malformed `Bearer ` header.
- Keyless means no shared secret to fence: the origin fence and per-visitor budget apply only to
  `source: 'server'`, so an anonymous turn cannot spend the owner's quota because there is none.
- Anonymous providers stay out of automatic fallback. Two requests a minute is a demo budget,
  and a silent chain would burn it where nobody can see.
- The page says "no key needed" and never opens the paste-a-key dialog for OVHcloud.
- 134 units, 24 CLI, 19+19 simulation, 9 cloud checks.

## 1.47.0 — 2026-11-04

**Aion Labs is provider number eight, and "is it free?" is now a field instead of an argument.**

- `aionlabs` joins the table: `https://api.aionlabs.ai/v1`, allowlist `/^aion-labs\//i`, image,
  video, embed, TTS and audio ids denied. Free tier is 15 requests/min and 20,000 tokens a day,
  no card — a standing tier, not a credit.
- Every provider now declares `freePlan` (`standing-tier`, `daily-quota`, `monthly-quota`,
  `anonymous`, `local`), and a test fails if the field is missing or ever says trial or credit.
  That is the rule from `AGENTS.md` made mechanical.
- `publicView` and the cloud `providerList` expose the plan, so a page can say why a provider is
  free without hard-coding the reason twice.
- A paid-plan refusal from upstream (HTTP 402) is now `no_free_plan` with a plain sentence —
  never a generic "no credits", and never a silent retry.
- The `PROVIDERS` tables in `lib/providers.mjs` and the Worker are compared in `cloud/test.mjs`:
  same ids, same free plans, so a provider can no longer ship to one edition only.
- Deliberately absent, now written down in the provider header: Model Studio (90-day quota then
  billed), ModelScope (phone-verified signup), and the card-gated credit services.
- 133 units (was 131), 24 CLI, 19+19 simulation, 9 cloud checks.

## 1.46.0 — 2026-11-04

**The two editions now share one shell.** The cloud page had its chats in a centred dialog while
Windows kept a panel down the left side; the same app therefore looked different depending on
where you opened it.

- The cloud edition gains the desktop's chats panel: search, +, ×, the list with pin and delete,
  and a chat count in the footer, docked down the left edge at 268 px.
- Same rule at both sizes as the desktop: a docked column above 900 px, an off-canvas drawer with
  a backdrop below it, and the preference remembered in `localStorage`.
- The header's **Chats** button and the settings shortcut now open the panel; Alt+H toggles it;
  the palette's "Your chats" row opens it; opening a chat closes the drawer but leaves a docked
  column alone.
- The old `historyDialog` is gone rather than left unused, so there is one way to reach a chat.
- `lib/pages.test.mjs` now asserts both pages ship the same panel ids, anchored to the left edge
  and before the app column, and that the cloud page has no chats dialog.
- 131 units (was 128), 24 CLI, 19+19 simulation, 7 cloud checks.

## 1.45.0 — 2026-11-04

**A visitor can see the shared-key budget instead of meeting it as an error.** 1.44.0 made the
deployment key expensive to abuse; this release makes the rule legible before a turn is refused.

- New `GET /api/budget` reports `{active, limit, used, remaining, day}` for the calling address:
  private and no-store, and it never spends a turn — reading it twice leaves the count alone.
  On a deployment with no key it answers `active: false` rather than 401.
- `budgetRow()` is now shared by the report and by `takeBudget`, so the number shown and the
  number enforced cannot drift.
- The Status panel's **Shared key** row reads `yes · 1024 tokens/turn · N of 40 turns left
  today`, refreshed at boot, when the panel opens, and after every answer.
- `cloud/test.mjs` grew to 7 checks: the report is accurate before and after a turn, a second
  read spends nothing, the deployment key never appears in it, and a keyless deployment reports
  an inactive budget.
- 128 units, 24 CLI and 19+19 simulation checks unchanged.

## 1.44.0 — 2026-11-04

**A deployment key is fenced, budgeted and capped.** The owner's key in Sites → Secrets is what
lets the site answer without a visitor pasting one, and it is also the only way a stranger can
spend the owner's free quota. Turns that spend it are now the guarded ones; a visitor's own key
is left alone.

- `/api/chat` refuses a deployment-key turn whose `Origin` is another site (403
  `foreign_origin`). Checked only when `APP_ORIGIN` is set, so the local harness still runs.
- A per-visitor daily budget in D1 (the new `budget` table, UTC day + `cf-connecting-ip`): 40
  turns by default, overridable with `VISITOR_DAILY_LIMIT`. Past the line the reply is a 429
  `visitor_budget` that points the visitor at their own key. A missing database or IP allows
  the turn, because neither is the visitor's fault.
- `max_tokens` on a shared-key turn is capped at 1024 whatever the page asks for.
- `/api/config` reports `guard {deploymentKey, perVisitorPerDay, turnTokens, originFence}` and
  the cloud Status panel shows a **Shared key** row, so the rules are visible before they bite.
- `cloud/test.mjs` is new: 5 checks that run the real Worker against a mock upstream and a
  `node:sqlite` D1 — the config guard, a foreign origin, the 1024 cap with no key in the reply,
  the budget with an unaffected neighbour, and a browser-key turn that is neither fenced nor
  budgeted. 128 units, 24 CLI and 19+19 simulation checks unchanged.

Two faults the new test found and this release fixes: the model catalog ignored
`OPENROUTER_BASE_URL` (a local harness read the live catalog), and the isolate cached one auth
app per client id, so a second `env` inherited the first one's key and database.

## 1.43.2 — 2026-11-04

**The closed-tab rescue is enforced by the suite**, not by a probe someone has to remember to
run.

- `test/simulate.mjs` gained a `slow` upstream mode: one delta, a 700 ms pause, then the rest.
  The new check hangs up on that first delta, waits for the teardown, and asserts the chat
  exists with the question and the partial answer.
- 19 simulation checks (was 18), on both `app.mjs` and the single-file build; 128 units and 24
  CLI checks unchanged.
- No application code changed: this release makes 1.43.1's behaviour regression-proof.

## 1.43.1 — 2026-11-04

**A closed tab no longer eats the answer.** When the connection is already gone — tab closed,
phone asleep, network dropped — the app creates the chat itself instead of waiting for a save
that will never arrive.

- `POST /api/chat` already kept a *draft* for a chat that existed. A brand-new chat had no
  thread to attach it to, so a first answer that landed after the tab died was lost.
- The stream's teardown now stores a thread for that id when none exists yet: the messages
  that were sent plus the text that arrived, with its model and usage.
- Only when the client is gone, so a live tab's own save still wins and a finished turn cannot
  raise a stale-revision question.
- Verified against a mock upstream that pauses between chunks: aborting on the first delta
  leaves a chat holding the partial answer at `rev 1`, while a completed turn with a live
  client still saves nothing by itself (`404`), which is the intended division of labour.
- Not covered by an automated test: the timing needs a deliberately slow upstream, so this is
  probe-verified rather than in the suite.

## 1.43.0 — 2026-11-04

**Chat housekeeping without the mouse.** Ctrl+K now carries **Rename this chat…** and
**Delete this chat…** in both editions, next to **Pin or unpin this chat**.

- A renamed chat keeps its name. The desktop stores `customTitle` and saves it as the thread
  title; the cloud ties its override to the chat id, so a new chat cannot inherit it. A saved
  title that no longer matches the first message is read back as deliberate, which means
  chats renamed today reopen correctly with no schema change and older chats are unaffected.
- Delete uses the existing confirmed delete path and clears the title override first, so the
  next chat starts with a fresh name.
- Both palette rows report the outcome: the desktop in its status line, the cloud in its
  banner. The desktop's debounced save still sends `ifRev`, so renaming from a stale tab goes
  through the same conflict question as editing a message there.
- Tests: 124 units, CLI 24/24, simulation 18/18 on `app.mjs` and on the single-file bundle;
  the page test still enforces one definition per function name and no dangling element ids.

## 1.42.1 — 2026-11-04

- **Fixed: pinning a chat in the cloud edition pinned a model instead.** The cloud page declared
  `togglePin` twice — once for chats, once for the model picker. The second declaration wins in
  JavaScript, so the ☆ on a chat row wrote a model id into the model-pin list, repainted the model
  picker and left the chat list untouched. The model version is now `toggleModelPin`, and the chat
  pin behaves as labelled: it toggles 📌 on the row and survives a reload.
- **New guard so it cannot come back quietly:** `lib/pages.test.mjs` checks both pages for
  duplicate top-level function names, `$("id")` lookups that point at no element, and chat/model
  pins sharing one storage key. A second declaration is invisible to the browser and to
  `node --check`, so only a test like this catches it.
- Nothing else changed: the audit found no dead functions, no dangling element ids, no unescaped
  titles (rows are built with `textContent`), and SQL stays parameterised with `ESCAPE '\\'`.

## 1.42.0 — 2026-11-04

- **Ctrl+K now switches chats, not only commands.** Each saved chat appears as **Open chat: …**
  above the provider entries, so `Ctrl+K`, a few letters of the title and `Enter` opens a
  conversation without touching the sidebar or the chat list dialog. Both editions.
- The switcher reads the list the page already loaded, so it costs no request: the desktop uses
  `state.threads` from `/api/threads`, the cloud uses its browser copy (which search has just
  hydrated with account hits). The newest 50 are offered — past that, the search box is the better
  tool, and the palette filter matches the title anyway.
- Nothing else in the palette moved: commands, providers and their shortcut hints render exactly
  as before, and the list still walks with ↑/↓ and closes on Esc.

## 1.41.0 — 2026-11-04

- **A cloud search now reaches the whole account, not just this browser.** `/api/threads?q=` filters
  the signed-in user's own rows on `lower(title)` and `lower(messages)`, so a chat older than the
  page's 200-chat copy still turns up. Results are merged into the local copy, which means an old
  hit opens, exports and pins exactly like a fresh one.
- **Wildcards are escaped.** SQLite treats `%` and `_` as wildcards, so searching `50%` would have
  matched every chat. `likePattern()` escapes `\`, `%` and `_` and the query declares `ESCAPE '\'`;
  it is exported so the escaping is checked outside the Worker.
- The search box behaves the same signed out (local only) and signed in (local first, then the
  account after a 250 ms pause), and a failed request leaves the local results on screen.

## 1.40.0 — 2026-11-04

- **Search looks inside the conversation, not only at the title.** The desktop sidebar filtered
  titles locally and never used the server's search, so a word that appeared only in an answer was
  invisible. Typing now filters titles instantly and, after a 250 ms pause, asks
  `/api/threads?q=` for message-text matches and merges them into the same list.
- **The cloud chats dialog has a search box again — for the first time.** It filters the title and
  every message, in the browser, over all 200 chats the page holds, with a count badge that still
  reports the full history and a "No chat matches that search." state instead of the new-chat hint.
- Search is case-insensitive and matches substrings, so a partial word is enough; the desktop store
  already indexed message text server-side, this release is what finally uses it.
- Unit test added: `list('kubernetes')` finds a chat whose title says "Unrelated title" but whose
  body mentions the word, and is case-insensitive.

## 1.39.0 — 2026-11-04

- **The cloud edition can hand its chats to the desktop app.** Settings → **Export chats (.json)**
  downloads every saved chat in the exact shape the desktop's existing **Import…** writes and
  reads, so the desktop left panel shows chats that started on the site — no key, no account, no
  conversion step.
- **Ids are made desktop-safe and stable.** The export keeps an id the desktop's pattern accepts
  and derives one deterministically otherwise, so importing the same file twice updates the same
  chats instead of leaving a second copy beside each one.
- The command palette gained **Export all chats for the desktop app**, and the banner tells you
  where the file goes next.
- Deliberately not automatic: the site and the app still keep separate stores, because pulling a
  local file needs no credentials and cannot leak an account. Nothing leaves either side until you
  click export or import.

## 1.38.0 — 2026-11-04

- **The cloud edition stopped at 30 chats.** Saving the 31st silently deleted the oldest, and the
  list only ever asked for 30. Retention and the listing ceiling are now **200 per account**, and
  the list query is bounded by that same constant instead of a second hard-coded number, so the
  server can no longer prune a chat it still advertises.
- **The cloud chats list threw before it drew anything.** `renderHistory()` used `pins` and a `pin`
  button without ever defining either, so opening the list raised `ReferenceError: pins is not
  defined` and the dialog stayed empty — exactly the "where are my chats" symptom. Both are now
  defined: every row gets the ☆/📌 pin toggle the desktop panel already had, and pinned chats show
  their marker in the title.
- **The browser copy holds the same history.** The merge after sign-in used `.slice(0, 30)`; it now
  keeps 200, matching the server, so a reload no longer hides older chats that still exist.
- Desktop is unchanged: it already listed every saved chat, with no cap on either side.

## 1.37.0 — 2026-11-04

- **The saved-chats panel is there from the start.** It stays docked on the left in wide windows
  and no longer collapses itself when you open a chat or start a new one; that behaviour was making
  the list vanish right after you used it.
- **It can be toggled at any width.** The ☰ button used to be hidden above 900 px, so a wide window
  had no way to bring the list back. It is always visible now, there is an × in the panel header to
  hide it, and the choice is remembered (`openrouter.sidebar`). Narrow windows still get the drawer
  with a backdrop, which now also remembers whether you left it open.
- The command palette gained **Show or hide the chats panel**, so no mouse is needed.

## 1.36.0 — 2026-11-04

- **Ollama is a provider now, desktop only.** `ollama serve` on this machine appears in the provider
  switcher as **Ollama (local)**; its installed models come from `GET /v1/models` and chat goes to
  the same OpenAI-compatible endpoint. No key, no account, nothing leaves the machine.
- **It is free by definition**, so it sits outside the pricing gate and the allowlist entirely: a
  local id can never be a paid id. It is also deliberately outside the cross-provider fallback — a
  local model id means nothing to a hosted API, and a stopped daemon is not someone else's turn.
- The switcher probes the daemon (800 ms, cached 5 s) and labels the entry **— not running** when it
  is off, so a dead daemon cannot look like a rejected key. The policy pill reads `local · free`.
- The cloud edition cannot offer this: a Worker cannot reach `127.0.0.1`. It keeps the six hosted
  providers, and the two editions are otherwise unchanged and identical.

## 1.35.1 — 2026-11-04

- **Paid mode is not happening.** The roadmap listed "optional paid-model mode, clearly labelled and
  off by default", but that contradicts the rule the whole app is built on — a priced model id is
  never sent. The owner chose free-only, so the item is marked rejected in `TODO.md` and invariant 1
  in `AGENTS.md` now says so in as many words, to stop it being reintroduced by accident.
- No code changed; the cloud build only carries the new version stamp.

## 1.35.0 — 2026-11-04

- **The cloud Status panel is now a per-model status page**: alongside requests, failures, tokens
  and the free quota, each model that answered gets a row with its answer count, the last latency
  and the average, so a slow model is visible before the next send.
- The desktop rail already reported answering models, latency and cooldowns; this is the same idea
  in the edition that had only totals.

## 1.34.0 — 2026-11-04

- **The desktop model picker caught up with the cloud one.** It now groups results into Pinned,
  Recent and All free models, puts a `☆`/`★` on every row, remembers the last eight models you
  chose, and walks the list with ↑/↓ and Enter while the search box keeps the focus.
- Pins and recents are per-browser view state (`openrouter.modelPins`, `openrouter.modelRecents`),
  the same design as chat pins, and the search + filters still apply inside every group.

## 1.33.0 — 2026-11-04

- **Every answer says what it cost.** The Worker now asks OpenRouter for `usage.cost`, so each
  reply's meta reads `free` for a free model or `$0.000123` if anything was ever charged — the
  desktop app answers the same way, and falls back to `free` for `:free` model ids when a provider
  sends no cost.
- **Pin a chat.** A `☆` on each saved chat pins it (`📌`, pinned chats sort above recent ones,
  another click unpins). Pins live in the browser (`localStorage`) in both editions, so they do not
  travel with an account-backed chat; that is deliberate, since pinning is a view preference.
- The command palette gained **Pin or unpin this chat**, so a pin needs no mouse.

## 1.32.1 — 2026-11-04

- The footer hint in both editions still advertised `Ctrl+K models`; it now reads
  `Ctrl+K commands · Ctrl+M models`, matching the shortcut that actually does each thing.

## 1.32.0 — 2026-11-04

- **Ctrl+K is a command palette** in both editions: filter by typing, arrow keys move, Enter runs,
  Esc closes. It lists new chat, the model picker, Settings, provider key, prompts, export, every
  rail panel (cloud), Files/secrets (desktop) and one entry per provider.
- The model picker keeps a shortcut of its own on **Ctrl+M**, so nothing that used to be one
  keystroke away needs a mouse.
- Same wording and the same dark styling in both editions.

## 1.31.1 — 2026-11-04

- **The quota meter no longer needs a deployment key.** `/api/quota` reads the visitor's pasted
  OpenRouter key when the deployment has none, sent as `x-provider-key` for that call only, so the
  header pill and the Status panel show real numbers in the plain browser-key setup too.
- Both live environments have no server key, so before this they always fell back to the free
  model count.

## 1.31.0 — 2026-11-04

- **The quota pill tells the truth.** `GET /api/quota` reads OpenRouter's per-key usage (numbers
  only, never the key) and the header shows how many free requests are left today, refreshed at
  most once a minute and again after each answer.
- **The Status panel is a usage meter**: requests, answered, failed, last time, tokens in, tokens
  out, this chat's total, and the free quota left today — so a rate limit is visible before it
  bites.
- The desktop app already showed tokens and `free today` in its footer; this brings the cloud
  edition to the same picture.

## 1.30.0 — 2026-11-04

- **Install it like an app.** A manifest and a cached shell mean the cloud edition can be added
  to a phone's home screen and reopens instantly, even with a flaky connection.
- The shell (page, manifest, icons) is cached; `/api/*` and `/auth/*` never are, so an answer or
  a session is never served stale.
- The page registers the worker after first paint, so installability never slows a cold load.

## 1.29.2 — 2026-11-04

- **A Chats button in the header, with the number of saved chats on it.** The list existed but
  was only reachable through Settings, so it looked like there was no history at all.
- Clicking a chat reopens it; the dialog is now titled “Your chats”, and `Alt+H` opens it.

## 1.29.1 — 2026-11-04

- **Sign-in was hidden.** It lived only inside Settings, so nothing on the page looked like an
  account. The header now carries a **Sign in** button (and the signed-in name with a
  **Sign out** button once you are in).
- **Sign-out was blocked by our own CSP.** The page shipped `form-action 'none'`, which
  refuses the POST form the auth library requires; it is now `'self'`.
- **The switch is announced.** Returning from sign-in shows “Signed in as … — chats now follow
  your account”, and signing out says chats stay in the browser again, instead of the storage
  change happening silently.

## 1.29.0 — 2026-11-04

- **Sign in with Freebuff (cloud edition).** One click, no password and no key pasting: the
  Worker holds the session and the page never sees a token.
- **Chats follow the account.** Saved chats are stored per account in the deployment's
  database, keyed by the session's user id — a chat started on the desktop browser opens on
  a phone. Signed out, everything still works exactly as before, browser-local.
- **The server decides access.** `/api/threads` returns 401 when signed out, every row is
  scoped to the signed-in account, and saves and deletes are refused from a foreign origin.
- The page shows who is signed in and offers the normal sign-out button; the history dialog
  says where chats are kept.

## 1.28.0 — 2026-11-04

- **A turn is no longer lost when one provider says no.** The chosen provider is tried
  first; rate limits, exhausted credits, a rejected key or a withdrawn model hand the same
  conversation to the next provider that has a key — OpenRouter, then Groq, Gemini, Mistral,
  Cohere, SambaNova.
- Each provider picks its own free model, because an id that is free on one service is not a
  free id on another. OpenRouter-only fields (`usage`, the `models` array) never follow the
  turn to another API.
- Nothing is streamed until a provider accepts, so you get one clean answer — and both pages
  say who actually replied. The cloud edition only uses keys the deployment holds: a key you
  pasted is never offered to a different service.

## 1.27.0 — 2026-11-04

- **Dark theme for sore eyes.** Near-black page and cards, grey secondary surfaces and
  borders, soft-white text — never pure white on pure black, so long sessions strain less.
  Primary actions (Send, Save) are light fills with dark text so they still stand out.
- Same tokens, same layout, same quick starts in both editions — only the palette flipped
  from light to dark.

## 1.26.1 — 2026-11-03

- **Back to white, grey and black.** The green accent is gone: the page is white, secondary
  surfaces and borders are grey, and text plus the primary buttons are black. Warn and danger
  states are grey fills with dark text and keep their labels, so errors still read as errors.
- Same tokens, same layout, same quick starts — only the palette changed.

## 1.26.0 — 2026-11-03

- **The interface is no longer black.** Paper surfaces, a single sage accent for the one real
  action, and three quiet state tints (info, warning, error) replace the all-dark theme. Everything
  comes from ~25 CSS tokens at the top of the stylesheet, so the whole look can be retuned in one
  place — and the cloud page uses the same tokens.
- **Clearer hierarchy.** Your message keeps the same left column but now reads as a soft tinted
  panel; answers are cards with calmer borders and no double borders; headings, lists and quotes
  inside an answer line up on one rhythm.
- **Quick starts on the empty screen.** Four chips (explain an error, summarise, review code,
  commit message) put a usable prompt in the box without sending anything; an existing draft is
  kept and the starter goes in front. Same four chips in the cloud edition, including the empty
  screen rebuilt when you switch provider.
- **Less visual noise.** Thin scrollbars, softer shadows instead of full-screen black modals,
  a labelled brand dot, segmented-style rail tabs, and hover states that stay readable instead of
  flipping to white text on black.
- **Mobile tidying:** wider bubbles on narrow screens, shorter model chip, 36 px tap targets.
- No behavioural change: every route, every keyboard shortcut and every guard is untouched, and
  all four suites still pass (113 unit, 24 CLI, 16 simulation, 16 against the single file).

## 1.25.8 — 2026-11-03

- **Closed a hole in the free-only promise.** If OpenRouter's model catalog could not be loaded,
  the app used to forward whatever model id the client asked for — including a paid one — because
  nothing had been priced yet. It now answers `502` and says the catalog is unavailable, and it
  falls back to the last catalog it did load rather than an empty one.
- **A rejected OpenRouter key is reported as a rejected key** during the catalog fetch instead of
  being swallowed into "no suitable free model".
- **`isAllowedModel` no longer pretends to vet OpenRouter.** Its pricing branch waved through any
  id that did not literally end in `-paid-marker`; it now fails closed, so it can never be
  mistaken for the real pricing check (which lives in `lib/models.mjs`).
- Tests: new coverage for both paths — 113 unit, 24 CLI, 16 simulation checks.

## 1.25.7 — 2026-11-03

- **Token totals now survive a restart.** Each saved message keeps its `usage`, so reopening a
  chat rebuilds the footer from the messages instead of showing zero tokens spent.
- **The cloud does the same** when a saved chat is loaded, and new answers store their usage in
  browser history alongside the text.
- Values are normalised to numbers on read, so a hand-edited `threads.json` cannot inject
  anything else.
- **Packaging:** `dist/OpenRouterChat-1.25.7-windows-x64.zip` ships the single
  `OpenRouterChat.exe` (Node SEA, cross-built from Linux; unsigned, not launch-tested here).
  The source and normal ZIPs are rebuilt with this note.

## 1.25.6 — 2026-11-03

- **The footer's message/token total now refreshes as soon as an answer finishes**, instead of
  waiting for the next render — it could otherwise look one answer behind.

## 1.25.5 — 2026-11-03

- **Usage is now visible while you chat.** The footer shows messages (or `used of cap free
  requests`) and the tokens reported by the provider, e.g. `6 messages · 4,812 tokens`; the
  OpenRouter pill keeps showing the free requests left today and refreshes after each answer.
- **Every answer carries its own numbers:** model, seconds, `in` / `out` tokens, and the cost
  when OpenRouter reports one.
- **Cloud has the same counts:** `N sent · N tokens` in the footer, tokens on each answer, and
  requests/answers/failures/tokens in the Status rail.
- **Two clear downloads:** the normal `OpenRouterChat-<version>.zip` and the
  `-github.zip` source archive, explained in the README's new "Which file do I use?" section.

## 1.25.4 — 2026-11-03

- **Cloud answers are rendered like the desktop ones:** paragraphs, headings, bullet and numbered
  lists, inline code, fenced blocks and clickable links, with the same escaping rules (everything
  is escaped before a tag is added, so model output cannot inject markup).
- The streamed answer is repainted through the renderer as tokens arrive, so code blocks and
  lists form while the model is still talking instead of appearing only at the end.
- This closes the last visible difference between the two transcripts.

## 1.25.3 — 2026-11-03

- **The cloud provider picker is now the same control as Windows:** a 190px rounded pill
  instead of the old 170px square box, with the same hover border and tooltip.
- Header, hero, composer, bubbles and the left-aligned transcript are otherwise unchanged and
  identical in both editions.

## 1.25.2 — 2026-11-03

- **Your own messages now sit on the left**, in the same column as the answer, instead of being
  pushed to the right edge. Saying `hi` reads as one transcript rather than a two-sided chat.
- Applied to both editions, because the cloud page and the desktop app share the same styles.

## 1.25.1 — 2026-11-03

Found by exercising the new providers against a mock endpoint:

- **The cloud key dialog rejected every Mistral, Cohere and SambaNova key.** It derived a required
  prefix by splitting the hint on `…`; the prose hints ("your Mistral key") have no ellipsis, so
  the whole sentence became the "prefix" and no real key could match. A prefix is now only
  enforced when the hint actually names one (`sk-or-v1-…`, `gsk_…`, `AIza…`).
- **A rejected key no longer masquerades as a working provider.** `/api/models` used to fall back
  to the known-good list on any failure, including `401`. Both editions now rethrow a rejected
  key, and the cloud page reopens the key dialog with "rejected that key".
- **The cloud remembers a model per provider**, like the desktop (`orc.model.<provider>`), so
  switching Groq → Mistral → back does not lose the choice.
- Verified against a mock Mistral endpoint: fallback model list, allowlist refusal for `-large`,
  a streamed answer, and a request body with no OpenRouter-only `models`/`usage` fields and no
  attribution headers.

## 1.25.0 — 2026-11-03

- **Three new providers, same rules:** **Mistral AI**, **Cohere** and **SambaNova** appear in the
  picker in both editions, each with a console link, a key field and the `free tier` badge. All
  three have a genuine no-card free tier; none is a card-gated promo credit.
- **Selection is identical because it is generated:** the desktop builds its `<select>` from
  `/api/providers` and the cloud page from `/api/config.providers`, so all six are listed,
  keyless ones marked `— add key`, and the key dialog adapts per provider.
- **Free-only still ends at the server:** Mistral is limited to `mistral-small` / `ministral` /
  `open-mistral` ids, Cohere to `command` / `aya` / `north` chat ids, SambaNova to
  llama/deepseek/gpt-oss/gemma/qwen. Embedding, rerank, OCR, audio and Gemini Pro models are
  refused before a request leaves the app.
- **`/models` is not assumed:** Cohere's compatibility layer may not expose it, so each new
  provider carries a short known-good fallback list; the picker and the fallback chain use it
  instead of failing.
- **Left out on purpose:** Cerebras, Nebius and Together (card-gated trial credits, no standing
  free tier), Hugging Face (free accounts get no inference credits), Cloudflare Workers AI (the
  base URL needs an account id) and Qwen/DashScope (90-day, region-locked trial).

## 1.24.1 — 2026-11-03

An audit of both editions found and fixed these:

- **Tool answers on Groq and Gemini were silently lost.** The follow-up request sent after a
  tool round always included OpenRouter's `usage: { include: true }` field; those providers
  reject unknown fields, so the extra request failed and the turn ended with no text.
- **An unknown provider no longer falls back to OpenRouter.** Both the desktop server and the
  Worker answer `400` with the offending id instead of quietly spending an OpenRouter key on a
  Groq/Gemini conversation.
- **The cloud page now honours a deployment key.** `/api/config` reports `serverKeys`, and the
  page stops demanding a pasted key when Sites secrets already hold one for that provider.
- **Browser workspace context in cloud tool mode.** Turning tools on used to drop the file-name
  and ticked-file context; it is now sent with the tool request too, and a rejected key reopens
  the key dialog on that path as well.
- **Desktop:** each provider remembers its own model (`openrouter.model.<provider>`), so
  switching Groq → OpenRouter returns to the model you had; Escape closes the prompt library.
- **Dead and fragile code:** removed the unused `pricePerMillion` helper and the
  `arguments[0]` rate-limit parameter in the Worker; `TODO.md` reflects what shipped.

## 1.24.0 — 2026-11-03

- **Windows gets the last two cloud features:** a **Prompts…** library (save the current draft,
  click to reuse, `×` to delete, kept in `openrouter.prompts`) and **Export this chat (.md)**,
  which downloads the current conversation as Markdown with provider and model in the header.
  Both live in **Settings ⚙ → Saved chats**, next to the existing JSON export/import.
- **All three providers are selectable in Windows**, confirmed: the picker is built from
  `/api/providers`, and a provider without a key is still listed as `Groq — add key` so it can
  be chosen and connected, exactly like the cloud page.
- Nothing about the desktop layout moved: the cloud page was already brought to this chrome in
  1.23.0, so both editions now share the same header, hero, composer and shortcuts.

## 1.23.0 — 2026-11-03

- **The cloud page now wears the desktop chrome:** brand + version, provider, model button,
  free-policy pill, then `quota`, **New**, **⚙**, **▤**, **Quit**; the hero reads
  *Free models. Real tools.* with the browser → cloud worker → OpenRouter diagram; the composer
  has **Send** and **Stop** and the footer carries the same shortcut line.
- `Quit` ends the tab honestly (a stopped screen with *Start again*), `Stop` aborts the
  streaming request or the tool loop, `Ctrl+K` opens the model picker, `Alt+N` starts a new
  chat, and a failed model load turns the model button into **Retry models**.
- Saved chats, prompts, Markdown export and the provider key moved out of the crowded header
  into **⚙ Settings**, which keeps the top bar identical to Windows.
- README: exact start steps, the single `OpenRouterChat.exe` path (Node SEA via GitHub Actions,
  no Node install), `start.cmd --port`, `--doctor`, and SmartScreen guidance.

## 1.22.0 — 2026-11-03

- **Testing mode for tools in the browser.** Settings ⚙ → *Workspace tools* sends three tool
  definitions (`list_files`, `read_file`, `write_file`) that act on the browser workspace, so
  the cloud edition can be exercised the way desktop tools are.
  - Reads run automatically; every `write_file` shows an **Allow / Deny** card in the thread
    first, exactly like the desktop write gate. Denying sends `DENIED by the user` back to the
    model and leaves storage untouched.
  - Up to three tool rounds per message. The tool turn is non-streaming, because a tool call
    has to come back as structured data; plain chat keeps streaming.
  - Off by default; stored in `orc.settings`.
- The Worker forwards up to eight tools on the non-stream path, returns `toolCalls` and
  `finishReason`, and no longer reports `empty_answer` when a model legitimately calls a tool
  with no text.

## 1.21.0 — 2026-11-03

- **The Files panel now reaches the model.** Before this, a file in the browser workspace was
  invisible to the AI — there was no phrase that made it find one. Now every request carries a
  system message listing the file names and sizes, and any file you **tick** has its text
  included, inside a 12,000-character budget. Nothing is sent until you press Send.
- Ticks are stored in `orc.include`; deleting a file drops its tick, so the list cannot go stale.
- The panel says exactly this instead of leaving it to guesswork, and the README's cloud section
  describes the difference from desktop: there the model reads real files with tools and an
  Allow/Deny card, here it sees only what you tick.

## 1.20.0 — 2026-11-03

- **The cloud page now has the desktop rail.** A `panels` button opens the same five tabs as the
  Windows app, with browser-backed storage and labels that say so:
  - **Files** — a virtual workspace in `localStorage` (`orc.files`): create, open, edit, save and
    delete text files. A Worker has no disk, so nothing touches a real filesystem.
  - **Secrets** — `sessionStorage` (`orc.secrets`), value write-only in the UI, used by the
    GitHub panel. Gone when the tab closes.
  - **GitHub** — lists your 20 most recently updated repositories using `GITHUB_TOKEN` from
    Secrets, straight from the tab (CSP now allows `api.github.com`).
  - **Preview** — a sandboxed iframe for any http(s) URL (CSP now allows `frame-src https:`).
  - **Status** — requests, answered, failed, last model and latency for this tab.
- **Settings (⚙)** — system prompt, max tokens and temperature, stored in `orc.settings` and
  applied to every request; the Worker now forwards a clamped temperature.
- This closes the biggest gap with the desktop app: same rail, same panels. What differs is only
  the backend — the web edition stores in the browser instead of on disk.

## 1.19.1 — 2026-11-03

- The `.desktopVer` spans still carried `1.18.3` as static text until boot replaced them. They
  now start as `…`, so the markup can never claim an old version if the config call is slow or
  fails. `/api/config` remains the only source of the number.
- Verified the served HTML matches the file on disk byte for byte when compared without
  stripping the trailing newline.

## 1.19.0 — 2026-11-03

- **README now explains how to get every key**, not just where the buttons are: the three
  consoles, what each key looks like, what stays free, where to paste it on desktop, in one
  cloud tab, or as a Sites secret for all visitors, plus the Groq/Grok and Copilot warnings
  and the "never paste a key into chat" rule.
- **Missing workspace is a supported state.** Started against a path that does not exist:
  page 200, `/api/fs` returns 400 `The workspace folder does not exist.`, chat still answers,
  settings still save, and the server log stays clean. The README records this so the desktop
  app can be exercised as a chat-only build, the same way the cloud edition behaves.
- Deployed to production and preview as `1.19.0-cloud`; ZIP rebuilt.

## 1.18.3 — 2026-11-03

- The cloud notice and hero paragraph hard-coded "v1.17.0" when referring to the desktop app, so
  every later release made the site *look* two versions old even though the badge was live. Both
  now use a `.desktopVer` span filled from `/api/config` (cloud suffix stripped), so the prose can
  never drift again.
- The page response is now `cache-control: no-store`, with `etag`/`last-modified` removed. It was
  `public, max-age=0, must-revalidate` and arrived as `cf-cache-status: HIT`; a revalidated copy
  is exactly what makes a deploy look missing.
- `/api/config` already returned `no-store`; this brings the HTML in line with it.

## 1.18.2 — 2026-11-03

- The cloud key dialog now carries a link to the right key page for the selected provider:
  OpenRouter settings, `console.groq.com/keys`, or AI Studio. It opens in a new tab with
  `rel="noreferrer"`, and disappears if a provider has no known key page.
- `/api/config` providers now include `keysUrl`, so the page builds the link from the same
  table that decides routing and free policy instead of hard-coding three URLs.
- No policy change: the three providers are unchanged, and Grok (xAI, paid) is still not
  offered.

## 1.18.1 — 2026-11-03

- A Grok key pasted into the Groq slot produced only "does not look like a Groq key", which
  sounds like a bug rather than a mix-up. The rejection now adds: Groq (`gsk_…`) is not xAI's
  Grok, and Grok is paid, so it is not offered.
- Same hint in the cloud page's key dialog and in both provider notes. No behaviour changed:
  the prefix check still runs before anything is stored or sent.
- Reminder in `README.md`: keys are pasted into the app, never into chat.

## 1.18.0 — 2026-11-03

- **Chats survive a reload.** Every conversation is upserted into `localStorage`
  (`orc.threads`, 30 newest) as soon as you send, and updated when the answer lands. The
  `history` button lists them with title, provider, model and time; clicking one restores the
  transcript, switches provider if the thread came from another one, and reloads that model
  list; `×` deletes.
- **Saving is tied to the transcript, not the tab.** `new chat` and a provider switch save the
  current thread first, so starting over never loses the last conversation.
- Restored chats keep a copy button per assistant reply; there is no server state, no account
  and no key involved — it is still a browser-only history.
- The desktop app already had server-side threads (`/api/threads`, `/api/export|import`); this
  brings the same idea to the cloud page without a database.

## 1.17.0 — 2026-11-03

- **Prompt library.** A `prompts` button opens a dialog listing prompts saved in this browser
  (`localStorage`, key `orc.prompts`, 30 max). Clicking one puts it in the composer; `×` deletes
  it; "save current draft" stores whatever is typed in the composer, de-duplicated by text.
- **Markdown export.** `export` downloads the conversation as `openrouter-chat-<stamp>.md` with
  the provider and model in the header and one `## You` / `## Assistant` section per message.
  It refuses with a banner when there is nothing to export.
- Both are local-only and need no key, no server route and no account — they survive a reload
  because they live in `localStorage`.
- The cloud page's copy no longer claims the provider switcher is desktop-only, and the desktop
  version references were brought up to date.

## 1.16.0 — 2026-11-03

- **The cloud `<select>` is gone.** It showed raw ids in a long OS dropdown; with 15 free models
  it was the clunkiest part of the page. It is now a listbox with a search box, a star to pin a
  model, a Recent group (last six, most recent first), a context-length column and a checkmark
  for the current model.
- **Keyboard:** `Enter`/`Space` on the button opens it, typing filters, `↑`/`↓` move, `Enter`
  picks, `Esc` closes and returns focus. The list scrolls the active row into view and exposes
  `role="listbox"`/`option` with `aria-selected`.
- **Pins and recents live in `localStorage`** (`orc.pins`, `orc.recents`), so they survive a
  reload without any server state. Pins sort first, then recents, then everything else.
- The desktop picker already had search and tools/vision/context filters; it is unchanged.

## 1.15.0 — 2026-11-03

- **The cloud edition streams.** `POST /api/chat` now sends Server-Sent Events:
  `{"delta":"…"}` frames as the provider emits them, then one `{"done":true,…}` frame with the
  model, usage and elapsed time. The page paints each delta, so the site feels like the desktop
  app instead of pausing for the whole answer.
- **Protocol is still scriptable.** `stream:false` returns the old single JSON reply, and any
  failure before the first byte is still a normal HTTP error (`401 missing_key`, `400 not_free`).
  A failure mid-stream arrives as an `error` frame with the bubble already on screen.
- **Abort works.** Stopping a reply cancels the reader; the Worker's `cancel()` drops the
  upstream body, so a stopped answer stops costing tokens.
- Only OpenRouter gets `stream_options.include_usage`; Groq and Gemini stream without it.

## 1.14.2 — 2026-11-03

- **Process, not features.** `release.sh` bumps `app.mjs`, `package.json` and
  `cloud/worker.mjs`, rebuilds the bundle, runs all four suites, rebuilds the ZIP and updates
  `CURRENT-LINK.txt` — one command, and it fails loudly instead of shipping a red run.
- **Cloud versions now track the app.** `cloud/worker.mjs` is `1.14.2-cloud`, not an
  independent `1.14.0-cloud.3`, so a site can never quietly lag the desktop build. Debug
  deploys may still add `-cloud.2`, `-cloud.3`, but a release collapses them.
- **`RELEASING.md`** records the rule the user asked for: every change bumps the version and
  updates *all* sites — desktop, cloud production and cloud preview.
- This release itself was deployed to both environments and the preview server was restarted.

## 1.14.1 — 2026-11-03

- **Removed:** the greyed-out "GitHub Copilot Free — no public API" entry from the provider
  picker. It explained an absence instead of offering a choice, and it made the menu look
  broken. The README still records why Copilot is not a provider at all.
- **Cloud edition 1.14.0-cloud.3:** the published Worker now has the same three providers.
  Each one is resolved from `OPENROUTER_API_KEY` / `GROQ_API_KEY` / `GEMINI_API_KEY` in
  Sites → Secrets, or from a per-request `x-provider-key` header the page keeps in
  `sessionStorage`. `/api/models?provider=` and `POST /api/chat` are provider-aware, the
  free-tier allow/deny rules are enforced server-side, and `/api/config` lists providers so
  the header can build its menu.

## 1.14.0 — 2026-11-03

- **Added:** a provider switcher in the header. **OpenRouter**, **Groq** and **Gemini (AI
  Studio)** each have their own key, model list and free-tier rule; the choice is saved in
  `config.json` and applies to the next message.
- **Free is decided per provider, in code:**
  - OpenRouter keeps the strict rule — an id is sent only if live pricing says `0`.
  - Groq and Gemini have no pricing in their catalogs, so they get an **allowlist**
    (`gpt-oss`, `qwen`, `llama`, `moonshotai` for Groq; `flash`, `gemma` for Gemini) plus a
    **deny list** (`pro`, `image`, `imagen`, `tts`, `embed`, `veo`, `audio`, Whisper, guard
    models). Gemini Pro is refused on purpose: a billed key must not be able to spend here.
  - The header badge says **verified free** or **free tier** so the difference is visible.
- **Not added, on purpose:** GitHub Copilot Free. It has no public chat API for third-party
  apps, and GitHub Models (the API route) was retired on 30 July 2026. The picker shows it
  disabled with that reason instead of pretending.
- **Keys:** `providerKeys` in `config.json` (0600), or `GROQ_API_KEY` / `GEMINI_API_KEY` in
  the environment. The API returns `hasKey` per provider and never a value.
- **Provider-specific wire details:** only OpenRouter gets `usage`, the `models` fallback
  array and the attribution headers; Groq and Gemini get one model per turn and no unknown
  fields. A model that rejects `tools` still falls back to a tool-free retry.
- **Quota:** the pill reports OpenRouter; for the others it names the provider and says
  `free tier` instead of inventing a number.
- **Tests:** `lib/providers.test.mjs` (keys, URL overrides, allow/deny rules, public view),
  plus an end-to-end Groq-shaped mock that proves the chat route really goes to the
  provider's base URL.

## 1.14.0-cloud.1 — 2026-11-03

The desktop app is unchanged at **1.13.1**; this is a separate artifact with its own
version, because it is a different program that happens to share a page. Nothing in
`cloud/` is bundled into `openrouter-chat.mjs` or the ZIP.

- **Added:** `cloud/` — the cloud edition. One Worker module serves the page, lists free
  models, and proxies a single chat turn to OpenRouter. No files, no threads, no commands;
  those stay desktop-only because a Worker has no disk and running user commands there
  would be remote execution for anyone who finds the URL.
- **Free only, enforced server-side:** the model id in a request must still be a free model
  in the live `/api/v1/models` catalog, so editing the request cannot smuggle in a paid id.
  The catalog is cached for ten minutes.
- **Chat models only:** a price of `0` per text token is not enough — Lyria bills for audio,
  so the filter also requires text output. That is how 17 zero-priced entries became the 15
  that can actually answer here.
- **Key handling:** `env.OPENROUTER_API_KEY` when the deployment has it; otherwise the page
  may send a key per request (`x-openrouter-key`), kept in `sessionStorage` and never stored,
  logged or echoed by the Worker. Without either, chat returns `missing_key` and the page
  asks for one instead of pretending.
- **Limits:** 64 KB body, 60 messages, 24 000 characters, 30 requests per minute per address,
  `max_tokens` capped at 4096. CSP is self-only; the page is served with `no-store`.
- **Errors are specific:** `key_rejected`, `credits`, `upstream_rate`, `unknown_model`,
  `empty_answer` and `not_free` each carry a sentence a person can act on.
- **Tested:** local harness (`cloud/dev.mjs`) exercises page, config, models, both key paths,
  paid-model refusal, empty conversation, oversized body and the rate limiter. Desktop
  suites (91 unit, 23 CLI, 15 simulation) were rerun and still pass.

## 1.13.2 — 2026-11-03

- **Fixed:** a model that printed its tool call as text instead of sending it through the
  protocol appeared to do nothing. In a real session the model read three files, then wrote
  `<tool_call><function=read_file><parameter=path>…` as prose; nothing ran, no file was ever
  written, and the turn ended looking successful. `parseTextToolCalls` in `lib/tools.mjs`
  now recovers that shape — Hermes/Qwen XML, a JSON object in the block, several calls in
  one message, and a block whose closing tag never arrived because the stream was cut — and
  feeds it through the same approval path as a real call, so `write_file` and `run_command`
  still wait for a click.
- **Behaviour:** the recovered call is echoed back to the model as a real `tool_calls` entry,
  so the conversation stays in a shape the API accepts, and the tag soup is stripped from the
  saved answer.
- **Tests:** seven parser cases in `lib/toolcall-text.test.mjs`, plus a simulation where the
  mock model streams the text form of `write_file` and the app must ask for approval and
  write `hello/index.html` for real.

## 1.13.1 — 2026-11-03

- **Fixed:** a model that called tools and then returned an empty message ended the turn
  with "No model answered." — the tool results were in the conversation but never turned
  into an answer. The app now sends one more request with no tools attached, which leaves
  the model nothing to do but reply in words. This is the common shape of a free model's
  behaviour in the workspace panel: read a few files, then go quiet.
- **Fixed:** if that follow-up is empty too, the error now says the tools ran and no text
  came back, instead of the generic message.
- **Tests:** a simulation case where the first response is a tool call and the second is
  empty, asserting the follow-up carries no tools and that the final text reaches the page.

## 1.13.0 — 2026-11-03

- **Added:** a **Status** tab in the right rail. It answers the question the fallback
  chain otherwise hides: how many attempts this run has made, the success rate, the
  average and slowest latency, which models are cooling down and why, and the last dozen
  attempts with their outcome and duration.
- **Added:** `GET /api/status` returns the same data as JSON, plus the catalog size and
  age and the tool limits. Read-only, no key, no prompt text.
- **Added:** per-attempt timing around the upstream call, so a fallback hop is visible as
  its own row instead of disappearing into one total.
- **Tests:** unit coverage for the log — normalisation, the bounded buffer, and averages
  that ignore untimed attempts — plus a route check that it answers without a token.

## 1.12.5 — 2026-11-03

- **Added:** `--doctor`. It prints the Node version, whether the config folder is
  writable, whether the port is free, whether a key is saved and whether OpenRouter
  answers, then exits with 0 or 1. Testing an install no longer means starting a chat
  and guessing which part failed.
- **Fixed:** when the port was taken, the app assumed it was a previous copy of itself,
  opened whatever was listening and exited successfully. It now asks `/api/config` who is
  there: a real running copy is still opened, anything else gets a clear message and a
  `--port` suggestion.
- **Docs:** the README now has a five-minute test walkthrough, an eleven-step checklist of
  what to try and what proves it worked, and a symptom-to-fix table.

## 1.12.4 — 2026-11-03

Found in a full read-through ahead of the first Windows run.

- **Fixed:** `run_command` could never start `npm`, `npx`, `tsc` or any other `.cmd`
  wrapper on Windows — `spawn` cannot execute a batch shim without a shell. The runner
  now resolves the name through `PATH`/`PATHEXT` and launches shims through
  `cmd.exe /d /s /c`, still with `shell: false`. Because cmd parses that line, an
  argument containing `& | < > ^ " % ( ) !` is refused instead of interpreted.
- **Fixed:** the app could exit silently on Windows. The "am I the main module?" check
  compared paths as raw strings, so a differently-cased or 8.3-shortened path made the
  server think it was being imported and start nothing. Paths are now canonicalised and
  case-folded on Windows before comparing.
- **Fixed:** on a PC without Edge no browser window opened at all — the fallback was
  attached to the `error` event, which never fires when `cmd` starts but `start msedge`
  fails. A non-zero exit now falls back to the default browser.
- **Fixed:** a save that could not replace `threads.json` (an antivirus scanner or an
  editor holding it for a moment) was reported as successful and lost. The atomic
  rename is retried on `EPERM`/`EBUSY`, and the in-memory copy is only updated once the
  file is really on disk, so a failure surfaces instead of pretending.
- **Fixed:** the app died a second after starting wherever no browser opener exists
  (a server, WSL, a container): `spawn('xdg-open')` reports the missing program as an
  asynchronous `error` event, and with no listener that is an uncaught exception. The
  opener is best-effort again, so a missing `xdg-open`/`open` only means no window.
- **Fixed:** the Windows ZIP shipped a `start.cmd` that ran `node app.mjs`, which is not
  in that ZIP. The launcher now runs `OpenRouterChat.exe` when it is next to it and
  falls back to Node for a source checkout.
- **Added:** a startup check for Node 20.11 with an actionable sentence instead of a
  stack trace from `import.meta.dirname` or `AbortSignal.any`.
- **Fixed (CI):** `npm test` listed the suites by hand and had stopped including
  `lib/commands.test.mjs`, so the command-runner tests never ran there. It now runs the
  whole `lib` folder, which is also what the Windows workflow uses — PowerShell does not
  expand `lib/*.test.mjs`, so that job was testing nothing at all.

## 1.12.3 — 2026-11-03

- **Fixed:** New Chat cleared the preview address field but left the previous chat's
  site loaded in the frame, so a new chat still showed the old dev server.
- **Fixed:** the 30-second fetch timeout used `AbortSignal.timeout` unconditionally,
  which throws on browsers older than Safari 16.4 and would break every request.
  It now degrades to a normal fetch where that API is missing.

## 1.12.2 — 2026-11-03

- **Fixed:** the page loaded but then sat there, because boot fetches `/api/models` and
  that is about 80 KB of JSON, uncompressed — around ten seconds over the test tunnel
  (2.8 ms locally). Every JSON body over 1 KB is now gzipped when the client accepts it,
  so the catalog arrives in roughly a tenth of the bytes.
- Small responses (a config blob, an `{ok:true}`) are left alone: the header and framing
  would cost more than they save.

## 1.12.1 — 2026-11-03

- **Fixed:** the app page had grown to 109 KB of inline markup and script, and over a
  slow test tunnel the response was being cut off part-way (36 KB of 109 KB, then a
  timeout). It is now sent gzipped when the browser asks for it — about 30 KB — with
  `vary: accept-encoding` so no cache hands a compressed body to a client that did not
  ask. Local use is unaffected; the header only appears when it is honoured.

## 1.12.0 — 2026-11-03

- **`run_command`.** One allowlisted program inside the workspace, with stdout and
  stderr streamed into the chat while it runs. Off until you tick *Allow the model to
  run commands* and list the programs in Settings.
- **No shell, ever.** `spawn(program, args, { shell: false })`, so `&&`, pipes and `>`
  are just text handed to the program: there is nothing to escape and no second command
  to chain. A program name cannot be a path, and an argument cannot contain a newline.
- **Approval per call.** The Allow / Deny card shows the exact program, arguments and
  folder before anything starts; a dropped connection or a three-minute timeout is a no.
- **Secrets are not inherited.** The child gets PATH, HOME, TEMP, LANG and the rest of
  what a compiler needs — `OPENROUTER_API_KEY` and `GITHUB_TOKEN` are not passed on.
- **Bounded.** 60 seconds, 64 KB of combined output, 40 arguments of at most 500
  characters, and the working folder must resolve inside the workspace, symlinks
  included.

## 1.11.0 — 2026-11-03

- **Preview tab.** Paste the address of a local dev server (`http://localhost:5173`) and
  the rail renders it beside the chat, with Reload and Open ↗. The address is stored on
  the chat, so reopening that chat brings the preview back.
- **Only http(s) is stored.** A `javascript:` or `file:` value is dropped on the server
  and in the page, because the address ends up in an iframe `src`.
- **Framing refusals explained.** If nothing arrives within five seconds the panel says
  the site is probably sending `X-Frame-Options` / `frame-ancestors` and points at
  Open ↗, instead of leaving a blank box.
- **CSP** gains `frame-src http: https:` — a frame is the only capability added;
  `frame-ancestors 'none'` still means nothing can frame this app.
- **Fixed:** the rail only ever showed the Files and Secrets bodies by name, so the
  GitHub tab added in 1.10.0 opened a panel that stayed hidden. Every tab is now shown
  and hidden by one rule derived from its id.

## 1.10.0 — 2026-11-03

- **GitHub tab.** Browse your repositories, then their open issues, pull requests and
  recent commits, with each row linking to GitHub. Read-only.
- **Token handling.** The PAT is read from the secrets store as `GITHUB_TOKEN`; it is
  never written to `config.json` and never sent to the page. Without it the panel shows
  one actionable line.
- **Model tools.** `github_list` (repos / issues / pulls / commits) and
  `github_create_issue`. The second one goes through the same Allow / Deny card as
  `write_file`, so no issue is opened without a click.
- **Dependency-free client.** `lib/github.mjs` is one fetch wrapper that maps 401, 404
  and an exhausted rate limit to plain sentences, with a 12 s timeout and 20-row caps.

## 1.9.0 — 2026-11-03

- **Files panel.** A right rail that browses one folder, opens text files and saves
  edits. Access is opt-in: nothing is readable until a workspace folder is set in
  Settings. Every path is realpath-resolved and must stay inside that root, so `../`
  and symlinks out are refused; reads cap at 256 KB, writes at 1 MB, binaries refused.
- **Secrets panel.** Named values in `secrets.json` (0600). The page only ever sees
  the name and a four-character hint; the API never returns a value.
- **Model file tools.** `list_files`, `read_file` and `write_file`, offered only when
  a workspace exists.
- **Approve before writing.** `write_file` pauses the turn and sends a confirm event;
  the page shows the path, the size and a preview with Allow / Deny. A denial is
  returned to the model as a normal tool result. A dropped connection or three
  minutes of silence counts as **no**.
- The header gained a rail toggle, and Settings a workspace folder field.

## 1.8.1 — 2026-11-03

- The header shows the version that is actually running (`v1.8.1`), read from
  `/api/config`, so a stale tab or a stale ZIP is obvious at a glance.
- Added `AGENTS.md` (how to work on the repo), `TODO.md` (the plan) and this file.
- No behaviour change to chat, threads, tools or storage.

## 1.8.0 — 2026-11-03

- **Restart-safe tabs.** The app token is per run; an open tab that gets a 403 now
  reloads itself once to pick up the new token instead of silently failing.
- **Draft recovery.** If a connection dies mid-answer (tab closed, refresh, network
  loss) the text received so far is stored on the thread and offered back with
  Keep / Discard the next time the chat is opened.
- **Conflict-safe saves.** Threads carry `rev`; a save from a stale copy returns 409
  with the newer thread, and the app asks which version wins instead of overwriting.

## 1.7.0 — 2026-11-03

- Chat bodies over 256 KB are rejected with 413 before anything is forwarded upstream
  (import keeps the 8 MB ceiling because it is a local backup file).
- Strict `Content-Security-Policy` plus nosniff / no-referrer / frame-deny on every
  response.
- `sk-…` keys scrubbed from streamed errors, 5xx bodies and logs.

## Before 1.7.0

1.0.0 – 1.6.x predate this file. They established the current feature set: free-only
model picker, three-model fallback chain with session failure memory, streaming with
Stop, message queue, threads with search, JSON export/import, settings, the three
tools, the quota meter and the CLI flags. `README.md` describes what exists today.

## 1.52.0 — search, batch reads, diffed patches

The first step from "chat that can write a file" to a coding agent. Three tools join the
workspace set, all still behind the existing opt-in root:

- **`search_files`** walks the workspace itself (no shell) and returns `path:line: text`.
  Literal or regex, case-sensitive on request, 80 matches and 2,000 files maximum, with
  `node_modules`, `.git`, `dist`, `build`, `coverage`, `.next` and similar folders skipped.
- **`read_many`** loads up to 8 files (320 KB total) in one call, so the model can read the
  files a search found instead of one round-trip per file. A missing or escaping path is a
  per-file error, not a failed batch.
- **`apply_patch`** replaces exact text in an existing file. Every `find` must occur exactly
  once; edits apply in order; up to 20 edits and the existing 1 MB write cap. Before the
  Allow / Deny card appears, `previewPatch` validates the edits and builds a real unified
  diff, which the card shows. The preview writes nothing, and the patch is validated again
  when it is applied, so a file changed in between is never patched against stale text.

`write_file` remains for new files. The tool list is now 12; the simulation asserts the
diff is on screen and the file is unchanged until approval.

## 1.53.0 — long-conversation memory

A 40-turn coding session no longer runs into the model's context window by silently
dropping the oldest messages. Before an upstream request, `lib/memory.mjs` checks an
estimated 6,000-token budget; above it, older turns are folded into one system note:

- the original user request always anchors the note;
- the newest 10 messages stay verbatim, starting at a user turn when possible;
- the rest is summarised as `User:` / `Assistant:` lines, newest first within a
  1,800-character budget, with an explicit omitted count;
- the note is a system message, so it works with every free provider.

The full history is never modified: desktop chat storage, the browser transcript and D1
all keep every message. The desktop turn meta and the cloud response headers report
`memory: N earlier messages summarised`; a short chat is sent exactly as before. There
is no extra model call and no extra cost.

Per-project thread groups remain on the roadmap; this release covers the context limit
and the visible note.

