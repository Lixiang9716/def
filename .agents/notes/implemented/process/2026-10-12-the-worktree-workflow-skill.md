# Agent Note: the worktree-workflow skill makes the worktree the default dev seat and the dynamic workflow the default engine

Status: implemented
Related: governance rule 2; `parallel-workers` skill

## Problem

Development procedure in this repo was tribal. Sixty-plus sibling
worktrees exist, but a fresh session re-derived the procedure each time
and re-hit the same known traps: gates judged on a cold worktree produced
a 278/645 waste sweep and nearly pushed a `--no-verify`; three worktrees
independently allocated task id `T-0003`, making the id permanently
ambiguous on main; uncapped convoys had to be arbitrated mid-flight.
`parallel-workers` governs leases between already-running workers;
nothing told an agent where development happens (the seat), when to fan
out (the engine), or how the two compose with cards, gates, and landing.

## Decision

`.agents/skills/worktree-workflow/SKILL.md` fixes the vocabulary and the
procedure: a linked worktree cut from `origin/main` is the default
development seat; materialization (`build/build.sh sync <platform>`)
precedes every gate judgment in a fresh or rebased tree; multi-leg work
runs as a dynamic workflow with a concurrency cap, gating on real exit
codes; task cards get exactly one allocator seat; landing stays the
standard branch → PR → gates flow, and merged seats are pruned the same
day. Skill text is model-facing English; `.agents/**` is outside
`.gov/pairing.json`'s include list, so no zh counterpart is required.

## Alternatives considered

- Extend `parallel-workers`: rejected — it coordinates workers that
  already exist over shared surfaces; it does not decide where a task's
  seat is or whether the work fans out at all. The two compose (the new
  skill points at it for shared-state legs).
- An ARCHITECTURE.md section: rejected — architecture docs describe the
  system for humans; agent procedure lives on the discovery surface
  agents actually enumerate, which is skills.
- Enforce the seat with a gate: rejected — "is another session standing
  on the primary checkout" is not machine-checkable at gate time, and
  rule 1 cuts both ways: what a command cannot check belongs in review,
  and a skill is the reviewable, triggerable form of that review.
