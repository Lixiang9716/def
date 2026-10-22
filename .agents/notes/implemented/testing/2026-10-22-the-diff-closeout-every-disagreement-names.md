# Agent Note: the diff-closeout — every disagreement names its finding

Status: implemented
Related: plan §3.17 (the terminal table this closes), the 2026-10-21 notes
(the 101-row classification, the Tier-2 re-triage, fixture seeding, the
b-closeout), dsh-mobile#626, the sweep Node driver (#631)

## Problem

The b-closeout left a 42-row disagreement surface where every row carried a
NAMED MECHANISM but no row had a DISPOSITION: c-class runtime deltas, the
loader-internals edges, d-class frozen-contract rows, and the five
isolation-exposed rows all looked identically red, and the sweep could not
tell an open finding from a settled one. Four cold-seat regressions the
b-closeout seat had left unprovisioned (the node-pty compile was a manual
step) were already muddying fresh measurements.

## Decision

Five investigator waves (three read-only agents, two in-session digs), each
fix verified solo before landing, took the seat's surface from 46
disagreements (42 + the 4 regressions) to **16 rows, every one in the
committed differential ledger** (`test/upstream-suite/differential-ledger.json`,
read by the sweep driver; totals report documented vs unexplained and name
every unexplained/stale row):

- **30 rows flipped to agreement.** The big buckets: the loader bridge row
  now registers on the node harness (RAW Loaders had no `internal.import`);
  the node-pty binding compiles in `parity-node-modules.sh` (provisioning,
  not by hand) and links into the work root; the transpile-inline siblings
  stage (fake-runtime.ts, fixture-server.ts, worker.js, control.ts at BOTH
  work-root URL spellings — node's URL math walks one level higher than the
  qjs clamp); the farm re-anchor (rule 2) is ENUMERATED to the five
  compaction/goal names whose two-face split was proven (the blanket form
  hijacked tool-web — the spec side must keep the runtime-vendor dsh-web);
  the FormData dual-realm gate probes a member both Blobs expose and wraps
  native Blobs into the native File; the no-real-package bridge rows
  (openai/@anthropic-ai/sdk/partial-json) register; `cross-spawn` serves the
  real spawn (the D2 refusal predates the seam); `crypto.randomUUID`
  attaches; Headers record-init SETS; `spawnCwd('')` unsets; fs truncate
  grows SPARSE (node ftruncate semantics — the read-image durability rows
  flipped with it); `node:module` resolve learns exports-map subpaths;
  `stubEnv(undefined)` deletes (real vitest semantics); `existsSync` falls
  through a VFS miss to the real-disk twin (the read arms already did — the
  driver's real `/bin/cp` staging was invisible to the vendored
  `packageInstalled` walk); the child pump emits stdio 'close'; the decoder
  nullary face flushes one U+FFFD; stream push coerces strings;
  `readableLength` exists; the loopback ClientRequest gained `setTimeout`
  (the OTLP exporter calls it unconditionally).
- **16 documented rows**: 9 d-contract (5 ssh TLS refusals, 4 persistence
  worker refusals — qjs answers by design), 5 c-delta (shipped-root's
  intentional `mobile` preset; workspace-changes' /tmp-HOME exclusion +
  the tmpdir container pin; acp turns' cancel-delivery microtask depth;
  sdk-client's stderr-tail settlement; otel egress' agent-lookup capture
  hop, probe-evidenced), 2 both-red (spawn-runner's `.ts` branch pinned by
  single-file transpile; typert type-model's real-tsc strictness, qjs 3/54
  vs node 10/47).

## Alternatives considered

- **Blanket farm re-anchor for all `@deepseek-ai/dsh-*`** — landed, then
  reverted to the enumerated form: the runtime-vendor face (what the qjs
  runtime serves) and the npm face are different bytes for dsh-web, and
  tool-web's spec tests the runtime-vendor behavior (measured: 3 turndown
  regressions).
- **Honor the TMPDIR env in `os.tmpdir()`** (the vendored workspace-changes
  row drives a real-node env rewrite) — rejected: macOS shells always set
  TMPDIR, so env-first moves every tmp write out of the fs sandbox; the pin
  is a frozen contract and the facet is ledgered.
- **Chase the last two probe-evidenced hops (otel capture, sdk-client
  stderr settlement) this seat** — rejected with disclosure: both are
  pinned to a single named hop each with probe logs; they stay documented
  c-delta rows instead of blocking the terminal surface.

## Consequences

The sweep's disagreement count is now an ACCOUNTED number: documented rows
carry class + mechanism in committed data; an unexplained or stale row is
loud in the totals. The weekly sweep (§3.16) audits the ledger from here.
Cold seats no longer regress the real-PTY rows (the compile rides
provisioning), and the driver stages the transpile-inline siblings itself.
Known residuals stay honest in the ledger, not in a TODO.
