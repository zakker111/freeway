# Releasing

Rule: **every change ships with a version bump, and every site is updated.** No exceptions for
"tiny" edits — a fix that exists only in the workspace is not shipped, and production behind
preview is a bug.

## One version everywhere

| Place | Field | Format |
| --- | --- | --- |
| `app.mjs` | `VERSION` | `1.14.2` |
| `package.json` | `version` | `1.14.2` |
| `cloud/worker.mjs` | `VERSION` | `1.14.2-cloud` |
| `cloud/package.json`, `cloud/package-lock.json` | name / version | `freeway-cloud` @ `1.14.2` |
| `VERSIONS.md` | table row + section | `1.14.2` |
| `CURRENT-LINK.txt` | app + zip line | `1.14.2` |
| ZIP | `dist/Freeway-<version>.zip` | `1.14.2` |

The cloud build carries the app version with a `-cloud` suffix, so app and site can never
drift. Extra cloud-only deploys during a debug session use `-cloud.2`, `-cloud.3`, … until the
next real release collapses them back to `<version>-cloud`.

## Cut a release

```bash
cd freeway
./release.sh 1.14.3
```

It rewrites all three version strings, rebuilds `freeway.mjs` (the CLI/SEA bundle),
runs all five suites (unit, CLI, both simulations, cloud), rebuilds the ZIP and updates
`CURRENT-LINK.txt`. It fails loudly if a
suite fails — never ship on a red run.

Then, from the chat (the Sites tools hold the credentials; the repo has none):

1. `sites_deploy` → **production**
2. `sites_deploy` → **preview**
3. Restart the preview server on port 3002
4. Verify all three report the new version and that `/api/providers` still lists three
   providers, the cloud page still has `#provider`, and a paid id is still refused
5. Add the `VERSIONS.md` row + section, update `TODO.md` if the release closes something

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
`windows-client` artifact still needs to be attached to a release and launched on a desktop.

## Live smoke matrix

Unit and cloud suites use mock upstreams. Run this matrix against real endpoints before
publishing, and record each result in `CURRENT-LINK.txt`. **Skipped is not passed.** A
configured key that is rate-limited is a skip with a reason, not a green result.

| Path | Check | 2026-11-04 result |
| --- | --- | --- |
| Local keyless | Send one small `ovh` prompt from the local app. | Pass — `local smoke ok` |
| Local OpenRouter | If `/api/providers` reports `hasKey`, send one free model. | Skipped — no local key |
| Local Groq | Same check for Groq. | Skipped — no local key |
| Cloud production keyless | Send one small `ovh` prompt to production. | Pass — `cloud smoke ok` |
| Cloud preview keyless | Send one small `ovh` prompt to preview. | Pass — `preview smoke ok` |
| Cloud keyed | If `/api/config` reports `hasKey: true`, send one free model. | Skipped — no server key in either cloud environment |
| Cloud signed-in files | Sign in, upload, reload, download and delete a file. | Pending — no browser session in this run |
| Cloud model retry | Covered by `cloud/test.mjs`; live only when a provider actually returns 404/429/5xx. | Pass in the mock suite; not forced live |
| Windows | Run `Freeway.exe --version` and launch it once on Windows. | Pending — Linux VM; use Actions or a Windows machine |

For the local keyless check, the app returns SSE even when the request asks for JSON; read the
`delta` frames or use the page. Do not paste a provider key into a shell command: use the page
or the configured secret. A cloud turn that returns `retryAfterMs` should be retried only after
that delay, and the result recorded separately.

## Version bump semantics

- **patch** (`1.14.1` → `1.14.2`): fixes, copy, provider lists, docs, tooling
- **minor** (`1.14` → `1.15`): a new capability the user can see (streaming, search, auth)
- **major** (`1.x` → `2.x`): a break in config, routes or file layout

## Why not deploy from the script

Sites credentials live in the chat integration, never in the repo, and a deploy needs a
receipt + a published check. Keeping that step in the chat is deliberate: it is the step that
makes the release real, so it stays visible.
