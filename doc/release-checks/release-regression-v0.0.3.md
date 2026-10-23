# Release regression, final run — v0.0.3

English | [简体中文](release-regression-v0.0.3.zh.md)

> The v0.0.3 authoritative evidence package, produced 2026-10-23 by the
> pre-release regression the office-plane lesson mandates (the e2e-matrix
> gate audits committed evidence only; **the local full rerun is the only
> net** for the legs CI cannot drive). Every claim below carries the command
> that produced it. The cut sequence (bump → merge → tag) rode the owner's
> delegated go of 2026-10-23 (the plan-2.1 sequence, with "你给 go → tag");
> the go was conditioned on this package being green, and it is.

## Scope of this package

- **Base**: `main@2b1392c0` (#665) at run time — everything through the
  cold-seat verdict gate. The precheck carried ONE fix of its own, found BY
  this run (the net working): the iOS bundle stager's missing
  `fs-durable.js` row — #666. Gateway drives on main had died at import
  since #593 (2026-10-18), invisible to CI because the gateway leg is
  local-only and its committed evidence was last refreshed 2026-09-28.
- **Machine honesty**: no Android NDK and no DevEco CLT on this box — the
  Android and HarmonyOS legs are covered the way the release train covers
  them: the `dev-android`/`dev-harmonyos` CI legs run on the bump PR, and
  the `release/android`/`release/harmony` workflows build the packages at
  the tag. No real device was attached (iOS `xcrun devicectl`: none) —
  every device leg stayed script-standby. The `release` environment is
  unarmed (no protection rules, per doc/github-owner-actions.md item 3), so
  the tag push runs ungated: the go is the recorded delegation, not the
  environment.

## Run 0 — the full gate matrix

Command: `gov run --every-gate`. Result: **28 gates: 28 pass**
(includes `self-test` exclusive, `closures`, `e2e-matrix`,
`vendoring-repro`, `coverage-floor`, `panel-tests`).

## Run 1 — core toolchain legs

Command: `build/build.sh build core`. Result: PASS (sync + `src/build.sh`
compile + the CLI proof legs; their receipts are refreshed in #666).

## Run 2 — the iOS debug e2e leg, twice

Command: `build/build.sh build ios`. First run FAILED at the gateway drive
— boot 8/8 PASS, carrier 7/7 PASS, gateway 0/26 events
(`cannot load module 'fs-durable.js'`; debug AND release configurations
identical). Root cause and fix: #666. Rerun on the fixed tree: PASS —
boot 8/8, carrier 7/7, gateway 26/26 + receipt
(`rt: sequence boot=PASS carrier=PASS gateway=PASS`).

## Run 3 — the iOS Release-configuration feature pass

Command: `build/build.sh build ios --release`. Same shape as run 2: red
before the fix, PASS after (`ALL CHECKERS PASS`).

## Run 4 — the upstream-suite sweep (Node driver)

Command: `node tools/test/sweep.mjs`. Result: PASS. The differential
ledger's failed-count disagreements (qjs vs node): 22 — 14 documented by
the ledger (d-contract 9, c-delta 4, both-red 1), **8 unexplained**, and 1
stale row (`session__session-telemetry-otel__tests__egress`, no longer
disagreeing). The unexplained eight, named rather than buried:
`experimental__webworker-runtime__tests__node__fs`,
`llm__llm-deepseek__tests__egress`, `mcp__mcp-client__tests__egress`,
`util__http-proxy__tests__install`,
`util__http-proxy__tests__matcher-parity`,
`web__web-search-deepseek__tests__egress`,
`web__web-search-exa__tests__egress`,
`web__web-search-perplexity__tests__egress` — test-surface disagreements
between the two legs, queued for the ledger pass (plan §3.19); none touches
a shipped surface. Report: `tmp/upstream-suite-report.tsv`.

## Run 5 — the simulator matrix (iOS)

Command: `tools/test/run-simulator-matrix.sh --platform ios`. All three
legs PASS:

```
matrix: [ios] release        -> PASS (0 drive markers / 0 debug+info; audit=668 warn=32; refusal by name)
matrix: [ios] gateway-drive  -> PASS (4 verdicts green + receipt — clean first attempt, the retry unused)
matrix: [ios] device-plane   -> PASS (device.plane + audit verdicts green + receipt)
```

The gateway-drive leg ran the full UI drive (WDA/idb: notification banner,
approval dialog, the Files picker walk, notes selection). One environment
red was observed during the precheck's FIRST matrix pass — the picker walk
is racy on the iOS 26.5 remote sheet — and #666 gives that leg #515's
remedy (classify before retrying); the recorded run needed no retry.

## Fixed by this run (the net's catch)

- **#666 — the staging row and the honest retry**: #593 added the scenario
  import and the RESOURCES embed row but not the staging row (strike four
  of the BundleStager hand-list class; the file documents three prior
  rounds). Five weeks CI-green because the leg is local-only. Class
  follow-up: #667 (embed-by-existing for the bundle root; a CI home for
  the leg; the picker-walk repair).

## Blockers

None.

## Reproduction

    gov run --every-gate
    build/build.sh build core
    build/build.sh build ios            # after #666
    build/build.sh build ios --release
    node tools/test/sweep.mjs
    tools/test/run-simulator-matrix.sh --platform ios

Logs retained under `tmp/release-precheck/` on the run box.
