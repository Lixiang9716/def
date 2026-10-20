# Agent Note: the iOS m1 leg renames to run-ios-boot-carrier.sh — the script and its artifact dirs now say what the leg asserts

Status: implemented
Related: #515 (the classified attempt loop this script carries), the 2026-09-19
iOS m1 spike notes (`2026-09-19-ios-m1-dsh-embed.md`,
`2026-09-19-ios-m1-carrier-spike-loopback-static-ws.md`)

## Problem

The iOS E2E leg's only runner script is named `test/e2e/run-ios-m1.sh`. The
name is a fossil of the first-spike milestone ("M1") the leg grew out of, and
it fails in two directions. It says nothing about what the leg actually does
— one simulator launch asserting `boot.verification` + `carrier.loopback` —
and it collides with Apple's M1 silicon, so "the m1 leg on an M1 macOS
runner" reads as a stutter and misleads a reader hunting for an
architecture-specific path. The same fossil name propagated into the workflow
(`dev-ios.yml` invocation, comments) and the artifact dir family
(`hosts/ios/artifacts/m1-dsh`, `m1-carrier`, `*.attempt1`), so a reader
mapping CI output back to the leg has to know the history to make the link.

## Decision

The leg is renamed to what it asserts: `git mv` to
`test/e2e/run-ios-boot-carrier.sh`, with the script header's first line now
describing the boot-carrier leg and a provenance line recording the rename
("'m1' named the first-spike milestone and collides with Apple's M1"). All
the hard-won header comments carry over verbatim except that first line.
`dev-ios.yml` follows: the invocation and comment references use the new
filename, and the artifact family takes the `boot-carrier-` prefix
(`boot-carrier-dsh`, `boot-carrier-carrier`, `boot-carrier-*.attempt1`, and
the uploaded artifact `boot-carrier-dsh-ios`) — the prefix is a live contract
between the script's `ART`/`ART2` and the workflow's attempt-move loop,
"Report verdict" provenance reads, and artifact upload, so both sides moved
in one change. The `'m1'` historical evidence family names stay where the
ask pins them: `test/e2e/matrix.mjs`'s family keys
(`m1-spike-boot`, `m1-carrier-loopback`) and `classify.mjs`'s m1-leg wording,
plus the committed evidence under `hosts/ios/artifacts/m1-*` and every
historical note/task-card citation. "Since M1"/"Since M2" milestone mentions
in the workflow header are history, not leg names, and stay.

## Alternatives considered

- Keeping the codename and pinning the meaning in docs: cheaper (no diff),
  but the collision and the opacity are exactly what a doc pin cannot fix —
  every future grep for the leg starts at a name that means the wrong thing,
  and the doc pin itself needs maintaining. Renaming once, with a provenance
  line in the script, retires the debt instead of documenting it.
- Renaming only the script file and leaving the `m1-*` artifact dirs: a
  half-rename that keeps the worst collision (the dirs are what a reader
  actually downloads from a run) while splitting the family across two
  prefixes.
- Renaming the `'m1'` family names in `matrix.mjs`/`classify.mjs` too:
  rejected here — they key committed evidence and classifier semantics that
  predate this rename; moving them is an evidence-compat decision, not a
  naming cleanup, and is out of this change's scope.

## Consequences

The next CI run uploads `boot-carrier-dsh-ios` (old artifact names are not
migrated — run pages keep old names on old runs). `classify.mjs`'s comments
still cite the old filename (kept per the family-name hold); a later
comment-only pass may update those strings without touching the family
names. The AOCI index (`aoci.code.txt`, `.aoci/baseline.json`) still carries
`run-ios-m1.sh` entries and closes over the landed rename through the normal
`aoci_maintain` pass after the PR lands, per repo practice.
