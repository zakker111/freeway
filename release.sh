#!/usr/bin/env bash
# Cut a release: bump both editions, rebuild, test, zip.
# Deploying happens right after this from the chat (Sites tools) — see RELEASING.md.
set -euo pipefail

MODE="release"
if [ "${1:-}" = "--wait-tag" ]; then
  MODE="wait-tag"
  shift
fi

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  echo "usage: ./release.sh <version>             cut a release, e.g. ./release.sh 1.14.3" >&2
  echo "       ./release.sh --wait-tag <version>  after pushing the tag, wait for its Release assets run" >&2
  exit 1
fi
cd "$(dirname "$0")"

# A tag push that creates no workflow run publishes nothing and still exits 0
# from git. After pushing, this mode polls the Actions API for the tag's own
# "Release assets" run and fails loudly when none appears, so the gap is caught
# before anyone announces a release that has no binaries.
if [ "$MODE" = "wait-tag" ]; then
  exec bash scripts/watch-run.sh "Release assets" "v$VERSION"
fi

echo "== bumping to $VERSION =="
node - "$VERSION" <<'NODE'
const fs = require('node:fs');
const version = process.argv[2];

const bump = (file, replacement) => {
  const before = fs.readFileSync(file, 'utf8');
  const after = before.replace(/const VERSION = ['"][^'"]*['"];/, replacement);
  // Re-running a release at the same version is a no-op, not an error.
  if (after === before) {
    if (before.includes(replacement)) return console.log(`${file}: already at ${replacement}`);
    throw new Error(`could not find const VERSION in ${file}`);
  }
  fs.writeFileSync(file, after);
};

bump('app.mjs', `const VERSION = '${version}';`);
// The cloud build always tracks the app version, so the two can never drift.
bump('cloud/worker.mjs', `const VERSION = '${version}-cloud';`);

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
pkg.version = version;
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');

// The cloud edition is its own package. Keep it and its lockfile in step, or a
// clean `npm ci` starts from a package whose name and version no longer match.
for (const file of ['cloud/package.json', 'cloud/package-lock.json']) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  data.name = 'freeway-cloud';
  data.version = version;
  if (data.packages?.['']) {
    data.packages[''].name = 'freeway-cloud';
    data.packages[''].version = version;
  }
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}
console.log(`app.mjs ${version} · cloud/worker.mjs ${version}-cloud · both package.json + lockfile ${version}`);
NODE

echo "== syncing the shared preview core =="
node build/sync-preview.mjs

echo "== rebuilding the single-file bundle =="
node build/bundle.mjs

echo "== rebuilding the cloud worker bundle =="
# The deployer uploads files and never runs npm, so the Worker's imports
# must be bundled before cloud/deploy.json points at it.
if [ -d cloud/node_modules ]; then
  ( cd cloud && node build.mjs )
else
  echo "  cloud/node_modules is missing: run (cd cloud && npm install) first" >&2
  exit 1
fi

echo "== tests =="
node --test lib/*.test.mjs 2>&1 | tail -6
node test/cli.mjs
node test/simulate.mjs
APP_PATH=freeway.mjs node test/simulate.mjs
NODE_OPTIONS=--experimental-sqlite node cloud/test.mjs

echo "== windows zip =="
cd ..
mkdir -p dist
rm -f "dist/Freeway-$VERSION.zip"
zip -r -q "dist/Freeway-$VERSION.zip" freeway \
  -x 'freeway/cloud/*' 'freeway/node_modules/*' 'freeway/dist/*' 'freeway/.git/*' '*/.DS_Store' \
     'freeway/.env*' 'freeway/config.json' 'freeway/threads.json' 'freeway/secrets.json' \
     'freeway/*.tmp' 'freeway/.tmp/*' 'freeway/*.log'
ls -l "dist/Freeway-$VERSION.zip"

if [ -f CURRENT-LINK.txt ]; then
  sed -i "s|dist/Freeway-[0-9.]*\.zip|dist/Freeway-$VERSION.zip|g; s|Desktop app [0-9.]*|Desktop app $VERSION|g" CURRENT-LINK.txt
fi

echo
echo "Still to do for $VERSION:"
echo "  1. VERSIONS.md row + section"
echo "  2. deploy cloud/ to PRODUCTION and PREVIEW (same manifest)"
echo "  3. restart the preview server on 3002"
echo "  4. verify prod, preview and the desktop app report $VERSION"
echo "  5. after publishing: ./verify-release.sh $VERSION"
