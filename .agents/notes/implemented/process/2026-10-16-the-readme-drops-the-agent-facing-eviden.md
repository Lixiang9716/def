# Agent Note: The README drops the agent-facing evidence appendix: humans first, receipts one hop away

Status: implemented

## Problem

The front door still carried its audit appendix. The 12-row milestone table (each cell
a paragraph of scenario ids, verdict counts, and artifact paths), the D9 subsection
with its internal decision number and evidence-dir roll call, and per-bullet
citations in "What works today" addressed the auditor, not the visitor — exactly the
failure mode the 2026-10-15 human-first rewrite
([2026-10-15-the-readme-becomes-a-human-first-front-d.md](2026-10-15-the-readme-becomes-a-human-first-front-d.md))
diagnosed but then deliberately preserved for the evidence culture. Owner directive
2026-10-16 settles the tension the other way: **the README is for humans, not
agents** — remove the complex content; the receipts live one hop away and do not need
to ride the front page.

## Decision

README ±zh are simplified by subtraction, superseding the byte-for-byte-table
preservation decision of the 2026-10-15 note and partially un-doing the citation
upgrades of the 2026-10-16 currency note
([2026-10-16-the-readme-currency-refresh-the-live-sit.md](2026-10-16-the-readme-currency-refresh-the-live-sit.md)):
(1) "What works today" keeps seven plain-language capability bullets with zero
artifact paths, PR numbers, or x/y counts; one global line points to
doc/e2e-matrix.md for every receipt; (2) the milestone evidence table and the D9
subsection are replaced by a compact one-line-per-milestone status table whose only
evidence pointer is the same e2e-matrix link — the per-row receipt dirs live in the
matrix doc and on disk, exactly where audits already go; (3) the Documentation map
gains a test-coverage row so the hardening program keeps a front-door path without a
process table; (4) Governance drops the toolchain trivia (install command) — the
govrail repo documents it; (5) everything human-facing survives untouched: the
what/why opening, the live-site pointer, Quickstart, the architecture one-screen,
honest limits, the disclaimer, License, Star History. No facts were reworded into
claims — the subtraction only moved citations one hop away, it did not invent or
weaken any of them.

## Alternatives considered

- **Keep the full evidence table per the 2026-10-15 note** — superseded by owner
  directive: the table duplicated doc/e2e-matrix.md's job (which the matrix gate
  audits) at the cost of the front door's first purpose; a visitor who wants proof
  is one click away, an auditor even less than that.
- **Delete the status table entirely** — rejected: a one-line-per-milestone table is
  the human-simple form of "where is this project" and preserves the honest postures
  (harmony capability receipts awaiting hardware, iSH retired) that prose would
  flatten into marketing.
- **Fold the D9 numbers (127 dirs / 246 verdicts) into the compact table** —
  rejected: checker counts are auditor currency and go stale by landing (#545
  refreshed them only to see them age); the matrix doc's job.
