#!/bin/sh
# runtime/dsh/ci/run-mcp-plugin-e2e.sh — the CLI proof run for the dsh-mcp
# system plugin (plan §4.2): the REAL mobile profile boots through boot.js
# (the plugin mounts from the def bundle), reads the mock server from the
# DSH_MCP_SERVERS launch env, connects over the vendored streamable-HTTP
# transport on the REAL gateway httpFetch (T-0269's bridge), registers
# mcp_demo_echo / mcp_demo_add into ctx.tools, and drives both through the
# REAL ToolRuntime dispatch — the error-forwarding leg included — against
# the node-side mock MCP server over real loopback TCP, verifying the
# captured log one-to-one against test/e2e/scenarios/mcp-plugin.json.
#
# The mock (ci/mock-mcp-server.mjs) is the T-0269 probe's own zero-dependency
# node:http server; it runs node-side, outside quickjs, started/killed by
# this script. The wait is a condition POLL with a deadline (rule 8) — the
# poll reads the mock's MOCK_BASE_URL announce, it never sleeps blind.
#
# Idempotent and CI-safe: re-fetches any missing vendored package (the MCP
# client pins ride external/ensure-dsh.sh, the product closure) and rebuilds
# the host only when needed.
#
# usage: run-mcp-plugin-e2e.sh
#        (artifacts: runtime/dsh/artifacts/macos-cli-mcp-plugin)
set -eu
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT/runtime/dsh"

ART_DIR="$ROOT/runtime/dsh/artifacts/macos-cli-mcp-plugin"
SCENARIO_ID="mcp.plugin"
LOG_FILE="logs-mcp-plugin.txt"
MOCK_WAIT_DEADLINE_SECONDS=15

# 1. vendored upstream closure: pinned + sha256-verified (network only for
#    packages missing on disk) — includes the MCP client pins.
sh ../../external/ensure.sh > /dev/null
sh ../../external/ensure-dsh.sh

# 2. build the spike host when the binary is missing.
[ -x build/dsh-cli ] || sh ../../src/build.sh

# 3. start the mock MCP server node-side; it announces the OS-assigned
#    endpoint once the port is bound.
MOCK_LOG="$(mktemp /tmp/dsh-mock-mcp.XXXXXX)"
node ci/mock-mcp-server.mjs > "$MOCK_LOG" 2>&1 &
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
        echo "mock mcp server died before announcing its endpoint:" >&2
        cat "$MOCK_LOG" >&2
        exit 1
    fi
    polled=$((polled + 1))
    if [ "$polled" -gt $((MOCK_WAIT_DEADLINE_SECONDS * 20)) ]; then
        echo "mock mcp server did not announce within ${MOCK_WAIT_DEADLINE_SECONDS}s" >&2
        exit 1
    fi
    sleep 0.05
done
MOCK_URL="$(sed -n 's/^MOCK_BASE_URL=//p' "$MOCK_LOG" | head -1)"
echo "mock mcp server: $MOCK_URL" >&2

# 4. run the scenario (--http: the CLI's loopback httpFetch backend; --env:
#    the launch env — the mock endpoint AND the server roster the plugin's
#    config face reads, credentialRef included so the keychain face runs).
./build/dsh-cli . scenario/mcp-plugin.js \
    --http \
    --env "DSH_MCP_URL=$MOCK_URL" \
    --env "DSH_MCP_SERVERS=demo|$MOCK_URL|mcp/demo/credential" \
    > "$LOG_FILE"
mkdir -p "$ART_DIR"
cp "$LOG_FILE" "$ART_DIR/logs.txt"
cp "$MOCK_LOG" "$ART_DIR/mock-server-stdout.txt"
node "$ROOT/test/e2e/check.mjs" \
    --manifest "$ROOT/test/e2e/scenarios/mcp-plugin.json" \
    --log "$LOG_FILE" \
    --out "$ART_DIR/verdict.json"

# 5. per-event evidence line (the structured scenario records, in log order).
grep "\"scenario\":\"$SCENARIO_ID\"" "$LOG_FILE" > "$ART_DIR/scenario.jsonl"

# 6. the receipt (what this run proves; one JSON document).
EVENTS="$(grep -c "\"scenario\":\"$SCENARIO_ID\"" "$ART_DIR/logs.txt")"
cat > "$ART_DIR/receipt.json" <<EOF
{
  "host": "$(uname -s | tr '[:upper:]' '[:lower:]')-cli ($(uname -sr) $(uname -m))",
  "engine": "quickjs-ng",
  "engineVersion": "0.17.0",
  "upstream": "@modelcontextprotocol/client@2.0.0 + @modelcontextprotocol/core@2.0.0 (vendored verbatim, tgz sha256-pinned by external/ensure-dsh.sh)",
  "scenario": "$SCENARIO_ID",
  "mock": "runtime/dsh/ci/mock-mcp-server.mjs (node-side, zero-dependency Streamable HTTP MCP server on real loopback TCP; its per-request telemetry is mock-server-stdout.txt)",
  "checker": "test/e2e/scenarios/mcp-plugin.json",
  "events": $EVENTS,
  "proves": [
    "the dsh-mcp plugin mounts from the def bundle on the REAL mobile profile: the boot's own boot.js path loads the plugin row, the plugin's async apply runs to completion before bootUpstream settles, and the registered tools are visible to the REAL registry",
    "the config face works on the env tier: DSH_MCP_SERVERS (JSON roster with a credentialRef) is read through the launch env, and the credential face round-trips through the REAL gateway keychain (set → get → identical bytes) before the connect",
    "the connect is composition, not a fork: upstream/mcp-http-transport.js (T-0269) hands the vendored StreamableHTTPClientTransport the gateway fetch, the initialize handshake and tools/list are the library's own wire shapes, and the mock's session-id discipline holds on every post-initialize dial",
    "listTools registers mcp_<server>_<tool> names into ctx.tools and the tool runs forward callTool through the REAL ToolRuntime dispatch (D8): echo round-trips the text, add returns the server's sum, and the server's own -32602 refusal arrives as the tool's structured {ok:false} outcome — forwarded, never thrown, never guessed"
  ]
}
EOF

echo "mcp-plugin: PASS ($EVENTS scenario events; verdict $ART_DIR/verdict.json)"
