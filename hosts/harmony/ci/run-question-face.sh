#!/bin/sh
# hosts/harmony/ci/run-question-face.sh — the native question face's E2E leg
# on the HarmonyOS emulator (scenario `question.face`, ONE launch via
# `--ps dsh.e2e.leg question.face` + the scripted-cancel seam
# `--ps dsh.script.question cancel`). The scenario boots the spine, parks a
# REAL ctx.userQuestions ask through the question bridge (render-intent
# posts question.request over the __dshBusPost seam), THIS host answers it
# through the NATIVE question dialog — the scripted cancel settles exactly
# the way the tapped 取消 would ~350 ms in — and the answer's bus delivery
# resolves the parked ask: the park-forever defect dies here, proven on the
# real waterfall. run-card-player.sh's machinery; the Android runner
# (hosts/android/ci/run-question-face.sh)'s sibling.
#
# Harmony event order differs from iOS/Android: NO client.selected precedes
# the scenario (no web client mounts — the question-face-harmony manifest
# pins the scenario's own records alone).
#
# usage: run-question-face.sh   (env: DSH_CLT overrides the toolchain root,
#        DSH_SKIP_BUILD=1 skips the hvigor build)
set -eu
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
cd "$ROOT"
CLT=${DSH_CLT:-/opt/homebrew/share/harmonyos-commandlinetools/command-line-tools}
HDC="$CLT/sdk/default/openharmony/toolchains/hdc"
[ -x "$HDC" ] || HDC=$(find "$CLT" -name hdc -type f | head -1)
HAP=hosts/harmony/entry/build/default/outputs/default/entry-default-unsigned.hap
BUNDLE=com.dshmobile.host
BASE=/data/app/el2/100/base/$BUNDLE/haps/entry/cache
OUT=hosts/harmony/artifacts/question-face
mkdir -p "$OUT/screens"

say() { echo "run-question-face: $*"; }

if [ "${DSH_SKIP_BUILD:-0}" != "1" ]; then
    say "building the HAP"
    (cd hosts/harmony && "$CLT/bin/hvigorw" assembleHap --mode module \
        -p product=default -p buildMode=debug --no-daemon > /tmp/dsh-qf-build.log 2>&1) \
        || { echo "::error::hvigorw build failed — see /tmp/dsh-qf-build.log"; exit 1; }
fi
[ -f "$HAP" ] || { echo "::error::$HAP missing — build first" >&2; exit 1; }

# Device presence (the emulator is started separately: `Emulator -start dsh_phone`).
TARGET=""
deadline=$(( $(date +%s) + 120 ))
until [ -n "$TARGET" ]; do
    TARGET=$("$HDC" list targets | grep 127.0.0.1 | head -1 | tr -d '[:space:]' || true)
    [ "$(date +%s)" -ge "$deadline" ] && { echo "::error::no emulator target within 120s" >&2; exit 1; }
    [ -n "$TARGET" ] || sleep 2
done
say "target $TARGET"

"$HDC" -t "$TARGET" install -r "$HAP" >/dev/null 2>&1 \
    || { echo "::error::hdc install failed" >&2; exit 1; }

# Wake + unlock + verified relaunch (run-card-player.sh's discipline).
"$HDC" -t "$TARGET" shell power-shell wakeup >/dev/null 2>&1 || true
"$HDC" -t "$TARGET" shell uinput -T -m 400 1600 400 400 300 >/dev/null 2>&1 || true
"$HDC" -t "$TARGET" shell aa force-stop $BUNDLE >/dev/null 2>&1 || true
if [ -n "$("$HDC" -t "$TARGET" shell pidof $BUNDLE 2>/dev/null | tr -d '[:space:]')" ]; then
    echo "::error::aa force-stop left $BUNDLE resident" >&2
    exit 1
fi
"$HDC" -t "$TARGET" shell hilog -r >/dev/null
for knob in pidoff domainoff; do
    "$HDC" -t "$TARGET" shell hilog -Q "$knob" >/dev/null 2>&1 \
        || echo "::warning::hilog -Q $knob failed — the record stream may drop" >&2
done

STREAM=/tmp/dsh-qf-hilog.txt
: > "$STREAM"
"$HDC" -t "$TARGET" shell hilog > "$STREAM" 2>/dev/null &
streamer=$!
trap 'kill "$streamer" 2>/dev/null || true' EXIT

# The streamer must be ATTACHED before aa start (the scenario reaches its
# first markers within ~1s): hilog -r cleared the buffer, so any line in the
# stream proves live attachment (rule 8: polled condition).
attach_deadline=$(( $(date +%s) + 60 ))
until [ -s "$STREAM" ]; do
    [ "$(date +%s)" -ge "$attach_deadline" ] && { echo "::error::hilog streamer never attached" >&2; exit 1; }
    sleep 0.2
done

shot() { # snapshot the face, pull it, keep PNG magic for the matrix gate
    "$HDC" -t "$TARGET" shell snapshot_display -f /data/local/tmp/dsh-qf-shot.jpeg >/dev/null 2>&1 || true
    "$HDC" -t "$TARGET" file recv /data/local/tmp/dsh-qf-shot.jpeg "/tmp/dsh-qf-shot.jpeg" >/dev/null 2>&1 || true
    sips -s format png /tmp/dsh-qf-shot.jpeg --out "$OUT/screens/$1.png" >/dev/null 2>&1 || true
    rm -f /tmp/dsh-qf-shot.jpeg
}

deadline=$(( $(date +%s) + 120 ))
until [ -n "$("$HDC" -t "$TARGET" shell pidof $BUNDLE 2>/dev/null | tr -d '[:space:]')" ]; do
    [ "$(date +%s)" -ge "$deadline" ] && { echo "::error::$BUNDLE never appeared" >&2; exit 1; }
    "$HDC" -t "$TARGET" shell power-shell wakeup >/dev/null 2>&1 || true
    "$HDC" -t "$TARGET" shell uinput -T -m 400 1600 400 400 300 >/dev/null 2>&1 || true
    # shellcheck disable=SC2086 # intentional word split, two want params
    "$HDC" -t "$TARGET" shell aa start -b $BUNDLE -a EntryAbility \
        --ps dsh.e2e.leg question.face --ps dsh.script.question cancel >/dev/null 2>&1 || true
    sleep 3
done
say "launched (dsh.e2e.leg question.face + dsh.script.question cancel), watching the ask's bus lines"

# ---- drive: screenshot the dialog while it presents (best effort — the
# scripted cancel fires ~350 ms after the dialog opens, so the shot races
# the cancel; the face-side proof is honest either way, the logs judge) ---
saw_ask=0
deadline=$(( $(date +%s) + 240 ))
while :; do
    if grep -q "question.face.*scenario.complete\|scenario.failed" "$STREAM"; then
        break
    fi
    if [ "$(date +%s)" -ge "$deadline" ]; then
        grep "dsh\." "$STREAM" | tail -40 >&2 || true
        echo "::error::question.face scenario did not complete within 240s" >&2
        exit 1
    fi
    asks=$(grep -c "ui-wait question" "$STREAM" || true)
    if [ "$asks" -gt "$saw_ask" ]; then
        saw_ask=$asks
        [ -f "$OUT/screens/01-question-dialog.png" ] || shot 01-question-dialog
    fi
    sleep 1
done
sleep 1
shot 02-final

kill "$streamer" 2>/dev/null || true
wait "$streamer" 2>/dev/null || true
trap - EXIT

# ---- capture pull + checkers (the capture file is the checker's input,
#      not the hilog stream — run-card-player.sh's discipline) ---------------
"$HDC" -t "$TARGET" file recv "$BASE/dsh-question-face-capture.log" \
    "$OUT/question-face-capture.txt" >/dev/null \
    || { echo "::error::capture pull failed — $BASE/dsh-question-face-capture.log" >&2; exit 1; }
grep -h '^dsh.runtime.log:' "$OUT/question-face-capture.txt" > "$OUT/scenario.jsonl" || true

FAIL=0
node test/e2e/check.mjs --manifest test/e2e/scenarios/question-face-harmony.json \
    --log "$OUT/question-face-capture.txt" \
    --out "$OUT/verdict-question-face-harmony.json" || FAIL=1
if [ "$FAIL" != "0" ]; then
    echo "::error::question-face-harmony checker failed" >&2
    exit 1
fi

TREE_LINE="origin/main $(git rev-parse --short=12 HEAD)$(git diff-index --quiet HEAD -- || echo ' (dirty working tree at receipt time)')"
cat > "$OUT/receipt.json" <<EOF
{
  "host": "harmony",
  "udid": "$TARGET (dsh_phone emulator)",
  "runner": "hosts/harmony/ci/run-question-face.sh",
  "phase": "question.face",
  "launch": "dsh_phone emulator, --ps dsh.e2e.leg question.face --ps dsh.script.question cancel (Debug)",
  "tree": "$TREE_LINE",
  "engine": "$(sed -n 's/^PIN=//p' external/ensure.sh)",
  "scenarios": [
    { "manifest": "question-face-harmony", "verdict": "verdict-question-face-harmony.json", "pass": true }
  ],
  "screens": ["screens/01-question-dialog.png", "screens/02-final.png"],
  "producedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
say "PASS — question.face green ($OUT)"
