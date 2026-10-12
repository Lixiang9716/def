#!/bin/sh
# hosts/android/ci/run-card-player.sh — the native card face's deterministic
# E2E leg on the emulator (scenario `card.player`): the scenario posts
# card.present + five card.state ticks + card.complete over the bus, THIS
 # host renders them through CardSurface (the PiP widget), and the
# /api/state seam reads the face mid-tick (app.card.visible=true — the
# surface-side proof the log alone cannot give). The scripted-approval
# extra rides the launch (the seam answers if an approval ever presents).
# Evidence lands under hosts/android/artifacts/card-player/.
#
# usage: run-card-player.sh [--skip-build]   (env: DSH_ANDROID_ART,
#        DSH_ANDROID_SERIAL)
set -u
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
cd "$ROOT" || exit 1
PKG=com.dshmobile.host
OUT="${DSH_ANDROID_ART:-hosts/android/artifacts/card-player}"
SCEN=test/e2e/scenarios
APK=hosts/android/app/build/outputs/apk/debug/app-debug.apk
SERIAL="${DSH_ANDROID_SERIAL:-}"
SKIP_BUILD=0
[ "${1:-}" = "--skip-build" ] && SKIP_BUILD=1

say() { echo "run-card-player: $*"; }
die() { echo "run-card-player: FAIL: $*" >&2; exit 1; }
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
say "3/6 launch (--ez dsh.cardplayer true --es dsh.script.approval approve)"
adbsh shell am force-stop $PKG >/dev/null 2>&1 || true
stop_deadline=$(( $(date +%s) + 30 ))
while [ -n "$(adbsh shell pidof $PKG 2>/dev/null | tr -d '[:space:]')" ]; do
    [ "$(date +%s)" -ge "$stop_deadline" ] && die "force-stop left $PKG resident"
    adbsh shell am force-stop $PKG >/dev/null 2>&1 || true
    sleep 1
done
adbsh logcat -c
launch_deadline=$(( $(date +%s) + 60 ))
until adbsh shell am start -n $PKG/.MainActivity --ez dsh.cardplayer true \
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
snapshot() { adbsh logcat -d -s dsh.runtime dsh.runtime.result dsh.runtime.ui dsh.snapshot dsh.serve > "$DUMP" 2>/dev/null; }

# The state seam's harvest (rule 8: poll the condition, never a clock): the
# drive seat logs `dsh.serve: origin token=… port=…` once its carrier
# listens — poll the dump until the line exists, deadline bounded. The old
# single grep ran before the line could exist and harvested air, every run.
say "4/6 origin harvest (polling the dump, deadline 120s)"
origin_deadline=$(( $(date +%s) + 120 ))
until snapshot && grep -q "origin token=" "$DUMP"; do
    [ "$(date +%s)" -ge "$origin_deadline" ] && {
        tail -20 "$DUMP"
        die "no dsh.serve origin line within 120s of am start"
    }
    sleep 1
done
PORT=$(grep -o 'origin token=[a-f0-9]* port=[0-9]*' "$DUMP" | tail -1 | grep -o 'port=[0-9]*' | cut -d= -f2)
TOKEN=$(grep -o 'origin token=[a-f0-9]*' "$DUMP" | tail -1 | cut -d= -f2)
[ -n "$PORT" ] && [ -n "$TOKEN" ] || die "origin line present but PORT/TOKEN harvest failed"
adbsh forward tcp:$PORT tcp:$PORT || die "adb forward tcp:$PORT failed"

# The mid-tick face probe: the card lives from card.present until ~2.5s
# after card.complete (the surface's own dismiss) — curl /api/state the
# moment the posted-present record shows in the dump, ONE probe per run, so
# the snapshot reads the face INSIDE its window. visible=true is the seam
# assertion the log alone cannot give (the previous generation's comment
# deferred this exact check to "the next live generation" — this is it).
probe_state() {
    state_probe=$(curl -s --max-time 5 -H "Cookie: dsh.session=$TOKEN" \
        "http://127.0.0.1:$PORT/api/state")
    echo "$state_probe" > "$OUT/state-snapshot.json"
    visible=$(printf '%s' "$state_probe" | node -e '
        let raw = "";
        process.stdin.on("data", (c) => { raw += c; });
        process.stdin.on("end", () => {
            try { console.log(JSON.parse(raw)?.app?.card?.visible === true ? "true" : "false"); }
            catch { console.log("false"); }
        });
    ')
}

saw_present=0
saw_complete=0
state_probe=""
visible=""
deadline=$(( $(date +%s) + 240 ))
until snapshot && grep -q "card.player.*scenario.complete\|scenario.failed" "$DUMP"; do
    if [ "$(date +%s)" -ge "$deadline" ]; then
        tail -60 "$DUMP"
        die "card.player scenario did not complete within 240s"
    fi
    if [ -z "$state_probe" ] && grep -q "card.present.posted" "$DUMP"; then
        probe_state
    fi
    presents=$(grep -c "card.present.posted" "$DUMP")
    if [ "$presents" -gt "$saw_present" ]; then
        saw_present=$presents
        sleep 2
        [ -f "$OUT/screens/01-card-present.png" ] || shot 01-card-present
    fi
    completes=$(grep -c "card.complete.posted" "$DUMP")
    if [ "$completes" -gt "$saw_complete" ]; then
        saw_complete=$completes
        sleep 1
        [ -f "$OUT/screens/02-card-complete.png" ] || shot 02-card-complete
    fi
    sleep 1
done
sleep 1
# A completed scenario with no probe taken means the poll never saw the
# present in time (a one-iteration race): probe once anyway, and let the
# visible assertion below judge the result honestly.
[ -n "$state_probe" ] || probe_state

# ---- 5. checkers -------------------------------------------------------------
say "5/6 checkers"
cp "$DUMP" "$OUT/logs.txt"
grep 'dsh.runtime.log:' "$OUT/logs.txt" > "$OUT/scenario.jsonl" || true
shot 03-final

FAIL=0
node test/e2e/check.mjs --manifest $SCEN/card-player-android.json \
    --log "$OUT/logs.txt" --out "$OUT/verdict-card-player.json" || FAIL=1
cat "$OUT/verdict-card-player.json"
[ "$FAIL" = "0" ] || die "checkers red — evidence stays unreceipted"
# The seam assertion the leg exists for: the snapshot must carry the face
# PRESENTED (visible=true) — a snapshot without it is a probe outside the
# card's window, and the leg has not proven what it names.
[ "$visible" = "true" ] || {
    cat "$OUT/state-snapshot.json"
    die "app.card.visible is not true in the mid-tick snapshot (probe raced the window)"
}

UDID="$(adbsh get-serialno | tr -d '\r')"
TREE_LINE="origin/main $(git rev-parse --short=12 HEAD)$(git diff-index --quiet HEAD -- || echo ' (dirty working tree at receipt time)')"
cat > "$OUT/receipt.json" <<EOF
{
  "host": "android",
  "udid": "$UDID",
  "runner": "hosts/android/ci/run-card-player.sh",
  "phase": "card.player",
  "launch": "emulator, --ez dsh.cardplayer true + --es dsh.script.approval approve (Debug)",
  "tree": "$TREE_LINE",
  "engine": "$(sed -n 's/^PIN=//p' external/ensure.sh)",
  "scenarios": [
    { "manifest": "card-player", "verdict": "verdict-card-player.json", "pass": true }
  ],
  "stateSeam": {
    "snapshot": "$OUT/state-snapshot.json",
    "app.card.visible": $visible,
    "asserted": true
  },
  "screens": ["screens/01-card-present.png", "screens/02-card-complete.png", "screens/03-final.png"],
  "producedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
say "receipt written — card.player green, app.card.visible=$visible ($OUT)"
