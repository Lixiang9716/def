#!/bin/sh
# hosts/android/ci/run-session-persist-midturn.sh — the MID-TURN KILL leg on
# the device/emulator seat (scenario `android.session-persist.midturn`; the
# restart family's third boundary, D-g posture: implemented, receipt-ready,
# awaiting hardware — with no device attached this fails LOUD naming it, it
# never fakes evidence). The gated spine boots with the vendored JSONL
# backend mounted, and the RUNNER owns the kill boundary:
#
#   launch 1 (kill leg):  the configured session creates, the turn starts on
#     the carrier's SLOW_TURN drip (~220ms/slice), the leg emits
#     midturn/first.delta at the FIRST content delta and then materializes
#     the journal mid-stream (backend.flush + stat non-empty →
#     midturn/durable). The runner waits for THAT marker and force-stops
#     INTO the open stream — the turn never completes in launch 1.
#   launch 2 (resume leg): the SAME extras over the SAME container (pm
#     clear/bm clean would wipe the journal — never between the legs): the
#     vendored agent-loop's resume path appends the interrupted-turn closers
#     (synthesized step/end + turn/end reason "interrupted") so the restored
#     journal ends at a REAL boundary, then the recovery turn continues it
#     (turn 2, turnBoundary.lastTurn == 2) and the seat's verdict lands.
#
# Capture is the shared canary-pinned streamer (logcat-capture.sh) — ONE
# stream spanning both launches. Checker:
# test/e2e/scenarios/android-session-persist-midturn.json, one-to-one in
# order. Evidence: hosts/android/artifacts/session-persist-midturn/.
#
# usage: run-session-persist-midturn.sh [--skip-build]   (env:
#        DSH_ANDROID_ART, DSH_ANDROID_SERIAL)
set -u
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
cd "$ROOT" || exit 1
PKG=com.dshmobile.host
OUT="${DSH_ANDROID_ART:-hosts/android/artifacts/session-persist-midturn}"
SCEN=test/e2e/scenarios/android-session-persist-midturn.json
CAPTURE=hosts/android/ci/logcat-capture.sh
APK=hosts/android/app/build/outputs/apk/debug/app-debug.apk
SERIAL="${DSH_ANDROID_SERIAL:-}"
SKIP_BUILD=0
[ "${1:-}" = "--skip-build" ] && SKIP_BUILD=1

say() { echo "run-session-persist-midturn: $*"; }
die() { echo "run-session-persist-midturn: FAIL: $*" >&2; exit 1; }
adbsh() { if [ -n "$SERIAL" ]; then adb -s "$SERIAL" "$@"; else adb "$@"; fi; }
shot() { adbsh shell screencap -p /sdcard/dsh-shot.png >/dev/null 2>&1 && adbsh pull /sdcard/dsh-shot.png "$OUT/screens/$1.png" >/dev/null 2>&1 || true; }

mkdir -p "$OUT/screens"

# ---- 0. device presence (the receipt-ready boundary: fail loud) -------------
ATTACHED="$(adbsh devices | awk 'NR>1 && $2=="device" && $1 != "" {print $1; exit}')"
[ -n "$ATTACHED" ] || die "no android device/emulator attached (adb devices) — the mid-turn kill leg is a REAL-process boundary leg: implemented, receipt-ready, awaiting hardware (the CLI simulation half: runtime/dsh/ci/run-session-persist-midturn-e2e.sh, green without hardware)"

# ---- 1. Android SDK discovery ------------------------------------------------
# The fresh-worktree trap (measured 2026-10-11): hosts/android/local.properties
# is machine-local and untracked, CI exports ANDROID_HOME, so a bare checkout
# run locally has NEITHER and gradle dies with 'SDK location not found'.
if [ -z "${ANDROID_HOME:-}" ] && [ ! -f hosts/android/local.properties ]; then
    if command -v adb >/dev/null 2>&1; then
        ANDROID_HOME=$(cd "$(dirname "$(command -v adb)")/.." && pwd)
    elif [ -d "$HOME/Library/Android/sdk" ]; then
        ANDROID_HOME="$HOME/Library/Android/sdk"
    elif [ -d /opt/homebrew/share/android-commandlinetools ]; then
        ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
    fi
    [ -n "${ANDROID_HOME:-}" ] && export ANDROID_HOME
fi
[ -n "${ANDROID_HOME:-}" ] || [ -f hosts/android/local.properties ] \
    || die "no Android SDK found — set ANDROID_HOME (probed: adb on PATH, ~/Library/Android/sdk, /opt/homebrew/share/android-commandlinetools) or write hosts/android/local.properties"

# ---- 2. build + boot + install -----------------------------------------------
if [ "$SKIP_BUILD" = "0" ]; then
    say "1/6 assembleDebug (ANDROID_HOME=${ANDROID_HOME:-<local.properties>})"
    ( cd hosts/android && ./gradlew assembleDebug --console=plain -q >/dev/null ) \
        || die "gradle assembleDebug failed"
else
    say "1/6 build skipped"
fi
[ -f "$APK" ] || die "APK missing at $APK (build first)"

say "2/6 boot poll + install ($ATTACHED)"
adbsh wait-for-device
boot_deadline=$(( $(date +%s) + 120 ))
until adbsh shell getprop sys.boot_completed 2>/dev/null | grep -q 1; do
    [ "$(date +%s)" -ge "$boot_deadline" ] && die "emulator did not finish booting within 120s"
    sleep 2
done
adbsh install -r "$APK" >/dev/null || die "adb install failed"

# ---- 3. setup: ONE clean container, then never between the legs --------------
say "3/6 setup (pm clear + timezone; the journal must survive everything after this)"
adbsh shell pm clear $PKG >/dev/null 2>&1 || true
adbsh shell setprop persist.sys.timezone Asia/Shanghai >/dev/null 2>&1 || true
adbsh shell am force-stop $PKG >/dev/null 2>&1 || true
stop_deadline=$(( $(date +%s) + 30 ))
while [ -n "$(adbsh shell pidof $PKG 2>/dev/null | tr -d '[:space:]')" ]; do
    [ "$(date +%s)" -ge "$stop_deadline" ] && die "force-stop left $PKG resident"
    adbsh shell am force-stop $PKG >/dev/null 2>&1 || true
    sleep 1
done

# ---- 4. ONE canary stream across BOTH launches --------------------------------
say "4/6 canary capture (dsh.runtime + dsh.runtime.result, one stream)"
CANARY=$(CAPTURE_FILE="$OUT/logs.txt" sh "$CAPTURE" start dsh.runtime dsh.runtime.result) \
    || die "logcat capture failed to attach"
cleanup_capture() { CAPTURE_FILE="$OUT/logs.txt" sh "$CAPTURE" stop >/dev/null 2>&1 || true; }
trap 'cleanup_capture' EXIT INT TERM

launch() {
    launch_deadline=$(( $(date +%s) + 60 ))
    until adbsh shell am start -n $PKG/.MainActivity --ez dsh.persistmidturn true >/dev/null 2>&1; do
        [ "$(date +%s)" -ge "$launch_deadline" ] && die "am start kept failing within 60s"
        sleep 2
    done
}

force_stop() {
    adbsh shell am force-stop $PKG >/dev/null 2>&1 || true
    stop_deadline=$(( $(date +%s) + 30 ))
    while [ -n "$(adbsh shell pidof $PKG 2>/dev/null | tr -d '[:space:]')" ]; do
        [ "$(date +%s)" -ge "$stop_deadline" ] && die "force-stop left $PKG resident"
        adbsh shell am force-stop $PKG >/dev/null 2>&1 || true
        sleep 1
    done
}

# ---- 5. launch 1: the kill leg — kill INTO the open stream --------------------
say "5/6 launch 1 (kill leg) — waiting for the mid-stream durable marker"
launch
CAPTURE_FILE="$OUT/logs.txt" sh "$CAPTURE" wait -f "$OUT/logs.txt" "$CANARY" 300 \
    'midturn/durable' \
    || die "the kill leg never reached midturn/durable within 300s"
shot 01-midturn-durable
say "   durable marker green — force-stopping INTO the open stream (the kill under test)"
force_stop

# ---- 6. launch 2: the recovery leg --------------------------------------------
say "6/6 launch 2 (resume leg) — waiting for the interrupted-turn recovery"
launch
CAPTURE_FILE="$OUT/logs.txt" sh "$CAPTURE" wait -f "$OUT/logs.txt" "$CANARY" 300 \
    '"leg":"resume"' 'dsh.runtime.result: ALL' \
    || die "resume leg did not settle within 300s"
sleep 1
shot 02-resume-settled

cleanup_capture
trap - EXIT INT TERM

# ---- checkers ------------------------------------------------------------------
say "checkers"
# The canary view IS the evidence (everything from the canary line onward —
# both launches). Temp path first: redirecting straight onto the capture file
# would truncate it before awk reads a line (the restart sibling's lesson).
CAPTURE_FILE="$OUT/logs.txt" sh "$CAPTURE" view "$CANARY" > "$OUT/logs.view"
mv "$OUT/logs.view" "$OUT/logs.txt"
grep 'dsh.runtime.log:' "$OUT/logs.txt" > "$OUT/scenario.jsonl" || true
rm -f "$OUT/verdict-android-session-persist-midturn.json"

FAIL=0
node test/e2e/check.mjs --manifest "$SCEN" \
    --log "$OUT/logs.txt" --out "$OUT/verdict-android-session-persist-midturn.json" || FAIL=1
cat "$OUT/verdict-android-session-persist-midturn.json"
[ "$FAIL" = "0" ] || die "checker red — evidence stays unreceipted"

UDID="$(adbsh get-serialno | tr -d '\r')"
TREE_LINE="origin/main $(git rev-parse --short=12 HEAD)$(git diff-index --quiet HEAD -- || echo ' (dirty working tree at receipt time)')"
cat > "$OUT/receipt.json" <<EOF
{
  "host": "android",
  "udid": "$UDID",
  "runner": "hosts/android/ci/run-session-persist-midturn.sh",
  "phase": "session-persist.midturn",
  "launch": "emulator/device, --ez dsh.persistmidturn true x2 (kill leg parked at midturn/durable, am force-stop INTO the open SLOW_TURN stream, recovery leg on the same container)",
  "tree": "$TREE_LINE",
  "engine": "$(sed -n 's/^PIN=//p' external/ensure.sh)",
  "scenarios": [
    { "manifest": "android-session-persist-midturn", "verdict": "verdict-android-session-persist-midturn.json", "pass": true }
  ],
  "screens": ["screens/01-midturn-durable.png", "screens/02-resume-settled.png"],
  "producedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
say "receipt written — session-persist.midturn green ($OUT)"
