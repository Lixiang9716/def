#!/bin/sh
# runtime/dsh/ci/run-perf-turn-latency.sh — the CLI proof run for the
# turn-latency MEASUREMENT leg (scenario `perf.turn-latency`, the
# device-light pass's turn leg): one cold boot (mobile profile over the mock
# route) + ONE mock session turn over the boot spine — the path the on-device
# seats (session-live / restart families) actually drive — segmented the way
# a user feels it:
#
#   promptToFirstDeltaMs   followup → the FIRST streamed content delta
#                          (the time-to-first-token face)
#   firstDeltaToSettleMs   first delta → whenIdle (the streaming tail + the
#                          loop's journal/projection work)
#   turnMs                 followup → settled (the whole turn)
#
# perf-baseline's sessionTurnMs is ONE number over the page's write-surface
# wire, so a regression hiding in the time-to-first-token phase averages
# out; this leg names each phase. The measured numbers are emitted into the
# scenario's event stream (D8) and extracted from the captured log into the
# receipt — the deterministic log carries the events and their stable fields
# only (E2E by logs), never a measured value. The device sibling
# (hosts/android/ci/run-perf-turn-latency.sh) measures the SAME segments on
# the Android seat and lands its own receipt; this CLI leg is the simulation
# half that stays runnable without hardware.
#
# The captured log is verified one-to-one against
# test/e2e/scenarios/perf-turn-latency.json. Artifacts:
# runtime/dsh/artifacts/macos-cli-perf-turn-latency/.
#
# usage: run-perf-turn-latency.sh   (artifacts: .../macos-cli-perf-turn-latency)
set -eu
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT/runtime/dsh"

ART_DIR="$ROOT/runtime/dsh/artifacts/macos-cli-perf-turn-latency"
MOCK_KEY="mock-key-0001"
MOCK_WAIT_DEADLINE_SECONDS=15

# 1. vendored upstream closure: pinned + sha256-verified.
sh ../../external/ensure.sh > /dev/null
sh ../../external/ensure-dsh.sh

# 2. build the spike host when the binary is missing.
[ -x build/dsh-cli ] || sh ../../src/build.sh

# 3. loopback mock LLM (one scripted success, repeat-last guards a retry);
#    instant wire (no pacing) — the segments are measured, not paced.
MOCK_LOG="$(mktemp /tmp/dsh-mock-llm-turn-lat.XXXXXX)"
LOG="$(mktemp /tmp/dsh-perf-turn-lat.XXXXXX)"
DSH_MOCK_SEQUENCE="success" DSH_MOCK_REPEAT_LAST=1 \
    node ci/mock-llm-server.mjs > "$MOCK_LOG" 2>&1 &
MOCK_PID=$!
cleanup() {
    kill "$MOCK_PID" 2>/dev/null || true
    wait "$MOCK_PID" 2>/dev/null || true
    rm -f "$MOCK_LOG" "$LOG"
}
trap cleanup EXIT INT TERM

MOCK_URL=""
polled=0
until grep -s '^MOCK_BASE_URL=' "$MOCK_LOG" > /dev/null; do
    if ! kill -0 "$MOCK_PID" 2>/dev/null; then
        echo "mock llm server died before announcing its endpoint:" >&2
        cat "$MOCK_LOG" >&2
        exit 1
    fi
    polled=$((polled + 1))
    if [ "$polled" -gt $((MOCK_WAIT_DEADLINE_SECONDS * 20)) ]; then
        echo "mock llm server did not announce within ${MOCK_WAIT_DEADLINE_SECONDS}s" >&2
        exit 1
    fi
    sleep 0.05
done
MOCK_URL="$(sed -n 's/^MOCK_BASE_URL=//p' "$MOCK_LOG" | head -1)"
echo "mock llm server: $MOCK_URL" >&2

# 4. run the scenario (the runtime's Date.now is the only clock inside the
#    measured process — no side channel, D8).
./build/dsh-cli . scenario/perf-turn-latency.js \
    --http \
    --env "DSH_MOCK_LLM_URL=$MOCK_URL" \
    --env "DSH_MOCK_LLM_KEY=$MOCK_KEY" > "$LOG"

# 5. one-to-one verification, then extract the measured segments from the
#    SAME captured log into the receipt.
mkdir -p "$ART_DIR"
cp "$LOG" "$ART_DIR/logs.txt"
grep '^dsh.runtime.log:' "$LOG" > "$ART_DIR/scenario.jsonl"
node "$ROOT/test/e2e/check.mjs" \
    --manifest "$ROOT/test/e2e/scenarios/perf-turn-latency.json" \
    --log "$LOG" \
    --out "$ART_DIR/verdict.json"

EVENTS="$(grep -c '"scenario":"perf.turn-latency"' "$LOG")"
MEASURED="$(node -e '
const fs = require("fs");
const rows = fs.readFileSync(process.argv[1], "utf8").split("\n")
  .filter((l) => l.startsWith("dsh.runtime.log:"))
  .map((l) => JSON.parse(l.slice("dsh.runtime.log:".length)))
  .map((r) => (Array.isArray(r.data) ? r.data[0] : null))
  .filter((p) => p && p.scenario === "perf.turn-latency");
const pick = (event) => rows.find((p) => p.event === event) ?? null;
const boot = pick("perf.turn.boot");
const latency = pick("perf.turn.latency");
if (!boot || !latency) {
  console.error("perf-turn-latency: a measured event is missing from the log"); process.exit(1);
}
console.log(JSON.stringify({
  bootMs: boot.bootMs,
  promptToFirstDeltaMs: latency.promptToFirstDeltaMs,
  firstDeltaToSettleMs: latency.firstDeltaToSettleMs,
  turnMs: latency.turnMs,
  deltas: latency.deltas,
}));
' "$ART_DIR/scenario.jsonl")"

cat > "$ART_DIR/receipt.json" <<EOF
{
  "host": "$(uname -s | tr '[:upper:]' '[:lower:]')-cli ($(uname -sr) $(uname -m))",
  "engine": "quickjs-ng",
  "engineVersion": "0.17.0",
  "quickjsPin": "0.17.0+fork-tostring+async-context+tc39+promise-mark (63b33ea5)",
  "upstream": "@deepseek-ai/dsh-* 0.1.6-alpha.2 (vendored verbatim)",
  "scenario": "perf.turn-latency",
  "measured": $MEASURED,
  "wire": "boot spine (agent.followup → onSse → whenIdle), the on-device seats' path — NOT the page's write-surface wire perf-baseline's sessionTurnMs rides",
  "mockPacing": "success behavior (instant wire); the segments bound the runtime's own cost on this machine",
  "machine": {
    "os": "$(uname -s) $(uname -sr)",
    "arch": "$(uname -m)",
    "chip": "$(sysctl -n machdep.cpu.brand_string 2>/dev/null || echo unknown)",
    "memoryBytes": "$(sysctl -n hw.memsize 2>/dev/null || echo unknown)",
    "node": "$(node --version)",
    "note": "numbers are machine-local wall-clock; jittery by nature — the manifest pins events + stable fields only, measured values live here"
  },
  "deviceSibling": "hosts/android/ci/run-perf-turn-latency.sh (same segments on the Android seat; lands its own receipt)",
  "checker": "test/e2e/scenarios/perf-turn-latency.json",
  "events": $EVENTS,
  "exitCode": 0
}
EOF
echo "perf.turn-latency: artifacts in $ART_DIR (verdict, logs, receipt)" >&2
node -e '
const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const m = r.measured;
console.error(`perf.turn-latency: bootMs=${m.bootMs} promptToFirstDeltaMs=${m.promptToFirstDeltaMs} firstDeltaToSettleMs=${m.firstDeltaToSettleMs} turnMs=${m.turnMs} deltas=${m.deltas}`);
' "$ART_DIR/receipt.json" >&2
