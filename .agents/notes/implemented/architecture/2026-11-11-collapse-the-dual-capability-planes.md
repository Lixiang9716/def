# Agent Note: The dual capability planes collapse onto the upstream ctx seams — the def provider package becomes the only implementation

Status: implemented
Related: D1, D2, D6, D7, D8, D9 (the decision and its P0 documents land with this change; P1/P2/P3 are tracked in [plan.md](../../../../plan.md) §13)

## Problem

The same capability — the filesystem — exists in two parallel worlds, and
fs is the pattern, not an accident:

1. **The product boot world.** `runtime/dsh/upstream/boot.js` `mountFileTools`
   (runtime/dsh/upstream/boot.js:198-210) mounts the in-memory workspace VFS
   (`mountWorkspace` — "a fully in-memory tree rooted at ONE pinned workspace
   root", runtime/dsh/upstream/shims/fs.js:28-32), names the vendored
   `@deepseek-ai/dsh-fs-local` as the `fs` service in the spine inventory
   (runtime/dsh/upstream/boot.js:187) and registers it by dynamic import +
   `ctx.plugin(LocalFileSystem, { cwd })` (runtime/dsh/upstream/boot.js:202-207),
   then mounts the upstream file tools
   (tool-fs, str-replace-editor) over it into the ToolRuntime.
2. **The contract face.** `system-plugins/dsh-fs` — a 98-line system
   implementation plugin that consumes ONLY the frozen gateway primitives
   fsRead/fsWrite/fsScope (system-plugins/dsh-fs/index.js:6-8; required
   capabilities declared in its manifest at :23), exercised by the
   install-cycle scenario legs (runtime/dsh/scenario/session-mock-llm.js:24,
   install-full-cycle.js:37, install-from-http.js:35,
   install-verified-tarball.js:26 — each imports
   system-plugins/dsh-fs/index.js) but mounted by no product
   boot — boot.js mentions it only in a passing comment
   (runtime/dsh/upstream/boot.js:83). The row's namesake probe,
   runtime/dsh/scenario/tool-fs-probe.js, exercises the OTHER plane — its
   own header says so: "the vendored @deepseek-ai/dsh-fs-local backend
   mounted as `ctx.fs`" (runtime/dsh/scenario/tool-fs-probe.js:3-5).

One capability, two audit surfaces, two maintenance burdens, two test beds.
The ownership structure is unreadable to a person: which implementation
answers a given read/write depends on which mount chain a caller entered,
and nothing names that decision. The ambiguity is what produced a proposal
to fork the upstream packages and edit their code directly — the strongest
possible sign that the two-plane structure had stopped being readable and
someone wanted to fix it by breaking D6 instead.

## Decision

Collapse the planes and swap the provider:

- **The upstream ctx seams are the only capability surface.** `ctx.fs` —
  the seam owned by the vendored `fs` package, consumed by tool-fs, with
  fs-local/fs-sandbox/fs-ssh as swappable implementations (the `ctx.fs` row
  in third-party/deepseek-harness/docs/capability-seams.md) — and its
  sibling seams keep their upstream contracts unchanged.
- **The def provider package is the only implementation.** A system plugin
  implements the upstream FileSystem face over the irreducible native ABI:
  the capability gateway's primitive table — fsRead/fsWrite/fsScope with the
  durable-fs additions, httpFetch, presentApproval, notify, presentPicker,
  and the device plane (contract/primitives.md v1.11.0). Vendored backends
  (fs-local and friends) leave the device seat.
- **Switching providers is the seat-swap mechanism.** This is upstream's own
  seam semantics — "sandboxed, remote, or PowerShell executors replace
  bash-local without touching them" (the `ctx.shell` row in
  capability-seams.md) — with this repository's precedent: the shell seat
  switched to dsh-shell-js on 2026-10-11
  (2026-10-11-the-shell-seat-switches-to-dsh-shell-js-.md, same directory).
- **The audits, the permission flags, and capability negotiation stay.**
  They are shipped product features — the capability flags per primitive
  family (contract/primitives.md), the required-capability manifests
  plugins declare — not ceremony. The collapse removes a duplicate
  implementation plane; it does not remove the published contract.
- **Forking upstream was rejected; D6 and D9 stand as written.** D6 (pinned
  upstream + outboard implementation packages) and D9 (verbatim vendored
  packages, in-house code is glue only) keep their full text in
  doc/decisions.md — this decision applies them, it does not amend them.

Phasing: **P1** = the fs pilot (dsh-fs gains the upstream FileSystem cordis
face over the gateway primitives; boot's mountFileTools swaps its seat to
the provider and the inventory row updates); **P2** = the shell/subprocess
collapse audit; **P3** = contract slimming and the tool-writing contract
upgrade (plan.md §13 carries the rows). New code follows the writing method
(doc/writing-method.md).

## Alternatives considered

- **Fork upstream and edit its code directly — rejected.** The upstream
  cadence is 26 tagged releases in the first month on record alone
  (third-party/deepseek-harness/docs/persistence-changes/releases/, source
  dates 2026-08-10 → 2026-09-10), and the closure's re-pin history shows
  upstream re-cutting even a pinned version in place
  (external/ensure-dsh.sh:160, the 2026-09-22 re-pin note). The files a fork
  must edit — boot composition, fs backends, session persistence — are
  precisely the upstream's highest-frequency-change files, so a fork is
  permanent merge debt (the exact alternative D6 already rejects). Session
  format drift severs D7 checkpoint roaming and plugin compatibility. And
  the physical constraints do not go away: the runtime has no node builtins
  to lean on (the engine is quickjs-ng, D1 — the npm/node shim layer exists
  precisely because of that) and iOS refuses subprocesses (D2), so the
  shims and the provider work a fork hopes to delete shrink by exactly
  zero — the fork buys the debt and not the simplification.
- **Keep the two worlds — rejected.** That is the disease this decision
  treats: two audits, two maintenance burdens, two test beds per capability,
  and an ownership question answered by mount order. Keeping it would
  replicate the split for every future capability the shell/subprocess
  family touches next.
- **A fully custom architecture — rejected by the owner.** The layout and
  the vocabulary borrow an already-proven reference: the community
  anywhere-labs/dsh-desktop skeleton is literally the pin source
  (external/ensure-dsh.sh:101 — vendor/dsh-runtime under that repo's tree)
  and the upstream writing practice is the documented reference
  (third-party/deepseek-harness/docs/; doc/dsh-desktop-plugins.md records
  the alignment). A custom architecture would trade a proven vocabulary for
  an unproven one and strand every plugin, scenario, and doc written so far.

## Consequences

- **P1 (fs pilot):** dsh-fs carries the upstream FileSystem (`ctx.fs`)
  cordis face over the gateway primitives; boot's mountFileTools swaps to
  the provider seat and its inventory row updates — the same mechanical
  shape as the 2026-10-11 shell seat swap. The in-memory VFS keeps its
  LOADER role — the module filesystem is a distinct thing from the
  capability plane (runtime/dsh/upstream/boot.js:12-13: "there is no disk
  Loader because the gateway fs scopes are not the module filesystem"); what
  changes is which implementation answers the capability.
- **P2:** the shell/subprocess planes get the same collapse audit
  (`ctx.shell`/`ctx.subprocess` against the emulated-userland primitive
  family, contract/primitives.md v1.3.0), producing seat swaps or explicit
  keep-vendored verdicts per row.
- **P3:** contract slimming plus the tool-writing contract upgrade; the
  writing-method conventions (doc/writing-method.md) get promoted to gates
  where a command can check them.
- **Non-goals stay non-goals:** no upstream edits, no new gateway primitives
  to fake a node face, no second in-house Harness (D9). Progress reports
  continue as event sequences; nothing here reintroduces a blocking
  whole-result API (D8).
