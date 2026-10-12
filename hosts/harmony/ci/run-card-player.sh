#!/bin/sh
# hosts/harmony/ci/run-card-player.sh — the native card face's E2E leg on the
# HarmonyOS emulator (scenario `card.player`, ONE launch via
# `--ps dsh.e2e.leg card.player`). The scenario negotiates gateway@1, posts
# card.present + five card.state ticks + card.complete over the
# __dshBusPost seam (the ticks ride the gateway timer seam's one-shot re-arm
# loop), THIS host routes them through CardFace and renders the PiP face in
# the app's own chrome — screenshots are the face-side proof the log alone
# cannot give. run-mic-plane.sh's machinery; the Android runner
# (hosts/android/ci/run-card-player.sh)'s sibling.
#
# Harmony event order differs from iOS: NO client.selected precedes the
# scenario (no web client mounts — the card-player-harmony manifest pins the
# scenario's own records alone).
#
# usage: run-card-player.sh   (env: DSH_CLT overrides the toolchain root,
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
OUT=hosts/harmony/artifacts/card-player
mkdir -p "$OUT/screens"

say() { echo "run-card-player: $*"; }

if [ "${DSH_SKIP_BUILD:-0}" != "1" ]; then
    say "building the HAP"
    (cd hosts/harmony && "$CLT/bin/hvigorw" assembleHap --mode module \
        -p product=default -p buildMode=debug --no-daemon > /tmp/dsh-cp-build.log 2>&1) \
        || { echo "::error::hvigorw build failed — see /tmp/dsh-cp-build.log"; exit 1; }
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

# Wake + unlock + verified relaunch (run-mic-plane.sh's discipline).
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

STREAM=/tmp/dsh-cp-hilog.txt
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
    "$HDC" -t "$TARGET" shell snapshot_display -f /data/local/tmp/dsh-cp-shot.jpeg >/dev/null 2>&1 || true
    "$HDC" -t "$TARGET" file recv /data/local/tmp/dsh-cp-shot.jpeg "/tmp/dsh-cp-shot.jpeg" >/dev/null 2>&1 || true
    sips -s format png /tmp/dsh-cp-shot.jpeg --out "$OUT/screens/$1.png" >/dev/null 2>&1 || true
    rm -f /tmp/dsh-cp-shot.jpeg
}

deadline=$(( $(date +%s) + 120 ))
until [ -n "$("$HDC" -t "$TARGET" shell pidof $BUNDLE 2>/dev/null | tr -d '[:space:]')" ]; do
    [ "$(date +%s)" -ge "$deadline" ] && { echo "::error::$BUNDLE never appeared" >&2; exit 1; }
    "$HDC" -t "$TARGET" shell power-shell wakeup >/dev/null 2>&1 || true
    "$HDC" -t "$TARGET" shell uinput -T -m 400 1600 400 400 300 >/dev/null 2>&1 || true
    "$HDC" -t "$TARGET" shell aa start -b $BUNDLE -a EntryAbility --ps dsh.e2e.leg card.player >/dev/null 2>&1 || true
    sleep 3
done
say "launched (dsh.e2e.leg card.player), watching the card's bus lines"

# ---- drive: screenshot the face at present, at complete, at the verdict ----
# The shot checks run on the TERMINAL iteration too (do-while shape): the
# scenario completes ~800ms after card.complete.posted, so an until-condition
# poll would exit between two greps and skip the complete shot (measured:
# the first green run produced no 02-card-complete.png).
saw_present=0
saw_complete=0
deadline=$(( $(date +%s) + 240 ))
while :; do
    if grep -q "card.player.*scenario.complete\|scenario.failed" "$STREAM"; then
        break
    fi
    if [ "$(date +%s)" -ge "$deadline" ]; then
        grep "dsh\." "$STREAM" | tail -40 >&2 || true
        echo "::error::card.player scenario did not complete within 240s" >&2
        exit 1
    fi
    presents=$(grep -c "card.present.posted" "$STREAM" || true)
    if [ "$presents" -gt "$saw_present" ]; then
        saw_present=$presents
        sleep 1
        [ -f "$OUT/screens/01-card-present.png" ] || shot 01-card-present
    fi
    completes=$(grep -c "card.complete.posted" "$STREAM" || true)
    if [ "$completes" -gt "$saw_complete" ]; then
        saw_complete=$completes
        sleep 1
        [ -f "$OUT/screens/02-card-complete.png" ] || shot 02-card-complete
    fi
    sleep 1
done
# The card stays visible after complete (the face holds the complete
# message until dismiss) — the complete/final shots remain truthful here.
[ -f "$OUT/screens/02-card-complete.png" ] || { sleep 1; shot 02-card-complete; }
sleep 1
shot 03-final

kill "$streamer" 2>/dev/null || true
wait "$streamer" 2>/dev/null || true
trap - EXIT

# ---- capture pull + checkers (the capture file is the checker's input,
#      not the hilog stream — run-mic-plane.sh's discipline) ---------------
"$HDC" -t "$TARGET" file recv "$BASE/dsh-card-player-capture.log" \
    "$OUT/card-player-capture.txt" >/dev/null \
    || { echo "::error::capture pull failed — $BASE/dsh-card-player-capture.log" >&2; exit 1; }
grep -h '^dsh.runtime.log:' "$OUT/card-player-capture.txt" > "$OUT/scenario.jsonl" || true

FAIL=0
node test/e2e/check.mjs --manifest test/e2e/scenarios/card-player-harmony.json \
    --log "$OUT/card-player-capture.txt" \
    --out "$OUT/verdict-card-player-harmony.json" || FAIL=1
if [ "$FAIL" != "0" ]; then
    echo "::error::card-player-harmony checker failed" >&2
    exit 1
fi

TREE_LINE="origin/main $(git rev-parse --short=12 HEAD)$(git diff-index --quiet HEAD -- || echo ' (dirty working tree at receipt time)')"
cat > "$OUT/receipt.json" <<EOF
{
  "host": "harmony",
  "udid": "$TARGET (dsh_phone emulator)",
  "runner": "hosts/harmony/ci/run-card-player.sh",
  "phase": "card.player",
  "launch": "dsh_phone emulator, --ps dsh.e2e.leg card.player (Debug)",
  "tree": "$TREE_LINE",
  "engine": "$(sed -n 's/^PIN=//p' external/ensure.sh)",
  "scenarios": [
    { "manifest": "card-player-harmony", "verdict": "verdict-card-player-harmony.json", "pass": true }
  ],
  "screens": ["screens/01-card-present.png", "screens/02-card-complete.png", "screens/03-final.png"],
  "producedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
say "PASS — card.player green ($OUT)"
