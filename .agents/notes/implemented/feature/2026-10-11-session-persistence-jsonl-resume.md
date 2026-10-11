# Agent Note: the session-persistence-jsonl backend lands behind a default-off boot gate (the resume leg)

Status: implemented
Related: D6/D9, the W-PERSIST staged row in runtime/dsh/upstream/README.md,
the vendor-package skill, issue-class "resume unavailable (loud)"

## Problem

Sessions died with the process. The vendored agent-loop reports
"cannot resume: session persistence is not configured (load a
dsh-session-persistence backend)" (agent-loop lib/index.js, the `resume`
entry) because the mobile profile mounted no backend: the
`@deepseek-ai/dsh-session-persistence` seam was vendored, but its concrete
JSONL backend was not, and the upstream mapping table carried the staged
row "jsonl backend over the fs scope (no native deps)" with resume loudly
unavailable. A CLI or device process that ended took its session journal
with it, so no agent could continue across a restart.

The blocker chain was non-obvious: the upstream backend's native row
(koffi/flock on the desktop) has no mobile equivalent, and its module
graph (session-format family + node:zlib's zstd face + node:worker_threads
+ a hard-link publish protocol) has to load AND be durable inside a
runtime whose node:fs face is an in-memory workspace VFS.

## Decision

The upstream backend is vendored VERBATIM (add-package.sh fetch →
NPM_PACKAGES pins: dsh-session-persistence-jsonl + dsh-session-format +
the v0→v1/v1→v2/v2→v3 migration adapters — the closure its lib/ links),
and the native row rides shims that already existed for exactly this
family: `node-addon-system-flock.js` (the single-process lock face
upstream's own webworker runtime ships, same argument verbatim) and
`node:zlib` over the host's compiled-in zstd intrinsics.

The mount is a GATED boot row: `upstream/boot-session-persistence.js`
exports `maybeMountSessionPersistence(ctx, identity)` — a no-op unless the
caller passes `options.sessionPersistence`, so every parity/golden leg
boots byte-identically (the empty-boot-list precedent). The dynamic import
is load-bearing twice: the gate (a static import would demand the vendored
packages on every boot) and the evaluation order (the backend's module top
reads the `process` global, which pinProfileContainer installs first).
When mounted before the agent loop, the loop's config-driven start takes
its own restoreOrCreateConfigured wire: the configured session RESUMES
from the stored artifact, falling through to create only on
SessionPersistenceNotFoundError — no new seam, upstream's own shape.

The root defaults INSIDE the profile container (`<cwd>/dsh/sessions`, the
`<filesDir>/dsh/sessions` twin), and durability rides the fs shims'
existing contract: write-through mirror on write faces + real-disk read
fallbacks on read/stat/readdir. One shim gap had to close:
`wsLink` was VFS-only, and the backend publishes its log via
link()+unlink() — the link was the LAST writer of the artifact's bytes, so
the staged temp's write-through mirror was unlink-mirrored away and a
stored session left the container disk with directories only (measured in
the proof's disk check). `wsLink` now materializes the linked bytes at the
destination (8 MB cap, best-effort, same posture as the sibling mirrors;
the VFS stays the world of record — byte-identical durability is what the
disk needs, not real-inode identity).

One shim-cycle fix the backend's graph forced: the node:stream family's
writable half back-imported node-stream.js, and the bare 'node:stream'
map row plus the bundle-path spell are TWO module instances — the second
instance's duplex import evaluated `class Duplex extends SinkEvents`
against a mid-evaluation writable ("SinkEvents is not initialized",
measured with the link probe). The readable base (MiniStream/PassThrough/
Readable) moved to `node-stream-readable.js` (imports nothing from the
family); node-stream.js is now a pure aggregator and every spelling
re-exports the same class objects.

Proof (cli/run-session-persistence-e2e.sh): ONE pinned profile container
(DSH_SPIKE_TMPDIR), two dsh-cli processes over the mock LLM loopback —
process 1 creates the session, one mock turn journals it, the artifact
lands on the REAL container disk (`session.v3.jsonl.zstd`, 7821 bytes);
process 2 boots the same config, the config-driven start RESUMES (no
"cannot resume" anywhere), the restored seed carries turn 1 + its
assistant message, the second mock turn continues the journal
(turn/start 1 and 2 in one log, turnBoundary.lastTurn == 2).

## Alternatives considered

- Write an in-house JSONL backend over the gateway fs primitives (the
  README's original staged row, "no native deps"): rejected — it would
  fork the upstream persistence contract (create/open/append/flush/stat
  + the format v3 artifact layout) into a second implementation this
  repo must keep in parity forever, exactly what D6 outlaws. The vendored
  backend plus the two shims is fewer new bytes and none of them are
  upstream semantics.
- Make the bare map row and bundle-path spell share ONE module instance
  (loader C change: compile bare-mapped shims under their rel path):
  rejected for this item — it fixes the whole dual-instance class but
  re-keys every shim module (cache-buster semantics, defined-table, the
  parity legs), a wide blast radius no current defect requires. The
  readable-base extraction fixes the cycle locally; the general fix is
  its own proposal if another family trips.
- Mount the backend ungated (the desktop default): rejected — the mount
  changes boot behavior for every leg (a backend that answers
  stat/open changes the loop's create path) and the parity/golden
  manifests pin the current shape. The gate is one option object; hosts
  adopt it explicitly.
- Real hard links in the link mirror (link(2) on the real side):
  rejected — the mirror family is best-effort by design and its source
  may not exist on the real side; byte-identical materialization gives
  the durability the disk needs without claiming inode identity the
  VFS cannot honor.

## Consequences

- Cross-start resume works wherever the container is real and pinned
  (the CLI proof; device hosts back the fs scopes with filesDir).
- The vendored jsonl family joins ensure-dsh.sh (5 NPM_PACKAGES rows) —
  CI materializes them from the tracked mirror like every other pin.
- The per-host PRODUCT wiring (turning the gate on per host, staging the
  vendored trees into the device embeds, a settings surface for the
  root) is deliberately NOT here: the embeds carry only the files the
  staged graph demands (boot-session-persistence.js +
  node-stream-readable.js), and a host turning the gate on without the
  vendored trees fails loud at the dynamic import naming the specifier.
- The wsLink real-disk mirror is best-effort like its siblings: a mirror
  failure leaves the session in the VFS only (this process still sees
  it; the NEXT process does not) — the same honesty boundary the write
  family has shipped since W6-U.
