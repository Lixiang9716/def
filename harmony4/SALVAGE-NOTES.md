# SALVAGE NOTES — seat harmony4 (feat/harmony-write)

## File: `.gov/surprises.jsonl` (verdict: ledger-residue)

The seat's working copy has 43 ledger entries. After CRLF normalization, `origin/main`'s
version (223 entries) contains 42 of them byte-for-byte; **exactly one entry is missing
from main** — the last line of the seat's working file, which is also the sole uncommitted
change (see `tracked.patch`, the `+` line).

Exact line main lacks (append verbatim to `.gov/surprises.jsonl`):

```
{"ts": "2026-09-20T22:07:52+00:00", "sig": "open-and-synchronize-push", "expectation": "a PR open (and a synchronize push) on feat/harmony-write fires the gov pull_request workflow like every other branch", "reality": "no workflow run was created for the branch at all (actions/runs empty for the head SHA through two triggering events, while other branches' PRs fired within a minute)", "surface": null}
```

Verified absent from main by both identity and content:

- `grep -o '"sig": "[^"]*"' | comm -23 seat main` → only `open-and-synchronize-push`
- `grep -c "open-and-synchronize-push"` against normalized main blob → `0`
- `grep -c "no workflow run was created"` against normalized main blob → `0`

Commands run (all via `git -C /Users/lixiang/workspace/dsh-mobile-harmony4`):

- `git show origin/main:.gov/surprises.jsonl` / `git show HEAD:.gov/surprises.jsonl` — extracted both versions (223 vs 42 lines; working file = 43 lines)
- `comm -23 <(sort -u seat working) <(sort -u main-with-\r-stripped)` → exactly the 1 line above

## Side observation (not salvage, but someone may care)

The raw blob of `.gov/surprises.jsonl` on `origin/main` uses **CRLF** line endings
(`git cat-file blob "origin/main:.gov/surprises.jsonl" | head -1 | od -c` ends `… n u l l } \r \n`),
while the seat's HEAD blob and working file use LF. `.gitattributes` gives this file only
`merge=union` (no `eol=`). This is why the raw `git diff origin/main -- .gov/surprises.jsonl`
is ~151KB (every line differs by `\r`) although the semantic delta is the single entry above.
Ironically, the missing entry itself records a CI-trigger surprise — the CRLF blob on main is
another ledger-worthy surprise for whoever owns the ledger hygiene.
