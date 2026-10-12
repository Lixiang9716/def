# Agent Note: the 61-worktree seat cleanup — ledger residue salvaged, WIP snapshotted to an orphan branch, four seat classes retained

Status: implemented
Related: governance rule 2; `.agents/skills/worktree-workflow/SKILL.md` (the seat
procedure this cleanup enforces); `.gov/surprises.jsonl` (union-merge ledger);
`.gov/tasks/*.json` (card ledger)

## Problem

The worktree-workflow convention left 61 sibling worktree seats around
`/Users/lixiang/workspace/dsh-mobile-*` after their branches landed. A stale
seat is not free: its uncommitted `.gov/` residue (ledger lines appended after
the branch merged, card closures never committed) is invisible to main, the
tree noise misleads fresh sessions about what is landed, and teardown risks
losing the only copy of ledger records main never received. Deleting all 61
outright would have destroyed exactly that residue; keeping all 61 defeats
the cleanup.

## Decision

Every seat was audited against `origin/main` before teardown, at content level
(per-path `git diff origin/main`), not by merge ancestry — squash merges make
branch tips non-ancestors while their content is already on main. The cleanup
split into:

- **46 seats** whose tracked trees were clean of `.gov/` residue relative to
  main — removed directly.
- **15 seats** with residue or WIP — snapshotted first (per-seat
  `ANALYSIS.md`, `tracked.patch`, and `SALVAGE-NOTES.md` for ledger seats,
  plus untracked file copies), then removed. The snapshot lives in the orphan
  branch `archive/wip-snapshots-20261012` (text patches and copies only,
  ~1.2 MB, no build artifacts), pushed to origin so teardown loses nothing.
- **Ledger residue rescued in this PR**: 7 `surprises.jsonl` lines from 6
  seats (byok, dcanon, gaps-icp, harmony4, mic, regr — each verified absent
  from main by sig and CR-normalized byte compare, JSON-valid, appended once)
  and the `.gov/tasks/T-0212-the-card-player-...json` closure (status done +
  green receipt + the `[x] PR opened...` checklist item main lacked), applied
  from the gaps-icp patch via `git apply` after `--check` passed against
  main's copy.
- **Retained seats** (not touched): the primary checkout, `aoci-refresh`,
  `pr414`, and the 8 `gaps3/*` seats.

Cards whose residue did not meet the merge bar (same-id collision or
closure-only without a missing checked item) were deliberately not merged;
they are listed in the PR body's skipped list and preserved byte-exact on the
archive branch.

## Alternatives considered

- Delete all 61 seats without snapshotting: rejected — six seats held
  `surprises.jsonl` entries and two held card closures that exist nowhere on
  main; the ledger is append-only union-merged history and tearing those
  records away is exactly the loss this procedure exists to prevent.
- Keep all stale seats forever: rejected — the seats' branches are merged
  (content-wise) and the residue is three files' worth; 61 directories of
  false signal for that is a bad trade.
- Rescue the full `tracked.patch` of every seat into main (i.e. `git apply`
  everything): rejected — most of every patch is ordering/line-ending noise
  (main's CRLF ledger blob vs seat LF) or content main already has; only the
  verified-missing lines and the one valid card closure were applied, and the
  rest stays on the archive branch for anyone who needs the original bytes.
- Fold the archive into a normal branch on this repo: rejected — a normal
  branch would age and invite merge confusion; an orphan branch is inert by
  construction (no common ancestor) and costs nothing until consulted.
