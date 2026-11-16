# Plan

Ticked items are in the shipped build. Completed version history lives in the GitHub
releases and commit log; this file tracks what is still open.

> **Current architecture:** the hosted edition is guest-only. There is no account,
> sign-in, server-side chat history, account-file storage or account-backed preview
> link. Chats, browser files and tab keys stay in the browser. Historical entries for
> the removed account features are intentionally not carried forward.

## Current state

- Desktop and cloud source are **2.35.39**, and both cloud environments serve
  **2.35.39-cloud** from the same build.
- Chatty ships in both browser pages behind a Settings switch. Her first-run spotlight tour,
  Cat school (eight three-step lessons), a Settings action with an in-panel guide, tips,
  jokes, pounce, an occasional yarn-ball game with an edge peek, close cooldown, single soft
  completion chime and reduced-motion behavior are covered by the page suite. Her layer
  stays above the rail, drawer, preview and full-screen preview; native modal dialogs still
  pause her. Her tip also shifts to stay inside short windows, and her fixed position now clears
  the taller cloud composer. Her control-board tour starts automatically on a clean first
  visit and walks all eighteen controls in reading order, from Chats, New, provider, model,
  quota/key, Settings, Preview, rail and Quit through Plan, Build, the composer, starter
  prompts, image, attach, memory, Send and Stop. Each stop names the control and explains it;
  she glides for 620–1200 ms with the target ring on the same clock, and the browser suite
  checks every landing, explanation, overlap and reduced-motion path. The tour measures each
  tip before moving, scrolls rendered off-screen stops into view, places the bubble above,
  below or beside the control, clamps it to the viewport and caps it with internal scrolling
  in short windows. The browser gate also runs the tour at 390×844, 844×390 and 320×480.
- The latest published GitHub release is **v2.35.30**; it carries the source ZIP,
  Windows ZIP and `SHA256SUMS`. `main` is nine patches ahead of it, so those binaries
  are out of date: cutting the **v2.35.39** release is the open step.
- The cloud Worker keeps chats in browser `localStorage`, workspace files in IndexedDB,
  and provider/GitHub keys in `sessionStorage`.
- The shared-key path enforces a per-visitor daily budget in D1 and a short-window
  in-memory rate limit.
- Actions default token is **read-only**; workflow actions are pinned to full SHAs.
- Security and privacy notes are in [`SECURITY.md`](SECURITY.md) and
  [`PRIVACY.md`](PRIVACY.md).

## Next up

Ranked by value, in the order they were chosen. Numbers are kept from that list, so
item 8 is intentionally absent. Ticked items already shipped.

- [ ] **1. Protect the data before anything else: persistent storage + an export nudge.**
      `navigator.storage.persist()`, a storage-health line in Settings, and a warning
      before the 200-chat cap prunes.
- [ ] **2. Cross-tab write safety in the cloud edition.** The desktop store refuses a
      stale `rev` with a 409; the cloud `saveThread` is last-write-wins on the whole array.
- [x] **3. The blank-canvas reload state.** Shipped in **2.35.36**: a restored thread with
      no messages renders the hero again instead of clearing the transcript.
- [ ] **4. A live "free catalog health" system, not just Requesty.** Nightly probe of every
      provider, a "verified" note in the picker, last-known-good catalog, and a one-click
      switch when a model id disappears.
- [ ] **5. A real queue, not one held message.** A visible list of held messages, each
      cancelable and editable, with a "send now" that still respects the gate.
- [ ] **6. "Switch to an idle free provider" as one click, never automatic.** Offer the
      choice after a 429; keep `fallbackOrder` refusing to move on its own.
- [ ] **7. Survive a reload or tab switch mid-answer.** Persist the streaming text and offer
      to continue, so a backgrounded phone tab does not cost the whole wait again.
- [ ] **9. Chat deep links + share target.** `?chat=<id>`, the address updating per chat, and
      a PWA share target that opens a prefilled composer.
- [ ] **10. A "what leaves this tab" panel.** Destinations, where each key lives, and a live
      tail of outgoing request paths.
- [ ] **Export that includes files.** One archive with chats and IndexedDB workspace files,
      so moving to another device does not lose the work the chats refer to.
- [x] **Fix the phone announcement.** Shipped in **2.35.37**: a short summary with a `More`
      toggle, no clamped scroll box, and the download link always visible.

## Release work

- [x] Cut the **2.35.30** patch: Chatty's control-board tour fits phones and short landscape
      windows and scrolls to off-screen controls.
- [x] Verify 375 node tests (86 page checks), 37 CLI, 29 + 29 simulations, 31 cloud checks
      and 11 browser Chatty stages; the cloud page stays inside the viewport at
      320×480, 432×822 and 844×390.
- [x] Deploy cloud preview and production at **2.35.30-cloud**.
- [x] Verify both pages report **2.35.30-cloud**; the production tour passes at 320×480
      and 844×390 with no clipped bubble or covered target.
- [x] Cut the **2.32.0** minor: every Cat school step moves Chatty to a new edge with her tour hop.
- [x] Add a real-browser regression for tutor movement, tour, the Settings switch and reduced motion.
- [x] Deploy cloud preview and production at **2.32.0-cloud**.
- [x] Cut the **2.31.2** patch: malformed catalogs degrade cleanly and split dev-server ports are detected.
- [x] Verify 349 node tests (78 page checks), 36 CLI, 29 + 29 simulations and 30 cloud checks.
- [x] Deploy cloud preview and production at **2.31.2-cloud**.
- [x] Cut the **2.31.1** patch: the cloud shell fits 320px phones and the drawer sits above the header.
- [x] Verify 18/18 device runs in both editions from 320×568 to 1920×1080, plus the first-visit cloud banner.
- [x] Deploy cloud preview and production at **2.31.1-cloud**.
- [x] Cut the **2.31.0** minor so Chatty tours saved chats, key/quota and attachments.
- [x] Verify all eleven tour stops at 1366 and 375, including reduced motion, hop and target visibility.
- [x] Deploy cloud preview and production at **2.31.0-cloud**.
- [x] Cut the **2.30.0** minor: a bouncing tour with separate Plan, Build and Settings stops.
- [x] Verify all eight tour stops at 1366 and 375, including reduced motion and target visibility.
- [x] Cut the **2.29.1** patch: a static aura, pre-paint chats state and composer-aware Chatty.
- [x] Sweep every viewport at 60 fps, including 4× CPU throttling, reduced motion and functional toggles.
- [x] Deploy cloud preview and production at **2.30.0-cloud**.
- [x] Deploy cloud preview and production at **2.29.1-cloud**.
- [x] Cut the **2.29.0** minor with Chatty's idle yarn-ball game and edge peek.
- [x] Deploy cloud preview and production at **2.29.0-cloud**.
- [x] Cut the **2.28.0** minor with Chatty's Settings action and in-panel guide.
- [x] Deploy cloud preview and production at **2.28.0-cloud**.
- [x] Cut the **2.27.0** minor with Chatty's eight-lesson Cat school, tutor actions and
      tutor-themed tips and jokes.
- [x] Deploy cloud preview and production at **2.27.0-cloud**.
- [x] Cut the **2.26.0** minor so Chatty stays above the rail, drawer, preview and
      full-screen preview.
- [x] Deploy cloud preview and production at **2.26.0-cloud**.
- [x] Cut the **2.25.1** patch so the standalone viewer really removes its loading card
      after the page renders.
- [x] Deploy cloud preview and production at **2.25.1-cloud**.
- [x] Cut the **2.25.0** minor so cloud preview links open a standalone `/preview` page
      that renders only the saved file full screen, never the Freeway app shell.
- [x] Deploy cloud preview and production at **2.25.0-cloud** with the standalone viewer.
- [x] Cut the **2.24.1** patch so Pages is verified after every push and the live smoke
      follows GitHub's lazy release assets.
- [x] Deploy cloud preview and production at **2.24.0-cloud** and cut the **2.24.0**
      GitHub release.
- [x] Deploy cloud preview and production at **2.23.2-cloud**; both pages serve the
      46 unique Chatty tips and report the matching version.
- [x] Cut a **2.23.2** GitHub release from current `main` so the newest published source
      and Windows build match the app version.
- [x] Rebuild the Windows client on Windows, smoke-test `/api/config` and the page, then
      attach it with a fresh `SHA256SUMS`.
- [ ] Re-run the desktop and cloud browser smoke checks against the published URLs for
      the expanded Chatty tip library.
- [ ] Keep only the newest release's binaries; old release assets were removed.

## Repository hardening

- [ ] Enable secret scanning and push protection. Blocked on this private/free
      repository: GitHub requires a public repository or GitHub Pro/Advanced Security.
- [ ] Enable Dependabot alerts. Currently disabled; the available connector can list
      alerts but cannot turn them on.
- [ ] Enable CodeQL/code scanning. Blocked on this private/free repository; GitHub
      Advanced Security is required.
- [ ] Protect `main`: require a pull request and the `Linux` check, block force-push and
      deletion, and apply the rule to admins. Blocked by the same plan restriction.
- [ ] Enable private vulnerability reporting. Currently unavailable on this private/free
      repository; `SECURITY.md` gives the advisory link and a no-details fallback.
- [ ] Decide whether the repository will be public and, if so, add the chosen root
      `LICENSE` at the same time.

## Security follow-up

- [ ] Rotate any provider, GitHub or Cloudflare credential that was ever pasted into a
      chat, log, artifact or old build. No live key was found in the current tree, but
      the old artifacts and logs were removed rather than certified secret-free.
- [ ] Re-check that no local secret file is tracked after each release.
- [x] Add a release checklist item that downloads published assets back and verifies
      their checksums (`verify-release.sh`, documented in `RELEASING.md`).
