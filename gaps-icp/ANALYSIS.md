# ANALYSIS — seat gaps-icp (branch gaps3/ios-02-card-player)

**Summary**: 4 dirty paths, all tracked modifications (zero untracked files) — MANIFEST.sha256 is byte-identical
to origin/main (stale tree only), the two `.gov/` files are uncommitted ledger closure/residue whose content main
genuinely lacks (salvaged to SALVAGE-NOTES.md), and ROSTER.json is machine-local build-artifact churn — the seat
is safe to tear down once the two `.gov/` salvage items are dispositioned.

Audited 2026-10-12, read-only, via `git -C /Users/lixiang/workspace/dsh-mobile-gaps-icp` (the seat is a git
worktree of dsh-mobile, sharing refs; branch HEAD 26382f62, origin/main 98869dd1, local main 1b3b31cf diverged
from origin/main — both main variants checked for the salvage items). Archive contains `tracked.patch`
(1411 lines, `git diff HEAD`) and `SALVAGE-NOTES.md`; no untracked files existed to copy.

## Per-file verdicts

- `.gov/surprises.jsonl` — **ledger-residue** — vs-HEAD it appends exactly 1 surprise
  (`runtimedshbuildish-shared-host-configure-dir`, 2026-10-11: xcodebuild's vdso pre-phase poisons the shared
  `runtime/dsh/build/ish` configure cache with SDKROOT=iphonesimulator); textual diff vs origin/main is 423 lines
  but JSON-normalized comparison proves main lacks exactly this 1 entry (rest is ordering/formatting variants;
  main has 10 newer entries this tree lacks) — line salvaged to SALVAGE-NOTES.md; local main lacks it too.
- `.gov/tasks/T-0212-the-card-player-evidence-leg-closes-the-.json` — **ledger-residue** — worktree closes the
  card (checkbox ticked, status open→done, full 29-gate green receipt, ts 2026-10-11T11:58:01Z) but the closure
  was never committed, so the merged squash of this branch (#458, e4882178) landed the code while main still has
  the card open with receipt null (verified on both origin/main and local main; main's separate
  `T-0212-the-create-card-evidence-leg-…json` closed by #461 is a sibling card, not this one) — full diff salvaged
  to SALVAGE-NOTES.md.
- `presentation/official-web/MANIFEST.sha256` — **already-in-main** — `git diff origin/main -- <path>` output is
  empty (working tree byte-identical to main); the vs-HEAD churn is only sha256sum output formatting
  (`*` binary-marker → two-space separator), i.e. the tree is simply old, nothing to keep.
- `presentation/official-web/client-bundles/ROSTER.json` — **junk** — locally re-materialized bundle roster
  (build artifact, regenerable by ensure-client-bundles) whose entries now carry machine-local absolute
  `/tmp/dsh-harness-src/packages/...` paths vs main's canonical repo-relative `packages/...` (and HEAD's
  Windows `C:\Users\...` paths) — an environment fingerprint, not work anyone would re-apply.

## Disposition

- Salvage-worthy (main-missing content under `.gov/`): `.gov/surprises.jsonl` (1 entry),
  `.gov/tasks/T-0212-the-card-player-evidence-leg-closes-the-.json` (closure + receipt) — see SALVAGE-NOTES.md.
- Nothing untracked existed (step-2 copy list empty; `git ls-files --others --exclude-standard` returned nothing).
- After the two ledger items are dispositioned, the seat can be removed with no code loss.
