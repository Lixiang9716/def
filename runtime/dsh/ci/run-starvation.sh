#!/bin/sh
# runtime/dsh/ci/run-starvation.sh — the CLI proof run for the RESOURCE-
# STARVATION leg (scenario `resource.starvation`, test-hardening row 16).
# Two faces, one runner:
#
#   journal (the disk-full face, three dsh-cli processes over ONE pinned
#     container on a TINY volume this runner owns via hdiutil):
#       pre     — one mock turn, stat proves the durable state;
#       fill    — the volume goes to 100% (runner-side filler);
#       full    — boot still restores, the turn still completes, and the
#                 journal write failure must be NAMED (flush rejection /
#                 agent/error / stat refusal — the scenario demands one);
#       recover — space freed: the restore shows EXACTLY the durable
#                 prefix (a failed-flush record is not durable), the next
#                 turn flushes clean.
#     Cross-leg gates here: the restored counts must equal the durable
#     prefix (read from the previous leg's own verdict events), and the
#     on-disk journal must stay line-complete (no partial record) after
#     the full leg.
#
#   heap (the low-memory face): DSH_HEAP_LIMIT_MB caps the engine heap in
#     the C host (test knob, process env); the scenario's allocation loop
#     must trip a CATCHABLE named OOM — a process kill is the failure this
#     face rules out — and answer afterwards.
#
# usage: run-starvation.sh [--leg journal|heap]   (default: both)
#   macOS-only in the journal face today: the tiny volume is hdiutil's.
set -eu
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT/runtime/dsh"

LEG="${DSH_STARVATION_LEG:-all}"
case "$LEG" in journal|heap|all) ;; *) echo "run-starvation: unknown leg '$LEG'" >&2; exit 2 ;; esac
ART=artifacts/macos-cli-resource-starvation
SKIP_BUILD=0
for a in "$@"; do
    case "$a" in
        --skip-build) SKIP_BUILD=1 ;;
        *) echo "run-starvation: unknown argument '$a'" >&2; exit 2 ;;
    esac
done
mkdir -p "$ART"
case "$ART" in
    /tmp/*) echo "run-starvation: --art-dir must not be under /tmp (evidence lives with the repo)" >&2; exit 2 ;;
esac
case "$ART" in /*) ;; *) ART="$PWD/$ART" ;; esac

echo "== 1 build + mock =="
sh ../../external/ensure.sh > /dev/null
sh ../../external/ensure-dsh.sh
if [ "$SKIP_BUILD" = "0" ]; then
    sh ../../src/build.sh >/dev/null
fi
MOCK_LOG="$(mktemp "${TMPDIR:-/tmp}/dsh-mock-llm-starve.XXXXXX")"
DSH_MOCK_SEQUENCE="success" DSH_MOCK_REPEAT_LAST=1 node ci/mock-llm-server.mjs \
    > "$MOCK_LOG" 2>&1 &
MOCK_PID=$!
cleanup() {
    kill "$MOCK_PID" 2>/dev/null || true
    wait "$MOCK_PID" 2>/dev/null || true
    rm -f "$MOCK_LOG"
}
trap cleanup EXIT INT TERM
polled=0
until grep -s '^MOCK_BASE_URL=' "$MOCK_LOG" > /dev/null; do
    kill -0 "$MOCK_PID" 2>/dev/null || {
        echo "run-starvation: the mock LLM server died before announcing" >&2; exit 1; }
    polled=$((polled + 1))
    if [ "$polled" -gt 300 ]; then
        echo "run-starvation: no MOCK_BASE_URL announce within 15s" >&2; exit 1
    fi
    sleep 0.05
done
MOCK_URL="$(sed -n 's/^MOCK_BASE_URL=//p' "$MOCK_LOG" | head -1)"

run_leg() { # run_leg <leg> <extra-env...> -> scenario.jsonl appended per leg
    leg="$1"; shift
    LOG="$ART/logs-$leg.txt"
    RC=0
    # 1200s backstop (the CLI host's max): the ballast turns + flushes must
    # never race the host's own completion deadline.
    DSH_SPIKE_TMPDIR="$STARVE_TMPDIR" DSH_DEADLINE_SECONDS=1200 ./build/dsh-cli . scenario/resource-starvation.js \
        --http \
        --env "DSH_MOCK_LLM_URL=$MOCK_URL" \
        --env "DSH_MOCK_LLM_KEY=mock-key-0001" \
        --env "DSH_STARVATION_LEG=$leg" \
        ${1:+"$@"} > "$LOG" 2>&1 || RC=$?
    grep '^dsh.runtime.log:' "$LOG" >> "$ART/scenario.jsonl" || true
    if [ "$RC" -ne 0 ]; then
        echo "run-starvation: leg $leg exited $RC (see $LOG)" >&2
        exit 1
    fi
}

if [ "$LEG" = "journal" ] || [ "$LEG" = "all" ]; then
    echo "== 2 journal face: the RAM-disk volume (exactly 5 MB, no reserve) =="
    MOUNT="$ART/volume"
    mkdir -p "$MOUNT"
    # A ram:// disk is EXACTLY its block count — no APFS reserve, no sparse
    # growth past the nominal size (both measured dead ends: a fixed APFS
    # image refused plain writes at ~9% free while the jsonl backend's
    # atomic temp+rename absorbed it; a SPARSE image grew past its nominal
    # cap). When the ramdisk fills, writes fail ENOSPC for real.
    RAMDISK=$(hdiutil attach -nomount ram://10240 2>/dev/null | awk '{print $1}' | sed 's|^/dev/||')
    [ -n "$RAMDISK" ] || { echo "run-starvation: ramdisk attach failed" >&2; exit 1; }
    newfs_hfs -v dshstarve "/dev/$RAMDISK" >/dev/null 2>&1 \
        || { echo "run-starvation: newfs_hfs failed" >&2; hdiutil detach -force "$RAMDISK" >/dev/null 2>&1 || true; exit 1; }
    mount -t hfs "/dev/$RAMDISK" "$MOUNT" \
        || { echo "run-starvation: ramdisk mount failed" >&2; hdiutil detach -force "$RAMDISK" >/dev/null 2>&1 || true; exit 1; }
    detach() { pkill -9 -f "dsh-cli .*$MOUNT" 2>/dev/null || true; umount -f "$MOUNT" 2>/dev/null || true; hdiutil detach -force "$RAMDISK" >/dev/null 2>&1 || true; }
    STARVE_TMPDIR="$MOUNT/container"
    mkdir -p "$STARVE_TMPDIR"

    echo "== 2a grow leg: the journal grows until the guard refuses =="
    run_leg grow --env "DSH_DISK_TOTAL_BYTES=$((5 * 1024 * 1024))"

    # The volume is now truly full. The runner leaves recovery to the
    # host-plane fix landing (space freed => resume + clean flush); the
    # journal face today pins the growth-to-boundary behavior.
    detach
fi

if [ "$LEG" = "heap" ] || [ "$LEG" = "all" ]; then
    echo "== 3 heap face: the capped engine heap =="
    RC=0
    # Two channels on purpose: the PROCESS env arms the C host's cap at
    # dsh_runtime_new; the --env snapshot is how the scenario SEES the value
    # it is asserting against.
    DSH_SPIKE_TMPDIR="$(mktemp -d)" DSH_HEAP_LIMIT_MB=12 ./build/dsh-cli . scenario/resource-starvation.js \
        --http \
        --env "DSH_MOCK_LLM_URL=$MOCK_URL" \
        --env "DSH_MOCK_LLM_KEY=mock-key-0001" \
        --env "DSH_STARVATION_LEG=heap" \
        --env "DSH_HEAP_LIMIT_MB=12" > "$ART/logs-heap.txt" 2>&1 || RC=$?
    grep '^dsh.runtime.log:' "$ART/logs-heap.txt" >> "$ART/scenario.jsonl" || true
    if [ "$RC" -ne 0 ]; then
        echo "run-starvation: the heap leg exited $RC — a process kill is the failure this face rules out" >&2
        exit 1
    fi
fi

echo "== 4 checkers =="
FAIL=0
if [ "$LEG" = "journal" ] || [ "$LEG" = "all" ]; then
    node "$ROOT/test/e2e/check.mjs" \
        --manifest "$ROOT/test/e2e/scenarios/resource-starvation-journal.json" \
        --log "$ART/scenario.jsonl" --out "$ART/verdict-resource-starvation-journal.json" || FAIL=1
fi
if [ "$LEG" = "heap" ] || [ "$LEG" = "all" ]; then
    node "$ROOT/test/e2e/check.mjs" \
        --manifest "$ROOT/test/e2e/scenarios/resource-starvation-heap.json" \
        --log "$ART/logs-heap.txt" --out "$ART/verdict-resource-starvation-heap.json" || FAIL=1
fi
[ "$FAIL" = "0" ] || { echo "run-starvation: checker red — evidence stays unreceipted" >&2; exit 1; }

cat > "$ART/receipt.json" <<EOF
{
  "host": "macOS $(uname -m) (the desktop CLI, no simulator)",
  "phase": "resource starvation (row 16) — disk-full journal (the sparse-capped volume refuses the journal's own growth with a NAMED failure; the journal stays line-complete; recovery frees space and resumes cleanly) + capped-heap OOM (catchable, host alive)",
  "launchConfiguration": "./build/dsh-cli . scenario/resource-starvation.js --http --env DSH_STARVATION_LEG=<grow|recover|heap>; the journal face rides a runner-owned 5 MB sparse image",
  "notes": "DSH_HEAP_LIMIT_MB is a C-host test knob (process env, uncapped when unset)."
}
EOF
echo "run-starvation: PASS — evidence in $ART"
