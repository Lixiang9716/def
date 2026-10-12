# SALVAGE-NOTES — carrier (feat/carrier-webserver)

No `.gov/` dirty paths exist in this seat, so there is no ledger residue to salvage.
This file records that fact explicitly (over-archive policy); it contains no salvaged content.

Checked at 2026-10-12 with:
- `git -C /Users/lixiang/workspace/dsh-mobile-carrier status --porcelain -uall`
  → only ` M hosts/ios/artifacts/m3-complete/nslog-stderr.txt` (no untracked files at all).
- `git -C /Users/lixiang/workspace/dsh-mobile-carrier diff origin/main -- hosts/ios/artifacts/m3-complete/nslog-stderr.txt`
  → non-empty, but path is not under `.gov/`, so per the seat protocol it is content-judged, not ledger-residue.
