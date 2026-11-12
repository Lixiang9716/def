# Agent Note: R1 — the def bundle declaration: boot.js carries zero def plugin names

Status: implemented
Related: D5, D6, D9; [plan.md](../../../../plan.md) §14 (the R1 row); T-0291 (the card);
the seat-switch criterion ("def 的产品内容 = 一份清单(数据) + 插件包")

## Problem

The R1 end-state judge: **no def plugin name may appear in the boot code** —
a def seat's product content must be one manifest (data) plus the plugin
packages, so that swapping the def seat for another product seat edits DATA
only, never boot code. Before this change `boot.js` hardcoded the whole def
product: static imports of five system plugins
(`runtime/dsh/upstream/boot.js:85-97`, pre-change), inline dynamic imports
for two more (`:317,321`), a hand-written `mountFileTools` composition
(`:205-214`), the def rows of the spine inventory with their module-name
strings (`:181-188`), and the Agent 预设 deployment data (`:140-144`). A seat
swap meant editing boot code in six places, and the boot — the one module
every host embeds — carried product policy no boot should own.

## Decision

1. **The declaration.** `runtime/dsh/upstream/def-bundle.js` — pure data with
   the cordis.patch row semantics (one row = one mount: import spec + optional
   config), sections `toolRows` (1:1 with the historical `mountToolRows`
   head), `fileRows` (the file-tools family, mounted exactly where
   `mountFileTools` sat), `inventoryRows` (the def rows of the spine
   inventory), `preset` (default preset + vendor root). The seat-switch
   mechanism is the file header's contract.
2. **The loader.** `boot.js` gains `mountDefRows(ctx, cwd, rows)` — per row a
   dynamic import of the row's `load` thunk, `pick` for a named export
   (absent = the namespace object is the plugin), config resolved through
   `resolveRowConfig` (`"$cwd"` → the boot cwd; any other `$name` fails loud,
   rule 5). `spineInventory` builds its def rows from `inventoryRows`; the
   preset exports derive from `preset`. The mount ORDER is unchanged:
   toolRows → `mountWebPlane` → fileRows → the anchored editor.
3. **Honest asymmetry — what stays glue in boot.js, and why** (all named in
   the declaration header): `mountGatewayLlm` (transport adapter, not a
   product row); the `mountSpine` service layer (upstream names, service
   wiring); `mountWebPlane` (the vendored web plane mounts BETWEEN the two
   row sections and injects the gateway transport into the keyless search
   provider mid-mount — not a spec+config row); the EDITOR row (the vendored
   editor mounts wrapped in the loop-z3 relative-path anchor — a plugin
   TRANSFORM over module + cwd); `boot-coverage-rows.js`'s shellExecutor
   export borrow (the gated presetJoin path); `plugin-mount.js`'s
   validateWorkspaceManifest borrow (shared validation). Upstream names may
   remain in boot code; def plugin names may not, and now none do
   (`grep -c 'system-plugins' upstream/boot.js` → 0 matches).

## Alternatives considered

- **JSON for the declaration (the ask's letter).** Rejected on staging
  evidence: the hosts' staged closure is DERIVED from literal single-quoted
  `import()`/`from` specifiers (`tools/check-staging-graph.mjs:97-107`); a
  JSON manifest cannot carry graph edges, so every def plugin would have
  fallen out of `check-staging`'s reached set and out of the hosts' staging
  lists — the exact fresh-device-install death `check-staging.mjs` exists to
  prevent. A JSON file + a separate "pin" module holding literal imports was
  rejected as two sources for one truth. The `.js` DATA module keeps the rows
  pure data AND the derivation sound — the same format honesty as
  `config-layer.js`'s cordis.patch.json note ("the swap is a parse change,
  not a semantics change").
- **Mounting the web plane from the declaration** (WebRuntime + tool-web
  rows). Rejected: the keyless search provider (transport-injected) must
  register between the two mounts; splitting it into rows either reorders
  that or needs a hook grammar for one row. Glue, documented.
- **A wrap/hook grammar in the row schema for the anchored editor.** Rejected
  as machinery for exactly one row; the transform stays beside the loader
  that owns cwd, with the reason in both files.
- ** Leaving the spine inventory's def module-name strings in boot.js.**
  Rejected: they are def plugin names in boot code; the strict criterion
  moves them into `inventoryRows` (output byte-identical).

## Consequences

- Seat switch = edit `upstream/def-bundle.js`; boot code is seat-agnostic.
- The mounted set is IDENTICAL (verified): the 21 spineInventory rows
  byte-for-byte, the same mount order, the same configs; the only log-stream
  diff is WHEN module bodies evaluate (static graph load → mount time; the
  def plugins' top levels are pure definitions — verified by reading all six).
- Staging: `upstream/def-bundle.js` joined the closure — Index.ets
  BUNDLE_FILES, harmony closure-spine store, ios RESOURCES rows each +1 row;
  the ios `BundleStager.writeSpineClosure` gained the embedded row (the live
  create.card leg caught the omission: `cannot load module
  'upstream/def-bundle.js'`; the staging gates audit the py blocks, not the
  Swift stager list — that hand list remains live-leg-audited, the same
  whack-a-mole `writeTransitiveFaceRows` documents).
