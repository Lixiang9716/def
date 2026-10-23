# Agent Note: the four test layers — every artifact declares a layer, and the declaration is gated

Status: implemented
Related: D20

## Problem

"We keep confusing E2E and UT" (owner, 2026-10-23). The confusion is
structural, not habitual: the repo's six overlapping nouns (test, spec, leg,
scenario, drive, gate) never defined a taxonomy, so one bucket — "全量
feature-test" — silently mixed five kinds of work. The 2026-10-23 release
precheck showed what that costs: a true E2E leg (the gateway drive) had been
broken for five weeks under CI green that never included it, because "CI
green" conflates unit tests, evidence audits, and live runs; the `e2e-matrix`
gate is named e2e while never booting the app; `test/panel/` housed a
browser-drive E2E script beside vitest units; and the largest test family —
the headless runtime proof legs — had no name at all.

## Decision

Four layers (D20), litmus-tested: **static** never executes the system;
**unit** runs one module; **integration** runs the composed runtime headless;
**e2e** runs the shipped artifact through its real entry. Evidence audits are
not a layer — they are the enforcement mode over e2e's committed evidence.

Enforcement landed the same day (owner's explicit call: day-one gate, full
inventory): `test/taxonomy.json` classifies 270 entries + 140 scenarios
(`gov run` names the per-kind counts on every green); `tools/check-test-taxonomy.mjs`
is the gate — enum, existence, driver integrity, orphan declaration, full
coverage of test-shaped files, and registry agreement — with the rule-6
rejection proof wired into the gate command itself (`--self-test` runs a
fixture that must fail before the real tree is judged). The verification
registry's legs carry `kind` (`test/verifications.mjs --list`), and the
blurred placement moved: the panel's browser-drive script now lives in
`test/e2e/`.

## Alternatives considered

**A two-word UT/E2E split only**: rejected — the headless proof legs and the
evidence audits are genuinely neither, and the two-word split is exactly
where the five-weeks-green blindness lived. **Advisory documentation
without a gate**: rejected by the owner explicitly (day-one enforcement,
full inventory). **Renaming blurred gate ids**: deferred — `e2e-matrix`
keeps its id; the taxonomy entry carries the evidence-audit description, and
id churn buys no additional truth.

## Consequences

"CI green"/release-precheck records must name which layers ran. The parked
unified test driver (2026-10-20 direction) reads `kind` from the registry to
select layers. The 18 evidence-carried scenarios now declare their carry
mode in writing — the next one to appear does the same or gets wired.
