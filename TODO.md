# Plan

Ticked items are in the shipped build. Completed version history lives in the GitHub
releases and commit log; this file tracks what is still open.

> **Current architecture:** the hosted edition is guest-only. There is no account,
> sign-in, server-side chat history, account-file storage or account-backed preview
> link. Chats, browser files and tab keys stay in the browser. Historical entries for
> the removed account features are intentionally not carried forward.

## Current state

- Desktop and cloud source are **2.23.0**.
- Chatty ships in both browser pages behind a Settings switch; its tips, jokes, close
  cooldown and reduced-motion behavior are covered by the page suite.
- The latest published GitHub release is **v2.20.0**; it carries the source ZIP,
  Windows ZIP and `SHA256SUMS`.
- The cloud Worker keeps chats in browser `localStorage`, workspace files in IndexedDB,
  and provider/GitHub keys in `sessionStorage`.
- The shared-key path enforces a per-visitor daily budget in D1 and a short-window
  in-memory rate limit.
- Actions default token is **read-only**; workflow actions are pinned to full SHAs.
- Security and privacy notes are in [`SECURITY.md`](SECURITY.md) and
  [`PRIVACY.md`](PRIVACY.md).

## Release work

- [x] Deploy cloud preview and production at **2.23.0-cloud**; Chatty is present in both
      pages and the Worker reports the matching version.
- [ ] Cut a **2.23.0** GitHub release from current `main` so the newest published source
      and Windows build match the app version.
- [ ] Rebuild the Windows client on Windows, smoke-test `/api/config` and the page, then
      attach it with a fresh `SHA256SUMS`.
- [ ] Re-run the desktop and cloud browser smoke checks against the published URLs.
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
