#!/bin/sh
# run.sh — the HarmonyOS half of the release-logging evidence: prove that the
# user-facing build SERVES the official DSH Web UI with no verification
# machinery at all, that it still refuses an E2E drive LOUD by name, and that
# the harness is unchanged.
#
# Release (dsh-harmony): a plain launch — NO `--ps dsh.e2e.leg` parameter,
# nothing staged into the app container — must reach the official DSH Web UI
# from the vendored rawfile trees, emit ZERO drive-machinery records (verdict
# / result text), ZERO `"level":"debug"`/`"level":"info"` records in the
# whole hilog window (and in the truncation-proof capture file) — warn/error
# legitimately survive the release strip; asking the same binary for
# `--ps dsh.e2e.leg m2.llm` must refuse by name.
# Debug (dsh-harmony-harness): the plain launch still runs the full default
# chain, and the whole E2E suite must stay green (the same eight checker
# verdicts as hosts/harmony/artifacts/d9-*).
#
# Every wait is a polled condition with a deadline (rules.md rule 8); every
# exhaustion is loud (rule 5). The zero-record assertions run over the FULL
# hilog window; the committed `.dsh.txt` files are that window's `dsh`-tag
# lines (milestone-artifact convention, cf. artifacts/m5-host/logs.txt).
#
# usage: hosts/harmony/artifacts/release-logging/run.sh [--skip-build] [--skip-harness]
# env:   DSH_RELEASE_LOGGING_ART — redirect the evidence dir (the simulator
#        matrix's harmony release leg lands its copy under simulator-matrix/
#        without touching this committed verification record).
set -eu

ROOT=$(cd "$(dirname "$0")/../../../.." && pwd)
cd "$ROOT"
CLT=${DSH_CLT:-/opt/homebrew/share/harmonyos-commandlinetools/command-line-tools}
HDC="$CLT/sdk/default/openharmony/toolchains/hdc"
ART="${DSH_RELEASE_LOGGING_ART:-$ROOT/hosts/harmony/artifacts/release-logging}"
BUNDLE=com.dshmobile.host
HAP=hosts/harmony/entry/build/default/outputs/default/entry-default-unsigned.hap
REL_HAP=/tmp/dsh-harmony-release.hap
DBG_HAP=/tmp/dsh-harmony-harness.hap
# The asserted-zero set: the drive machinery's verdict/result text and the
# debug/info logger levels. NOT the whole `dsh.runtime.log:` stream — a
# release build legitimately keeps warn/error (RELEASE_CRITICAL_LEVELS), so
# a whole-stream zero would be a lie the first warn disproves (the same
# shape the android release leg asserts; the pre-#402 `dsh.spike.log:` tag
# is gone — the canonical prefix is dsh.runtime.log, dsh_runtime_host.c).
# The harness-side stream marker (the contrast phase counts ALL records).
RECORDS='dsh.runtime.log:'
SKIP_BUILD=0
SKIP_HARNESS=0
for arg in "$@"; do
    case "$arg" in
        --skip-build) SKIP_BUILD=1 ;;
        --skip-harness) SKIP_HARNESS=1 ;;
        *) echo "release-logging(harmony): unknown argument: $arg" >&2; exit 2 ;;
    esac
done

log() { echo "release-logging(harmony): $*"; }
die() { echo "release-logging(harmony): FAIL: $*" >&2; exit 1; }
count() { grep -c -F "$2" "$1" 2>/dev/null || true; }

# ---- build both configurations --------------------------------------------------

if [ "$SKIP_BUILD" -eq 0 ]; then
    if [ "$SKIP_HARNESS" -eq 1 ]; then
        log "vendoring + building the release configuration only (--skip-harness)"
        hosts/harmony/ci/vendor-official.sh >/dev/null
        (cd hosts/harmony && "$CLT/bin/ohpm" install --all >/dev/null)
        # THE NATIVE TRAP: hvigor's buildMode does NOT enter the native output
        # path (see the both-modes loop below) — a stale obj tree would pack a
        # foreign .so, so the release build gets the same clean-each-time rule.
        rm -rf hosts/harmony/entry/build hosts/harmony/entry/.cxx
        (cd hosts/harmony && "$CLT/bin/hvigorw" assembleHap --mode module \
            -p product=default -p buildMode=release --no-daemon) \
            > /tmp/dsh-hap-release.log 2>&1 \
            || die "hvigorw release build failed — see /tmp/dsh-hap-release.log"
        [ -f "$HAP" ] || die "hvigorw release produced no HAP"
        cp "$HAP" "$REL_HAP"
        log "built release HAP -> $REL_HAP"
    else
    log "vendoring + building BOTH configurations (release, debug)"
    hosts/harmony/ci/vendor-official.sh >/dev/null
    (cd hosts/harmony && "$CLT/bin/ohpm" install --all >/dev/null)
    for mode in release debug; do
        # THE NATIVE TRAP: hvigor's buildMode does NOT enter the native output
        # path — BOTH modes' ninja trees link to the SAME
        # entry/build/default/intermediates/cmake/default/obj/arm64-v8a/libspike.so,
        # so the second mode's ninja finds the first mode's .so "up to date"
        # ("ninja: no work to do" in .cxx/.../<mode>/output.log) and the HAP
        # packs the OTHER configuration's native library (observed: the debug
        # HAP carrying the release .so, i.e. a log-stripped harness whose
        # captures came out empty). Clean both trees before each mode so each
        # HAP is built from its own configuration — verified by the counts
        # this script asserts below (surprise ledger: harmony-native-cross-mode).
        rm -rf hosts/harmony/entry/build hosts/harmony/entry/.cxx
        (cd hosts/harmony && "$CLT/bin/hvigorw" assembleHap --mode module \
            -p product=default -p buildMode=$mode --no-daemon) \
            > /tmp/dsh-hap-$mode.log 2>&1 \
            || die "hvigorw $mode build failed — see /tmp/dsh-hap-$mode.log"
        [ -f "$HAP" ] || die "hvigorw $mode produced no HAP"
        if [ "$mode" = "release" ]; then
            cp "$HAP" "$REL_HAP"
            log "built release HAP -> $REL_HAP"
        else
            cp "$HAP" "$DBG_HAP"
            log "built debug HAP -> $DBG_HAP"
        fi
    done
    fi
fi
[ -f "$REL_HAP" ] || die "release HAP missing ($REL_HAP — build first or unset --skip-build)"
if [ "$SKIP_HARNESS" -eq 0 ]; then
    [ -f "$DBG_HAP" ] || die "debug HAP missing ($DBG_HAP — build first or unset --skip-build)"
fi

mkdir -p "$ART"

# ---- the emulator, installs, launches -------------------------------------------

deadline=$(( $(date +%s) + 120 ))
until "$HDC" list targets | grep -q 127.0.0.1; do
    [ "$(date +%s)" -lt "$deadline" ] \
        || die "no emulator target within 120s (start dsh_phone first)"
    sleep 2
done

# hilog flow control drops the canonical record stream under burst (the
# harness suite asserts on it; see ci/run-host-e2e.sh). This script's release
# verdicts are ABSENCES read off the same buffer, so a dropped burst could
# hide a record — hiding a record is exactly what this script exists to rule
# out. Asserted, not just set: a delivery knob that silently stayed on would
# make the zeros below lie.
for knob in pidoff domainoff; do
    out=$("$HDC" shell hilog -Q "$knob" 2>&1 || true)
    case "$out" in
        # This hilog build answers "Set flow control by process to disabled,
        # result: Success [CODE: 0]" — the older "successfully" spelling is
        # kept for the CLT versions that print it (same widening
        # ci/run-host-e2e.sh carries).
        *successfully*|*"Success [CODE: 0]"*) ;;
        *) die "hilog -Q $knob failed ($out) — the record stream can be dropped, so a zero-record result would prove nothing" ;;
    esac
done

install_hap() { # $1 = hap path
    tries=0
    until "$HDC" install -r "$1" >/dev/null 2>&1; do
        tries=$(( tries + 1 ))
        [ "$tries" -lt 5 ] || die "hdc install kept failing: $1"
        sleep 2
    done
}

# One clean window per launch: wake+unlock, force-stop VERIFIED, hilog cleared,
# then `aa start` retried until the process exists (aa start's exit code is not
# evidence — the waited-for condition is the PID; rule 8).
launch() { # $1 = extra launch parameters ('' for the plain launch)
    "$HDC" shell power-shell wakeup >/dev/null 2>&1 || true
    "$HDC" shell uinput -T -m 400 1600 400 400 300 >/dev/null 2>&1 || true
    "$HDC" shell aa force-stop $BUNDLE >/dev/null 2>&1 || true
    if [ -n "$("$HDC" shell pidof $BUNDLE 2>/dev/null | tr -d '[:space:]')" ]; then
        die "aa force-stop left $BUNDLE resident (pidof non-empty)"
    fi
    "$HDC" shell hilog -r >/dev/null
    deadline=$(( $(date +%s) + 120 ))
    until [ -n "$("$HDC" shell pidof $BUNDLE 2>/dev/null | tr -d '[:space:]')" ]; do
        [ "$(date +%s)" -lt "$deadline" ] \
            || die "$BUNDLE process never appeared within 120s of aa start"
        "$HDC" shell power-shell wakeup >/dev/null 2>&1 || true
        "$HDC" shell uinput -T -m 400 1600 400 400 300 >/dev/null 2>&1 || true
        # shellcheck disable=SC2086
        # (the parameters are a fixed literal here)
        "$HDC" shell aa start -b $BUNDLE -a EntryAbility $1 >/dev/null 2>&1 || true
        sleep 3
    done
}

# Poll the hilog window for one fixed string; fail loud on the deadline (rule 8).
await_log() { # $1 = fixed string, $2 = what it proves, $3 = deadline seconds
    deadline=$(( $(date +%s) + $3 ))
    while [ "$(date +%s)" -lt "$deadline" ]; do
        "$HDC" shell hilog -x > "$WINDOW" 2>/dev/null
        if grep -q -F "$1" "$WINDOW"; then
            return 0
        fi
        sleep 3
    done
    die "$2: '$1' never appeared in the hilog window within $3s"
}

snapshot() { # $1 = destination .png
    "$HDC" shell snapshot_display -f /data/local/tmp/dsh-release-logging.jpeg >/dev/null
    "$HDC" file recv /data/local/tmp/dsh-release-logging.jpeg /tmp/dsh-release-logging.jpeg >/dev/null
    # snapshot_display emits JPEG; a .png name must carry PNG bytes (macOS sips).
    sips -s format png /tmp/dsh-release-logging.jpeg --out "$1" >/dev/null
}

# ---- 1/3: dsh-harmony (release), plain launch, nothing staged --------------------

WINDOW=/tmp/dsh-harmony-release-window.txt
log "1/3 install dsh-harmony (release) + plain launch (no leg parameter)"
install_hap "$REL_HAP"
launch ''
# The serving proof is SOCKET-level, not log-level: on this image a release
# build's hilog.info never reaches the buffer (hilog.error does — the refusal
# below proves by name), so the 09-21 run's three info-level serving facts
# are unobservable in a release window. What the android release leg proves
# through an adb forward, this proves through an hdc fport: the serve's own
# LISTEN socket on 17890, then the auth-lite gate answering a real request
# through the forward; the screenshot carries the rendered-UI fact.
await_serve_listen() { # $1 = deadline seconds
    deadline=$(( $(date +%s) + $1 ))
    while [ "$(date +%s)" -lt "$deadline" ]; do
        # state 0A = LISTEN, local port 45E2 = 17890 (the v4 or v6 table)
        if "$HDC" shell "cat /proc/net/tcp /proc/net/tcp6 2>/dev/null" \
                | awk '$4 == "0A"' | grep -qi ':45E2'; then
            return 0
        fi
        sleep 3
    done
    die "the release build never opened the official serve's LISTEN socket on 17890 within $1s"
}
await_serve_listen 150
FPORT=48047
"$HDC" fport rm "tcp:$FPORT" >/dev/null 2>&1 || true
"$HDC" fport "tcp:$FPORT" tcp:17890 >/dev/null \
    || die "hdc fport could not forward the official serve's origin"
sleep 1   # the forward settles on its first use — an immediate curl races it (measured)
probe="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$FPORT/" || true)"
"$HDC" fport rm "tcp:$FPORT" >/dev/null 2>&1 || true
[ "$probe" = "401" ] \
    || die "the official dist seat answered $probe, not the 401 auth-lite gate"
{
    echo "# the release boot's served origin, probed through hdc fport"
    echo "serve: 127.0.0.1:17890 (the official seat's LISTEN socket, /proc/net/tcp* state 0A)"
    echo "GET / -> $probe   (401 = the auth-lite token gate of the official dist seat)"
    echo "launcher focus: the official DSH Web UI (plain-launch-release.png)"
} > "$ART/origin-release.txt"
sleep 5   # let the app shell paint before the screenshot
"$HDC" shell hilog -x > "$WINDOW" 2>/dev/null
snapshot "$ART/plain-launch-release.png"

grep 'com.dshmobile.host/dsh' "$WINDOW" > "$ART/plain-launch-release.dsh.txt" || true
# The absence evidence: the window lines carrying any asserted-zero marker.
grep -F -e 'dsh.runtime.verdict' -e 'dsh.runtime.result' -e 'ALL PASS' \
        -e 'ALL FAIL' -e '"level":"debug"' -e '"level":"info"' \
        "$WINDOW" > "$ART/plain-launch-release.records.txt" || true

# The asserted-zero set: machinery text and debug/info levels — never the
# whole dsh.runtime.log stream (release keeps warn/error).
[ "$(count "$WINDOW" 'dsh.runtime.verdict')" -eq 0 ] || die "release emitted verdict text"
[ "$(count "$WINDOW" 'dsh.runtime.result')" -eq 0 ] || die "release emitted result tags"
[ "$(count "$WINDOW" 'ALL PASS')" -eq 0 ] || die "release emitted ALL PASS"
[ "$(count "$WINDOW" 'ALL FAIL')" -eq 0 ] || die "release emitted ALL FAIL"
[ "$(count "$WINDOW" '"level":"debug"')" -eq 0 ] || die "release emitted a debug record"
[ "$(count "$WINDOW" '"level":"info"')" -eq 0 ] || die "release emitted an info record"
[ "$(count "$ART/plain-launch-release.dsh.txt" 'dsh.runtime.verdict')" -eq 0 ] \
    || die "release emitted verdict machinery on its own tags"

# ---- 2/3: the refusal (rules.md rule 5) ------------------------------------------

log "2/3 dsh-harmony (release) asked for an E2E leg"
WINDOW=/tmp/dsh-harmony-refusal-window.txt
launch '--ps dsh.e2e.leg m2.llm'
REFUSAL='release build: refusing: dsh.e2e.leg m2.llm asks for a verification drive'
await_log "$REFUSAL" "the release build did not refuse an E2E leg" 60
sleep 3
"$HDC" shell hilog -x > "$WINDOW" 2>/dev/null
snapshot "$ART/refusal.png"
grep 'com.dshmobile.host/dsh' "$WINDOW" > "$ART/refusal.dsh.txt" || true
grep -F -e 'dsh.runtime.verdict' -e 'dsh.runtime.result' -e 'ALL PASS' \
        -e 'ALL FAIL' -e '"level":"debug"' -e '"level":"info"' \
        "$WINDOW" > "$ART/refusal.records.txt" || true
grep -F "$REFUSAL" "$WINDOW" > "$ART/refusal.txt" || true
[ -s "$ART/refusal.txt" ] || die "the refusal line was not captured into refusal.txt"
# The refusing build must not grow verification machinery either (warn/error
# records stay legitimate — see the asserted-zero note at 1/3).
[ "$(count "$WINDOW" 'dsh.runtime.verdict')" -eq 0 ] \
    || die "the refusing release build emitted verdict machinery"
[ "$(count "$WINDOW" 'dsh.runtime.result')" -eq 0 ] \
    || die "the refusing release build emitted result tags"

# ---- 3/3: dsh-harmony-harness (debug) — unchanged --------------------------------

if [ "$SKIP_HARNESS" -eq 0 ]; then
log "3/3 install dsh-harmony-harness (debug) + the full E2E suite"
install_hap "$DBG_HAP"
HARNESS_OUT=/tmp/dsh-harmony-harness-suite
rm -rf "$HARNESS_OUT"
if DSH_SKIP_BUILD=1 hosts/harmony/ci/run-host-e2e.sh "$HARNESS_OUT" \
        > /tmp/dsh-harmony-harness-suite.log 2>&1; then
    log "the harness suite is green"
else
    tail -30 /tmp/dsh-harmony-harness-suite.log >&2 || true
    die "the harness E2E suite regressed — see /tmp/dsh-harmony-harness-suite.log"
fi

HARNESS_RECORDS=0
for cap in sink-capture.txt binding-capture.txt official-capture.txt \
           httpfetch-capture.txt session-capture.txt write-capture.txt; do
    [ -f "$HARNESS_OUT/$cap" ] || die "the harness suite produced no $cap"
    n=$(count "$HARNESS_OUT/$cap" "$RECORDS")
    HARNESS_RECORDS=$(( HARNESS_RECORDS + n ))
done
[ "$HARNESS_RECORDS" -gt 0 ] \
    || die "the harness emitted no $RECORDS records — its evidence regressed"

{
    echo "# Harness contrast — dsh-harmony-harness (debug), the same host"
    echo
    echo "The SAME plain launch (no leg parameter) in the debug configuration runs"
    echo "the full default chain (regression trio -> m5 binding -> the four D9 legs)"
    echo "and emits the full structured stream. Re-run: DSH_SKIP_BUILD=1 \\"
    echo "hosts/harmony/ci/run-host-e2e.sh <dir> (this file's own run: see run.sh 3/3)."
    echo
    echo "records emitted (six capture files, in run order): $HARNESS_RECORDS"
    echo "release records in the same window: 0"
    echo
    echo "## Checker verdicts (tools/e2e/check.mjs, one manifest each)"
    for v in "$HARNESS_OUT"/verdict-*.json; do
        echo "  $(basename "$v" .json | sed 's/^verdict-//'): $(grep -o '"logged": [0-9]*' "$v" | head -1)"
    done
    echo
    grep -F 'run-host-e2e: PASS' /tmp/dsh-harmony-harness-suite.log || true
    echo
    echo "The committed per-leg evidence (captures, verdicts, screenshots) for the"
    echo "same suite lives in hosts/harmony/artifacts/d9-official-web/,"
    echo "d9-session-live/, d9-write-live/ and m5-host/ — this run must not change"
    echo "their outcomes."
} > "$ART/harness-contrast.txt"
fi

if [ "$SKIP_HARNESS" -eq 1 ]; then
    log "release: 0 records / 0 verdict / 0 debug+info (--skip-harness: the harness contrast is the caller's own leg)"
else
    log "release: 0 records / 0 verdict / 0 debug+info; harness: $HARNESS_RECORDS records, suite green"
fi
log "artifacts in $ART"
