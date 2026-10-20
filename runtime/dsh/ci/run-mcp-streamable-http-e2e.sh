#!/bin/sh
# runtime/dsh/ci/run-mcp-streamable-http-e2e.sh — the CLI proof run for the
# MCP Streamable HTTP transport over the gateway (task T-0269): the VENDORED
# @modelcontextprotocol/client@2.0.0 (Client + StreamableHTTPClientTransport,
# verbatim, sha256-pinned) runs inside quickjs-ng, its transport is handed
# the gateway fetch (upstream/mcp-http-transport.js — composition over the
# frozen httpFetch primitive, D5/D6), and the scenario drives ONE full chain
# — connect (initialize + notifications/initialized) → listTools → callTool
# echo → callTool add → close — against the node-side mock MCP server over
# real loopback TCP, verifying the captured log one-to-one against
# test/e2e/scenarios/mcp-streamable-http.json.
#
# The mock (ci/mock-mcp-server.mjs) is a zero-dependency node:http server:
# it runs node-side, outside quickjs, started/killed by this script. Node has
# no condition push for "port bound", so the wait is a condition POLL with a
# deadline (rule 8) — the poll reads the mock's MOCK_BASE_URL announce, it
# never sleeps blind.
#
# Idempotent and CI-safe: re-fetches any missing vendored package (the MCP
# client pins ride external/ensure-dsh.sh, the product closure) and rebuilds
# the host only when needed.
#
# usage: run-mcp-streamable-http-e2e.sh
#        (artifacts: runtime/dsh/artifacts/macos-cli-mcp-streamable-http)
set -eu
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT/runtime/dsh"

ART_DIR="$ROOT/runtime/dsh/artifacts/macos-cli-mcp-streamable-http"
SCENARIO_ID="mcp.streamable-http"
LOG_FILE="logs-mcp-streamable-http.txt"
MOCK_WAIT_DEADLINE_SECONDS=15

# 1. vendored upstream closure: pinned + sha256-verified (network only for
#    packages missing on disk) — includes the MCP client leg's pins
#    (@modelcontextprotocol/client + core and their link-time deps).
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
#    the launch-env snapshot the scenario reads the endpoint from) and verify
#    one-to-one against the manifest.
./build/dsh-cli . scenario/mcp-streamable-http.js \
    --http \
    --env "DSH_MCP_URL=$MOCK_URL" > "$LOG_FILE"
mkdir -p "$ART_DIR"
cp "$LOG_FILE" "$ART_DIR/logs.txt"
cp "$MOCK_LOG" "$ART_DIR/mock-server-stdout.txt"
node "$ROOT/test/e2e/check.mjs" \
    --manifest "$ROOT/test/e2e/scenarios/mcp-streamable-http.json" \
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
  "checker": "test/e2e/scenarios/mcp-streamable-http.json",
  "events": $EVENTS,
  "proves": [
    "the vendored @modelcontextprotocol/client@2.0.0 runs VERBATIM inside quickjs-ng: Client and StreamableHTTPClientTransport load from the pinned vendor closure with zero upstream edits (D6), and the initialize handshake, notifications/initialized, tools/list and tools/call on the wire are the library's own JSON-RPC shapes",
    "the transport bridge is composition, not a fork: upstream/mcp-http-transport.js hands the vendored StreamableHTTPClientTransport the gateway fetch (gatewayFetch, upstream/fetch-gateway-bridge.js) through the library's public fetch option — the only seam it exposes and the only one used",
    "the network face is the REAL gateway httpFetch primitive (contract v1.0.0, D5 — no new primitive): every request crosses the gateway and lands on the node-side mock over real loopback TCP, and the mcp-session-id the server minted round-trips through the gateway's response headers (the mock refuses session-less requests with 400, so a green run IS that proof)",
    "both Streamable HTTP response modes cross the bridge as streams (D8): tools/list returns text/event-stream (one SSE message frame, parsed by the vendored EventSourceParserStream over the gateway body's chunk events) while initialize and tools/call return application/json; the library's own standalone GET stream attempt is answered 405 and tolerated by design — recorded in the mcp/wire evidence, never suppressed"
  ]
}
EOF

echo "mcp-streamable-http: PASS ($EVENTS scenario events; verdict $ART_DIR/verdict.json)"
