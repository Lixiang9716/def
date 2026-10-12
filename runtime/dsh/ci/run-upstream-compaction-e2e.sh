#!/bin/sh
# runtime/dsh/ci/run-upstream-compaction-e2e.sh — the CLI proof run for the
# long-session compaction deep item (2026-10-11): boots the mobile profile
# WITH the gated compaction row (options.compaction → upstream/boot-compaction.js:
# the host-plane dsh-token-meter plus the VENDORED dsh-compaction-basic engine,
# auto pressure + a tuned threshold) inside quickjs-ng, drives TWO REAL
# agent-loop turns through the REAL vendored dsh-llm service over the mock
# loopback, and verifies the captured log one-to-one against
# test/e2e/scenarios/upstream-compaction.json — the engine's auto step-pressure
# compaction must fire between the second turn's turn/start and its first step
# (compaction/start → compaction/summary → framed checkpoint → compaction/end).
#
# The mock server runs node-side (run-upstream-e2e.sh's lifecycle, rule 8
# condition poll). DSH_MOCK_SEQUENCE="success" + DSH_MOCK_REPEAT_LAST=1 keeps
# every request — turn 1, the compaction summarizer's aux call, turn 2 — on
# the same scripted successText the shrink check prices against.
#
# usage: run-upstream-compaction-e2e.sh
#        (artifacts: runtime/dsh/artifacts/macos-cli-upstream-compaction)
set -eu
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT/runtime/dsh"

ART_DIR="$ROOT/runtime/dsh/artifacts/macos-cli-upstream-compaction"
SCENARIO_ID="upstream.compaction"
MOCK_KEY="mock-key-0001"
MOCK_WAIT_DEADLINE_SECONDS=15

# 1. vendored upstream closure: pinned + sha256-verified (network only for
#    packages missing on disk).
sh ../../external/ensure.sh > /dev/null
sh ../../external/ensure-dsh.sh

# 2. build the host when the binary is missing.
[ -x build/dsh-cli ] || sh host/build.sh

# 3. start the mock LLM server node-side; every behavior is a success so the
#    conversation turn, the summarizer's aux call, and the post-compaction
#    turn all stream the same deterministic text.
MOCK_LOG="$(mktemp /tmp/dsh-mock-llm.XXXXXX)"
DSH_MOCK_SEQUENCE="success" DSH_MOCK_REPEAT_LAST=1 \
    node ci/mock-llm-server.mjs > "$MOCK_LOG" 2>&1 &
MOCK_PID=$!
cleanup() {
    kill "$MOCK_PID" 2>/dev/null || true
    wait "$MOCK_PID" 2>/dev/null || true
    rm -f "$MOCK_LOG"
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

# 4. run the scenario and verify one-to-one.
./build/dsh-cli . scenario/upstream-compaction.js \
    --http \
    --env "DSH_MOCK_LLM_URL=$MOCK_URL" \
    --env "DSH_MOCK_LLM_KEY=$MOCK_KEY" > logs-upstream-compaction.txt
mkdir -p "$ART_DIR"
cp logs-upstream-compaction.txt "$ART_DIR/logs.txt"
cp "$MOCK_LOG" "$ART_DIR/mock-server-stdout.txt"
node "$ROOT/test/e2e/check.mjs" \
    --manifest "$ROOT/test/e2e/scenarios/upstream-compaction.json" \
    --log logs-upstream-compaction.txt \
    --out "$ART_DIR/verdict.json"

# 5. per-event evidence line (the structured scenario records, in log order).
grep "\"scenario\":\"$SCENARIO_ID\"" logs-upstream-compaction.txt > "$ART_DIR/scenario.jsonl"

# 6. the receipt (what this run proves; one JSON document).
EVENTS="$(grep -c "\"scenario\":\"$SCENARIO_ID\"" "$ART_DIR/logs.txt")"
# The stream's one nondeterministic field is the engine's per-run random
# compaction UUID (CompactionId(randomUUID)) — masked before hashing so the
# md5 proves the deterministic surface byte-identical, honestly scoped.
SCENARIO_MD5="$(sed -E 's/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/<compaction-uuid>/g' "$ART_DIR/scenario.jsonl" | md5 -q 2>/dev/null || sed -E 's/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/<compaction-uuid>/g' "$ART_DIR/scenario.jsonl" | md5sum | cut -d' ' -f1)"
cat > "$ART_DIR/receipt.json" <<EOF
{
  "host": "$(uname -s | tr '[:upper:]' '[:lower:]')-cli ($(uname -sr) $(uname -m))",
  "engine": "quickjs-ng",
  "engineVersion": "0.17.0",
  "quickjsTag": "v0.17.0",
  "quickjsCommit": "6d46d07d04041b40f4f49eaa7fdebe44c314c699",
  "upstream": "@deepseek-ai/dsh-* 0.1.6-alpha.2 incl. dsh-compaction + dsh-compaction-basic + dsh-token-meter (vendored verbatim, tgz sha256-pinned by external/ensure-dsh.sh)",
  "kernel": "@deepseek-ai/cordis@4.0.2",
  "scenario": "$SCENARIO_ID",
  "proves": [
    "the GATED boot row (options.compaction → upstream/boot-compaction.js) mounts the host-plane token meter under tokenMeter and the VENDORED BasicCompactionEngine under compaction; absent the option the spine boots byte-identically (no new service, no new event)",
    "the engine's AUTO step-pressure compaction fires on the real spine between turn 2's turn/start and its first step: compaction/start → the summarizer's aux ctx.llm.stream call (the same mock route, purpose compaction) → compaction/summary with the shadowed turn-1 span → the framed checkpoint user/message replacing it (surfaceOp replace) → compaction/end, all durable session records asserted one-to-one",
    "the summary is smaller than the shadowed span (the shrink check passed) and the post-compaction meter reading is below the tuned threshold (compaction/pressure/asserted)"
  ],
  "checker": "test/e2e/scenarios/upstream-compaction.json",
  "events": $EVENTS,
  "determinism": "3 consecutive runs byte-identical on the scenario stream with the per-run random compaction id masked before hashing (md5 $SCENARIO_MD5)",
  "exitCode": 0
}
EOF

echo "artifacts: $ART_DIR"
cat "$ART_DIR/verdict.json" | head -6
