# Agent Note: the session-persistence flush failure: #762 retired the workspace VFS the vendored backend writes through

Status: implemented
Related: D6 (vendored bytes untouched), D9 (outboard adaptation lives in our layer)
Issue: #790 (closes the #656 row-15 tail's flush blocker)

## Problem

Every leg of the session-persistence family went red on main after #762:
`sh runtime/dsh/ci/run-session-persistence-e2e.sh` exits 1 with
`rt: error: session-persistence-jsonl flush failed` AFTER both legs'
scenario streams log pass, and the Android device face fails identically at
the create leg's explicit `backend.flush()`
(`web-live/session-persist-restart-core.js:310` →
`{"event":"scenario.failed","reason":"session-persistence-jsonl flush
failed"}`). The row-15 upgrade-matrix leg (the #656 acceptance) cannot go
green because the durable journal is never created. The failure was
undiagnosable by design: the vendored backend's `flushAll()`
(`@deepseek-ai/dsh-session-persistence-jsonl lib/index.js:384-399`) collects
the per-writer errors into an `AggregateError` whose `errors[]` nothing
surfaced — only the aggregate `.message` survived anywhere.

The root cause is one line removed 13 days before the failure report: #762's
fs seam-collapse (`91508837`, "collapse the dual capability planes onto the
upstream ctx seams") deleted `mountWorkspace(cwd)` from `boot.js`'s
`mountFileTools` when it swapped the vendored fs-local seat for the
gateway-fs `DshFsProvider`, under the claim "the in-memory workspace VFS is
retired here with the fs-local seat: no product consumer remains". The claim
missed a consumer: the vendored `@deepseek-ai/dsh-session-persistence-jsonl`
backend (mounted by the gated `sessionPersistence` row, #456) performs ALL
of its durable journal I/O through the RAW `node:fs/promises` faces
(`mkdir`/`open`/`writeFile`/`handle.sync`/`link`/`rm` over
`<root>/dsh/sessions`), and on this host those faces are served by the
writable-workspace half of the fs shims
(`upstream/shims/fs-promises.js:196 mkdir → fs-workspace-write.js:69 wsMkdir`).
With no workspace mounted, `wsAt` returns null and every write throws
`node:fs.mkdir: path outside the writable workspace root` — the first one
fires inside the backend's lease acquisition (`acquire` → `acquireLease` →
`mkdir`), so no journal is ever created and `flushAll()` rejects with the
unsurfaced AggregateError at every flush call site, including the exit
teardown.

Diagnosis proof (a temporary diagnostic seat, removed): surfacing the
AggregateError's `errors[]` named the exact writer error and stack; a
`globalThis.__DSH_WORKSPACE_FS__?.root` probe printed `undefined` in a
product boot.

## Decision

Two seams in `runtime/dsh/upstream/boot-session-persistence.js` (our glue;
zero vendored edits):

1. `armWorkspaceForBackend()` — the gated row re-arms the fs shims'
   writable-workspace VFS at the profile container
   (`globalThis.__dshProfileCwd`) before the backend mounts. `mountSessionPersistence`
   awaits it first. A pre-mounted workspace whose root already covers the
   container (the upstream-suite legs' own mount) is kept untouched; no
   pinned container is a no-op. The ungated boots (parity/golden, default
   off) stay byte-identical to the post-#762 shape — the gate brings back
   exactly the world its vendored consumer writes through, whose
   write-through mirror is the REAL-disk durability contract the e2e legs
   prove (the artifact must survive the process).
2. `surfaceFlushFailures(backend, log)` — wraps the mounted backend's
   `flush` face (one choke point; every consumer — the CLI scenarios, the
   web-live restart/midturn cores — gets it) so any future flush failure's
   per-writer causes reach `log.warn` with message/code/stack (warn
   survives the release L4 strip) and the original rejection rethrows
   unchanged. The logger is dynamically imported alongside the existing
   dynamic imports; the module stays importable directly under plain node
   (the panel suite's convention).

Test pins: `test/panel/session-persistence-flush-surface.test.js` (7 tests:
per-writer warn + rethrow, non-aggregate rejection, flush-less backend,
container-spelling normalization, keep-existing-mount, no-container no-op,
fresh mount). Stale-manifest correction: #762's breakage masked one boot
evidence event, so the midturn and multi-stress manifests each lacked a
resume-leg `llm.producer.bound` row (#681's event, 25→26 / 47→48 expected);
both rows added, legs re-receipted.

Host mirrors re-synced (`build/build.sh sync android`, `sync harmony`) — the
staged `boot-session-persistence.js` copies carry the fix byte-identically.

## Alternatives considered

- Restore the general `mountWorkspace(cwd)` in `boot.js`'s file-tools row
  (undo #762's retirement wholesale): rejected — it contradicts the
  seam-collapse decision (ctx.fs over the gateway primitives is the product
  face) and re-arms the VFS for boots that do not need it. The gated row
  arming it for its own vendored consumer is the minimal honest scope.
- Make the fs shims lazily auto-mount a workspace at the profile cwd when
  none is pinned: rejected — the shims' LOUD posture is deliberate ("a write
  without a world is a defect, not an empty result"); auto-mounting would
  silently mask exactly this class of consumer-glue drift everywhere.
- Surface the AggregateError at each of the ~8 flush call sites (scenarios +
  web-live cores): rejected — call-site churn with one choke point available
  at the mount seam; the exit-teardown path (vendor-side) would remain
  unsurfaced either way, and the wrapper covers every consumer that holds
  the service.
- Vendor-edit `flushAll()` to log its own errors: forbidden by D6; the
  upstream package is pinned and byte-verified.
