#!/bin/sh
# hosts/android/ci/run-create-card.sh — the create-approve-hotmount chain's
# E2E leg on the emulator (scenario `create.card`, the gaps3/android-01
# spine seat): the scenario boots the FULL upstream spine, plugin_create's
# execute writes the workspace package, the scripted-approval seam answers
# the NATIVE dialog, the dsh.plugins/1 registry row lands, and the authored
# plugin LIVE-mounts into that spine — its own apply() posts the card.* bus
# lines the native CardSurface renders. The screenshot catches the presented
# face (the plugin's own countdown), the checker pins the whole chain
# (test/e2e/scenarios/create-card.json). Evidence lands under
# hosts/android/artifacts/create-card/.
#
# usage: run-create-card.sh [--skip-build]   (env: DSH_ANDROID_ART,
#        DSH_ANDROID_SERIAL)
set -u
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
cd "$ROOT" || exit 1
PKG=com.dshmobile.host
OUT="${DSH_ANDROID_ART:-hosts/android/artifacts/create-card}"
SCEN=test/e2e/scenarios
APK=hosts/android/app/build/outputs/apk/debug/app-debug.apk
SERIAL="${DSH_ANDROID_SERIAL:-}"
SKIP_BUILD=0
[ "${1:-}" = "--skip-build" ] && SKIP_BUILD=1

say() { echo "run-create-card: $*"; }
die() { echo "run-create-card: FAIL: $*" >&2; exit 1; }
shot() { adbsh shell screencap -p /sdcard/dsh-shot.png >/dev/null 2>&1 && adbsh pull /sdcard/dsh-shot.png "$OUT/screens/$1.png" >/dev/null 2>&1 || true; }
adbsh() { if [ -n "$SERIAL" ]; then adb -s "$SERIAL" "$@"; else adb "$@"; fi; }

mkdir -p "$OUT/screens"

# ---- 1. build ---------------------------------------------------------------
if [ "$SKIP_BUILD" = "0" ]; then
    say "1/6 assembleDebug"
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

# ---- 3. launch (force-stop first: singleTask delivery to a resident
#         instance re-runs nothing — the device-plane leg's measured trap) --
# pm clear first: the leg proves the FIRST-RUN chain (fresh workspace →
# approval → registry row), and the gateway fs scope persists on disk — a
# previous run's enabled plugins/pomodoro-create row makes the next boot
# live-mount it (mountBootRows) and the drive's own mount refuse ("already
# mounted"). The workspace the drive writes must start empty, every run.
say "3/6 launch (--ez dsh.createcard true --es dsh.script.approval approve)"
adbsh shell pm clear $PKG >/dev/null 2>&1 || true
adbsh shell am force-stop $PKG >/dev/null 2>&1 || true
stop_deadline=$(( $(date +%s) + 30 ))
while [ -n "$(adbsh shell pidof $PKG 2>/dev/null | tr -d '[:space:]')" ]; do
    [ "$(date +%s)" -ge "$stop_deadline" ] && die "force-stop left $PKG resident"
    adbsh shell am force-stop $PKG >/dev/null 2>&1 || true
    sleep 1
done
adbsh logcat -c
launch_deadline=$(( $(date +%s) + 60 ))
until adbsh shell am start -n $PKG/.MainActivity --ez dsh.createcard true \
        --es dsh.script.approval approve >/dev/null 2>&1; do
    [ "$(date +%s)" -ge "$launch_deadline" ] && die "am start kept failing within 60s"
    sleep 2
done
rec_deadline=$(( $(date +%s) + 60 ))
until adbsh logcat -d -s dsh.runtime 2>/dev/null | grep -q "dsh.runtime.log"; do
    [ "$(date +%s)" -ge "$rec_deadline" ] && die "no dsh.runtime records within 60s of am start"
    sleep 1
done

# ---- 4. drive ----------------------------------------------------------------
DUMP="$OUT/.dp-dump.txt"
: > "$DUMP"
snapshot() { adbsh logcat -d -s dsh.runtime dsh.runtime.result dsh.runtime.ui > "$DUMP" 2>/dev/null; }

saw_present=0
saw_complete=0
deadline=$(( $(date +%s) + 240 ))
until snapshot && grep -q "create.card.*scenario.complete\|create.card.*scenario.failed" "$DUMP"; do
    if [ "$(date +%s)" -ge "$deadline" ]; then
        tail -60 "$DUMP"
        die "create.card scenario did not complete within 240s"
    fi
    presents=$(grep -c "card.face.presented" "$DUMP")
    if [ "$presents" -gt "$saw_present" ]; then
        saw_present=$presents
        sleep 1
        [ -f "$OUT/screens/01-card-present.png" ] || shot 01-card-present
    fi
    completes=$(grep -c "card.face.completed" "$DUMP")
    if [ "$completes" -gt "$saw_complete" ]; then
        saw_complete=$completes
        sleep 1
        [ -f "$OUT/screens/02-card-complete.png" ] || shot 02-card-complete
    fi
    sleep 1
done
sleep 1
shot 03-final

# ---- 5. checkers -------------------------------------------------------------
say "5/5 checkers"
cp "$DUMP" "$OUT/logs.txt"
grep 'dsh.runtime.log:' "$OUT/logs.txt" > "$OUT/scenario.jsonl" || true

FAIL=0
node test/e2e/check.mjs --manifest $SCEN/create-card.json \
    --log "$OUT/logs.txt" --out "$OUT/verdict-create-card.json" || FAIL=1
cat "$OUT/verdict-create-card.json"
[ "$FAIL" = "0" ] || die "checkers red — evidence stays unreceipted"

UDID="$(adbsh get-serialno | tr -d '\r')"
TREE_LINE="origin/main $(git rev-parse --short=12 HEAD)$(git diff-index --quiet HEAD -- || echo ' (dirty working tree at receipt time)')"
cat > "$OUT/receipt.json" <<EOF
{
  "host": "android",
  "udid": "$UDID",
  "runner": "hosts/android/ci/run-create-card.sh",
  "phase": "create.card",
  "launch": "emulator, --ez dsh.createcard true + --es dsh.script.approval approve (Debug)",
  "tree": "$TREE_LINE",
  "engine": "$(sed -n 's/^PIN=//p' external/ensure.sh)",
  "scenarios": [
    { "manifest": "create-card", "verdict": "verdict-create-card.json", "pass": true }
  ],
  "screens": ["screens/01-card-present.png", "screens/02-card-complete.png", "screens/03-final.png"],
  "producedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
say "receipt written — create.card green ($OUT)"
