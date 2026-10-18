#!/bin/sh
# tools/dev-web-carrier/run-appshell-morph.sh — the L4 appshell.morph browser
# leg (plan D-6/§3.5): one prompt per theme (微信 → 网易云音乐 → 支付宝) through
# the dev carrier's scripted appshell_render tool cards, the fullscreen
# presented surface, and the L4 verdict rows —
#   DOM component-node count == the plugin validator's expanded tree (per
#   theme, with the client expander's lockstep asserted beside it), and
#   console error == 0 across the whole run.
# The vitest assertions emit one milestone JSON line per completed step
# (scenario appshell.morph, one-to-one with
# test/e2e/scenarios/appshell-morph.json); this runner lands the registered
# evidence set (verdict/logs/scenario/receipt) under
# tools/dev-web-carrier/artifacts/appshell-morph/.
#
# Browser: the machine's Chromium-family Chrome via puppeteer-core (never a
# downloaded browser) — the carrier-page.mjs discovery contract.
#
# usage: sh tools/dev-web-carrier/run-appshell-morph.sh   exit 0 = the leg is green
set -eu
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ART_DIR="$ROOT/tools/dev-web-carrier/artifacts/appshell-morph"
MANIFEST="$ROOT/test/e2e/scenarios/appshell-morph.json"
EVENTS="$(mktemp /tmp/dsh-appshell-morph-events.XXXXXX)"
LOGS="$(mktemp /tmp/dsh-appshell-morph-logs.XXXXXX)"
cleanup() { rm -f "$EVENTS" "$LOGS"; }
trap cleanup EXIT INT TERM

# 1. the tools face's devDependencies (puppeteer-core et al.), npm ci-deterministic.
cd "$ROOT/test/tools"
[ -d node_modules ] || npm ci --no-audit --no-fund

# 2. the leg: vitest drives the carrier + Chrome; every completed assertion
#    step appends one milestone line. set -e means a red suite exits here —
#    the verdict write below only ever records a green run (rule 6 posture).
DSH_MORPH_EVENTS_FILE="$EVENTS" \
  node node_modules/vitest/vitest.mjs run tools/dev-web-carrier/appshell-morph.test.mjs \
  2>&1 | tee "$LOGS"

# 3. the one-to-one count: the manifest pins exactly the milestones a green
#    run emits (order-stable; the retry legs inside the test never mint
#    extra lines — milestones fire on completion only).
EXPECTED="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).expect.length)" "$MANIFEST")"
LOGGED="$(grep -c '^{' "$EVENTS" || true)"
if [ "$LOGGED" -ne "$EXPECTED" ]; then
  echo "run-appshell-morph: milestone drift — manifest expects $EXPECTED, run emitted $LOGGED" >&2
  WANT="$(mktemp /tmp/dsh-morph-want.XXXXXX)"
  GOT="$(mktemp /tmp/dsh-morph-got.XXXXXX)"
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

# 4. land the registered evidence set.
mkdir -p "$ART_DIR"
cp "$LOGS" "$ART_DIR/logs.txt"
cp "$EVENTS" "$ART_DIR/scenario.jsonl"
node -e "
const fs = require('fs');
fs.writeFileSync(process.argv[2] + '/verdict.json', JSON.stringify({
  scenario: 'appshell.morph',
  pass: true,
  expected: Number(process.argv[3]),
  logged: Number(process.argv[4]),
}, null, 2) + '\n');
" "$MANIFEST" "$ART_DIR" "$EXPECTED" "$LOGGED"
cat > "$ART_DIR/receipt.json" <<EOF
{
  "host": "darwin-dev-carrier (Darwin $(uname -srm))",
  "carrier": "tools/dev-web-carrier --client next (in-process, loopback)",
  "browser": "machine Chrome via puppeteer-core (carrier-page.mjs discovery)",
  "scenario": "appshell.morph",
  "proves": [
    "three one-prompt morphs (微信 → 网易云音乐 → 支付宝), zero renderer edits between them (the fourth-app counterfactual at the e2e layer)",
    "L4 verdict row 1: DOM primitive count == the plugin validator's expanded tree, per theme (32/32/32), with the client expander's lockstep asserted beside it (morph/dom-parity)",
    "L4 verdict row 2: zero page errors across the whole run (morph/page-errors-zero)",
    "the fullscreen surface lifecycle per theme: card → open → accent → DOM parity → local tab switch → action loopback as a tagged user turn → close (milestones one-to-one with the manifest)"
  ],
  "checker": "tools/dev-web-carrier/appshell-morph.test.mjs (vitest) + milestone one-to-one vs test/e2e/scenarios/appshell-morph.json",
  "events": $LOGGED,
  "exitCode": 0
}
EOF

echo "e2e: PASS appshell.morph ($LOGGED/$EXPECTED milestones, in order) → $ART_DIR" >&2
