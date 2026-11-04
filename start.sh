#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Get the LTS version from https://nodejs.org/en/download" >&2
  exit 1
fi

exec node app.mjs "$@"
