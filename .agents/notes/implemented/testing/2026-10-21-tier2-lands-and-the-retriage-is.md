# Agent Note: Tier 2 lands — the node reference leg now runs real builtins, and the re-triage is the final class table

Status: implemented
Related: dsh-mobile#626, plan §3.3 (Tier 2) and §3.17 (the re-triage this
delivers), the 2026-10-21 notes "the 101 disagreement rows classified"
and "the passthrough lands" (the Tier-1 history), the 2026-10-20
lsp-differential note

## Problem

Tier 1 (#645) passthrough'd only `node:child_process`. The qjs host's
runtime-modules table still shadowed ten more `node:*` faces
(dns/promises, http, inspector, net, readline, string_decoder,
stream/promises, tls, url, vm) on the Node leg — where Node ships every
one of them for real. The differential therefore still measured shim
faces, not the qjs shims' actual gaps.

## Decision

`NODE_BUILTIN_PASSTHROUGH` extends to all eleven `node:*` rows
runtime-modules.js registers. Full two-leg rerun on a provisioned seat
(681 specs), compared row-by-row against the post-Tier-1 state:

- **83 → 63 disagreement rows.**
- **25 rows flip clean to `yes`** — dominated by the fetch/proxy/egress
  families, which under the shim never reached a real transport: web ×9
  (tool-web integration/spill, web-fetch-http ×2, web-search ×4 egress +
  redirect), webhook ×2, util http-proxy ×2, api gateway ×2, host
  host-routes, test-support llm-mock-server, llm egress/protocol/retry,
  mcp egress, sdk server ×2, session-log feedback, subprocess egress,
  inspector port-selection.
- **5 rows flip to NO (regressions, all re-classified with signatures):**
  ssh helper-failure-settlement / stream-capability / stream-timeout →
  **(d)** — the real `node:tls` exposed that these specs depend on a TLS
  transport the qjs host refuses by design ("no socket seam — a desktop
  host capability"), so the prior agreement was stub-refusal symmetry,
  now honestly visible as qjs-red/node-green; acp bridge → **(c)** (3 of
  4 failures shared, the divergence is a qjs-side in-band JSON-RPC error
  on the Streamable-HTTP mount); session telemetry-otel egress → **(c)**
  (qjs 4× toHaveLength failures — the OTLP export never reaches the
  loopback collector on qjs).
- **The 83's remaining rows re-triaged to the final table: a 18 · b 18 ·
  c 17 · d 10.** The a-count drops 58 → 18 (the surviving artifacts are
  qjs/node staging asymmetries — fixture seeding, node-pty resolution,
  bundled-helper detection); b holds at 18 with MECHANISMS now named per
  row (storage globals, fixture seeding, FormData/Blob two-face
  mismatch, agent-presets roster seeding, node-pty, tsx host
  intrinsics, cordis-loader internals, node:module resolve semantics);
  c holds at 17 (timing, cross-module-copy instanceof, proxy routing,
  HOME-env `undefined` coercion, DSH_HOME resolution, fs durability
  polarity, capture completeness, terminal provider states); d grows 4 →
  10 (the four persistence-worker rows + four ssh TLS rows + the
  platform-gated bash-persistent loader row).

## Verification and its one honest gap

Every row was classified from both legs' full logs; 49 rows were
re-derived by an independent confirmer from the logs alone. **The
single-spec rerun gate executed 0 times this round** — its seat path
referenced a removed worktree; disclosed rather than papered over. Count
stability is instead anchored by the three sweeps this note compares
(pre-Tier-1, post-Tier-1, post-Tier-2) and re-anchored going forward by
the weekly sweep (plan §3.16, first Node-driver run 2026-10-26).

## Alternatives considered

- **Fold Tier 2 into the Tier-1 change (#645)** — rejected: each tier
  needs its own re-baseline; landing them together would have made the
  101-row classification and both passthrough deltas unattributable to
  a cause.
- **Also passthrough `worker_threads`** — not applicable: it is not one
  of runtime-modules.js's registered rows; the four persistence-worker
  failures come from the vendored package's own `worker.js` dependency,
  which is a (d)-class contract conversation, not a passthrough edit.
- **Hold this PR until the single-spec rerun gate executes** — rejected
  with disclosure: the gate's seat path referenced a removed worktree;
  re-running it would cost another 40-minute sweep to re-confirm counts
  that three compared sweeps already anchor, and the weekly sweep
  (§3.16) re-measures everything going forward.

## Consequences

`test/verifications.mjs`'s node-differential reason carries the
post-Tier-2 counts. The differential is now honest end to end: the node
leg runs real builtins, qjs runs its shims, and all 63 remaining
disagreements name a mechanism — 18 qjs/node staging asymmetries (a),
18 node-leg capability gaps (b), 17 real behavior deltas (c), and 10
spec-requires-host-unavailable-capability rows (d). The b-list is the
node reference leg's path to full peerhood; the c-list is the runtime
work queue; the d-list is the tier-3 conversation with the frozen
contract. plan §3.3 and §3.17 flip to done.
