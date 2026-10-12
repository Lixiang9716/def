#!/bin/sh
# run-calendar-live.sh — the calendar live leg on the Android emulator (the
# gaps3/android-04 port of the iOS `-dsh-mode calendar-live` seat): ONE REAL
# model turn driven on the agent (scenario `create.calendar.live`) — the
# model authors a calendar plugin through plugin_create — then the LIVE
# MOUNT (native approval, the scripted seam answers → registry row →
# dynamic import → ctx.plugin) and the plugin's own apply() drives the
# native card face.
#
# Credential resolution, in order — THE KEY IS NEVER PRINTED, NEVER
# COMMITTED, and a key-leak re-check runs over the captured log at the end:
#   1. DSH_CRED_FILE — a JSON file {baseUrl, apiKey, model, provider?};
#   2. the installed container's files/profiles/default/llm/config.json
#      (the release seat's own credential file; read via run-as — the debug
#      build installed by step 1 is debuggable, so no adb root flip on the
#      shared emulator);
#   3. the repo-root .env (the run-live-llm.sh convention: ZAI_* or
#      DSH_LLM_* pairs).
# NO credential source → the leg ships an HONEST BLOCKED: a receipt whose
# verdict is "blocked", a message naming what was looked for, exit 0.
# The staged container credential is REMOVED again on every exit path: left
# behind it would (a) let a later credential-less run silently inherit it
# through resolution source 2 and run a REAL turn where the honest blocked
# verdict was expected, and (b) leave the key in plaintext in a debuggable
# container on a shared emulator.
#
# Every wait is a polled condition with a deadline (rules.md rule 8); every
# exhaustion is loud (rule 5). A FAILING run moves its evidence dir aside
# (OUT.failed.<ts>) instead of leaving it to be overwritten by the next
# green run — a red checker's logs must stay examinable.
#
# usage: run-calendar-live.sh [--skip-build]   (env: DSH_ANDROID_SERIAL,
#        DSH_CRED_FILE, DSH_CALENDAR_OUT)
set -eu

ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
cd "$ROOT" || exit 1
PKG=com.dshmobile.host
APK=hosts/android/app/build/outputs/apk/debug/app-debug.apk
OUT="${DSH_CALENDAR_OUT:-hosts/android/artifacts/calendar-live}"
SERIAL="${DSH_ANDROID_SERIAL:-}"
SKIP_BUILD=0
[ "${1:-}" = "--skip-build" ] && SKIP_BUILD=1

say() { echo "run-calendar-live: $*"; }
die() { echo "::error::run-calendar-live: $*" >&2; exit 1; }
adbsh() { if [ -n "$SERIAL" ]; then adb -s "$SERIAL" "$@"; else adb "$@"; fi; }

# The evidence dir is per-run overwrite-style; a failing run preserves its
# own evidence under a timestamped sibling instead of abandoning it to the
# next run's overwrite (the unattributable checker-red of the review round
# is exactly what this prevents).
preserve_failed_evidence() {
    FAILED_DIR="$OUT.failed.$(date -u +%Y%m%dT%H%M%SZ)"
    if mv "$OUT" "$FAILED_DIR" 2>/dev/null; then
        say "failing evidence preserved at $FAILED_DIR (the next run starts a fresh $OUT)"
    fi
}

# validate_cred: reads JSON on stdin; prints "OK" when it names a usable
# route ({baseUrl: https, apiKey, model}), nothing otherwise. NEVER echoes
# the key — only the baseUrl/model reach stdout.
validate_cred() {
    node -e '
        let raw = "";
        process.stdin.on("data", (c) => { raw += c; });
        process.stdin.on("end", () => {
            try {
                const c = JSON.parse(raw);
                if (typeof c.baseUrl === "string" && c.baseUrl.startsWith("https://")
                    && typeof c.apiKey === "string" && c.apiKey.length > 0
                    && typeof c.model === "string" && c.model.length > 0) {
                    console.log("OK");
                    return;
                }
            } catch { /* malformed */ }
        });
    '
}

# ---- 1. build + install (debug: the drive seat AND the run-as grant) ---------
if [ "$SKIP_BUILD" = "0" ]; then
    say "1/6 assembleDebug"
    ( cd hosts/android && ./gradlew assembleDebug --console=plain -q >/dev/null ) \
        || die "gradle assembleDebug failed"
else
    say "1/6 build skipped"
fi
[ -f "$APK" ] || die "APK missing at $APK (build first)"
adbsh wait-for-device
boot_deadline=$(( $(date +%s) + 120 ))
until adbsh shell getprop sys.boot_completed 2>/dev/null | grep -q 1; do
    [ "$(date +%s)" -ge "$boot_deadline" ] && die "emulator did not finish booting within 120s"
    sleep 2
done
adbsh install -r "$APK" >/dev/null || die "adb install failed"

rm -rf "$OUT/screens"   # each run's screenshots come from THAT run
mkdir -p "$OUT/screens"

# ---- 2. resolve the credential (never printed) -------------------------------
say "2/6 credential resolution (DSH_CRED_FILE → container → .env)"
CFG=$(mktemp "${TMPDIR:-/tmp}/dsh-cal-cred.XXXXXX")
chmod 600 "$CFG"
cleanup_cfg() { rm -f "$CFG"; }
trap cleanup_cfg EXIT INT TERM

CRED_SOURCE=""
if [ -n "${DSH_CRED_FILE:-}" ]; then
    [ -f "$DSH_CRED_FILE" ] || die "DSH_CRED_FILE set but not a file: $DSH_CRED_FILE"
    if validate_cred < "$DSH_CRED_FILE" | grep -q OK; then
        cp "$DSH_CRED_FILE" "$CFG"
        CRED_SOURCE="DSH_CRED_FILE"
        say "credential source: DSH_CRED_FILE ($(node -e 'const c=require(process.argv[1]); console.log(c.baseUrl, c.model)' "$DSH_CRED_FILE" 2>/dev/null || echo 'file'))"
    else
        die "DSH_CRED_FILE does not name a usable route ({baseUrl: https, apiKey, model})"
    fi
fi
if [ -z "$CRED_SOURCE" ]; then
    if adbsh shell "run-as $PKG cat files/profiles/default/llm/config.json 2>/dev/null" > "$CFG" \
        && validate_cred < "$CFG" | grep -q OK; then
        CRED_SOURCE="container"
        say "credential source: the installed container's llm/config.json"
    else
        : > "$CFG"
    fi
fi
if [ -z "$CRED_SOURCE" ] && [ -f .env ]; then
    # the run-live-llm.sh convention: ZAI_* first, then DSH_LLM_* — sourced
    # into this shell only, never printed
    # shellcheck disable=SC1091
    . ./.env
    B="${ZAI_BASE_URL:-${DSH_LLM_BASE_URL:-}}"
    K="${ZAI_API_KEY:-${DSH_LLM_API_KEY:-}}"
    M="${ZAI_MODEL:-${DSH_LLM_MODEL:-}}"
    if [ -n "$B" ] && [ -n "$K" ] && [ -n "$M" ]; then
        printf '{"baseUrl":"%s","apiKey":"%s","model":"%s"}\n' "$B" "$K" "$M" > "$CFG"
        if validate_cred < "$CFG" | grep -q OK; then
            CRED_SOURCE=".env"
            say "credential source: repo-root .env"
        fi
    fi
fi
if [ -z "$CRED_SOURCE" ]; then
    # HONEST BLOCKED: no credential anywhere — the leg does not fake a pass.
    say "no credential source found — shipping the blocked verdict (exit 0)"
    UDID="$(adbsh get-serialno | tr -d '\r')"
    TREE_LINE="origin/main $(git rev-parse --short=12 HEAD)$(git diff-index --quiet HEAD -- || echo ' (dirty working tree at receipt time)')"
    cat > "$OUT/receipt.json" <<EOF
{
  "host": "android",
  "udid": "$UDID",
  "runner": "hosts/android/ci/run-calendar-live.sh",
  "phase": "calendar.live",
  "verdict": "blocked",
  "reason": "no credential source found: DSH_CRED_FILE unset/absent, the installed container carries no usable files/profiles/default/llm/config.json, and no repo-root .env (ZAI_* / DSH_LLM_*) — the leg runs a REAL model turn and refuses to fake one",
  "launch": "not launched (blocked before launch)",
  "tree": "$TREE_LINE",
  "producedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
    exit 0
fi
# The key, held for the end-of-run leak re-check only — never printed.
CRED_KEY=$(node -e 'let r="";process.stdin.on("data",(c)=>{r+=c});process.stdin.on("end",()=>{try{process.stdout.write(JSON.parse(r).apiKey?? "")}catch{}})' < "$CFG")

# ---- 3. fresh workspace + stage the credential --------------------------------
# pm clear first (the FIRST-RUN workspace posture the mount chain pins — a
# previous leg's enabled registry row would boot-mount and refuse the
# mount), THEN stage (pm clear wipes the container, including any prior
# credential).
say "3/6 pm clear + stage credential into fs scope app"
adbsh shell pm clear $PKG >/dev/null 2>&1 || true
adbsh shell "run-as $PKG sh -c 'mkdir -p files/profiles/default/llm && cat > files/profiles/default/llm/config.json'" < "$CFG"
adbsh shell "run-as $PKG cat files/profiles/default/llm/config.json" | grep -q '"apiKey"' \
    || die "credential staging failed (the apiKey FIELD is not in the staged file)"
cleanup_cfg
# From here on, every exit path removes the staged credential again (see the
# header: a lingering container credential fakes the next run's resolution
# order and leaves the key plaintext in a debuggable container).
cleanup_staged_cred() {
    adbsh shell "run-as $PKG sh -c 'rm -f files/profiles/default/llm/config.json'" >/dev/null 2>&1 || true
}
trap cleanup_staged_cred EXIT INT TERM
say "credential staged into the app container (never printed; removed again at exit)"

# ---- 4. launch + bounded capture ----------------------------------------------
adbsh shell am force-stop $PKG >/dev/null 2>&1 || true
stop_deadline=$(( $(date +%s) + 30 ))
while [ -n "$(adbsh shell pidof $PKG 2>/dev/null | tr -d '[:space:]')" ]; do
    [ "$(date +%s)" -ge "$stop_deadline" ] && die "force-stop left $PKG resident"
    adbsh shell am force-stop $PKG >/dev/null 2>&1 || true
    sleep 1
done
adbsh logcat -c
launch_deadline=$(( $(date +%s) + 60 ))
until adbsh shell am start -n $PKG/.MainActivity --ez dsh.calendarlive true \
        --es dsh.script.approval approve >/dev/null 2>&1; do
    [ "$(date +%s)" -ge "$launch_deadline" ] && die "am start kept failing within 60s"
    sleep 2
done
say "4/6 launched (--ez dsh.calendarlive true --es dsh.script.approval approve) — real turn in flight"

# The turn-scale budget mirrors the drive's own watchdog (480s): poll the
# device log for the completion tag, screenshot the mounted card on the way.
DUMP="$OUT/.cal-dump.txt"
: > "$DUMP"
result_deadline=$(( $(date +%s) + 480 ))
until adbsh logcat -d -s dsh.runtime dsh.runtime.result dsh.runtime.ui > "$DUMP" 2>/dev/null \
        && grep -q "dsh.runtime.result: ALL" "$DUMP"; do
    [ "$(date +%s)" -ge "$result_deadline" ] && {
        tail -40 "$DUMP"
        preserve_failed_evidence
        die "create.calendar.live did not complete within 480s"
    }
    if [ -f "$OUT/screens/01-card.png" ]; then :; else
        if grep -q "calendar/mounted" "$DUMP" 2>/dev/null; then
            sleep 1
            adbsh shell screencap -p /sdcard/dsh-shot.png >/dev/null 2>&1 \
                && adbsh pull /sdcard/dsh-shot.png "$OUT/screens/01-card.png" >/dev/null 2>&1 || true
        fi
    fi
    sleep 2
done
sleep 1
[ -f "$OUT/screens/01-card.png" ] || {
    adbsh shell screencap -p /sdcard/dsh-shot.png >/dev/null 2>&1 \
        && adbsh pull /sdcard/dsh-shot.png "$OUT/screens/01-card.png" >/dev/null 2>&1 || true
}

# ---- 5. the key-leak re-check + checker ----------------------------------------
say "5/6 key-leak re-check + checker"
cp "$DUMP" "$OUT/logs.txt"
grep 'dsh.runtime.log:' "$OUT/logs.txt" > "$OUT/scenario.jsonl" || true
if [ -n "$CRED_KEY" ] && grep -qF "$CRED_KEY" "$OUT/logs.txt" "$OUT/receipt.json" 2>/dev/null; then
    preserve_failed_evidence
    die "THE API KEY APPEARED IN THE CAPTURED LOG"
fi
say "key-leak re-check clean (the captured log carries no API key)"

FAIL=0
node test/e2e/check.mjs --manifest test/e2e/scenarios/create-calendar-live.json \
    --log "$OUT/logs.txt" --out "$OUT/verdict-create-calendar-live.json" || FAIL=1
cat "$OUT/verdict-create-calendar-live.json"
[ "$FAIL" = "0" ] || {
    preserve_failed_evidence
    die "checker red — failing evidence preserved under $OUT.failed.* (unreceipted)"
}

cp "$DUMP" "$OUT/logs.txt"
UDID="$(adbsh get-serialno | tr -d '\r')"
TREE_LINE="origin/main $(git rev-parse --short=12 HEAD)$(git diff-index --quiet HEAD -- || echo ' (dirty working tree at receipt time)')"
cat > "$OUT/receipt.json" <<EOF
{
  "host": "android",
  "udid": "$UDID",
  "runner": "hosts/android/ci/run-calendar-live.sh",
  "phase": "calendar.live",
  "verdict": "pass",
  "credentialSource": "$CRED_SOURCE",
  "launch": "emulator, --ez dsh.calendarlive true + --es dsh.script.approval approve (Debug, real model turn)",
  "tree": "$TREE_LINE",
  "engine": "$(sed -n 's/^PIN=//p' external/ensure.sh)",
  "scenarios": [
    { "manifest": "create-calendar-live", "verdict": "verdict-create-calendar-live.json", "pass": true }
  ],
  "screens": ["screens/01-card.png"],
  "producedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
say "receipt written — calendar.live green (real turn + live mount) — $OUT"
