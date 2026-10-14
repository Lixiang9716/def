#!/bin/sh
# runtime/dsh/ci/run-llm-piai-e2e.sh — the CLI proof AGGREGATE for the pi-ai
# family: the four named-invocation legs of the multi-protocol LLM row, run
# in order by ONE entry point (each leg keeps its own artifacts, verdict,
# and receipt — this runner adds the shared prerequisites and the roll-up).
#
#   leg 1  run-llm-piai-probe.sh          — the loopback anchor (leg①): the
#          gated mount's contract face + one REAL openai-completions turn,
#          byte-for-byte the pre-existing evidence (12 events).
#   leg 2  run-llm-piai-user-endpoint.sh  — the gate + bridge leg (leg②):
#          the named-exception mount gate (deterministic), the bridged dial
#          to the well-known endpoint through the node-side forwarder, and
#          the BYOK save-path phase. When the runner's egress probe finds no
#          network, it runs its HONEST SKIP plane and stays green — an
#          unreachable network is a recorded posture, not a failure.
#   leg 3  run-byok-piai-anthropic.sh     — the BYOK wire leg (leg③): the
#          save-path mount + ONE REAL anthropic-messages turn over the
#          in-process loopback server, the rebind-over-mount round, the 401
#          face, the clear. Deterministic, no network.
#   leg 4  run-llm-piai-live.sh           — the served-key live leg: skip-
#          honest unless the caller serves DSH_PIAI_LIVE_KEY (+ egress);
#          green in both planes by design.
#
# Prerequisites run ONCE here so a missing environment fails fast with a
# named step.
#
# usage: run-llm-piai-e2e.sh   (roll-up: artifacts/macos-cli-llm-piai-e2e/)
set -eu
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT/runtime/dsh"

ROLLUP="$ROOT/runtime/dsh/artifacts/macos-cli-llm-piai-e2e"
mkdir -p "$ROLLUP"

# ---- prerequisites (environment/pre-heat first; named, fail fast) ---------
echo "[preheat] vendored upstream closure (ensure + ensure-dsh)" >&2
sh ../../external/ensure.sh > /dev/null
sh ../../external/ensure-dsh.sh > /dev/null
echo "[preheat] host binary (built only when missing)" >&2
[ -x build/dsh-cli ] || sh ../../src/build.sh

# ---- the four legs ---------------------------------------------------------
FAILED=0
STATUS=""

run_leg() {
    name="$1"; script="$2"
    echo "[leg] $name — sh ci/$script" >&2
    if sh "ci/$script"; then
        STATUS="$STATUS\n$name: PASS"
    else
        rc=$?
        STATUS="$STATUS\n$name: FAIL (exit $rc)"
        FAILED=$((FAILED + 1))
    fi
}

# leg 4 serves a key ONLY when the caller exported one (the served-key
# discipline: the orchestrator never invents credentials).
run_leg "1 piai-probe (loopback anchor)" "run-llm-piai-probe.sh"
run_leg "2 piai-user-endpoint (gate + bridge; honest-skip without egress)" "run-llm-piai-user-endpoint.sh"
run_leg "3 byok-piai-anthropic (BYOK wire)" "run-byok-piai-anthropic.sh"
run_leg "4 piai-live (served-key; honest-skip without a key)" "run-llm-piai-live.sh"

# ---- the roll-up -----------------------------------------------------------
{
    echo "{"
    echo "  \"aggregate\": \"llm-piai-e2e\","
    echo "  \"legs\": [\"llm-piai-probe\", \"llm-piai-user-endpoint\", \"byok-piai-anthropic\", \"llm-piai-live\"],"
    echo "  \"host\": \"$(uname -s | tr '[:upper:]' '[:lower:]')-cli ($(uname -sr) $(uname -m))\","
    echo "  \"failedLegs\": $FAILED,"
    echo "  \"perLegReceipts\": \"runtime/dsh/artifacts/macos-cli-{llm-piai-probe,llm-piai-user-endpoint,byok-piai-anthropic,llm-piai-live}/receipt.json\""
    echo "}"
} > "$ROLLUP/summary.json"

printf "llm-piai-e2e roll-up:$STATUS\n" > "$ROLLUP/summary.txt"
printf "llm-piai-e2e roll-up:$STATUS\n" >&2

if [ "$FAILED" -ne 0 ]; then
    echo "llm-piai-e2e: FAIL ($FAILED leg(s) failed — see the per-leg artifacts)" >&2
    exit 1
fi
echo "llm-piai-e2e: PASS (4 legs; roll-up $ROLLUP/summary.json)" >&2
