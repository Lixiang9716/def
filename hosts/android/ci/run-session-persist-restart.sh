#!/bin/sh
# hosts/android/ci/run-session-persist-restart.sh — the session-persistence
# RESTART leg on the emulator (scenario `android.session-persist.restart`):
# the gated spine boots with the vendored JSONL backend mounted, ONE scripted
# turn per process, and the RUNNER owns the process boundary —
#
#   launch 1 (create leg):  the configured session creates, the turn
#     journals it, the backend flush makes it durable (backend.stat non-
#     empty); the leg settles PASS and the seat's verdict lands.
#   force kill:             `am force-stop` + pidof-empty verification (the
#     create-card discipline — a silently-failed stop leaves the app
#     resident and the restart would be a same-process no-op).
#   launch 2 (resume leg):  the SAME extras relaunch the app over the SAME
#     container (pm clear/bm clean would wipe the journal — never between
#     the legs): the boot RESTORES the stored session, session/list carries
#     it, turn 2 continues the journal across the restart.
#
# Capture is the shared canary-pinned streamer (logcat-capture.sh) — ONE
# stream spanning both launches, so neither leg's records race a snapshot.
# Checker: test/e2e/scenarios/android-session-persist-restart.json, one-to-
# one in order. Evidence: hosts/android/artifacts/session-persist-restart/.
#
# usage: run-session-persist-restart.sh [--skip-build]   (env:
#        DSH_ANDROID_ART, DSH_ANDROID_SERIAL)
set -u
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
cd "$ROOT" || exit 1
PKG=com.dshmobile.host
OUT="${DSH_ANDROID_ART:-hosts/android/artifacts/session-persist-restart}"
SCEN=test/e2e/scenarios/android-session-persist-restart.json
CAPTURE=hosts/android/ci/logcat-capture.sh
APK=hosts/android/app/build/outputs/apk/debug/app-debug.apk
SERIAL="${DSH_ANDROID_SERIAL:-}"
SKIP_BUILD=0
[ "${1:-}" = "--skip-build" ] && SKIP_BUILD=1

say() { echo "run-session-persist-restart: $*"; }
die() { echo "run-session-persist-restart: FAIL: $*" >&2; exit 1; }
adbsh() { if [ -n "$SERIAL" ]; then adb -s "$SERIAL" "$@"; else adb "$@"; fi; }
shot() { adbsh shell screencap -p /sdcard/dsh-shot.png >/dev/null 2>&1 && adbsh pull /sdcard/dsh-shot.png "$OUT/screens/$1.png" >/dev/null 2>&1 || true; }

mkdir -p "$OUT/screens"

# ---- 0. Android SDK discovery ----------------------------------------------
# The fresh-worktree trap (measured 2026-10-11): hosts/android/local.properties
# is machine-local and untracked, CI exports ANDROID_HOME, so a bare checkout
# run locally has NEITHER and gradle dies with 'SDK location not found'.
# Derive it: adb on PATH → its sdk root; then the two standard install roots.
# A local.properties (sdk.dir) still wins — gradle reads it before the env.
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

# ---- 1. build ---------------------------------------------------------------
if [ "$SKIP_BUILD" = "0" ]; then
    say "1/6 assembleDebug (ANDROID_HOME=${ANDROID_HOME:-<local.properties>})"
    ( cd hosts/android && ./gradlew assembleDebug --console=plain -q >/dev/null ) \
        || die "gradle assembleDebug failed"
else
    say "1/6 build skipped"
fi
[ -f "$APK" ] || die "APK missing at $APK (build first)"

# ---- 2. boot + install ------------------------------------------------------
say "2/6 boot poll + install"
adbsh wait-for-device
boot_deadline=$(( $(date +%s) + 120 ))
until adbsh shell getprop sys.boot_completed 2>/dev/null | grep -q 1; do
    [ "$(date +%s)" -ge "$boot_deadline" ] && die "emulator did not finish booting within 120s"
    sleep 2
done
adbsh install -r "$APK" >/dev/null || die "adb install failed"

# ---- 3. setup: ONE clean container, then never between the legs -------------
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

# ---- 4. ONE canary stream across BOTH launches ------------------------------
say "4/6 canary capture (dsh.runtime + dsh.runtime.result, one stream)"
CANARY=$(CAPTURE_FILE="$OUT/logs.txt" sh "$CAPTURE" start dsh.runtime dsh.runtime.result) \
    || die "logcat capture failed to attach"
cleanup_capture() { CAPTURE_FILE="$OUT/logs.txt" sh "$CAPTURE" stop >/dev/null 2>&1 || true; }
trap 'cleanup_capture' EXIT INT TERM

launch() {
    launch_deadline=$(( $(date +%s) + 60 ))
    until adbsh shell am start -n $PKG/.MainActivity --ez dsh.persistrestart true >/dev/null 2>&1; do
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

# ---- 5. launch 1: the create leg, then THE KILL ------------------------------
say "5/6 launch 1 (create leg) — waiting for the durable-journal verdict"
launch
CAPTURE_FILE="$OUT/logs.txt" sh "$CAPTURE" wait -f "$OUT/logs.txt" "$CANARY" 300 \
    '"leg":"create"' 'dsh.runtime.result: ALL' \
    || die "create leg did not settle within 300s"
shot 01-create-settled
say "   create leg green — force-stopping the process (the restart under test)"
force_stop

# ---- 6. launch 2: the resume leg ---------------------------------------------
say "6/6 launch 2 (resume leg) — waiting for the cross-restart continuation"
launch
CAPTURE_FILE="$OUT/logs.txt" sh "$CAPTURE" wait -f "$OUT/logs.txt" "$CANARY" 300 \
    '"leg":"resume"' 'dsh.runtime.result: ALL' \
    || die "resume leg did not settle within 300s"
sleep 1
shot 02-resume-settled

cleanup_capture
trap - EXIT INT TERM

# ---- checkers ----------------------------------------------------------------
say "checkers"
# The canary view IS the evidence (everything from the canary line onward —
# both launches); the resume completion is the last scenario record in it.
# The view lands on a TEMP path first: redirecting straight onto the capture
# file would truncate it before awk reads a line (measured live — both legs
# green, checker saw zero records).
CAPTURE_FILE="$OUT/logs.txt" sh "$CAPTURE" view "$CANARY" > "$OUT/logs.view"
mv "$OUT/logs.view" "$OUT/logs.txt"
grep 'dsh.runtime.log:' "$OUT/logs.txt" > "$OUT/scenario.jsonl" || true
rm -f "$OUT/verdict-android-session-persist-restart.json"

FAIL=0
node test/e2e/check.mjs --manifest "$SCEN" \
    --log "$OUT/logs.txt" --out "$OUT/verdict-android-session-persist-restart.json" || FAIL=1
cat "$OUT/verdict-android-session-persist-restart.json"
[ "$FAIL" = "0" ] || die "checker red — evidence stays unreceipted"

UDID="$(adbsh get-serialno | tr -d '\r')"
TREE_LINE="origin/main $(git rev-parse --short=12 HEAD)$(git diff-index --quiet HEAD -- || echo ' (dirty working tree at receipt time)')"
cat > "$OUT/receipt.json" <<EOF
{
  "host": "android",
  "udid": "$UDID",
  "runner": "hosts/android/ci/run-session-persist-restart.sh",
  "phase": "session-persist.restart",
  "launch": "emulator, --ez dsh.persistrestart true x2 (create leg, am force-stop, resume leg on the same container)",
  "tree": "$TREE_LINE",
  "engine": "$(sed -n 's/^PIN=//p' runtime/dsh/vendor/ensure.sh)",
  "scenarios": [
    { "manifest": "android-session-persist-restart", "verdict": "verdict-android-session-persist-restart.json", "pass": true }
  ],
  "screens": ["screens/01-create-settled.png", "screens/02-resume-settled.png"],
  "producedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
say "receipt written — session-persist.restart green ($OUT)"
