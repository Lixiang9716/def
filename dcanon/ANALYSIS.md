# Seat analysis — dcanon

**Summary:** The seat is essentially clean — one tracked dirty file (`.gov/surprises.jsonl`,
ledger-residue) whose only seat-local content is a single uncommitted ledger entry main lacks
(salvaged in SALVAGE-NOTES.md), no untracked files, branch fully merged via PR #291 squash.

Branch: `feat/canonical-json-single-source` · HEAD `5b02c34f` · `origin/main` `98869dd1`
(HEAD is not an ancestor of origin/main — squash-merge history; main advanced 170 commits past
HEAD: `git rev-list --count HEAD..origin/main` = 170).

## Per-file verdicts

| path | verdict | note |
|---|---|---|
| `.gov/surprises.jsonl` | ledger-residue | `git diff origin/main -- .gov/surprises.jsonl` non-empty (whole-file): main is 53 ledger entries ahead and rewrote the blob LF→CRLF (218/223 lines have `\r`; seat is pure LF, `i/lf w/lf`); the only seat-local content is one uncommitted appended entry (`two-consecutive-pushes-291`, 2026-10-01, PR #291 CI synchronize-drop) absent from main → salvaged in SALVAGE-NOTES.md; the seat's committed ledger content is fully contained in main (0 committed seat-only lines after CRLF normalization). |

## Archive contents

- `tracked.patch` — `git diff HEAD` output (2481 bytes), the full uncommitted change: one line
  appended to `.gov/surprises.jsonl` (patch hunk `@@ -168,3 +168,4 @@`).
- `SALVAGE-NOTES.md` — the one main-missing ledger line + the commands/evidence behind the
  finding, including the CRLF caveat for re-appending.
- No untracked files existed in the seat (`git status --porcelain` returned only the one ` M`
  path), so nothing was copied for step 2; no file exceeded the 5MB / vendor-build criteria to
  skip.

## Checks run this session

- `git -C /Users/lixiang/workspace/dsh-mobile-dcanon status --porcelain` → ` M .gov/surprises.jsonl` (only dirty path).
- `git -C … branch --show-current` → `feat/canonical-json-single-source`.
- `git -C … rev-parse HEAD origin/main` → `5b02c34f…` / `98869dd1…`.
- `git -C … diff HEAD > archive/tracked.patch` (2481 bytes).
- `git -C … diff origin/main -- .gov/surprises.jsonl` → non-empty (whole-file CRLF+53-newer-entries).
- `git -C … merge-base --is-ancestor HEAD origin/main` → false (not ancestor; squash merge).
- `git show origin/main:.gov/surprises.jsonl` vs worktree: byte `comm` → CRLF-normalized
  `comm -13` → exactly 1 seat-only line; `comm -23` → 53 main-only lines; sig grep on main blob
  → 0 hits.
- `git ls-files --eol .gov/surprises.jsonl` → `i/lf w/lf`; CR counts: main blob 218, seat 0.
- Salvage line JSON validity: `python3 json.loads` → OK.
