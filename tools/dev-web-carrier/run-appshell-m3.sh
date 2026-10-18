#!/bin/sh
# tools/dev-web-carrier/run-appshell-m3.sh — the M3 appshell.m3 numbers leg
# (plan §M3): the four action loop-back verdict rows, measured on the dev
# carrier with the deterministic mock transport (the plumbing ceiling — the
# real-model tier lands with the M4 cost ledger):
#   1. local tab switch        ≤50ms   (max sample over every tab)
#   2. loop closure            ≤15s    (click → tagged user turn → the
#      scripted appshell_update → the auto-apply merges over the open
#      surface → the DOM changes; wall clock)
#   3. incremental payload     ≤40%    (update bytes vs full re-render
#      bytes, both from the exported carrier sources the wire plays)
#   4. post-update DOM parity  (== the MERGED spec's expanded tree,
#      zero stale nodes from the pre-update tree)
# The in-test threshold assertions are the judgment; the measured values
# ride the milestone stream (DSH_M3_EVENTS_FILE) one-to-one with
# test/e2e/scenarios/appshell-m3.json, landed as the registered evidence set
# under tools/dev-web-carrier/artifacts/appshell-m3/.
#
# Browser: the machine's Chromium-family Chrome via puppeteer-core.
#
# usage: sh tools/dev-web-carrier/run-appshell-m3.sh   exit 0 = the leg is green
set -eu
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ART_DIR="$ROOT/tools/dev-web-carrier/artifacts/appshell-m3"
MANIFEST="$ROOT/test/e2e/scenarios/appshell-m3.json"
EVENTS="$(mktemp /tmp/dsh-appshell-m3-events.XXXXXX)"
LOGS="$(mktemp /tmp/dsh-appshell-m3-logs.XXXXXX)"
cleanup() { rm -f "$EVENTS" "$LOGS"; }
trap cleanup EXIT INT TERM

# 1. the tools face's devDependencies (puppeteer-core et al.).
cd "$ROOT/test/tools"
[ -d node_modules ] || npm ci --no-audit --no-fund

# 2. the leg: vitest drives the carrier + Chrome; every completed verdict
#    row appends one milestone line. set -e means the verdict write below
#    only ever records a green run (rule 6 posture).
DSH_M3_EVENTS_FILE="$EVENTS" \
  node node_modules/vitest/vitest.mjs run tools/dev-web-carrier/appshell-m3.test.mjs \
  2>&1 | tee "$LOGS"

# 3. the one-to-one count vs the manifest.
EXPECTED="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).expect.length)" "$MANIFEST")"
LOGGED="$(grep -c '^{' "$EVENTS" || true)"
if [ "$LOGGED" -ne "$EXPECTED" ]; then
  echo "run-appshell-m3: milestone drift — manifest expects $EXPECTED, run emitted $LOGGED" >&2
  WANT="$(mktemp /tmp/dsh-m3-want.XXXXXX)"
  GOT="$(mktemp /tmp/dsh-m3-got.XXXXXX)"
  node -e "
    const m = JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'));
    for (const e of m.expect) console.log(e.event);"
    "$MANIFEST" > "$WANT"
  node -e "
    for (const l of require('fs').readFileSync(process.argv[1], 'utf8').split('\n')) {
      if (l.trim()) console.log(JSON.parse(l).event);
    }"
    "$EVENTS" > "$GOT"
  diff "$WANT" "$GOT" >&2 || true
  rm -f "$WANT" "$GOT"
  exit 1
fi

# 4. land the registered evidence set (the measured values ride scenario.jsonl).
mkdir -p "$ART_DIR"
cp "$LOGS" "$ART_DIR/logs.txt"
cp "$EVENTS" "$ART_DIR/scenario.jsonl"
node -e "
const fs = require('fs');
fs.writeFileSync(process.argv[2] + '/verdict.json', JSON.stringify({
  scenario: 'appshell.m3',
  pass: true,
  expected: Number(process.argv[3]),
  logged: Number(process.argv[4]),
}, null, 2) + '\n');
" "$MANIFEST" "$ART_DIR" "$EXPECTED" "$LOGGED"
MEASURED="$(node -e "
const fs = require('fs');
const rows = fs.readFileSync(process.argv[1], 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const pick = (ev) => rows.find((r) => r.event === ev) ?? {};
const out = {
  localMaxMs: pick('m3/local-latency').maxMs,
  loopMs: pick('m3/loop-closure').ms,
  ratioPct: pick('m3/incremental-ratio').ratioPct,
  postUpdateDom: (({ expected, actual, stale }) => ({ expected, actual, stale }))(pick('m3/dom-parity-after-update')),
};
console.log(JSON.stringify(out));
" "$EVENTS")"
cat > "$ART_DIR/receipt.json" <<EOF
{
  "host": "darwin-dev-carrier (Darwin $(uname -srm))",
  "carrier": "tools/dev-web-carrier --client next (in-process, loopback)",
  "browser": "machine Chrome via puppeteer-core (carrier-page.mjs discovery)",
  "scenario": "appshell.m3",
  "measured": $MEASURED,
  "budgets": { "localMs": 50, "loopMs": 15000, "ratioPct": 40 },
  "proves": [
    "row 1 local: the tab switch answers in-page, synchronous, ≤50ms (max sample, m3/local-latency)",
    "row 2 loop: click → tagged user turn → appshell_update → auto-apply merge → the surface re-renders, ≤15s wall (m3/loop-closure; deterministic mock transport — the real-model tier is the M4 ledger)",
    "row 3 incremental: the update payload ≤40% of the full re-render payload, bytes from the exported carrier sources (m3/incremental-ratio)",
    "row 4 parity: the post-update DOM equals the MERGED spec's expanded tree with zero stale nodes (m3/dom-parity-after-update)"
  ],
  "checker": "tools/dev-web-carrier/appshell-m3.test.mjs (vitest thresholds) + milestone one-to-one vs test/e2e/scenarios/appshell-m3.json",
  "events": $LOGGED,
  "exitCode": 0
}
EOF

echo "e2e: PASS appshell.m3 ($LOGGED/$EXPECTED milestones) → $ART_DIR" >&2
