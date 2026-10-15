#!/bin/sh
# run-llm-chaos-e2e.sh — the CHAOS legs for the LLM transport guards
# (test-hardening row 1, doc/test-coverage.md): the vendored dsh-llm-mock-server
# is armed with a hostile profile (ci/mock-llm-server.mjs DSH_MOCK_CHAOS — a
# preset over the mock's OWN script vocabulary, so the SSE wire bytes stay the
# real backend's), and each leg asserts the guard layer's DESIGNED reaction:
#
#   no-headers     (CLI) the wire dies before any response head → fast
#                  TRANSPORT → the retry-pacing seam paces the first retry at
#                  15000ms (llm/retry journal delayMs) AND the turn-level
#                  backstop (turn-watchdog, scenario-armed at 1.5s) cancels the
#                  wedged turn before the paced retry executes
#   truncation     (CLI) clean close without [DONE] → STREAM_CLOSED,
#                  non-retryable, honest turn error, no retry scheduled
#   malformed-sse  (CLI) non-JSON data payload → MALFORMED_RESPONSE,
#                  non-retryable, honest turn error, no retry scheduled
#   oversized      (CLI) ONE 2 MiB SSE delta → the byte bridge carries it and
#                  the turn completes with the full text (length-pinned)
#   slow-drip      (node) the success stream paced past the read-idle budget →
#                  the attempt dies TIMEOUT, retryable per the vendored policy
#
# The slow-drip leg runs node-side (ci/llm-chaos-read-idle.mjs, the REAL
# llm-transport.js over a real async gateway): the CLI smoke backend drains
# the response body synchronously inside the httpFetch call, so a mid-body
# stall cannot interleave with the guard's timer on that host (its own 5s
# SO_RCVTIMEO + http.end preempts any read-idle reaction as STREAM_CLOSED).
# The guard's logic is unit-owned (test/panel/llm-transport-read-idle.test.js);
# this leg owns the real-wire behavior; the device seats own the async-gateway
# full-stack shape.
#
# Idempotent and CI-safe, same contract as run-upstream-e2e.sh: re-fetches any
# missing vendored package, rebuilds the host only when needed, waits for the
# mock's MOCK_BASE_URL announce by condition poll (rule 8), and verifies every
# CLI leg one-to-one against its manifest (test/e2e/scenarios/llm-chaos-*.json).
#
# usage: run-llm-chaos-e2e.sh   (artifacts: runtime/dsh/artifacts/macos-cli-llm-chaos)
set -eu
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT/runtime/dsh"

ART_DIR="$ROOT/runtime/dsh/artifacts/macos-cli-llm-chaos"
MOCK_KEY="mock-key-0001"
MOCK_WAIT_DEADLINE_SECONDS=15
CLI_PROFILES="no-headers truncation malformed-sse oversized"
# The drip interval the slow-drip leg sizes its read-idle budget against
# (800ms budget << 5000ms drip: the first gap provably outlasts the guard).
DRIP_MS=5000
READ_IDLE_MS=800

# 1. vendored upstream closure + the node resolution layout (the node leg).
sh ../../external/ensure.sh > /dev/null
sh ../../external/ensure-dsh.sh
sh ci/parity-node-modules.sh --parity-only > /dev/null

# 2. build the host when the binary is missing.
[ -x build/dsh-cli ] || sh ../../src/build.sh

mkdir -p "$ART_DIR"

# start_mock <name> [env...]: one fresh chaos mock; announces on MOCK_BASE_URL.
start_mock() {
    _name="$1"; shift
    _log="$ART_DIR/mock-${_name}-stdout.txt"
    env "$@" node ci/mock-llm-server.mjs > "$_log" 2>&1 &
    _pid=$!
    _polled=0
    until grep -s '^MOCK_BASE_URL=' "$_log" > /dev/null; do
        if ! kill -0 "$_pid" 2>/dev/null; then
            echo "mock llm server $_name died before announcing its endpoint:" >&2
            cat "$_log" >&2
            exit 1
        fi
        _polled=$((_polled + 1))
        if [ "$_polled" -gt $((MOCK_WAIT_DEADLINE_SECONDS * 20)) ]; then
            echo "mock llm server $_name did not announce within ${MOCK_WAIT_DEADLINE_SECONDS}s" >&2
            exit 1
        fi
        sleep 0.05
    done
    MOCK_PID=$_pid
    MOCK_URL="$(sed -n 's/^MOCK_BASE_URL=//p' "$_log" | head -1)"
    echo "mock llm server $_name: $MOCK_URL" >&2
}

stop_mock() {
    [ -n "${MOCK_PID:-}" ] || return 0
    kill "$MOCK_PID" 2>/dev/null || true
    wait "$MOCK_PID" 2>/dev/null || true
    MOCK_PID=""
}
trap stop_mock EXIT INT TERM

# 3. the CLI profile legs: one fresh hostile mock per run (a profile is a
#    persistent condition — every attempt of a run sees the same behavior).
#    Each leg's evidence lands in its own artifact subdir with the matrix
#    deliverables (logs.txt + scenario.jsonl + receipt.json + verdict.json).
for profile in $CLI_PROFILES; do
    start_mock "$profile" \
        DSH_MOCK_CHAOS="$profile" DSH_MOCK_REPEAT_LAST=1 DSH_MOCK_LLM_KEY="$MOCK_KEY"
    LEG_DIR="$ART_DIR/$profile"
    mkdir -p "$LEG_DIR"
    ./build/dsh-cli . scenario/llm-chaos.js \
        --http \
        --env "DSH_MOCK_LLM_URL=$MOCK_URL" \
        --env "DSH_MOCK_LLM_KEY=$MOCK_KEY" \
        --env "DSH_CHAOS_PROFILE=$profile" > "$LEG_DIR/logs.txt"
    stop_mock
    grep "\"scenario\":\"llm.chaos.$profile\"" "$LEG_DIR/logs.txt" > "$LEG_DIR/scenario.jsonl"
    node "$ROOT/test/e2e/check.mjs" \
        --manifest "$ROOT/test/e2e/scenarios/llm-chaos-$profile.json" \
        --log "$LEG_DIR/logs.txt" \
        --out "$LEG_DIR/verdict.json"
    cat > "$LEG_DIR/receipt.json" <<EOF
{
  "scenario": "llm.chaos.$profile",
  "leg": "runtime/dsh/ci/run-llm-chaos-e2e.sh ($profile)",
  "mock": "vendored dsh-llm-mock-server via ci/mock-llm-server.mjs DSH_MOCK_CHAOS=$profile",
  "manifest": "test/e2e/scenarios/llm-chaos-$profile.json",
  "exitCode": 0
}
EOF
done

# 4. the node slow-drip leg (the read-idle watchdog over a real async wire).
start_mock slow-drip \
    DSH_MOCK_CHAOS=slow-drip DSH_MOCK_REPEAT_LAST=1 \
    DSH_MOCK_CHUNK_DELAY_MS="$DRIP_MS" DSH_MOCK_LLM_KEY="$MOCK_KEY"
mkdir -p "$ART_DIR/read-idle"
DSH_MOCK_LLM_URL="$MOCK_URL" DSH_MOCK_LLM_KEY="$MOCK_KEY" DSH_READ_IDLE_MS="$READ_IDLE_MS" \
    node ci/llm-chaos-read-idle.mjs > "$ART_DIR/read-idle/logs.txt"
cp "$ART_DIR/mock-slow-drip-stdout.txt" "$ART_DIR/read-idle/mock-server-stdout.txt"
stop_mock

# 5. the receipt (what these legs prove; one JSON document).
cat > "$ART_DIR/receipt.json" <<EOF
{
  "scenario": "llm.chaos.*",
  "profiles": ["no-headers", "truncation", "malformed-sse", "oversized", "slow-drip"],
  "mock": "vendored dsh-llm-mock-server behaviors (DSH_MOCK_CHAOS presets; no vendored edits, no transport changes)",
  "proves": [
    "no-headers: a wire that dies before its response head fails FAST as TRANSPORT; the retry-pacing seam (llm-retry-pacing.js) paces the first retry at 15000ms (llm/retry journal delayMs, adopted verbatim by dsh-llm-retry's recover())",
    "no-headers: the turn-level backstop (turn-watchdog.js armed at its module contract, 1.5s) cancels the wedged turn with a watchdog cause BEFORE the paced retry executes — one wire request total, no llm/retry-started",
    "truncation: a stream that closes without [DONE] is STREAM_CLOSED (parser close contract) and schedules no retry — the turn errors honestly",
    "malformed-sse: a non-JSON data payload is MALFORMED_RESPONSE (parser payload contract), non-retryable — the turn errors honestly",
    "oversized: one 2 MiB SSE delta survives the gateway byte bridge and the incremental parser; the turn completes with the full scripted text",
    "slow-drip (node-backed): deltas flow, then a silent gap outlasts the read-idle budget — the guard aborts the attempt as TIMEOUT, retryable per the vendored retry policy (the CLI smoke backend cannot interleave guard timers with a mid-body stall; see the file header)"
  ],
  "exitCode": 0
}
EOF

echo "chaos legs: all green (artifacts: $ART_DIR)"
