#!/usr/bin/env bash
# test/e2e/run-ios-boot-carrier.sh — ONE attempt of the boot-carrier CI leg: boot.verification +
# carrier.loopback in one simulator launch, verified by the shared checker
# (test/e2e/check.mjs — logs are the verdict, screenshots are never asserted
# on), then CLASSIFIED by test/e2e/classify.mjs (#515): green, product red, or
# an explicit environment red with a machine-written receipt (the harmony
# matrix-skip precedent — never a fake green, never a silent pass).
#
# Extracted verbatim (mechanics + the hard-won comments) from
# .github/workflows/dev-ios.yml's dsh-run step so the step can run an attempt
# loop: at most ONE retry, ONLY on an environment-class red (exit 3). The
# retry lives in the workflow step — the in-step `for attempt` precedent is
# dev-harmonyos.yml — never inside check.mjs, which stays a pure function
# (log in, verdict out; selftest.sh's fixture proofs depend on that).
#
# usage: run-ios-boot-carrier.sh <attempt 1|2>
# exit: 0 green | 1 product-class red (a retry cannot fix a regression)
#       | 2 usage | 3 environment-class red (the caller may retry ONCE)
#
# On an environment classification the receipt (verdict-environment.json) is
# written into BOTH artifact dirs; the caller moves attempt-1's whole dirs
# aside (boot-carrier-*.attempt1/) before retrying, so attempt-2's verdicts own the
# canonical paths: every attempt of one workflow shares GITHUB_RUN_ID, and a
# stale same-run verdict left at the canonical path would pass the "Report
# verdict" provenance check as if it were this attempt's product.
# (renamed from run-ios-m1.sh, 2026-10-20 — 'm1' named the first-spike milestone and collides with Apple's M1)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

case "${1:-}" in
  1|2) ATTEMPT="$1" ;;
  *) echo "usage: run-ios-boot-carrier.sh <attempt 1|2>" >&2; exit 2 ;;
esac

ART=hosts/ios/artifacts/boot-carrier-dsh
ART2=hosts/ios/artifacts/boot-carrier-carrier
mkdir -p "$ART" "$ART2"
# Match any iPhone device line regardless of name suffix ("iPhone 16",
# "dsh-iphone", …) — the literal 'iPhone (' never occurs in stock
# runner device names, which silently disabled this stage.
# Same PINNED preference list as the prewarm step in dev-ios.yml — see the
# comment there for why it is a preference and not a hard pin.
UDID=""
for want in "iPhone 16 Pro" "iPhone 17" "iPhone 16" "iPhone 15"; do
  UDID=$(xcrun simctl list devices available | grep -F "$want (" \
    | grep -m1 -oE '[A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12}' || true)
  [ -n "$UDID" ] && break
done
if [ -z "$UDID" ]; then
  echo "::warning::no preferred simulator on this runner — falling back to any iPhone, which weakens run-to-run comparability"
  UDID=$(xcrun simctl list devices available | grep -iE 'iphone' \
    | grep -m1 -oE '[A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12}' || true)
fi
[ -n "$UDID" ] || { echo "::warning::no available iPhone simulator on this runner"; exit 1; }
echo "using simulator $UDID (attempt $ATTEMPT)"
xcrun simctl boot "$UDID" || true
xcrun simctl bootstatus "$UDID" -b
# `bootstatus -b` returns early on an already-booted device, and on the
# first boot of a freshly downloaded runtime it can return before
# SpringBoard is up — the launch is then denied (SBMainWorkspace,
# code=1). Poll a real readiness condition with a deadline; never a
# fixed sleep.
for _ in $(seq 1 30); do
  xcrun simctl spawn "$UDID" launchctl print system >/dev/null 2>&1 && break
  sleep 1
done
xcrun simctl spawn "$UDID" launchctl print system >/dev/null 2>&1 \
  || echo "::warning::simulator readiness probe never succeeded — continuing, but the launch may be denied"
xcrun simctl install "$UDID" hosts/ios/DerivedData/Build/Products/Debug-iphonesimulator/DSHHost.app
# simctl launch APPENDS to the capture files; the committed evidence
# from the local run must go so the checker sees only this run.
rm -f "$ART/logs.txt" "$ART/nslog-stderr.txt"
# Capture the launch outcome; do not let it abort the attempt.
# `simctl launch` exits 3 when the app launched and then exited or
# crashed (FBSOpenApplicationServiceErrorDomain, code=3) — measured on
# run 35610169977, where `set -e` then killed the step BEFORE the
# wait loop and the checkers ran, so CI reported green having
# verified nothing at all. The launch result is EVIDENCE, not a
# control-flow signal: record it loudly, keep going, and let the
# checkers say what the captured log supports. A crash then shows up
# as failed verdicts (the honest outcome) — classified environment by
# classify.mjs, since a crash's missing events are the crash's, not a
# product regression's.
# ROOT CAUSE of the launch crash (measured, not guessed): the binary
# hard-links /usr/lib/swift/libswiftWebKit.dylib because exactly one
# symbol comes from the WebKit Swift overlay (WKWebView
# .callAsyncJavaScript, NS_REFINED_FOR_SWIFT). On the iOS 18.5
# simulator that path does not exist under RuntimeRoot — only under
# System/Cryptexes/OS — so dyld aborts BEFORE main() and the app
# produces a 0-byte log. Upstream defect: WebKit bug 293831, hitting
# apps whose deployment target is <= 18.3 (this project: 17.0). Real
# devices are unaffected. Verified on the exact runtime (22F77):
# 7/7 launches died without this, 3/3 succeeded with it, and it is
# harmless on a runtime that already has the path.
RTKEY=$(xcrun simctl list devices --json | python3 -c "import json,sys; d=json.load(sys.stdin)['devices']; print(next(k for k,vs in d.items() for v in vs if v['udid']=='$UDID'))")
RUNTIME_ROOT=$(xcrun simctl list runtimes --json | python3 -c "import json,sys; print(next(r['runtimeRoot'] for r in json.load(sys.stdin)['runtimes'] if r['identifier']=='$RTKEY'))")
echo "runtime: $RTKEY"
launch_rc=0
SIMCTL_CHILD_DYLD_FALLBACK_LIBRARY_PATH="$RUNTIME_ROOT/System/Cryptexes/OS/usr/lib/swift" \
xcrun simctl launch --terminate-running-process \
  --stdout="$PWD/$ART/logs.txt" \
  --stderr="$PWD/$ART/nslog-stderr.txt" \
  "$UDID" org.dsh.DSHHost || launch_rc=$?
if [ "$launch_rc" != "0" ]; then
  echo "::error::simctl launch exited $launch_rc — the app launched and then exited or crashed. Captured log + screenshot are uploaded; the checks below run on whatever was captured."
fi
# A failed launch can leave no capture file at all; a 0-byte log is the
# honest capture (nothing was produced) and keeps the checkers + classifier
# runnable on this attempt's evidence.
[ -f "$ART/logs.txt" ] || : > "$ART/logs.txt"
# One launch drives the two m1 scenarios and then the UI-driven m2
# leg; wait with a deadline — never a blind sleep. On CI nobody can
# tap the m2 prompts, so the run stalls at the first `rt:
# ui-wait` marker; accepting that marker as the stop condition lets
# the m1 checks still run on the captured m1 lines (all m1 events
# are complete before the UI-driven leg starts). Locally, via
# test/e2e/run-ios.sh, the terminal `rt: sequence` marker
# appears as before.
# Stop on the terminal marker, OR once the log has gone QUIET with
# the app having emitted: measured on CI, `simctl launch` returns and
# the m1 events are all written, but the terminal marker never comes
# because the UI-driven m2 leg cannot be tapped. The old marker-only
# condition then exited 1 before the checkers ran, so real evidence on
# disk went unverified and every green run carried a red annotation.
# Idle is asserted (no new bytes for 8 x 2 s), never a blind sleep.
last=-1; idle=0
for _ in $(seq 1 90); do
  grep -qE "rt: (sequence|ui-wait)" "$ART/logs.txt" 2>/dev/null && break
  now=$(wc -c < "$ART/logs.txt" 2>/dev/null || echo 0)
  if [ "$now" = "$last" ] && [ "$now" -gt 0 ]; then
    idle=$((idle + 1))
    [ "$idle" -ge 8 ] && break
  else
    idle=0
  fi
  last="$now"
  sleep 2
done
# The old hard gate here ("no dsh.runtime.log lines — the app never ran",
# a bare exit 1) is now a CLASSIFIED verdict: checkers still run on the
# empty capture (logged:0 verdicts are the honest record) and classify.mjs
# names the shape. Red stays red — it just says why.
grep -q "rt: sequence" "$ART/logs.txt" \
  || echo "::notice::terminal marker absent (the UI-driven m2 leg cannot be driven on CI) — the completed m1 scenarios are verified below. Expected, not a defect."
if grep -q "rt: ui-wait" "$ART/logs.txt" && ! grep -q "rt: sequence" "$ART/logs.txt"; then
  echo "::notice::run stalled at a UI-driven m2 prompt (no UI driver on CI) — the completed m1 scenarios are verified below. Expected, not a defect: see this attempt's header."
fi
xcrun simctl io "$UDID" screenshot "$ART2/screenshot.png" || true
grep '^dsh.runtime.log:' "$ART/logs.txt" > "$ART/scenario.jsonl" || true
cp "$ART/scenario.jsonl" "$ART2/scenario.jsonl"
# --junit writes the SAME verdict the --out file carries, rendered as
# JUnit XML (test/e2e/junit.mjs): the artifact a PR reporter turns
# into per-scenario annotations, so a red run names the scenario and
# the mismatched expectation instead of only reddening the step. It
# is written before the checker exits, so a FAILING run ships one too.
# Both checkers ALWAYS run. Under `set -e` a failing first checker
# aborted the attempt, so the second scenario produced no verdict and no
# JUnit XML — a real failure was partially invisible, which is the
# class of dishonesty this pipeline was just cleaned of. Accumulate
# the exit codes and classify at the end, so both verdicts and both
# XMLs are always authoritative.
check_rc=0
node test/e2e/check.mjs \
  --manifest test/e2e/scenarios/boot-verification.json \
  --log "$ART/logs.txt" \
  --out "$ART/verdict.json" \
  --junit "$ART/verdict.xml" || check_rc=1
node test/e2e/check.mjs \
  --manifest test/e2e/scenarios/carrier-loopback.json \
  --log "$ART/logs.txt" \
  --out "$ART2/verdict.json" \
  --junit "$ART2/verdict.xml" || check_rc=1
if [ "$check_rc" != "0" ]; then
  echo "::error::one or more m1 scenarios FAILED — the verdicts above are authoritative; classify.mjs names the class next"
fi
# THE #515 VERDICT: green, product red (a retry cannot fix a regression),
# or environment red (explicit receipt; the caller may retry once). The
# probes are this attempt's measured facts, not inferences.
ui_wait=no
grep -q "rt: ui-wait" "$ART/logs.txt" 2>/dev/null && ui_wait=yes || true
sequence=no
grep -q "rt: sequence" "$ART/logs.txt" 2>/dev/null && sequence=yes || true
runtime_lines=$(grep -c '^dsh.runtime.log:' "$ART/logs.txt" || true)
class_rc=0
node test/e2e/classify.mjs \
  --verdict "$ART/verdict.json" \
  --verdict "$ART2/verdict.json" \
  --launch-rc "$launch_rc" \
  --runtime-lines "$runtime_lines" \
  --ui-wait "$ui_wait" --sequence "$sequence" --attempt "$ATTEMPT" \
  --out "$ART/verdict-environment.json" || class_rc=$?
case "$class_rc" in
  0)
    echo "m1: GREEN (attempt $ATTEMPT) — both scenarios pass"
    exit 0
    ;;
  3)
    # Named existence guard after the write, then mirror into the sibling
    # dir — the matrix-skip receipt discipline (a writer that lies stops
    # the run, it does not get recorded).
    [ -f "$ART/verdict-environment.json" ] \
      || { echo "::error::the verdict-environment.json writer lied (file absent) — refusing to record"; exit 1; }
    cp "$ART/verdict-environment.json" "$ART2/verdict-environment.json"
    echo "::warning::attempt $ATTEMPT is an ENVIRONMENT-class red — $(sed -n 's/.*"reason": "\(.*\)",*/\1/p' "$ART/verdict-environment.json" | head -1)"
    exit 3
    ;;
  1)
    echo "::error::attempt $ATTEMPT is a PRODUCT red — the app mis-answered its manifest; no retry can fix a regression, the verdicts above are authoritative"
    exit 1
    ;;
  *)
    echo "::error::classify.mjs failed (exit $class_rc) — refusing to guess; treat as product red"
    exit 1
    ;;
esac
