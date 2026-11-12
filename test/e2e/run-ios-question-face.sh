#!/usr/bin/env bash
# test/e2e/run-ios-question-face.sh — the question.face E2E evidence leg
# (R3, T-0290): the face.question@1 pilot — a REAL ctx.userQuestions.ask()
# on a booted spine, parked by the question bridge, presented by the NATIVE
# alert, and CANCELLED by the scripted-question seam
# (`-dsh-script-question cancel` — SessionQuestions.swift
# scriptAnswerIfAsked, the approval seam's shape: the alert still presents,
# then settles exactly the way the tapped 取消 would). The cancel delivers
# `question.answer {outcome:"cancelled"}`, the parked turn SETTLES (the
# park-forever defect dies), and the manifest pins the whole chain against
# the captured log one-to-one.
#
# Sibling interface of run-ios-card-player.sh: [--udid U] [--art-dir D]
# [--skip-build]. Same shared-simulator lock, same vendor/official-dist
# materialization, same marker-driven verdict poll (240s), same
# check.mjs + write-receipt.sh close. Screenshots are artifacts, not
# assertions — one final face shot only (the dialog lives ~0.4s).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

UDID=""
ART="hosts/ios/artifacts/question-face"
SKIP_BUILD=0
APP_BUNDLE_ID=io.github.lixiang9716.def
APP=hosts/ios/DerivedData/Build/Products/Debug-iphonesimulator/DSHHost.app
SIM_LOCK=/tmp/dsh-ios-e2e-sim.lock
while [ $# -gt 0 ]; do
  case "$1" in
    --udid) UDID="$2"; shift 2 ;;
    --art-dir) ART="$2"; shift 2 ;;
    --skip-build) SKIP_BUILD=1; shift ;;
    *) echo "usage: run-ios-question-face.sh [--udid U] [--art-dir D] [--skip-build]" >&2; exit 2 ;;
  esac
done
LOG="$ART/logs.txt"   # derived AFTER arg parsing — --art-dir must apply
mkdir -p "$ART" "$ART/screens"

log() { echo "run-ios-question-face: $*"; }
die() { echo "run-ios-question-face: FAIL: $*" >&2; exit 1; }

fail_deadline() {   # a bounded poll expired — dump the log tail, fail loud
  echo "run-ios-question-face: DEADLINE EXPIRED: $*" >&2
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
find_node || die "node not found (searched PATH, ~/.nvm/versions/node/*/bin, /opt/homebrew/bin, /usr/local/bin)"

shot() { # NAME — an artifact, not an assertion: warn on failure, never die
  if xcrun simctl io "$UDID" screenshot "$ART/screens/$1.png" >/dev/null 2>&1; then
    log "screenshot screens/$1.png"
  else
    log "WARNING: screenshot screens/$1.png failed"
  fi
}

wait_first_record() { # the scenario reaches its first marker after the spine boot (90s budget)
  local deadline=$((SECONDS + 90))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if grep -q '^dsh.runtime.log:' "$LOG" 2>/dev/null; then return 0; fi
    if grep -q 'rt: question-face bootstrap failed' "$LOG" 2>/dev/null; then
      die "bootstrap failed — see $LOG"
    fi
    sleep 1
  done
  fail_deadline "the runtime's first dsh.runtime.log record never appeared (90s)"
}

# One-way courtesy to the pre-existing convention (run-ios-card-player.sh
# documents the same asymmetry): the older iOS runners publish per-runner
# locks under $HOME/dsh-e2e and cannot know this script's /tmp lock.
check_sibling_locks() {
  local lockf holder
  for lockf in "$HOME"/dsh-e2e/run-ios*-"$UDID".lock; do
    if [ -f "$lockf" ]; then
      holder="$(cat "$lockf" 2>/dev/null || true)"
      case "$holder" in
        '' | *[!0-9]*) continue ;;   # absent/unparseable content is not a live holder
      esac
      if kill -0 "$holder" 2>/dev/null; then
        die "sibling runner lock $lockf held by live pid $holder — the shared simulator is mid-run"
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
external/ensure.sh
external/ensure-dsh.sh >/dev/null
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
  if [ -f "$SIM_LOCK/marker" ]; then
    HOLDER_PID="$(sed -n 's/.*pid=\([0-9][0-9]*\).*$/\1/p' "$SIM_LOCK/marker" 2>/dev/null || true)"
    if [ -n "$HOLDER_PID" ] && ! kill -0 "$HOLDER_PID" 2>/dev/null; then
      log "stale simulator lock — holder pid $HOLDER_PID is dead; stealing $SIM_LOCK"
      rm -rf "$SIM_LOCK"
      continue
    fi
  fi
  if [ "$SECONDS" -ge "$LOCK_DEADLINE" ]; then
    echo "run-ios-question-face: FAIL: $SIM_LOCK still held after 45 min — holder marker:" >&2
    cat "$SIM_LOCK/marker" >&2 2>/dev/null || echo "  (the lock dir carries no marker)" >&2
    exit 1
  fi
  sleep 15
done
printf 'runner=%s pid=%s udid=%s started=%s\n' \
  "$(basename "$0")" "$$" "$UDID" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$SIM_LOCK/marker"
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
rm -rf "$APP_DATA/Documents/web-plugins/npm/@deepseek-ai/dsh-client-modules@0.1.6-alpha.2"
cp -R "external/npm/@deepseek-ai/dsh-client-modules@0.1.6-alpha.2" \
  "$APP_DATA/Documents/web-plugins/npm/@deepseek-ai/"

# ---- 5. launch (-dsh-mode question-face, scripted cancel) + verdict poll ---
log "5/6 launch -dsh-mode question-face -dsh-script-question cancel (bounded retries; Debug-only seat)"
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
      "$UDID" "$APP_BUNDLE_ID" -dsh-mode question-face \
      -dsh-script-question cancel >/dev/null 2>&1 || RC=$?
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
  echo "run-ios-question-face: FAIL: launch failed — SpringBoard never accepted the open" >&2
  tail -n 30 "$ART/nslog-stderr.txt" >&2 2>/dev/null || true
  exit 1
fi

wait_first_record
log "driving: verdict poll (deadline 240s — the spine boot takes the first ~20s)"
DRIVE_DEADLINE=$((SECONDS + 240))
while :; do
  if grep -q "question.face.*scenario.complete\|scenario.failed" "$LOG" 2>/dev/null; then
    break
  fi
  if [ "$SECONDS" -ge "$DRIVE_DEADLINE" ]; then
    fail_deadline "the question.face verdict line (scenario.complete|scenario.failed) never appeared (240s)"
  fi
  sleep 1
done
shot 01-final
# Stopping the seat also flushes the app's buffered stdout into $LOG — the
# checker reads this file, so terminate BEFORE extracting the records.
xcrun simctl terminate "$UDID" "$APP_BUNDLE_ID" 2>/dev/null || true

# ---- 6. checkers + receipt (receipt reachable ONLY on the green path) ------
log "6/6 checkers"
grep '^dsh.runtime.log:' "$LOG" >"$ART/scenario.jsonl" || true
grep '^dsh.gateway.audit:' "$LOG" >"$ART/gateway-audit.jsonl" || true
rm -f "$ART/verdict-question-face.json"   # a stale verdict must never vouch for this run
if ! node test/e2e/check.mjs --manifest test/e2e/scenarios/question-face.json \
      --log "$LOG" --out "$ART/verdict-question-face.json"; then
  die "checkers red — evidence stays unreceipted (see $ART/verdict-question-face.json)"
fi
log "checker green — writing the receipt"
sh test/e2e/write-receipt.sh "$ART" "$UDID" test/e2e/run-ios-question-face.sh \
  "question.face" \
  "ios question-face drive (Debug, -dsh-mode question-face, scripted cancel)" \
  question-face
log "PASS — question.face green; evidence in $ART"
