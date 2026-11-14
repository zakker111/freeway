# Releasing

Rule: **every change ships with a version bump, and every site is updated.** No exceptions for
"tiny" edits — a fix that exists only in the workspace is not shipped, and production behind
preview is a bug.

**A release is not announced until its `Verify release` run is green.** The publish job starts
that run itself; a red or missing run means the published ZIPs have not been checked against
`SHA256SUMS`, so nothing public may describe the release as ready.

## One version everywhere

| Place | Field | Format |
| --- | --- | --- |
| `app.mjs` | `VERSION` | `2.24.0` |
| `package.json` | `version` | `2.24.0` |
| `cloud/worker.mjs` | `VERSION` | `2.24.0-cloud` |
| `cloud/package.json`, `cloud/package-lock.json` | name / version | `freeway-cloud` @ `2.24.0` |
| `VERSIONS.md` | table row + section | `2.24.0` |
| `CURRENT-LINK.txt` | app + zip line | `2.24.0` |
| ZIP | `dist/Freeway-<version>.zip` | `2.24.0` |

The cloud build carries the app version with a `-cloud` suffix, so app and site can never
drift. Extra cloud-only deploys during a debug session use `-cloud.2`, `-cloud.3`, … until the
next real release collapses them back to `<version>-cloud`.

## Cut a release

```bash
cd freeway
./release.sh 2.24.0
```

It rewrites all three version strings, rebuilds `freeway.mjs` (the CLI/SEA bundle),
runs all five suites (unit, CLI, both simulations, cloud), rebuilds the ZIP and updates
`CURRENT-LINK.txt`. It fails loudly if a suite fails — never ship on a red run. The cloud
suite imports `cloud/dist/worker.mjs`, so `release.sh` rebuilds that bundle before the
cloud test; running it by hand needs `node cloud/build.mjs` first.

Then, from the chat (the Sites tools hold the credentials; the repo has none):

1. Confirm the `Verify release` run the publish job dispatched for this tag is green:

   ```bash
   gh run list --workflow verify-release.yml --event workflow_dispatch --limit 1
   ```

   A red or missing run means the shipped ZIPs are unverified. Stop here and fix it — see
   [Re-running a failed verification](#re-running-a-failed-verification) — before recording
   the release or announcing it. Do not mark the release as ready on the strength of the
   asset upload alone.
2. `sites_deploy` → **production**
3. `sites_deploy` → **preview**
4. Restart the preview server on port 3002
5. Verify all three report the new version, `/api/providers` still lists the full provider
   set (including OVHcloud and Ollama), the cloud page still has `#provider`, and a paid id
   is still refused
6. Add the `VERSIONS.md` row + section, update `TODO.md` if the release closes something
7. On the desktop, `GET /api/processes` must be empty after a restart: no orphan dev server

## The Windows `.exe`

Node SEA can be assembled for Windows from Linux, because only the `node.exe` host is
platform-specific. The 1.25.7 build used:

```bash
cd freeway
node build/bundle.mjs                       # freeway.cjs
node --experimental-sea-config sea-config.json   # sea-prep.blob
curl -o /tmp/node.exe https://nodejs.org/dist/v<node-version>/win-x64/node.exe
# clear the certificate-table entry at optional-header offset 112 + 4*8
#   (Windows rejects a binary whose Authenticode signature no longer matches)
npx postject /tmp/node.exe NODE_SEA_BLOB sea-prep.blob \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
```

Name the result `Freeway.exe`, zip it with the README, and keep it out of the source
ZIP. It is unsigned, so SmartScreen shows **More info → Run anyway**. The `.exe` cannot be
executed in the Linux VM; `.github/workflows/build-windows.yml` is the authoritative,
Windows-tested build. It passed on commit `94715e4` (run 41940445555); its
`windows-client` artifact is attached by the release tag workflow; launching the newly
built binary on a Windows desktop is still required.

## Release assets come from the tag workflow

Push the `v<version>` tag and `.github/workflows/build-windows.yml` publishes all three
assets by itself: the source ZIP built from the tag with the same `zip` invocation and
exclusions as `release.sh`, the Windows ZIP built and smoke-tested on `windows-latest`, and
`SHA256SUMS` covering both. The manifest is written in one job that waits for both ZIPs, so
it is never uploaded half-filled. Nothing is packaged or hashed locally any more.

The same publish job then dispatches the `Verify release` workflow, because a release
created with `GITHUB_TOKEN` never fires its own `release: published` trigger. That run
downloads the assets back and checks them against `SHA256SUMS`, and the publish job fails
if no verification run appears, so a tag cannot quietly publish unverified assets.

### Confirm the tag started its build

A tag push can occasionally create no workflow run at all: git reports success, the tag
exists, and nothing is ever built. After pushing, ask for the run explicitly instead of
trusting the push:

```bash
GH_TOKEN=... ./release.sh --wait-tag 2.35.11
```

The polling lives in `scripts/watch-run.sh`, shared with `./verify-release.sh`, so a
tag's build and its verification run are awaited with the same rules and messages.

It polls the Actions API for the tag's own "Release assets" run for up to
`WAIT_TAG_SECONDS` (180 by default), then follows that run until it finishes and fails on
anything but success — so a silent tag or a red build is caught before the release is
announced. The completion window is `WAIT_TAG_RUN_SECONDS` (900 by default).
`GITHUB_REPO=owner/name` overrides the repository taken from the git remote, and
`WAIT_TAG_RUN_ID=<id>` watches one specific run instead of discovering it.

## Verify the published assets

This happens on its own after every tag (see above). To repeat it locally, or to check a
fork, download the files back from GitHub and run them against the published manifest:

```bash
cd freeway
./verify-release.sh 2.24.0
```

The script downloads every asset from `v2.24.0` into a temporary directory, checks that
both `Freeway-2.24.0.zip` and `Freeway-2.24.0-windows.zip` are present and listed in
`SHA256SUMS`, runs `sha256sum -c`, and exits non-zero on a missing asset, download failure
or checksum mismatch. It uses the authenticated `gh` CLI, so no token is stored in the
script. After the checksums it awaits that tag's remote `Verify release` run through
`scripts/watch-run.sh` — the same watcher `./release.sh --wait-tag` uses — and fails if
that run is red. A tag with no verification run is reported as a note, not an error, so
older releases still verify. `--keep` preserves the downloads for inspection; `--repo owner/name` points at a
fork. `sha256sum` is used where available, with `shasum -a 256` as the macOS fallback.

### Re-running a failed verification

The dispatch entry point shipped with 2.35.3, so it works for that tag and every later one,
and a red or skipped check does not need a new release — the tag does not have to move.
Older tags lack the trigger and can only be checked by running `./verify-release.sh <version>`
by hand:

```bash
gh workflow run verify-release.yml --ref v2.35.3 -f version=2.35.3
run_id="$(gh run list --workflow verify-release.yml --event workflow_dispatch \
  --limit 1 --json databaseId --jq '.[0].databaseId')"
gh run watch "$run_id" --exit-status
```

If the new run has not appeared yet, the second line picks up the previous one; wait a few
seconds and run it again, then watch the id it prints.

Either form of the version is accepted (`2.35.3` or `v2.35.3`). Pass the tag as `--ref`, not
the default branch: that runs the workflow and the checkout from the release being verified.
Use `--ref main` only when the verification script itself was broken and the old tag cannot
run it. The same thing is available without a shell: **Actions → Verify release → Run
workflow**, then enter the version.

A re-run re-downloads the assets and checks them against the published `SHA256SUMS`, so it
notices assets replaced after the fact. It cannot notice a release whose manifest was
uploaded wrong in the first place and never had a passing run to compare against — that
needs a human reading the output.

## Live smoke matrix

Unit and cloud suites use mock upstreams. Run this matrix against real endpoints before
publishing, and record each result in `CURRENT-LINK.txt`. **Skipped is not passed.** A
configured key that is rate-limited is a skip with a reason, not a green result.

| Path | Check | 2026-11-04 result |
| --- | --- | --- |
| Local keyless | Send one small `ovh` prompt from the local app. | Pass — `local smoke ok` |
| Local OpenRouter | If `/api/providers` reports `hasKey`, send one free model. | Skipped — no local key |
| Local managed dev server | Allowlist `node`, ask Build to start a static server, open its port, then stop it. | Pending — lifecycle covered by unit and CLI suites, not clicked live |
| Local Groq | Same check for Groq. | Skipped — no local key |
| Cloud production keyless | Send one small `ovh` prompt to production. | Pass — `cloud smoke ok` |
| Cloud preview keyless | Send one small `ovh` prompt to preview. | Pass — `preview smoke ok` |
| Cloud keyed | If `/api/config` reports `hasKey: true`, send one free model. | Skipped — no server key in either cloud environment |
| Cloud guest files | Upload, reload, download and delete a file without a sign-in prompt. | Pending — no browser session in this run |
| Cloud model retry | Covered by `cloud/test.mjs`; live only when a provider actually returns 404/429/5xx. | Pass in the mock suite; not forced live |
| Windows | Run `Freeway.exe --version` and launch it once on Windows. | Pending — Linux VM; use Actions or a Windows machine |

For the local keyless check, the app returns SSE even when the request asks for JSON; read the
`delta` frames or use the page. Do not paste a provider key into a shell command: use the page
or the configured secret. A cloud turn that returns `retryAfterMs` should be retried only after
that delay, and the result recorded separately.

## Version bump semantics

- **patch** (`2.18.1` → `2.18.2`): fixes, copy, provider lists, docs, tooling
- **minor** (`2.18` → `2.19`): a new capability the user can see (streaming, search, auth)
- **major** (`2.x` → `3.x`): a break in config, routes or file layout

## Why not deploy from the script

Sites credentials live in the chat integration, never in the repo, and a deploy needs a
receipt + a published check. Keeping that step in the chat is deliberate: it is the step that
makes the release real, so it stays visible.
