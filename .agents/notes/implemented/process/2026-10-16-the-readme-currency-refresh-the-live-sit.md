# Agent Note: The README currency refresh: the live-site CTA, the test-hardening row, and 127/246

Status: implemented

## Problem

The human-first front door (#512, honored here, not superseded) had gone stale in
three ways a first-time visitor pays for: the GitHub Pages site has been live since
2026-10-15 (owner flipped the switch; deploy green) yet the README — the page a
visitor is actually reading — linked to none of it, so the lowest-friction next
action did not exist; the D9 subsection still cited the #512-era checker counts
(118 evidence dirs / 237 green verdicts) while the tree had grown through
#517–#544; and the test-hardening program (20 rows in doc/test-coverage.md, 12 now
landed with committed receipts) appeared nowhere on the front door despite being
the strongest recent trust signal.

## Decision

README ±zh carry a currency pass on the #512 structure, byte-preserving the
existing milestone table and every settled section: (1) a one-line "see it in the
browser first" pointer to the Pages site under the language switcher, phrased to
the demo's honest posture (the real Lynx client rendering live, static shell, no
session — the demo page's own caption), plus the same pointer in the Quickstart's
no-toolchain bullet; (2) three evidence citations in "What works today" upgraded to
cite what landed since #512: the bash differential contract behind `dsh-shell-js`
(`runtime/dsh/artifacts/shell-diff/`, #540), the hostile-wire chaos legs behind the
LLM transport (`runtime/dsh/artifacts/macos-cli-llm-chaos/`, #528), and the
multi-session stress leg behind session persistence
(`runtime/dsh/artifacts/macos-cli-session-multi-stress/`, #543); (3) one new
evidence-table row for the test-hardening program citing doc/test-coverage.md and
the landed rows' PRs and artifact dirs (12 of 20 landed; per-row status stays with
the doc — the README does not duplicate that ledger); (4) the D9 counts refreshed
to a checker run on this tree (127 dirs / 246 verdicts, 2026-10-16, measured with
`node test/e2e/matrix.mjs`, 1 accepted owned gap as registered); (5) the Governance
install line aligned with the machine's actual practice (`uv tool install govrail`
alongside `pip install govrail`).

## Alternatives considered

- **Refresh doc/e2e-matrix.md's top currency note in the same PR** — rejected for
  this pass: the README cites that doc as the consolidated index, and the doc's
  note (114/233) now lags the README (127/246), but a proper currency note there is
  tied to its own landing change and its ±zh pair + pairing record; folding it in
  would grow this docs PR across two doc programs. Left as the known cross-doc
  alignment follow-up.
- **Claim the Stryker mutation pilot in the hardening row** — rejected: the
  program's own ledger (doc/test-coverage.md row 5) still reads planned; memory of
  the #530 experiment does not override the doc, and the README cites the doc as
  the per-row source of truth.
- **Rewrite the front-door prose further (tighter hero, benefit-led bullets)** —
  rejected: #512 settled the structure days ago and its note rejects prose tone
  changes without a driver; every edit here is either a new fact with a receipt or
  a stale number, keeping the diff auditable line by line.
