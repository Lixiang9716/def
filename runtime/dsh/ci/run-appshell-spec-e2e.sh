#!/bin/sh
# runtime/dsh/ci/run-appshell-spec-e2e.sh — the CLI proof run for scenario
# appshell.spec (the appshell morphing plan's L2 leg, D-6): the deterministic
# generation→validation→tool-call chain over the REAL spine. This is the only
# e2e where the dsh-appshell plugin itself executes — the browser morph leg's
# tool cards are synthesized carrier-side by design (tools/dev-web-carrier).
#
# The mock LLM scripts the appshell_render tool call (DSH_MOCK_TOOL_NAME/
# ARGS + the tool_call_success sequence), the agent loop dispatches it through
# the REAL ToolRuntime, the four-gate validator passes the scripted spec, and
# the echo carries the minted surfaceId. The scenario then proves the sixth
# red-team category (a forged-surfaceId update refused before any spec work),
# the live-surface update, and the catalog rules — one-to-one against
# test/e2e/scenarios/appshell-spec.json.
#
# usage: run-appshell-spec-e2e.sh   (artifacts: .../macos-cli-appshell-spec)
set -eu
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT/runtime/dsh"

ART_DIR="$ROOT/runtime/dsh/artifacts/macos-cli-appshell-spec"
MOCK_KEY="mock-key-0001"
WAIT_DEADLINE_SECONDS=15

# The scripted model's tool call: one validator-clean app-shell/0.9 spec
# (template banner-card + primitive button with a declared action). Mirrors
# the UPDATE_SPEC / title assertions in scenario/appshell-spec.js.
MOCK_TOOL_NAME="appshell_render"
MOCK_TOOL_ARGS='{"spec":{"spec":"app-shell/0.9","title":"微信","theme":{"accent":"#07C160"},"tabs":["微信","通讯录"],"actions":["demo.tap"],"screen":{"type":"column","children":[{"type":"banner-card","title":"微信","subtitle":"一句话生成"},{"type":"button","label":"点我","action":"demo.tap"}]}}}'
MOCK_SUCCESS_TEXT="表面已就绪"

# 1. vendored upstream closure: pinned + sha256-verified.
sh ../../external/ensure.sh > /dev/null
sh ../../external/ensure-dsh.sh > /dev/null

# 2. build the spike host when the binary is missing.
[ -x build/dsh-cli ] || sh ../../src/build.sh

# 3. start the loopback LLM mock scripting the appshell_render turn,
#    condition-polling its endpoint announce (rule 8).
LLM_LOG="$(mktemp /tmp/dsh-mock-llm-appshell.XXXXXX)"
DSH_MOCK_SEQUENCE="tool_call_success success" \
DSH_MOCK_TOOL_NAME="$MOCK_TOOL_NAME" \
DSH_MOCK_TOOL_ARGS="$MOCK_TOOL_ARGS" \
DSH_MOCK_SUCCESS_TEXT="$MOCK_SUCCESS_TEXT" \
node ci/mock-llm-server.mjs > "$LLM_LOG" 2>&1 &
LLM_PID=$!
cleanup() {
    kill "$LLM_PID" 2>/dev/null || true
    wait "$LLM_PID" 2>/dev/null || true
    rm -f "$LLM_LOG" "${SCENARIO_LOG:-}"
}
trap cleanup EXIT INT TERM

announce() { # $1=log $2=announce-prefix $3=deadline-s
    polled=0
    until grep -s "^$2=" "$1" > /dev/null; do
        kill -0 "$3" 2>/dev/null || {
            echo "mock server $2 died before announcing:" >&2
            cat "$1" >&2
            exit 1
        }
        polled=$((polled + 1))
        if [ "$polled" -gt $((WAIT_DEADLINE_SECONDS * 20)) ]; then
            echo "mock server did not announce $2 within ${WAIT_DEADLINE_SECONDS}s" >&2
            exit 1
        fi
        sleep 0.05
    done
}
announce "$LLM_LOG" MOCK_BASE_URL "$LLM_PID"
LLM_URL="$(sed -n "s/^MOCK_BASE_URL=//p" "$LLM_LOG" | head -1)"
echo "mock llm server: $LLM_URL" >&2

# 4. run the scenario (--http: loopback httpFetch; --env: the launch env
#    snapshot carrying the llm route) and verify the log one-to-one. The log
#    is /tmp scratch, never a tree file.
SCENARIO_LOG="$(mktemp /tmp/dsh-appshell-spec-e2e.XXXXXX)"
./build/dsh-cli . scenario/appshell-spec.js \
    --http \
    --env "DSH_MOCK_LLM_URL=$LLM_URL" \
    --env "DSH_MOCK_LLM_KEY=$MOCK_KEY" > "$SCENARIO_LOG"
mkdir -p "$ART_DIR"
cp "$SCENARIO_LOG" "$ART_DIR/logs.txt"
grep '^dsh.runtime.log:' "$SCENARIO_LOG" > "$ART_DIR/scenario.jsonl"
node "$ROOT/test/e2e/check.mjs" \
    --manifest "$ROOT/test/e2e/scenarios/appshell-spec.json" \
    --log "$SCENARIO_LOG" \
    --out "$ART_DIR/verdict.json"

EVENTS="$(grep -c '^dsh.runtime.log:' "$SCENARIO_LOG")"
cat > "$ART_DIR/receipt.json" <<EOF
{
  "host": "darwin-cli (Darwin $(uname -srm))",
  "engine": "quickjs-ng",
  "engineVersion": "0.17.0",
  "upstream": "@deepseek-ai/dsh-* 0.1.6-alpha.2 (vendored verbatim, sha256-pinned by external/ensure-dsh.sh)",
  "kernel": "@deepseek-ai/cordis@4.0.2",
  "scenario": "appshell.spec",
  "proves": [
    "dsh-appshell mounts scenario-side beside the spine and offers its three tools (appshell/offered)",
    "one real agent turn scripts an appshell_render call through the mock wire; the REAL ToolRuntime dispatches it; the four-gate validator passes the spec (appshell/render/tool-called + echoed with the minted surfaceId)",
    "the sixth red-team category: a forged-surfaceId appshell_update is refused before any spec work (appshell/update/forged-refused)",
    "the live surface updates in place and appshell_catalog serves the authoring rules (appshell/update/accepted + catalog/served)"
  ],
  "checker": "test/e2e/scenarios/appshell-spec.json",
  "events": $EVENTS,
  "exitCode": 0
}
EOF

echo "e2e: PASS $ART_DIR" >&2
