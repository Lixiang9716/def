#!/bin/sh
# runtime/dsh/ci/run-llm-piai-user-endpoint.sh — the CLI proof run for the
# fetch→gateway BRIDGE and the named-exception gate (the user-endpoint leg):
#
#   negative — mounting a non-loopback piai route WITHOUT `userEndpoint: true`
#   fails loud at mount (deterministic, no network);
#   positive — the declared route mounts, the bridge installs (the
#   llm/piai-bridge honesty event), and a REAL dial to the well-known
#   endpoint returns a structured 401/403 provider refusal — the
#   crossed-the-seam proof (the loud fetch TypeError would be the opposite);
#   skip     — when the runner's egress probe fails, the scenario emits the
#   pinned skip plane and the receipt records skipped-honest (never a faked
#   pass, never an environmental red — the llm.live-stream descriptor-leg
#   posture).
#
# The positive plane dials through the NODE-SIDE forwarder companion
# (ci/anthropic-forwarder.mjs, the mock-llm-server.mjs pattern): the CLI
# host's httpFetch serves loopback sockets only (the proof driver never
# egresses), so the userEndpoint dial targets http://localhost:PORT and the
# forwarder carries it to the real endpoint. The forwarder is started here,
# polled to readiness (rule 8, bounded), and trapped down.
#
# No credentials ride this leg (the dial is deliberately keyless — the 401
# IS the assertion); the audit greps the raw log for the probe's placeholder
# key after first proving its matcher fires (the run-security-byok-leak.sh
# discipline).
#
# usage: run-llm-piai-user-endpoint.sh
#        (artifacts: runtime/dsh/artifacts/macos-cli-llm-piai-user-endpoint)
set -eu
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT/runtime/dsh"

ART_DIR="$ROOT/runtime/dsh/artifacts/macos-cli-llm-piai-user-endpoint"
PROBE_KEY="bridge-probe-key-not-a-real-credential"
TARGET="https://api.anthropic.com"

# 1. vendored upstream closure + host build (idempotent).
sh ../../external/ensure.sh > /dev/null
sh ../../external/ensure-dsh.sh
[ -x build/dsh-cli ] || sh host/build.sh
mkdir -p "$ART_DIR"
rm -f "$ART_DIR"/verdict*.json

# 2. the egress probe (rule 8, bounded): can THIS machine reach the target
#    at all? The scenario's planes hang off this one honest fact.
EGRESS=unavailable
if node -e "fetch('$TARGET/', {signal: AbortSignal.timeout(10000)}).then(() => process.exit(0)).catch(() => process.exit(1))" 2>/dev/null; then
    EGRESS=available
fi
echo "egress probe: $EGRESS" >&2

LOG="$ART_DIR/logs.txt"
FORWARDER_LOG="$ART_DIR/forwarder.log"
RC=0
if [ "$EGRESS" = "available" ]; then
    # 3a. the forwarder companion: start, poll to readiness (bounded 15s).
    node ci/anthropic-forwarder.mjs "$TARGET" > "$FORWARDER_LOG" 2>&1 &
    FORWARDER_PID=$!
    trap 'kill "$FORWARDER_PID" 2>/dev/null || true' EXIT
    FORWARDER_URL=""
    GUARD=0
    while [ "$GUARD" -lt 60 ] && [ -z "$FORWARDER_URL" ]; do
        FORWARDER_URL="$(sed -n 's/^MOCK_BASE_URL=//p' "$FORWARDER_LOG" | head -1)"
        GUARD=$((GUARD + 1))
        [ -n "$FORWARDER_URL" ] || sleep 0.25
    done
    if [ -z "$FORWARDER_URL" ]; then
        echo "forwarder never became ready — see $FORWARDER_LOG" >&2
        exit 1
    fi
    echo "forwarder: $FORWARDER_URL (→ $TARGET)" >&2
    ./build/dsh-cli . scenario/llm-piai-user-endpoint.js --http \
        --env "DSH_PIAI_EGRESS=available" \
        --env "DSH_PIAI_FORWARDER_URL=$FORWARDER_URL" \
        --env "ANTHROPIC_API_KEY=$PROBE_KEY" > "$LOG" 2>&1 || RC=$?
    MANIFEST="$ROOT/test/e2e/scenarios/llm-piai-user-endpoint.json"
    VERDICT="$ART_DIR/verdict-llm-piai-user-endpoint.json"
    PLANE=pass
else
    # 3b. the skip plane: no egress — the honest posture, verified verbatim.
    ./build/dsh-cli . scenario/llm-piai-user-endpoint.js --http \
        --env "DSH_PIAI_EGRESS=unavailable" > "$LOG" 2>&1 || RC=$?
    MANIFEST="$ROOT/test/e2e/scenarios/llm-piai-user-endpoint-skip.json"
    VERDICT="$ART_DIR/verdict-llm-piai-user-endpoint-skip.json"
    PLANE=skipped-honest
fi
grep '"scenario":"llm.piai-user-endpoint"' "$LOG" > "$ART_DIR/scenario.jsonl" || true
node "$ROOT/test/e2e/check.mjs" --manifest "$MANIFEST" --log "$LOG" \
    --out "$VERDICT"
if [ "$RC" -ne 0 ]; then
    echo "   FAIL: the host exited $RC (crash, or the scenario reported failure — see $LOG)" >&2
    exit 1
fi

# 4. the MATCHER SELF-CHECK + the no-secret audit: the probe's placeholder
#    key is not a credential, but the discipline holds — it must never land
#    in a log line either (the wire face records facts, not keys).
SCRATCH="$(mktemp /tmp/dsh-piai-endpoint-audit.XXXXXX)"
printf 'seeded line with %s inside\n' "$PROBE_KEY" > "$SCRATCH"
if ! grep -F -q -e "$PROBE_KEY" "$SCRATCH"; then
    rm -f "$SCRATCH"
    echo "llm-piai-user-endpoint: FAIL — the audit matcher cannot catch its own seeded value" >&2
    exit 1
fi
rm -f "$SCRATCH"
if grep -F -e "$PROBE_KEY" "$LOG" >/dev/null; then
    echo "llm-piai-user-endpoint: FAIL — the placeholder key leaked into the log" >&2
    exit 1
fi
echo "   audit: probe key absent from the raw log"

# 5. the receipt (what this run proves; one JSON document, built by node so
#    the JSON survives shell quoting untouched).
EVENTS="$(grep -c '"scenario":"llm.piai-user-endpoint"' "$LOG")"
export PIAI_PLANE="$PLANE" PIAI_EGRESS="$EGRESS" PIAI_EVENTS="$EVENTS" PIAI_VERDICT="$VERDICT"
node <<'NODE'
const fs = require('fs');
const plane = process.env.PIAI_PLANE;
const pass = plane === 'pass';
const receipt = {
  host: `${process.platform}-cli (${process.platform} ${process.arch})`,
  engine: 'quickjs-ng',
  engineVersion: '0.17.0',
  upstream: '@deepseek-ai/dsh-llm-pi-ai@0.1.6-alpha.2 (vendored verbatim, tgz sha256-pinned by external/ensure-dsh.sh)',
  scenario: 'llm.piai-user-endpoint',
  plane,
  egressProbe: process.env.PIAI_EGRESS,
  events: Number(process.env.PIAI_EVENTS),
  result: pass ? 'pass' : 'skipped-honest',
  ...(pass ? {} : { reason: 'egress unreachable from this machine at run time' }),
  proves: pass ? [
    'the named-exception gate: mounting a non-loopback piai route without userEndpoint: true fails loud AT MOUNT, naming the route and the declaration (deterministic, no network)',
    "the bridge install is the mount's own honesty statement: llm/piai-bridge {installed, hosts:[localhost]} — hostnames only, never a path, never key material",
    "the bridged fetch carries a declared user endpoint across the frozen gateway httpFetch seam: the dial comes back as a STRUCTURED 4xx provider refusal with the parsed error body — never the loud no-network TypeError; the CLI host's loopback-only httpFetch reaches the endpoint through the node-side forwarder companion (the same assertions hold on a device host where httpFetch egresses directly)",
  ] : [
    'the skip plane is HONEST: with no egress the scenario emits the pinned skip events (bridge/skip.honest {reason: egress-unreachable}) and the run stays green with receipt status skipped-honest — an unreachable network is never faked into a pass and never reddened as an environment failure',
  ],
};
fs.writeFileSync(process.env.PIAI_VERDICT.replace(/verdict.*\.json$/, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
NODE
echo "llm-piai-user-endpoint: $PLANE ($EVENTS scenario events; verdict $VERDICT)"
