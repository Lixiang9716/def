# Agent Note: the self-test flake (govrail#443): the four live-tree rejection cases seal their own windows

Status: implemented
Related: D5

## Problem

`gov self-test` intermittently failed the same four project rejection cases
(`case-bundle-files`, `case-bundle-files-dotfile`, `case-staging-check`,
`case-staging-generated-webclient-leak`) on a materialized pristine tree —
"the restored tree still fails" / "gate went red but not about the leaked
file" — and the same tree ran green minutes later (govrail#443). It twice
interrupted real work, once as a required CI check on PR #502, where the
reported "residual output:" read as empty. Every failure path of the four
cases printed no gate output, so each incident cost a debugging session
that started from zero evidence.

The mechanism, established on this landing: the cases' gate tools share
read-surface with each other's mutation windows, but only three of the four
mutating cases held the live-tree case lock — `case-staging-generated-
webclient-leak` ran unlocked while its tool (`gen-staging-emit --check`)
reads `Index.ets`'s BUNDLE_FILES block and the harmony rawfile mirrors, so
any overlap with a locked window went red about someone else's drift
(replayed: "DRIFT Index.ets lacks generated row: upstream/boot.js" inside a
staging-check window). Separately, the executor's 10s budget SIGKILLs a
case's bash without letting EXIT traps run, and the old scripts armed their
traps only after the fixture checks — replayed end to end: one mid-window
SIGKILL leaked both the mutated `Index.ets` and its pristine `.case-tmp`
backup PERMANENTLY (the mutation survived reruns as a tracked-file edit no
case ever restored), turning a transient flake into lasting tree damage.
The empty "residual output:" is a govrail executor defect (the FAIL line
quotes only a case's first output line) — filed back on #443, not fixable
here.

## Decision

The four cases now seal their own windows. Each: arms the EXIT trap before
any early exit; recovers its OWN artifact class before judging the fixture
(a leaked `.case-tmp`/leak/dotfile from a killed prior instance is restored
or removed first, with a stderr note); takes its pristine backup INSIDE the
lock (a pre-acquire `cp` could snapshot a concurrent window's mutated bytes
and later "restore" them — cementing the leak); runs a preflight that
asserts the tree green BEFORE the mutation, with one bounded settle-retry
so a same-batch sibling's recovery can land, failing loud with the full
gate output if the red persists; and carries the gate's residual output
inline on the FIRST line of every failure message (govrail quotes only
that line) plus the full output on the lines below.
`case-staging-generated-webclient-leak` joins the shared live-tree lock
(5s deadline — its window is sub-second), making the live-tree windows
mutually exclusive by construction. The sealed plane was re-baselined via
`verify-plane --write` with the review reason recorded. Executor-layer
defects (first-line-only FAIL quoting; SIGKILL without process-group
cleanup) are reported upstream on govrail#443 — the package is pinned and
not patched here.

## Alternatives considered

- Retry-on-failure wrappers around the cases (rerun a red case once, pass
  on green): rejected — it weakens the rejection proof and teaches flakes
  to hide; a red that means nothing is the #443 disease itself.
- Moving the four cases to isolated tree copies (seed a temp rawfile): the
  honest shape long-term, but the tools resolve the repo root and the
  stores/rawfile span thousands of files — the copy cost blows the 10s
  case budget; noted as the govrail-side fix shape (raise the budget,
  isolate the tree) rather than a project-side patch.
- Widening the live-tree lock to cover the whole self-test run (one lock
  around all project cases): serializes twelve independent cases behind
  four tree-mutating ones and would push the batch past its budgets for
  no correctness gain — the windows only need mutual exclusion, which per
 -case acquisition already gives.
