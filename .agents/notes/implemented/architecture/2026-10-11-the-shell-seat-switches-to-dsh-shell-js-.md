# Agent Note: The shell seat switches to dsh-shell-js; dsh-shell-wasm and dsh-shell-ish leave every host's staging

Status: implemented
Related: D6

## Problem

Three shell system plugins coexisted on the device seats: dsh-shell-wasm
(contract v1.2.0 `wasmRun`), dsh-shell-ish (contract v1.3.0 `ishRun`), and
the newer dsh-shell-js — but only the first two were mounted. boot.js's
composition still imported and mounted wasm/ish, every per-host staging list
still carried their files, and dsh-shell-js — despite its vendor closure
being pinned and embedded on all three hosts (the 2026-10-11 vendor round) —
had NO iOS staging rows at all and no boot registry row anywhere. Every
hand-edited surface that decides "what ships on the device" disagreed with
every other one, which is exactly the configuration the repo's
silent-freeze history warns about: a list nobody re-checks line by line
ships whatever it shipped yesterday.

## Decision

dsh-shell-js now holds the one `shell` tool seat, and the two retired
plugins keep their source trees under `runtime/dsh/system-plugins/` (the
local engine gates — run-ish-local's C+JS pair — and workspace installs
still read them) but no host stages or mounts them:

- boot.js: one static import (`system-plugins/dsh-shell-js/index.js`),
  one mount (`ctx.plugin(ShellJs)`), one inventory row
  (`tool('shell-js', …, 'shell')`); boot-coverage-rows.js's vendored
  ShellExecutor subclass wraps dsh-shell-js's `shellExecutor` instead of
  the wasm executor. The web-shims prelude installs the real `process`
  global with a never-overwrite install, so parser.js's process presence
  guard moved from module-load — where the now-boot-time static import
  made it preempt that prelude and killed the first `process.cwd()`
  (fs-local's Config class field, measured live) — into `readTextSync`,
  the vendor-read chokepoint, as a field-level fill.
- Two latent plugin defects the seat switch surfaced (the plugin had
  never been booted): applets.js imported `wordHasGlobMagic` from
  applets-shelljs.js, but the export lives in applets-support.js — a
  QuickJS link error vitest's lazy named-import transform masked
  (recorded in the surprises ledger's spirit; the ledger CLI currently
  crashes on a legacy-schema line, see the PR description); and the
  process guard above.
- iOS: `ios-TREES.rows` swaps the `system-plugins/dsh-shell-wasm` mirror
  root for `system-plugins/dsh-shell-js` (the whole-dir rule — a plugin
  joins the spine tree by existing); `ios-RESOURCES.rows` drops the five
  wasm/ish accessor rows and BundleStager.swift drops their write pairs;
  project.yml drops the stale shell-ish GenerateSpikeBundle input rows.
- Harmony: vendor-official.sh's CLOSURE drops the five rows,
  harmony-BUNDLE_FILES.policy.rows drops the same five (with the
  retirement comment), and the five staged rawfile files leave in the
  same commit; `--emit` re-spliced Index.ets (1326 → 1321 rows).
- Android: the whole-dir mirror stays (check-staging's mirrorOf demands
  it) and gains a hand-declared `RETIRED_PLUGINS` skip list — a plugin
  leaves the staged seat by joining that list in the same commit its
  boot.js registry row leaves the composition; the five tracked staged
  asset files are deleted.
- `scenario/userland-shell.js` moves to `scenario-local/` (outside every
  TREES root and every derivation scope): iOS roots the staging graph at
  every on-disk scenario file, and the scenario statically imports
  dsh-shell-ish — leaving it staged would carry a dangling import into
  the embedded closure. run-ish-local.sh (the only driver; it loads the
  scenario by path) is repointed; the iSH engine and its `ishRun`
  capability stay — only the plugin seat retires.

The settings/composer inventory expectations follow the composition:
one `shell-js` enabled/active sample row replaces the wasm+ish pair
(spineEntries 16 → 20 — the full spine list, the value the surface has
emitted since the snapshot began carrying every row), and the
composer-live-write total drops 75 → 74.

## Alternatives considered

- Keeping shell-wasm/ish staged alongside dsh-shell-js — rejected: three
  plugins registering `shell`-family tools meant the seat answer depended
  on mount order, the iOS graph coverage demanded files for a tool the
  inventory reported honestly as superseded, and every future staging
  audit pays for all three trees forever.
- Deleting the retired plugin source trees — rejected: the local engine
  gates (run-ish-local.sh's JS gate imports the ish plugin's executor
  directly) and workspace installs via the plugin marketplace still read
  them; only the seat retires, not the implementation.
- Leaving userland-shell.js in `scenario/` and keeping an iOS row for
  shell-ish — rejected: that fails the retirement (the staged tree is
  the seat) and leaves the embedded closure carrying a static import of
  a plugin no host ships.
- Excluding userland-shell.js from the iOS `scenario=` whole-dir row —
  rejected: TREES mirrors are whole-dir by design ("a shim joins the
  embed by existing, not by list edit"); carving per-file exclusions
  recreates the hand-list trap for every future scenario.

## Consequences

Every boot now exercises the dsh-shell-js import graph, so its bytes are
boot-critical on all three hosts (the closures gate enforces the staged
copies). The `wasmRun`/`ishRun` gateway capabilities stay granted in the
caller manifest — workspace-installed plugins and the local engine legs
still use them. The settings-surfaces CLI leg carries four
failures on this branch that predate this change (claims/preset-roster/
pluginManager shape drift against its expected manifest — proven by a
control run with HEAD's boot files) and are left for the branch's own
round; the seat's own assertion (the inventory spineSample) passes.
