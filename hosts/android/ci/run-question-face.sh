#!/bin/sh
# hosts/android/ci/run-question-face.sh — the face.question@1 E2E evidence
# leg on the emulator (scenario `question.face`, the iOS
# run-ios-question-face.sh sibling, R3 batch 2): a REAL
# ctx.userQuestions.ask() parks through the question bridge and posts the
# face through the dispatch layer, the NATIVE dialog renders it (options as
# button rows, answers by option id), and the scripted-question seam
# (--es dsh.script.question cancel — QuestionDialog.scriptCancelIfAsked,
# the approval seam's shape) settles it the way the tapped 取消 would. The
# cancel delivers `question.answer {outcome:"cancelled"}`, the parked turn
# SETTLES (the park-forever defect dies), and the manifest pins the whole
# chain against the captured log one-to-one. Evidence lands under
# hosts/android/artifacts/question-face/.
#
# usage: run-question-face.sh [--skip-build]   (env: DSH_ANDROID_ART,
#        DSH_ANDROID_SERIAL)
set -u
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
cd "$ROOT" || exit 1
PKG=com.dshmobile.host
OUT="${DSH_ANDROID_ART:-hosts/android/artifacts/question-face}"
SCEN=test/e2e/scenarios
APK=hosts/android/app/build/outputs/apk/debug/app-debug.apk
SERIAL="${DSH_ANDROID_SERIAL:-}"
SKIP_BUILD=0
[ "${1:-}" = "--skip-build" ] && SKIP_BUILD=1

say() { echo "run-question-face: $*"; }
die() { echo "run-question-face: FAIL: $*" >&2; exit 1; }
shot() { adbsh shell screencap -p /sdcard/dsh-shot.png >/dev/null 2>&1 && adbsh pull /sdcard/dsh-shot.png "$OUT/screens/$1.png" >/dev/null 2>&1 || true; }
adbsh() { if [ -n "$SERIAL" ]; then adb -s "$SERIAL" "$@"; else adb "$@"; fi; }

mkdir -p "$OUT/screens"

# ---- 1. build ---------------------------------------------------------------
if [ "$SKIP_BUILD" = "0" ]; then
    say "1/5 assembleDebug"
    ( cd hosts/android && ./gradlew assembleDebug --console=plain -q >/dev/null ) \
        || die "gradle assembleDebug failed"
else
    say "1/5 build skipped"
fi
[ -f "$APK" ] || die "APK missing at $APK (build first)"

# ---- 2. boot + install ------------------------------------------------------
say "2/5 boot poll + install"
adbsh wait-for-device
boot_deadline=$(( $(date +%s) + 120 ))
until adbsh shell getprop sys.boot_completed 2>/dev/null | grep -q 1; do
    [ "$(date +%s)" -ge "$boot_deadline" ] && die "emulator did not finish booting within 120s"
    sleep 2
done
adbsh install -r "$APK" >/dev/null || die "adb install failed"

# ---- 3. launch (force-stop first: singleTask delivery to a resident
#         instance re-runs nothing — the device-plane leg's measured trap) --
say "3/5 launch (--ez dsh.questionface true --es dsh.script.question cancel)"
adbsh shell am force-stop $PKG >/dev/null 2>&1 || true
stop_deadline=$(( $(date +%s) + 30 ))
while [ -n "$(adbsh shell pidof $PKG 2>/dev/null | tr -d '[:space:]')" ]; do
    [ "$(date +%s)" -ge "$stop_deadline" ] && die "force-stop left $PKG resident"
    adbsh shell am force-stop $PKG >/dev/null 2>&1 || true
    sleep 1
done
adbsh logcat -c
launch_deadline=$(( $(date +%s) + 60 ))
until adbsh shell am start -n $PKG/.MainActivity --ez dsh.questionface true \
        --es dsh.script.question cancel >/dev/null 2>&1; do
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
snapshot() { adbsh logcat -d -s dsh.runtime dsh.runtime.result dsh.runtime.ui dsh.snapshot dsh.serve dsh.question > "$DUMP" 2>/dev/null; }

# The dialog's brief native life is worth one artifact shot: the present of
# the ask and the final verdict screen (screenshots are artifacts, never
# assertions — the judgment is the log).
asked=0
deadline=$(( $(date +%s) + 240 ))
until snapshot && grep -q "question.face.*scenario.complete\|scenario.failed" "$DUMP"; do
    [ "$(date +%s)" -ge "$deadline" ] && {
        tail -60 "$DUMP"
        die "question.face scenario did not complete within 240s"
    }
    asks=$(grep -c "question.face.asked" "$DUMP")
    if [ "$asks" -gt "$asked" ]; then
        asked=$asks
        sleep 1
        shot 01-question-presented
    fi
    sleep 1
done
sleep 1

# ---- 5. checkers -------------------------------------------------------------
say "5/5 checkers"
cp "$DUMP" "$OUT/logs.txt"
grep 'dsh.runtime.log:' "$OUT/logs.txt" > "$OUT/scenario.jsonl" || true
shot 02-final

FAIL=0
node test/e2e/check.mjs --manifest $SCEN/question-face-android.json \
    --log "$OUT/logs.txt" --out "$OUT/verdict-question-face.json" || FAIL=1
cat "$OUT/verdict-question-face.json"
[ "$FAIL" = "0" ] || die "checkers red — evidence stays unreceipted"

UDID="$(adbsh get-serialno | tr -d '\r')"
TREE_LINE="origin/main $(git rev-parse --short=12 HEAD)$(git diff-index --quiet HEAD -- || echo ' (dirty working tree at receipt time)')"
cat > "$OUT/receipt.json" <<EOF
{
  "host": "android",
  "udid": "$UDID",
  "runner": "hosts/android/ci/run-question-face.sh",
  "phase": "question.face",
  "launch": "emulator, --ez dsh.questionface true + --es dsh.script.question cancel (Debug)",
  "tree": "$TREE_LINE",
  "engine": "$(sed -n 's/^PIN=//p' external/ensure.sh)",
  "scenarios": [
    { "manifest": "question-face", "verdict": "verdict-question-face.json", "pass": true }
  ],
  "screens": ["screens/01-question-presented.png", "screens/02-final.png"],
  "producedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
say "receipt written — question.face green, cancel settles the parked ask ($OUT)"
