# Agent Note: the standing loop's first catch — the contract's stat semantics meet the shell's read faces

Status: implemented
Related: T-0217 (the standing loop's first observed hits); supersedes nothing —
extends the refusal vocabulary the 2026-10-11 seat-switch and parser notes
established.

## Problem

T-0217's standing loop drove an agent-realistic command battery through the
REAL ToolRuntime on the CLI carrier and caught four wild shapes the two
machine nets had both missed:

- `grep`/`sort`/`tail`/`cat`/`sed`/`uniq` on any file that existed on disk
  but outside the current session died with the executor's internal
  "(wrapper bug)" wording at exit 1;
- `head -n 1 <missing>` answered **exit 0 with empty stdout** — a wrong
  result that looks like success, the worst shape the refusal vocabulary
  knows;
- `echo {a,b}` — a pure echo — hard-failed on the CLI seat with "declared
  unavailable by the smoke backend", because the executor routed the brace
  word into the fsList walk;
- `wc`'s refusal leaked the internal gateway path ("cannot read
  dsh/missing.txt") to a caller who never wrote the prefix.

Both nets were blind for structural reasons. The panel double's gateway
shim threw `io` for a missing stat, while the real gateway contract
answers `kind:"other"` (main_cli.c's fsStat records the semantics; the
device hosts match) — so the snapshot's `undefined/null`-only absence
check never fired in tests. And the e2e leg's 35 pinned records only ever
read bytes the redirect phase had written in-session, so the
pre-existing-file path had zero coverage.

## Decision

- The snapshot's read face, fd face, and stat face now treat `kind:"other"`
  as absent: `readFileSync`/openSync-reading answer ENOENT (EISDIR stays
  for dirs), and `existsSync`/`statSync` answer false/throw — which is
  what lets the pristine shelljs guards work again: grep reports its own
  exit-2 convention into the `2>` capture, cat/head/tail/sort name the
  file at exit 1, and the wrapper-bug throw returns to being the true
  internal invariant (a `kind:"file"` entry whose bytes were never
  prefetched).
- Brace alternatives expand PURELY before pathname expansion (bash's
  order): `echo {a,b}` is the words `a b` on every host — no fsList walk
  behind a pure echo, and no accidental pathname matching of real files
  named `a`/`b` on listing hosts (the old behavior matched children, not
  bash semantics). `*?[` patterns walk exactly as before.
- The panel double answers the contract's `kind:"other"` for a missing
  stat, so the suite now exercises the real arm instead of a divergent
  double.
- `wc`'s refusal carries the caller's spelling, never the gateway path.
- Five pins joined `test/panel/shell-js.test.js` (the fd-duplication and
  backtick refusals, the pure brace expansion, the by-name missing-path
  readers, head's loud failure) — the T-0217 loop's same-week deliverable.
- Runner hygiene: both CLI e2e runners write their logs to /tmp scratch
  instead of the tree's cwd, and the three stale `logs-*.txt` that had
  ridden PRs #457/#463 into the canonical runtime tree are removed.

## Alternatives considered

- **Fixing the C host's fsStat to error `io` for missing paths** —
  rejected: main_cli.c's comment records `other`-for-missing as the
  gateway's own answer on the device hosts; changing the host to suit the
  shell inverts the contract direction.
- **Catching the wrapper-bug throw in runShelljs and rewording it** —
  rejected: it would keep the bodies throwing past shelljs's own error
  conventions instead of handing them the ENOENT they are written to
  catch.
- **Teaching walkCandidates to swallow `unavailable`** — wrong layer for
  braces (their expansion is pure text; no fs belongs in the path), and
  deliberately not done for `*?[`: on a host whose lister is unavailable,
  a pathname glob refusing by name is the honest wall, not a silent
  pass-through.
- **Extending main_cli.c with fsList/fsRename** so `ls`/`mv` work on the
  CLI seat — deferred, not forgotten: the smoke backend is the office
  tools' regression twin, and widening it is a capability change with its
  own receipt, not a refusal-shape fix. The `ls`/`mv` unavailable answer
  itself is contract-honest (a host without a primitive answers
  unavailable, never fakes).
