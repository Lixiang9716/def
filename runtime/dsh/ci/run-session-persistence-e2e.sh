#!/bin/sh
# runtime/dsh/ci/run-session-persistence-e2e.sh — the CLI proof run for the
# RESUME leg (the session-persistence family): the vendored
# @deepseek-ai/dsh-session-persistence-jsonl backend mounted by the GATED
# boot row (options.sessionPersistence, default off), driven through TWO
# dsh-cli processes over ONE pinned profile container (DSH_SPIKE_TMPDIR):
#
#   process 1 (leg create): one mock LLM turn creates + journals the session;
#   the artifact must exist on the REAL container disk afterwards (the
#   node:fs shims' write-through mirror — the <filesDir>/dsh/sessions twin).
#   process 2 (leg resume): the same boot config RESUMES the stored session
#   (no "cannot resume: session persistence is not configured" anywhere) and
#   the second mock turn continues the journal across the restart.
#
# Each leg's structured scenario stream is verified one-to-one against
# test/e2e/scenarios/session-persistence.json. Artifacts:
# runtime/dsh/artifacts/macos-cli-session-persistence/.
#
# usage: run-session-persistence-e2e.sh
set -eu
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT/runtime/dsh"

ART_DIR="$ROOT/runtime/dsh/artifacts/macos-cli-session-persistence"
MOCK_KEY="mock-key-0001"
MOCK_WAIT_DEADLINE_SECONDS=15

# 1. vendored upstream closure: pinned + sha256-verified (includes the
#    session-persistence family this leg vendors).
sh ../../external/ensure.sh > /dev/null
sh ../../external/ensure-dsh.sh

# 2. build the spike host when the binary is missing.
[ -x build/dsh-cli ] || sh ../../src/build.sh

# 3. ONE pinned profile container for BOTH processes — the cross-start
#    survival claim is about THIS directory's disk contents.
CONTAINER="$(mktemp -d /tmp/dsh-session-persist.XXXXXX)"

# 4. start the mock LLM server with TWO scripted successes (one turn per
#    process; REPEAT_LAST guards a retry) and wait for the endpoint announce
#    (condition poll with a deadline, rule 8).
MOCK_LOG="$(mktemp /tmp/dsh-mock-llm-persist.XXXXXX)"
DSH_MOCK_SEQUENCE="success success" DSH_MOCK_REPEAT_LAST=1 \
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
echo "profile container: $CONTAINER" >&2

run_leg() {
    leg="$1"; log="$2"
    DSH_SPIKE_TMPDIR="$CONTAINER" ./build/dsh-cli . scenario/session-persistence.js \
        --http \
        --env "DSH_MOCK_LLM_URL=$MOCK_URL" \
        --env "DSH_MOCK_LLM_KEY=$MOCK_KEY" \
        --env "DSH_SESSIONS_LEG=$leg" > "$log"
}

# 5. process 1: the create leg (boot → mock turn → durable artifact).
run_leg create logs-persist-create.txt

# 6. REAL-DISK artifact check between the processes: the stored session must
#    exist under <container>/dsh/sessions/ (the shims' write-through mirror),
#    with at least one non-empty file — the zstd session log.
PERSIST_FILES="$(find "$CONTAINER/dsh/sessions" -type f 2>/dev/null || true)"
PERSIST_COUNT="$(printf '%s' "$PERSIST_FILES" | grep -c . || true)"
if [ "$PERSIST_COUNT" -lt 1 ] || [ -z "$PERSIST_FILES" ]; then
    echo "session artifact did not reach the container disk:" >&2
    find "$CONTAINER" -maxdepth 4 >&2 || true
    exit 1
fi
PERSIST_NONEMPTY=0
for f in $PERSIST_FILES; do
    [ -s "$f" ] && PERSIST_NONEMPTY=$((PERSIST_NONEMPTY + 1))
done
if [ "$PERSIST_NONEMPTY" -lt 1 ]; then
    echo "session artifact files exist but are all empty:" >&2
    ls -la "$CONTAINER/dsh/sessions" >&2
    exit 1
fi
echo "stored artifact on the container disk ($PERSIST_NONEMPTY non-empty file(s)):" >&2
ls -l $PERSIST_FILES >&2

# 7. process 2: the resume leg (same container — the loop's config-driven
#    start restores the stored session and the turn continues the journal).
run_leg resume logs-persist-resume.txt

# 8. the cross-start refusals that must NOT appear (the pre-leg behavior:
#    "cannot resume: session persistence is not configured").
if grep -q "cannot resume" logs-persist-create.txt logs-persist-resume.txt; then
    echo "a leg hit the loud unconfigured-persistence path:" >&2
    grep -n "cannot resume" logs-persist-create.txt logs-persist-resume.txt >&2
    exit 1
fi

# 9. artifacts + the receipt (what this run proves; one JSON document).
mkdir -p "$ART_DIR"
cp logs-persist-create.txt "$ART_DIR/logs-create.txt"
cp logs-persist-resume.txt "$ART_DIR/logs-resume.txt"
cp "$MOCK_LOG" "$ART_DIR/mock-server-stdout.txt"

EVENTS_CREATE="$(grep -c '"scenario":"session.persistence"' logs-persist-create.txt || true)"
EVENTS_RESUME="$(grep -c '"scenario":"session.persistence"' logs-persist-resume.txt || true)"
ARTIFACT_LINE="$(ls -l $PERSIST_FILES | head -1 | awk '{print $5, $9}')"
cat > "$ART_DIR/receipt.json" <<EOF
{
  "host": "$(uname -s | tr '[:upper:]' '[:lower:]')-cli ($(uname -sr) $(uname -m))",
  "engine": "quickjs-ng",
  "upstream": "@deepseek-ai/dsh-session-persistence-jsonl@0.1.6-alpha.2 (vendored verbatim, tgz sha256-pinned by external/ensure-dsh.sh)",
  "scenario": "session.persistence",
  "proves": [
    "the gated boot row (options.sessionPersistence, default off) mounts the vendored JSONL backend under the sessionPersistence service key before the agent loop",
    "process 1: the configured session creates, one mock turn journals it, and backend.stat answers a non-empty durable artifact",
    "the artifact reaches the REAL container disk (write-through mirror): non-empty files under <container>/dsh/sessions/",
    "process 2 on the SAME container: the config-driven start RESUMES the stored session — the restored seed carries turn 1 and its assistant message, no 'cannot resume' error anywhere",
    "the second mock turn CONTINUES the journal across the restart: turn/start 1 and 2 in one log, turnBoundary.lastTurn == 2"
  ],
  "events": { "create": $EVENTS_CREATE, "resume": $EVENTS_RESUME },
  "artifactSample": "$ARTIFACT_LINE",
  "container": "$CONTAINER",
  "exitCode": 0
}
EOF

echo "artifacts: $ART_DIR"
cat "$ART_DIR/receipt.json"
