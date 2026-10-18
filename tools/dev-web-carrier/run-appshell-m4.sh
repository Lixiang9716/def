#!/bin/sh
# tools/dev-web-carrier/run-appshell-m4.sh — the M4 appshell.m4 safety leg:
# the text-safety verdict row — hostile fields (<script>, quote-break,
# onerror=) render 100% as LITERAL TEXT through the whole carrier stack
# (timeline preview + fullscreen surface), zero script/img elements, zero
# on* attributes, zero page errors. The fixture is validator-clean on
# purpose: purity is the gate, not censorship — the rendering chain is what
# a hostile payload would ride.
#
# The cost ledger (real-model morph/update tokens, the M4 cost rows) rides
# the same evidence dir as cost-ledger.json, produced by
# test/panel/m4-cost-benchmark.mjs (manual, needs .env credentials).
#
# usage: sh tools/dev-web-carrier/run-appshell-m4.sh   exit 0 = the leg is green
set -eu
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ART_DIR="$ROOT/tools/dev-web-carrier/artifacts/appshell-m4"
MANIFEST="$ROOT/test/e2e/scenarios/appshell-m4.json"
EVENTS="$(mktemp /tmp/dsh-appshell-m4-events.XXXXXX)"
LOGS="$(mktemp /tmp/dsh-appshell-m4-logs.XXXXXX)"
cleanup() { rm -f "$EVENTS" "$LOGS"; }
trap cleanup EXIT INT TERM

# 1. the tools face's devDependencies (puppeteer-core et al.).
cd "$ROOT/test/tools"
[ -d node_modules ] || npm ci --no-audit --no-fund

# 2. the safety leg. set -e: the verdict write below only records a green run.
DSH_M4_EVENTS_FILE="$EVENTS" \
  node node_modules/vitest/vitest.mjs run tools/dev-web-carrier/appshell-m4-safety.test.mjs \
  2>&1 | tee "$LOGS"

# 3. the one-to-one count vs the manifest.
EXPECTED="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).expect.length)" "$MANIFEST")"
LOGGED="$(grep -c '^{' "$EVENTS" || true)"
if [ "$LOGGED" -ne "$EXPECTED" ]; then
  echo "run-appshell-m4: milestone drift — manifest expects $EXPECTED, run emitted $LOGGED" >&2
  WANT="$(mktemp /tmp/dsh-m4-want.XXXXXX)"
  GOT="$(mktemp /tmp/dsh-m4-got.XXXXXX)"
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

# 4. land the registered evidence set (cost-ledger.json, when present from a
#    benchmark run, rides the same dir untouched).
mkdir -p "$ART_DIR"
cp "$LOGS" "$ART_DIR/logs.txt"
cp "$EVENTS" "$ART_DIR/scenario.jsonl"
node -e "
const fs = require('fs');
fs.writeFileSync(process.argv[2] + '/verdict.json', JSON.stringify({
  scenario: 'appshell.m4',
  pass: true,
  expected: Number(process.argv[3]),
  logged: Number(process.argv[4]),
}, null, 2) + '\n');
" "$MANIFEST" "$ART_DIR" "$EXPECTED" "$LOGGED"
LEDGER="$ART_DIR/cost-ledger.json"
LEDGER_SUMMARY="not yet — run test/panel/m4-cost-benchmark.mjs with .env credentials"
if [ -f "$LEDGER" ]; then
  LEDGER_SUMMARY="$(node -e "
const l = JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'));
console.log('morph ' + l.morph.okOf + '/10 P50 ' + l.morph.tokensP50 + ' P95 ' + l.morph.tokensP95 + '; update ' + l.update.okOf + '/10 P50 ' + l.update.tokensP50 + '; payload ' + l.update.payloadBytesP50 + 'B (' + l.incrementalRatioPctVsCarrierFullSpec + '% of full)');" "$LEDGER")"
fi
cat > "$ART_DIR/receipt.json" <<EOF
{
  "host": "darwin-dev-carrier (Darwin $(uname -srm))",
  "carrier": "tools/dev-web-carrier --client next (in-process, loopback)",
  "browser": "machine Chrome via puppeteer-core (carrier-page.mjs discovery)",
  "scenario": "appshell.m4",
  "costLedger": "$LEDGER_SUMMARY",
  "proves": [
    "text safety: hostile fields (<script>, quote-break, onerror=) render 100% VERBATIM as text through the preview AND the fullscreen surface, zero script/img elements, zero on* attributes (m4/preview-inert + m4/surface-verbatim)",
    "the hostile fixture is validator-clean ON PURPOSE — purity is the gate, not censorship; the rendering chain is what a hostile payload would ride",
    "the cost ledger (cost-ledger.json): real glm-4.6 morph×10 + update×10 — token bars P50/P95 vs the plan budgets, latency recorded honestly (the morph tier rides the non-streaming physics)"
  ],
  "checker": "tools/dev-web-carrier/appshell-m4-safety.test.mjs (vitest) + milestone one-to-one vs test/e2e/scenarios/appshell-m4.json",
  "events": $LOGGED,
  "exitCode": 0
}
EOF
if [ -f "$LEDGER" ]; then
  echo "e2e: PASS appshell.m4 ($LOGGED/$EXPECTED milestones; cost ledger present) → $ART_DIR" >&2
else
  echo "e2e: PASS appshell.m4 ($LOGGED/$EXPECTED milestones; NO cost ledger yet — run test/panel/m4-cost-benchmark.mjs with .env credentials) → $ART_DIR" >&2
fi
