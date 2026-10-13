# The shim namespace is staging POLICY, not a derivation (2026-10-13)

The staging manifests' derivation (the import-graph walk in
`tools/check-staging-graph.mjs`, enforced by `gen-staging-emit --check`)
deliberately CANNOT see everything a host stages. This file declares the
covered-but-not-derived family, why no derivation can ever mint it, and
what the boundaries of that decision are. It closes the open question the
round-trip research left at its §4 ("the strongest argument for the flip
plus a declared shim-namespace policy").

## The family: rows the JS walk cannot see

1. **`upstream/shims/*`** — the C host's module surface. A shim reaches the
   runtime through the loader's **bare map** (the C-side `vendor/npm/…`
   resolution table) and the **`__dshModuleDefine` runtime-module
   registrations** (`upstream/shims/runtime-modules.js` and friends). Both
   are DATA tables inside C sources and registered-module rows — strings,
   not import statements — so the walk skips them by design (masking string
   contents is what keeps the walk's edge extraction honest). A shim may
   also be reached only by `require`-shaped seams the ESM walk does not
   model.
2. **npm faces addressed by the loader bridge** — e.g.
   `vendor/npm/@deepseek-ai/cordis-plugin-loader@…/lib/index.js`: the
   loader's bridge resolves the bare specifier to the face; no JS import
   edge exists anywhere in the closure.

## Why this is policy and not a gap

- The consumer of these rows is the **C loader**, not the JS graph: what
  must be staged is whatever the loader can *address*, and the address
  tables live in C. Deriving them would mean parsing the per-host C tables
  — a second derivation with its own blind spots, coupling the JS store to
  C string layouts.
- The rows are staging DECISIONS with reviewed history (each shim split of
  2026-09 landed with its manifest rows). The store makes them reviewable
  in diffs; a derivation would make them invisible.
- The classes the retired round-trip reporter classified as
  `host-loader-namespace` (the shims + bridge-resolved npm faces),
  `runtime-data` (plugin `manifest.json` files the plugin loader reads —
  no import edge exists), `e2e-harness` (dsh-root files staged for the
  runner's own loads), and `vendor-shape` (staged under a pin shape no
  stager rule emits, e.g. util-crypto's docs/LICENSE rows) are all, in the
  end, the same thing: **policy-addressed rows**. This file is their
  declaration of record.

## The boundary (what this decision costs)

If a future C bare-map row or `__dshModuleDefine` registration points at a
file no manifest names, **nothing in the JS tree catches it** — the boot
dies on-device at import-link, not in CI. That is the accepted residual
risk of policy addressing, traded for not parsing C. The mitigations, in
order of strength:

1. `check-staging --block harmony,android,ios` direction (b) — every
   manifest row must exist on disk, so a RENAMED shim rots the gate red;
2. the per-host stagers' own `--check` byte-verify (the closures gate) —
   every staged file must match its source;
3. the E2E legs assert on structured logs with one-to-one expected↔logged
   match — a missing shim fails its scenario.

A shim that is added to a C table but to NO manifest is the one drift this
declaration cannot convert into a gate failure. Reviewers of C loader
changes: a new bare-map/module row MUST land with its staging rows in the
same commit (the same rule the android stager's RETIRED_PLUGINS list
states for the reverse direction).
