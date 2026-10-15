#!/bin/sh
# tools/static-analysis/clang-tidy.sh — the clang-tidy leg of the
# static-analysis CI workflow (test-hardening row 9).
#
# WHY: the C spine (src/) is compiled by three platform toolchains, but no CI
# leg inspects it semantically — c-core compiles + tests it, nothing looks for
# the defect classes the compiler stays quiet about (uninitialized reads, dead
# stores, leaking ownership, ...). This leg runs clang-tidy over exactly the
# three spine TUs (src/CMakeLists.txt's own sources) with a defect-class check
# set — no style checks (see .clang-tidy for the set and the exclusions).
#
# Baseline discipline (warn level, row 9): existing findings live in
# baselines/clang-tidy.txt, one normalized finding per line —
# `src/file.c:LINE [check-id]`, LC_ALL=C sorted. `check` (the CI mode) goes
# red ONLY on findings absent from the baseline — new violations, zero
# tolerance; baseline entries whose finding disappeared (fixed, or its line
# moved) are reported as informational. Regenerate with `gen` — in the PINNED
# CI toolchain (the workflow's update_baselines dispatch run), never by hand
# on a dev machine: clang-tidy findings differ per clang version, and the
# baseline must be produced by the same version that gates.
#
# Requires: a configured build dir with compile_commands.json —
#   cmake -S . -B tmp/build-tidy -DCMAKE_EXPORT_COMPILE_COMMANDS=ON
# Configure-time vendor materialization (cmake/Vendor.cmake) runs the ensure
# pins first, so the engine headers the spine includes exist. The build dir
# defaults under tmp/ (the repo's gitignored scratch): a cmake configure
# drops compiler-probe C files that no syntax checker should have to parse.
# The vendored engine TUs are NOT scanned: upstream defects are not this
# repo's to gate (D6); the header filter pins diagnostics to src/ too.
#
# usage: clang-tidy.sh gen|check   (env: CLANG_TIDY, CLANG_TIDY_BUILD_DIR)
# exit: 0 = no new findings; 1 = new findings / compile errors / tool failure;
#       2 = invocation or setup error.

set -eu
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

MODE="${1:-}"
case "$MODE" in
gen | check) ;;
*)
    echo "usage: $0 gen|check" >&2
    exit 2
    ;;
esac

CLANG_TIDY_BIN="${CLANG_TIDY:-clang-tidy}"
BUILD_DIR="${CLANG_TIDY_BUILD_DIR:-tmp/build-tidy}"
BASELINE="baselines/clang-tidy.txt"
HEADER_FILTER='.*/src/dsh_[a-z_]+\.h$'
# Exactly dsh-core's own sources (src/CMakeLists.txt); the vendored engine
# TUs (quickjs-ng / wasm3 / zstd) stay out of the scan.
TUS="src/dsh_runtime_host.c src/dsh_socket.c src/dsh_wasm.c"

if [ ! -f "$BUILD_DIR/compile_commands.json" ]; then
    echo "clang-tidy: FAIL — $BUILD_DIR/compile_commands.json missing;" \
        "run: cmake -S . -B $BUILD_DIR -DCMAKE_EXPORT_COMPILE_COMMANDS=ON" >&2
    exit 2
fi

# The raw run. A tool-level failure (bad -p, missing TU entry, crash) must
# never normalize into "no findings" — propagate it as red.
RAW="$("$CLANG_TIDY_BIN" -p "$BUILD_DIR" --header-filter="$HEADER_FILTER" $TUS 2>&1)" || {
    printf '%s\n' "$RAW"
    echo "clang-tidy: FAIL — $CLANG_TIDY_BIN exited non-zero (tool failure, not findings)" >&2
    exit 1
}

# 1. Untagged `error:` lines are compile failures: the TU did not parse, so
#    its analysis is void and the run may not pass (rule 5 — fail loud; a
#    broken-spine green here would be the vacuous-gate trap).
COMPILE_ERRORS="$(printf '%s\n' "$RAW" | grep -E ':[0-9]+:[0-9]+: error: ' || true)"
if [ -n "$COMPILE_ERRORS" ]; then
    printf '%s\n' "$COMPILE_ERRORS"
    echo "clang-tidy: FAIL — compile errors above; analysis is void until the spine compiles" >&2
    exit 1
fi

# 2. Normalize: `/abs/path/src/file.c:LINE:COL: warning: msg [check-id]` →
#    `src/file.c:LINE [check-id]`. A diagnostic record must carry a trailing
#    [check-id] tag and a numeric line — notes, summaries, and plain text are
#    not findings. LC_ALL=C sort keeps the baseline byte-stable.
CURRENT="$(printf '%s\n' "$RAW" | awk -v root="$ROOT" '
    $0 ~ /\[[A-Za-z0-9._,-]+\][ \t]*$/ {
        path = $0
        sub(/:.*/, "", path)
        rest = $0
        sub(/^[^:]*:/, "", rest)
        line = rest
        sub(/:.*/, "", line)
        if (line !~ /^[0-9]+$/) next
        if (rest !~ /: (warning|error): /) next
        tag = $0
        sub(/^.*\[/, "", tag)
        sub(/\][ \t]*$/, "", tag)
        if (index(path, root "/") == 1) path = substr(path, length(root) + 2)
        print path ":" line " [" tag "]"
    }' | LC_ALL=C sort -u)"

TMP="$(mktemp "${TMPDIR:-/tmp}/clang-tidy-baseline.XXXXXX")"
: >"$TMP"
if [ -n "$CURRENT" ]; then
    printf '%s\n' "$CURRENT" >>"$TMP"
fi

if [ "$MODE" = "gen" ]; then
    mkdir -p "$(dirname "$BASELINE")"
    mv "$TMP" "$BASELINE"
    echo "clang-tidy: baseline regenerated — $BASELINE ($(wc -l <"$BASELINE" | tr -d ' ') findings)"
    exit 0
fi

if [ ! -f "$BASELINE" ]; then
    rm -f "$TMP"
    echo "clang-tidy: FAIL — $BASELINE missing; regenerate it via the workflow's" \
        "update_baselines dispatch (or: $0 gen with a matching toolchain)" >&2
    exit 2
fi

NEW="$(comm -13 "$BASELINE" "$TMP")"
STALE="$(comm -23 "$BASELINE" "$TMP")"

if [ -n "$NEW" ]; then
    printf '%s\n' "$NEW"
    echo "clang-tidy: FAIL — $(printf '%s' "$NEW" | wc -l | tr -d ' ') NEW finding(s) above" \
        "(absent from the baseline): fix the code, or — only when the finding is" \
        "addressed by suppression/design — regenerate the baseline via the workflow's" \
        "update_baselines dispatch" >&2
    rm -f "$TMP"
    exit 1
fi

if [ -n "$STALE" ]; then
    printf '%s\n' "$STALE"
    echo "clang-tidy: $(printf '%s' "$STALE" | wc -l | tr -d ' ') baseline entr(ies) above no longer" \
        "match (fixed, or the line moved) — informational; prune them with a regen" \
        "(workflow update_baselines dispatch) when convenient"
fi

rm -f "$TMP"
echo "clang-tidy: green — no findings outside the baseline ($BASELINE: $(wc -l <"$BASELINE" | tr -d ' ') entries)"
