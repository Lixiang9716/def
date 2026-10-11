#!/bin/sh
# hosts/harmony/ci/run-create-card.sh — the create-approve-hotmount loop's
# E2E leg on the HarmonyOS emulator (scenario `create.card`, ONE launch via
# `--ps dsh.e2e.leg create.card` + `--ps dsh.script.approval approve`): the
# SPINE seat (OfficialServe.beginInteractive) composes the full vendored
# spine, then the canonical create-card scenario evals on the live runtime —
# plugin_create writes the workspace package, the approval dialog answers
# ITSELF through the scripted-approval seam (350 ms after present, the same
# settle a human tap takes), the registry row installs, and the card.*
# lines project into the PiP face above the mounted official page.
# run-card-player.sh's machinery.
#
# usage: run-create-card.sh   (env: DSH_CLT overrides the toolchain root,
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
OUT=hosts/harmony/artifacts/create-card
mkdir -p "$OUT/screens"

say() { echo "run-create-card: $*"; }

if [ "${DSH_SKIP_BUILD:-0}" != "1" ]; then
    say "staging the officialweb closure + building the HAP"
    hosts/harmony/ci/vendor-official.sh
    (cd hosts/harmony && "$CLT/bin/hvigorw" assembleHap --mode module \
        -p product=default -p buildMode=debug --no-daemon > /tmp/dsh-cc-build.log 2>&1) \
        || { echo "::error::hvigorw build failed — see /tmp/dsh-cc-build.log"; exit 1; }
fi
[ -f "$HAP" ] || { echo "::error::$HAP missing — build first" >&2; exit 1; }

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

"$HDC" -t "$TARGET" shell power-shell wakeup >/dev/null 2>&1 || true
"$HDC" -t "$TARGET" shell uinput -T -m 400 1600 400 400 300 >/dev/null 2>&1 || true
"$HDC" -t "$TARGET" shell aa force-stop $BUNDLE >/dev/null 2>&1 || true
if [ -n "$("$HDC" -t "$TARGET" shell pidof $BUNDLE 2>/dev/null | tr -d '[:space:]')" ]; then
    echo "::error::aa force-stop left $BUNDLE resident" >&2
    exit 1
fi
# The workspace persists across installs (the app's files dir): a previous
# run's plugins/pomodoro-create + the dsh.plugins registry row replay at the
# spine boot and the leg's own mount then answers "already mounted — unmount
# first" (measured 2026-10-11). One leg, one workspace: `bm clean -d` resets
# the app's data sandbox (a shell rm cannot — the app-created plugin files
# refuse the shell uid, measured the same day).
"$HDC" -t "$TARGET" shell "bm clean -n $BUNDLE -d" >/dev/null 2>&1 \
    || echo "::warning::bm clean failed — a stale workspace may fail the leg loud (already mounted)"
"$HDC" -t "$TARGET" shell hilog -r >/dev/null
for knob in pidoff domainoff; do
    "$HDC" -t "$TARGET" shell hilog -Q "$knob" >/dev/null 2>&1 \
        || echo "::warning::hilog -Q $knob failed — the record stream may drop" >&2
done

STREAM=/tmp/dsh-cc-hilog.txt
: > "$STREAM"
"$HDC" -t "$TARGET" shell hilog > "$STREAM" 2>/dev/null &
streamer=$!
trap 'kill "$streamer" 2>/dev/null || true' EXIT
attach_deadline=$(( $(date +%s) + 60 ))
until [ -s "$STREAM" ]; do
    [ "$(date +%s)" -ge "$attach_deadline" ] && { echo "::error::hilog streamer never attached" >&2; exit 1; }
    sleep 0.2
done

deadline=$(( $(date +%s) + 120 ))
until [ -n "$("$HDC" -t "$TARGET" shell pidof $BUNDLE 2>/dev/null | tr -d '[:space:]')" ]; do
    [ "$(date +%s)" -ge "$deadline" ] && { echo "::error::$BUNDLE never appeared" >&2; exit 1; }
    "$HDC" -t "$TARGET" shell power-shell wakeup >/dev/null 2>&1 || true
    "$HDC" -t "$TARGET" shell uinput -T -m 400 1600 400 400 300 >/dev/null 2>&1 || true
    "$HDC" -t "$TARGET" shell aa start -b $BUNDLE -a EntryAbility \
        --ps dsh.e2e.leg create.card --ps dsh.script.approval approve >/dev/null 2>&1 || true
    sleep 3
done
say "launched (dsh.e2e.leg create.card + dsh.script.approval approve), watching the spine compose"

shot() {
    "$HDC" -t "$TARGET" shell snapshot_display -f /data/local/tmp/dsh-cc-shot.jpeg >/dev/null 2>&1 || true
    "$HDC" -t "$TARGET" file recv /data/local/tmp/dsh-cc-shot.jpeg "/tmp/dsh-cc-shot.jpeg" >/dev/null 2>&1 || true
    sips -s format png /tmp/dsh-cc-shot.jpeg --out "$OUT/screens/$1.png" >/dev/null 2>&1 || true
    rm -f /tmp/dsh-cc-shot.jpeg
}

# ---- drive: the spine composes (web.plugins chunks + config), then the
# scenario runs. The face shot keys on the MOUNTED PLUGIN's own present
# marker (its `card.posted` log — the card.present bus line itself never
# reaches hilog) +2s: mid-tick, the countdown running. The complete fires
# at DURATION_MS=8s. Terminal-iteration shot checks (the run-card-player
# race lesson).
saw_face=0
deadline=$(( $(date +%s) + 300 ))
while :; do
    if grep -q "create.card.*scenario.complete\|scenario.failed" "$STREAM"; then
        break
    fi
    if [ "$(date +%s)" -ge "$deadline" ]; then
        grep "dsh\." "$STREAM" | tail -40 >&2 || true
        echo "::error::create.card scenario did not complete within 300s" >&2
        exit 1
    fi
    faces=$(grep -c "event.*card.posted" "$STREAM" || true)
    if [ "$faces" -gt "$saw_face" ]; then
        saw_face=$faces
        # mid-tick: the card is present and the timer is running
        sleep 2
        [ -f "$OUT/screens/01-create-card-face.png" ] || shot 01-create-card-face
    fi
    sleep 1
done
sleep 1
[ -f "$OUT/screens/01-create-card-face.png" ] || { sleep 2; shot 01-create-card-face; }
sleep 1
shot 02-final

kill "$streamer" 2>/dev/null || true
wait "$streamer" 2>/dev/null || true
trap - EXIT

# ---- capture pull + checkers ----------------------------------------------
"$HDC" -t "$TARGET" file recv "$BASE/dsh-create-card-capture.log" \
    "$OUT/create-card-capture.txt" >/dev/null \
    || { echo "::error::capture pull failed — $BASE/dsh-create-card-capture.log" >&2; exit 1; }
grep -h '^dsh.runtime.log:' "$OUT/create-card-capture.txt" > "$OUT/scenario.jsonl" || true

say "the approval's hilog line (the scripted seam answered):"
grep "script answered" "$STREAM" | tail -1 | sed 's/^/  /' || true

FAIL=0
node test/e2e/check.mjs --manifest test/e2e/scenarios/create-card-harmony.json \
    --log "$OUT/create-card-capture.txt" \
    --out "$OUT/verdict-create-card-harmony.json" || FAIL=1
if [ "$FAIL" != "0" ]; then
    echo "::error::create-card-harmony checker failed" >&2
    exit 1
fi

TREE_LINE="origin/main $(git rev-parse --short=12 HEAD)$(git diff-index --quiet HEAD -- || echo ' (dirty working tree at receipt time)')"
cat > "$OUT/receipt.json" <<EOF
{
  "host": "harmony",
  "udid": "$TARGET (dsh_phone emulator)",
  "runner": "hosts/harmony/ci/run-create-card.sh",
  "phase": "create.card",
  "launch": "dsh_phone emulator, --ps dsh.e2e.leg create.card + --ps dsh.script.approval approve (Debug)",
  "tree": "$TREE_LINE",
  "engine": "$(sed -n 's/^PIN=//p' runtime/dsh/vendor/ensure.sh)",
  "scenarios": [
    { "manifest": "create-card-harmony", "verdict": "verdict-create-card-harmony.json", "pass": true }
  ],
  "screens": ["screens/01-create-card-face.png", "screens/02-final.png"],
  "producedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
say "PASS — create.card green ($OUT)"
