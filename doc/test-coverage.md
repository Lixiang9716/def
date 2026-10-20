# Node-surface line coverage — vitest, the aggregate runner, the coverage-floor gate

English | [简体中文](test-coverage.zh.md)

This repo's real behavior-coverage net does not run through a coverage
tool: 681 upstream official specs pressed against the QuickJS runtime and
the self-built shims, plus the e2e evidence matrix and the gov gates.
Line coverage complements that net on exactly one axis — **the Node-testable
surface of code we own** — and this page is its contract: what is measured,
what is honestly NOT measured, and the warn-tier floor gate that watches it.

## Run it

```sh
sh tools/test/run-coverage.sh          # per-surface vitest run + one aggregate table
sh tools/test/run-coverage.sh --check  # the same, then enforce the floors (exit 1 below floor)
```

The runner walks the surface registry (top of `tools/test/run-coverage.sh`),
installs the surface's dev deps when missing, runs each suite with the v8
provider (reporters: text + lcov + json-summary), and prints the aggregate
table from the json-summary reports. Single surface, by hand:

```sh
npm --prefix presentation/lynx-client run test:coverage
```

## Measured baseline (2026-09-30, vitest 4.1.11 + @vitest/coverage-v8 4.1.11)

| surface                 | lines | branches | tests |
|-------------------------|------:|---------:|------:|
| presentation/lynx-client | 84.2% |    66.5% | 36/36 |

## The floors and the warn gate

`tools/test/coverage-floors.json` pins each surface's floor at
**measured − 5 points** (lynx-client today: lines 79.2, branches 61.5) —
an honest floor that flags real regressions while tolerating normal drift.
The `coverage-floor` gate in `gates.json` runs
`sh tools/test/run-coverage.sh --check`, scoped to the surface tree, with
`allowFailure: true` — **warn-tier: a red floor is recorded, never
blocking**. Its rule-6 rejection case
(`.gov/rejections/case-coverage-floor.sh`) proves the teeth fully
sandboxed — the floors registry is copied to a temp dir and the forged
summaries live under a temp measurements root (`--floors` /
`--measurements-root`), so no mutation window ever opens on the real tree
(a killed case leaves no residue by construction): floors bumped to 100%
go red with the surface named, the same state stays advisory without
`--enforce`, the real floors bite a low measurement, and an above-floor
state passes. The runner itself is POSIX sh on purpose — the gate argv
invokes it through `sh`, and govrail execs that argv without a shell, so
CI's dash must be able to run it (arrays and `pipefail` would be syntax
errors there).

To lower a floor legitimately: re-measure, move the floor to
new-measured − 5, and say why in the PR (a floor moved without a measured
basis is drift, not maintenance).

## Honest boundaries — what is NOT counted, by name

Inside `presentation/lynx-client` the vitest coverage includes only
`driver/**` + `shared/**` (the seam libraries the suite exercises):

- `bundle/` — the ReactLynx render face runs on the Lynx engine, not Node.
  Pretending node-side line coverage there would lie the way node-side
  coverage of QuickJS-bound shims lies.
- `driver/driver.js`, `driver/skin-*.js`, `driver/run-*.mjs`,
  `driver/mock/mock-serve.mjs` — the CLI/e2e face, imported only by the
  entrypoints; the full driver loop through both skins is exercised by
  `test/e2e/run-cli-lynx-mount.sh` (stub and lynx receipts on file).
- `theme/gen.mjs` — owned by the `theme:check` script gate.

Whole surfaces deliberately not registered:

- `test/upstream-suite` — its vitest config runs the UPSTREAM harness's own
  specs against the vendored closure (the same spec families the CLI suite
  runs through the QuickJS-shaped harness). Coverage there would measure
  pinned upstream code under Node semantics — not our line coverage, and
  not the CLI suite's behavior proof either.
- `presentation/web-client*` — plain browser JS with no runner and no
  tests; `import` of `main.js` fails on Node (`document is not defined`).
- `runtime/dsh` (QuickJS runtime + shims) — the shipped semantics are
  QuickJS's; the behavior net owns them.

## Adding a surface

1. Give the surface a vitest config whose `coverage.include` names its
   Node-testable product code (exclude `node_modules/`, `artifacts/`,
   `dist/`, and every boundary you can name).
2. Add the directory to `SURFACES` in `tools/test/run-coverage.sh`.
3. Run the runner once, read the real numbers, set the floor in
   `tools/test/coverage-floors.json` to measured − 5.
4. The gate already watches every registered surface — no gates.json edit
   needed.

## Test-hardening program (2026-10-15)

A hardening program, owner-approved — 16 items on 2026-10-15, extended
2026-10-16 with four more seats (rows 17-23, the wave-2 addition): three
waves, each method lands as its own leg/seat with evidence; a row's status
flips in the PR that lands it. As of 2026-10-20 all 20 rows read **landed** —
row 15 (the app upgrade matrix) was the last, re-proven on main that day.
Complements (does not replace) the floors
above — coverage answers "are the surfaces covered", the methods below
answer "are the assertions strong enough" and "what happens at the edges".

| # | Method | Wave | Status | Lands as |
|---|--------|------|--------|----------|
| 1 | Chaos LLM mock profiles (malformed SSE, truncation, slow-drip, oversized chunks) | 1 | **landed** (#528) | mock-llm-server.mjs profiles + transport-guard legs |
| 2 | C host ASan/UBSan CI leg | 1 | **landed** (#526) | c-core sanitizer build |
| 3 | axe-core a11y regression (web-client-v2, after the #519 manual pass) | 1 | **landed** (#527) | suite leg |
| 4 | Visual regression diff (dev-carrier screenshots; warn-tier, never a CI log assertion) | 1 | **landed** (#527) | ui-sweep pixel diff |
| 5 | Scoped mutation pilot (Stryker: shell-js refusal vocab, lynx fold/surface-core, publisher-token) | 1 | **landed** (informational, 2026-10-16) | scores shell-js 83.45% / lynx-fold 95.42% / publisher-token 98.29% (`test/mutation/reports/`); triage: survivors are scope-guard equivalents + wording + the nested-workspace toGateway family (needs a fixture); cadence: rerun on family change, never a gate |
| 6 | bash differential harness (POSIX subset, dsh-shell-js vs real bash on Linux CI) | 2 | **landed** (#540) | c-core Linux leg |
| 7 | Property-based parser tests (fast-check: parser-syntax, path, semver-range) | 2 | **landed** (#541) | panel suite families |
| 8 | Persistence journal schema-migration tests (cross-version replay) | 2 | **landed** (#538) | migration legs |
| 9 | Static analysis: clang-tidy (src), detekt (Kotlin) | 2 | **landed** (#536) | CI legs |
| 10 | Supply-chain audit of the vendored npm closure (CVE + license) | 2 | **landed** (#535) | vendoring step |
| 11 | Soak/aging leg (1-2h: heap/fd/journal integrity) | 3 | **landed** (soak runner, 2026-10-16) | soak-aging CLI leg: one long-lived session under sustained mock rounds for `DSH_SOAK_MINUTES` (default 90 — owner-invocable ritual, never a gate), heap sampled per heartbeat with gc-collected brackets and a per-round budget, the journal ladder contiguous at every heartbeat and in full at the close, host fds sampled and climb-gated by the runner (`runtime/dsh/ci/run-soak-aging.sh`) |
| 12 | Generative structure-aware fuzz of the gateway wire / SSE parser | 3 | **landed** (informational, 2026-10-16) | fast-check SSE fuzz through the real `streamChat` seam: reassembly under arbitrary byte chunking, typed unparsable-line failure, post-[DONE] silence (`test/panel/fastcheck/llm-sse-fuzz.test.js`); the raw-wire half stays with the 21-case gateway-fuzz battery |
| 13 | Provider cassette replay (LLM contract quirks offline) | 3 | **landed** (informational, 2026-10-16) | provider-cassettes suite: nine recorded wire shapes (reasoning conventions, usage-before-DONE, mid-stream model substitution, CRLF, keep-alive comments, no-[DONE] close, a recorded mid-line cut) replayed through the real `streamChat` seam (`test/panel/fastcheck/`, provenance-bearing fixtures); rerun on transport changes, never a gate |
| 14 | Host queue-boundary concurrency stress (the D2 dispatch seam) | 3 | **landed** (spine suite, 2026-10-16) | queue-boundary-stress spine leg: a 4×4 queued-turn burst with jittered SSE pacing on the REAL spine drains with per-session journal attribution and wire-level journal contiguity (`test/panel/spine/run.sh`); rerun on dispatch-seam changes, never a gate |
| 15 | App upgrade matrix (install -r across builds; AssetSync stamps) | 3 | **landed** (#569; re-proven on main 2026-10-20) | upgrade-matrix Android leg: two debug builds differing by exactly one probe asset (the runner owns the probe's lifecycle — create → build A → remove → build B — and never commits it); `adb install -r` of B over A replaces the restart leg's force-stop in the persist-restart flow (create leg on A → resume leg on B; the checker's 46/46 rides the manifest shared with the restart leg), plus the run-as on-disk assertions (the stale probe wiped by the stamp reconciliation, the canary under `files/profiles/` intact, the stamp present after B's boot). THE FINDING: the journal lives inside the synced tree `<filesDir>/dsh`, and the stamp-mismatch wipe took it — `JournalKeeper` now renames `dsh/sessions` aside across the wipe (`hosts/android/ci/run-upgrade-matrix.sh`); cadence: rerun on asset-staging / reconciler / profile-container changes and before a release, never a gate |
| 16 | Resource-starvation behavior (disk-full journal, low memory) | 3 | **landed** (heap face 2026-10-16; disk-full journal face 2026-10-19, under the real-fs mount) | the low-memory face is proven: `DSH_HEAP_LIMIT_MB`, a C-host test knob, caps the engine heap and the OOM surfaces catchable and named with the host alive (`resource-starvation.js` heap leg, green). The disk-full journal face is green under the gated real-fs mount: the journal grows on a runner-owned 5 MB ramdisk until the volume refuses, and the durable publish (contract v1.11.0 `fsPublishAtomic`, armed by `sessionPersistence.realFs`) names the loss AT the write boundary (`journal.starve.named by=durable-publish`) — the #571 silent-loss class ruled out at its root (`run-starvation.sh` journal leg) |
| 17 | Gateway audit-completeness invariant (every v1.x call paired, ordered, payload-free against the host audit stream — contract §6) | 2 | **landed** (#537, 2026-10-16) | gateway-audit-invariant CLI leg (build.sh test core): a 49-call ledger over the raw seam paired one-to-one, ordered, metadata-only against the host's audit stream; the desktop host now emits one per-call record at settle |
| 18 | Install-pipeline path-traversal pins (zip-slip class: hostile members driven through the real `installPackage`; REL_PATH rejects interior `..`) | 2 | **landed** (#539) | install-path-traversal panel pins (19) |
| 21 | Multi-session interleaved stress (4 sessions on one spine: journal attribution, projection, per-session recovery) | 3 | **landed** (#543) | session-multi-stress e2e leg |
| 23 | Malformed tool-call argument chaos (type-error / missing-field / deep-nesting / oversized through the validation layer; structured rejection, never turn-fatal) | 1 | **landed** (#542) | llm-chaos-toolargs e2e legs |

Rows never regress silently: a landed row whose leg disappears is a finding
(same spirit as the coverage floors).
