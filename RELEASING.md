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
cd openrouter-chat
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
cd openrouter-chat
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
executed in the Linux VM; `.github/workflows/build-windows.yml` remains the authoritative,
Windows-tested build (it only needs a push with Actions enabled).

## Version bump semantics

- **patch** (`1.14.1` → `1.14.2`): fixes, copy, provider lists, docs, tooling
- **minor** (`1.14` → `1.15`): a new capability the user can see (streaming, search, auth)
- **major** (`1.x` → `2.x`): a break in config, routes or file layout

## Why not deploy from the script

Sites credentials live in the chat integration, never in the repo, and a deploy needs a
receipt + a published check. Keeping that step in the chat is deliberate: it is the step that
makes the release real, so it stays visible.
