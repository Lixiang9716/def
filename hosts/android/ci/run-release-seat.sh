#!/bin/sh
# run-release-seat.sh — the PRODUCT seat's CI leg (the gaps3/android-03
# release-seat gap): build + sign the release flavor (debug keystore — the
# same cert the install evidence and the page-open pin use; NOT a
# distribution signature), install, boot the DEFAULT seat with NO intent
# extras (MainActivity: isRelease -> bootRelease -> SessionServe — no
# verification drive, no extras), then prove the seat came ALL the way up:
#
#   the `dsh.serve: origin token=… port=…` line (the carrier listens; the
#   spine booted — the settings probes' completion is the gate that opens
#   the origin), then GET /api/state on that origin answering a
#   claimedEndpoints array the runtime actually claimed (70+ rows on a
#   healthy boot) and a non-empty `app` block. One screenshot pins the
#   rendered page. Evidence lands under hosts/android/artifacts/release-seat/.
#
# No keystore → SKIP LOUD (exit 0, the message names why): the release
# flavor is unsigned by gradle and this leg refuses to mint credentials it
# was not handed.
#
# Every wait is a polled condition with a deadline (rules.md rule 8); every
# exhaustion is loud (rule 5). The assertion surface is Kotlin Log.i lines
# and the /api/state seam — they survive the release build's -DDSH_RELEASE
# log suppression (that suppression strips the JS logger's debug/info, not
# Kotlin Log.i and not the HTTP plane).
#
# usage: run-release-seat.sh [--skip-build]   (env: DSH_ANDROID_SERIAL,
#        DSH_RELEASE_OUT)
set -eu

ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
cd "$ROOT" || exit 1
PKG=com.dshmobile.host
OUT="${DSH_RELEASE_OUT:-hosts/android/artifacts/release-seat}"
SERIAL="${DSH_ANDROID_SERIAL:-}"
SKIP_BUILD=0
[ "${1:-}" = "--skip-build" ] && SKIP_BUILD=1

say() { echo "run-release-seat: $*"; }
die() { echo "::error::run-release-seat: $*" >&2; exit 1; }
skip() { echo "run-release-seat: SKIP: $*" >&2; exit 0; }
shot() { adbsh shell screencap -p /sdcard/dsh-shot.png >/dev/null 2>&1 && adbsh pull /sdcard/dsh-shot.png "$OUT/screens/$1.png" >/dev/null 2>&1 || true; }
adbsh() { if [ -n "$SERIAL" ]; then adb -s "$SERIAL" "$@"; else adb "$@"; fi; }

KS="$HOME/.android/debug.keystore"
[ -f "$KS" ] || skip "no debug keystore at $KS — the release flavor needs a signing cert this machine was not handed; generate one (keytool -genkeypair -keystore $KS -storepass android -keypass android -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 10000 -dname 'CN=Android Debug,O=Android,C=US') and re-run"

# ---- 1. build (assembleRelease) ----------------------------------------------
RELEASE_DIR=hosts/android/app/build/outputs/apk/release
UNSIGNED=$RELEASE_DIR/app-release-unsigned.apk
SIGNED=$RELEASE_DIR/app-release-signed.apk
if [ "$SKIP_BUILD" = "0" ]; then
    say "1/6 assembleRelease"
    ( cd hosts/android && ./gradlew assembleRelease --console=plain -q >/dev/null ) \
        || die "gradle assembleRelease failed"
else
    say "1/6 build skipped"
fi
[ -f "$UNSIGNED" ] || die "no unsigned release APK at $UNSIGNED (build first)"

# ---- 2. sign (the CI pattern: debug keystore, pass android) --------------------
say "2/6 apksigner (debug keystore)"
APKSIGNER=""
if [ -n "${ANDROID_HOME:-}" ] && [ -x "$ANDROID_HOME/build-tools/35.0.0/apksigner" ]; then
    APKSIGNER=$ANDROID_HOME/build-tools/35.0.0/apksigner
elif [ -n "${ANDROID_HOME:-}" ]; then
    APKSIGNER=$(ls "$ANDROID_HOME"/build-tools/*/apksigner 2>/dev/null | sort -V | tail -1 || true)
fi
[ -n "$APKSIGNER" ] || APKSIGNER=$(ls /opt/homebrew/share/android-commandlinetools/build-tools/*/apksigner 2>/dev/null | sort -V | tail -1 || true)
[ -n "$APKSIGNER" ] || die "apksigner not found (set ANDROID_HOME or install Android build-tools)"
"$APKSIGNER" sign --ks "$KS" --ks-pass pass:android \
    --out "$SIGNED" "$UNSIGNED" || die "apksigner sign failed"
"$APKSIGNER" verify "$SIGNED" || die "apksigner verify failed"

# ---- 3. boot + install ----------------------------------------------------------
say "3/6 boot poll + install"
adbsh wait-for-device
boot_deadline=$(( $(date +%s) + 120 ))
until adbsh shell getprop sys.boot_completed 2>/dev/null | grep -q 1; do
    [ "$(date +%s)" -ge "$boot_deadline" ] && die "emulator did not finish booting within 120s"
    sleep 2
done
adbsh install -r "$SIGNED" >/dev/null 2>&1 || {
    # A signature mismatch (the installed harness build was signed by a
    # different debug cert) refuses -r; the fresh-boot state this leg needs
    # is honest as replace-by-uninstall — loudly said (the page-open pin's
    # measured discipline).
    say "install -r refused (cert mismatch?) — uninstalling and installing fresh"
    adbsh uninstall $PKG >/dev/null 2>&1 || true
    adbsh install "$SIGNED" >/dev/null || die "adb install failed even after uninstall"
}

mkdir -p "$OUT/screens"

# ---- 4. launch the DEFAULT seat (NO extras — the product boot) ------------------
say "4/6 launch (no extras — the release boot)"
adbsh shell am force-stop $PKG >/dev/null 2>&1 || true
stop_deadline=$(( $(date +%s) + 30 ))
while [ -n "$(adbsh shell pidof $PKG 2>/dev/null | tr -d '[:space:]')" ]; do
    [ "$(date +%s)" -ge "$stop_deadline" ] && die "force-stop left $PKG resident"
    adbsh shell am force-stop $PKG >/dev/null 2>&1 || true
    sleep 1
done
adbsh logcat -c
launch_deadline=$(( $(date +%s) + 60 ))
until adbsh shell am start -n $PKG/.MainActivity >/dev/null 2>&1; do
    [ "$(date +%s)" -ge "$launch_deadline" ] && die "am start kept failing within 60s"
    sleep 2
done

# The origin line (rule 8: poll the condition, never a clock): SessionServe
# logs `dsh.serve: origin token=… port=…` once the carrier listens AND the
# boot gates passed — the spine's settings probes done. Measured: 30-55s on
# a cold seat. Deadline 180s.
DUMP="$OUT/.origin-dump.txt"
: > "$DUMP"
origin_deadline=$(( $(date +%s) + 180 ))
until adbsh logcat -d -s dsh.serve > "$DUMP" 2>/dev/null && grep -q "origin token=" "$DUMP"; do
    [ "$(date +%s)" -ge "$origin_deadline" ] && {
        tail -20 "$DUMP"
        die "no dsh.serve origin line within 180s of am start (the spine never came up?)"
    }
    sleep 2
done
PORT=$(grep -o 'origin token=[a-f0-9]* port=[0-9]*' "$DUMP" | tail -1 | grep -o 'port=[0-9]*' | cut -d= -f2)
TOKEN=$(grep -o 'origin token=[a-f0-9]*' "$DUMP" | tail -1 | cut -d= -f2)
[ -n "$PORT" ] && [ -n "$TOKEN" ] || die "origin line present but PORT/TOKEN harvest failed"
adbsh forward tcp:$PORT tcp:$PORT >/dev/null || die "adb forward tcp:$PORT failed"
say "origin up: port $PORT"
shot 01-origin

# ---- 5. the state-seam assertion -------------------------------------------------
# The runtime claims its endpoints over the bus seam during boot; a healthy
# product seat answers /api/state with 70+ claimedEndpoints rows and a
# non-empty app block. Poll until the claims land (deadline 90s).
say "5/6 /api/state assertion (polling claimedEndpoints, deadline 90s)"
state_deadline=$(( $(date +%s) + 90 ))
claimed=0
app_ok=0
while :; do
    curl -s --max-time 5 -H "Cookie: dsh.session=$TOKEN" \
        "http://127.0.0.1:$PORT/api/state" > "$OUT/state-snapshot.json" || true
    read -r claimed app_ok <<EOF
$(node -e '
    let raw = "";
    process.stdin.on("data", (c) => { raw += c; });
    process.stdin.on("end", () => {
        try {
            const s = JSON.parse(raw);
            const n = Array.isArray(s?.claimedEndpoints) ? s.claimedEndpoints.length : 0;
            const app = s?.app !== null && typeof s?.app === "object" ? Object.keys(s.app).length : 0;
            console.log(n, app > 0 ? 1 : 0);
        } catch { console.log("0 0"); }
    });
' < "$OUT/state-snapshot.json")
EOF
    [ "$claimed" -gt 0 ] && [ "$app_ok" = "1" ] && break
    [ "$(date +%s)" -ge "$state_deadline" ] && {
        cat "$OUT/state-snapshot.json"
        die "/api/state never answered claimedEndpoints>0 with an app block within 90s"
    }
    sleep 2
done
say "state seam: claimedEndpoints=$claimed, app block present"
shot 02-state

# ---- 6. receipt -------------------------------------------------------------------
say "6/6 receipt"
adbsh logcat -d -s dsh.serve dsh.snapshot > "$OUT/logs.txt" 2>/dev/null || true
UDID="$(adbsh get-serialno | tr -d '\r')"
TREE_LINE="origin/main $(git rev-parse --short=12 HEAD)$(git diff-index --quiet HEAD -- || echo ' (dirty working tree at receipt time)')"
cat > "$OUT/receipt.json" <<EOF
{
  "host": "android",
  "udid": "$UDID",
  "runner": "hosts/android/ci/run-release-seat.sh",
  "phase": "release.seat",
  "launch": "emulator, NO extras (release boot -> SessionServe), release APK signed with the debug keystore",
  "tree": "$TREE_LINE",
  "engine": "$(sed -n 's/^PIN=//p' external/ensure.sh)",
  "stateSeam": {
    "snapshot": "$OUT/state-snapshot.json",
    "claimedEndpoints": $claimed,
    "appBlockPresent": true,
    "asserted": true
  },
  "screens": ["screens/01-origin.png", "screens/02-state.png"],
  "producedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
say "receipt written — release seat green: $claimed claimed endpoints ($OUT)"
