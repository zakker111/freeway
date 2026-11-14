#!/usr/bin/env bash
# Download a published release's assets and verify them against its SHA256SUMS.
#
# Usage: ./verify-release.sh <version> [--repo owner/name] [--keep]
#
# The repository is private, so this uses the authenticated gh CLI. No token is
# read, printed, or written by this script.
set -euo pipefail

DEFAULT_REPO="zakker111/freeway"

usage() {
  cat <<'EOF'
Usage: ./verify-release.sh <version> [--repo owner/name] [--keep]

Downloads every asset on the v<version> GitHub release into a temporary
directory, runs sha256sum -c SHA256SUMS, then awaits that tag's remote
"Verify release" run the same way ./release.sh --wait-tag awaits its build.
Exits non-zero if the download, the manifest, a checksum or that run fails.
A tag with no verification run -- one that never published, or that predates the
workflow -- is reported as a note rather than an error.

  <version>          release version, with or without the leading v (2.23.0)
  --repo owner/name  GitHub repository (default: zakker111/freeway)
  --keep             keep the downloaded files and print their directory
  -h, --help         show this help

Requires gh (authenticated for private repositories) and sha256sum, or shasum
on macOS. Use GH_TOKEN with gh to supply a token without putting it on the
command line.
EOF
}

VERSION=""
REPO="${GH_REPO:-$DEFAULT_REPO}"
KEEP=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --repo)
      if [ "$#" -lt 2 ] || [ -z "$2" ]; then
        echo "error: --repo needs owner/name" >&2
        exit 2
      fi
      REPO="$2"
      shift 2
      ;;
    --keep)
      KEEP=1
      shift
      ;;
    -*)
      echo "error: unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
    *)
      if [ -n "$VERSION" ]; then
        echo "error: only one version can be verified at a time" >&2
        exit 2
      fi
      VERSION="$1"
      shift
      ;;
  esac
done

if [ -z "$VERSION" ]; then
  usage >&2
  exit 2
fi

if [[ "$REPO" != */* ]]; then
  echo "error: --repo must look like owner/name" >&2
  exit 2
fi

VERSION="${VERSION#v}"
TAG="v$VERSION"

if ! command -v gh >/dev/null 2>&1; then
  echo "error: gh is required. Install GitHub CLI and run 'gh auth login'." >&2
  exit 1
fi
if ! command -v sha256sum >/dev/null 2>&1 && ! command -v shasum >/dev/null 2>&1; then
  echo "error: sha256sum (or shasum on macOS) is required." >&2
  exit 1
fi
if ! gh auth status >/dev/null 2>&1; then
  echo "error: gh is not authenticated. Run 'gh auth login' or set GH_TOKEN." >&2
  exit 1
fi

TMP="$(mktemp -d "${TMPDIR:-/tmp}/freeway-release.XXXXXX")"
cleanup() {
  if [ "$KEEP" -eq 1 ]; then
    printf '\nDownloads kept in %s\n' "$TMP"
  else
    rm -rf "$TMP"
  fi
}
trap cleanup EXIT

printf '== downloading %s assets from %s ==\n' "$TAG" "$REPO"
if ! gh release download "$TAG" --repo "$REPO" --dir "$TMP"; then
  echo "error: could not download release $TAG from $REPO." >&2
  exit 1
fi

MANIFEST="$TMP/SHA256SUMS"
if [ ! -s "$MANIFEST" ]; then
  echo "error: SHA256SUMS is missing or empty on $TAG." >&2
  exit 1
fi
if ! grep -Eq '^[0-9a-fA-F]{64}  .+' "$MANIFEST"; then
  echo "error: SHA256SUMS has no checksum entries." >&2
  exit 1
fi

# The release normally carries the source ZIP and the Windows ZIP. Verify both
# are present and covered by the manifest, not just whichever files it lists.
for file in "Freeway-$VERSION.zip" "Freeway-$VERSION-windows.zip"; do
  if [ ! -f "$TMP/$file" ]; then
    echo "error: $file was not downloaded from $TAG." >&2
    exit 1
  fi
  if ! grep -Fq "  $file" "$MANIFEST"; then
    echo "error: $file is not listed in SHA256SUMS." >&2
    exit 1
  fi
done

printf '== verifying published checksums ==\n'
(
  cd "$TMP"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum -c SHA256SUMS
  else
    # sha256sum is not installed by default on macOS.
    shasum -a 256 -c SHA256SUMS
  fi
)

# The publish job dispatches Verify release for every tag from 2.35.3 on. A tag
# with no such run (never published, or before the workflow) is a note, not a
# failure, so this check never turns a valid older release red.
WATCH="$(cd "$(dirname "$0")" && pwd)/scripts/watch-run.sh"
if [ -x "$WATCH" ]; then
  printf '\n== awaiting the remote verification run ==\n'
  GITHUB_REPO="$REPO" bash "$WATCH" "Verify release" "$TAG" --optional
fi

printf '== published assets verified: %s ==\n' "$TAG"
