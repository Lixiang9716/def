#!/bin/sh
# hosts/android/ci/run-upgrade-matrix.sh — the APP UPGRADE MATRIX leg
# (test-hardening row 15): `adb install -r` ACROSS builds, with the two
# faces an upgrade must hold at once:
#
#   data survival — the profile container (files/profiles/) is user state:
#     launch 1 runs the persist-restart seat's create leg (a real journaled
#     turn); the UPGRADE (install -r vB over vA, no uninstall) replaces the
#     force-stop of the restart leg; launch 2 runs the resume leg — the
#     journal restored and continued over the upgrade IS the proof.
#   asset reconciliation — AssetSync's stamp (files/dsh/.dsh-asset-stamp,
#     the sorted manifest of what the APK ships): build A ships a probe
#     file the tree does NOT carry; after install -r of build B (probe
#     removed) the boot must WIPE the stale entry (the 274-dirs bug class)
#     while the canary file planted in profiles/ survives untouched.
#
# The runner owns the probe's lifecycle (create → build A → remove →
# build B), restoring the tree on every exit path; the probe is never
# committed. Verdicts: the one-to-one checker over the canary stream
# (both legs) plus the run-as on-disk assertions below; evidence and
# receipt under hosts/android/artifacts/upgrade-matrix/.
#
# usage: run-upgrade-matrix.sh [--skip-build-a]   (env: DSH_ANDROID_SERIAL)
set -u
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
cd "$ROOT" || exit 1
PKG=com.dshmobile.host
OUT="${DSH_ANDROID_ART:-hosts/android/artifacts/upgrade-matrix}"
SCEN=test/e2e/scenarios/android-session-persist-restart.json
CAPTURE=hosts/android/ci/logcat-capture.sh
APK=hosts/android/app/build/outputs/apk/debug/app-debug.apk
PROBE=hosts/android/app/src/main/assets/dsh/upgrade-probe.txt
CANARY_REL="files/profiles/default/upgrade-canary.txt"
SERIAL="${DSH_ANDROID_SERIAL:-}"
SKIP_BUILD_A=0
[ "${1:-}" = "--skip-build-a" ] && SKIP_BUILD_A=1

say() { echo "run-upgrade-matrix: $*"; }
die() { echo "run-upgrade-matrix: FAIL: $*" >&2; exit 1; }
adbsh() { if [ -n "$SERIAL" ]; then adb -s "$SERIAL" "$@"; else adb "$@"; fi; }
shot() { adbsh shell screencap -p /sdcard/dsh-shot.png >/dev/null 2>&1 && adbsh pull /sdcard/dsh-shot.png "$OUT/screens/$1.png" >/dev/null 2>&1 || true; }
# run-as: the DEBUG build's on-disk face (release is not debuggable — the
# upgrade matrix rides debug for exactly this reason).
runas() { adbsh shell run-as $PKG "$@"; }

# The probe is the tree delta BETWEEN the builds; restore on every exit.
restore_probe() { rm -f "$PROBE"; }
trap 'restore_probe' EXIT INT TERM

mkdir -p "$OUT/screens"

# ---- 0. Android SDK discovery (the fresh-worktree trap, see the restart leg)
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
    || die "no Android SDK found — set ANDROID_HOME or write hosts/android/local.properties"

# ---- 1. build A: the tree WITH the probe asset ------------------------------
say "1/7 build A (probe present: $PROBE)"
if [ "$SKIP_BUILD_A" = "1" ]; then
    # Reuse the PREVIOUS run's copied artifact — the default output path
    # holds whatever built LAST (after a full prior run that is build B,
    # which ships no probe). The A bytes must carry the probe.
    [ -f "$OUT/upgrade-a.apk" ] || die "--skip-build-a needs a prior run's $OUT/upgrade-a.apk"
else
    printf 'upgrade-matrix probe: build A ships me, build B must wipe me\n' > "$PROBE"
    ( cd hosts/android && ./gradlew assembleDebug --console=plain -q >/dev/null ) \
        || die "gradle assembleDebug (A) failed"
    [ -f "$APK" ] || die "APK missing at $APK (build first)"
    cp "$APK" "$OUT/upgrade-a.apk"
fi

# ---- 2. boot + FRESH install of A (uninstall is setup-only, never later) ----
say "2/7 boot poll + uninstall + install A"
adbsh wait-for-device
boot_deadline=$(( $(date +%s) + 120 ))
until adbsh shell getprop sys.boot_completed 2>/dev/null | grep -q 1; do
    [ "$(date +%s)" -ge "$boot_deadline" ] && die "emulator did not finish booting within 120s"
    sleep 2
done
adbsh uninstall $PKG >/dev/null 2>&1 || true
adbsh install "$OUT/upgrade-a.apk" >/dev/null || die "adb install A failed"
adbsh shell setprop persist.sys.timezone Asia/Shanghai >/dev/null 2>&1 || true

# ---- 3. canary capture: ONE stream across BOTH launches ----------------------
say "3/7 canary capture (dsh.runtime + dsh.runtime.result, one stream)"
CANARY=$(CAPTURE_FILE="$OUT/logs.txt" sh "$CAPTURE" start dsh.runtime dsh.runtime.result) \
    || die "logcat capture failed to attach"
cleanup_capture() { CAPTURE_FILE="$OUT/logs.txt" sh "$CAPTURE" stop >/dev/null 2>&1 || true; }
trap 'cleanup_capture; restore_probe' EXIT INT TERM

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

# ---- 4. launch A: the create leg, then the canary plant ----------------------
say "4/7 launch A (create leg) — then plant the workspace canary"
launch
CAPTURE_FILE="$OUT/logs.txt" sh "$CAPTURE" wait -f "$OUT/logs.txt" "$CANARY" 300 \
    '"leg":"create"' 'dsh.runtime.result: ALL' \
    || die "create leg on A did not settle within 300s"
shot 01-a-create-settled
force_stop
PROBE_ON_A=$(runas ls files/dsh/upgrade-probe.txt 2>/dev/null | tr -d '\r')
[ "$PROBE_ON_A" = "files/dsh/upgrade-probe.txt" ] \
    || die "build A's probe never materialized at files/dsh/upgrade-probe.txt (got '$PROBE_ON_A')"
# adb's device-side shell re-splits quoted args, so the canary rides STDIN
# through dd — no -c quoting to mangle.
runas mkdir -p files/profiles/default
printf 'upgrade-canary' | adbsh shell run-as $PKG dd of=$CANARY_REL 2>/dev/null >/dev/null \
    || die "could not plant the workspace canary"
CANARY_PLANTED=$(runas cat "$CANARY_REL" 2>/dev/null | tr -d '\r')
[ "$CANARY_PLANTED" = "upgrade-canary" ] || die "the canary did not plant (got '$CANARY_PLANTED')"
say "   probe materialized; canary planted at $CANARY_REL"

# ---- 5. THE UPGRADE: probe removed, build B, install -r (never uninstall) ----
say "5/7 THE UPGRADE: probe removed → build B → install -r"
force_stop
restore_probe
trap 'cleanup_capture; restore_probe' EXIT INT TERM
( cd hosts/android && ./gradlew assembleDebug --console=plain -q >/dev/null ) \
    || die "gradle assembleDebug (B) failed"
cp "$APK" "$OUT/upgrade-b.apk"
adbsh install -r "$OUT/upgrade-b.apk" >/dev/null || die "adb install -r B failed"
# A deterministic process boundary before the resume launch: whether the
# update killed the resident process or not, nothing survives into leg B.
force_stop

# ---- 6. launch B: the resume leg over the SAME container ---------------------
say "6/7 launch B (resume leg) — the journal must continue across the upgrade"
launch
CAPTURE_FILE="$OUT/logs.txt" sh "$CAPTURE" wait -f "$OUT/logs.txt" "$CANARY" 300 \
    '"leg":"resume"' 'dsh.runtime.result: ALL' \
    || die "resume leg on B did not settle within 300s"
force_stop
sleep 1
shot 02-b-resume-settled

cleanup_capture
restore_probe
trap - EXIT INT TERM

# ---- 7. the on-disk assertions: stale wiped, canary alive, stamp present -----
say "7/7 on-disk assertions (stamp reconciliation vs user data)"
PROBE_ON_B=$(runas ls files/dsh/upgrade-probe.txt 2>/dev/null | tr -d '\r')
[ -z "$PROBE_ON_B" ] || die "STALE ASSET SURVIVED THE UPGRADE: files/dsh/upgrade-probe.txt still present (the 274-dirs class)"
CANARY_ON_B=$(runas cat "$CANARY_REL" 2>/dev/null | tr -d '\r')
[ "$CANARY_ON_B" = "upgrade-canary" ] \
    || die "USER DATA LOST IN UPGRADE: $CANARY_REL is missing or altered (got '$CANARY_ON_B')"
STAMP=$(runas ls files/dsh/.dsh-asset-stamp 2>/dev/null | tr -d '\r')
[ "$STAMP" = "files/dsh/.dsh-asset-stamp" ] || die "the asset stamp is missing after B's boot"
say "   stale probe wiped; canary intact; stamp present"

# ---- checkers + receipt -------------------------------------------------------
say "checkers"
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
  "runner": "hosts/android/ci/run-upgrade-matrix.sh",
  "phase": "app upgrade matrix (row 15) — install -r across builds; AssetSync stamps",
  "launch": "emulator, build A (probe shipped) create leg → install -r build B (probe removed) resume leg on the SAME container",
  "tree": "$TREE_LINE",
  "engine": "$(sed -n 's/^PIN=//p' external/ensure.sh)",
  "upgrade": {
    "apkA": "upgrade-a.apk",
    "apkB": "upgrade-b.apk",
    "assetReconciliation": "stale probe wiped by the stamp; canary in files/profiles/default untouched; stamp present after B's boot",
    "dataSurvival": "the persist-restart resume leg continued the journal across the upgrade (checker manifest shared with the restart leg)"
  },
  "scenarios": [
    { "manifest": "android-session-persist-restart", "verdict": "verdict-android-session-persist-restart.json", "pass": true }
  ],
  "screens": ["screens/01-a-create-settled.png", "screens/02-b-resume-settled.png"],
  "producedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
say "receipt written — upgrade matrix green ($OUT)"
