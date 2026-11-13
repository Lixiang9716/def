#!/usr/bin/env bash
# run-page-open.sh — the iOS twin of the android page-open pin (#691, the
# interactive-seat guard): a fresh boot of the DEFAULT seat — the release
# serving seat (AppDelegate.bootRelease -> SessionServe, interactive: true)
# — must end with the app's own WebView navigating to the carrier origin.
#
# The gate the page open rides — SessionServe.maybeOpenOrigin — needs the
# runtime's `web.boot` row applied AND the bus line `settings.probes.done`
# (the settings probes' completion post) before the origin opens. The android
# twin caught a3e35d72 dropping that post (the page silently never opened
# again, zero FAIL lines). Nothing else in CI drives the default seat — the
# ios-e2e legs boot evidence drives (non-interactive configs) — so this check
# is the only guard for the interactive-only boot-failure class (#686): a
# boot that dies or stalls under the interactive config while every evidence
# drive stays green. First catch, same day it landed: the release seat's
# staged tree missing upstream/boot-permission-presets.js (the bytes were
# embedded but BundleStager never wrote them; android/harmony stage whole
# directories and never miss it) — the boot failed at web-boot eval with
# `cannot load module` while every m1 scenario and evidence drive stayed
# green. That is exactly the blind spot #691 exists to close.
#
# The seat is RELEASE-flavor only (BuildFlavor.isRelease -> bootRelease; a
# launch that asks for a drive is refused by fatalError — so this launch
# carries NO arguments at all, the plain product seat). Build the Release
# configuration for the simulator first (the dev/ios build step builds the
# debug harness; this pin needs the release product):
#   sh hosts/ios/gen.sh
#   xcodebuild build -project hosts/ios/DSHHost.xcodeproj -scheme DSHHost \
#     -configuration Release -destination 'generic/platform=iOS Simulator' \
#     -derivedDataPath hosts/ios/DerivedData
# This script never builds (the android pin's "this check never builds"
# discipline; DSH_PAGEOPEN_APP overrides the path).
#
# Assertion surface (E2E by logs, never screenshots — a screenshot rides the
# artifacts as LOCAL debugging evidence only, never an assertion). Every
# channel here survives the release build's -DDSH_RELEASE log suppression:
# they are NSLog lines and socket state, never logger debug/info records
# (CarrierEventLog drops those in release; NSLog and NWListener do not).
#   1. the serving-origin line `dsh.serve: origin token=<32 hex>` in the
#      simulator's unified log (SessionServe.maybeOpenOrigin's NSLog — the
#      boot reached the page-open gate: web.boot applied AND
#      settings.probes.done posted);
#   2. the carrier's loopback listener, read from the app process's own
#      socket table (lsof: exactly one 127.0.0.1 LISTEN). The iOS sibling of
#      the android line logs the token but not the port
#      (`dsh.serve: origin token=…` vs android's `… port=…`), and this
#      script does not own SessionServe.swift — so the bound port is read
#      from the process's sockets: a measured fact, not an inference;
#   3. GET /api/state on that origin answering 200 with the boot's token
#      (the diagnostics seam — the same seam the android release-seat leg
#      asserts — token-gated, so a 200 proves the serving plane and the
#      harvested token agree; the body carries the runtime's
#      claimedEndpoints and the app block);
#   4. page-open evidence: a client connection to the carrier port that
#      PERSISTS across two polls (the page's mux/WS session — a transient
#      curl would not persist), plus page-driven token-authed /api traffic
#      beyond this script's own /api/state probe. There is no WebView
#      devtools on iOS (the android pin reads /json/list), so these two are
#      the honest page-navigated proxies;
#   5. zero failure lines from the boot window (a fail-open pass on a
#      failing boot is a finding; on a passing boot any failure line is a
#      finding) — the serving seat's failure channels all speak NSLog
#      (`dsh.session.serve: runtime failed` / `bootstrap failed`,
#      `rt: carrier FAIL`).
#
# Every wait is a polled condition with a deadline (rules.md rule 8); every
# exhaustion is loud (rule 5). A machine with no >= 26 simulator runtime
# SKIPs loudly (exit 0 + ::warning:: naming why — the sim-preflight class,
# mirroring run-release-seat.sh's keystore-skip discipline: the runtime
# pairing is a precondition this leg was not handed, not a product verdict).
#
# usage: run-page-open.sh   (env: DSH_PAGEOPEN_APP, DSH_PAGEOPEN_OUT,
#        DSH_PAGEOPEN_UDID, DSH_PAGEOPEN_DEADLINE, DSH_PAGEOPEN_QUIET_WINDOW)
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
cd "$ROOT" || exit 1
BUNDLE_ID=io.github.lixiang9716.def
APP="${DSH_PAGEOPEN_APP:-hosts/ios/DerivedData/Build/Products/Release-iphonesimulator/DSHHost.app}"
OUT="${DSH_PAGEOPEN_OUT:-hosts/ios/artifacts/page-open}"
DEADLINE="${DSH_PAGEOPEN_DEADLINE:-180}"
API_DEADLINE="${DSH_PAGEOPEN_API_DEADLINE:-60}"
UDID="${DSH_PAGEOPEN_UDID:-}"

say() { echo "run-page-open: $*"; }
die() { echo "::error::run-page-open: $*" >&2; exit 1; }
skip() { echo "::warning::run-page-open: SKIP: $*" >&2; exit 0; }

[ -d "$APP" ] || die "no simulator .app at $APP — build the Release flavor first (sh hosts/ios/gen.sh; xcodebuild build -project hosts/ios/DSHHost.xcodeproj -scheme DSHHost -configuration Release -destination 'generic/platform=iOS Simulator' -derivedDataPath hosts/ios/DerivedData); this check never builds (DSH_PAGEOPEN_APP overrides the path)"

# ---- device: the same pinned preference list as run-ios-boot-carrier.sh ----
# (one shared preference order keeps the prewarm, the m1 leg and this pin on
# the SAME device; the any-iPhone fallback weakens comparability and says so)
# Candidates are walked through the sim-preflight gate IN PREFERENCE ORDER:
# a device whose runtime cannot pair (the pre-26 dyld trap) is not the
# machine's verdict — the next candidate is tried, and the loud SKIP fires
# only when NO candidate pairs (the precondition this machine was not
# handed), never because the first name-preferred device was stale.
candidates=""
if [ -z "$UDID" ]; then
  for want in "iPhone 16 Pro" "iPhone 17" "iPhone 16" "iPhone 15"; do
    u=$(xcrun simctl list devices available | grep -F "$want (" \
      | grep -m1 -oE '[A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12}' || true)
    [ -n "$u" ] && candidates="$candidates $u"
  done
  if [ -z "$candidates" ]; then
    echo "::warning::no preferred simulator on this runner — falling back to any iPhone, which weakens run-to-run comparability"
  fi
  for u in $(xcrun simctl list devices available | grep -iE 'iphone' \
      | grep -oE '[A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12}' || true); do
    case " $candidates " in *" $u "*) ;; *) candidates="$candidates $u" ;; esac
  done
else
  candidates="$UDID"   # an explicit DSH_PAGEOPEN_UDID is walked through the same gate
fi
UDID=""
preflight_said=""
for c in $candidates; do
  preflight_said=$(sh hosts/ios/Tools/sim-preflight.sh "$c" 2>&1 || true)
  if printf '%s' "$preflight_said" | grep -q "sim-preflight: OK"; then UDID=$c; break; fi
done
[ -n "$UDID" ] || skip "no simulator on this machine pairs with DSHHost (every candidate failed the >= 26 runtime gate — the pre-26 dyld cache lacks libswiftWebKit, the launch can never produce app logs); last preflight said: $(printf '%s' "$preflight_said" | tail -1)"
sh hosts/ios/Tools/sim-preflight.sh "$UDID"   # the loud OK line for the record
say "using simulator $UDID"

# ---- boot, install, one bounded readiness poll (run-ios-boot-carrier's
# discipline; `bootstatus -b` returns early on an already-booted device and
# before SpringBoard on a fresh runtime, so readiness is PROBED) ----
xcrun simctl boot "$UDID" >/dev/null 2>&1 || true
xcrun simctl bootstatus "$UDID" -b >/dev/null
ready=no
for _ in $(seq 1 30); do
  if xcrun simctl spawn "$UDID" launchctl print system >/dev/null 2>&1; then ready=yes; break; fi
  sleep 1
done
[ "$ready" = yes ] || echo "::warning::simulator readiness probe never succeeded — continuing, but the launch may be denied"

# A previous boot of the seat (local runs, a prior attempt) must not survive
# into this one: terminate, then install the fresh product.
xcrun simctl terminate "$UDID" "$BUNDLE_ID" >/dev/null 2>&1 || true
xcrun simctl install "$UDID" "$APP" || die "simctl install failed for $APP"

mkdir -p "$OUT"
LOG_STREAM="$OUT/unified-log.txt"
: > "$LOG_STREAM"
# The unified log is the iOS logcat: the serving-origin line, the bridge's
# page-traffic lines and the failure channels are all NSLog records into it.
# One stream over the whole boot window feeds every assertion below and is
# kept as evidence (the boot window's corpus for the FAIL scan).
log_stream_pid=""
start_log_stream() {
  ( xcrun simctl spawn "$UDID" log stream \
      --predicate 'process == "DSHHost"' --style compact >> "$LOG_STREAM" 2>/dev/null ) &
  log_stream_pid=$!
}
stop_log_stream() {
  [ -n "$log_stream_pid" ] && kill "$log_stream_pid" >/dev/null 2>&1 || true
  wait "$log_stream_pid" 2>/dev/null || true
}
trap stop_log_stream EXIT INT TERM
start_log_stream
boot_started=$(date +%s)

# ---- fresh boot of the DEFAULT seat: NO launch arguments (the release gate
# refuses -dsh-mode by fatalError; the plain launch IS the official serve) --
# The DYLD fallback is the proven libswiftWebKit pairing from
# run-ios-boot-carrier.sh (harmless on runtimes that already carry the path).
RTKEY=$(xcrun simctl list devices --json | python3 -c \
  "import json,sys; d=json.load(sys.stdin)['devices']; print(next(k for k,vs in d.items() for v in vs if v['udid']=='$UDID'))")
RUNTIME_ROOT=$(xcrun simctl list runtimes --json | python3 -c \
  "import json,sys; print(next(r['runtimeRoot'] for r in json.load(sys.stdin)['runtimes'] if r['identifier']=='$RTKEY'))")
say "launching the release seat (no arguments — the official serve)"
launch_rc=0
SIMCTL_CHILD_DYLD_FALLBACK_LIBRARY_PATH="$RUNTIME_ROOT/System/Cryptexes/OS/usr/lib/swift" \
  xcrun simctl launch --terminate-running-process \
  --stdout="$PWD/$OUT/stdout.txt" \
  --stderr="$PWD/$OUT/stderr.txt" \
  "$UDID" "$BUNDLE_ID" || launch_rc=$?
if [ "$launch_rc" != "0" ]; then
  cp "$LOG_STREAM" "$OUT/boot-window.log" 2>/dev/null || true
  die "simctl launch exited $launch_rc — the app launched and then exited or crashed; the boot window's log is at $OUT/unified-log.txt"
fi

# ---- the app process on THIS device (the container path embeds the UDID) ---
app_pid_for() {
  # `|| true` keeps a no-match pgrep (process not up yet) from tripping
  # `set -e -o pipefail` inside the caller's command substitution.
  pgrep -f "Devices/$UDID.*DSHHost\.app/DSHHost" | head -1 || true
}

# ---- the serving origin: token from the unified log, port from the socket
# table — one bounded poll for both (rules.md rule 8) ----
token=
port=
deadline=$(( $(date +%s) + DEADLINE ))
while [ -z "$token" ] || [ -z "$port" ]; do
  now=$(date +%s)
  if [ "$now" -ge "$deadline" ]; then
    cp "$LOG_STREAM" "$OUT/boot-window.log" 2>/dev/null || true
    why="no 'dsh.serve: origin token=' line within ${DEADLINE}s (maybeOpenOrigin never fired — the web.boot/settings.probes.done gate is broken or the runtime half stalled?)"
    if [ -n "$token" ]; then
      why="no 127.0.0.1 LISTEN socket on the app process within ${DEADLINE}s (the carrier never bound?)"
    fi
    die "$why"
  fi
  # A boot that already FAILED never opens the origin — red it NOW with the
  # failing lines instead of burning the whole deadline (the android twin
  # reads the same early verdict from logcat; here the live log stream makes
  # it one grep). The post-origin window is still covered by the full-corpus
  # FAIL scan below.
  if grep -qE 'FAIL |runtime failed|bootstrap failed' "$LOG_STREAM" 2>/dev/null; then
    grep -nE 'FAIL |runtime failed|bootstrap failed' "$LOG_STREAM" | head -10 > "$OUT/fail-lines.txt" || true
    cp "$LOG_STREAM" "$OUT/boot-window.log" 2>/dev/null || true
    die "the boot failed before opening the origin: $(head -1 "$OUT/fail-lines.txt")"
  fi
  if [ -z "$token" ]; then
    # SessionServe.maybeOpenOrigin: NSLog("dsh.serve: origin token=%@", token)
    # (`|| true`: a no-match grep must not trip `set -e -o pipefail` — the
    # poll is SUPPOSED to run again, not die.)
    token=$(grep -o 'dsh\.serve: origin token=[0-9a-f]\{32\}' "$LOG_STREAM" 2>/dev/null \
      | head -1 | sed 's/.*token=//' || true)
  fi
  if [ -n "$token" ] && [ -z "$port" ]; then
    app_pid=$(app_pid_for)
    if [ -n "$app_pid" ]; then
      # Exactly ONE loopback listener is the carrier's shape (NWListener bound
      # to 127.0.0.1, ephemeral port). Zero = still binding; more than one =
      # an unexpected seat, fail loud naming them (rule 5).
      listeners=$(lsof -nP -iTCP -sTCP:LISTEN -a -p "$app_pid" 2>/dev/null \
        | grep -o '127\.0\.0\.1:[0-9]*' | sort -u || true)
      count=$(printf '%s\n' "$listeners" | grep -c '[0-9]' || true)
      if [ "$count" -eq 1 ]; then
        port=${listeners#*:}
      elif [ "$count" -gt 1 ]; then
        cp "$LOG_STREAM" "$OUT/boot-window.log" 2>/dev/null || true
        die "app pid $app_pid holds $count loopback listeners — expected exactly one (the carrier); got: $(printf '%s ' $listeners)"
      fi
    fi
  fi
  [ -n "$token" ] && [ -n "$port" ] || sleep 2
done
say "carrier serving on 127.0.0.1:$port, origin token harvested ($(date +%s) - $boot_started s after launch)"

# ---- the diagnostics seam: GET /api/state with the token, polled until 200.
# The body must carry the runtime's claimedEndpoints and the app block — the
# same bar the android release-seat leg asserts on its /api/state read. ----
api_body="$OUT/api-state.json"
code=000
deadline=$(( $(date +%s) + API_DEADLINE ))
while : ; do
  code=$(curl -s -o "$api_body" -w "%{http_code}" --max-time 5 \
    "http://127.0.0.1:$port/api/state?token=$token" || echo 000)
  [ "$code" = "200" ] && break
  [ "$(date +%s)" -ge "$deadline" ] && {
    cp "$LOG_STREAM" "$OUT/boot-window.log" 2>/dev/null || true
    die "GET /api/state never answered 200 within ${API_DEADLINE}s (last: $code) — the diagnostics seam is down on a supposedly serving origin"
  }
  sleep 2
done
grep -q '"claimedEndpoints"' "$api_body" || die "/api/state answered 200 without claimedEndpoints — not the bridge snapshot this seat serves: $(head -c 300 "$api_body")"
grep -q '"app"' "$api_body" || die "/api/state answered 200 without the app block: $(head -c 300 "$api_body")"
say "/api/state: 200, claimedEndpoints + app present"

# ---- page-open evidence: the page's own session with the carrier. No
# WebView devtools exists on iOS, so the proxies are (a) a connection to the
# carrier port that PERSISTS across two polls — the page's mux/WS session;
# this script's own curl is transient and not in flight here — and (b)
# page-driven token-authed /api traffic beyond this script's single
# /api/state probe. The loop-t bug's shape (url stays '', zero FAIL lines)
# times out here exactly like it does on android. ----
page_opened=no
deadline=$(( $(date +%s) + DEADLINE ))
while [ "$(date +%s)" -lt "$deadline" ]; do
  if lsof -nP -iTCP:"$port" -sTCP:ESTABLISHED 2>/dev/null | grep -q ESTABLISHED; then
    sleep 3   # persistence probe: a second look after the transient window
    if lsof -nP -iTCP:"$port" -sTCP:ESTABLISHED 2>/dev/null | grep -q ESTABLISHED; then
      page_opened=yes
      break
    fi
  fi
  page_api_lines=$(grep -cE 'dsh\.bridge: api path=/api/' "$LOG_STREAM" 2>/dev/null || true)
  # This script drove exactly one /api/state probe by now; any authed api
  # line on a path BESIDE it is the page's own traffic.
  if [ "${page_api_lines:-0}" -gt 1 ] || \
     grep -E 'dsh\.bridge: api path=/api/' "$LOG_STREAM" 2>/dev/null \
       | grep -qv 'path=/api/state '; then
    page_opened=yes
    break
  fi
  sleep 3
done
[ "$page_opened" = yes ] || {
  cp "$LOG_STREAM" "$OUT/boot-window.log" 2>/dev/null || true
  die "the page never opened within ${DEADLINE}s of the origin line — no persistent carrier session, no page-driven /api traffic (the settings.probes.done -> maybeOpenOrigin gate is broken again?)"
}
established=$(lsof -nP -iTCP:"$port" -sTCP:ESTABLISHED 2>/dev/null | grep -c ESTABLISHED || true)
say "page opened: persistent carrier session ($established established connection(s) on $port)"

# ---- zero failure lines from the boot window (a fail-open pass on a failing
# boot would hide a producer regression; on a passing boot any FAIL is a
# finding). All three spellings are NSLog channels that survive the release
# log regime. ----
if grep -nE 'FAIL |runtime failed|bootstrap failed' "$LOG_STREAM" >/dev/null 2>&1; then
  grep -nE 'FAIL |runtime failed|bootstrap failed' "$LOG_STREAM" | head -10 > "$OUT/fail-lines.txt" || true
  cp "$LOG_STREAM" "$OUT/boot-window.log" 2>/dev/null || true
  die "the fresh boot logged a failure line — the origin opened only through a fail-open path or the seat failed after serving: $(head -1 "$OUT/fail-lines.txt")"
fi

# ---- evidence: the boot window's corpus, the seam body, one screenshot
# (LOCAL debugging evidence only — never an assertion), and the receipt. ----
cp "$LOG_STREAM" "$OUT/boot-window.log" 2>/dev/null || true
cp "$api_body" "$OUT/api-state.json" 2>/dev/null || true
xcrun simctl io "$UDID" screenshot "$OUT/screenshot.png" >/dev/null 2>&1 || true
boot_seconds=$(( $(date +%s) - boot_started ))
TREE_LINE="origin/main $(git rev-parse --short=12 HEAD)$(git diff-index --quiet HEAD -- || echo ' (dirty working tree at receipt time)')"
RUN_ID="${GITHUB_RUN_ID:-}"
DSH_PAGEOPEN_RECEIPT="$OUT/receipt.json" \
DSH_PAGEOPEN_FIELDS="udid=$UDID|app=$APP|port=$port|boot_seconds=$boot_seconds|tree=$TREE_LINE|run_id=$RUN_ID|log_lines=$(wc -l < "$LOG_STREAM" | tr -d ' ')|page_opened=$page_opened|api_code=$code" \
python3 - <<'PY'
import json, os, sys
out = os.environ["DSH_PAGEOPEN_RECEIPT"]
fields = dict(kv.split("=", 1) for kv in os.environ["DSH_PAGEOPEN_FIELDS"].split("|"))
receipt = {
    "scenario": "ios-page-open",
    "outcome": "pass",
    "udid": fields["udid"],
    "app": fields["app"],
    "carrier": {"origin": "http://127.0.0.1:%s" % fields["port"], "port": int(fields["port"]),
                 "token": "<redacted> (never leaves the unified log; android twin's discipline)"},
    "assertions": {
        "serving_origin_line": True,
        "single_loopback_listener": True,
        "api_state_200_claimed_endpoints_app": True,
        "page_opened": fields["page_opened"] == "yes",
        "zero_fail_lines": True,
    },
    "boot_seconds": int(fields["boot_seconds"]),
    "log_lines": int(fields["log_lines"]),
    "api_state_code": int(fields["api_code"]),
    "tree": fields["tree"],
    "runner": "hosts/ios/ci/run-page-open.sh",
}
if fields["run_id"]:
    # check.mjs's provenance discipline: a verdict is only reported when
    # THIS run produced it (dev-ios.yml's Report-verdict loop reads this).
    receipt["runId"] = fields["run_id"]
with open(out, "w") as fh:
    json.dump(receipt, fh, indent=2)
    fh.write("\n")
PY
[ -f "$OUT/receipt.json" ] || die "the receipt writer lied (file absent) — refusing to record"
say "receipt: $OUT/receipt.json"
say "PASS: fresh boot, carrier 127.0.0.1:$port, origin token gate fired, page session live, no failure lines"
