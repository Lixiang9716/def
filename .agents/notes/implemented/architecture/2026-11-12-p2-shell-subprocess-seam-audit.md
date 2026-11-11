# P2 seam audit — shell and subprocess: no dual planes; the subprocess seat stays honestly vacant, the shell keeps the gateway primitives

Status: implemented

Date: 2026-11-12 · Class: architecture · Seat: feat/seam-collapse-p2p3 (P2 of the seam-collapse program — 2026-11-11-collapse-the-dual-capability-planes.md, same directory; plan.md §13)

## Problem

P2 of the seam-collapse program audits the two seams the fs pilot (P1,
2026-11-11-fs-seam-collapse-provider-seat.md, same directory) did not touch:
`ctx.shell` and `ctx.subprocess`, each checked for the two-plane disease P1
cured on fs — the same capability served by a product-boot implementation AND
a second, differently-shaped implementation, so which one answers depends on
the mount chain a caller entered.

Both audits (2026-11-11, against this tree) return **dualPlane: false** with
empty collapse action lists. The load-bearing claims were re-verified in this
seat before landing (the greps, file reads, and the committed artifact cited
below). This note lands the honest dispositions: the verdicts, the doc
truthing that removes two phantom-service claims, and the recorded
seat-connection path for the first real subprocess consumer. No code mounts,
no provider swaps — collapsing now would mean mounting dead, wrong-shaped
code purely for symmetry with the fs pilot.

## Decision

### subprocess — no second plane; the cordis seat is vacant and stays vacant

The product boot mounts NO `ctx.subprocess` implementation, and that absence
is the honest answer, not a gap to fill:

- The vendored Definition declares the extension contract — "Abstract
  subprocess service. Subclass, implement spawn, and load the subclass as a
  plugin — it registers as ctx.subprocess (one implementation per context;
  loading a second throws)"
  (runtime/dsh/vendor/npm/@deepseek-ai/dsh-subprocess@0.1.6-alpha.2/lib/index.js:58,
  `SubprocessRuntime extends Service` with `super(ctx, "subprocess")` at
  :86-90) — and nothing subclasses it: `grep -n subprocess` over
  runtime/dsh/upstream/boot.js, boot-coverage-rows.js, and
  boot-subagent-rows.js returns zero hits, and the committed seam-inventory
  run of the production-equivalent spine measures `subprocess` in the absent
  list while `shell`/`shellEnv` are present
  (runtime/dsh/artifacts/macos-cli-seam-inventory/logs.txt:32).
- No product consumer exists to serve: bash rides `ctx.shell` — the
  composition host plane's JsShellExecutor subclass delegating to dsh-shell-js
  (runtime/dsh/upstream/boot-coverage-rows.js:111-135, fail-loud presence
  check), whose `child_process` applet stub refuses loudly ("no subprocess by
  design — the command cannot be executed here",
  runtime/dsh/system-plugins/dsh-shell-js/applets-support.js:46); terminals
  and LSP are absent faces on mobile (same inventory run:
  `terminals`/`lsp` absent), and SubagentRuntime mounts with no provider
  (runtime/dsh/upstream/boot-subagent-rows.js:26), so the out-of-process
  subagent backend is absent too.
- Our `dsh-subprocess-quickjs` is NOT a second plane: it is an M2-era
  REGISTRY-activate plugin (manifest.hooks.activate →
  `register('subprocess', { spawn })` —
  runtime/dsh/system-plugins/dsh-subprocess-quickjs/index.js:91) whose
  `spawn({ steps, context })` is a steps-array coroutine task runner
  (index.js:73-89) — a different contract from the upstream
  spawn(argv/cwd/stdio)/spawnTerminal/resolveExecutable face. Its only
  consumers are two scenario legs
  (runtime/dsh/scenario/session-mock-llm.js:156,
  runtime/dsh/scenario/install-from-http.js:251 — both
  `registry.service('subprocess')`).
- The vendored Definition rides the runtime closure as a constants carrier
  only: dsh-shell imports just `DSH_ENV_PREFIX` from it
  (runtime/dsh/vendor/npm/@deepseek-ai/dsh-shell@0.1.6-alpha.2/lib/index.js:2).
  The REAL subprocess face — dsh-subprocess-local over the W5-R
  `__dshProc*`/forkpty shims
  (runtime/dsh/upstream/shims/node-child-process.js:1-8,
  runtime/dsh/upstream/shims/node-pty.js:1-8) — serves the parity/upstream
  suite legs only; no host stages it into the product closure.

**Seat-connection path, when the first real consumer appears** (a
bash-local/LSP/terminal backend): follow the dsh-fs cordis precedent
(runtime/dsh/system-plugins/dsh-fs/cordis.js): author
`system-plugins/dsh-subprocess-<face>/cordis.js` as a class extending the
upstream `SubprocessRuntime`, implementing the upstream
spawn/spawnTerminal/resolveExecutable contract over the host seam that
consumer needs (the W5-R intrinsics for real children — the shims above
already exist for the suite legs), mounted once in boot.js beside its
consumer; cordis' one-provider-per-context rule then protects the seat. The
registry face of dsh-subprocess-quickjs stays as-is for the scenario legs.

**Doc truthing landed with this note** (the phantom-service claims removed):

- runtime/dsh/upstream/README.md:140 — the `child_process` mapping row said
  "service shipped in the dsh; upstream `dsh-shell`/`dsh-tool-bash` rows are
  the follow-up", stale since the dsh-shell row landed (2026-10-11 seat
  switch): the row now records the vacant seat, the registry-key-only role
  of dsh-subprocess-quickjs, and the suite-legs-only reality of the real
  subprocess face.
- runtime/dsh/system-plugins/README.md:8 — said dsh-subprocess-quickjs
  "implements `ctx.subprocess`"; it implements the registry's `subprocess`
  key (scenario legs), and the cordis `ctx.subprocess` seat is vacant.
- Known wording drift left deliberately: the plugin's own header
  (runtime/dsh/system-plugins/dsh-subprocess-quickjs/index.js:2-5) still
  reads "Upstream ctx.subprocess … whose spawn this implements". Its tree is
  byte-mirrored to the repo root, shipped as the pinned marketplace tgz
  (deploy/marketplace/site/packages/dsh-subprocess-quickjs@0.1.0.tgz), and
  staged into the hosts (hosts/ios/project.yml:130-131,
  hosts/harmony/ci/vendor-official.sh:851-852), so a comment-only edit would
  churn pinned bytes; fix it with the next functional edit of that package.

### shell — one plane, two consumers; the shell keeps the gateway primitives

No collapse and no rewiring. After P1 the shell's entire file world rides the
seven gateway fs primitives through ONE address derivation, and the `ctx.fs`
provider rides the same primitives with the same math:

- dsh-shell-js's manifest declares exactly the seven fs capabilities
  (fsRead/fsWrite/fsStat/fsList/fsMkdir/fsRemove/fsRename —
  runtime/dsh/system-plugins/dsh-shell-js/index.js:46); every fs call bottoms
  out at `__dshGatewayCall` over the C bridge
  (runtime/dsh/gateway.js:53). `toGateway`
  (runtime/dsh/system-plugins/dsh-shell-js/applets-support.js:115-125) is the
  shell's only address derivation: workspace-relative internal →
  `{scope:'app', path: prefix/rel}` with prefix = `__dshProfileCwd` minus
  `__dshProfileScopeRoot`, read from the pinned globals — and an ungranted
  container refuses loudly (GatewayError `unavailable`, :77-87).
- The P1 provider computes the byte-identical address
  (`DshFsProvider.address`,
  runtime/dsh/system-plugins/dsh-fs/cordis.js:104-115, whose header cites
  "the dsh-shell-js toGateway rule" at :17), so one address space serves both
  consumers; #762's promotion of the ten shell-diff divergence pins holds the
  two to the same bytes on the real seat.
- The shell is deliberately NOT routed through the `ctx.fs` service object:
  its manifest honestly declares only the primitives it needs, keeping it
  mountable on hosts that grant the seven primitives without the fs tool row.
  Re-pointing it at ctx.fs would add a service dependency for zero reduction
  in world count. The residual-second-fs-face check comes back clean: the
  writable in-memory VFS is retired from the product boot
  (runtime/dsh/upstream/boot.js:202-204 — "the in-memory workspace VFS is
  retired here with the fs-local seat"; the provider mounts at :211), and the
  node:fs/promises real-disk read fallback inside the workspace root is an
  adjacent plane the shell never touches.

**Deferred hygiene (recorded by the audit; sized P3; no behavior change
decided here)** — no plan §13 row carries these yet:

- The address derivation exists three times with identical math — shell
  `toGateway` (applets-support.js:115-125), `DshFsProvider.address`
  (cordis.js:104-115), dsh-office `scopePathFor`
  (runtime/dsh/system-plugins/dsh-office/fschannel.js:22-33, "verbatim from
  dsh-shell-wasm's") — dedupe into one shared rule so a future edit to one
  copy cannot silently re-open the two-address-space bug this program
  closed; no gate currently pins the three copies together.
- Stale fs-local/mountWorkspace words: runtime/dsh/upstream/web-write-files.js:6-11
  ("the REAL vendored `fs` service (dsh-fs-local)", "ONE in-memory root
  (mountWorkspace)"), runtime/dsh/upstream/shims/fs-seam-gate.js:33 (the
  EACCES text still names mountWorkspace), and
  runtime/dsh/upstream/boot-coverage-rows.js:143 (the file-reference walk
  comment still says "the SAME pinned workspace world the `fs` service
  serves").
- Posture asymmetry: an ungranted scopeRoot makes the shell (and office,
  fschannel.js:22-33) refuse loudly while `cordis.address` silently degrades
  to the empty prefix — harmless on every real seat (cwd pinned; correct
  whenever workspace == scope-root) but asymmetric config-error detection.

## Alternatives considered

- **Mount dsh-subprocess-quickjs as the cordis `subprocess` provider
  (symmetry with P1) — rejected.** Its `spawn({steps})` is a different
  contract from upstream `spawn(argv/cwd/stdio)`; mounting it would put a
  wrong-shaped face on the seat, break the first real consumer at cordis'
  duplicate-service boundary, and force a teardown later. Dead code on the
  product spine for symmetry is exactly the dishonesty this program exists
  to remove.
- **Mount the vendored dsh-subprocess-local now to fill the seat —
  rejected.** No product consumer exists: bash rides ctx.shell, and
  PTY/terminal, LSP, and out-of-process subagents are all absent or
  provider-less on mobile. Staging the real-children provider into the
  product closure would mount code nothing calls.
- **Re-point the shell at ctx.fs — rejected.** The shell riding the gateway
  primitives directly is one plane already; a ctx.fs dependency would break
  hosts that grant the seven primitives but not the fs tool row, and changes
  nothing about world count.
- **Landing the deferred hygiene inside P2 — rejected as scoping.** The
  audit sized the dedupe/comment/degrade items as P3-sized follow-ups;
  landing them here would blur the phase boundary plan.md §13 tracks
  without changing any P2 verdict. They are recorded above so the follow-up
  picks them up deliberately.
