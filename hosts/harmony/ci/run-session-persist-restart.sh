#!/bin/sh
# hosts/harmony/ci/run-session-persist-restart.sh — the session-persistence
# RESTART leg on the HarmonyOS emulator (scenario
# `harmony.session-persist.restart`, ONE leg value
# `--ps dsh.e2e.leg session-persist.restart` per launch): the interactive
# carrier boots the gated spine through the restart entry (OfficialServe's
# entry override), ONE scripted turn per process, and the RUNNER owns the
# process boundary —
#
#   launch 1 (create leg):  the configured session creates, the turn
#     journals it, the backend flush makes it durable; the C host logs
#     `dsh.runtime.verdict: harmony.session-persist.restart ... PASS`.
#   force kill:             `aa force-stop` + pidof-empty verification (a
#     silently-failed stop leaves the app resident — the restart would be a
#     same-process no-op).
#   launch 2 (resume leg):  the SAME want relaunches over the SAME sandbox
#     (`bm clean` is setup-ONLY — it would wipe the journal under test):
#     the boot RESTORES the stored session, session/list carries it, turn 2
#     continues the journal across the restart.
#
# Judgment reads the PULLED capture file only (never the hilog stream — the
# run-host-e2e truncation lesson); the hilog stream carries only the verdict
# markers the waits key on. Checker:
# test/e2e/scenarios/harmony-session-persist-restart.json, one-to-one in
# order. Evidence: hosts/harmony/artifacts/session-persist-restart/.
#
# usage: run-session-persist-restart.sh   (env: DSH_CLT overrides the
#        toolchain root, DSH_SKIP_BUILD=1 skips the hvigor build)
set -eu
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
cd "$ROOT"
CLT=${DSH_CLT:-/opt/homebrew/share/harmonyos-commandlinetools/command-line-tools}
HDC="$CLT/sdk/default/openharmony/toolchains/hdc"
[ -x "$HDC" ] || HDC=$(find "$CLT" -name hdc -type f | head -1)
HAP=hosts/harmony/entry/build/default/outputs/default/entry-default-unsigned.hap
BUNDLE=com.dshmobile.host
BASE=/data/app/el2/100/base/$BUNDLE/haps/entry/cache
OUT=hosts/harmony/artifacts/session-persist-restart
VERDICT='dsh.runtime.verdict: harmony.session-persist.restart'
mkdir -p "$OUT/screens"

say() { echo "run-session-persist-restart: $*"; }

if [ "${DSH_SKIP_BUILD:-0}" != "1" ]; then
    say "staging the closure (the restart entries ride the CLOSURE list) + building the HAP"
    hosts/harmony/ci/vendor-official.sh
    (cd hosts/harmony && "$CLT/bin/hvigorw" assembleHap --mode module \
        -p product=default -p buildMode=debug --no-daemon > /tmp/dsh-spr-build.log 2>&1) \
        || { echo "::error::hvigorw build failed — see /tmp/dsh-spr-build.log"; exit 1; }
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

# The setup wipe must be TOTAL and BEFORE the install: the journal under
# test lives in the app sandbox, and `bm clean -d` proved NOT to clear it
# (measured 2026-10-11 — a post-clean launch resumed a 12-event journal).
# Uninstall removes the app AND its sandbox; the install below re-stages
# fresh. Never between the legs.
"$HDC" -t "$TARGET" uninstall $BUNDLE >/dev/null 2>&1 || true
"$HDC" -t "$TARGET" install -r "$HAP" >/dev/null 2>&1 \
    || { echo "::error::hdc install failed" >&2; exit 1; }

# ---- setup: ONE clean sandbox, then never between the legs -------------------
say "setup (uninstall — the ONE total wipe; the journal must survive everything after this)"
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
        || echo "::warning::hilog -Q $knob failed — the verdict stream may drop" >&2
done

STREAM=/tmp/dsh-spr-hilog.txt
: > "$STREAM"
"$HDC" -t "$TARGET" shell hilog > "$STREAM" 2>/dev/null &
streamer=$!
trap 'kill "$streamer" 2>/dev/null || true' EXIT INT TERM
attach_deadline=$(( $(date +%s) + 60 ))
until [ -s "$STREAM" ]; do
    [ "$(date +%s)" -ge "$attach_deadline" ] && { echo "::error::hilog streamer never attached" >&2; exit 1; }
    sleep 0.2
done

launch() {
    until [ -n "$("$HDC" -t "$TARGET" shell pidof $BUNDLE 2>/dev/null | tr -d '[:space:]')" ]; do
        [ "$(date +%s)" -ge "$1" ] && { echo "::error::$BUNDLE never appeared" >&2; exit 1; }
        "$HDC" -t "$TARGET" shell power-shell wakeup >/dev/null 2>&1 || true
        "$HDC" -t "$TARGET" shell uinput -T -m 400 1600 400 400 300 >/dev/null 2>&1 || true
        "$HDC" -t "$TARGET" shell aa start -b $BUNDLE -a EntryAbility \
            --ps dsh.e2e.leg session-persist.restart >/dev/null 2>&1 || true
        sleep 3
    done
}

force_stop() {
    "$HDC" -t "$TARGET" shell aa force-stop $BUNDLE >/dev/null 2>&1 || true
    stop_deadline=$(( $(date +%s) + 30 ))
    while [ -n "$("$HDC" -t "$TARGET" shell pidof $BUNDLE 2>/dev/null | tr -d '[:space:]')" ]; do
        [ "$(date +%s)" -ge "$stop_deadline" ] && { echo "::error::force-stop left $BUNDLE resident" >&2; exit 1; }
        "$HDC" -t "$TARGET" shell aa force-stop $BUNDLE >/dev/null 2>&1 || true
        sleep 1
    done
}

# ---- launch 1: the create leg, then THE KILL ---------------------------------
say "launch 1 (create leg) — waiting for the durable-journal verdict"
launch $(( $(date +%s) + 120 ))
deadline=$(( $(date +%s) + 300 ))
until grep -q "${VERDICT}.*PASS" "$STREAM"; do
    [ "$(date +%s)" -ge "$deadline" ] && {
        grep "dsh\." "$STREAM" | tail -40 >&2 || true
        echo "::error::create leg did not settle within 300s" >&2
        exit 1
    }
    sleep 1
done
say "   create leg green — force-stopping the process (the restart under test)"
force_stop
# Lift launch 1's capture BEFORE launch 2 opens a fresh one (the C host
# truncates per launch — measured 2026-10-11).
rm -f "$OUT/launch1-capture.txt"
"$HDC" -t "$TARGET" file recv "$BASE/dsh-persist-restart-capture.log" \
    "$OUT/launch1-capture.txt" >/dev/null 2>&1 \
    || { echo "::error::launch-1 capture pull failed" >&2; exit 1; }
[ -s "$OUT/launch1-capture.txt" ] || { echo "::error::launch-1 capture pull is empty" >&2; exit 1; }

# ---- launch 2: the resume leg -------------------------------------------------
say "launch 2 (resume leg) — waiting for the cross-restart continuation"
launch $(( $(date +%s) + 120 ))
deadline=$(( $(date +%s) + 300 ))
until [ "$(grep -c "${VERDICT}.*PASS" "$STREAM")" -ge 2 ]; do
    [ "$(date +%s)" -ge "$deadline" ] && {
        grep "dsh\." "$STREAM" | tail -40 >&2 || true
        echo "::error::resume leg did not settle within 300s" >&2
        exit 1
    }
    sleep 1
done
sleep 1

kill "$streamer" 2>/dev/null || true
wait "$streamer" 2>/dev/null || true
trap - EXIT INT TERM

# ---- capture pull + checkers ---------------------------------------------------
# pull_capture discipline (run-host-e2e): rm first, recv, then VERIFY non-empty
# (hdc file recv exits 0 even when the transfer fails).
# ONE continuous evidence stream across both launches: the C host opens the
# capture file fresh per launch (measured 2026-10-11 — a post-launch-2 pull
# held only the resume leg), so launch 1's capture was already lifted right
# after its force stop; this second pull merges with it, then both go to
# the trash.
"$HDC" -t "$TARGET" file recv "$BASE/dsh-persist-restart-capture.log" \
    "$OUT/launch2-capture.txt" >/dev/null 2>&1 \
    || { echo "::error::capture pull failed — $BASE/dsh-persist-restart-capture.log" >&2; exit 1; }
[ -s "$OUT/launch2-capture.txt" ] || { echo "::error::capture pull is empty (transfer failed silently)" >&2; exit 1; }
# logs.txt — the matrix's DELIVERABLES name (test/e2e/matrix.mjs), the
# same name every sibling artifact dir carries (iOS/Android restart legs,
# d9-session-live). The capture IS the logs for this leg.
CAP="$OUT/logs.txt"
cat "$OUT/launch1-capture.txt" "$OUT/launch2-capture.txt" > "$CAP"
rm -f "$OUT/launch1-capture.txt" "$OUT/launch2-capture.txt"
grep -h '^dsh.runtime.log:' "$CAP" > "$OUT/scenario.jsonl" || true
rm -f "$OUT/verdict-harmony-session-persist-restart.json"

FAIL=0
node test/e2e/check.mjs --manifest test/e2e/scenarios/harmony-session-persist-restart.json \
    --log "$CAP" \
    --out "$OUT/verdict-harmony-session-persist-restart.json" || FAIL=1
if [ "$FAIL" != "0" ]; then
    echo "::error::harmony-session-persist-restart checker failed" >&2
    exit 1
fi

HTARGET=$("$HDC" -t "$TARGET" shell param get const.product.name 2>/dev/null | tr -d '\r' || echo dsh_phone)
HVER=$("$HDC" -t "$TARGET" shell param get const.ohos.apiversion 2>/dev/null | tr -d '\r' || echo '?')
TREE_LINE="origin/main $(git rev-parse --short=12 HEAD)$(git diff-index --quiet HEAD -- || echo ' (dirty working tree at receipt time)')"
cat > "$OUT/receipt.json" <<EOF
{
  "host": "harmony",
  "udid": "$TARGET ($HTARGET, HarmonyOS API $HVER)",
  "runner": "hosts/harmony/ci/run-session-persist-restart.sh",
  "phase": "session-persist.restart",
  "launch": "$HTARGET emulator, --ps dsh.e2e.leg session-persist.restart x2 (create leg, aa force-stop, resume leg on the same sandbox)",
  "tree": "$TREE_LINE",
  "engine": "$(sed -n 's/^PIN=//p' runtime/dsh/vendor/ensure.sh)",
  "scenarios": [
    { "manifest": "harmony-session-persist-restart", "verdict": "verdict-harmony-session-persist-restart.json", "pass": true }
  ],
  "producedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
say "PASS — session-persist.restart green ($OUT)"
