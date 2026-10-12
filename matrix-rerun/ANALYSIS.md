# ANALYSIS — seat matrix-rerun (branch chore/gov-close-t0219)

The seat carries a single dirty tracked file — the T-0219 ledger card's local void record that never reached main — and nothing untracked; the residue is salvageable by re-applying `tracked.patch`.

## Inventory

- Dirty paths: 1 (from `git -C /Users/lixiang/workspace/dsh-mobile-matrix-rerun status --porcelain`).
- Untracked files: 0 → nothing copied into this archive (step 2 had no candidates, so no size/vendor exclusions were needed).
- Branch state: HEAD `2114315f` is an ancestor of `origin/main` `98869dd` (verified via `git merge-base --is-ancestor`) — branch already merged, tree simply stale relative to main.

## Per-file verdicts

| path | verdict | note |
|---|---|---|
| `.gov/tasks/T-0219-the-release-grade-matrix-re-run-on-post-.json` | ledger-residue | `git diff origin/main -- <path>` non-empty and path under `.gov/`: working tree flips status `open`→`voided` and adds the `void` closure block (ts/by/reason: work landed as PR #466, harmony leg permanently unsatisfiable — no DevEco toolchain/hdc target, honest skip receipt); main's copy still reads `open` with no `void` block, so the missing closure record is preserved in SALVAGE-NOTES.md and `tracked.patch`. |

## Archive contents

- `tracked.patch` — `git diff HEAD` of the seat (1471 bytes, the one file above).
- `SALVAGE-NOTES.md` — main-missing lines/blocks with evidence commands.
- `ANALYSIS.md` — this file.
