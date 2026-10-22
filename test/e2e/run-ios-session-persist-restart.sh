#!/usr/bin/env bash
# test/e2e/run-ios-session-persist-restart.sh — the session-persistence
# RESTART leg on the iOS simulator (session-persist.restart, the
# session-persistence family's device leg): builds DSHHost, stages the
# vendored official dist + the web-boot plugin files, and drives TWO
# launches with ONE runner-owned force kill between them —
#
#   launch 1 (-dsh-mode session-restart, create leg): the gated spine boots
#     with the vendored JSONL backend mounted, the configured session
#     creates, one scripted turn journals it, backend.flush + stat prove the
#     artifact durable; the leg settles PASS.
#   force kill: `xcrun simctl terminate <udid> <bundle>` — the standard
#     simctl subcommand, first mid-run use in this repo (the launch side's
#     --terminate-running-process only fires at launch) — with a poll-until-
#     gone verification, the Android force-stop discipline.
#   launch 2 (resume leg, SAME container): simctl uninstall would wipe the
#     data container — never between the legs (setup uninstalls ONCE, up
#     front). The boot RESTORES the stored session, session/list carries it,
#     turn 2 continues the journal across the restart.
#
# Locks: the sim is a shared machine resource — this runner takes the
# cross-runner /tmp/dsh-ios-e2e-sim.lock (mkdir + owner-pid liveness + a
# 45-minute deadline) AND the per-UDID pid lock
# $HOME/dsh-e2e/run-ios-$UDID.lock (the repo's existing convention). Two
# locks, different scopes, both honored.
#
# The verdict is LOGS only (screenshots are saved artifacts); the checker is
# test/e2e/scenarios/session-persist-restart.json, one-to-one in order over
# BOTH launches. Evidence: hosts/ios/artifacts/session-persist-restart/.
#
# usage: run-ios-session-persist-restart.sh [--udid U] [--art-dir D]
#        [--skip-build]
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

UDID="${DSH_E2E_UDID:-A4AE41BF-026A-441E-85DF-F53522996073}"   # dsh-iphone
ART=""
SKIP_BUILD=0
APP_BUNDLE_ID=io.github.lixiang9716.def
APP=hosts/ios/DerivedData/Build/Products/Debug-iphonesimulator/DSHHost.app
while [ $# -gt 0 ]; do
  case "$1" in
    --udid) UDID="$2"; shift 2 ;;
    --art-dir) ART="$2"; shift 2 ;;
    --skip-build) SKIP_BUILD=1; shift ;;
    *) echo "usage: run-ios-session-persist-restart.sh [--udid U] [--art-dir D] [--skip-build]" >&2; exit 2 ;;
  esac
done
# --art-dir must stay INSIDE the repo (simctl --stdout lands on the
# simulator's own filesystem for /tmp paths — the runner could never read
# them back; run-ios-live-write.sh's measured trap).
[ -n "$ART" ] || ART="hosts/ios/artifacts/session-persist-restart"
LOG="$ART/logs.txt"
mkdir -p "$ART" "$ART/screens"

log() { echo "run-ios-session-persist-restart: $*"; }
die() { echo "run-ios-session-persist-restart: FAIL: $*" >&2; exit 1; }

shot() { xcrun simctl io "$UDID" screenshot "$ART/screens/$1.png" >/dev/null 2>&1 && log "screenshot screens/$1.png" || true; }

wait_line() { # PATTERN TIMEOUT_SECONDS — poll the log for a marker
  local deadline=$((SECONDS + $2))
  while [ "$SECONDS" -lt "$deadline" ]; do
    grep -q "$1" "$LOG" 2>/dev/null && return 0
    sleep 1   # paces the log poll; grep asserts after each wait
  done
  grep -q "$1" "$LOG" 2>/dev/null
}

# ---- locks -----------------------------------------------------------------
# The per-UDID pid lock (the repo's existing convention): a stale lock whose
# owner is dead is broken, never waited on.
PIDLOCK="$HOME/dsh-e2e/run-ios-$UDID.lock"
mkdir -p "$HOME/dsh-e2e"
if [ -f "$PIDLOCK" ] && kill -0 "$(cat "$PIDLOCK")" 2>/dev/null; then
  die "another runner holds $PIDLOCK (pid $(cat "$PIDLOCK"))"
fi
echo $$ > "$PIDLOCK"
# Release only what THIS run owns: the lock dir holds the owner file, so a
# bare rmdir can never succeed (a leak the next taker's dead-pid break would
# paper over — measured). The trap removes the dir outright when we hold it.
release_locks() {
  rm -f "$PIDLOCK"
  [ "$(cat "$SIMLOCK/owner" 2>/dev/null)" = "$$" ] && rm -rf "$SIMLOCK"
  return 0
}
trap 'release_locks' EXIT INT TERM

# The cross-runner sim lock (restart-leg machinery, new here): a mkdir lock
# with owner-pid liveness and a 45-minute deadline — a crashed holder's lock
# is broken, a live holder is waited on, the deadline fails loud.
SIMLOCK=/tmp/dsh-ios-e2e-sim.lock
lock_deadline=$(( $(date +%s) + 2700 ))   # 45 minutes, bounded (rule 8)
while ! mkdir "$SIMLOCK" 2>/dev/null; do
  owner_pid="$(cat "$SIMLOCK/owner" 2>/dev/null || true)"
  if [ -n "$owner_pid" ] && ! kill -0 "$owner_pid" 2>/dev/null; then
    log "breaking stale sim lock (owner pid $owner_pid is dead)"
    rm -rf "$SIMLOCK"
    continue
  fi
  [ "$(date +%s)" -ge "$lock_deadline" ] && die "sim lock $SIMLOCK held for >45m (owner: ${owner_pid:-unknown})"
  sleep 5
done
echo $$ > "$SIMLOCK/owner"
log "sim lock taken ($SIMLOCK)"

# ---- 1-4. dist, vendor, build, install, stage ---------------------------------
log "1/5 official dist present + manifest-verified"
test/e2e/ensure-official-dist.sh

log "2/5 vendor quickjs-ng sources"
external/ensure.sh

if [ "$SKIP_BUILD" -eq 0 ]; then
  log "3/5 xcodebuild (simulator, udid $UDID)"
  xcodebuild build -project hosts/ios/DSHHost.xcodeproj -scheme DSHHost \
    -destination "platform=iOS Simulator,id=$UDID" \
    -derivedDataPath hosts/ios/DerivedData 2>&1 | tail -5
else
  log "3/5 skipped (--skip-build)"
fi
[ -d "$APP" ] || die "app bundle missing: $APP (build first or drop --skip-build)"

log "4/5 boot + SETUP-CLEAN install + stage dist into the app container"
sh hosts/ios/Tools/sim-preflight.sh "$UDID"   # runtime < 26 = dead launch (18.5 dyld lacks libswiftWebKit)
xcrun simctl bootstatus "$UDID" -b   # already booted is fine
# The ONE container wipe: setup-only. Between the legs the data container is
# the journal's home — an uninstall there would erase the thing under test.
xcrun simctl uninstall "$UDID" "$APP_BUNDLE_ID" 2>/dev/null || true
xcrun simctl install "$UDID" "$APP"
APP_DATA="$(xcrun simctl get_app_container "$UDID" "$APP_BUNDLE_ID" data)"
rm -rf "$APP_DATA/Documents/official-web"
mkdir -p "$APP_DATA/Documents/official-web"
cp -R presentation/official-web/dist "$APP_DATA/Documents/official-web/dist"

log "4b/5 stage the web-plugins tree (W-SHELL application tier + vendored bootstrap; fixed stamp)"
external/ensure-dsh.sh > /dev/null
test/e2e/ensure-client-bundles.sh
PKG_SRC="external/npm/@deepseek-ai/dsh-client-modules@0.1.6-alpha.2"
[ -f "$PKG_SRC/lib/client.js" ] || die "vendored bootstrap package missing (ensure-dsh.sh)"
rm -rf "$APP_DATA/Documents/web-plugins"
mkdir -p "$APP_DATA/Documents/web-plugins/npm/@deepseek-ai"
cp -R presentation/official-web/client-bundles/npm/@deepseek-ai/. \
    "$APP_DATA/Documents/web-plugins/npm/@deepseek-ai/"
# The pinned vendored tarball wins for the bootstrap package (D6 pin record).
rm -rf "$APP_DATA/Documents/web-plugins/npm/@deepseek-ai/dsh-client-modules@0.1.6-alpha.2"
cp -R "$PKG_SRC" "$APP_DATA/Documents/web-plugins/npm/@deepseek-ai/"

launch() {
  case "$LOG" in /*) LOG_ABS="$LOG" ;; *) LOG_ABS="$PWD/$LOG" ;; esac
  case "$ART" in /*) NSLOG_ABS="$ART/nslog-stderr.txt" ;; *) NSLOG_ABS="$PWD/$ART/nslog-stderr.txt" ;; esac
  xcrun simctl launch --terminate-running-process \
    --stdout="$LOG_ABS" --stderr="$NSLOG_ABS" \
    "$UDID" "$APP_BUNDLE_ID" -dsh-mode session-restart >/dev/null
}

force_stop() {
  # `simctl terminate` is the standard subcommand; this leg is its first
  # mid-run use in the repo (the launch side's --terminate-running-process
  # only fires at launch). Verify the process is GONE: a second terminate
  # must FAIL once it is (the Android pidof-empty discipline's simctl twin).
  local deadline=$(( $(date +%s) + 30 ))
  xcrun simctl terminate "$UDID" "$APP_BUNDLE_ID" >/dev/null 2>&1 || true
  while xcrun simctl terminate "$UDID" "$APP_BUNDLE_ID" >/dev/null 2>&1; do
    [ "$(date +%s)" -ge "$deadline" ] && die "terminate left $APP_BUNDLE_ID resident"
    sleep 1
  done
}

# ---- launch 1: the create leg, then THE KILL ---------------------------------
log "5/5 launch 1 (create leg; log capture truncated — checker sees only this run)"
rm -f "$LOG" "$ART/nslog-stderr.txt"
launch
log "waiting for the create leg's durable-journal verdict (deadline 300s)"
wait_line '"leg":"create"' 300 || {
  echo "----- last 50 log lines -----" >&2; tail -n 50 "$LOG" >&2 2>/dev/null || true
  die "the create leg never settled"
}
shot 01-create-settled
log "   create leg green — force-killing the process (the restart under test)"
force_stop

# ---- launch 2: the resume leg -------------------------------------------------
log "launch 2 (resume leg on the SAME container)"
launch   # --stdout APPENDS: one run's log holds both legs, in order
log "waiting for the resume leg's cross-restart continuation (deadline 300s)"
wait_line '"leg":"resume"' 300 || {
  echo "----- last 50 log lines -----" >&2; tail -n 50 "$LOG" >&2 2>/dev/null || true
  die "the resume leg never settled"
}
wait_line "rt: sequence session-persist-restart=" 60 || die "terminal marker never appeared"
sleep 1
shot 02-resume-settled

# ---- checkers -------------------------------------------------------------------
log "checkers"
grep '^dsh.runtime.log:' "$LOG" >"$ART/scenario.jsonl" || true
rm -f "$ART/verdict-session-persist-restart.json"
if node test/e2e/check.mjs --manifest test/e2e/scenarios/session-persist-restart.json \
    --log "$LOG" --out "$ART/verdict-session-persist-restart.json"; then
  echo "==================== E2E summary ($ART) ===================="
  echo "  session-persist-restart     PASS"
  echo "  logs: $LOG  screens: $ART/screens/"
else
  echo "==================== E2E summary ($ART) ====================" >&2
  echo "  session-persist-restart     FAIL" >&2
  echo "  logs: $LOG  screens: $ART/screens/" >&2
  die "session-persist-restart checker failed — see $ART/verdict-session-persist-restart.json"
fi

# ---- receipt (reachable ONLY on a real green run) ---------------------------
sh test/e2e/write-receipt.sh "$ART" "$UDID" "test/e2e/run-ios-session-persist-restart.sh" \
  "session-persist.restart: the gated spine boots with the vendored JSONL backend, one scripted turn per process, and the runner-owned force kill between them — create leg journals durably, simctl terminate kills the process, the relaunch on the SAME container restores the stored session (session/list carries it, journal tail turn/end) and turn 2 continues the journal across the restart, one-to-one against the session-persist-restart manifest" \
  "-dsh-mode session-restart x2; vendored official dist + web-boot plugin files staged; /tmp/dsh-ios-e2e-sim.lock + per-UDID pid lock held" \
  session-persist-restart
