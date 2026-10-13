#!/bin/sh
# runtime/dsh/ci/run-dsh-shell-js-e2e.sh — the CLI proof run for the
# dsh-shell-js system plugin (the one `shell` tool seat's executor: a
# bash-subset shell in-process over the gateway's seven fs primitives):
# boots the mobile profile exactly as upstream.session does, confirms the
# `shell` tool is offered, then drives nine command lines through the REAL
# ToolRuntime dispatch — quotes + variable expansion, `>` / `>>` redirects
# round-tripped through the gateway (in-shell `cat` AND out-of-band
# fsRead), a three-member pipeline, and the by-name refusal semantics
# (command substitution → exit 2 naming the construct, chmod → exit 2
# naming the missing primitive and the D5 path, unknown program → exit 127
# naming the applet list).
#
# The captured log is verified one-to-one against
# test/e2e/scenarios/dsh-shell-js.json. Artifacts:
# runtime/dsh/artifacts/macos-cli-dsh-shell-js/.
#
# usage: run-dsh-shell-js-e2e.sh   (artifacts: .../macos-cli-dsh-shell-js)
set -eu
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT/runtime/dsh"

ART_DIR="$ROOT/runtime/dsh/artifacts/macos-cli-dsh-shell-js"
MOCK_KEY="mock-key-0001"
WAIT_DEADLINE_SECONDS=15

# 1. vendored upstream closure: pinned + sha256-verified.
sh ../../external/ensure.sh > /dev/null
sh ../../external/ensure-dsh.sh > /dev/null

# 2. build the spike host when the binary is missing.
[ -x build/dsh-cli ] || sh ../../src/build.sh

# 3. start the loopback LLM mock (the boot's llm route is never driven —
#    no agent turn runs here — but the adapter mount wants the route),
#    waiting (condition-polled, rule 8) for its endpoint announce.
LLM_LOG="$(mktemp /tmp/dsh-mock-llm-shelljs.XXXXXX)"
node ci/mock-llm-server.mjs > "$LLM_LOG" 2>&1 &
LLM_PID=$!
cleanup() {
    kill "$LLM_PID" 2>/dev/null || true
    wait "$LLM_PID" 2>/dev/null || true
    rm -f "$LLM_LOG" "${SHELL_LOG:-}"
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
#    snapshot that carries the llm route) and verify the log one-to-one.
#    The log is /tmp scratch, never a tree file — a cwd-relative log here
#    is how a stale logs-dsh-shell-js.txt once rode a PR into the
#    canonical runtime tree (git-rm'd 2026-10-13).
SHELL_LOG="$(mktemp /tmp/dsh-shell-js-e2e.XXXXXX)"
./build/dsh-cli . scenario/dsh-shell-js.js \
    --http \
    --env "DSH_MOCK_LLM_URL=$LLM_URL" \
    --env "DSH_MOCK_LLM_KEY=$MOCK_KEY" > "$SHELL_LOG"
mkdir -p "$ART_DIR"
cp "$SHELL_LOG" "$ART_DIR/logs.txt"
grep '^dsh.runtime.log:' "$SHELL_LOG" > "$ART_DIR/scenario.jsonl"
node "$ROOT/test/e2e/check.mjs" \
    --manifest "$ROOT/test/e2e/scenarios/dsh-shell-js.json" \
    --log "$SHELL_LOG" \
    --out "$ART_DIR/verdict.json"

EVENTS="$(grep -c '^dsh.runtime.log:' "$SHELL_LOG")"
cat > "$ART_DIR/receipt.json" <<EOF
{
  "host": "darwin-cli (Darwin $(uname -srm))",
  "engine": "quickjs-ng",
  "engineVersion": "0.17.0",
  "upstream": "@deepseek-ai/dsh-* 0.1.6-alpha.2 (vendored verbatim, sha256-pinned by external/ensure-dsh.sh)",
  "kernel": "@deepseek-ai/cordis@4.0.2",
  "scenario": "dsh-shell-js",
  "proves": [
    "the dsh-shell-js system plugin mounts with the spine and offers the one shell tool (shell/offered)",
    "quotes + variables: a prefix assignment seeds the table, double quotes fold over \$VAR/\${VAR} expansion, single quotes stay literal (shell/call → shell/stdout → shell/exit)",
    "redirects: > creates and >> appends through the gateway fsWrite, round-tripped in-shell (cat) and out-of-band (fsRead sees the exact bytes) (shell/persisted)",
    "pipelines: a three-member cat | sort | head -n 1 over the in-memory 64KB-window pipes",
    "by-name refusals: command substitution \$(…) → exit 2 naming the construct; chmod → exit 2 naming the missing permission primitive and the D5 contract path; unknown program → exit 127 naming the applet list (shell/refused)"
  ],
  "checker": "test/e2e/scenarios/dsh-shell-js.json",
  "events": $EVENTS,
  "exitCode": 0
}
EOF

echo "e2e: PASS $ART_DIR" >&2
