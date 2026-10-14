#!/bin/sh
# runtime/dsh/ci/run-session-persist-midturn-e2e.sh — the CLI proof run for
# the MID-TURN KILL leg (the session-persistence family's third boundary):
# the vendored @deepseek-ai/dsh-session-persistence-jsonl backend mounted by
# the GATED boot row, driven through TWO dsh-cli processes over ONE pinned
# profile container (DSH_SPIKE_TMPDIR), and the RUNNER owns the kill —
#
#   process 1 (leg kill): the turn starts, the leg emits midturn/first.delta
#     at the FIRST streamed content delta and then forces the journal's
#     materialization mid-stream (backend.flush + backend.stat non-empty —
#     `midturn/durable`). The runner polls for THAT marker (a condition, not
#     a clock — rule 8) and kills the process with SIGKILL while the mock
#     stream is still open (slow_success drips, DSH_MOCK_CHUNK_DELAY_MS paces
#     the window). The turn NEVER completes in process 1.
#   process 2 (leg resume): the same boot config RESUMES the stored artifact;
#     the vendored agent-loop's resume path appends the interrupted-turn
#     closers (dsh-session's interruptedTurnClosers — the synthesized
#     step/end + turn/end with reason "interrupted") so the journal ends at
#     a REAL boundary, never a half turn, and the recovery turn continues it
#     (turn 2, turnBoundary.lastTurn == 2).
#
# The refusals that must NOT appear: `corrupt session log` anywhere (a torn
# or half-written artifact) and `cannot resume` (the unconfigured path).
# The concatenated log is verified one-to-one against
# test/e2e/scenarios/session-persistence-midturn.json. Artifacts:
# runtime/dsh/artifacts/macos-cli-session-persist-midturn/.
#
# The device sibling (hosts/android/ci/run-session-persist-midturn.sh +
# the restart family's Android seat) drives the same shape on the carrier's
# SLOW_TURN drip; this CLI leg is the simulation half that stays runnable
# without hardware.
#
# usage: run-session-persist-midturn-e2e.sh
set -eu
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT/runtime/dsh"

ART_DIR="$ROOT/runtime/dsh/artifacts/macos-cli-session-persist-midturn"
MOCK_KEY="mock-key-0001"
MOCK_WAIT_DEADLINE_SECONDS=15
KILL_WAIT_DEADLINE_SECONDS=60

# 1. vendored upstream closure: pinned + sha256-verified (includes the
#    session-persistence family this leg vendors).
sh ../../external/ensure.sh > /dev/null
sh ../../external/ensure-dsh.sh

# 2. build the spike host when the binary is missing.
[ -x build/dsh-cli ] || sh ../../src/build.sh

# 3. ONE pinned profile container for BOTH processes — the mid-turn survival
#    claim is about THIS directory's disk contents. The legs' logs live in
#    /tmp scratch — never the tree (three stale logs-*.txt once rode a PR in).
CONTAINER="$(mktemp -d /tmp/dsh-midturn.XXXXXX)"
LOG_KILL="$(mktemp /tmp/dsh-midturn-kill.XXXXXX)"
LOG_RESUME="$(mktemp /tmp/dsh-midturn-resume.XXXXXX)"

# 4. the paced mock: slow_success DRIPS the success body (the plain `success`
#    behavior hardcodes delay 0 — measured), so the kill window is real.
MOCK_LOG="$(mktemp /tmp/dsh-mock-llm-midturn.XXXXXX)"
DSH_MOCK_SEQUENCE="slow_success slow_success" DSH_MOCK_REPEAT_LAST=1 \
    DSH_MOCK_CHUNK_DELAY_MS=250 node ci/mock-llm-server.mjs > "$MOCK_LOG" 2>&1 &
MOCK_PID=$!
cleanup() {
    kill "$MOCK_PID" 2>/dev/null || true
    wait "$MOCK_PID" 2>/dev/null || true
    rm -f "$MOCK_LOG" "$LOG_KILL" "$LOG_RESUME"
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
echo "mock llm server: $MOCK_URL (slow_success @ 250ms/chunk)" >&2
echo "profile container: $CONTAINER" >&2

# 5. process 1: the kill leg. Backgrounded; the poll waits for the leg's OWN
#    `midturn/durable` marker (journal materialized, stream still open), then
#    SIGKILL. The marker is the only kill signal this runner accepts — a
#    marker that never lands exhausts the deadline and fails loud.
DSH_SPIKE_TMPDIR="$CONTAINER" ./build/dsh-cli . scenario/session-persist-midturn.js \
    --http \
    --env "DSH_MOCK_LLM_URL=$MOCK_URL" \
    --env "DSH_MOCK_LLM_KEY=$MOCK_KEY" \
    --env "DSH_SESSIONS_LEG=kill" > "$LOG_KILL" 2>&1 &
KILL_PID=$!
polled=0
until grep -s 'midturn/durable' "$LOG_KILL" > /dev/null; do
    if ! kill -0 "$KILL_PID" 2>/dev/null; then
        echo "the kill leg died before the durable marker:" >&2
        tail -20 "$LOG_KILL" >&2
        exit 1
    fi
    polled=$((polled + 1))
    if [ "$polled" -gt $((KILL_WAIT_DEADLINE_SECONDS * 20)) ]; then
        kill -9 "$KILL_PID" 2>/dev/null || true
        echo "no midturn/durable marker within ${KILL_WAIT_DEADLINE_SECONDS}s — the kill window never opened" >&2
        tail -20 "$LOG_KILL" >&2
        exit 1
    fi
    sleep 0.05
done
kill -9 "$KILL_PID" 2>/dev/null || true
echo "kill boundary: SIGKILL delivered on the midturn/durable marker (stream still open)" >&2

# 6. REAL-DISK audit between the processes: the mid-turn journal must be ON
#    the container disk, non-empty — the write-through mirror's state at
#    kill time is what process 2 will recover from.
MIDTURN_FILES="$(find "$CONTAINER/dsh/sessions" -type f 2>/dev/null || true)"
MIDTURN_NONEMPTY=0
for f in $MIDTURN_FILES; do
    [ -s "$f" ] && MIDTURN_NONEMPTY=$((MIDTURN_NONEMPTY + 1))
done
[ "$MIDTURN_NONEMPTY" -ge 1 ] || {
    echo "the mid-turn journal never reached the container disk:" >&2
    find "$CONTAINER" -maxdepth 5 >&2 || true
    exit 1
}
KILL_BYTES="$(find "$CONTAINER/dsh/sessions" -type f -size +0 -exec stat -f %z {} \; | head -1)"
echo "mid-turn journal on disk at kill time: $KILL_BYTES bytes" >&2

# 7. process 2: the recovery leg (same container — the interrupted-turn
#    closers land here, then the recovery turn continues the journal).
DSH_SPIKE_TMPDIR="$CONTAINER" ./build/dsh-cli . scenario/session-persist-midturn.js \
    --http \
    --env "DSH_MOCK_LLM_URL=$MOCK_URL" \
    --env "DSH_MOCK_LLM_KEY=$MOCK_KEY" \
    --env "DSH_SESSIONS_LEG=resume" > "$LOG_RESUME"
RESUME_BYTES="$(find "$CONTAINER/dsh/sessions" -type f -size +0 -exec stat -f %z {} \; | head -1)"

# 8. the refusals that must NOT appear: a torn or half-written artifact
#    (the backend's loud corrupt path) and the pre-leg unconfigured resume.
if grep -q "corrupt session log" "$LOG_KILL" "$LOG_RESUME"; then
    echo "the recovered artifact hit the loud corrupt path:" >&2
    grep -n "corrupt session log" "$LOG_KILL" "$LOG_RESUME" >&2
    exit 1
fi
if grep -q "cannot resume" "$LOG_KILL" "$LOG_RESUME"; then
    echo "a leg hit the loud unconfigured-persistence path:" >&2
    grep -n "cannot resume" "$LOG_KILL" "$LOG_RESUME" >&2
    exit 1
fi

# 9. one-to-one verification over the CONCATENATED log (kill leg first, the
#    resume leg second — the boundary the manifest's event order pins).
mkdir -p "$ART_DIR"
cat "$LOG_KILL" "$LOG_RESUME" > "$ART_DIR/logs.txt"
cp "$MOCK_LOG" "$ART_DIR/mock-server-stdout.txt"
grep 'dsh.runtime.log:' "$ART_DIR/logs.txt" > "$ART_DIR/scenario.jsonl" || true
EVENTS="$(grep -c '"scenario":"session.persistence.midturn"' "$ART_DIR/logs.txt" || true)"
node "$ROOT/test/e2e/check.mjs" \
    --manifest "$ROOT/test/e2e/scenarios/session-persistence-midturn.json" \
    --log "$ART_DIR/logs.txt" \
    --out "$ART_DIR/verdict.json"

cat > "$ART_DIR/receipt.json" <<EOF
{
  "host": "$(uname -s | tr '[:upper:]' '[:lower:]')-cli ($(uname -sr) $(uname -m))",
  "engine": "quickjs-ng",
  "upstream": "@deepseek-ai/dsh-session-persistence-jsonl@0.1.6-alpha.2 (vendored verbatim, tgz sha256-pinned by external/ensure-dsh.sh)",
  "scenario": "session.persistence.midturn",
  "proves": [
    "the kill turn's journal MATERIALIZES MID-STREAM (backend.flush + stat non-empty at the midturn/durable marker) while the mock stream is provably still open",
    "the runner's SIGKILL lands on the leg's own durable marker — a condition, never a clock — with the turn unfinished (no assistant message, no turn/end in process 1's journal)",
    "process 2 on the SAME container: the vendored agent-loop's resume path appends the interrupted-turn closers (synthesized step/end + turn/end reason.kind 'interrupted') so the restored journal ends at a REAL boundary",
    "no 'corrupt session log' and no 'cannot resume' anywhere — the half-written turn never yields a half-written artifact",
    "the recovery turn CONTINUES the journal across the kill: 8 persisted + 2 closers + 1 seed marker = 11 restored, turn 2 appends 9, turnBoundary.lastTurn == 2"
  ],
  "killBoundary": "midturn/durable marker -> SIGKILL",
  "mockPacing": "slow_success @ 250ms/chunk (DSH_MOCK_CHUNK_DELAY_MS; the plain success behavior hardcodes delay 0)",
  "events": $EVENTS,
  "artifact": { "bytesAtKill": $KILL_BYTES, "bytesAfterResume": $RESUME_BYTES },
  "container": "$CONTAINER",
  "checker": "test/e2e/scenarios/session-persistence-midturn.json",
  "exitCode": 0
}
EOF

echo "artifacts: $ART_DIR" >&2
cat "$ART_DIR/receipt.json"
