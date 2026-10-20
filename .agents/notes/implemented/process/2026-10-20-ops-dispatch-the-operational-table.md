# Agent Note: ops-dispatch — the operational dispatch table (2026-10-20)

Status: implemented
Related: #618 (ensure-seat — the materialization inventory this table points
at), #619 (the verification registry + in-step flake retry), #610 (the lsp
archaeology that motivated a queryable registry), the `worktree-workflow`,
`recall-first`, `pre-push-checks`, and `govrail` skills this table defers to

## Problem

The repo's operational knowledge — which CLI answers which intent, in what
order, with which prerequisites — lived in session memory and re-derived
itself the hard way every new session. Three sessions in a row burned real
time on cold-seat materialization alone (sync core is not enough; sync's
sub-step failures print "done"; cp leaves poisoned half-copies), one round
went to archaeologizing which leg produces the lsp suite's counts, one to a
wrong flat-file name, two to known-flake reruns ci-verdict did not follow.
Every fact existed somewhere (a skill, a doc, a ledger); nothing answered
"what do I use for X" in one place.

## Decision

`.agents/skills/ops-dispatch/SKILL.md` — a dispatch table, not a tutorial:
the six-step spine every task walks (recall → seat → work → verify → land →
close), an intent→tool table covering the operational CLIs and skills
(ensure-seat, verifications --why/--resolve, gov run --base, fras-lint, the
AOCI closing chain, transpile, the sweep, host legs, the matrix register,
sync mirrors, git-safe, the flake registry), a deferral list to the skills
that own their domains, and a Never list where every entry cites the
incident that earned it. New operational CLIs enter the table by adding one
row; the table defers to skills rather than restating them (one fact one
home).

## Alternatives considered

- **Only update the worktree-workflow skill**: rejected — the materialization
  fix is one row among ten intents; a dispatcher owned the whole surface, and
  the next unknown intent (a new runner, a new leg) had no single place to
  land.
- **Put the routing into AGENTS.md**: rejected — AGENTS.md is read in full by
  every session and every model; a routing table there is context cost on
  tasks that never touch operations, while a skill loads on trigger.
- **Memory files only**: rejected — memory is per-project for this one user,
  not shared with collaborators or CI, and recall is probabilistic; the table
  must trigger deterministically.

## Consequences

The table's rows can rot when a CLI moves — mitigated by the deferral rule
(skills own their domains; rows point, they do not restate) and by the rule
that a new operational CLI lands with its row in the same PR.
