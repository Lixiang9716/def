#!/usr/bin/env bash
# test/e2e/run-ios-card-player.sh — the card.player E2E evidence leg (T-0212).
#
# Drives DSHHost in -dsh-mode card-player (Debug harness build — Release or
# any -dsh-serve argv hits the bootRelease fatalError) on an iOS simulator,
# waits for the scenario's verdict line in the captured stdout, shots the
# three evidence faces, and hands the captured log to check.mjs against
# scenarios/card-player.json (11 pinned events, NO client.selected — the iOS
# card-player seat is SessionServe+WebBootRuntimeDrive, which emits no E2E
# record of its own; card-player-android.json's extra client.selected pin is
# the Android seat's shape, not ours).
#
# Sibling interface of run-ios-device-plane.sh: [--udid U] [--art-dir D]
# [--skip-build]. Self-rooting from $0 — callable as
# `sh .../run-ios-card-player.sh` from any cwd, with NO environment contract:
# node is discovered (nvm layout, then the common prefixes) because the
# checker step needs it and the caller cannot export PATH.
#
# The simulator is a SHARED resource, but no lock covered it before this
# leg: the /tmp/dsh-ios-e2e-sim.lock mkdir lock (marker file names the
# holder; 15s polling, 45 min cap, released by the EXIT trap) serializes
# concurrent card-player runs and any sibling leg that adopts the same
# path. It is an opt-in convention, not a simulator-wide mutex: the older
# runners lock per-runner under $HOME/dsh-e2e (run-ios-device-plane.sh:40,
# run-ios-mic-plane.sh:39, run-ios.sh:80) and cannot know this lock — so
# this side one-way liveness-checks THEIRS and fails loud on a live holder
# — while the live-session-family runners (live-session, live-write,
# official-web-mount, next-web-mount) carry no lock at all and remain a
# real interleave hazard; closing that needs a convention change across
# the runners, not a per-leg fix.
#
# Verdict discipline is the android/harmony siblings' verbatim: poll the log
# for `card.player.*scenario.complete|scenario.failed` (240s deadline), never
# blind sleeps. The present/complete shots are marker-driven
# (card.present.posted / card.complete.posted), checked on every iteration
# INCLUDING the terminal one, with the harmony lesson's post-loop catch-up
# for 02-card-complete (the first harmony green run produced no 02 because
# an until-poll exited between two greps) plus an unconditional 03-final.
# Screenshots are artifacts, not assertions (ARCHITECTURE.md "E2E
# verification") — the checker is the verdict.
#
# Evidence (hosts/ios/artifacts/card-player): logs.txt (the app's full
# stdout/stderr), scenario.jsonl (the dsh.runtime.log records),
# gateway-audit.jsonl, screens/{01-card-present,02-card-complete,03-final}.png,
# verdict-card-player.json, receipt.json (write-receipt.sh — reachable ONLY
# on the green path; no matrix-register call — a green leg registers by the
# artifacts dir itself being counted by the e2e-matrix gate, exactly like
# both siblings).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

UDID=""
ART="hosts/ios/artifacts/card-player"
SKIP_BUILD=0
APP_BUNDLE_ID=org.dsh.DSHHost
APP=hosts/ios/DerivedData/Build/Products/Debug-iphonesimulator/DSHHost.app
SIM_LOCK=/tmp/dsh-ios-e2e-sim.lock
while [ $# -gt 0 ]; do
  case "$1" in
    --udid) UDID="$2"; shift 2 ;;
    --art-dir) ART="$2"; shift 2 ;;
    --skip-build) SKIP_BUILD=1; shift ;;
    *) echo "usage: run-ios-card-player.sh [--udid U] [--art-dir D] [--skip-build]" >&2; exit 2 ;;
  esac
done
LOG="$ART/logs.txt"   # derived AFTER arg parsing — --art-dir must apply
mkdir -p "$ART" "$ART/screens"

log() { echo "run-ios-card-player: $*"; }
die() { echo "run-ios-card-player: FAIL: $*" >&2; exit 1; }

fail_deadline() {   # a bounded poll expired — dump the log tail, fail loud
  echo "run-ios-card-player: DEADLINE EXPIRED: $*" >&2
  echo "----- last 60 log lines ($LOG) -----" >&2
  tail -n 60 "$LOG" >&2 2>/dev/null || true
  exit 1
}

# The caller cannot export env — discover node for the checker step:
# nvm's per-version bin dirs first, then the usual prefixes.
find_node() {
  command -v node >/dev/null 2>&1 && return 0
  local candidate
  for candidate in "$HOME"/.nvm/versions/node/*/bin /opt/homebrew/bin /usr/local/bin /opt/local/bin /usr/bin; do
    if [ -x "$candidate/node" ]; then
      PATH="$candidate:$PATH"
      export PATH
      return 0
    fi
  done
  return 1
}
find_node || die "node not found (searched PATH, ~/.nvm/versions/node/*/bin, /opt/homebrew/bin, /usr/local/bin, /opt/local/bin)"

shot() { # NAME — an artifact, not an assertion: warn on failure, never die
  if xcrun simctl io "$UDID" screenshot "$ART/screens/$1.png" >/dev/null 2>&1; then
    log "screenshot screens/$1.png"
  else
    log "WARNING: screenshot screens/$1.png failed"
  fi
}

wait_first_record() { # the scenario reaches its first marker ~1s in (60s budget)
  local deadline=$((SECONDS + 60))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if grep -q '^dsh.runtime.log:' "$LOG" 2>/dev/null; then return 0; fi
    if grep -q 'rt: card-player bootstrap failed' "$LOG" 2>/dev/null; then
      die "bootstrap failed — the official dist is missing from the container (see $LOG)"
    fi
    sleep 1
  done
  fail_deadline "the runtime's first dsh.runtime.log record never appeared (60s)"
}

# One-way courtesy to the pre-existing convention: the older iOS runners
# publish per-runner locks under $HOME/dsh-e2e (device-plane, mic-plane,
# run-ios.sh) and cannot know this script's /tmp lock — so this side checks
# THEIRS. A live holder means the shared device is mid-run elsewhere: fail
# loud instead of interleaving install/launch/terminate on the same
# org.dsh.DSHHost. (They never check ours; symmetric exclusion would need
# edits to those runners, which is out of this leg's scope.)
check_sibling_locks() {
  local lockf holder
  for lockf in "$HOME"/dsh-e2e/run-ios*-"$UDID".lock; do
    if [ -f "$lockf" ]; then
      holder="$(cat "$lockf" 2>/dev/null || true)"
      case "$holder" in
        '' | *[!0-9]*) continue ;;   # absent/unparseable content is not a live holder
      esac
      if kill -0 "$holder" 2>/dev/null; then
        die "sibling runner lock $lockf held by live pid $holder — the shared simulator is mid-run (run-ios-device-plane/run-ios-mic-plane/run-ios.sh convention)"
      fi
    fi
  done
}

# ---- 1. pick the simulator: --udid, then DSH_E2E_UDID, then a booted -------
# ---- iPhone, then any available iPhone (booted in step 4) ------------------
if [ -z "$UDID" ] && [ -n "${DSH_E2E_UDID:-}" ]; then
  UDID="$DSH_E2E_UDID"
  log "1/6 simulator: DSH_E2E_UDID -> $UDID"
fi
if [ -z "$UDID" ]; then
  UDID="$(xcrun simctl list devices 2>/dev/null | grep -i 'iphone' | grep '(Booted)' \
    | sed -n 's/^.*(\([A-F0-9-]\{36\}\)) (Booted).*$/\1/p' | head -n 1 || true)"
  if [ -n "$UDID" ]; then log "1/6 simulator: reusing booted iPhone $UDID"; fi
fi
if [ -z "$UDID" ]; then
  UDID="$(xcrun simctl list devices available 2>/dev/null | grep -i 'iphone' \
    | sed -n 's/^.*(\([A-F0-9-]\{36\}\)).*$/\1/p' | head -n 1 || true)"
  if [ -n "$UDID" ]; then log "1/6 simulator: no booted iPhone — will boot available $UDID"; fi
fi
[ -n "$UDID" ] || die "no simulator — pass --udid, set DSH_E2E_UDID, or create an iPhone simulator"

# ---- 2. materialize the vendored closure (quickjs sources for gen.sh, the --
# ---- dsh packages, the official dist + client bundles for staging) ---------
log "2/6 materializing vendor + official dist + client bundles"
runtime/dsh/vendor/ensure.sh
runtime/dsh/vendor/ensure-dsh.sh >/dev/null
test/e2e/ensure-official-dist.sh
test/e2e/ensure-client-bundles.sh

# ---- 3. generate the project (App/Generated + DSHHost.xcodeproj are both ---
# ---- gitignored — absent in a fresh worktree) and build Debug --------------
if [ "$SKIP_BUILD" -eq 0 ]; then
  log "3/6 generating the Xcode project (gen.sh) + xcodebuild Debug (scheme DSHHost)"
  sh hosts/ios/gen.sh
  xcodebuild build -project hosts/ios/DSHHost.xcodeproj -scheme DSHHost \
    -destination "platform=iOS Simulator,id=$UDID" \
    -derivedDataPath hosts/ios/DerivedData -quiet 2>&1 | tail -n 30
else
  log "3/6 generation + build skipped (--skip-build)"
fi
if [ ! -d "$APP" ]; then
  die "app bundle missing: $APP (build first, or drop --skip-build)"
fi

# ---- 4. the shared-simulator lock, then boot + install + stage -------------
log "4/6 acquiring the shared-simulator lock $SIM_LOCK (15s poll, 45 min cap)"
LOCK_DEADLINE=$((SECONDS + 2700))   # 2700s = 45 min — a leg takes minutes, not hours
while ! mkdir "$SIM_LOCK" 2>/dev/null; do
  # A SIGKILLed holder (CI hard-cancel, kill -9, machine death) would strand
  # the dir and burn the whole cap — device-plane's law: test the recorded
  # pid and steal a provably dead holder's lock (pid reuse is the accepted
  # residual risk, same as run-ios-device-plane.sh:42-45). An unparseable
  # marker is NOT proof of staleness — keep polling.
  if [ -f "$SIM_LOCK/marker" ]; then
    HOLDER_PID="$(sed -n 's/.*pid=\([0-9][0-9]*\).*$/\1/p' "$SIM_LOCK/marker" 2>/dev/null || true)"
    if [ -n "$HOLDER_PID" ] && ! kill -0 "$HOLDER_PID" 2>/dev/null; then
      log "stale simulator lock — holder pid $HOLDER_PID is dead; stealing $SIM_LOCK"
      rm -rf "$SIM_LOCK"
      continue
    fi
  fi
  if [ "$SECONDS" -ge "$LOCK_DEADLINE" ]; then
    echo "run-ios-card-player: FAIL: $SIM_LOCK still held after 45 min — holder marker:" >&2
    cat "$SIM_LOCK/marker" >&2 2>/dev/null || echo "  (the lock dir carries no marker)" >&2
    exit 1
  fi
  sleep 15
done
printf 'runner=%s pid=%s udid=%s started=%s\n' \
  "$(basename "$0")" "$$" "$UDID" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$SIM_LOCK/marker"
# Released on EVERY exit path — terminate BEFORE the rm: a waiter that
# acquired the lock in the gap must never meet this script's trailing
# terminate (the serve seat stays resident after the scenario, and a dead
# runner must not leave it holding the shared device; the next launch also
# passes --terminate-running-process, so this is belt to that suspenders).
trap 'xcrun simctl terminate "$UDID" "$APP_BUNDLE_ID" 2>/dev/null || true; rm -rf "$SIM_LOCK"' EXIT
check_sibling_locks

sh hosts/ios/Tools/sim-preflight.sh "$UDID"   # runtime < 26 = dead launch (18.5 dyld lacks libswiftWebKit)
xcrun simctl bootstatus "$UDID" -b >/dev/null 2>&1 || { xcrun simctl boot "$UDID" 2>/dev/null || true; }
xcrun simctl install "$UDID" "$APP"
APP_DATA="$(xcrun simctl get_app_container "$UDID" "$APP_BUNDLE_ID" data)"
rm -rf "$APP_DATA/Documents/official-web" "$APP_DATA/Documents/web-plugins"
mkdir -p "$APP_DATA/Documents/official-web" "$APP_DATA/Documents/web-plugins/npm/@deepseek-ai"
cp -R presentation/official-web/dist "$APP_DATA/Documents/official-web/dist"
cp -R presentation/official-web/client-bundles/npm/@deepseek-ai/. \
  "$APP_DATA/Documents/web-plugins/npm/@deepseek-ai/"
# The pinned vendored tarball wins for the bootstrap package (D6 pin record;
# its lib/client.js is byte-identical to the workspace build — PROVENANCE).
rm -rf "$APP_DATA/Documents/web-plugins/npm/@deepseek-ai/dsh-client-modules@0.1.6-alpha.2"
cp -R "runtime/dsh/vendor/npm/@deepseek-ai/dsh-client-modules@0.1.6-alpha.2" \
  "$APP_DATA/Documents/web-plugins/npm/@deepseek-ai/"

# ---- 5. launch (-dsh-mode card-player) + the marker-driven drive -----------
log "5/6 launch -dsh-mode card-player (bounded retries; Debug-only seat — never -dsh-serve)"
rm -f "$LOG" "$ART/nslog-stderr.txt"
case "$LOG" in /*) LOG_ABS="$LOG" ;; *) LOG_ABS="$PWD/$LOG" ;; esac
case "$ART" in /*) NSLOG_ABS="$ART/nslog-stderr.txt" ;; *) NSLOG_ABS="$PWD/$ART/nslog-stderr.txt" ;; esac
SPRINGBOARD_DEADLINE=$((SECONDS + 120))
LAUNCHED=0
while [ "$SECONDS" -lt "$SPRINGBOARD_DEADLINE" ]; do
  : > "$LOG"   # simctl --stdout APPENDS — every retry owns a fresh log
  RC=0
  perl -e 'alarm shift; exec @ARGV' "${DSH_LAUNCH_DEADLINE:-180}" \
    xcrun simctl launch --terminate-running-process \
      --stdout="$LOG_ABS" --stderr="$NSLOG_ABS" \
      "$UDID" "$APP_BUNDLE_ID" -dsh-mode card-player >/dev/null 2>&1 || RC=$?
  if [ "$RC" -eq 0 ]; then
    COLD_DYLD_DEADLINE=$((SECONDS + 15))   # first stdout lines take >10s on a cold dyld
    while [ "$SECONDS" -lt "$COLD_DYLD_DEADLINE" ]; do
      if [ -s "$LOG" ]; then LAUNCHED=1; break; fi
      sleep 1
    done
    if [ "$LAUNCHED" -eq 1 ]; then break; fi
  fi
  sleep 3
done
if [ "$LAUNCHED" -eq 0 ]; then
  echo "run-ios-card-player: FAIL: launch failed — SpringBoard never accepted the open" >&2
  tail -n 30 "$ART/nslog-stderr.txt" >&2 2>/dev/null || true
  exit 1
fi

wait_first_record
log "driving: marker-driven shots + verdict poll (deadline 240s)"
PRESENT_SHOT=0
COMPLETE_SHOT=0
DRIVE_DEADLINE=$((SECONDS + 240))
while :; do
  # Marker-driven shots (the harmony sibling's law): the shot checks run on
  # EVERY iteration — the terminal one too — so the shots never depend on
  # where the loop happens to exit.
  if [ "$PRESENT_SHOT" -eq 0 ] && grep -q 'card.present.posted' "$LOG" 2>/dev/null; then
    PRESENT_SHOT=1
    sleep 1   # let the face settle; the card holds until dismiss, so late is truthful
    shot 01-card-present
  fi
  if [ "$COMPLETE_SHOT" -eq 0 ] && grep -q 'card.complete.posted' "$LOG" 2>/dev/null; then
    COMPLETE_SHOT=1
    sleep 1
    shot 02-card-complete
  fi
  # THE verdict line — the siblings' grep verbatim (android, harmony:106-108).
  # No terminal "drive finished" line exists on this seat: the scenario
  # completes and the seat stays resident.
  if grep -q "card.player.*scenario.complete\|scenario.failed" "$LOG" 2>/dev/null; then
    break
  fi
  if [ "$SECONDS" -ge "$DRIVE_DEADLINE" ]; then
    fail_deadline "the card.player verdict line (scenario.complete|scenario.failed) never appeared (240s)"
  fi
  sleep 1
done
# Post-loop catch-up (harmony's measured lesson — its first green run produced
# no 02 because the until-loop exited between two greps) + the unconditional
# final face.
if [ ! -f "$ART/screens/02-card-complete.png" ]; then
  sleep 1
  shot 02-card-complete
fi
shot 03-final
# Stopping the seat also flushes the app's buffered stdout into $LOG — the
# checker reads this file, so terminate BEFORE extracting the records.
xcrun simctl terminate "$UDID" "$APP_BUNDLE_ID" 2>/dev/null || true

# ---- 6. checkers + receipt (receipt reachable ONLY on the green path) ------
log "6/6 checkers"
grep '^dsh.runtime.log:' "$LOG" >"$ART/scenario.jsonl" || true
grep '^dsh.gateway.audit:' "$LOG" >"$ART/gateway-audit.jsonl" || true
rm -f "$ART/verdict-card-player.json"   # a stale verdict must never vouch for this run
if ! node test/e2e/check.mjs --manifest test/e2e/scenarios/card-player.json \
      --log "$LOG" --out "$ART/verdict-card-player.json"; then
  die "checkers red — evidence stays unreceipted (see $ART/verdict-card-player.json)"
fi
log "checker green — writing the receipt"
sh test/e2e/write-receipt.sh "$ART" "$UDID" test/e2e/run-ios-card-player.sh \
  "card.player" \
  "ios card-player drive (Debug, -dsh-mode card-player)" \
  card-player
log "PASS — card.player green; evidence in $ART"
