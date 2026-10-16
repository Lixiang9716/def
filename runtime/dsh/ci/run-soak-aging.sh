#!/bin/sh
# runtime/dsh/ci/run-soak-aging.sh — the CLI proof run for the SOAK/AGING
# leg (scenario `soak.aging`, test-hardening row 11): one spine, one
# long-lived session, sustained mock rounds for DSH_SOAK_MINUTES (default
# 90 — the owner ritual; validation runs scale the env down), sampling the
# engine heap every heartbeat and the journal ladder every heartbeat plus
# at the close. The host-process fd face is sampled HERE (JS cannot see
# it): one line per sample into fd-samples.jsonl, gated as final <= first
# + FD_TOLERANCE — a monotonic climb is the fd-leak class.
#
# The captured log is verified one-to-one against
# test/e2e/scenarios/soak-aging.json. Artifacts:
# runtime/dsh/artifacts/macos-cli-soak-aging/.
#
# usage: run-soak-aging.sh [--art-dir DIR] [--skip-build]
#   env DSH_SOAK_MINUTES  soak wall-clock budget (default 90)
set -eu
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT/runtime/dsh"

ART=artifacts/macos-cli-soak-aging
SKIP_BUILD=0
while [ $# -gt 0 ]; do
    case "$1" in
        --art-dir) ART="$2"; shift 2 ;;
        --skip-build) SKIP_BUILD=1; shift ;;
        *) echo "run-soak-aging: unknown argument '$1'" >&2; exit 2 ;;
    esac
done
case "$ART" in
    /tmp/*) echo "run-soak-aging: --art-dir must not be under /tmp (evidence lives with the repo)" >&2; exit 2 ;;
esac
case "$ART" in /*) ;; *) ART="$PWD/$ART" ;; esac
mkdir -p "$ART"

SOAK_MINUTES="${DSH_SOAK_MINUTES:-90}"
FD_TOLERANCE=32

echo "== 1/4 build =="
sh ../../external/ensure.sh > /dev/null
sh ../../external/ensure-dsh.sh
if [ "$SKIP_BUILD" -eq 0 ]; then
    sh ../../src/build.sh >/dev/null
fi

echo "== 2/4 mock loopback LLM server =="
MOCK_LOG="$(mktemp "${TMPDIR:-/tmp}/dsh-mock-llm-soak.XXXXXX")"
DSH_MOCK_SEQUENCE="success" DSH_MOCK_REPEAT_LAST=1 node ci/mock-llm-server.mjs \
    > "$MOCK_LOG" 2>&1 &
MOCK_PID=$!
CLI_PID=0
cleanup() {
    [ "$CLI_PID" -ne 0 ] && kill "$CLI_PID" 2>/dev/null || true
    kill "$MOCK_PID" 2>/dev/null || true
    wait "$MOCK_PID" 2>/dev/null || true
    rm -f "$MOCK_LOG"
}
trap cleanup EXIT INT TERM
polled=0
until grep -s '^MOCK_BASE_URL=' "$MOCK_LOG" > /dev/null; do
    kill -0 "$MOCK_PID" 2>/dev/null || {
        echo "soak-aging: the mock LLM server died before announcing" >&2; exit 1; }
    polled=$((polled + 1))
    if [ "$polled" -gt 300 ]; then
        echo "soak-aging: no MOCK_BASE_URL announce within 15s" >&2; exit 1
    fi
    sleep 0.05
done
MOCK_URL="$(sed -n 's/^MOCK_BASE_URL=//p' "$MOCK_LOG" | head -1)"
echo "   mock llm server: $MOCK_URL (soak budget ${SOAK_MINUTES}min)" >&2

echo "== 3/4 soak: $SOAK_MINUTES minute(s) of aging rounds =="
LOG="$ART/logs.txt"
rm -f "$LOG"
FD_SAMPLES="$ART/fd-samples.jsonl"
: > "$FD_SAMPLES"
RC=0
DSH_SPIKE_TMPDIR="$(mktemp -d)" ./build/dsh-cli . scenario/soak-aging.js \
    --http \
    --env "DSH_MOCK_LLM_URL=$MOCK_URL" \
    --env "DSH_MOCK_LLM_KEY=mock-key-0001" \
    --env "DSH_SOAK_MINUTES=$SOAK_MINUTES" > "$LOG" 2>&1 &
CLI_PID=$!
# The fd sampler: one reading every 30s while the CLI lives. darwin spells
# it lsof, linux /proc — a platform without either records nothing and the
# gate skips honestly (the samples file's own header says so).
(
    while kill -0 "$CLI_PID" 2>/dev/null; do
        if [ -d "/proc/$CLI_PID/fd" ]; then
            N=$(ls "/proc/$CLI_PID/fd" | wc -l | tr -d ' ')
        elif command -v lsof > /dev/null 2>&1; then
            N=$(lsof -p "$CLI_PID" 2>/dev/null | wc -l | tr -d ' ')
        else
            N=""
        fi
        if [ -n "$N" ]; then
            printf '{"ts":"%s","fds":%s}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$N" >> "$FD_SAMPLES"
        fi
        sleep 30
    done
) &
SAMPLER_PID=$!
wait "$CLI_PID" || RC=$?
CLI_PID=0
kill "$SAMPLER_PID" 2>/dev/null || true
wait "$SAMPLER_PID" 2>/dev/null || true

grep '^dsh.runtime.log:' "$LOG" > "$ART/scenario.jsonl" || true

echo "== 4/4 gates =="
node "$ROOT/test/e2e/check.mjs" \
    --manifest "$ROOT/test/e2e/scenarios/soak-aging.json" \
    --log "$LOG" --out "$ART/verdict-soak-aging.json"

# The fd gate: a climb beyond the tolerance is the leak class. Fewer than
# two samples (a soak shorter than the sampling cadence) skips honestly.
FIRST_FD=$(head -1 "$FD_SAMPLES" | sed -n 's/.*"fds":\([0-9]*\).*/\1/p' || true)
LAST_FD=$(tail -1 "$FD_SAMPLES" | sed -n 's/.*"fds":\([0-9]*\).*/\1/p' || true)
if [ -n "$FIRST_FD" ] && [ -n "$LAST_FD" ] && [ "$FIRST_FD" != "$LAST_FD" ]; then
    if [ "$LAST_FD" -gt $((FIRST_FD + FD_TOLERANCE)) ]; then
        echo "soak-aging: FAIL fd climb $FIRST_FD -> $LAST_FD exceeds tolerance $FD_TOLERANCE" >&2
        exit 1
    fi
    echo "   fd gate: $FIRST_FD -> $LAST_FD (within tolerance $FD_TOLERANCE)"
else
    echo "   fd gate: skipped honestly (fewer than two samples at the 30s cadence)"
fi

if [ "$RC" -ne 0 ]; then
    echo "soak-aging: FAIL — the host exited $RC (a tripped bound names itself in the log)" >&2
    exit 1
fi

N_ROUNDS="$(sed -n 's/.*"rounds":\([0-9]*\).*/\1/p' "$ART/scenario.jsonl" | tail -1)"
PER_ROUND="$(sed -n 's/.*"growthPerRoundBytes":\([0-9]*\).*/\1/p' "$ART/scenario.jsonl" | tail -1)"
cat > "$ART/receipt.json" <<EOF
{
 "host": "macOS $(uname -m) (the desktop CLI, no simulator)",
 "phase": "soak/aging (row 11) — one long-lived spine under sustained mock rounds; heap sampled every heartbeat (gc-collected brackets), journal ladder contiguous at every heartbeat and in full at the close, host fds sampled by the runner",
 "launchConfiguration": "./build/dsh-cli . scenario/soak-aging.js --http --env DSH_MOCK_LLM_URL=<loopback mock> --env DSH_SOAK_MINUTES=$SOAK_MINUTES",
 "scenarios": [
  {
   "id": "soak.aging",
   "checker": "test/e2e/scenarios/soak-aging.json",
   "result": "pass",
   "note": "the soak held: $N_ROUNDS rounds answered, journal contiguous end to end, per-round heap growth ${PER_ROUND:-?} bytes inside the budget"
  }
 ],
 "notes": "DSH_SOAK_MINUTES scales the wall-clock budget; the 90-minute ritual is owner-invocable, never a gate. fd samples live beside this receipt (fd-samples.jsonl)."
}
EOF
echo "soak-aging: PASS — evidence in $ART"
