# The staging-manifest round-trip: from four hand lists to the generated store (2026-10-13)

English | [简体中文](staging-manifest-roundtrip.zh.md)

This research note started (2026-09-29) as the round-trip EVIDENCE for four
hand-maintained staging manifests; the tools it proposed have since become
the repo's authority. Today the manifests are **generated**: a store of
declared/derived rows under `tools/generated/staging/` is materialized into
the hosts by `tools/gen-staging-emit.mjs`, whose `--check` is the
blocking `staging-generated` gate. This rewrite records the landed reality
(#413 the verifier, #420 the manifest store, #485 the closure/pin/zod
lists, and the 2026-10-13 close-out: webclient legs, canonical sort order,
the shim-namespace policy, the generator's own retirement).

## 1. The emit contract (what replaced the round-trip report)

One authority, one verb pair:

```
node tools/gen-staging-emit.mjs --check tools/generated/staging   # the gate (drift exits 1)
node tools/gen-staging-emit.mjs --emit tools/generated/staging    # materialize; no-op on a correct tree
```

- **generated = (derived − exclude) ∪ policy.** Derived rows come from
  reality (the import graph, the materialized pin trees); policy rows are
  hand-declared staging decisions that must exist on disk. Policy/exclude
  files are hand-editable — a row's move between them is a staging decision
  in the diff; derived files are never hand-edited.
- **Host blocks are machine-spliced from the store** (Index.ets's
  BUNDLE_FILES, the stagers' list blocks, the py blocks), in CANONICAL
  SORTED order — the sorted list is THE list, on disk and in the host
  sources alike. A hand edit or a hand reorder of a machine-owned block is
  drift; an emit on a correct tree is a byte no-op.
- **The flip contract for vendored pins**: a new file in a materialized pin
  joins the staging lists only via `--emit` + commit (reviewed in the
  diff). The pre-flip `find`-generated spans are `@walk` marker lines in
  the store, recomputed at check/emit time — the find's automaticity is
  gone by design.
- **check-staging stays the second net** (`staging-check` gate): the
  graph→manifest coverage direction and manifest→disk staleness for all
  three hosts, blocking.

## 2. The store inventory (disk counts at this commit)

| store file | rows | what it is | spliced into |
|---|---|---|---|
| harmony-BUNDLE_FILES.rows (+ .policy/.exclude) | 1227 (policy 1078) | derived graph ∪ policy − exclude | Index.ets BUNDLE_FILES |
| android-scenario.rows / android-web-live.rows (+ .policy each) | 17 / 14 | host entry policy ∪ transitively reached | stage-spine-closure.sh scenario+web-live for-in headers (stage + verify twins) |
| ios-RESOURCES.rows / ios-TREES.rows | 125 / 106 | declared accession table + mirror roots | gen_bundle_resources.py RESOURCES / gen_bundle_header.py TREES |
| harmony-closure{,-spine,-shelljs}.rows | 132 / 247 / 47 | the vendor-official.sh copy lists (literal policy + `@walk` pin spans) | the CLOSURE, SPINE_OURS, SHELLJS_PARSER_FACES assignments |
| android-pins.rows (`# block:` sections) | 54 | the stager's pin/face rosters | six stage+verify `for pkg in` headers + three SHELLJS_* values |
| ios-zod.rows | 79 | DERIVED: the pinned zod's import closure (zodClosureRows over the py's ZOD_ROOT) | the py ZOD_FILES block |
| webclient{,-v2,-compact,-mini}.rows | 3 / 16 / 4 / 3 | each staged web client's declared shipped-file list | nothing — the stagers whole-copy; the store is what the gate judges product, mirrors and iOS declarations against |
| shim-namespace.policy.md | — | the declaration of record for the rows no derivation can see | — |

Satellites by the code-size gate: `gen-staging-emit-hosts.mjs` (android +
ios halves), `gen-staging-emit-closure.mjs` (the closure/pin/zod legs),
`gen-staging-emit-web.mjs` (the webclient legs; also a standalone CLI for
the presentation runner), mechanics in `gen-staging-legs.mjs`.

## 3. What the legs derive vs declare

- **Derived**: the harmony graph closure (walkGraph over the boot roots +
  staged scenarios); the android transitive scenario/web-live imports; the
  zod closure (the pin's own relative-import graph); every `@walk` span
  (the domino/turndown-plugin-gfm libs, the goal trio, the 14 dsh spine
  pins — recomputed from the materialized trees).
- **Declared**: which scenarios stage; the npm faces staged at dsh rel
  paths; the accessor suffixes (Swift links against them); the mirror
  roots; the shipped-file lists; every literal row of the harmony closure
  blocks.
- **Not derivable by design**: the shim namespace and bridge-resolved npm
  faces — see `tools/generated/staging/shim-namespace.policy.md`, which
  answers this note's old §4 open question (the C bare map and
  `__dshModuleDefine` tables are data the JS walk deliberately cannot
  see). That file is the boundary's declaration of record, including the
  accepted residual risk (a C table row with no manifest row is invisible
  to CI) and its mitigations.

## 4. Remaining hand surfaces (the honest zero)

The copy ROSTERS are fully store-owned — none of the four original hand
lists survives as a hand list. What remains hand-written is composition and
construction, not rosters:

- vendor-official.sh's CLOSURE **assembly tail** (llm.js, manifest.json,
  the plane scenarios, the system-plugins rows) — the line that stitches
  the store-backed blocks, still carrying its own literal rows;
- the script-side **stage blocks** that are wholes, not lists: the npm-face
  stage calls, the MOBILE preset cp block, the NOBLE_DIR/PIAI_DIR whole-pin
  scans, the webclient find loops;
- the android stager's whole-dir mirrors (upstream/, system-plugins/ —
  drift-free by construction), its 12-file dsh-root list, and the
  RETIRED_PLUGINS seat list;
- the ios embedder's WEBCLIENT_TREES (judged against the webclient store
  family by the web legs).

## 5. Byte-identity invariant

The flip changed who writes the manifests, never the staged bytes: after
each landing, `sh build/build.sh sync android && sh build/build.sh sync
harmony` regenerated the staged trees with **zero drift** (porcelain clean
on assets/, rawfile/ and the iOS Generated bundle), and the composed shell
CLOSURE value was diffed byte-for-byte against its pre-flip eval. The
canonical-sort pass (this close-out) reorders the spliced blocks by design
— the row SET, and therefore every copied file, is unchanged; the double
sync proves it per landing.

## 6. Reproducing

```
external/ensure-dsh.sh                                   # materialize the vendored pins
node tools/gen-staging-emit.mjs --check tools/generated/staging   # the gate: green
node tools/gen-staging-emit.mjs --emit tools/generated/staging    # a byte no-op on a correct tree
node tools/gen-staging-emit-web.mjs --check tools/generated/staging  # the webclient family standalone
node tools/check-staging.mjs --block harmony,android,ios # the verifier: green
sh build/build.sh sync android && sh build/build.sh sync harmony  # zero staged-tree drift
node tools/check-asset-mirrors.mjs                       # the blocking cross-host byte face: green
```
