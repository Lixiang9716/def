#!/bin/sh
# test/panel/fastcheck/run.sh — the property-suite runner (fast-check over
# the three runtime parsers: dsh-shell-js's parser-syntax, the node:path
# shim, and semver-range). Same provisioning shape as test/panel/run.sh:
# deps live in the PARENT directory's gitignored node_modules (fast-check is
# a devDependency of test/panel), so the runner falls back to `npm ci` there
# when vitest is missing (a fresh checkout / CI without a prior panel run).
set -eu
NODE=$(command -v node 2>/dev/null || true)
if [ -z "$NODE" ]; then
  for c in "$HOME"/.nvm/versions/node/*/bin/node; do
    [ -x "$c" ] && NODE="$c" && break
  done
fi
if [ -z "$NODE" ]; then
  echo "fastcheck: no node on PATH and none under ~/.nvm — cannot run the property suite" >&2
  exit 2
fi
DIR=$(cd "$(dirname "$0")" && pwd)
PARENT=$(dirname "$DIR")
VITEST="$PARENT/node_modules/vitest/vitest.mjs"
if [ ! -f "$VITEST" ]; then
  echo "fastcheck: node_modules missing — provisioning (npm ci in test/panel; CI has network)" >&2
  (cd "$PARENT" && npm ci --no-audit --no-fund) || (cd "$PARENT" && npm install --no-audit --no-fund)
fi
[ -f "$VITEST" ] || {
  echo "fastcheck: vitest still missing after provisioning — npm install failed" >&2
  exit 2
}
# The package entry, not the .bin face (same Windows-shim reasoning as
# test/panel/run.sh). cwd stays THIS directory so the suite's own
# vitest.config.js is picked up with its fastcheck-local root.
cd "$DIR"
exec "$NODE" "$VITEST" run
