# Agent Note: The reference docs catch up to the simple front door: one-line milestones and a re-counted matrix note

Status: implemented

## Problem

The "keep it simple, human-first" pass stopped at the README (#547) while the two
docs it cites were the stale ones: doc/ARCHITECTURE.md §10 (Milestones) stopped at
the simulator matrix — missing the device plane, the render-surface pilot, the
in-app shell, the iSH retirement, the harmony matrix leg going real, and the
test-hardening program — and carried the old per-milestone audit prose (whole
paragraphs of scenario ids, verdict counts, and artifact paths per bullet);
doc/e2e-matrix.md's top Currency note was dated 2026-10-12 and counted 114 dirs /
233 verdicts while the checker on the tree reports 127 / 246 (growth rode
#517–#544). A reader following the front door's pointers hit numbers two weeks and
four milestones behind.

## Decision

Both pairs catch up in the same subtraction style the owner set for the front door:
(1) ARCHITECTURE ±zh §10 is rewritten as one line per milestone under a single
evidence pointer to doc/e2e-matrix.md — 14 milestones now (the six missing ones
added), the audit prose (per-bullet scenario ids, counts, receipt dirs) replaced by
the pointer, and only architecture-deciding facts kept in the bullets (the D9
verbatim-port fact and the shim-table cross-reference to §3; the shell's honest
emulation pointing at §12); the numbers the bullets dropped live in the pin table
(`external/ensure-dsh.sh`) and the matrix doc, which are their homes; (2)
e2e-matrix ±zh gains a fresh top Currency note (2026-10-16: 127 dirs / 246 verdicts
/ 245 pngs, the accepted gap unchanged — the iOS b4 receipt, #65) that states the
counts are a checker run (`node test/e2e/matrix.mjs`), not a claim, and attributes
the growth to #517–#544; the older stacked notes are untouched history. ARCHITECTURE
§10 shrank from ~7.8k to ~2.8k chars (en).

## Alternatives considered

- **Refresh only the numbers, keep the audit prose in §10** — rejected: the prose
  duplicates the matrix doc's job and goes stale by landing (the exact mechanism
  that made §10 lag); one pointer cannot rot.
- **Delete the §10 section entirely and let the README status table carry it** —
  rejected: ARCHITECTURE is the developers' reference; a one-line milestone ladder
  with the D9 correction and §3/§12 cross-references earns its place there.
- **Rewrite the 2026-10-12 currency note in place** — rejected: the notes are a
  newest-first stack and each records its own landing context; rewriting history
  breaks the trail the stack exists to keep.
