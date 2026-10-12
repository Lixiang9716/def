#!/bin/sh
# runtime/dsh/ci/run-llm-piai-live.sh — the SERVED-KEY live leg for the pi-ai
# anthropic-messages route (the run-ios-live-llm.sh discipline, CLI side):
#
#   skip  — no DSH_PIAI_LIVE_KEY in the environment: the scenario emits the
#           pinned skip plane and the receipt records skipped-honest. THIS IS
#           THE DEFAULT CI SHAPE — a missing key is an honest fact, never a
#           faked pass and never an environmental red.
#   real  — a served key (never echoed; it rides the launch env and the
#           apiKeyEnv reference ONLY) + a dialable endpoint: on the CLI host
#           the dial goes through the node-side forwarder companion (the CLI
#           httpFetch serves loopback sockets only); on a device host the
#           runner passes the real URL and httpFetch egresses directly. The
#           turn's outcome is reported honestly: a streamed finish (stop) or
#           a STRUCTURED provider refusal (a served key the provider rejects)
#           — both green, both pinned by llm-piai-live-real.json.
#
# The key audit is three-layer (the byok-leak discipline): the scenario
# refuses to emit key material anywhere, the runner greps the RAW capture,
# and the matcher proves itself on a seeded line first.
#
# usage: [DSH_PIAI_LIVE_KEY=...] run-llm-piai-live.sh
#        (artifacts: runtime/dsh/artifacts/macos-cli-llm-piai-live)
set -eu
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT/runtime/dsh"

ART_DIR="$ROOT/runtime/dsh/artifacts/macos-cli-llm-piai-live"
TARGET="https://api.anthropic.com"

# 1. vendored upstream closure + host build (idempotent).
sh ../../external/ensure.sh > /dev/null
sh ../../external/ensure-dsh.sh
[ -x build/dsh-cli ] || sh host/build.sh
mkdir -p "$ART_DIR"
rm -f "$ART_DIR"/verdict*.json

LOG="$ART_DIR/logs.txt"
FORWARDER_LOG="$ART_DIR/forwarder.log"
RC=0
VERDICT="$ART_DIR/verdict.json"
cleanup() { [ -n "${FORWARDER_PID:-}" ] && kill "$FORWARDER_PID" 2>/dev/null || true; }
trap cleanup EXIT

if [ -z "${DSH_PIAI_LIVE_KEY:-}" ]; then
    # ---- the SKIP plane (the default CI shape) ------------------------------
    ./build/dsh-cli . scenario/llm-piai-live.js --http \
        --env "DSH_PIAI_LIVE_EGRESS=unavailable" > "$LOG" 2>&1 || RC=$?
    MANIFEST="$ROOT/test/e2e/scenarios/llm-piai-live.json"
    PLANE=skipped-honest
else
    # ---- the REAL plane: probe egress, stage the forwarder ------------------
    EGRESS=unavailable
    if node -e "fetch('$TARGET/', {signal: AbortSignal.timeout(10000)}).then(() => process.exit(0)).catch(() => process.exit(1))" 2>/dev/null; then
        EGRESS=available
    fi
    if [ "$EGRESS" != "available" ]; then
        # A key is served but the target is unreachable: the HONEST outcome is
        # the skip plane (reason egress-unreachable), never a transport
        # failure dressed up as a provider refusal.
        echo "llm-piai-live: a key is served but the target is unreachable — honest skip" >&2
        ./build/dsh-cli . scenario/llm-piai-live.js --http \
            --env "DSH_PIAI_LIVE_KEY=$DSH_PIAI_LIVE_KEY" \
            --env "DSH_PIAI_LIVE_EGRESS=unreachable" > "$LOG" 2>&1 || RC=$?
        MANIFEST="$ROOT/test/e2e/scenarios/llm-piai-live.json"
        VERDICT="$ART_DIR/verdict.json"
        PLANE=skipped-honest
        SKIP_REASON="key served but the target was unreachable from this machine — honest skip (egress-unreachable)"
    else
        node ci/anthropic-forwarder.mjs "$TARGET" > "$FORWARDER_LOG" 2>&1 &
        FORWARDER_PID=$!
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
        ./build/dsh-cli . scenario/llm-piai-live.js --http \
            --env "DSH_PIAI_LIVE_KEY=$DSH_PIAI_LIVE_KEY" \
            --env "DSH_PIAI_LIVE_BASE_URL=$FORWARDER_URL" \
            ${DSH_PIAI_LIVE_MODEL:+--env "DSH_PIAI_LIVE_MODEL=$DSH_PIAI_LIVE_MODEL"} \
            > "$LOG" 2>&1 || RC=$?
        MANIFEST="$ROOT/test/e2e/scenarios/llm-piai-live-real.json"
        VERDICT="$ART_DIR/verdict-llm-piai-live-real.json"
        PLANE=pass
    fi
fi

grep '"scenario":"llm.piai-live"' "$LOG" > "$ART_DIR/scenario.jsonl" || true
node "$ROOT/test/e2e/check.mjs" --manifest "$MANIFEST" --log "$LOG" \
    --out "$VERDICT"
if [ "$RC" -ne 0 ]; then
    echo "   FAIL: the host exited $RC (crash, or the scenario reported failure — see $LOG)" >&2
    exit 1
fi

# ---- the KEY AUDIT (three layers, the byok-leak discipline) ----------------
# layer 3: the matcher proves itself on a seeded line.
SCRATCH="$(mktemp /tmp/dsh-piai-live-audit.XXXXXX)"
printf 'seeded line with %s inside\n' "${DSH_PIAI_LIVE_KEY:-no-key-served}" > "$SCRATCH"
if ! grep -F -q -e "${DSH_PIAI_LIVE_KEY:-no-key-served}" "$SCRATCH"; then
    rm -f "$SCRATCH"
    echo "llm-piai-live: FAIL — the audit matcher cannot catch its own seeded value" >&2
    exit 1
fi
rm -f "$SCRATCH"
# layers 1-2: the scenario never logs it and the runner re-checks the RAW stream.
if [ -n "${DSH_PIAI_LIVE_KEY:-}" ]; then
    if grep -F -e "$DSH_PIAI_LIVE_KEY" "$LOG" >/dev/null; then
        echo "llm-piai-live: FAIL — the served key leaked into the log (HIGH finding)" >&2
        exit 1
    fi
    echo "   audit: served key absent from the raw log"
fi

# ---- the receipt (node-built: the JSON survives shell quoting untouched) ---
EVENTS="$(grep -c '"scenario":"llm.piai-live"' "$LOG")"
PIAI_PLANE="$PLANE" PIAI_EVENTS="$EVENTS" PIAI_ART="$ART_DIR" PIAI_SKIP_REASON="${SKIP_REASON:-}" node <<'NODE'
const fs = require('fs');
const plane = process.env.PIAI_PLANE;
const served = plane !== 'skipped-honest';
const receipt = {
  host: `${process.platform}-cli (${process.platform} ${process.arch})`,
  engine: 'quickjs-ng',
  engineVersion: '0.17.0',
  upstream: '@deepseek-ai/dsh-llm-pi-ai@0.1.6-alpha.2 (vendored verbatim, tgz sha256-pinned by external/ensure-dsh.sh)',
  scenario: 'llm.piai-live',
  plane,
  events: Number(process.env.PIAI_EVENTS),
  status: plane,
  reason: served ? (process.env.PIAI_SKIP_REASON || 'a served key was present and the real plane ran') : 'no key was served (DSH_PIAI_LIVE_KEY unset) — the honest skip posture',
  proves: [
    'the served-key discipline: the scenario runs a REAL pi-ai turn ONLY when the runner serves a key through the launch env (referenced by apiKeyEnv, never logged); without a key it emits the pinned skip plane and stays green — skipped-honest, never faked, never an environment red',
    'the real plane mounts the multi-protocol route over the fetch bridge (llm/piai-bridge + llm/piai honesty events) and reports the outcome honestly: a streamed finish (stop) or a STRUCTURED provider refusal — both green, both manifest-pinned; the key value itself may appear nowhere in the raw capture (matcher self-check proven)',
  ],
};
fs.writeFileSync(`${process.env.PIAI_ART}/receipt.json`, JSON.stringify(receipt, null, 2) + '\n');
NODE

echo "llm-piai-live: $PLANE ($EVENTS scenario events; verdict $VERDICT)"
