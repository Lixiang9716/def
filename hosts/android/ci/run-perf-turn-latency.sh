#!/bin/sh
# hosts/android/ci/run-perf-turn-latency.sh — the turn-latency MEASUREMENT
# leg on the device/emulator seat (scenario `android.perf.turn-latency`; the
# device-light pass's turn leg, D-g posture: implemented, receipt-ready,
# awaiting hardware — with no device attached this fails LOUD naming it, it
# never fakes evidence). The spine boots bare (NO persistence row — this leg
# measures, it does not re-prove the persistence family), ONE scripted turn
# over the spine, segmented the way a user feels it:
#
#   promptToFirstDeltaMs   followup → the FIRST streamed content delta
#   firstDeltaToSettleMs   first delta → whenIdle
#   turnMs                 followup → settled
#
# The numbers ride the scenario's event stream (D8) in the captured logcat;
# the runner extracts them from the SAME captured log into the receipt
# (jittery values never enter the deterministic log — the manifest pins the
# events and their stable fields only). The CLI sibling
# (runtime/dsh/ci/run-perf-turn-latency.sh) measures the SAME segments on the
# CLI host and lands its own receipt. DEBUG build: the numbers include
# debug-build overhead — the receipt says so (the release flavor suppresses
# the JS info stream this leg's evidence rides; a release-flavor measurement
# face would need the result-plane bridge and is deliberately NOT faked
# here).
#
# Capture is the shared canary-pinned streamer (logcat-capture.sh). Checker:
# test/e2e/scenarios/android-perf-turn-latency.json, one-to-one in order.
# Evidence: hosts/android/artifacts/perf-turn-latency/.
#
# usage: run-perf-turn-latency.sh [--skip-build]   (env:
#        DSH_ANDROID_ART, DSH_ANDROID_SERIAL)
set -u
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
cd "$ROOT" || exit 1
PKG=com.dshmobile.host
OUT="${DSH_ANDROID_ART:-hosts/android/artifacts/perf-turn-latency}"
SCEN=test/e2e/scenarios/android-perf-turn-latency.json
CAPTURE=hosts/android/ci/logcat-capture.sh
APK=hosts/android/app/build/outputs/apk/debug/app-debug.apk
SERIAL="${DSH_ANDROID_SERIAL:-}"
SKIP_BUILD=0
[ "${1:-}" = "--skip-build" ] && SKIP_BUILD=1

say() { echo "run-perf-turn-latency: $*"; }
die() { echo "run-perf-turn-latency: FAIL: $*" >&2; exit 1; }
adbsh() { if [ -n "$SERIAL" ]; then adb -s "$SERIAL" "$@"; else adb "$@"; fi; }
shot() { adbsh shell screencap -p /sdcard/dsh-shot.png >/dev/null 2>&1 && adbsh pull /sdcard/dsh-shot.png "$OUT/screens/$1.png" >/dev/null 2>&1 || true; }

mkdir -p "$OUT/screens"

# ---- 0. device presence (the receipt-ready boundary: fail loud) -------------
ATTACHED="$(adbsh devices | awk 'NR>1 && $2=="device" && $1 != "" {print $1; exit}')"
[ -n "$ATTACHED" ] || die "no android device/emulator attached (adb devices) — the turn-latency leg is a REAL-seat measurement: implemented, receipt-ready, awaiting hardware (the CLI simulation half: runtime/dsh/ci/run-perf-turn-latency.sh, green without hardware)"

# ---- 1. Android SDK discovery ------------------------------------------------
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

# ---- 2. build + boot + install ------------------------------------------------
if [ "$SKIP_BUILD" = "0" ]; then
    say "1/5 assembleDebug (ANDROID_HOME=${ANDROID_HOME:-<local.properties>})"
    ( cd hosts/android && ./gradlew assembleDebug --console=plain -q >/dev/null ) \
        || die "gradle assembleDebug failed"
else
    say "1/5 build skipped"
fi
[ -f "$APK" ] || die "APK missing at $APK (build first)"

say "2/5 boot poll + install ($ATTACHED)"
adbsh wait-for-device
boot_deadline=$(( $(date +%s) + 120 ))
until adbsh shell getprop sys.boot_completed 2>/dev/null | grep -q 1; do
    [ "$(date +%s)" -ge "$boot_deadline" ] && die "emulator did not finish booting within 120s"
    sleep 2
done
adbsh install -r "$APK" >/dev/null || die "adb install failed"

# ---- 3. setup: a clean container (measurement, not persistence) ---------------
say "3/5 setup (pm clear + timezone)"
adbsh shell pm clear $PKG >/dev/null 2>&1 || true
adbsh shell setprop persist.sys.timezone Asia/Shanghai >/dev/null 2>&1 || true
adbsh shell am force-stop $PKG >/dev/null 2>&1 || true
stop_deadline=$(( $(date +%s) + 30 ))
while [ -n "$(adbsh shell pidof $PKG 2>/dev/null | tr -d '[:space:]')" ]; do
    [ "$(date +%s)" -ge "$stop_deadline" ] && die "force-stop left $PKG resident"
    adbsh shell am force-stop $PKG >/dev/null 2>&1 || true
    sleep 1
done

# ---- 4. canary stream + the measured turn --------------------------------------
say "4/5 canary capture + launch (--ez dsh.perfturn true)"
CANARY=$(CAPTURE_FILE="$OUT/logs.txt" sh "$CAPTURE" start dsh.runtime dsh.runtime.result) \
    || die "logcat capture failed to attach"
cleanup_capture() { CAPTURE_FILE="$OUT/logs.txt" sh "$CAPTURE" stop >/dev/null 2>&1 || true; }
trap 'cleanup_capture' EXIT INT TERM

launch_deadline=$(( $(date +%s) + 60 ))
until adbsh shell am start -n $PKG/.MainActivity --ez dsh.perfturn true >/dev/null 2>&1; do
    [ "$(date +%s)" -ge "$launch_deadline" ] && { cleanup_capture; die "am start kept failing within 60s"; }
    sleep 2
done
CAPTURE_FILE="$OUT/logs.txt" sh "$CAPTURE" wait -f "$OUT/logs.txt" "$CANARY" 300 \
    '"event":"perf.turn.completed"' 'dsh.runtime.result: ALL' \
    || die "the measured turn did not settle within 300s"
sleep 1
shot 01-turn-settled

cleanup_capture
trap - EXIT INT TERM

# ---- checkers + receipt ---------------------------------------------------------
say "5/5 checkers"
CAPTURE_FILE="$OUT/logs.txt" sh "$CAPTURE" view "$CANARY" > "$OUT/logs.view"
mv "$OUT/logs.view" "$OUT/logs.txt"
grep 'dsh.runtime.log:' "$OUT/logs.txt" > "$OUT/scenario.jsonl" || true
rm -f "$OUT/verdict-android-perf-turn-latency.json"

FAIL=0
node test/e2e/check.mjs --manifest "$SCEN" \
    --log "$OUT/logs.txt" --out "$OUT/verdict-android-perf-turn-latency.json" || FAIL=1
cat "$OUT/verdict-android-perf-turn-latency.json"
[ "$FAIL" = "0" ] || die "checker red — evidence stays unreceipted"

MEASURED="$(node -e '
const fs = require("fs");
const TAG = "dsh.runtime.log:";
const rows = fs.readFileSync(process.argv[1], "utf8").split("\n")
  // device lines carry the logcat prefix ("MM-DD HH:MM:SS.mmm pid tid I
  // dsh.runtime: dsh.runtime.log: {...}") — slice at the TAG, never assume
  // the line starts with it (measured on the emulator 2026-10-14).
  .filter((l) => l.includes(TAG))
  .map((l) => JSON.parse(l.slice(l.indexOf(TAG) + TAG.length)))
  .map((r) => (Array.isArray(r.data) ? r.data[0] : null))
  .filter((p) => p && p.scenario === "android.perf.turn-latency");
const pick = (event) => rows.find((p) => p.event === event) ?? null;
const boot = pick("perf.turn.boot");
const latency = pick("perf.turn.latency");
if (!boot || !latency) {
  console.error("run-perf-turn-latency: a measured event is missing from the log"); process.exit(1);
}
console.log(JSON.stringify({
  bootMs: boot.bootMs,
  promptToFirstDeltaMs: latency.promptToFirstDeltaMs,
  firstDeltaToSettleMs: latency.firstDeltaToSettleMs,
  turnMs: latency.turnMs,
  deltas: latency.deltas,
}));
' "$OUT/scenario.jsonl")" || die "measured-segment extraction failed (the receipt would have lied)"

UDID="$(adbsh get-serialno | tr -d '\r')"
TREE_LINE="origin/main $(git rev-parse --short=12 HEAD)$(git diff-index --quiet HEAD -- || echo ' (dirty working tree at receipt time)')"
cat > "$OUT/receipt.json" <<EOF
{
  "host": "android",
  "udid": "$UDID",
  "runner": "hosts/android/ci/run-perf-turn-latency.sh",
  "phase": "perf.turn-latency",
  "launch": "emulator/device, --ez dsh.perfturn true (one spine turn over the carrier scripted route)",
  "tree": "$TREE_LINE",
  "engine": "$(sed -n 's/^PIN=//p' external/ensure.sh)",
  "build": "debug (the JS info stream this leg's evidence rides; numbers include debug-build overhead — the release flavor suppresses that stream)",
  "measured": $MEASURED,
  "wire": "boot spine (agent.followup → onSse → whenIdle), the on-device seats' path",
  "cliSibling": "runtime/dsh/artifacts/macos-cli-perf-turn-latency/receipt.json (same segments, CLI host)",
  "scenarios": [
    { "manifest": "android-perf-turn-latency", "verdict": "verdict-android-perf-turn-latency.json", "pass": true }
  ],
  "screens": ["screens/01-turn-settled.png"],
  "producedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
say "receipt written — perf.turn-latency measured ($OUT)"
