# Agent Note: the b-closeout — node-pty vendors, the typert staged read, and the final 42-row surface

Status: implemented
Related: plan §3.17 (the b-list this closes), #649 (the loader-internals
wiring this verifies on a fresh seat), the fixture-seeding note (the
isolation contract), dsh-mobile#626, the 2026-10-22 repository rename to
`def` (first seat landed post-rename)

## Problem

Three b rows remained: controller (node-pty missing from the node
closure), and the loader-internals/fixture edges that #649/#651 wired —
this seat verifies those wirings on a fresh provisioned seat and closes
what remained.

## Decision

- **node-pty vendors into the D6 pin table** (ensure-dsh.sh): the pair
  node-pty@1.2.0-beta.15 + node-addon-api@7.1.1 (tarball sha256-pinned,
  verbatim). The tarball's prebuilds dir ships the macOS spawn-helper and
  Windows conpty bits; the JS binding compiles at provisioning time —
  node-addon-api linked as a node_modules entry, then node-gyp rebuild
  (works on this Mac; CI runners carry the toolchain). The farm's generic
  loop links it by package name, so dsh-subprocess-local's lazy require
  resolves from external/node_modules. **Measured: the controller row
  flips to yes — node 55/0.**
- **The typert resolve face reads through the staged fs**: node-module.js
  now imports readFileSync from the shim fs (the staged view) so
  workspace-written fixture manifests resolve on the qjs leg — replacing
  the #653 `__dshBundleRequire` attempt, which reads real bundle bytes
  and cannot see workspace writes. Measured: the node leg stays 17/0;
  the qjs leg's flip is measured by the full sweep below.
- **The loader-internals wiring verified on a fresh seat**: mount 51/2
  and inventory 9/3 reproduce (the tables import from #649 works from a
  cold provision).

## The re-baseline (full sweep vs the post-Tier-2 state)

**63 → 42 disagreement rows; +28 clean flips; 5 rows flip to NO — the
same five leakage-blessed rows** (preset shipped-root, typert generator
type-model, computer-use composition, inspector loader-composition.host +
port-selection.host): their prior "yes" held only while the shared
staging tree carried other specs' fixtures/spec-siblings. Under the
per-process isolation they fail in their own environment — fresh triage
rows with signatures in this run's logs (shipped-root passes solo and
fails in-sweep: its posture is sequence-sensitive; typert type-model
fails 10/47 — real generator deltas; the inspector .host pair fail at
module level in the work root).

## Alternatives considered

- **Build node-pty from the monorepo source** — rejected: the npm
  tarball is the vendor unit the discipline pins; its prebuilds dir
  already carries the platform helpers.
- **Skip the node-addon-api pin and hand-set the include path** —
  rejected: binding.gyp literally `require('node-addon-api').targets`;
  without the package resolvable, gyp fails at configure. The second
  pin is the honest shape.
- **Land node-pty in the PRODUCT pin table only** — it IS the product
  pin table (ensure-dsh.sh); the terminal-controller row exercises it on
  device through the same vendored package, so the pin serves both.

## Consequences

The controller row flips; b shrinks to the loader-internals edges
(mount/inventory/control residuals) + the five leakage-blessed rows.
The node-pty pin introduces a NATIVE addon into the npm closure — the
binding is machine-built at provisioning time (never committed), and
platform coverage follows the toolchain (macOS/CI-linux verified
shapes; Windows rides conpty prebuilds + an MSVC build the Windows
ladder owns). A `git check-ignore` pass confirms all seeded subtrees are
gitignored, so the sweep leaves the tracked tree clean.
