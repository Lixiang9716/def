# SALVAGE-NOTES — seat matrix-rerun (branch chore/gov-close-t0219)

Comparison basis (both commands run in this session):

- `git -C /Users/lixiang/workspace/dsh-mobile-matrix-rerun diff origin/main -- .gov/tasks/T-0219-the-release-grade-matrix-re-run-on-post-.json` → non-empty (7 insertions, 2 deletions vs main).
- `git -C /Users/lixiang/workspace/dsh-mobile-matrix-rerun show origin/main:.gov/tasks/T-0219-the-release-grade-matrix-re-run-on-post-.json` → main still carries the card as `"status": "open"`, `"receipt": null`, with **no** `void` object.

Verdict: **ledger-residue**. The only content main lacks is the void/closure record below.

## Missing from origin/main

File: `.gov/tasks/T-0219-the-release-grade-matrix-re-run-on-post-.json`

1. Status line change (working tree line 18 vs main `"status": "open"`):

```json
  "status": "voided",
```

2. The entire `void` block (working tree lines 20–25; main ends the object at `"id": "T-0219"`):

```json
  "id": "T-0219",
  "void": {
    "ts": "2026-10-11T18:11:56+00:00",
    "by": "lixiang@192.168.21.11",
    "reason": "card's work landed as PR #466 (squash 2114315f0a29572fefaa9ba816dc94650c7dc465, gates+ci-verdict green; items 1/2/4/5 ticked). Item 3 (harmony platform leg) is permanently unsatisfiable on this machine: no DevEco toolchain and no hdc simulator target (probed in the skip receipt: DevEco-Studio.app present=false, hdc list targets empty) \u2014 recorded honestly as a skip receipt, not a green one (hosts/harmony/artifacts/simulator-matrix/matrix-skip-receipt.json 2026-10-12T01:28:34+08:00; PR body: 'a skip receipt, not a green one'). Checklist can never complete as written here, so close() refuses on rule 9; the leg stays script-ready per D-g (hosts/harmony/ci/run-host-e2e.sh) when a device exists"
  }
```

## Why this is salvage-worthy

The void block is the authoritative closure record for task card T-0219: it records when/who voided it, that the card's work landed as PR #466 (squash `2114315f0a29572fefaa9ba816dc94650c7dc465` — the tip commit this branch was merged from), and the honest reason the harmony leg can never tick on this machine (no DevEco toolchain / no hdc target; skip receipt at `hosts/harmony/artifacts/simulator-matrix/matrix-skip-receipt.json`). On main the card still reads `open`, which misrepresents the ledger. Re-applying this diff to main closes the residue.
