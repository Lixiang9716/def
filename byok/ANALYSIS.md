# ANALYSIS — byok seat

**Summary**: The seat is one committed-but-rebased ledger edit away from clean — its only dirt
is an uncommitted 1-line append to `.gov/surprises.jsonl` whose 149 sibling lines all already
sit byte-identical in `origin/main`; that one line (sig `head-with-live-workflow-triggering`)
is the sole content main lacks, so the seat is safe to tear down after salvaging it.

- Command basis: `git -C /Users/lixiang/workspace/dsh-mobile-byok status --porcelain
  --untracked-files=all` → exactly one dirty path, zero untracked.
- Seat HEAD `cb80e20f` is **not** an ancestor of `origin/main` (`98869dd1`) — merged
  content-wise, then rebased onto an older main; the 214 KB `diff origin/main` is
  ordering/append noise around content main already has (149/150 worktree ledger lines
  byte-identical in main, per-sig + byte compare).

## Per-file verdicts

| Path | Verdict | Note |
| --- | --- | --- |
| `.gov/surprises.jsonl` | ledger-residue | Tracked, +1 uncommitted line (sig `head-with-live-workflow-triggering`): main lacks exactly this line; the other 149 worktree lines are already byte-identical in `origin/main`. Salvaged in SALVAGE-NOTES.md. |

## Untracked files

None — `status --porcelain --untracked-files=all` reported no `??` entries, so nothing was
copied into the archive and no size/vendor skips applied.

## Archive contents

- `tracked.patch` — `git -C /Users/lixiang/workspace/dsh-mobile-byok diff HEAD` (9 lines,
  the single `+` line at `.gov/surprises.jsonl:150`).
- `SALVAGE-NOTES.md` — the one main-missing ledger line and the salvage action.
- `ANALYSIS.md` — this file.
