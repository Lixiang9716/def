# Agent Note: CMake phase 2 — the mechanical layout rename (external/, src/ + example/, doc/)

Status: implemented
Related: T-0225; supersedes the directory-mapping table of
[2026-09-27-the-top-level-cmake-layer.md](2026-09-27-the-top-level-cmake-layer.md);
D6 (upstream discipline)

Date: 2026-10-13 · Class: architecture · Task: T-0225

## Problem
Two weeks of tree churn (the #402 spike→dsh rename, #457's shell-js rebuild) left the 09-27 layout-A decision pointing at paths that no longer matched the plan made against the old tree, and the phase-1 CMake layer could only express the target layout as aliases. The mechanical rename had to land without breaking any of the three host builds, the gates, or the byte-mirror discipline:

### What landed — layout A, all three legs merged

| PR | merge commit | scope |
|----|--------------|-------|
| #478 | `8409315acc9250f954f467b6598532f4fa53ee08` | **external/** — the vendored closure moved out of `runtime/dsh/vendor`; compat symlinks `runtime/dsh/vendor → ../../external` and `runtime/dsh/node_modules → ../../external/node_modules`; `.gitignore`/`.zcodeignore` vendor rules rewritten to `external/` |
| #479 | `9c180376f51150163b82c5af5165eff90149209a` | **src/** (ex `runtime/dsh/host`, 16 files incl. `ish/`) + **example/** (`main_cli.c`, `ish_smoke.c`); the ish-smoke CMake target moved to `example/CMakeLists.txt` behind `-DISH_SMOKE=1` (the plain root build has no engine graph, so the smoke is silently absent there — the same conditional presence the `ISH_SDK` guard gave it in `src/ish`); `src/build.sh` cwd contract re-pinned: `SCRIPT_DIR` (= `src/`) + `ROOT` (= repo root) self-locating, every path anchored to one of the two, outputs unchanged at `runtime/dsh/build/` |
| #480 | `650e741bc93e2f24245c8fd469f222d3048c14f2` | **doc/** (ex `docs/`, 59 files) |

Each leg carried its own reference-rewrite script under `tmp/`
(`rewrite-external.sh`, `move-src.sh`, `move-docs.sh`) with whitelist-zero
self-checks; the packed assets under `hosts/` were regenerated through the
official stagers (`build/build.sh sync android` via
`hosts/android/ci/stage-spine-closure.sh`, `sync harmony` via
`hosts/harmony/ci/vendor-official.sh --closure-only`) — both verified
byte-identical to the runtime pins (harmony: 638 closure files +
check-bundle-files 1227 = 1227).

## Supersedes

This note **replaces the directory-mapping table** of
[2026-09-27-the-top-level-cmake-layer.md](2026-09-27-the-top-level-cmake-layer.md)
(the phase-1 "aliases, not renames" table: `src/ → runtime/dsh/host`,
`external/ → …`, `doc/ → docs/`). Phase 2 turned those aliases into the
canonical paths; anything reading that table for path resolution should read
this note instead. The old note's phase-1 decisions (root CMakeLists +
`CMakePresets.json`, `cmake/Vendor.cmake` configure-time materialization with
`DSH_SKIP_VENDOR=ON`, gates-as-CTest) remain in force — the old note is left
untouched as a point-in-time record.

## Decision

1. **The vendor bundle contract (`<base>/vendor`) is carried by the compat
   symlink**, not by rewriting consumers. `runtime/dsh/vendor → ../../external`
   (plus the `node_modules` twin) keeps every bundle-space vendor spelling
   honest: the C side's `DSH_PKG_CRYPTO_PATH = "vendor/dsh/…"` and the
   stagers' `vendor/dsh|npm/...` staging rels are a two-sided contract and were
   deliberately NOT sed-rewritten. A later deep-integration pass may revisit
   absorbing the bundle-space mapping probe-style (a C-side path probe instead
   of the symlink) — recorded here so the symlink is known to be load-bearing,
   not scaffolding.
2. **`docs/ → doc/` and `example/` were owner calls** (2026-10-12), not
   derived names. Everything else in phase 2 follows the mechanical matrix;
   these two spellings are policy.

## Alternatives considered

(The section records both the rejected alternatives and the lessons the rewrite paid for — the two are the same list here.)

### Rejected alternatives

- **Rewriting the C side's `<base>/vendor` literals instead of the compat symlink** — rejected as semantic surgery inside a mechanical phase; the bundle contract is two-sided and a probe-style absorption is deferred to the deep-integration phase (recorded in the rulings).
- **Deferring `docs/→doc/`** — churn with zero build value, but the owner explicitly pulled it into scope (2026-10-12), so it rode PR-3.
- **A blanket `vendor/`→`external/` sed** — unfixable on double-spelled lines (see lesson 3); per-anchor, quote-anchored substitutions won.

### Lessons from the mechanical rewrite

1. **JS/pathResolve anchors are not shell cwd.** `resolve(HERE, '../vendor')`
   (HERE = `ci/`), `join(HERE, '..', 'vendor', 'npm')`, `join(TREE, 'vendor', …)`
   (TREE = `runtime/dsh`), `pathResolve(SPIKE, 'vendor/node_modules')`
   (SPIKE = `runtime/dsh`) each resolve against a different anchor, and a
   single-level `../external` is only correct when the anchor is a repo-root
   sibling directory. Per-anchor conversion, verified separately from every
   shell-cwd form.
2. **Composed spellings are invisible to literal grep.** `${DSH_ROOT}/vendor`,
   `${DSH_RUNTIME_DIR}/vendor`, `$DSH/vendor/…`, `$SPIKE/vendor/…`,
   `DSH / "vendor" / …`, `SPIKE / "vendor" / "npm"` contain the literal
   `runtime/dsh/vendor` nowhere — the literal-only pass passed them all. They
   were caught by a second sweep keyed on anchor definitions + splice shapes
   (`\$[A-Z_]+/vendor`, `VAR / "vendor"`), which found the harmony/android
   cpp CMakeLists, both stagers, and the iOS `gen_bundle_{header,resources}.py`
   repo-side expressions. Grep the anchor, not the path.
3. **Double-spelled parents need line-level judgment.** The same path phrase
   can appear twice in one line with different meanings: a TREES row's
   `vendor/dsh/agent@v=vendor/dsh/agent@v` is bundle-rel=source-rel (the
   bundle side must NOT move), and `fs-watch-idle-hooks.mjs` serves
   `startsWith('/vendor/')` (virtual label) while joining
   `join(TREE, 'vendor', …)` (real path) two lines below. Blanket sed is
   unfixable there — the staging `.rows` chain stays on the old source-rel
   spelling pending a regeneration decision — and every surviving dual-spelled
   line was resolved with prefix/quote-anchored substitutions that keep the
   bundle side byte-identical.

## Consequences

- The canonical paths are `external/`, `src/`, `example/`, `doc/`; `hosts/` and the `runtime/dsh` JS world are unchanged. `runtime/dsh/vendor` survives only as the ensure-dsh.sh compat symlink (the `<base>/vendor` bundle contract), documented and gitignored.
- The CMake face builds `dsh-core` + `dsh-cli` + `ish-smoke` from one `cmake --preset macos-dev` graph; `src/build.sh` is cwd-independent (`SCRIPT_DIR`/`ROOT` anchored).
- BuildIshEngine reconfigures its cmake build dir clean-on-mismatch, so a source-tree move can no longer poison the iOS Release leg the way it did the first post-#479 matrix run.
- Open follow-ups: the deep-integration phase (sync/stage as first-class CMake custom commands, one vendor manifest driving every host's embed lists) and the C-side probe-style absorption of the vendor contract.
