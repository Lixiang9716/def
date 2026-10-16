# Agent Note: The debt batch: the last known gap closes and the mutation pilot lands

Status: implemented

## Problem

The engineering-debt review (owner go: "先解决工程债") surfaced two executable
items. First, the register's one accepted gap —
`hosts/ios/artifacts/b4-write-live/receipt.json` missing since #65 — turned out
to be hiding real rot: the leg is not CI-wired, and the tree had drifted past
its manifest in FIVE places (two coverage-plane endpoints —
`dynamicCordisRunner/syncInspectManifest` and `/inventory` — now answered
`forwarded` by `runtime/dsh/upstream/web-write-cordis.js` instead of
`unavailable`; the plugin inventory 74→78 entries / presetRows 121→125; the
manager-readonly record's new shape with `readOnlyBundles`/`plugins`/
`workspaceRows` replacing `readOnlyReason`; the spine's 17th tool). Second,
the mutation pilot's program row (doc/test-coverage.md row 5) had stayed
"planned" since #530 ran it experimentally, with no recorded cadence.

## Decision

Both close by execution, not new code. (1) The b4 leg ran for real on the
local iOS simulator (iPhone 17 Pro, iOS 26.5): first red on the drifted
manifest, re-pinned from the green run's own records after verifying each
semantic change at its source (`web-write-cordis.js` implements the two
endpoints; the roster and tool-count growth are the tree's current truth),
then green — composer.live-write 46/46, in order, receipt written. The
checker's register row was struck in the same change as it demands; counts
move 246→247 verdicts, dirs stay 127, zero known gaps. (2) All three Stryker
families ran from the repo root (the seat-root invocation is
`test/mutation/node_modules/.bin/stryker run test/mutation/<conf>` — running
from inside test/mutation double-relativizes every path): shell-js 83.45%,
lynx-fold 95.42%, publisher-token 98.29% — byte-identical to the #530
baselines, so the families are stable; reports at `test/mutation/reports/`.
Row 5 flips to landed (informational) with the cadence written down: rerun
when a family changes, never a gate. The known-gaps register is now EMPTY —
first time in the repository's history.

## Alternatives considered

- **Fix the manifest without a run (edit expected values from source
  reading)** — rejected: a manifest row is only ever re-pinned from an actual
  run's records; reading the counts out of source would have guessed the
  inventory projections (78/49/125) instead of measuring them.
- **Wire the b4 leg into CI while closing it** — right instinct, wrong
  batch: it needs a macOS runner budget decision (the hosted-macOS legs are
  path-filtered), which is the owner's call; recorded here as the follow-up
  so the drift class does not reopen silently.
- **Triage all 60 shell-js survivors now** — deferred: the #530 round
  already triaged the pilot's survivors into pins; today's survivors are the
  same population (string-literal defaults the panel suites seed over, e.g.
  `cwd: ''`), and a fresh triage deserves its own pass with the reports open,
  not a tail-end of a debt batch.
