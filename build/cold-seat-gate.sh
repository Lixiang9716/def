#!/bin/sh
# build/cold-seat-gate.sh — the cold-seat materialization gate (plan §3.7).
#
# A fresh worktree passes every static gate and still cannot run a single
# upstream spec: the untracked materialization a seat needs (the vendored
# closure, the submodule corpus, the Node resolution farm, the node-pty
# native binding, the transpile products, the built CLI) is exactly the
# surface that silently rots — the 2026-10-22 cold-seat pty regression was
# one of its failures. This script drives the full chain a cold seat needs
# to reach one green spec on BOTH legs, and names the missing face when any
# link breaks:
#
#   [gate 1/7] vendor closure reachability — when the primary checkout
#              cannot source the sync verbs' inputs (a bare CI checkout),
#              the pinned ensure scripts materialize it in the seat first;
#              against a materialized primary this is a no-op and the
#              rsync in step 2 stays the one materializer
#   [gate 2/7] build/ensure-seat.sh --verify — rsync the manifest's trees
#              from the primary, run the sync verbs, execute the provisions
#              (submodule clone, farm build, node-pty compile), probe
#              bundle-files + closures
#   [gate 3/7] test/upstream-suite's esbuild host (npm ci when absent)
#   [gate 4/7] materialization faces, named: submodule corpus, dsh-tests
#              vendor, farm link integrity, node-pty binding
#   [gate 5/7] transpile (+ the gated spec exists in its products)
#   [gate 6/7] dsh-cli (built when missing) + the qjs leg
#   [gate 7/7] the node leg
#
# Exit 0 is the only green. Every failure names its face — a bare timeout
# is never a verdict.
#
# usage: sh build/cold-seat-gate.sh <worktree-root>
#        sh build/cold-seat-gate.sh <worktree-root> --self-test
#
#   --self-test  rejection-case proof on an already-green worktree (rule 6:
#     a gate ships the case that proves it catches what it claims). It runs
#     the full gate (green), repoints the farm's node-pty link at a void,
#     then runs the gate's CHECK pipeline (steps 3-7) and requires RED
#     naming face 'farm'; then restores with build/ensure-seat.sh (the
#     parity provision relinks the farm) and requires GREEN. Exit 0 only
#     when both directions were actually observed. The red observation
#     deliberately skips the repair stages (steps 1-2): ensure-seat's
#     provision provably heals every named face (parity-node-modules.sh
#     relinks every dangling claim), so a full run would repair the plant
#     before any check could see it — the repair is the recovery story, and
#     phase 4 proves that story works.
#
# Offline posture: the gate adds no network path of its own. The ensure
# scripts it delegates to are the repository's only fetch surface, and they
# no-op against pin-stamped trees — a primary-materialized seat (the common
# case) never dials out.
set -u

STEP_TOTAL=7
SELF_TEST=0
WT=""
WT_ARG=""

# The one gated spec, and why it is this one: the smallest corpus spec that
# exercises the two hardest seams on BOTH legs — a real PTY spawn (the node
# leg through the vendored node-pty binding, the qjs leg through the forkpty
# shim) and node:module createLazyRequire through the shim table — at ~3s
# wall across both legs, 55/0 assertions each (measured 2026-10-23; the
# candidate comparison lives in today's Agent Note under implemented/process/).
SPEC_NAME='api__terminal-controller__tests__controller.spec.mjs'
# The sweep's own per-leg cap (test/verifications.mjs, upstream-sweep
# drive.legTimeoutMs). One attempt, no retry: a gate has no flake budget.
LEG_TIMEOUT=90

usage() {
    echo "usage: sh build/cold-seat-gate.sh <worktree-root>              # materialize + verify, both legs"
    echo "       sh build/cold-seat-gate.sh <worktree-root> --self-test  # rejection case: red then green"
}

for arg in "$@"; do
    case "$arg" in
        --self-test) SELF_TEST=1 ;;
        -h|--help) usage; exit 0 ;;
        --*) usage >&2; echo "cold-seat-gate: unknown flag '$arg'" >&2; exit 2 ;;
        *) [ -z "$WT_ARG" ] || {
               usage >&2
               echo "cold-seat-gate: one worktree-root at most (got '$WT_ARG' and '$arg')" >&2
               exit 2
           }
           WT_ARG="$arg" ;;
    esac
done
[ -n "$WT_ARG" ] || { usage >&2; echo "cold-seat-gate: a worktree-root is required" >&2; exit 2; }

WT="$(cd "$WT_ARG" && pwd)" || { echo "cold-seat-gate: not a directory: $WT_ARG" >&2; exit 2; }
[ -e "$WT/.git" ] || { echo "cold-seat-gate: not a git checkout or worktree (no .git): $WT" >&2; exit 2; }
[ -f "$WT/build/ensure-seat.sh" ] || { echo "cold-seat-gate: not a dsh-mobile checkout (no build/ensure-seat.sh): $WT" >&2; exit 2; }
[ -f "$WT/.gov/materialization.json" ] || { echo "cold-seat-gate: no .gov/materialization.json in $WT" >&2; exit 2; }

# The primary checkout of this worktree graph — the same resolution
# ensure-seat does, needed here only to decide step 1 (whether the primary
# can source the sync verbs' inputs at all).
COMMON_DIR="$(git -C "$WT" rev-parse --git-common-dir)" || { echo "cold-seat-gate: $WT is not a working git checkout" >&2; exit 2; }
case "$COMMON_DIR" in /*) ;; *) COMMON_DIR="$WT/$COMMON_DIR" ;; esac
PRIMARY="$(dirname "$(cd "$COMMON_DIR" && pwd)")"

command -v git >/dev/null 2>&1 || { echo "cold-seat-gate: git not found on PATH" >&2; exit 2; }
command -v node >/dev/null 2>&1 || { echo "cold-seat-gate: node not found on PATH — ensure-seat, the transpiler, and the node leg all need it" >&2; exit 2; }

log() { printf 'cold-seat-gate: %s\n' "$*"; }
step() { printf 'cold-seat-gate: [gate %s/%s] %s\n' "$1" "$STEP_TOTAL" "$2"; }
fail_step() { # fail_step <step-no> <message> — prints the named verdict, returns 1
    printf 'cold-seat-gate: [gate %s/%s] FAIL: %s\n' "$1" "$STEP_TOTAL" "$2" >&2
    return 1
}

# run_with_timeout <seconds> <log-file> <command...> — run <command> with
# stdout+stderr in <log-file>; returns the command's status, or 124 with a
# named TIMEOUT line when the deadline passes. A poll watchdog (child pid +
# wall deadline) rather than coreutils timeout, which macOS does not ship —
# the gate must behave identically on a dev seat and on CI.
run_with_timeout() {
    _rw_limit="$1"; _rw_log="$2"; shift 2
    _rw_dir="$(mktemp -d "${TMPDIR:-/tmp}/csg-run.XXXXXX")"
    _rw_stamp="$_rw_dir/status"
    (
        "$@"
        echo $? >"$_rw_stamp"
    ) >"$_rw_log" 2>&1 &
    _rw_pid=$!
    _rw_deadline=$(( $(date +%s) + _rw_limit ))
    while [ ! -f "$_rw_stamp" ] && [ "$(date +%s)" -lt "$_rw_deadline" ]; do
        sleep 1
    done
    if [ -f "$_rw_stamp" ]; then
        _rw_status="$(cat "$_rw_stamp")"
        [ -n "$_rw_status" ] || _rw_status=1
        wait "$_rw_pid" 2>/dev/null || true
        rm -rf "$_rw_dir"
        return "$_rw_status"
    fi
    kill "$_rw_pid" 2>/dev/null || true
    rm -rf "$_rw_dir"
    printf 'cold-seat-gate: TIMEOUT after %ss: %s\n' "$_rw_limit" "$*" >&2
    return 124
}

# ---- gate steps --------------------------------------------------------------
# do_closure_pre / do_ensure_seat are the REPAIR stages; do_toolchain ..
# do_node_leg are the CHECK pipeline (gate_checks). --self-test runs the
# checks without the repairs, for the reason in the header.

do_closure_pre() {
    if [ ! -d "$PRIMARY/external/dsh" ] || [ ! -d "$PRIMARY/external/npm" ]; then
        log "primary carries no vendored closure — materializing it in the seat first (the sync verbs read it through the seat)"
        if ! (cd "$WT" && sh external/ensure.sh); then
            fail_step 1 "external/ensure.sh failed (the pinned engines: quickjs-ng/wasm3/zstd — its stderr names the fetch or digest that broke)"
            return 1
        fi
        if ! (cd "$WT" && sh external/ensure-dsh.sh); then
            fail_step 1 "external/ensure-dsh.sh failed (the vendored closure: external/dsh + external/npm — its stderr names the MISSING/UNSTAMPED pin row)"
            return 1
        fi
        if ! (cd "$WT" && sh external/ensure-dsh-tests.sh); then
            fail_step 1 "external/ensure-dsh-tests.sh failed (face 'dsh-tests vendor': the upstream test corpus)"
            return 1
        fi
    else
        log "primary carries the vendored closure — ensure-seat's rsync stays the one materializer"
    fi
}

do_ensure_seat() {
    if ! command -v gov >/dev/null 2>&1 && [ ! -x "$HOME/.local/bin/gov" ]; then
        fail_step 2 "govrail not found — ensure-seat --verify probes bundle-files + closures through gov (CI installs the pin: pip install govrail==0.52.0; locally: uv tool install govrail)"
        return 1
    fi
    if ! (cd "$WT" && sh build/ensure-seat.sh --verify "$WT"); then
        fail_step 2 "ensure-seat --verify failed — the materialization itself is red; its output above names the stage (rsync / sync verb / provision / gov probe) and the face (a SKIP row, a failed submodule clone, an unbuilt farm, or a gate diff)"
        return 1
    fi
}

do_toolchain() {
    if [ ! -d "$WT/test/upstream-suite/node_modules" ]; then
        log "test/upstream-suite/node_modules absent — npm ci (the transpiler's esbuild host)"
        command -v npm >/dev/null 2>&1 || { fail_step 3 "npm not found — the transpiler's esbuild host cannot be materialized"; return 1; }
        if ! (cd "$WT" && npm ci --prefix test/upstream-suite --no-fund --no-audit); then
            fail_step 3 "npm ci for test/upstream-suite failed (face 'transpiler toolchain': esbuild — npm's error is above)"
            return 1
        fi
    else
        log "test/upstream-suite/node_modules present"
    fi
}

do_faces() {
    # The pinned submodule corpus. Transpile only WARNS on an absent
    # submodule and shrinks manifest.json silently (transpile.mjs:121), so
    # the gate — not transpile — is what makes this face fatal.
    if [ ! -e "$WT/third-party/deepseek-harness/.git" ] || [ -z "$(ls -A "$WT/third-party/deepseek-harness" 2>/dev/null)" ]; then
        fail_step 4 "face 'submodule': third-party/deepseek-harness is not a materialized corpus checkout — build/ensure-seat.sh's clone-submodule provision repairs it (clone from the primary + the lib/ overlay a pure clone lacks)"
        return 1
    fi
    # The dsh-tests vendor row, read from the manifest: the row is
    # version-suffixed and a re-pin renames it, so it is never hardcoded.
    TESTS_ROW="$(node -e 'const m=require(process.argv[1]);const t=m.trees.find(x=>x.indexOf("external/dsh-tests@")===0);if(!t){process.exit(1)}console.log(t)' "$WT/.gov/materialization.json")" || {
        fail_step 4 "no external/dsh-tests@ row in .gov/materialization.json — the manifest lost the corpus tree"
        return 1
    }
    if [ ! -d "$WT/$TESTS_ROW/packages" ]; then
        fail_step 4 "face 'dsh-tests vendor': $TESTS_ROW (the upstream test corpus the transpiler reads) is missing — external/ensure-dsh-tests.sh materializes it, and the parity provision self-heals it"
        return 1
    fi
    # The Node resolution farm, verified structurally: every symlink must
    # resolve. A dangling claim is the #627/#328 rot class.
    FARM="$WT/external/node_modules"
    if [ ! -d "$FARM" ]; then
        fail_step 4 "face 'farm': external/node_modules (the Node resolution farm) is absent — the parity provision builds it IN the seat; it is never rsynced (the links are seat-absolute, #627)"
        return 1
    fi
    DANGLING=""
    for link in "$FARM"/* "$FARM"/@*/*; do
        [ -L "$link" ] || continue
        [ -e "$link" ] || DANGLING="$DANGLING $link"
    done
    if [ -n "$DANGLING" ]; then
        fail_step 4 "face 'farm': dangling link(s) in external/node_modules:$DANGLING — the parity provision relinks every stale claim; build/ensure-seat.sh is the repair"
        return 1
    fi
    if [ ! -L "$FARM/node-pty" ] || [ ! -e "$FARM/node-pty" ]; then
        fail_step 4 "face 'farm': external/node_modules/node-pty does not resolve — the node leg loads the vendored node-pty through it (the gated spec spawns real PTY sessions on that leg)"
        return 1
    fi
    # The node-pty native binding: machine-built at provisioning time, never
    # committed. The glob follows a re-pin; the version is not hardcoded.
    PTY_NODE=""
    for cand in "$WT"/external/npm/node-pty@*/build/Release/pty.node; do
        if [ -f "$cand" ]; then PTY_NODE="$cand"; break; fi
    done
    if [ -z "$PTY_NODE" ]; then
        fail_step 4 "face 'node-pty binding': external/npm/node-pty@*/build/Release/pty.node is missing — the parity provision compiles it once per tree, and its stderr names a skipped build when node-gyp or the node headers are absent"
        return 1
    fi
    log "faces green: submodule corpus, dsh-tests vendor ($TESTS_ROW), farm links resolve, node-pty binding present"
}

do_transpile() {
    TRANSPILE_LOG="$(mktemp "${TMPDIR:-/tmp}/csg-transpile.XXXXXX")"
    if ! (cd "$WT" && node test/upstream-suite/transpile.mjs) >"$TRANSPILE_LOG" 2>&1; then
        cat "$TRANSPILE_LOG" >&2
        fail_step 5 "transpile failed — its output above names the corpus face it missed (the submodule, the dsh-tests vendor, or an esbuild transform)"
        return 1
    fi
    # Content-level submodule guard: transpile exits 0 with the corpus
    # shrunk when the submodule is absent (the warning at transpile.mjs:121).
    if grep -q 'deepseek-harness is NOT materialized' "$TRANSPILE_LOG"; then
        cat "$TRANSPILE_LOG" >&2
        fail_step 5 "face 'submodule': transpile reported the corpus checkout missing — manifest.json would shrink to a partial corpus"
        return 1
    fi
    rm -f "$TRANSPILE_LOG"
    if [ ! -f "$WT/runtime/dsh/upstream-tests/$SPEC_NAME" ]; then
        fail_step 5 "face 'transpile products': runtime/dsh/upstream-tests/$SPEC_NAME missing after transpile — the gated spec dropped out of the corpus (a new exclusion class, or a shrunk corpus)"
        return 1
    fi
    if [ ! -f "$WT/runtime/dsh/upstream-tests/manifest.json" ]; then
        fail_step 5 "face 'transpile products': runtime/dsh/upstream-tests/manifest.json missing after transpile"
        return 1
    fi
    log "transpiled — $SPEC_NAME present in runtime/dsh/upstream-tests"
}

do_qjs_leg() {
    if [ ! -x "$WT/runtime/dsh/build/dsh-cli" ]; then
        log "runtime/dsh/build/dsh-cli missing — building (sh src/build.sh)"
        if ! (cd "$WT" && sh src/build.sh); then
            fail_step 6 "the C host CLI build failed (sh src/build.sh — its stderr names the missing tool or the compile error)"
            return 1
        fi
    fi
    QJS_LOG="$(mktemp "${TMPDIR:-/tmp}/csg-qjs.XXXXXX")"
    # The qjs leg, verbatim from the sweep registry (test/verifications.mjs,
    # upstream-sweep qjs drive): inside runtime/dsh, the CLI drives the
    # upstream.suite scenario at the one gated spec. The $1/$2 in single
    # quotes are sh -c's OWN arguments (cwd, spec name), passed at the end —
    # not expansions this shell should perform.
    # shellcheck disable=SC2016
    run_with_timeout "$LEG_TIMEOUT" "$QJS_LOG" \
        sh -c 'cd "$1" && exec ./build/dsh-cli . scenario/upstream-suite-leg.js --env "DSH_UPSTREAM_SPEC=upstream-tests/$2"' \
        sh "$WT/runtime/dsh" "$SPEC_NAME"
    QJS_ST=$?
    if [ "$QJS_ST" -eq 124 ]; then
        tail -n 20 "$QJS_LOG" >&2
        fail_step 6 "the qjs leg exceeded the ${LEG_TIMEOUT}s per-leg cap — a timeout alone is never the verdict: the faces were verified green at [gate 4/7], so read the log at $QJS_LOG"
        return 1
    fi
    if [ "$QJS_ST" -ne 0 ]; then
        tail -n 20 "$QJS_LOG" >&2
        fail_step 6 "the qjs leg exited $QJS_ST (the CLI exits 1 when the spec reports failures — the sweep's exit contract)"
        return 1
    fi
    QJS_SUMMARY="$(grep -o '"event":"suite/summary".*' "$QJS_LOG" | tail -n 1)"
    if [ -z "$QJS_SUMMARY" ]; then
        fail_step 6 "the qjs leg produced no suite/summary line — the scenario runner never completed a suite; full log: $QJS_LOG"
        return 1
    fi
    case "$QJS_SUMMARY" in
        *'"failed":0'*) log "qjs leg green — $QJS_SUMMARY" ;;
        *)
            fail_step 6 "the qjs leg is red — suite/summary reports failures: $QJS_SUMMARY (full log: $QJS_LOG)"
            return 1
            ;;
    esac
    rm -f "$QJS_LOG"
}

do_node_leg() {
    NODE_LOG="$(mktemp "${TMPDIR:-/tmp}/csg-node.XXXXXX")"
    # The node leg, verbatim from the sweep registry (test/verifications.mjs,
    # upstream-sweep node-differential drive): the plain-Node reference runs
    # the spec through test/upstream-suite/smoke.mjs from the repo root.
    run_with_timeout "$LEG_TIMEOUT" "$NODE_LOG" \
        node "$WT/test/upstream-suite/smoke.mjs" "$SPEC_NAME"
    NODE_ST=$?
    if [ "$NODE_ST" -eq 124 ]; then
        tail -n 20 "$NODE_LOG" >&2
        fail_step 7 "the node leg exceeded the ${LEG_TIMEOUT}s per-leg cap — a timeout alone is never the verdict: the faces were verified green at [gate 4/7]; log at $NODE_LOG"
        return 1
    fi
    if [ "$NODE_ST" -ne 0 ]; then
        tail -n 20 "$NODE_LOG" >&2
        fail_step 7 "the node leg exited $NODE_ST — smoke.mjs exits 1 when the spec reports failures (its exit contract)"
        return 1
    fi
    NODE_SUMMARY="$(grep -o 'harness smoke: {.*}' "$NODE_LOG" | head -n 1)"
    if [ -z "$NODE_SUMMARY" ]; then
        fail_step 7 "the node leg produced no harness smoke verdict line — a MODULE-LEVEL FAILURE there means the node leg could not load the spec's imports (the farm or a vendored face); full log: $NODE_LOG"
        return 1
    fi
    case "$NODE_SUMMARY" in
        *'"failed":0'*) log "node leg green — $NODE_SUMMARY" ;;
        *)
            fail_step 7 "the node leg is red — $NODE_SUMMARY (full log: $NODE_LOG)"
            return 1
            ;;
    esac
    rm -f "$NODE_LOG"
}

gate_checks() {
    step 3 "upstream-suite toolchain"; do_toolchain || return 1
    step 4 "materialization faces";    do_faces     || return 1
    step 5 "transpile";                do_transpile || return 1
    step 6 "dsh-cli + qjs leg";        do_qjs_leg   || return 1
    step 7 "node leg";                 do_node_leg  || return 1
}

gate_run() {
    step 1 "vendor closure reachability";                 do_closure_pre  || return 1
    step 2 "ensure-seat --verify (the materialization)";  do_ensure_seat  || return 1
    gate_checks || return 1
    log "PASS — $WT (7/7 steps green)"
}

# ---- self-test ---------------------------------------------------------------
SELF_TOTAL=4
st_step() { printf 'cold-seat-gate: [self-test %s/%s] %s\n' "$1" "$SELF_TOTAL" "$2"; }
st_fail() { printf 'cold-seat-gate: [self-test %s/%s] FAIL: %s\n' "$1" "$SELF_TOTAL" "$2" >&2; }

self_test() {
    FARM="$WT/external/node_modules"
    PTY_LINK="$FARM/node-pty"
    SABOTAGE_TARGET="$FARM/.cold-seat-gate-self-test-dangling"

    st_step 1 "full gate on the unbroken worktree (this is also the materialization)"
    if ! gate_run; then
        st_fail 1 "the gate did not pass before any sabotage — the red/green proof needs a green pre-state; fix the worktree first"
        return 1
    fi

    st_step 2 "sabotage the farm: repoint external/node_modules/node-pty at a void"
    if [ ! -L "$PTY_LINK" ]; then
        st_fail 2 "external/node_modules/node-pty is not a symlink — the rejection case presumes the farm layout the parity provision builds"
        return 1
    fi
    ORIG_TARGET="$(readlink "$PTY_LINK")"
    ln -sfn "$SABOTAGE_TARGET" "$PTY_LINK" || { st_fail 2 "could not repoint $PTY_LINK"; return 1; }
    log "sabotaged: external/node_modules/node-pty -> $SABOTAGE_TARGET (was: $ORIG_TARGET)"

    st_step 3 "run the gate's check pipeline on the sabotaged farm — RED expected, naming face 'farm'"
    RED_LOG="$(mktemp "${TMPDIR:-/tmp}/csg-red.XXXXXX")"
    GATE_RED=1
    if gate_checks >"$RED_LOG" 2>&1; then
        GATE_RED=0
    fi
    cat "$RED_LOG"
    if [ "$GATE_RED" -eq 0 ]; then
        st_fail 3 "REJECTION CASE VACUOUS: the gate's checks PASSED on a sabotaged farm — they cannot catch the face they claim (rule 6)"
        return 1
    fi
    if ! grep -q "face 'farm'" "$RED_LOG"; then
        st_fail 3 "the gate went red but never named face 'farm' — a verdict must name the missing surface"
        return 1
    fi
    log "red observed: the checks failed naming face 'farm'"

    st_step 4 "restore with build/ensure-seat.sh (the parity provision relinks the farm), then the full gate — GREEN expected"
    if ! (cd "$WT" && sh build/ensure-seat.sh "$WT"); then
        st_fail 4 "ensure-seat failed to restore the sabotaged farm"
        return 1
    fi
    if [ ! -e "$PTY_LINK" ] || [ "$(readlink "$PTY_LINK" 2>/dev/null)" = "$SABOTAGE_TARGET" ]; then
        st_fail 4 "the farm link still resolves to the sabotage target after ensure-seat — restore incomplete"
        return 1
    fi
    if ! gate_run; then
        st_fail 4 "the gate did not return to green after the ensure-seat restore"
        return 1
    fi
    log "green observed — self-test complete: red and green both actually seen"
    return 0
}

if [ "$SELF_TEST" -eq 1 ]; then
    if self_test; then exit 0; fi
    exit 1
fi
gate_run || exit 1
exit 0
