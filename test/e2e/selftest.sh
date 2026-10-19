#!/usr/bin/env bash
# test/e2e/selftest.sh — proves the checker logic against the synthetic
# fixtures in testdata/ (rule 6: a gate that never fails is vacuous).
#
#   positive:  gateway.positive.txt must PASS gateway-binding.json AND
#              gateway-audit.json (one file drives both, proving the two
#              extraction prefixes isolate their streams).
#   negative:  gateway-binding.negative.txt must FAIL at expected index 4
#              (fs.denied code); gateway-audit.negative.txt must FAIL at
#              expected index 2 (fsRead denied/denied).
#
# usage: selftest.sh   (exit 0 = all assertions hold)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FAILURES=0

expect_pass() { # $1=manifest $2=log
  if node test/e2e/check.mjs --manifest "$1" --log "$2" --out "$TMP/v.json" >/dev/null 2>&1; then
    echo "selftest: PASS  $(basename "$1") accepts $(basename "$2")"
  else
    echo "selftest: FAIL  $(basename "$1") should accept $(basename "$2")"; FAILURES=$((FAILURES + 1))
  fi
}

expect_fail_at() { # $1=manifest $2=log $3=expected first failure index
  if node test/e2e/check.mjs --manifest "$1" --log "$2" --out "$TMP/v.json" >/dev/null 2>&1; then
    echo "selftest: FAIL  $(basename "$1") should reject $(basename "$2")"; FAILURES=$((FAILURES + 1)); return 0
  fi
  local idx
  idx=$(python3 -c 'import json,sys; v=json.load(open(sys.argv[1])); f=v.get("failures") or [{}]; print(f[0].get("index", "none"))' "$TMP/v.json")
  if [ "$idx" = "$3" ]; then
    echo "selftest: PASS  $(basename "$1") rejects $(basename "$2") at index $idx (as expected)"
  else
    echo "selftest: FAIL  $(basename "$1") rejects $(basename "$2") at index $idx, expected $3"; FAILURES=$((FAILURES + 1))
  fi
}

BIND=test/e2e/scenarios/gateway-binding.json
AUDIT=test/e2e/scenarios/gateway-audit.json
TD=test/e2e/testdata

expect_pass "$BIND" "$TD/gateway.positive.txt"
expect_pass "$AUDIT" "$TD/gateway.positive.txt"
expect_fail_at "$BIND" "$TD/gateway-binding.negative.txt" 4
expect_fail_at "$AUDIT" "$TD/gateway-audit.negative.txt" 2
# Regression guard: the flat-envelope change must not disturb the logger
# envelope — the slimmed m1 fixture (derived from the committed M1 capture,
# non-deterministic fields stripped) still passes its manifest.
expect_pass test/e2e/scenarios/boot-verification.json test/e2e/testdata/boot-verification.positive.txt
# Repeat expectations (the real-LLM legs' nondeterministic delta counts):
# one-or-more deltas at the repeated position pass; ZERO deltas fail AT the
# repeat expectation; a delta straying past stream.completed is extra.
REPEAT=test/e2e/testdata/llm-live-stream-repeat.json
expect_pass "$REPEAT" "$TD/llm-live-stream-repeat.positive.txt"
expect_fail_at "$REPEAT" "$TD/llm-live-stream-repeat.negative-zero.txt" 1
expect_fail_at "$REPEAT" "$TD/llm-live-stream-repeat.negative-extra.txt" none
# order:"any" expectations (records whose position races other recorded
# events, e.g. the b4 journal attach among the page's concurrent RPC
# answers): a mid-burst record is claimed wherever it sits; a MISSING record
# fails at the any-row; a DUPLICATE leaves one as extra.
ANY=test/e2e/testdata/order-any.json
expect_pass "$ANY" "$TD/order-any.positive.txt"
expect_fail_at "$ANY" "$TD/order-any.negative-missing.txt" -1
expect_fail_at "$ANY" "$TD/order-any.negative-extra.txt" 2
# extract.skip (records dropped at extraction — the gateway audit manifests
# of the mic legs skip the micFrames idle window's nondeterministic
# timerSchedule/timerCancel rows, gateway.js's #397 timer seam): the
# interleaved stream passes WITH skip and fails at the interleave WITHOUT
# it (skip is doing the work); a skipped stream still fails on a MISSING
# covered row (skip is not a pass-through).
SKIP=test/e2e/testdata/extract-skip.json
expect_pass "$SKIP" "$TD/extract-skip.positive.txt"
expect_fail_at test/e2e/testdata/extract-skip.noskip.json "$TD/extract-skip.positive.txt" 1
expect_fail_at "$SKIP" "$TD/extract-skip.negative-missing.txt" 2

# Layout-truth probe (ui.occlusion, test/e2e/ui-probe.mjs): GEOMETRY enters
# the same assertion currency — the probe emits its record onto the probe
# stream and the SAME checker judges it. The synthetic fixtures reproduce
# the #179 class (a native bar painted over the web surface: log-verified
# drives cannot see it, touches at the dead coordinates never arrive):
#   uiautomator face — the clean (post-fix) tree passes; the action-bar
#   occlusion dump fails AT the probe row, and the failure record NAMES the
#   occluder (that list is the diagnosis); the WDA face round-trips both.
#   A dump without a WebView and an unparsable dump are loud probe errors
#   (exit 2) — a probe that silently scanned nothing is a vacuous pass.
PROBE="node test/e2e/ui-probe.mjs"
UIOC=test/e2e/scenarios/ui-occlusion.json

$PROBE --dump "$TD/ui-probe-clean.uiautomator.xml" --scenario ui.occlusion \
    --append "$TMP/uia-clean.log" >/dev/null
expect_pass "$UIOC" "$TMP/uia-clean.log"

$PROBE --dump "$TD/ui-probe-occlusion.uiautomator.xml" --scenario ui.occlusion \
    --append "$TMP/uia-occ.log" >/dev/null
expect_fail_at "$UIOC" "$TMP/uia-occ.log" 0
grep -q 'DSH Dsh Host' "$TMP/v.json" ||
  { echo "selftest: FAIL  occlusion verdict does not name the occluder"; FAILURES=$((FAILURES + 1)); }

$PROBE --dump "$TD/ui-probe-clean.wda.json" --scenario ui.occlusion \
    --append "$TMP/wda-clean.log" >/dev/null
expect_pass "$UIOC" "$TMP/wda-clean.log"

$PROBE --dump "$TD/ui-probe-occlusion.wda.json" --scenario ui.occlusion \
    --append "$TMP/wda-occ.log" >/dev/null
expect_fail_at "$UIOC" "$TMP/wda-occ.log" 0

$PROBE --dump "$TD/ui-probe-no-webhost.uiautomator.xml" --scenario ui.occlusion \
    --append "$TMP/none.log" >/dev/null 2>&1 &&
  { echo "selftest: FAIL  a dump without a web host must fail loud"; FAILURES=$((FAILURES + 1)); } ||
  echo "selftest: PASS  a dump without a web host fails loud (exit 2)"
printf '<hierarchy><node class="android.webkit.WebView" bounds="[0,0' > "$TMP/broken.xml"
$PROBE --dump "$TMP/broken.xml" --scenario ui.occlusion >/dev/null 2>&1 &&
  { echo "selftest: FAIL  an unparsable dump must fail loud"; FAILURES=$((FAILURES + 1)); } ||
  echo "selftest: PASS  an unparsable dump fails loud (exit 2)"

# "optional": true expectations (records the PAGE may or may not produce per
# boot — the official composer's catalog probe fires skills/list on one boot
# and commands/list on the next): either family member in position passes;
# a foreign record at the position still fails (optional is not a wildcard).
OPT=test/e2e/testdata/order-optional.json
expect_pass "$OPT" "$TD/order-optional.positive-skills.txt"
expect_pass "$OPT" "$TD/order-optional.positive-commands.txt"
# a foreign record at the optional position surfaces at the NEXT pinned row
# (optional skips, the position stays): the rejection is index 3, not 1.
expect_fail_at "$OPT" "$TD/order-optional.negative-foreign.txt" 3

# "optional" composes with "any" (the catalog probe's position AND presence
# both vary by boot): absent passes silently; present-anywhere (even after
# the last ordered row) is claimed.
AO=test/e2e/testdata/order-any-optional.json
expect_pass "$AO" "$TD/order-any-optional.absent.txt"
expect_pass "$AO" "$TD/order-any-optional.present-late.txt"

# ---- #515: the m1 harness verdict — environment vs product (classify.mjs) --
# The checker says WHICH expectations went unmet; the classifier says WHAT
# CLASS of red it is, from the verdicts + the launch probes (both pure
# functions, so fixtures suffice — no simulator on the test path). Faces:
#   green fixture            -> exit 0, and NO receipt is written (a green
#                               run carries no apology);
#   zero-structured-lines    -> environment / app-never-ran (the old bare
#                               "the app never ran" gate, now classified);
#   boot-only capture        -> environment / scenario-silent (carrier's
#                               factual start record never landed: 0/7);
#   #514's attempt-1 shape   -> environment / tail-stall, AND the carrier
#                               verdict is field-identical to run
#                               38707261173 attempt 1 (pass:false 2/7,
#                               failures idx 2-6 all logged:null, no
#                               parseErrors) — the fixture IS that run;
#   present-but-wrong record -> PRODUCT (exit 1): ws.echo logged
#                               matched:false — a mis-answer no retry fixes;
#   wrong record + rc!=0     -> still PRODUCT: crash evidence never masks a
#                               mis-answer (product beats environment);
#   zero-byte log + rc!=0    -> environment / launch-crash (the WebKit
#                               dyld-abort class).
# Every environment face also asserts the receipt: classification
# environment, pass false, and the four fields matrix.mjs reads from any
# verdict*.json present and type-true, so a committed receipt reads as an
# honest red in the matrix gate, never a fake green.
CLASSIFY="node test/e2e/classify.mjs"
BOOTM=test/e2e/scenarios/boot-verification.json
CARRM=test/e2e/scenarios/carrier-loopback.json
GREEN=test/e2e/testdata/m1-green.txt

# run_both <log>: both checkers on one capture, verdicts to $TMP/b.json and
# $TMP/c.json — the m1 leg's one-launch-two-scenarios shape.
run_both() {
  node test/e2e/check.mjs --manifest "$BOOTM" --log "$1" --out "$TMP/b.json" >/dev/null 2>&1 || true
  node test/e2e/check.mjs --manifest "$CARRM" --log "$1" --out "$TMP/c.json" >/dev/null 2>&1 || true
}

# expect_class <launch-rc> <runtime-lines> <want-rc> <want-classification> <want-shape>
# A receipt exists ONLY on the environment face (exit 3) — green and product
# carry their verdict in the verdicts, not in a receipt.
expect_class() {
  rm -f "$TMP/env.json"
  local rc=0
  $CLASSIFY --verdict "$TMP/b.json" --verdict "$TMP/c.json" \
    --launch-rc "$1" --runtime-lines "$2" --ui-wait no --sequence no --attempt 1 \
    --out "$TMP/env.json" >/dev/null 2>&1 || rc=$?
  local got want
  got=$(python3 -c 'import json,sys
try:
    v = json.load(open(sys.argv[1]))
    print(v.get("classification", "?"), v.get("shape", "?"))
except Exception:
    print("no-receipt")' "$TMP/env.json" 2>/dev/null || echo "no-receipt")
  want="$4 $5"
  [ "$3" = "3" ] || want="no-receipt"
  if [ "$rc" = "$3" ] && [ "$got" = "$want" ]; then
    echo "selftest: PASS  classify -> $4/$5 (exit $rc, receipt: $got)"
  else
    echo "selftest: FAIL  classify expected $3/$4/$5, got exit $rc receipt=$got"; FAILURES=$((FAILURES + 1))
  fi
}

# receipt_honest <want-pass>: the environment receipt names itself truthfully
# and stays matrix-parseable (FIELD_TYPES: scenario string, pass boolean,
# expected number, logged number — matrix.mjs:142).
receipt_honest() {
  if python3 -c 'import json,sys
v = json.load(open(sys.argv[1]))
ok = (v["classification"] == "environment" and v["status"] == "environment"
      and v["pass"] is False and "reason" in v and "probes" in v
      and isinstance(v["scenario"], str) and isinstance(v["pass"], bool)
      and isinstance(v["expected"], int) and isinstance(v["logged"], int))
sys.exit(0 if ok else 1)' "$TMP/env.json" 2>/dev/null; then
    echo "selftest: PASS  environment receipt is honest and matrix-parseable"
  else
    echo "selftest: FAIL  environment receipt missing/malformed/dishonest"; FAILURES=$((FAILURES + 1))
  fi
}

run_both "$GREEN"
expect_pass "$BOOTM" "$GREEN"
expect_pass "$CARRM" "$GREEN"
expect_class 0 15 0 green all-scenarios-pass
[ -f "$TMP/env.json" ] &&
  { echo "selftest: FAIL  a green run wrote an environment receipt"; FAILURES=$((FAILURES + 1)); } ||
  echo "selftest: PASS  a green run writes no environment receipt"

run_both "$TD/m1-env-zerolines.txt"
expect_class 0 0 3 environment app-never-ran
receipt_honest

run_both "$TD/m1-env-wrongscenario.txt"
expect_class 0 8 3 environment scenario-silent
receipt_honest

run_both "$TD/m1-env-tail-stall.txt"
expect_class 0 10 3 environment tail-stall
receipt_honest
# The fixture IS #514's attempt-1 (run 38707261173): the carrier verdict must
# reproduce it field-for-field, or the shape's name is honest but its anchor
# is not.
if python3 -c 'import json,sys
v = json.load(open(sys.argv[1]))
f = v["failures"]
ok = (v["pass"] is False and v["expected"] == 7 and v["logged"] == 2
      and v["parseErrors"] == [] and [x["index"] for x in f] == [2, 3, 4, 5, 6]
      and all(x["logged"] is None for x in f))
sys.exit(0 if ok else 1)' "$TMP/c.json" 2>/dev/null; then
  echo "selftest: PASS  tail-stall verdict reproduces run 38707261173 attempt-1 field-for-field"
else
  echo "selftest: FAIL  tail-stall verdict drifted from run 38707261173 attempt-1"; FAILURES=$((FAILURES + 1))
fi

run_both "$TD/m1-product-wrongvalue.txt"
expect_class 0 15 1 product assertion-failure

run_both "$TD/m1-product-wrongvalue.txt"
expect_class 3 15 1 product assertion-failure

: > "$TMP/empty.log"
run_both "$TMP/empty.log"
expect_class 3 0 3 environment app-never-ran
receipt_honest

if [ "$FAILURES" -gt 0 ]; then
  echo "selftest: $FAILURES failure(s)"; exit 1
fi
echo "selftest: all checker + classifier assertions hold"
