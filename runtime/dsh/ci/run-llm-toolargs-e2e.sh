#!/bin/sh
# run-llm-toolargs-e2e.sh — the MALFORMED TOOL-ARGUMENT legs for the harness
# validation layer (test-hardening row 23, doc/test-coverage.md): the vendored
# dsh-llm-mock-server's scripted tool call is armed with a hostile argument
# shape (ci/mock-llm-server.mjs DSH_MOCK_TOOLARGS — an independent key from the
# transport-chaos DSH_MOCK_CHAOS; every profile is JSON-valid on the wire and
# schema-invalid for todo_write), and each leg asserts the validation layer's
# DESIGNED reaction over the REAL agent loop:
#
#   type-error     '{"todos":42}'                     → path-qualified type
#                                                     violation, structured
#                                                     INVALID_ARGS rejection
#   missing-field  '{"todos":[{"status":"pending"}]}'  → missing required
#                                                     property, same rejection
#   deep-nesting   a 2048-deep nested array at todos[0] → parses fine, the
#                                                     explicit-frame validator
#                                                     walks it without
#                                                     overflow, same rejection
#   oversized      a single 2 MiB string at `todos`    → survives the mock's
#                                                     two-delta split and the
#                                                     byte bridge (length-
#                                                     pinned), same rejection
#
# Every leg pins the shared contract: the rejection is STRUCTURED (tool/result
# isError + the ToolArgsError name + the INVALID_ARGS code, diagnostic text
# prefix), the turn NEVER crashes (it completes on the scripted closing text —
# no llm/retry, turn/end completed), and the tool body NEVER ran (the todos
# projection stays at its pre-first-write null; no todo/write in the journal —
# no partial side effects). The guard logic itself is vendored
# (@deepseek-ai/dsh-tools defineTool execute-time schema walk); these legs own
# the real-loop behavior end to end.
#
# Idempotent and CI-safe, same contract as run-llm-chaos-e2e.sh: re-fetches any
# missing vendored package, rebuilds the host only when needed, waits for the
# mock's MOCK_BASE_URL announce by condition poll (rule 8), and verifies every
# CLI leg one-to-one against its manifest
# (test/e2e/scenarios/llm-chaos-toolargs-*.json).
#
# usage: run-llm-toolargs-e2e.sh   (artifacts: runtime/dsh/artifacts/macos-cli-llm-toolargs)
set -eu
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT/runtime/dsh"

ART_DIR="$ROOT/runtime/dsh/artifacts/macos-cli-llm-toolargs"
MOCK_KEY="mock-key-0001"
MOCK_WAIT_DEADLINE_SECONDS=15
TOOLARGS_PROFILES="type-error missing-field deep-nesting oversized"

# 1. vendored upstream closure + the node resolution layout.
sh ../../external/ensure.sh > /dev/null
sh ../../external/ensure-dsh.sh
sh ci/parity-node-modules.sh --parity-only > /dev/null

# 2. build the host when the binary is missing.
[ -x build/dsh-cli ] || sh ../../src/build.sh

mkdir -p "$ART_DIR"

# start_mock <name> [env...]: one fresh hostile-args mock; announces MOCK_BASE_URL.
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
    echo "mock llm server toolargs-$_name: $MOCK_URL" >&2
}

stop_mock() {
    [ -n "${MOCK_PID:-}" ] || return 0
    kill "$MOCK_PID" 2>/dev/null || true
    wait "$MOCK_PID" 2>/dev/null || true
    MOCK_PID=""
}
trap stop_mock EXIT INT TERM

# 3. the CLI toolargs legs: one fresh hostile-args mock per profile (a profile
#    is a persistent condition — every request of the leg sees the same
#    arguments). Each leg's evidence lands in its own artifact subdir with the
#    matrix deliverables (logs.txt + scenario.jsonl + receipt.json + verdict.json).
for profile in $TOOLARGS_PROFILES; do
    start_mock "$profile" \
        DSH_MOCK_TOOLARGS="$profile" DSH_MOCK_REPEAT_LAST=1 DSH_MOCK_LLM_KEY="$MOCK_KEY"
    LEG_DIR="$ART_DIR/toolargs-$profile"
    mkdir -p "$LEG_DIR"
    ./build/dsh-cli . scenario/llm-chaos.js \
        --http \
        --env "DSH_MOCK_LLM_URL=$MOCK_URL" \
        --env "DSH_MOCK_LLM_KEY=$MOCK_KEY" \
        --env "DSH_CHAOS_PROFILE=toolargs-$profile" > "$LEG_DIR/logs.txt"
    stop_mock
    grep "\"scenario\":\"llm.chaos.toolargs-$profile\"" "$LEG_DIR/logs.txt" > "$LEG_DIR/scenario.jsonl"
    node "$ROOT/test/e2e/check.mjs" \
        --manifest "$ROOT/test/e2e/scenarios/llm-chaos-toolargs-$profile.json" \
        --log "$LEG_DIR/logs.txt" \
        --out "$LEG_DIR/verdict.json"
    cat > "$LEG_DIR/receipt.json" <<EOF
{
  "scenario": "llm.chaos.toolargs-$profile",
  "leg": "runtime/dsh/ci/run-llm-toolargs-e2e.sh (toolargs-$profile)",
  "mock": "vendored dsh-llm-mock-server via ci/mock-llm-server.mjs DSH_MOCK_TOOLARGS=$profile",
  "manifest": "test/e2e/scenarios/llm-chaos-toolargs-$profile.json",
  "exitCode": 0
}
EOF
done

# 4. the receipt (what these legs prove; one JSON document).
cat > "$ART_DIR/receipt.json" <<EOF
{
  "scenario": "llm.chaos.toolargs-*",
  "profiles": ["toolargs-type-error", "toolargs-missing-field", "toolargs-deep-nesting", "toolargs-oversized"],
  "mock": "vendored dsh-llm-mock-server tool_call_success with schema-hostile arguments (DSH_MOCK_TOOLARGS presets; no vendored edits, no transport changes)",
  "proves": [
    "type-error: a number where todo_write wants an array is rejected by the harness validation layer as a STRUCTURED isError tool result carrying the ToolArgsError name and the INVALID_ARGS code with the path-qualified diagnostic — the turn still completes on the scripted closing text",
    "missing-field: an item missing its required content property is rejected the same way (missing required property) — no retry is scheduled, the tool body never runs",
    "deep-nesting: a 2048-deep nested array at todos[0] parses on the wire, survives the mock's two-delta split and the byte bridge, and the validator's explicit-frame (non-recursive) walk rejects it without overflow — the same structured rejection, no crash",
    "oversized: a single 2 MiB arguments string rides the two-delta tool_call split end to end (journal length-pinned) and is rejected on type — the same structured rejection with the turn completing",
    "no partial side effects in every leg: the todos projection stays at its pre-first-write null and the journal records no todo/write — the tool body never executed behind the rejection"
  ],
  "exitCode": 0
}
EOF

echo "toolargs legs: all green (artifacts: $ART_DIR)"
