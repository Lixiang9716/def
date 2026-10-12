# ANALYSIS — seat harmony4 (feat/harmony-write)

**Summary:** The seat is effectively clean — its feature work landed in main as squash-PR
#70 (`a5362777`), and the only dirty path is append-only ledger residue (`.gov/surprises.jsonl`)
whose sole un-committed entry (a CI-trigger surprise) is the single line main lacks; nothing
untracked, nothing substantive at risk.

## Dirty-path inventory

`git -C /Users/lixiang/workspace/dsh-mobile-harmony4 status --porcelain` (and
`--untracked-files=all`, same result) reports exactly 1 path:

| path | verdict | note |
|---|---|---|
| `.gov/surprises.jsonl` | ledger-residue | +1 uncommitted ledger entry (`open-and-synchronize-push`, a CI pull_request-workflow-did-not-fire surprise); after CRLF normalization 42/43 of its entries are already byte-identical in origin/main, and the 1 missing line is captured verbatim in SALVAGE-NOTES.md — safe to tear down after re-appending that line (or accepting its loss). |

## Untracked files

None — nothing to copy into the archive (step 2 had no candidates; no >5MB or vendor/build
exclusions needed).

## Checks run (all in this session, via `git -C /Users/lixiang/workspace/dsh-mobile-harmony4`)

- `status --porcelain` / `status --porcelain --untracked-files=all` → 1 modified path, 0 untracked.
- `diff HEAD` → 1 file, +1 line (archived as `tracked.patch`, 9 lines).
- `diff origin/main -- .gov/surprises.jsonl` → non-empty (~151KB), so per protocol: path starts
  with `.gov/` → **ledger-residue**. The bulk is a line-ending artifact: origin/main's blob is
  CRLF, the seat's is LF (see SALVAGE-NOTES.md). Normalized set-difference → exactly 1 line.
- `merge-base --is-ancestor HEAD origin/main` → not an ancestor (expected: squash merge);
  `log origin/main --grep "W-HARMONY4"` → `a5362777 … (#70)` confirms the branch's feature work
  is in main.

## Archive contents

- `tracked.patch` — full tracked diff vs HEAD (the +1 ledger line).
- `SALVAGE-NOTES.md` — the exact main-missing line + evidence + CRLF observation.
- `surprises.seat-working-copy.jsonl` — reference copy of the seat's full working ledger
  (26,311 bytes, 43 entries), archived for safety though 42/43 entries already exist in main.

## Disposition

Seat can be torn down. Recommended before removal: re-append the `open-and-synchronize-push`
line from SALVAGE-NOTES.md to main's ledger (mind main's CRLF endings) via the normal PR flow,
or explicitly accept dropping it.
