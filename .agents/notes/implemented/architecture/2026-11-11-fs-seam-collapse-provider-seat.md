# The fs seam collapse: the dsh-fs cordis face becomes the product `ctx.fs` provider

Status: implemented

Date: 2026-11-11 · Class: architecture · Seat: feat/seam-collapse (the fs塌层试点)

## Problem

The product boot's `ctx.fs` (the upstream FileSystem seam every file tool and the
workspaceFiles wire program against) was served by the vendored `@deepseek-ai/dsh-fs-local`
backend running over the in-memory workspace VFS (`shims/fs.js mountWorkspace`). That seat
duplicated the fs world: files the tools wrote lived in an in-memory store invisible to the
gateway fs scopes every other consumer (office tools, shell applets, session persistence)
read and write through; the gateway fs primitives (`fsStat`/`fsList`/`fsMkdir`/`fsRename`,
contract v1.1.0, plus the v1.11.0 durable pair) existed because fs-local's semantics needed
them, yet the product backend used none of them. Two capability planes, one product.

## Decision

The upstream `ctx.fs` seam is now the ONLY fs surface, and OUR `dsh-fs` plugin serves it:

- `system-plugins/dsh-fs/cordis.js` (+ `cordis-io.js`, split at the code-size gate) adds the
  cordis face: a `FileSystem` subclass over the gateway primitives. FsTarget.targetKey is
  the normalized scope-relative POSIX path; displayPath/processPath stay the absolute
  in-world spelling (the workspaceFiles path-math anchor); versions are the fsStat signal
  (`mtime:size`); writes/edits create parents (`fsMkdir`) then publish through
  `fsPublishAtomic` (the contract's one-step temp→write→fsync→rename→fsync(dir) — the
  rename-based atomicity fs-local implements in-process), under fs-local's per-target lock.
  The registry face (`index.js` `activate`) is untouched, and the marketplace package
  (top-level `system-plugins/dsh-fs`) is byte-identical — its install digests are pinned by
  the marketplace-install scenario.
- boot.js's file-tools row mounts `DshFsProvider` where fs-local mounted, and the
  in-memory workspace VFS is retired from the product boot (no consumer remains: the
  workspaceFiles reads ride `ctx.fs`; the directoryPicker's createDirectory now creates
  through the gateway `fsMkdir` with the picker's `existing: "error"` exists refusal — the
  in-memory `wsMkdir` it used would have created directories the fs service cannot see).
  The vendored fs-local stays in the closure untouched (D6) for the parity/suite legs.
- The CLI host (`example/main_cli.c`) now SERVES `fsMkdir` and `fsList` and declares
  `fsStat`/`fsMkdir`/`fsList` in both descriptor flavors: with the file-tools row on the
  gateway seat these are product needs (v1.1.0 exists for exactly fs-local's
  resolve/list/mkdir semantics), not probe conveniences. `fsRename` stays honestly absent.
  The audit-invariant leg's fs.list/fs.mkdir cells move from the unavailable quadrant to
  served success cells (with a real listing roundtrip over the publish canary); the pinned
  manifest follows (available 10→13, same event count).
- The anchored editor delegate passes `waterfall` through: the vendored editor's
  create/str_replace/insert legs drive `fs/write-intent`/`fs/edit-intent` on it, and the
  delegate never served it (latent — the composition probe it breaks was itself inert on
  main: `tool-fs-probe.js` defined `main()` but never invoked it, and assigned an undeclared
  `ctx`; this change makes the probe runnable and its 9-step ladder green).

Declared gaps (cordis.js header): version tokens have the stat's own granularity (no
dev/ino across the gateway), no symlink face, byte windows transit the whole file (no
windowed read primitive), paths outside the workspace refuse `FS_SANDBOX_DENIED` before any
primitive call, and `sandboxPolicy` is accepted-and-ignored (the granted scope IS the
boundary; base `sandboxMode` stays undefined).

## Alternatives considered

- Keep fs-local and mirror its writes into a gateway scope post-hoc — rejected: two write
  paths cannot be made atomic or consistent across gateway round-trips; the seam exists to
  have exactly one fs surface.
- Re-point the VFS store at the gateway (implement node:fs faces over primitives) —
  rejected: it keeps the shim indirection the collapse exists to remove and serves only
  fs-local; a direct FileSystem provider is the upstream contract's own extension point.
- Serve fsRename on the CLI host too while touching main_cli.c — rejected: no product row
  needs it yet; an unavailable row is information, and the audit leg keeps pinning it.
