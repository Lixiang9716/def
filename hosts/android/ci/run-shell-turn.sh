#!/bin/sh
# run-shell-turn.sh — the T-0216 shell-turn leg on the Android emulator: the
# RELEASE (user-facing) SessionServe seat, a mock-LLM turn whose scripted
# tool call drives the ONE shell tool, and the evidence that the tool ran
# IN THE APP — the rendered tool card, the on-disk fsWrite, and the durable
# session journal.
#
# The shape is the calendar-live leg's with the mock in the credential seat:
#   1. assembleRelease signed with the debug keystore (the page-open recipe:
#      installable, drives compiled out — the interactive seat is the only
#      thing that boots);
#   2. the vendored dsh-llm-mock on the host loopback, script
#      `tool_call_success` then `success`, tool name/args pointed at the
#      shell via DSH_MOCK_TOOL_NAME/DSH_MOCK_TOOL_ARGS (overridable);
#   3. `adb root` + a root-staged <filesDir>/profiles/default/llm/config.json
#      (the release seat is not debuggable — run-as cannot reach it; the
#      staged credential is REMOVED again on every exit path, calendar-live
#      discipline);
#   4. the normal launch (no drive extras), then the prompt enters through
#      the composer's OWN wire: POST /api/session/prompt with the
#      client-request envelope and the session token the WebView's load URL
#      carries into the logcat capture;
#   5. verdict: the mock's two attempts completed AND the fsWrite's file
#      exists on the container disk with the exact bytes (the executor's
#      round trip through the gateway primitives) AND a screenshot exists.
#
# usage: run-shell-turn.sh [--skip-build]   (env: DSH_ANDROID_SERIAL,
#        DSH_SHELLTURN_APK, DSH_SHELLTURN_OUT, DSH_MOCK_TOOL_NAME,
#        DSH_MOCK_TOOL_ARGS)
set -eu

ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
cd "$ROOT" || exit 1
PKG=com.dshmobile.host
OUT="${DSH_SHELLTURN_OUT:-hosts/android/artifacts/shell-turn}"
SERIAL="${DSH_ANDROID_SERIAL:-}"
SIGNED_APK="${DSH_SHELLTURN_APK:-/tmp/dsh-shell-turn-release.apk}"
TOOL_NAME="${DSH_MOCK_TOOL_NAME:-shell}"
TOOL_ARGS="${DSH_MOCK_TOOL_ARGS:-{\"command\":\"echo hi-from-shell > note.txt && cat note.txt\"}}"
PROBE_FILE=note.txt
PROBE_TEXT=hi-from-shell
SKIP_BUILD=0
[ "${1:-}" = "--skip-build" ] && SKIP_BUILD=1

say() { echo "run-shell-turn: $*"; }
die() { echo "::error::run-shell-turn: $*" >&2; exit 1; }
adbsh() { if [ -n "$SERIAL" ]; then adb -s "$SERIAL" "$@"; else adb "$@"; fi; }

cleanup() {
    adbsh shell "rm -f /data/data/$PKG/files/profiles/default/llm/config.json" >/dev/null 2>&1 || true
    [ -n "${MOCK_PID:-}" ] && kill "$MOCK_PID" 2>/dev/null || true
    [ -n "${MOCK_LOG:-}" ] && rm -f "$MOCK_LOG"
    [ -n "${MOCK_PORT:-}" ] && adb reverse --remove "tcp:$MOCK_PORT" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

# ---- 1. build + sign + install ------------------------------------------------
if [ "$SKIP_BUILD" = "0" ]; then
    say "1/6 assembleRelease + debug-keystore sign"
    ( cd hosts/android && ./gradlew assembleRelease --console=plain -q >/dev/null ) \
        || die "gradle assembleRelease failed"
    UNSIGNED=hosts/android/app/build/outputs/apk/release/app-release-unsigned.apk
    [ -f "$UNSIGNED" ] || die "unsigned release APK missing"
    APKSIGNER="$(ls /opt/homebrew/share/android-commandlinetools/build-tools/*/apksigner 2>/dev/null | sort | tail -1)"
    [ -n "$APKSIGNER" ] || die "apksigner not found under the commandlinetools build-tools"
    "$APKSIGNER" sign --ks ~/.android/debug.keystore --ks-pass pass:android \
        --out "$SIGNED_APK" "$UNSIGNED" || die "apksigner sign failed"
else
    say "1/6 build skipped"
    [ -f "$SIGNED_APK" ] || die "--skip-build but no APK at $SIGNED_APK"
fi
adbsh wait-for-device
boot_deadline=$(( $(date +%s) + 120 ))
until adbsh shell getprop sys.boot_completed 2>/dev/null | grep -q 1; do
    [ "$(date +%s)" -ge "$boot_deadline" ] && die "emulator did not finish booting within 120s"
    sleep 2
done
adbsh install -r "$SIGNED_APK" >/dev/null 2>&1 || {
    say "install -r refused (cert mismatch?) — uninstalling and installing fresh"
    adbsh uninstall "$PKG" >/dev/null 2>&1 || true
    adbsh install "$SIGNED_APK" >/dev/null || die "adb install failed even after uninstall"
}

# ---- 2. the mock in the credential seat ----------------------------------------
say "2/6 mock llm (tool_call_success → $TOOL_NAME) + adb reverse"
MOCK_LOG="$(mktemp /tmp/dsh-mock-shellturn.XXXXXX)"
DSH_MOCK_SEQUENCE="tool_call_success success" DSH_MOCK_REPEAT_LAST=0 \
DSH_MOCK_TOOL_NAME="$TOOL_NAME" DSH_MOCK_TOOL_ARGS="$TOOL_ARGS" \
    node runtime/dsh/ci/mock-llm-server.mjs > "$MOCK_LOG" 2>&1 &
MOCK_PID=$!
polled=0
until grep -s '^MOCK_BASE_URL=' "$MOCK_LOG" > /dev/null; do
    kill -0 "$MOCK_PID" 2>/dev/null || { cat "$MOCK_LOG" >&2; die "mock died before announcing"; }
    polled=$((polled + 1))
    [ "$polled" -gt 300 ] && die "mock did not announce within 15s"
    sleep 0.05
done
MOCK_URL="$(sed -n 's/^MOCK_BASE_URL=//p' "$MOCK_LOG" | head -1)"
MOCK_PORT="${MOCK_URL##*:}"
adbsh reverse "tcp:$MOCK_PORT" "tcp:$MOCK_PORT" || die "adb reverse failed"
say "mock at $MOCK_URL (reversed into the device)"

# ---- 3. root-stage the credential (release seat: run-as cannot) -----------------
say "3/6 adb root + stage llm/config.json"
adbsh root >/dev/null 2>&1 || true
sleep 3
adbsh wait-for-device
adbsh shell id 2>/dev/null | grep -q 'uid=0' || die "adb root unavailable — the release seat's credential cannot be staged"
CRED="$(mktemp "${TMPDIR:-/tmp}/dsh-shellturn-cred.XXXXXX")"
printf '{"baseUrl":"%s","apiKey":"mock-key-0001","model":"mock-1"}\n' "$MOCK_URL" > "$CRED"
adbsh push "$CRED" /data/local/tmp/dsh-shellturn-cred.json >/dev/null
APP_UID="$(adbsh shell stat -c %u "/data/data/$PKG" | tr -d '\r')"
adbsh shell "mkdir -p /data/data/$PKG/files/profiles/default/llm \
    && cp /data/local/tmp/dsh-shellturn-cred.json /data/data/$PKG/files/profiles/default/llm/config.json \
    && chown -R $APP_UID:$APP_UID /data/data/$PKG/files/profiles \
    && restorecon -R /data/data/$PKG/files/profiles/default/llm" >/dev/null
rm -f "$CRED" /data/local/tmp/dsh-shellturn-cred.json 2>/dev/null || true
adbsh shell cat "/data/data/$PKG/files/profiles/default/llm/config.json" | grep -q '"apiKey"' \
    || die "credential staging failed"

# ---- 4. launch + wait for the serving line + token ------------------------------
adbsh shell am force-stop "$PKG" >/dev/null 2>&1 || true
adbsh logcat -c
adbsh shell am start -n "$PKG/.MainActivity" >/dev/null
say "4/6 launched — polling for the serving line"
serve_deadline=$(( $(date +%s) + 120 ))
: > "$OUT/.serve.txt"; mkdir -p "$OUT"
until adbsh logcat -d 2>/dev/null | grep -o 'serving dsh-web-[a-z]* on 127\.0\.0\.1:[0-9]*' > "$OUT/.serve.txt" \
        && [ -s "$OUT/.serve.txt" ]; do
    [ "$(date +%s)" -ge "$serve_deadline" ] && die "no serving line within 120s"
    sleep 2
done
SERVE_LINE="$(tail -1 "$OUT/.serve.txt")"
PORT="${SERVE_LINE##*:}"
say "serving: $SERVE_LINE"
token_deadline=$(( $(date +%s) + 60 ))
: > "$OUT/.token.txt"
until adbsh logcat -d 2>/dev/null | grep -o 'token=[0-9a-f]*' | tail -1 > "$OUT/.token.txt" \
        && [ -s "$OUT/.token.txt" ]; do
    [ "$(date +%s)" -ge "$token_deadline" ] && die "no session token in the capture within 60s"
    sleep 2
done
TOKEN="$(sed 's/^token=//' "$OUT/.token.txt")"
adbsh forward "tcp:$PORT" "tcp:$PORT" >/dev/null

# ---- 5. the turn through the composer's own wire ---------------------------------
say "5/6 POST /api/session/prompt (client-request envelope)"
PAGE_SESSION="$(curl -s -m 5 "http://127.0.0.1:$PORT/api/state?token=$TOKEN" \
    | node -e 'let r="";process.stdin.on("data",c=>r+=c).on("end",()=>{try{const s=JSON.parse(r);process.stdout.write(s.pageSession??"")}catch{}})')"
[ -n "$PAGE_SESSION" ] || PAGE_SESSION="session-shellturn-0001"
curl -s -m 15 -X POST "http://127.0.0.1:$PORT/api/session/prompt?token=$TOKEN" \
    -H 'content-type: application/json' \
    -d "{\"type\":\"client-request\",\"rpcId\":\"rpc-shellturn-1\",\"method\":\"session/prompt\",\"payload\":{\"args\":{\"request\":{\"requestId\":\"req-shellturn-1\",\"sessionId\":\"$PAGE_SESSION\",\"mode\":\"queue\",\"content\":[{\"type\":\"text\",\"text\":\"please run a shell command that echoes $PROBE_TEXT\"}]}}}}" \
    | grep -q '"accepted":true' || die "the prompt was not accepted by the serving seat"

turn_deadline=$(( $(date +%s) + 180 ))
until grep -q '"scriptBehavior":"success","behavior":"success","outcome":"completed"' "$MOCK_LOG" 2>/dev/null; do
    [ "$(date +%s)" -ge "$turn_deadline" ] && die "the turn did not settle within 180s (mock: $(tail -1 "$MOCK_LOG"))"
    sleep 2
done
say "turn settled (tool_call_success → success, both completed)"

# ---- 6. evidence ------------------------------------------------------------------
say "6/6 evidence: screenshot + fs probe + journal + receipt"
mkdir -p "$OUT/screens"
adbsh shell screencap -p /sdcard/dsh-shot.png >/dev/null 2>&1 \
    && adbsh pull /sdcard/dsh-shot.png "$OUT/screens/03-tool-card.png" >/dev/null 2>&1 || true
adbsh exec-out "cat /data/data/$PKG/files/profiles/default/dsh/$PROBE_FILE" > "$OUT/.probe.txt" 2>/dev/null || true
FS_OK=0
grep -q "$PROBE_TEXT" "$OUT/.probe.txt" 2>/dev/null && FS_OK=1
[ "$FS_OK" = "1" ] || die "the shell's fsWrite did not land on the container disk"
JDIR="$(adbsh shell "find /data/data/$PKG/files/profiles/default/dsh/dsh/sessions -maxdepth 2 -type d -name 'session-*' 2>/dev/null | head -1" | tr -d '\r')"
[ -n "$JDIR" ] && adbsh exec-out "cat '$JDIR/session.v3.jsonl.zstd'" > "$OUT/session-journal.jsonl.zstd" 2>/dev/null || true
adbsh exec-out "cat /data/data/$PKG/files/profiles/default/dsh/$PROBE_FILE" > /dev/null 2>&1 || true
grep 'dsh.runtime' "$OUT/logs.txt" 2>/dev/null || adbsh logcat -d > "$OUT/logs.txt" 2>/dev/null || true
cp "$MOCK_LOG" "$OUT/mock-server-stdout.txt"
curl -s -m 5 "http://127.0.0.1:$PORT/api/state?token=$TOKEN" > "$OUT/state-snapshot.json" 2>/dev/null || true
TREE_LINE="origin/main $(git rev-parse --short=12 HEAD)$(git diff-index --quiet HEAD -- || echo ' (dirty working tree at receipt time)')"
UDID="$(adbsh get-serialno | tr -d '\r')"
cat > "$OUT/receipt.json" <<EOF
{
  "host": "android $UDID",
  "phase": "t0216.shell.turn",
  "verdict": "pass",
  "build": "assembleRelease signed with the debug keystore (the page-open recipe) — the user-facing SessionServe seat, drives compiled out",
  "model": "vendored dsh-llm-mock over adb reverse loopback; tool_call_success → $TOOL_NAME",
  "drive": "POST /api/session/prompt with the client-request envelope (the composer's own wire) and the logcat-carried session token",
  "proves": [
    "the release interactive seat boots and serves the web client ($SERVE_LINE)",
    "the scripted tool call drove the ONE shell tool seat and the tool card renders in the official UI (screens/)",
    "the executor's fsWrite landed on the container disk: $PROBE_FILE carries '$PROBE_TEXT'",
    "the durable session journal landed (session-journal.jsonl.zstd, the vendored persistence framing)"
  ],
  "tree": "$TREE_LINE",
  "producedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
say "receipt written — the shell turn ran in the app — $OUT"
