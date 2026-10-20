# Agent Note: the sweep driver sinks into Node: orchestration eats the verification table

Status: implemented
Date: 2026-10-20
Class: testing
Related: 2026-10-20-verification-registry-and-in-step-flake-retry.md (rung 1 —
the `upstream-sweep` registry entry this driver now reads, and the in-step
flake retry), 2026-10-20-upstream-tests-generation-stamp.md (rung 2 — the
freshness fingerprint the driver refreshes against), rule 5 (fail loud),
rule 10 (a command's discovery surface ships in the same PR), the `code-size`
gate (`gates.json`: source files <=500 lines)

## Problem

`runtime/dsh/ci/run-upstream-suite-sweep.sh` is the last bash orchestrator
on a test ladder whose lower rungs already run in Node: the verification
registry (`test/verifications.mjs`) and the in-step flake retry
(`tools/test/flake-retry.mjs`) on rung 1, the generation fingerprint
(`test/upstream-suite/generation.mjs`) on rung 2. The sweep is rung 3, and
it still pays bash's portability tax at every step:

- macOS has no `timeout(1)`, so the 90 s per-leg cap is a
  `perl -e 'alarm shift; exec @ARGV'` helper (`run-upstream-suite-sweep.sh:42-43`);
- parallelism is `find | sort | xargs -P "$PARAL" -I{} bash -c 'worker "$@"'`,
  with `export -f worker run_to` to smuggle the functions into the children
  (`:83-84`, `:103-104`);
- the per-leg counts are scraped out of the summary line with
  `sed -n 's/.*"failed":\([0-9]*\).*/\1/p'` (`:75-76`).

None of that has a Windows face — the ladder's end state is ONE Node test
driver with no bash on the Windows side — and the bash shape carries two
measurable defects:

1. **Column-blind totals.** `qjs_pass=$(tail -n +2 "$REPORT" | grep -c
   '"failed":0' || true)` (`:111`) counts every TSV ROW that contains
   `"failed":0` anywhere. A row whose qjs column says `"failed":3` and whose
   node column says `"failed":0` is counted as qjs green; so is a row whose
   qjs column is `TIMEOUT-OR-ERROR` while node is clean. The totals file
   labels that number "qjs specs with a green summary" (`:116`), which it
   is not.
2. **The exit code masks the summary — in BOTH columns.** Each leg is
   `cmd > log 2>&1 && grep -o '…' log` (`:54-57` qjs, `:70-72` node). The
   `&&` means a leg whose process exits nonzero never reaches the grep, and
   the cell degrades to `TIMEOUT-OR-ERROR` (`:68`, `:73`) even when the
   summary line IS in the log. For the node column this is the normal case,
   not the edge: `test/upstream-suite/smoke.mjs` prints its
   `harness smoke: {…}` summary (`smoke.mjs:44`) and then exits 1 whenever
   `report.failed > 0` (`smoke.mjs:50`) — so exactly the specs the
   differential leg exists to compare lose their node summary, and `agree`
   collapses to `—` (`:77-79`) instead of the `NO` the report is for. The
   qjs leg has the same shape: `upstream-suite-leg.js:468` emits
   `suite/summary`, then `:475` completes with `report.failed === 0`, and
   the CLI exits 1 unless the run passed (`example/main_cli.c:1825`) — so
   under bash EVERY failing spec's qjs cell read `TIMEOUT-OR-ERROR`, and
   because the retry keyed on an empty `qjs_summary` (`:62`), every failing
   spec was also re-run for up to 90 s more. The retry meant for cap
   timeouts and harness errors was spent mostly on honest failures.

Two more silent degradations ride the same shape: the stale-tree refresh
(`sh ensure-dsh-tests.sh` then `(npm install … && node transpile.mjs)`,
`:98-100`) is never exit-checked under `set -u` alone, so a failed
re-transpile sweeps a stale or absent tree as if fresh; and an empty specs
directory yields a header-only report (`:103-109`) rather than an error.

## Decision

- **`tools/test/sweep.mjs`** — the Node sweep driver. It reads the
  `upstream-sweep` entry's new `drive` field in `test/verifications.mjs`:
  `specsDir`; per leg its `cwd`, `argv`, summary regex and `retries`; and
  the freshness refresh step. The table DESCRIBES the legs; the driver
  EXECUTES them — one source, one place to change. The qjs leg keeps exactly
  one retry in the same worker slot (same parallelism) with the first
  attempt's log untouched, as the bash sweep did. The TSV
  (`spec\tqjs\tnode\tagree`) and the totals file keep their shape, so
  `weekly-sweep.yml`'s summary step parses them unchanged.
- **Declared behavior deltas** from the bash sweep — the driver's header
  (`tools/test/sweep.mjs:16-35`) carries the same numbered list, and the
  tests pin each one (delta 1 `sweep.test.mjs:81,223`; 2 `:177-185` and the
  end-to-end run at `:319`; 3 `:355,365,375`; 4 `:442`; 6
  `sweep-cli.test.mjs:71`):
  1. The summary is read from the leg's log regardless of the leg's exit
     code (no `&&` masking), and the exit outcome is appended to the log as
     a final `sweep: exit=<code> timedOut=<bool>` line. Consequences in both
     columns: the node column recovers every summary `smoke.mjs` exit 1 used
     to hide, and the qjs column records `{"failed":N}` for failing specs
     instead of `TIMEOUT-OR-ERROR`. **Retry policy changes with it**: the
     qjs retry still fires on an empty summary, but an empty summary now
     means only a genuine cap timeout or harness error — a spec that failed
     honestly is recorded once and not re-run (bash re-ran it). Fewer
     retries, same cap, and `NOSUM` finally means what `weekly-sweep.yml`'s
     summary step says it means.
  2. qjs green is counted from the qjs COLUMN, never from a whole-row grep
     (`'"failed":0'` inside the qjs cell, `sweep.mjs:158-162`). The fixture
     proves the divergence: three rows — qjs green, qjs `TIMEOUT-OR-ERROR`
     with node green, qjs `"failed":2` with node green — yield `qjsGreen: 1`
     where bash's whole-row grep said 3 (`sweep.test.mjs:177-185`; the
     end-to-end run over the same shape lands the same 1 at `:319`).
  3. Fail loud (rule 5) where bash degraded silently: a leg's required
     binary missing (exit 1, naming `sh src/build.sh` — `sweep.mjs:335-337`);
     a missing or spec-less specs dir (exit 1, naming the dir, and the
     `--filter` when it kept none — `sweep.mjs:277-285`); a malformed
     registry leg — no `argv` recipe, a column the report has no cell for, a
     non-integer `retries` — (exit 1, naming the leg — `sweep.mjs:321-333`).
     Bash wrote an empty or all-`TIMEOUT-OR-ERROR` report and exited 0 on
     every one of those. Unknown flags exit 2 as bash already did (not a
     delta); malformed values — `--paral x`, a flag missing its value — exit
     2 too (`sweep.mjs:81,87-89`), where bash took any `--paral` value and
     only `xargs -P` rejected it, mid-run. Everything else still writes the
     report and exits 0: the sweep is an inspection, not a gate.
  4. A failed freshness refresh step aborts the run with the failing
     command named (`sweep.mjs:305-313`); bash ran the refresh un-checked and
     swept the stale or absent tree as if fresh. The refresh steps run with
     `stdio: 'inherit'` (`sweep.mjs:289-290`), so their output is not
     silenced (bash sent `npm install`'s to `/dev/null`); the registry's step
     shape is a bare `{cwd, argv}` (`verifications.mjs:133-137`) and cannot
     express per-step silencing.
  5. Report rows are sorted by stem in JS code-unit order; bash's `sort` was
     locale-dependent (identical under C/UTF-8 collation, possibly reordered
     under glibc locales). Consumers key rows by stem, never by position.
  6. Each leg's stdout+stderr go to ONE opened log fd (bash's `> log 2>&1`
     shape) and the driver waits on the child's EXIT, never on `close` — a
     detached grandchild that inherited the fd (dsh-cli supports inherit +
     detached children) cannot hold a worker lane open past the 90 s kill.
     Bash had the same exposure profile (file redirect, subshell exit); the
     obvious Node shape — captured pipes + `close` — did not, and was
     rejected in review for exactly that hang.
- **Implementation note on timeout receipts (not a bash delta).** On
  Node >=16 a plain spawn `timeout` emits no ETIMEDOUT error event —
  re-probed on this machine's v24.14.0: the only event is
  `exit: code=null, signal=SIGKILL` — so `timedOut` is read from that exit
  receipt (`sweep.mjs:228-230`; the ETIMEDOUT handler at `:217-221` stays as
  belt-and-braces). The driver is the only SIGKILL source a sweep leg has;
  an external `kill -9` would also read `timedOut=true`.
- **Flags**: `--paral N` as before; new `--filter S` (narrow the sweep to
  specs whose filename contains S), `--dry-run` (print the plan the table
  produced as JSON on stdout — specs discovered, legs, out paths, freshness
  verdict, any missing required binary and any discovery error — and run
  nothing; it never needs the dsh-cli binary or a staged tree), `--out DIR`
  (relocate the report/log root from `tmp/`).
- **`runtime/dsh/ci/run-upstream-suite-sweep.sh` becomes an exec shim** into
  the driver: `weekly-sweep.yml`'s `run: runtime/dsh/ci/run-upstream-suite-sweep.sh
  --paral 4` and every older citation keep working with no deprecation
  window to manage.
- **Discovery surface in the same PR (rule 10)**: the ops-dispatch row
  ("Upstream suite sweep (both legs)") names
  `node tools/test/sweep.mjs [--paral N] [--filter S] [--dry-run] [--out DIR]`,
  the shim, the `drive` field, qjs as the only counting leg and the node
  differential as divergent; the registry's own `countsFrom` and per-leg
  `runner` prose (`test/verifications.mjs --why upstream-sweep`) name the
  driver first and the shim as what execs into it; `weekly-sweep.yml`'s
  header and step comments say the script execs into the driver;
  `generation.mjs`'s header and `run-shim-exposure-sweep.sh`'s attribution
  point at the driver.
- **`tools/test/sweep.test.mjs` + `tools/test/sweep-cli.test.mjs`** —
  hermetic tests of the driver: fake legs stand in for the QuickJS CLI and
  the vendored dsh-tests tree, so the parsing, counting, retry and fail-loud
  paths — and the CLI face: usage exit 2, `--dry-run` writing nothing, the
  symlinked-checkout entry guard (`sweep.mjs:478-488`, a review finding) —
  are judged without a materialized seat.

## Alternatives considered

- **Keep patching the bash sweep** — rejected: every fix re-pays the
  portability tax (perl alarm, `xargs -P`, `sed`), bash still has no Windows
  face, and a bash sweep cannot read the registry — the legs would stay
  described twice (registry prose + bash argv), the exact double source the
  registry was built to retire.
- **Grow the driver inside `test/verifications.mjs`** — the registry's own
  header promised the driver "grows here, in this file"
  (`test/verifications.mjs:9-10`) — rejected: the `code-size` gate caps a
  source file at 500 lines (`gates.json:120-121`), and the registry's value
  is being a MANIFEST of confirmed facts; an executor in the same file
  couples a query CLI to a process orchestrator. The `drive` field keeps the
  facts in the table; execution lives in `tools/test/sweep.mjs`.
- **Make govrail the runner** (wire the sweep as a `gov run` gate) —
  rejected: the sweep is an INSPECTION, not a gate — `weekly-sweep.yml`'s
  sweep step is continue-on-error by design; a red finding is the inspection
  working. A govrail gate is a pass/fail verdict; the sweep's product is a
  report. Its one-retry policy is the driver's, not the gate runner's, so
  nothing of it moves into govrail.
- **Point `weekly-sweep.yml` at `node tools/test/sweep.mjs` directly and
  delete the `.sh`** — rejected: the exec shim is zero-risk — the workflow's
  `run:` line, the dispatch table's older citations and every note that
  names the `.sh` keep working, and no deprecation alias has to be carried
  through a window. The header comments say where the shim goes; that is
  enough.

## Consequences

- **Acceptance outcome: the original bash sweep and the Node driver ran
  over ONE transpiled tree on this seat (2026-10-20, `--paral 4`, 648 specs
  each; bash 8m15s, Node 9m43s), rows joined by stem.** (648, not main's
  681: the linked worktree had no `third-party/deepseek-harness` submodule
  checkout, so the transpiler excluded the 33 specs it resolves through that
  corpus — the same tree for both drivers, so the comparison holds; the
  seat-materialization and fingerprint blind spot is recorded as a surprise,
  not fixed here.) 517 rows are
  identical and 0 rows diverge on counts; every other row falls inside a
  declared delta. Delta 1 recovered 49 qjs cells and 118 node cells that
  bash's `&&` had blanked to `TIMEOUT-OR-ERROR` — each now reads
  `{"failed":N>0}`. One row is load noise, not a delta:
  `context__session-reference__tests__session-reference`'s qjs leg hit the
  90 s cap on both attempts under the Node run and was recorded
  `TIMEOUT-OR-ERROR` where bash had a summary. qjs green: bash's totals line
  said 586 (whole-row grep); a recount of bash's OWN qjs column says 573 —
  13 rows bash counted green on the node cell alone (delta 2); the Node
  driver reports 572 (573 minus the noise row). qjs NOSUM 75 → 27 and qjs
  retry logs 75 → 27 — the retry now fires only on a genuine no-summary
  (delta 1's retry-policy consequence, measured); node NOSUM 161 → 43.
  `agree` moved from {yes 474, — 174} to {yes 502, NO 86, — 60}: the 86
  `NO` rows (hooks 9, llm 9, web 8, session 6, shell 6, api 5, preset 5,
  util 5, and 19 smaller families) are the qjs-vs-node differential the
  sweep exists to surface, invisible under bash. The comparator was a
  one-off script under the seat's gitignored `tmp/`; the delta-2 fixture
  (`sweep.test.mjs:177-185`, `:319`) and the delta-1 test (`:223`) pin the
  same two effects at unit scale.
- **Windows is not reached by this PR.** The driver removes bash's
  orchestration tax (perl alarm, `xargs -P`, `sed`), but the refresh steps
  still spawn `sh` and `npm` with no shell (`npm` is `npm.cmd` on Windows,
  `sh` is absent — both surface as a loud "freshness step failed", not a
  silent skip). The summary extractor drops a trailing `\r` per line, so
  CRLF leg output cannot smuggle a `\r` into a TSV cell — one trap fewer,
  not a Windows face. The Windows face of the ladder is a later rung;
  nothing here claims it.
- **Driver and manifest change in one place from now on.** Adding a leg,
  changing a summary regex or the retry policy is an edit to the
  `upstream-sweep` entry's `drive` field; the driver carries no
  spec-specific knowledge. `--dry-run` prints the plan that edit produced,
  so a table change is reviewable without the ~8-minute run
  (`weekly-sweep.yml`'s measured baseline for 645 specs at `--paral 4`).
- **The shim is a compatibility seam, not a deprecation.** Removing it later
  is its own PR with its own discovery-surface sweep (rule 10 holds
  deprecated aliases to the same bar).
- **Superseded wording.** `test/verifications.mjs:9-10` ("the unified test
  driver … grows here, in this file") and the rung-1 note's Consequence that
  the driver "executes over the same table" resolve into this shape: the
  table carries `drive`, the driver is a separate file that reads it.
