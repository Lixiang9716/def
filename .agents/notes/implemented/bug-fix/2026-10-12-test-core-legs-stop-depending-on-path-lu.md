# Agent Note: test core legs stop depending on PATH luck for manifest verification

Status: implemented
Related: D15

## Problem

`build/build.sh test core` aborted on leg 2 (upstream.web-boot) with
`Error: spawnSync shasum ENOENT` thrown at module scope of
`runtime/dsh/ci/web-plugins-payload.mjs:92` (T-0218 round 1). Working the
legs in order then surfaced four more reds behind it — the sequence is
not gate-wired, so it had rotted past its first leg:

1. The staged-tree digest check shelled out to an external `shasum`
   binary, which resolves through the inherited PATH. Under a stripped
   environment (a workflow runner exporting only the node dir) the spawn
   dies with ENOENT — reproduced on this machine by running the builder
   with `PATH=<node dir>`: identical trace. The same shell-out lived in
   `test/e2e/ensure-client-bundles.sh` (`shasum -a 256 -c` twice).
2. Even with `shasum` present, the leg still could not pass on a clean
   tree: `presentation/official-web/client-bundles/npm/` is untracked
   build output, and no script on the core path materialized it (the
   module comment claimed `ensure-client-bundles.sh` "runs before this
   on every path" — it does not run on any core leg; only iOS legs and
   the platform CI workflows call it). A missing tree reaches the same
   `spawnSync … ENOENT` shape because the external check's cwd pointed
   into the absent directory, which is how the round-1 failure
   presented. The host compile had a third instance of the class: the
   CLI links the iSH engine, whose CMake sub-build hard-fails on the
   untracked `vendor/ish/<pin>` tree, while `host/build.sh` — named by
   the error message and by ensure-ish.sh's own header as a caller that
   should run the ensure — never ran it. Leg 4 had a fourth: the preset
   Node face needs the `dsh-tests` corpus, and `parity-node-modules.sh`
   failed fast instead of ensuring it.
3. Legs 4 and 8 (`run-session-preset-join-node.sh`,
   `run-office-e2e.sh`) were committed 100644 while the facade invokes
   every leg directly — Permission denied on a clean checkout.
4. `settings-surfaces.json` pinned a smaller plane than the runtime
   mounts: endpoints 18 vs 40, settingsLegs 10 vs 18, a
   `pluginManagerReadonly` field the runtime replaced with
   `pluginManagerWriteLegs: 6`, `healthy: 1` vs 5, `presetRows: 6` vs
   125, and a two-bundle/74-row readonly inventory vs the three-bundle
   (the compact client)/78-row shape that no longer carries
   `readOnlyReason`. Same debt family as the card's tools:15 pin.
5. Leg 4 (session-preset-join, the plain-Node face) died in the vendored
   preset discovery: `packageInstalled` walks `node_modules` upward from
   `ctx.baseUrl` with a raw disk stat, and the mobile boot sets that base
   to the staged VFS spelling (`/vendor/...`). Under QuickJS the fs shim
   answers the walk inside the bundle; under plain Node `/vendor` does
   not exist, so all package rows read unresolvable and
   `resolveMountable` refused the mobile preset at `session/create`. Its
   staging also mutated the vendored agent-presets package (patched
   `presets/mobile` docs written into the vendored tree), which turned
   every leg run into a preset-health suite red
   ("stages all four built-in preset documents").

## Decision

- `web-plugins-payload.mjs` verifies the record in process
  (`node:crypto` sha256 over each `<64 hex> SP|* ./path` line): same
  check-mode semantics as `shasum -a 256 -c` (recorded files must exist
  and match, unrecorded extras are not the check's business), rule-5
  loudness (an unparsable record line names the record; mismatches name
  the files), and the CRLF strip `verify-manifest.mjs` already learned.
  A missing staged tree fails loud naming `ensure-client-bundles.sh` as
  the remedy instead of an anonymous ENOENT.
- `verify-manifest.mjs` grew `--strict`: exact record check with no
  work-path bound class (`shasum -a 256 -c` parity, in process) — the
  mode for verifying a tree's OWN record. `ensure-client-bundles.sh`'s
  `verifies`/`why` now call it instead of shelling out to `shasum`.
- The two core legs that stage the full application tier
  (`run-upstream-boot-e2e.sh`, `run-settings-surfaces-e2e.sh`) run
  `test/e2e/ensure-client-bundles.sh` before staging — making the
  module comment's "runs before this on every path" claim true and the
  clean-tree sequence self-materializing, the same pattern the legs
  already use for the vendored closure. `host/build.sh` runs
  `vendor/ensure-ish.sh` per that script's own header contract, and
  `parity-node-modules.sh` ensures `vendor/ensure-dsh-tests.sh` instead
  of failing fast on the absent corpus.
- The two non-executable leg scripts are committed 100755.
- `settings-surfaces.json` is re-pinned to the measured present — each
  value cross-checked against the scenario's own `demand()` invariants
  (endpoints 40, settingsLegs 18, pluginManagerWriteLegs 6, healthy 5,
  presetRows 125, bundles 3 / readOnlyBundles 2 / bundleRows 78 /
  plugins 78 / workspaceRows 0), not copied blind from the log; the
  `runtime/dsh/ci/settings-surfaces.manifest.json` mirror moves
  identically (the panel mirror-identity test pins the pair).
- `upstream/boot.js`'s preset plane accepts `agentPresetsBaseUrl` and
  `agentPresetRoots` (folded through the spine identity row); the
  defaults stay the device VFS spelling and the shipped roster.
  `session-preset-join.mjs` passes the real vendored package URL (the
  plain-Node face's resolution walk answers) and hands the patched
  mobile preset doc over as a TEMP discovery root instead of writing
  into the vendored package — the vendored trees stay pristine (D6).
- `test/panel/cli-preset-seed.test.js`'s health model resolves a
  composition row against the committed `ensure-dsh.sh` pin table in
  addition to the seed markers: the registry serves the whole pinned
  closure, and the npm-face rows (`dsh-tool-web`, `dsh-tool-present`,
  `dsh-plugin-manager/tools`) the docs name carry no seed markers. The
  markers-only model answered four broken presets where the runtime
  measures five healthy.

## Alternatives considered

- Teaching the environment instead of the code (require a full PATH in
  every runner): rejected — the failure mode is a bare ENOENT far from
  its cause, and the repo already fixed this exact class for gate
  commands (`test/e2e/matrix.sh`: "a gate command that assumes node on
  PATH fails on runner images without it").
- Making the payload builder invoke `ensure-client-bundles.sh` itself:
  rejected — a builder that silently kicks off several-minute network
  rebuilds is surprising; materialization is the leg's job, mirroring
  how each leg already ensures the vendored closure.
- Reusing `verify-manifest.mjs`'s bounded compare for the COMPUTED
  record too: rejected — the environment's own build record must verify
  exactly; the work-path bound class exists only for the committed
  REFERENCE record (D15).
- Keeping `shasum` inside `ensure-client-bundles.sh` (it was not the
  crashing frame): rejected — same PATH class one leg later; the fix is
  one substitution while the strict in-process mode was being added
  anyway.
- Teaching the driver to map `/vendor` onto the real tree (extend
  `__dshBundleRequire` or a module-level fs patch): rejected — the
  vendored preset probe reads the disk with its own `existsSync`, so a
  complete answer means intercepting node:fs for the whole boot; a real
  base URL is the honest spelling for a face that genuinely runs
  against the real checkout.
- Overriding only `ctx.baseUrl` and not the Loader's `baseUrl` (or vice
  versa): rejected — one field, two readers (the presets service and
  the Loader plugin); splitting them would let the row probe and the
  row import disagree about where packages live.
- Keeping the driver's write into the vendored package (it is untracked
  and rewritten by every re-pin anyway): rejected — "verbatim upstream"
  is a discipline, not a file attribute (D6), and the preset-health
  net's four-document assertion is exactly the check that caught it.
- Recording the OLD manifest pins (the replica's stale derivation
  agreed with them): rejected — the leg is the runtime ground truth and
  was never run against the current pin; the replica's model is what
  moved, so the model was updated (pin-table rows) and the manifest now
  records the measured present.

## Consequences

The ten-leg `test core` sequence needs no preinstalled `shasum` and no
pre-materialized untracked trees beyond what its own legs ensure:
vendored closure per leg, iSH engine at host build, application tier at
the two web-boot-consuming legs, upstream test corpus at the Node face.
First run on a clean tree fetches pinned tarballs and rebuilds the
client bundles (several minutes, network); subsequent runs verify in
process. The full sequence ran green end to end in this round
(31/31, 12/12, 12/12, preset-join verdict, 15/15, 35/35, 19/19,
34/34, 4/4, 8/8). `ensure-official-dist.sh` still shells out to
`shasum`, but it serves only device officialweb legs, not
`test core` — left as-is, on record here. The parity reference leg
(outside `test core`) resolves through the same Node layout and now
also self-ensures the corpus; it was not re-proven in this round.
