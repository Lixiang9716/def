# Agent Note: the scoped Stryker mutation pilot and what its survivors said

Status: implemented
Related: T-0239; test-hardening item 5 (doc/test-coverage.md table row 5 —
status untouched there, per the pilot's informational mandate); extends the
falsify-then-restore discipline of tools/publisher-token.test.mjs.

## Problem

The repo's test suites were judged by coverage and by review, neither of
which can say whether the assertions would notice a behavior change. The
hardening plan called for exactly one instrumented answer: a scoped mutation
pilot over three pure-logic families, informational only — a score plus a
per-survivor triage, never a gate.

## Decision

`test/mutation/` — a standalone harness package (own package.json, own
node_modules, gitignored scratch), with one stryker config + one vitest
config per family. The mutant runs execute the families' EXISTING suites
unmodified through per-family vitest configs; Stryker mutates sandbox
copies. Zero production bytes changed; zero test re-pointing. Three runs
(Stryker 9.6.1, vitest runner, perTest coverage):

| family | mutate scope | suite | baseline | final | time |
|---|---|---|---|---|---|
| shell-js refusal vocab | applets-support.js wholesale + applets-shelljs.js's shellStringOutcome (mutation range 123:1-133:2) | test/panel/shell-js*.test.js | 52.76% | **83.45%** | 22s |
| lynx fold state machine | shared/fold.js + shared/surface-core.js | tests/fold.test.js + tests/seam.test.js | 58.10% | **95.42%** | 15s |
| publisher-token | tools/publisher-token.mjs | tools/publisher-token.test.mjs | 78.86% | **98.29%** | 7s |

The gap between baseline and final is the point: 48 new pins, all in the
families' existing test files, all killing hand-verified survivors. The
remaining 64 survivors + 21 no-coverage mutants are triaged below — every
one hand-checked (the mutant applied to the real file, the suite re-run)
before it was called equivalent.

## The triage (per survivor class; locations are file:line in the mutated file)

Killed by new pins — the real gaps the pilot found (55 mutants):

- **tools/publisher-token.mjs — the C1 counterexample net was vacuous.**
  The required-claims loop minted tokens with `verifier` as SIGNER; the
  verifier's non-string guard returned `false`, so every minted token died
  at `bad signature` and never reached the claim rules — all claimDefect
  mutants (REQUIRED_STRINGS=[], the loop body, per-claim conditionals and
  reason strings) passed 15/15 green. Fixed by minting with `hmacSigner`
  and asserting each rule's exact reason. This is the pilot's headline:
  a falsify-then-restore suite whose falsification never reached the code
  it was falsifying.
- **Time-boundary semantics** (iat===now accepted, exp===now rejected,
  lifetime===MAX_TTL accepted) — the `>`/`>=` family at L114-116 had no
  boundary pins.
- **SUB_PATTERN anchors** (`^`/`$`): `xpublisher:acme` and
  `publisher:acme/evil` were accepted by the anchor-dropped mutants.
- **F2 folded payloads**: JSON `null`/`[1,2]`/`"str"` claims and JSON
  exponent overflow (`1e400` → Infinity) reached claimDefect — the shape
  and finite guards were untested; the never-throws-on-attacker-bytes
  contract (wrong-length signature through timingSafeEqual) too.
- **F2 missing verifier** (`no signature verifier supplied`) and the
  hmacVerifier strict-boolean contract (non-string signature → false).
- **shell-js**: the argv face (long-option refused BY NAME with the
  implemented-flags hint, cluster walk naming `-l`, `--` passthrough, lone
  `-` as a word, value-flag-missing-value refusal), the scopeRoots
  capability-gap mapping through the executor (GatewayError
  code 'unavailable' → exit 2 — exec.js:323 branches on that string),
  shellStringOutcome's full normalization table, the path face's POSIX
  spelling table (join/resolve/relative/dirname/basename/extname),
  textOfStdin's null contract, unavailableRefusal's exit-2 message, the
  NO_SUBPROCESS thrown-value contract.
- **lynx fold**: streaming tool-phase tail residency (a phase misroute into
  the waiting branch satisfied the old byCall-only assertion), args
  accumulation, waiting idempotence, the promote guard's turn:step scoping,
  the promote field contract (name/status/output), streamed-key collision
  (keyFor(1,23) vs keyFor(12,3)), turn-end's terminal-tail flip, the
  normal-reason table (stop/tool-calls/completed), 已停止 vs the warn row
  (aborted AND cancelled, tone included), seed-end retiring the optimistic
  prompt, initial-state shape, images default, creation/status/system/title
  rows, snapshot slice identity (React reconciliation), surface-core's
  snapshot() helper, and the settle-then-straggler rename guard.

Equivalent — no behavior any consumer can observe (61 mutants + 21
no-coverage, each hand-verified):

- **log.debug/log.info messages and payloads** (30 mutants across both
  shell-js files): debug traces carry no behavioral contract, and release
  builds no-op debug entirely (rule L4).
- **Dead or unreachable guards** proved dead by hand: splitFlags' `--`
  branch (the executor handles `--` upstream — removing it passes 111/111),
  P.relative's null checks (P.resolve throws before a null can return),
  P.dirname's `cut === 0` and `d === ''` branches (the internal canonical
  form never has a leading slash), `P.sep`/`P.delimiter`-adjacent
  coercion, fold.js's textOf (dead code, the live copy is adapter.js's),
  applySettled's default-throw (assertViewEvent rejects unknown kinds
  first), the `|| 'none'` hint fallback (now pinned via `cat --all`).
- **Redundant-by-construction logic**: the vendor-prefix strip regexes
  (the pinned workspace shape yields exactly one leading slash), the
  per-char flag-walk bounds (the equality clause subsumes them),
  `session`'s module initializers (the lifecycle re-seeds cwd/vars/oldpwd
  before any read), `push(true)` (flag consumers test presence), the
  scopeRoots type guard's second half (the startsWith clause throws the
  same GatewayError for every non-string via coercion),
  `wordHasGlobMagic(null)`/`resolveAgainstCwd(null)` defensive
  normalizations.
- **Stryker artifacts** (3 in publisher-token, 1-2 in shell-js): duplicate
  mutants at one location where the twin is Killed and the copy reports
  Survived, never run. Hand-applying the mutation turns the suite red —
  the pins hold. Lesson recorded: never trust a survivor without applying
  it by hand.

No survivor pointed at a production bug; per the pilot's mandate, nothing
in runtime/, presentation/, or tools/ was edited. (Two cleanup candidates
noted for a future PR, not acted on: fold.js's dead `textOf`, and
splitFlags' dead `--` branch.)

## Alternatives considered

- **Stryker in each family's own package** (test/panel, lynx-client) —
  rejected: it would grow committed lockfiles and couple the gate-owned
  suites to a mutation tool's dependency graph; the pilot is informational
  and must be removable by deleting one directory.
- **In-place mutation (`inPlace: true`)** — rejected: it edits the real
  tree during runs; a crash would leave mutated production bytes in the
  seat. The sandbox + one buildCommand re-linking the vendor symlink costs
  nothing and cannot corrupt anything.
- **Mutating applets-shelljs.js wholesale** — rejected: the mount and glob
  route belong to other suites' contracts; the pilot's mandate names
  shellStringOutcome, and the line-range support (`file.js:123:1-133:2`)
  scopes it exactly.
- **A CI gate on the score** — explicitly out of mandate: the scores are
  informational; thresholds.break stays null and CI never runs Stryker.
  Whether to常态化 (schedule per-family runs or a regression gate) is the
  report's open question, not this note's decision.

## Consequences

- `test/mutation/` is self-contained: `npm install` there, materialize the
  vendor closure (external/ensure.sh + the runtime/dsh/vendor symlink), and
  run the three configs from the seat root. The sandbox needs
  `runtime/dsh/artifacts` and `runtime/dsh/vendor` in ignorePatterns —
  fs.copyFile cannot clone directory symlinks or the iSH guest-root's
  dangling absolute links (surprise ledger).
- The three suites grew strictly stronger: every panel/lynx/tools gate that
  ran before runs now, with 48 more ways to notice a regression.
- Mutation testing is cheap HERE (7-22s per family once materialized);
  the cost driver is suite time per mutant, and these three families are
  pure logic — the families were chosen for exactly that.
