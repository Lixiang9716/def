#!/bin/sh
# runtime/dsh/ci/run-session-multi-stress-e2e.sh — the CLI proof run for the
# MULTI-SESSION INTERLEAVED STRESS leg (test-hardening row 21): FOUR sessions
# on ONE booted spine, driven through interleaved rounds with PACED mock
# streams (DSH_MOCK_CHUNK_DELAY_MS) so turn windows genuinely overlap — the
# T-0210 burst shape, asserted at the runtime journal. TWO dsh-cli processes
# over ONE pinned profile container (DSH_SPIKE_TMPDIR):
#
#   process 1 (leg drive): round 1 bursts alpha/beta/gamma concurrently;
#     round 2a bursts alpha and beta and DELTA is created MID-FLIGHT —
#     while alpha's and beta's round-2 turns are provably still open; round
#     2b runs gamma's scripted TOOL turn SOLO on the idle wire (the mock's
#     sequence is consumed in wire-arrival order and an idle wire is the
#     only boundary that pins a position, so the tool_call_success slot
#     provably lands on gamma's request — a mis-attributed tool landing
#     fails the leg's firehose loud, in the moment); round 3 bursts all
#     four (the 4-way peak-open proof).
#   process 2 (leg recover, same container): alpha resumes through the
#     config-driven start; beta/gamma/delta resume EXPLICITLY through
#     ctx.agents.resume — four independent recoveries from four independent
#     artifacts, each seed re-asserted against its own drive-side shape, each
#     journal continued by its own recovery turn (K+1).
#
# The refusals that must NOT appear: `corrupt session log` anywhere (a torn
# or half-written artifact) and `cannot resume` (the unconfigured path). The
# mock's telemetry must show EXACTLY 16 served requests (12 drive + 4
# recover) — a hidden retry anywhere in the stress shifts the script and
# fails the leg here. The concatenated log is verified one-to-one against
# test/e2e/scenarios/session-multi-stress.json. Artifacts:
# runtime/dsh/artifacts/macos-cli-session-multi-stress/.
#
# usage: run-session-multi-stress-e2e.sh
set -eu
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT/runtime/dsh"

ART_DIR="$ROOT/runtime/dsh/artifacts/macos-cli-session-multi-stress"
MOCK_KEY="mock-key-0001"
MOCK_WAIT_DEADLINE_SECONDS=15
EXPECTED_MOCK_RESULTS=16  # 12 drive-side (3 + 5 + 4) + 4 recover-side

# 1. vendored upstream closure: pinned + sha256-verified (includes the
#    session-persistence family this leg mounts).
sh ../../external/ensure.sh > /dev/null
sh ../../external/ensure-dsh.sh

# 2. build the spike host when the binary is missing.
[ -x build/dsh-cli ] || sh ../../src/build.sh

# 3. ONE pinned profile container for BOTH processes — the per-session
#    recovery claim is about THIS directory's disk contents. The legs' logs
#    live in /tmp scratch — never the tree (three stale logs-*.txt once rode
#    a PR in).
CONTAINER="$(mktemp -d /tmp/dsh-multistress.XXXXXX)"
LOG_DRIVE="$(mktemp /tmp/dsh-multistress-drive.XXXXXX)"
LOG_RECOVER="$(mktemp /tmp/dsh-multistress-recover.XXXXXX)"

# 4. the paced mock: 12 scripted requests (slow_success drips, the
#    tool_call_success at position 7 = gamma's SOLO round-2b request on an
#    idle wire), then the last behavior repeats for the 4 recovery turns.
#    500ms/chunk keeps every burst stream provably open while its siblings
#    run and gives the mid-flight insertion a wide deterministic window.
MOCK_LOG="$(mktemp /tmp/dsh-mock-llm-multistress.XXXXXX)"
DSH_MOCK_SEQUENCE='slow_success slow_success slow_success slow_success slow_success slow_success tool_call_success slow_success slow_success slow_success slow_success slow_success' \
    DSH_MOCK_REPEAT_LAST=1 \
    DSH_MOCK_CHUNK_DELAY_MS=500 \
    DSH_MOCK_TOOL_NAME='todo_write' \
    DSH_MOCK_TOOL_ARGS='{"todos":[{"content":"Track the interleaved stress round","status":"in_progress"}]}' \
    node ci/mock-llm-server.mjs > "$MOCK_LOG" 2>&1 &
MOCK_PID=$!
cleanup() {
    kill "$MOCK_PID" 2>/dev/null || true
    wait "$MOCK_PID" 2>/dev/null || true
    rm -f "$MOCK_LOG" "$LOG_DRIVE" "$LOG_RECOVER"
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
echo "mock llm server: $MOCK_URL (12-entry script, slow_success @ 500ms/chunk, tool_call at 7)" >&2
echo "profile container: $CONTAINER" >&2

# 5. process 1: the drive leg (exits on its own — no kill boundary in this
#    leg; every turn completes).
if ! DSH_SPIKE_TMPDIR="$CONTAINER" ./build/dsh-cli . scenario/session-multi-stress.js \
    --http \
    --env "DSH_MOCK_LLM_URL=$MOCK_URL" \
    --env "DSH_MOCK_LLM_KEY=$MOCK_KEY" \
    --env "DSH_STRESS_LEG=drive" > "$LOG_DRIVE" 2>&1; then
    echo "the drive leg failed:" >&2
    tail -30 "$LOG_DRIVE" >&2
    exit 1
fi

# 6. REAL-DISK audit between the processes: each of the four sessions must
#    have its OWN materialized artifact on the container disk — the files
#    process 2 will recover from, one per session.
DRIVE_FILES="$(find "$CONTAINER/dsh/sessions" -type f -size +0 2>/dev/null | wc -l | tr -d ' ')"
if [ "$DRIVE_FILES" -lt 4 ]; then
    echo "expected >= 4 materialized session artifacts after the drive leg, found $DRIVE_FILES:" >&2
    find "$CONTAINER" -maxdepth 5 >&2 || true
    exit 1
fi
DRIVE_BYTES="$(find "$CONTAINER/dsh/sessions" -type f -size +0 -exec stat -f %z {} \; | head -1)"
echo "after drive: $DRIVE_FILES artifacts on the container disk (smallest listed: $DRIVE_BYTES bytes)" >&2

# 7. process 2: the recovery leg (same container — four independent
#    resumes, each from its OWN artifact, each journal continued).
if ! DSH_SPIKE_TMPDIR="$CONTAINER" ./build/dsh-cli . scenario/session-multi-stress.js \
    --http \
    --env "DSH_MOCK_LLM_URL=$MOCK_URL" \
    --env "DSH_MOCK_LLM_KEY=$MOCK_KEY" \
    --env "DSH_STRESS_LEG=recover" > "$LOG_RECOVER" 2>&1; then
    echo "the recover leg failed:" >&2
    tail -30 "$LOG_RECOVER" >&2
    exit 1
fi
RECOVER_FILES="$(find "$CONTAINER/dsh/sessions" -type f -size +0 2>/dev/null | wc -l | tr -d ' ')"
echo "after recover: $RECOVER_FILES artifacts on the container disk" >&2

# 8. the refusals that must NOT appear: a torn or half-written artifact
#    (the backend's loud corrupt path) and the unconfigured resume.
if grep -q "corrupt session log" "$LOG_DRIVE" "$LOG_RECOVER"; then
    echo "a recovered artifact hit the loud corrupt path:" >&2
    grep -n "corrupt session log" "$LOG_DRIVE" "$LOG_RECOVER" >&2
    exit 1
fi
if grep -q "cannot resume" "$LOG_DRIVE" "$LOG_RECOVER"; then
    echo "a leg hit the loud unconfigured-persistence path:" >&2
    grep -n "cannot resume" "$LOG_DRIVE" "$LOG_RECOVER" >&2
    exit 1
fi

# 9. the mock's own telemetry: EXACTLY 16 served requests. Any hidden retry
#    (a stream death the transport absorbed) shifts the scripted sequence
#    and invalidates the attribution arrangement — the leg fails here, not
#    quietly.
MOCK_RESULTS="$(grep -c '"type":"result"' "$MOCK_LOG" || true)"
if [ "$MOCK_RESULTS" -ne "$EXPECTED_MOCK_RESULTS" ]; then
    echo "the mock served $MOCK_RESULTS requests, expected exactly $EXPECTED_MOCK_RESULTS — a retry or a stray turn shifted the script:" >&2
    grep '"type":"result"' "$MOCK_LOG" >&2 || true
    exit 1
fi

# 10. one-to-one verification over the CONCATENATED log (drive leg first,
#     the recover leg second — the boundary the manifest's event order pins).
mkdir -p "$ART_DIR"
cat "$LOG_DRIVE" "$LOG_RECOVER" > "$ART_DIR/logs.txt"
cp "$MOCK_LOG" "$ART_DIR/mock-server-stdout.txt"
grep 'dsh.runtime.log:' "$ART_DIR/logs.txt" > "$ART_DIR/scenario.jsonl" || true
EVENTS="$(grep -c '"scenario":"session.multi.stress"' "$ART_DIR/logs.txt" || true)"
node "$ROOT/test/e2e/check.mjs" \
    --manifest "$ROOT/test/e2e/scenarios/session-multi-stress.json" \
    --log "$ART_DIR/logs.txt" \
    --out "$ART_DIR/verdict.json"

cat > "$ART_DIR/receipt.json" <<EOF
{
  "host": "$(uname -s | tr '[:upper:]' '[:lower]')-cli ($(uname -sr) $(uname -m))",
  "engine": "quickjs-ng",
  "upstream": "@deepseek-ai/dsh-session-persistence-jsonl@0.1.6-alpha.2 (vendored verbatim, tgz sha256-pinned by external/ensure-dsh.sh)",
  "scenario": "session.multi.stress",
  "proves": [
    "4 sessions on ONE spine round through interleaved turns with PACED streams (500ms/chunk) so turn windows genuinely overlap — the T-0210 burst shape, asserted at the runtime journal",
    "every journal frame lands in its owning session's open turn: the ctx session/event firehose demands per-session seq CONTIGUITY (a lost or duplicated record is the T-0210 recorded-nowhere class), one open turn at a time numbered 1..K without gaps or duplicates, exactly one answering settle per turn, all with the scripted text",
    "the scripted tool turn lands in exactly its owner (gamma, turn 2): one linked tool/call + tool/result pair citing its call seq, schema-valid todo_write arguments, and ZERO tool records in any sibling journal — checked live in the firehose and re-derived from snapshotEvents",
    "the mid-flight insertion (delta created + prompted while alpha/beta's round-2 turns are provably still open) lands without moving any sibling's turnBoundary projection, and every projection's lastTurn equals its own session's last started turn — no cross-wiring",
    "all four sessions recover SEPARATELY in process 2 on the same container: alpha through the config-driven start, beta/gamma/delta through ctx.agents.resume, each seed exactly its own drive-side journal, each continued by its own turn K+1",
    "the mock served exactly 16 requests (12 + 4) — no hidden retry shifted the scripted attribution arrangement",
    "no 'corrupt session log' and no 'cannot resume' anywhere"
  ],
  "mockScript": "12 entries, tool_call_success at position 7 (gamma's solo round-2b request on an idle wire), slow_success elsewhere, repeatLast for the 4 recovery turns, 500ms/chunk",
  "events": $EVENTS,
  "artifact": { "filesAfterDrive": $DRIVE_FILES, "filesAfterRecover": $RECOVER_FILES, "servedRequests": $MOCK_RESULTS },
  "container": "$CONTAINER",
  "checker": "test/e2e/scenarios/session-multi-stress.json",
  "exitCode": 0
}
EOF

echo "artifacts: $ART_DIR" >&2
cat "$ART_DIR/receipt.json"
