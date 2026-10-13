#!/usr/bin/env bash
# gate: staging-generated
# Proves the webclient manifest legs reject the #288 leak class: one
# unsynced (untracked) file inside the whole-tree-staged
# presentation/web-client-v2 directory turns gen-staging-emit --check red
# naming the exact leaked file, and removing it restores green. This is
# the hand counter-proof for A12, re-institutionalized when the retired
# check-webclient-staged-tree.sh count-16 was replaced by the
# webclient*.rows store family (a count only ever noticed the total).
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
DIR="$REPO/presentation/web-client-v2"
LEAK="$DIR/web/js/.case-leak-tmp.js"
STORE="$REPO/tools/generated/staging"

restore() { rm -f "$LEAK"; }
trap restore EXIT

[ -d "$DIR" ] || {
  echo "case-staging-generated-webclient-leak: FAIL — product directory absent" >&2
  exit 1
}
printf '/* rejection-case leak: an unsynced file the HAP cannot carry */\n' > "$LEAK"
OUT="$(mktemp)"
if node "$REPO/tools/gen-staging-emit.mjs" --check "$STORE" > "$OUT" 2>&1; then
  echo "case-staging-generated-webclient-leak: FAIL — an unsynced file in the staged tree PASSED the gate" >&2
  exit 1
fi
grep -q "leak or new): web/js/.case-leak-tmp.js" "$OUT" || {
  echo "case-staging-generated-webclient-leak: gate went red but not about the leaked file" >&2
  exit 1
}
restore
if ! node "$REPO/tools/gen-staging-emit.mjs" --check "$STORE" >/dev/null 2>&1; then
  echo "case-staging-generated-webclient-leak: FAIL — the restored tree still fails the gate" >&2
  exit 1
fi
echo "case-staging-generated-webclient-leak: unsynced file rejected (exact name named); restored tree green"
