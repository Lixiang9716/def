#!/bin/sh
# test/shell-diff/run.sh — the bash differential harness for dsh-shell-js
# (test-hardening row 6). One command, both seats, one verdict:
#
#   1. materialize the vendored closure + build the desktop CLI when
#      missing (same recipe as the c-core legs);
#   2. boot the mobile profile over the loopback LLM mock and drive every
#      cases.json script through the REAL ToolRuntime `shell` dispatch
#      (driver.mjs → dsh-results.jsonl);
#   3. feed the byte-identical scripts to REAL bash in a mirrored scratch
#      tree (run-bash.mjs → bash-results.jsonl);
#   4. normalize + compare (compare.mjs): report.json + divergences.md into
#      runtime/dsh/artifacts/shell-diff/ (the diff list is the deliverable);
#      a case failing its expectation exits 1 — that is the leg's red.
#
# The harness is reproducible: fixed case order (the matrix is data),
# LC_ALL=C bash, a pinned workspace (DSH_SPIKE_TMPDIR), scratch under
# gitignored tmp/, and no clocks anywhere in the comparison.
#
# usage: test/shell-diff/run.sh   (from the repo root or anywhere)
set -eu
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT/runtime/dsh"

SCRATCH="$ROOT/tmp/shell-diff"
ART_DIR="$ROOT/runtime/dsh/artifacts/shell-diff"
SANDBOX="$SCRATCH/bash-sandbox"
WORKSPACE="$SCRATCH/workspace"
MOCK_KEY="mock-key-0001"
WAIT_DEADLINE_SECONDS=15
# The runtime backstop must NOT race the shell tool's own 120s dispatch
# budget: the pinned pipeline-refusal deadlock (glob-prefix-pattern) survives
# via that tool timer (the dispatch returns in-band, the run continues), and
# a backstop at the default 120s turns the same hang into a coin-flip
# premature exit. 1800s bounds the whole run well under the CI job timeout;
# every dispatch is individually bounded by the tool budget.
DSH_DEADLINE_SECONDS=1800
export DSH_DEADLINE_SECONDS

# 1. vendored upstream closure (pinned + sha256-verified) + the CLI.
sh ../../external/ensure.sh > /dev/null
sh ../../external/ensure-dsh.sh > /dev/null
[ -x build/dsh-cli ] || sh ../../src/build.sh

rm -rf "$SCRATCH"
mkdir -p "$SCRATCH" "$WORKSPACE"

# 2. the loopback LLM mock (the boot's adapter mount wants the llm route;
#    no agent turn runs here) — condition-polled announce, rule 8.
LLM_LOG="$SCRATCH/mock-llm.log"
node ci/mock-llm-server.mjs > "$LLM_LOG" 2>&1 &
LLM_PID=$!
cleanup() {
    kill "$LLM_PID" 2>/dev/null || true
    wait "$LLM_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

announce() { # $1=log $2=announce-prefix $3=deadline-pid
    polled=0
    until grep -s "^$2=" "$1" > /dev/null; do
        kill -0 "$3" 2>/dev/null || {
            echo "shell-diff: mock server $2 died before announcing:" >&2
            cat "$1" >&2
            exit 1
        }
        polled=$((polled + 1))
        if [ "$polled" -gt $((WAIT_DEADLINE_SECONDS * 20)) ]; then
            echo "shell-diff: mock server did not announce $2 within ${WAIT_DEADLINE_SECONDS}s" >&2
            exit 1
        fi
        sleep 0.05
    done
}
announce "$LLM_LOG" MOCK_BASE_URL "$LLM_PID"
LLM_URL="$(sed -n "s/^MOCK_BASE_URL=//p" "$LLM_LOG" | head -1)"
echo "shell-diff: mock llm server $LLM_URL" >&2

# 3. the dsh side: one boot, every case through the real shell dispatch.
#    The workspace is pinned (DSH_SPIKE_TMPDIR) so the results JSONL has a
#    deterministic disk path.
DSH_SPIKE_TMPDIR="$WORKSPACE" \
    ./build/dsh-cli . ../../test/shell-diff/driver.mjs \
    --http \
    --bus-inject "$ROOT/test/shell-diff/cases.json" \
    --env "DSH_MOCK_LLM_URL=$LLM_URL" \
    --env "DSH_MOCK_LLM_KEY=$MOCK_KEY" > "$SCRATCH/dsh-log.txt"
cp "$WORKSPACE/shell-diff-results.jsonl" "$SCRATCH/dsh-results.jsonl"

# 4. the bash side, then the normalized comparison + the diff list.
node "$ROOT/test/shell-diff/run-bash.mjs" \
    --sandbox "$SANDBOX" \
    --out "$SCRATCH/bash-results.jsonl"
node "$ROOT/test/shell-diff/compare.mjs" \
    --dsh "$SCRATCH/dsh-results.jsonl" \
    --bash "$SCRATCH/bash-results.jsonl" \
    --sandbox "$SANDBOX" \
    --dsh-root "$WORKSPACE" \
    --out "$ART_DIR"

# The committed artifact set is report.json + divergences.md + receipt.json
# — all path-free (compare writes normalized fields only). The raw JSONL
# evidence stays in gitignored tmp/shell-diff/ next to the CLI log.
bash --version | head -1 > "$SCRATCH/bash-version.txt"
cat > "$ART_DIR/receipt.json" <<EOF
{
  "harness": "test/shell-diff (test-hardening row 6)",
  "dshSeat": "dsh-shell-js via the desktop CLI ToolRuntime shell dispatch (engine quickjs-ng 0.17.0)",
  "bashSeat": "$(bash --version | head -1 | sed 's/"/\\"/g')",
  "normalization": "scratch roots scrubbed workspace-relative; CRLF folded; nothing else",
  "artifacts": ["report.json", "divergences.md", "receipt.json"],
  "rawEvidence": "tmp/shell-diff/{dsh,bash}-results.jsonl + dsh-log.txt (gitignored scratch)",
  "exitCode": 0
}
EOF

echo "shell-diff: PASS $ART_DIR" >&2
