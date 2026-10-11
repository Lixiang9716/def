#!/usr/bin/env bash
# test/e2e/run-ios-create-card.sh — the create-approve-hotmount chain leg
# (`create.card`): builds DSHHost (Debug), boots a simulator, installs into a
# FRESH container, launches with `-dsh-mode create-card` and the scripted
# approver (`-dsh-script-approval approve` — no idb/WDA anywhere: the app
# settles its own approval alert 0.35s in, UIPrimitives.swift
# scriptAnswerIfAsked), then verifies the captured log against the scenario
# manifest one-to-one. The verdict is logs only.
#
# Sibling of run-ios-mic-plane.sh's machinery with three deliberate
# differences:
#   1. GLOBAL simulator lock — simulators are shared across worktrees and
#      runners, so the whole boot/install/drive segment runs under a mkdir
#      lock at /tmp/dsh-ios-e2e-sim.lock (owner marker inside — pid-liveness
#      probed so a SIGKILLed holder's stale lock is stolen loudly instead of
#      burning the deadline — released by the EXIT trap, acquire deadline
#      45 min at a 15s poll).
#   2. Simulator DISCOVERY: --udid > $DSH_E2E_UDID > an already-booted
#      iPhone > an available iPhone we boot ourselves (no hardcoded UDID).
#   3. The build segment MATERIALIZES the untracked trees first
#      (vendor ensure x2 -> hosts/ios/gen.sh -> xcodebuild) — a fresh
#      worktree ships neither vendor/ nor the generated project.
#
# `sh`-invocable by contract: self-roots from $0, POSIX body (no arrays,
# no [[ ]], no pipefail), and discovers its own node (the caller cannot
# export env) — PATH, the common prefixes, then ~/.nvm.
#
# usage: run-ios-create-card.sh [--udid U] [--art-dir D] [--skip-build]
set -eu

PREFIX="run-ios-create-card"
die() { echo "$PREFIX: FAIL: $*" >&2; exit 1; }
log() { echo "$PREFIX: $*"; }
usage() { echo "usage: run-ios-create-card.sh [--udid U] [--art-dir D] [--skip-build]" >&2; exit 2; }
help() { echo "usage: run-ios-create-card.sh [--udid U] [--art-dir D] [--skip-build]"; exit 0; }

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

UDID=""                       # resolved in step 1 (explicit > env > booted > available)
ART="hosts/ios/artifacts/create-card"
SKIP_BUILD=0
APP_BUNDLE_ID=org.dsh.DSHHost
APP=hosts/ios/DerivedData/Build/Products/Debug-iphonesimulator/DSHHost.app
SIM_LOCK=/tmp/dsh-ios-e2e-sim.lock
LOCK_ACQUIRE_DEADLINE=$((60 * 45))   # 45 min, polled at 15s
BOOT_DEADLINE=120
LAUNCH_WINDOW=120                    # bounded retries around SpringBoard refusals
READY_DEADLINE=15                    # first stdout can take >10s on a cold dyld
DRIVE_DEADLINE=240                   # android-leg parity; the app's own gateway watchdog is 180s
VERDICT_MARKER='create-card drive finished verdict='   # prefix-free substring: the app
                                                       # prints `rt: ...` today (#402 renamed
                                                       # spike: -> rt: and the sibling runners'
                                                       # `dsh: ...` greps went dead)
while [ $# -gt 0 ]; do
  case "$1" in
    --udid) [ $# -ge 2 ] || usage; UDID="$2"; shift 2 ;;
    --art-dir) [ $# -ge 2 ] || usage; ART="$2"; shift 2 ;;
    --skip-build) SKIP_BUILD=1; shift ;;
    -h|--help) help ;;
    *) usage ;;
  esac
done
LOG="$ART/logs.txt"   # derived AFTER arg parsing — --art-dir must apply
mkdir -p "$ART" "$ART/screens"

# node self-discovery (the workflow caller cannot export env): PATH first,
# then the common prefixes, then any nvm-installed node. Fail loud — a
# missing node once turned into a stale verdict read as PASS.
NODE_BIN="$(command -v node 2>/dev/null || true)"
if [ -z "$NODE_BIN" ]; then
  for c in /opt/homebrew/bin/node /usr/local/bin/node; do
    if [ -x "$c" ]; then NODE_BIN="$c"; break; fi
  done
fi
if [ -z "$NODE_BIN" ]; then
  for c in "$HOME"/.nvm/versions/node/*/bin/node; do
    if [ -x "$c" ]; then NODE_BIN="$c"; break; fi
  done
fi
[ -n "$NODE_BIN" ] || die "node not on PATH, not in the common prefixes, and none under ~/.nvm — required for test/e2e/check.mjs"
# python3 is load-bearing on EVERY path — simulator discovery (step 1),
# gen.sh / gen_bundle_header.py (step 2), write-receipt.sh (step 7) — so it
# is checked once up front, not only inside the build branch (--skip-build
# would otherwise skip it and discovery would misreport the failure).
command -v python3 >/dev/null 2>&1 || die "python3 not on PATH — simulator discovery, gen.sh and write-receipt.sh all need it"

# ---- the global simulator lock ----------------------------------------------
LOCK_HELD=0
release_lock() {
  [ "$LOCK_HELD" = "1" ] || return 0
  LOCK_HELD=0
  rm -f "$SIM_LOCK/owner"
  rmdir "$SIM_LOCK" 2>/dev/null || echo "$PREFIX: WARNING: $SIM_LOCK not removable (leftover files?) — continuing" >&2
}
trap release_lock EXIT

acquire_sim_lock() {
  deadline=$((SECONDS + LOCK_ACQUIRE_DEADLINE))
  while ! mkdir "$SIM_LOCK" 2>/dev/null; do
    # Staleness probe (pid liveness, the sibling pidfile pattern): a holder
    # killed by SIGKILL/power loss would otherwise burn every later run's
    # full 45-min deadline before the loud failure. pid reuse can fool
    # kill -0 — the steal is loud either way, so a mistaken steal is
    # diagnosable to the second.
    owner_pid="$(sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' "$SIM_LOCK/owner" 2>/dev/null || true)"
    stale=""
    if [ -n "$owner_pid" ]; then
      if ! kill -0 "$owner_pid" 2>/dev/null; then
        stale="owner pid $owner_pid is not alive"
      fi
    else
      # No readable owner: the holder died between mkdir and the marker
      # write, or the dir holds foreign junk. Steal only once it looks
      # abandoned (>120s old) so a just-created lock is never raced.
      lock_mtime="$(stat -f %m "$SIM_LOCK" 2>/dev/null || echo 0)"
      if [ "$(( $(date +%s) - lock_mtime ))" -gt 120 ]; then
        stale="owner marker absent and the lock dir is >120s old"
      fi
    fi
    if [ -n "$stale" ]; then
      echo "$PREFIX: WARNING: stealing stale simulator lock ($stale) — previous marker(s):" >&2
      for f in "$SIM_LOCK"/*; do
        if [ -f "$f" ]; then cat "$f" >&2; fi
      done
      rm -f "$SIM_LOCK/owner"
      rmdir "$SIM_LOCK" 2>/dev/null || true
      continue   # the mkdir above arbitrates between competing stealers
    fi
    if [ "$SECONDS" -ge "$deadline" ]; then
      echo "$PREFIX: FAIL: simulator lock $SIM_LOCK not acquired within 45 min — current owner marker:" >&2
      for f in "$SIM_LOCK"/*; do
        if [ -f "$f" ]; then cat "$f" >&2; fi
      done
      exit 1
    fi
    sleep 15
  done
  LOCK_HELD=1
  printf '%s pid=%s started=%s\n' run-ios-create-card.sh "$$" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$SIM_LOCK/owner"
}

# ---- step 1/7: pick the simulator (read-only discovery; no booting yet) ------
select_sim() { # STATE — first iPhone UDID in that state, newest runtime first
               # (reverse-lex on the runtime key puts iOS-26-5 above iOS-18-5;
               # sim-preflight rejects anything pre-26 anyway)
  SIM_JSON="$(xcrun simctl list -j devices)" || return 1
  SIM_JSON="$SIM_JSON" python3 - "$1" <<'PY'
import json, os, sys
want = sys.argv[1]
devices = json.loads(os.environ["SIM_JSON"])["devices"]
hits = sorted(
    (runtime, d["udid"])
    for runtime, devs in devices.items()
    for d in devs
    if d.get("name", "").startswith("iPhone")
    and d.get("state") == want
    and d.get("isAvailable", True)
)
print(hits[-1][1] if hits else "")
PY
}

if [ -n "$UDID" ]; then
  log "1/7 simulator: $UDID (--udid)"
else
  UDID="${DSH_E2E_UDID:-}"
  if [ -n "$UDID" ]; then
    log "1/7 simulator: $UDID (DSH_E2E_UDID)"
  else
    UDID="$(select_sim Booted)" || die "simulator discovery failed — 'xcrun simctl list -j devices' output unusable"
    if [ -n "$UDID" ]; then
      log "1/7 simulator: $UDID (already-booted iPhone)"
    else
      UDID="$(select_sim Shutdown)" || die "simulator discovery failed — 'xcrun simctl list -j devices' output unusable"
      [ -n "$UDID" ] || die "no iPhone simulator found (booted or available) — create one or pass --udid"
      log "1/7 simulator: $UDID (available iPhone, will boot in step 4)"
    fi
  fi
fi

# ---- step 2/7: materialize + build (Debug — release fatalErrors on
# ---- -dsh-mode create-card, AppDelegate.swift launchMode gate) ---------------
LOG_ABS="$PWD/$LOG"
NSLOG_ABS="$PWD/$ART/nslog-stderr.txt"
if [ "$SKIP_BUILD" = "1" ]; then
  log "2/7 build skipped (--skip-build)"
  [ -d "$APP" ] || die "--skip-build but no app at $APP — build first (run without the flag)"
else
  command -v xcodegen >/dev/null 2>&1 || die "xcodegen not on PATH (needed by hosts/ios/gen.sh) — brew install xcodegen"
  log "2/7 materializing the vendored runtime + generating the project"
  sh runtime/dsh/vendor/ensure.sh || die "runtime/dsh/vendor/ensure.sh failed (quickjs-ng/wasm3/zstd)"
  sh runtime/dsh/vendor/ensure-dsh.sh || die "runtime/dsh/vendor/ensure-dsh.sh failed (upstream dsh + npm closure)"
  sh hosts/ios/gen.sh || die "hosts/ios/gen.sh failed (bundle header + guest rootfs + xcodegen)"
  log "2/7 building DSHHost (Debug)"
  if ! xcodebuild build -project hosts/ios/DSHHost.xcodeproj -scheme DSHHost \
      -destination "platform=iOS Simulator,id=$UDID" \
      -derivedDataPath hosts/ios/DerivedData -quiet >/dev/null; then
    die "xcodebuild failed (Debug) — diagnostics on stderr above"
  fi
  [ -d "$APP" ] || die "xcodebuild reported success but $APP is missing"
fi

# ---- step 3/7: take the global simulator lock (before boot/install/drive) ----
log "3/7 acquiring the simulator lock ($SIM_LOCK, deadline 45 min @ 15s)"
acquire_sim_lock

# ---- step 4/7: preflight + boot + a FRESH container --------------------------
sh hosts/ios/Tools/sim-preflight.sh "$UDID" || die "sim-preflight rejected $UDID (runtime < 26 dies at launch)"
log "4/7 booting $UDID (deadline ${BOOT_DEADLINE}s)"
xcrun simctl boot "$UDID" 2>/dev/null || log "boot returned nonzero (already booted / transitioning) — polling for Booted"
boot_deadline=$((SECONDS + BOOT_DEADLINE))
booted=0
while [ "$SECONDS" -lt "$boot_deadline" ]; do
  if xcrun simctl list devices | grep -F "($UDID)" | grep -q '(Booted)'; then
    booted=1
    break
  fi
  sleep 2
done
[ "$booted" = "1" ] || die "simulator $UDID not Booted within ${BOOT_DEADLINE}s"
# UNINSTALL first: the create.card story IS the FIRST-RUN chain (workspace
# plugin write -> approval -> registry install). A leftover container would
# have last run's plugin mounted by mountBootRows and break the one-to-one
# log match — the android leg's `pm clear` rationale.
xcrun simctl uninstall "$UDID" "$APP_BUNDLE_ID" 2>/dev/null || true
xcrun simctl install "$UDID" "$APP"

# ---- step 5/7: launch (-dsh-mode create-card + scripted approval) -------------
log "5/7 launch (-dsh-mode create-card -dsh-script-approval approve, bounded retries)"
rm -f "$LOG"
# Right after boot SpringBoard can refuse the open — retry until the log
# grows or the window passes (rule 8: poll the condition, never sleep blind).
launch_deadline=$((SECONDS + LAUNCH_WINDOW))
launched=0
last_rc=0
while [ "$SECONDS" -lt "$launch_deadline" ]; do
  : > "$LOG"   # each attempt owns its log (simctl --stdout APPENDS)
  rc=0
  # perl alarm: macOS has no timeout(1); rc 142 = SIGALRM = launch deadline
  perl -e 'alarm shift; exec @ARGV' "${DSH_LAUNCH_DEADLINE:-180}" \
    xcrun simctl launch --terminate-running-process \
      --stdout="$LOG_ABS" --stderr="$NSLOG_ABS" \
      "$UDID" "$APP_BUNDLE_ID" -dsh-mode create-card -dsh-script-approval approve \
    >/dev/null 2>&1 || rc=$?
  last_rc=$rc
  if [ "$rc" = "0" ]; then
    ready_deadline=$((SECONDS + READY_DEADLINE))
    while [ "$SECONDS" -lt "$ready_deadline" ]; do
      if [ -s "$LOG" ]; then
        launched=1
        break
      fi
      sleep 1
    done
    if [ "$launched" = "1" ]; then break; fi
  fi
  sleep 3
done
if [ "$launched" != "1" ]; then
  if [ "$last_rc" = "142" ]; then
    die "launch deadline: simctl launch exceeded ${DSH_LAUNCH_DEADLINE:-180}s (SIGALRM) — see $NSLOG_ABS"
  fi
  die "launch failed within ${LAUNCH_WINDOW}s of retries (last rc=$last_rc) — see $NSLOG_ABS"
fi

# ---- step 6/7: drive to the verdict line + event-anchored screenshots --------
# Two shots, pinned to the log events (presented / completed faces), taken
# ~1s after the line lands so the surface paints; a shot NEVER fails the run
# and never gates the verdict (CI asserts on logs, AGENTS.md rule 7).
log "6/7 waiting for the verdict line (deadline ${DRIVE_DEADLINE}s)"
presented_shot=0
completed_shot=0
drive_deadline=$((SECONDS + DRIVE_DEADLINE))
while [ "$SECONDS" -lt "$drive_deadline" ]; do
  if [ "$presented_shot" = "0" ] && grep -q 'card.face.presented' "$LOG" 2>/dev/null; then
    presented_shot=1
    sleep 1   # surface paint settle for the screenshot, not a wait on the verdict
    xcrun simctl io "$UDID" screenshot "$ART/screens/01-card-present.png" >/dev/null 2>&1 \
      || echo "$PREFIX: WARNING: 01-card-present.png shot failed (screens never gate a run)" >&2
  fi
  if [ "$completed_shot" = "0" ] && grep -q 'card.face.completed' "$LOG" 2>/dev/null; then
    completed_shot=1
    sleep 1
    xcrun simctl io "$UDID" screenshot "$ART/screens/02-card-complete.png" >/dev/null 2>&1 \
      || echo "$PREFIX: WARNING: 02-card-complete.png shot failed (screens never gate a run)" >&2
  fi
  if grep -q "$VERDICT_MARKER" "$LOG" 2>/dev/null; then
    grep "$VERDICT_MARKER" "$LOG"
    break
  fi
  sleep 1
done
if ! grep -q "$VERDICT_MARKER" "$LOG" 2>/dev/null; then
  echo "$PREFIX: FAIL: DEADLINE EXPIRED — '$VERDICT_MARKER' never appeared within ${DRIVE_DEADLINE}s; last 60 log lines:" >&2
  tail -n 60 "$LOG" >&2 2>/dev/null || true
  exit 1
fi

# ---- step 7/7: evidence, checkers, receipt ------------------------------------
log "7/7 extracting evidence + running checkers"
grep '^dsh.runtime.log:' "$LOG" > "$ART/scenario.jsonl" || true
grep '^dsh.gateway.audit:' "$LOG" > "$ART/gateway-audit.jsonl" || true
rm -f "$ART/verdict-create-card.json"   # stale-verdict hygiene — never inherit a PASS
if ! "$NODE_BIN" test/e2e/check.mjs --manifest test/e2e/scenarios/create-card.json \
    --log "$LOG" --out "$ART/verdict-create-card.json"; then
  die "checkers red — evidence stays unreceipted"
fi
# Deliberately NO matrix-register here: it is a library of matrix.mjs with no
# CLI, and no runner in either family invokes it — matrix coverage is a
# separate matrix.mjs/matrix.sh concern, not the runner's.
sh test/e2e/write-receipt.sh "$ART" "$UDID" test/e2e/run-ios-create-card.sh \
  "create.card" "ios create-card drive (Debug, -dsh-mode create-card -dsh-script-approval approve)" \
  create-card

"$NODE_BIN" -e 'const v = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); console.log("verdict:", v.scenario, "pass=" + v.pass, "events " + v.logged + "/" + v.expected);' \
  "$ART/verdict-create-card.json"
echo "==================== create-card E2E summary ($ART) ===================="
log "receipt written — create.card green"
