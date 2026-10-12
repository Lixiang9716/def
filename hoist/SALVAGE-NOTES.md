# SALVAGE-NOTES — seat hoist (feat/hoist-pwsh-terminal-bash)

**Result: nothing to salvage. Zero `.gov` content missing from `origin/main`.**

No dirty tracked path starts with `.gov/`, so the ask's ledger-residue branch produced no
entries. Because the ask also asserts the branch "已随 PR 并入 main", every file the branch
ever touched (merge-base `ceb43826` → HEAD `c8ccfa73`, 6 files) was verified against
`origin/main` (`98869dd1`, PR #468) so teardown cannot lose committed work either.
All checks run via `git -C /Users/lixiang/workspace/dsh-mobile-hoist` (read-only; no fetch).

## Branch-touched files vs origin/main — all content present

| Branch file | Check run | Finding |
|---|---|---|
| `.agents/notes/implemented/testing/2026-09-29-terminal-bash-local-joins-the-shell-suite-platform-pin.md` | `git diff origin/main HEAD -- <path>` | 0 bytes — byte-identical on main |
| `.gov/surprises.jsonl` | branch-added lines (`git diff $(git merge-base origin/main HEAD) HEAD`) checked line-by-line against `git show origin/main:.gov/surprises.jsonl` | The 1 branch-added line (sig `full-sweep-green-count-comparison-606`) **is on main**; byte compare differs only at char 706 = main stores it with `\r\n` vs branch `\n` (content identical — main-side CRLF hygiene quirk, not missing content) |
| `.gov/tasks/T-0072-two-transpile-hoist-lines-unlock-the-pws.json` | `git cat-file -e origin/main:<path>`; `git grep T-0072 origin/main` | File absent from main **because it was renumbered**: `.gov/tasks/T-0126-two-transpile-hoist-lines-unlock-the-pws.json` exists with identical title/created/rules-hash/checklist (renumber wave #290). Stale duplicate, safe to drop |
| `runtime/spike/scenario/upstream-suite-leg.js` | 5 branch-added (forkpty) lines grepped in `origin/main:runtime/dsh/scenario/upstream-suite-leg.js` | All 5 PRESENT (spike/ → dsh/ rename by `2dc9e7c3` #402) |
| `hosts/android/app/src/main/assets/spike/scenario/upstream-suite-leg.js` | same vs `origin/main:hosts/android/app/src/main/assets/dsh/scenario/upstream-suite-leg.js` | missing=0 |
| `hosts/harmony/entry/src/main/resources/rawfile/spike/scenario/upstream-suite-leg.js` | same vs `origin/main:hosts/harmony/entry/src/main/resources/rawfile/dsh/scenario/upstream-suite-leg.js` | missing=0 |

## Merge-shape note

`git merge-base --is-ancestor feat/hoist-pwsh-terminal-bash origin/main` → false (5 commits
not on main by ancestry) — expected under this repo's squash-merge convention
(AGENTS.md "Landing changes"); content-level equality is what the table above proves.
Origin/main (98869dd1) is 5 PRs ahead of the branch tip (c8ccfa73); the 6721-file tree diff
is main's forward progress (PRs #464–#468), not unmerged branch work.

## Salvage files

`salvageFiles = []` — no `.gov` (or other) file holds content missing from main.
