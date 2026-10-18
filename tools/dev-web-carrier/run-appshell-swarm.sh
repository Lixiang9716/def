#!/bin/sh
# tools/dev-web-carrier/run-appshell-swarm.sh — the swarm-visual leg: ONE
# swarm prompt grows three pen-identity variant cards side by side (ghost
# slots for the not-yet-arrived parts, pen cursors resting on the growth
# points), completion judges each card's DOM against its spec's expanded
# tree at the L4 bar, and promoting a card reuses the SAME openSurface seam
# with the others staying selectable. DOM assertions are the CI verdict;
# the staged PNG shots under artifacts/appshell-swarm/shots/ are local
# visual evidence only (never a CI input).
#
# usage: sh tools/dev-web-carrier/run-appshell-swarm.sh   exit 0 = the leg is green
set -eu
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ART_DIR="$ROOT/tools/dev-web-carrier/artifacts/appshell-swarm"
SHOTS_DIR="$ART_DIR/shots"
MANIFEST="$ROOT/test/e2e/scenarios/appshell-swarm.json"
EVENTS="$(mktemp /tmp/dsh-appshell-swarm-events.XXXXXX)"
LOGS="$(mktemp /tmp/dsh-appshell-swarm-logs.XXXXXX)"
cleanup() { rm -f "$EVENTS" "$LOGS"; }
trap cleanup EXIT INT TERM

# 1. the tools face's devDependencies (puppeteer-core et al.).
cd "$ROOT/test/tools"
[ -d node_modules ] || npm ci --no-audit --no-fund

# 2. the swarm leg, with the milestone stream and the staged shots enabled.
mkdir -p "$SHOTS_DIR"
DSH_SWARM_EVENTS_FILE="$EVENTS" DSH_SWARM_SHOTS_DIR="$SHOTS_DIR" \
  node node_modules/vitest/vitest.mjs run tools/dev-web-carrier/appshell-swarm.test.mjs \
  2>&1 | tee "$LOGS"

# 3. the one-to-one count vs the manifest.
EXPECTED="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).expect.length)" "$MANIFEST")"
LOGGED="$(grep -c '^{' "$EVENTS" || true)"
if [ "$LOGGED" -ne "$EXPECTED" ]; then
  echo "run-appshell-swarm: milestone drift — manifest expects $EXPECTED, run emitted $LOGGED" >&2
  WANT="$(mktemp /tmp/dsh-swarm-want.XXXXXX)"
  GOT="$(mktemp /tmp/dsh-swarm-got.XXXXXX)"
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

# 4. land the registered evidence set (the staged shots ride shots/, made
#    by the test itself; receipts describe what the leg proves).
mkdir -p "$ART_DIR"
cp "$LOGS" "$ART_DIR/logs.txt"
cp "$EVENTS" "$ART_DIR/scenario.jsonl"
node -e "
const fs = require('fs');
fs.writeFileSync(process.argv[2] + '/verdict.json', JSON.stringify({
  scenario: 'appshell.swarm',
  pass: true,
  expected: Number(process.argv[3]),
  logged: Number(process.argv[4]),
}, null, 2) + '\n');
" "$MANIFEST" "$ART_DIR" "$EXPECTED" "$LOGGED"
SHOTS="$(ls "$SHOTS_DIR" 2>/dev/null | wc -l | tr -d ' ')"
cat > "$ART_DIR/receipt.json" <<EOF
{
  "host": "darwin-dev-carrier (Darwin $(uname -srm))",
  "carrier": "tools/dev-web-carrier --client next (in-process, loopback)",
  "browser": "machine Chrome via puppeteer-core (carrier-page.mjs discovery), prefers-reduced-motion: reduce",
  "scenario": "appshell.swarm",
  "proves": [
    "one swarm prompt -> three pen-identity variant cards side by side (distinct accents + name labels), grown over STAGED spec arrival the carrier script fixes deterministically",
    "progressive render: certainly-closed components immediate, pending slots as translucent dashed ghosts, pen cursors resting on each card's growth point — under prefers-reduced-motion everything still appears instantly, just unanimated",
    "completion at the L4 bar per card: DOM ash-* primitives == the spec's expanded tree (plugin + client expandSpec in lockstep), ghosts gone",
    "promote-on-click reuses the SAME openSurface seam (own accent, surface DOM parity); the other two variants stay selectable; the conversation flow keeps its normal timeline cards; zero page errors"
  ],
  "checker": "tools/dev-web-carrier/appshell-swarm.test.mjs (vitest) + milestone one-to-one vs test/e2e/scenarios/appshell-swarm.json",
  "shots": $SHOTS,
  "events": $LOGGED,
  "exitCode": 0
}
EOF
echo "e2e: PASS appshell.swarm ($LOGGED/$EXPECTED milestones; $SHOTS staged shots) → $ART_DIR" >&2
