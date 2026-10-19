# the m1 red gets a class: environment verdicts, one honest retry (#515)

Status: implemented
Date: 2026-10-19
Class: testing
Related: #514 (run 38707261173 attempt 1: boot 8/8 green, carrier 2/7 then
silence — read as a product regression), #515, the harmony matrix-skip
precedent (tools/test/run-simulator-matrix.sh:839-885), write-receipt.sh's
honesty law, T-0265

## Problem

The m1 CI leg has exactly two outcomes: green or a product red. Both are
dishonest for one family of failures — the simulator/harness stopping. #514's
attempt 1 was that class in the wild: the app launched (rc 0), boot.verification
passed 8/8, carrier.loopback logged 2 of 7 events and then the drive went
silent; every missing expectation was a trailing one. The checker could only
say "the expected events did not all appear" — it cannot say WHY — so the run
reddened the PR as an apparent carrier regression and nobody could tell,
from the verdict, that the sibling scenario had completed green on the same
launch. The issue's first-cut discriminator ("zero expected events hit AND no
scenario-start") could not even classify this real failure: it was a 2/7
partial hit, and the runtime emits no scenario-start record at all (each
scenario's first emit, `runtime.created`, IS the factual start —
runtime/dsh/scenario/boot-verification.js:29). And the only alternative to a
misread red was worse: retrying unconditionally, which converts a flake into
a green that hides it, or converting a stall into a "skip" — a green that
verifies nothing.

## Decision

- **`test/e2e/classify.mjs`** — the harness verdict, a pure function of
  (verdicts, probes) so fixtures prove it (selftest.sh, no simulator on the
  test path). Rules in order: every verdict pass → GREEN; any failing verdict
  with product evidence (parseErrors, a present-but-mismatched record, extra
  records) → PRODUCT; otherwise environment shapes in turn — zero
  `dsh.runtime.log` lines (app-never-ran), non-zero `simctl launch` rc
  (launch-crash), a failing scenario with logged:0 (scenario-silent —
  "zero expected events AND no scenario-start", landed as a COUNT, no new
  event, no frozen-manifest drift), all missing expectations the contiguous
  trailing block with a green sibling shape (tail-stall, the #514 shape).
  Residual → PRODUCT: an unexplained red is never masked as environment.
  Exit contract 0/1/3 (green/product/environment), 2 unusable.
- **The receipt** (`verdict-environment.json`, written ONLY on the
  environment face, mirrored into both m1 artifact dirs) mirrors the harmony
  matrix-skip shape: full-sentence reason ending "Never faked: pass stays
  false; the retry may earn the green, this attempt did not.", probes
  carrying the measured facts (launchRc, runtime-line count, per-scenario
  logged/expected/pass, ui-wait/sequence markers, attempt), tree line,
  producedAt — plus the four fields matrix.mjs reads from any verdict*.json,
  so a committed one reads as an honest red in the matrix gate (known-gaps
  register), never a fake green.
- **`test/e2e/run-ios-m1.sh`** — one attempt of the m1 leg, extracted
  verbatim (mechanics and the hard-won comments) from dev-ios.yml's dsh-run
  step; runs both checkers (both always), then classify, and maps the class
  to its exit code. The old bare "no dsh.runtime.log lines → exit 1" gate is
  now the classified app-never-ran verdict: still red, now saying why.
- **The retry lives in the workflow step, at most once, only on exit 3**
  (in-step `for attempt` loop, the dev-harmonyos.yml precedent) — never in
  run-ios-m1.sh (it owns one attempt) and never in check.mjs (it must stay a
  pure checker or selftest.sh proves nothing). Before retrying, attempt-1's
  whole artifact dirs move to m1-*.attempt1/: every attempt of one workflow
  shares GITHUB_RUN_ID, so a stale verdict at the canonical path would pass
  the "Report verdict" provenance check. Attempt-2 green → the green IS the
  verdict, the flake's receipt rides the artifacts; twice environment-red →
  the step stays red with both receipts attached (a reproduced stall is a
  real problem, not a flake).
- **Fixtures** (test/e2e/testdata/m1-*.txt): green (one launch, both
  scenarios complete), zero-structured-lines, boot-only capture, the #514
  attempt-1 replica (field-for-field asserted against run 38707261173:
  pass:false 2/7, failures idx 2-6 all logged:null, parseErrors:[]), and a
  present-but-wrong record. selftest.sh grows a classify section proving
  every face including precedence (crash rc≠0 never masks a mis-answer) and
  receipt honesty/matrix-parseability; its summary moved to EOF (the
  trailing optional/any-optional faces used to increment FAILURES after the
  only exit check — a failure there still exited 0).
- **dev-ios.yml**: "Report verdict" also prints any environment receipt
  (final + .attempt1) into the step summary; the artifact upload lists the
  .attempt1 dirs.

## Alternatives considered

- **Add a structured `scenario.start` event** (the issue's literal
  discriminator): rejected — it would grow every frozen manifest's expected
  count, drift every historical verdict (matrix drift rows), and add a fact
  the log already carries (the first emit per scenario). The count-based
  forms (logged:0; trailing-block silence) express the same intent without
  touching the manifests.
- **Classify inside check.mjs** (a `classification` field on the verdict):
  rejected — check.mjs is a pure per-manifest function; sibling-scenario and
  launch-probe facts do not belong to one manifest's checker, and putting
  retry-shaped logic there would break the fixture-proof property selftest
  relies on.
- **Retry unconditionally (or in run-ios-m1.sh)**: rejected — an
  unconditional retry hides the flake instead of recording it, and a product
  red retried is wasted macOS minutes pointing at a regression that will not
  fix itself. The environment-only trigger is exactly what the verdict
  classification buys.
- **Mark the environment red as a SKIP (harmony D-g style, step green)**:
  rejected — this leg CAN run (the skip precedent is for legs whose hardware
  is absent); a stall on a runnable leg stays a red, with the receipt
  carrying the why. Only the pass-false record shape is mirrored, never the
  green-washing.

## Consequences

- A #514-shaped run now costs one extra simulator attempt instead of a
  misread regression; a genuinely flaky simulator shows up as
  green-with-a-receipt instead of red, and the receipt is the flake's
  evidence trail.
- The known-gaps register is untouched today (CI artifacts are not
  committed); if a local runner ever commits an environment receipt, the
  matrix gate will flag the pass:false and force an owned register row —
  the receipt was designed to be seen, honestly, wherever it lands.
- selftest.sh's gateway faces were ALREADY red on pristine main (the
  gateway-binding/gateway-audit fixtures drifted from the grown manifests —
  descriptor 33→37 plus added event families; proven by stashing this
  change and re-running). Out of #515's scope; recorded here and in the
  surprise ledger because anyone running selftest.sh on main hits it before
  any new face.
