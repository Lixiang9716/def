# Agent Note: shell-diff: the bash differential harness for dsh-shell-js (test-hardening row 6)

Status: implemented
Related: D5

## Problem

dsh-shell-js claims a bash-subset dialect (pipelines, redirects, variables,
globs, quotes; everything else refused by name), but its proof to date was
the nine-line e2e scenario — a hand-picked happy path. Nothing held the
executor to bash's observable behavior command line by command line, so
semantic drift from real bash (the mental model the tool description
promises) could land silently. Test-hardening row 6
(doc/test-coverage.md) asks for exactly this: a differential harness that
feeds the same POSIX-subset scripts to dsh-shell-js (the CLI seat) and
real bash, diffs the normalized exit/stdout/stderr, and treats unexpected
differences as bugs.

## Decision

`test/shell-diff/` ships the harness: `cases.json` (the case matrix —
data only, 47 cases across pipes / redirects / variables / globs / quotes
/ heredoc-simple / sequencing), `driver.mjs` (the dsh side — an in-runtime
scenario that boots the mobile profile and drives every script through the
REAL ToolRuntime `shell` dispatch; the matrix rides the `--bus-inject`
staged-data seam), `run-bash.mjs` (the bash side — real `bash`, LC_ALL=C,
in a sandbox tree that mirrors the dsh workspace layout so path-bearing
output normalizes identically), `compare.mjs` (normalization + assertions
→ `report.json` + `divergences.md`), and `run.sh` (the one-command
orchestrator). The c-core workflow runs it as a Linux leg after the test
legs; its workflow `paths` now also cover the harness and the
dsh-shell-js plugin. Expectations are three-valued: `match` (bytes equal
after normalization; `stderrFree` compares exit+stdout and requires
silence/loudness to agree), `refusal` (the documented dsh refusal shape;
bash recorded as context), and `divergence` (a known difference pinned to
the dsh side's current behavior — passes only while the seats differ in
exactly that pinned shape, so a silent fix or drift trips the case and
forces re-triage). The first classification round pinned 21 divergences
(headline: a word-expansion refusal in a pipeline's first member deadlocks
the line — the pipe writer is never closed; quoted words glob where bash
never globs them; assignment values don't expand; no IFS word splitting;
wc's missing-file failure is a line-stopping construct refusal where cat's
is a plain failure). All live in `divergences.md` with both sides'
evidence; fixing them is the executor owners' follow-up, not this
harness's (its file scope is test/shell-diff/ + the workflow leg).

## Alternatives considered

- Parsing the executor's source for conformance (AST snapshots): proves
  the code matches itself, not bash. The whole point of row 6 is the
  external reference; lost.
- A node-side harness importing the plugin directly with a mocked gateway:
  faster and would unlock the glob family (the CLI dev backend has no
  fsList), but it is not the CLI seat the row names, and a mock would test
  the mock. The capability gap is pinned honestly instead, and the glob
  cases TRIP if the seat ever serves fsList — the promotion path is the
  tripwire. Lost for now, noted as the follow-up seat.
- Failing the leg on every divergence (strict equivalence): would leave CI
  permanently red on 21 known findings and turn the harness into noise.
  The pinned-divergence model keeps the leg green while making every
  finding visible and every silent change loud. Lost.
