# Agent Note: the upstream-tests generation stamp (2026-10-20)

Status: implemented
Related: #614 (the transpiler fix whose staged artifact went stale on main),
#619 (the verifications registry this check lives in), #622 (the freshness
rule's first wording in the dispatch table — this note's invariant replaces
that prose)

## Problem

The staged upstream specs (`runtime/dsh/upstream-tests/*.spec.mjs`) are
LOCAL-ONLY artifacts: `git pull` does not update them, and the sweep's only
guard was "re-transpile when the directory is empty". So #614's transpiler
fix shipped while every checkout with an existing staged tree kept running
the OLD artifact — the lsp lifecycle spec read 29/2 on main for a day after
the fix landed (31/0 in the fix's worktree), and a fresh-context probe
 dutifully reported the stale state as current truth.

## Decision

`test/upstream-suite/generation.mjs` computes a generation fingerprint:
sha256 over the three transpilers' bytes, the suite's lockfile (esbuild's
pin), and every `.vendor-pin` stamp under `external/` (393 stamps, each
carrying its tarball's sha256 — by the D6 pin discipline the stamp IS the
tree's content identity, so hashing the pins hashes the trees without
reading 250 MB). `transpile.mjs` writes the fingerprint to
`runtime/dsh/upstream-tests/.generation` ONLY after a full successful pass.
`run-upstream-suite-sweep.sh` now compares the stamp against a freshly
computed fingerprint instead of checking for an empty directory — missing
stamp or mismatch re-transpiles (which also materializes the tests tree).
`verifications.mjs --check-fresh` exposes the same comparison to single-spec
callers and to humans. `.gov/materialization.json` gains the version-suffixed
dsh-tests tree so a fresh seat's fingerprint is complete offline.

## Alternatives considered

- **Commit the staged artifacts** so pull updates them: rejected — 681
  generated files of build output in git, churn on every transpiler tweak,
  and the closures-style drift class it would create.
- **Hash the full vendored trees' content** (250 MB): rejected — the pin
  stamps already assert that identity; hashing content duplicates the pin
  system's job at 1000× the cost.
- **mtimes**: rejected — rsync-preserved mtimes are stable but a clean
  checkout re-stamps them; the fingerprint must be content-derived only.
- **Do nothing; document "re-run transpile after pulling"**: rejected — that
  was exactly the tribal knowledge this table exists to retire, and the
  probe proved a fresh context does not read it in time.

## Consequences

Conservative by design: a comment-only transpiler edit bumps the fingerprint
and costs one ~1-minute re-transpile. CI is unaffected (it materializes
fresh every run). The stamp lives beside the artifacts and dies with them
(git clean) — the next sweep then re-transpiles once, which is the correct
self-healing direction.
