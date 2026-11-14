#!/usr/bin/env bash
# Watch a workflow run for a ref: wait for it to appear, follow it to the end,
# and fail on anything but success. Shared by `./release.sh --wait-tag`
# ("Release assets") and `./verify-release.sh` ("Verify release"), so both
# await their run with the same rules and messages.
#
# Usage: scripts/watch-run.sh <run-name> <ref> [--optional]
#
#   --optional   a run that never appears is a note, not a failure (tags older
#                than the workflow have none)
#
# Env: GH_TOKEN (preferred) or an authenticated gh CLI
#      GITHUB_REPO=owner/name (else the git remote, then package.json)
#      WAIT_TAG_SECONDS=180      window for the run to appear
#      WAIT_TAG_RUN_SECONDS=900  window for the run to finish
#      WAIT_TAG_RUN_ID=<id>      watch one run instead of discovering it
set -euo pipefail

RUN_NAME="${1:-}"
REF="${2:-}"
OPTIONAL=0
if [ "${3:-}" = "--optional" ]; then
  OPTIONAL=1
fi
if [ -z "$RUN_NAME" ] || [ -z "$REF" ]; then
  echo "usage: scripts/watch-run.sh <run-name> <ref> [--optional]" >&2
  exit 2
fi

REPO="${GITHUB_REPO:-}"
if [ -z "$REPO" ]; then
  REPO="$(git config --get remote.origin.url 2>/dev/null \
    | sed -E 's#.*github\.com[:/]([^/]+)/([^/]+?)(\.git)?$#\1/\2#' || true)"
fi
if [ -z "$REPO" ] && [ -f package.json ]; then
  # A source ZIP unpacked without .git still knows its repository here.
  REPO="$(node -p "const u=require('./package.json').repository; typeof u === 'string' ? u : (u && u.url) || ''" 2>/dev/null \
    | sed -E 's#.*github\.com[:/]([^/]+)/([^/]+?)(\.git)?$#\1/\2#' || true)"
fi
REPO="${REPO%.git}"
if ! printf '%s' "$REPO" | grep -Eq '^[^/]+/[^/]+$'; then
  echo "Cannot tell which repository to watch; set GITHUB_REPO=owner/name." >&2
  exit 1
fi

if [ -z "${GH_TOKEN:-}" ]; then
  if ! command -v gh >/dev/null 2>&1; then
    echo "Set GH_TOKEN, or install and authenticate the gh CLI." >&2
    exit 1
  fi
  # An unauthenticated gh answers every poll with an error, and an error used
  # to look exactly like "no run yet": 2.35.19 was reported missing after its
  # run had already started. Refuse up front instead of waiting out the window.
  if ! gh auth status >/dev/null 2>&1; then
    echo "GH_TOKEN is not set and gh is not authenticated, so the Actions API cannot be read." >&2
    echo "  Run 'gh auth login' or pass GH_TOKEN, then try again." >&2
    exit 1
  fi
fi

api() {
  if [ -n "${GH_TOKEN:-}" ]; then
    curl -fsS -H "authorization: Bearer $GH_TOKEN" \
      -H 'accept: application/vnd.github+json' \
      "https://api.github.com/$1"
  else
    gh api "$1"
  fi
}

list_run() {
  local body
  # Ask for the newest runs in the repository rather than filtering by
  # branch: the API's branch filter does not reliably surface a tag's run in
  # the first seconds after the push, so an already-started build could be
  # skipped for the whole window. Match the ref here instead, newest first.
  body="$(api "repos/$REPO/actions/runs?per_page=50")" || return 1
  printf '%s' "$body" | node -e '
let d = "";
process.stdin.on("data", (c) => (d += c)).on("end", () => {
  try {
    const j = JSON.parse(d);
    const [name, ref] = process.argv.slice(1);
    const runs = (j.workflow_runs || [])
      .filter((r) => r.name === name && r.head_branch === ref)
      .sort((a, b) => b.id - a.id);
    const run = runs[0];
    process.stdout.write(run ? [run.id, run.status, run.conclusion || "-", run.html_url].join(" ") : "");
  } catch { process.stdout.write(""); }
});
' "$RUN_NAME" "$REF"
}

one_run() {
  api "repos/$REPO/actions/runs/$1" 2>/dev/null \
    | node -e '
let d = "";
process.stdin.on("data", (c) => (d += c)).on("end", () => {
  try {
    const j = JSON.parse(d);
    process.stdout.write([j.status, j.conclusion || "-", j.html_url].join(" "));
  } catch { process.stdout.write(""); }
});
' || true
}

APPEAR="${WAIT_TAG_SECONDS:-180}"
FINISH="${WAIT_TAG_RUN_SECONDS:-900}"

RUN=""
if [ -n "${WAIT_TAG_RUN_ID:-}" ]; then
  RUN="$(api "repos/$REPO/actions/runs/$WAIT_TAG_RUN_ID" 2>/dev/null \
    | node -e '
let d = "";
process.stdin.on("data", (c) => (d += c)).on("end", () => {
  try {
    const j = JSON.parse(d);
    process.stdout.write([j.id, j.status, j.conclusion || "-", j.html_url].join(" "));
  } catch { process.stdout.write(""); }
});
' || true)"
else
  echo "== waiting for the $RUN_NAME run on $REF ($REPO, ${APPEAR}s to appear) =="
  waited=0
  failures=0
  while [ -z "$RUN" ] && [ "$waited" -lt "$APPEAR" ]; do
    if RUN="$(list_run)"; then
      failures=0
      if [ -z "$RUN" ]; then
        sleep 5
        waited=$((waited + 5))
      fi
    else
      # A failed request is not an empty list. Retry twice, then say what is
      # wrong instead of blaming a missing run.
      failures=$((failures + 1))
      echo "  Actions API request failed ($failures/3)" >&2
      if [ "$failures" -ge 3 ]; then
        echo "FAIL: cannot read the Actions API for $REPO." >&2
        echo "  Set a valid GH_TOKEN (or authenticate gh) and run this again." >&2
        echo "  Do not announce the release until the run is confirmed." >&2
        exit 1
      fi
      sleep 5
      waited=$((waited + 5))
    fi
  done
fi

if [ -z "$RUN" ]; then
  if [ "$OPTIONAL" -eq 1 ]; then
    echo "No $RUN_NAME run for $REF within ${APPEAR}s; nothing to await."
    exit 0
  fi
  echo "FAIL: no $RUN_NAME run appeared for $REF within ${APPEAR}s." >&2
  echo "  Check https://github.com/$REPO/actions and do not announce the release." >&2
  echo "  If the ref is sound, push a fresh tag for the same tree." >&2
  exit 1
fi

read -r RUN_ID RUN_STATUS RUN_CONCL RUN_URL <<< "$RUN"
echo "$RUN_NAME run: $RUN_URL ($RUN_STATUS)"

# Appearance is not enough: a red build publishes nothing either. Keep polling
# this run until it finishes, and fail on anything but success.
waited=0
while [ "$RUN_STATUS" != "completed" ] && [ "$waited" -lt "$FINISH" ]; do
  sleep 5
  waited=$((waited + 5))
  NEXT="$(one_run "$RUN_ID")"
  if [ -n "$NEXT" ]; then
    read -r RUN_STATUS RUN_CONCL RUN_URL <<< "$NEXT"
    echo "  $RUN_STATUS${RUN_CONCL:+ ($RUN_CONCL)}"
  fi
done

if [ "$RUN_STATUS" != "completed" ]; then
  echo "FAIL: $RUN_NAME is still $RUN_STATUS after ${FINISH}s: $RUN_URL" >&2
  echo "  It may still finish; check the run before announcing anything." >&2
  exit 1
fi
if [ "$RUN_CONCL" != "success" ]; then
  echo "FAIL: $RUN_NAME finished $RUN_CONCL: $RUN_URL" >&2
  echo "  Do not announce the release; fix the cause and re-cut." >&2
  exit 1
fi
echo "$RUN_NAME succeeded: $RUN_URL"
