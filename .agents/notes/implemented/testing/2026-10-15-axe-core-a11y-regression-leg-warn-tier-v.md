# Agent Note: axe-core a11y regression leg + warn-tier visual diff for web-client-v2

Status: implemented
Related: D6

## Problem

The web-client-v2 visual surface had exactly two nets over it, both manual:
the #519/#521 apple-design audit passes (hand-computed contrast, one-off
screenshots under `tools/dev-web-carrier/artifacts/ui-sweep/`) and nothing
else — a future tone-layer or layout regression turned nothing red. The
test-hardening program (doc/test-coverage.md rows 3-4) named the two missing
methods: an axe-core accessibility regression that makes the #519 audit
repeatable, and a visual pixel diff that catches unintentional rendering
changes. Both had a hard constraint to respect: this repo's E2E evidence is
log-based, so the visual half could never become a CI log assertion, and a
pixel diff needs deterministic frames from a page whose brand is animated
(ocean drift, pulsing status dot, blinking stream caret).

## Decision

One shared browser leg, two consumers, both riding the dev carrier's
next-mode seat (`dev-carrier.mjs --client next` serving
presentation/web-client-v2):

- `test/tools/helpers/carrier-page.mjs` — boots the carrier in-process,
  opens the page in the machine's installed Chrome (puppeteer-core;
  discovery: `$DSH_WEBREG_CHROME` → PATH → the macOS app bundle → fail
  loud naming every location tried), and drives the four audited states
  (onboarding / home / marketplace / session) with condition waits. The
  mobile viewport (390×844 @2x) is the #519 audit's; `prefers-reduced-motion:
  reduce` is emulated so the ambient loops stop — the #519 a11y answer is
  also what makes pixel baselines possible. The marketplace state's settled
  fact accepts either a verified-catalog line or the honest unenabled note
  (what the dev carrier answers).
- `tools/dev-web-carrier/axe-sweep.test.mjs` (row 3) — scans all four
  states in BOTH appearances under the WCAG 2.x A/AA tags and asserts zero
  critical/serious violations; below-gate impacts are printed as inventory,
  never asserted. It runs under the tools vitest face (the `tools` test
  glob in test/tools), so `tools/test/run-tools-tests.sh` and CI pick it up
  with no new wiring; ubuntu runners carry Google Chrome on PATH. A third
  test proves the net's teeth on every run (rule 6 posture): an injected
  nameless button must surface as a critical button-name violation.
- `tools/dev-web-carrier/visual-diff.mjs` (row 4) — captures the same
  eight frames, pixel-compares them against committed baselines
  (`artifacts/ui-sweep/baselines/`) with pixelmatch, and on drift over
  `--max-diff-pixels` (default 0) prints WARN lines, writes the diff image
  plus a verdict JSON under `tmp/dev-web-carrier/visual-diff/`, and exits
  non-zero. Warn-tier by construction: no gate or CI step invokes it —
  screenshots stay a local/PR signal. Baselines update only through the
  explicit `--update-baseline` command. The pure compare core
  (`test/tools/helpers/visual-diff-core.mjs`) has its own vitest leg
  (`visual-diff.test.mjs`) proving the threshold teeth on synthetic PNGs:
  identical frames green, one changed pixel red over a zero budget, the
  budget boundary exact, dimension drift fails loud.

Self-proof on this seat: the axe leg runs green on current main (8 scans,
0 critical/serious, 0 below-gate — the #519/#521 passes hold); the diff
run reproduced 0 diff pixels across independent captures (the reduced-motion
frames are deterministic), went red (14,844 px, exit 1) on a one-color CSS
edit, and returned green after revert. Dev deps (puppeteer-core, axe-core,
pixelmatch, pngjs) joined test/tools' committed lockfile; `visual-diff.mjs`
joins the coverage config's honest-boundary excludes (its capture half
never runs under vitest; the measured teeth live in the pure core).

Honest contrast boundary: axe's color-contrast is conclusive where the
computed background is (the session transcript: 1 inconclusive node) and
hedges to `incomplete` where translucent glass sits over the ocean gradient
(onboarding: 27, home: 9, marketplace: 16). The net adds the structural
rules and conclusive contrast on computable surfaces; it does not replace
the #519 hand-computed audit of the glass pairs.

## Alternatives considered

- Playwright (+ its downloaded browser) instead of puppeteer-core over the
  installed Chrome: rejected — the download (~120 MB per CI install) buys
  nothing this family needs, and tying the leg to the machine's real
  browser keeps the dev loop identical to the audit loop the screenshots
  came from.
- Wiring the visual diff as a warn-tier gov gate (the coverage-floor
  precedent, `allowFailure: true`): rejected — a red recorded on every
  runner whose font hinting differs from the baseline machine is noise
  wearing a gate costume; the task's own contract is "local/PR signal,
  never a CI log assertion", so the runner stays outside gates.json and CI
  entirely, and the teeth live in the vitest leg over the pure core.
- jsdom + axe (no real browser): rejected — axe's contrast and visibility
  machinery needs a real layout engine; jsdom results would be a different,
  weaker net pretending to be this one.
- Scanning one appearance only: rejected — the tone layer (#519) is
  appearance-adaptive; half the tokens would be unwatched.
- Skipping the self-teeth test as "obviously true": rejected — a net that
  has never been seen firing is not evidence (rules.md rule 6); the injected
  violation costs one extra scan (~2 s) and proves the assertion face every
  run.
