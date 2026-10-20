---
name: worktree-workflow
description: Use whenever code development starts in dsh-mobile — a feature, a fix, a port, a test leg, or a parallel batch. Cuts a linked git worktree as the work seat, materializes the vendor closure before judging any gate, and orchestrates multi-leg development as a dynamic workflow with a concurrency cap. Trigger on any development task, or when the user mentions worktree, workflow, parallel legs, or a convoy — even if they name neither.
---

# Worktree + workflow development

Development in this repo has a default seat and a default engine. The seat
is a linked git worktree: `main` is protected, parallel sessions share the
primary checkout, and subagents must not mutate the seat another session is
standing on. The engine is a dynamic workflow whenever the work decomposes
into independent legs — multi-platform ports, batches of task cards,
research → implement → verify pipelines. Sixty-plus sibling worktrees and
several landed convoys converged on the procedure below; the traps it names
each cost a real session once.

## When to use

- Any development that will land via PR — which is everything (main is protected).
- Another session may be active in the primary checkout, or the task fans out.
- Skip the workflow layer only for a single focused change with no fan-out;
  do not skip the worktree seat unless nothing else can touch the repo for
  the whole life of the task.

## Procedure

### 1. Cut the worktree

```sh
git fetch origin main
git worktree add ../dsh-mobile-<topic> -b <type>/<topic> origin/main
```

- Base on `origin/main`, not the local checkout — the primary seat is
  routinely behind. Suffix short and specific (`dsh-mobile-mic` →
  `feat/cap-microphone`); Angular type prefix on the branch
  (feat/fix/docs/chore/test/perf).
- The worktree path is the workflow's seat: pass it into the script as an
  argument and have every leg operate on absolute paths under it. A session
  started inside the worktree gets it as its working root for free.

### 2. Materialize before judging anything green or red

A fresh worktree has an empty vendor closure and no staged platform
rawfiles; gates, sweeps, and e2e runners run red or produce garbage counts
until materialized. This has twice cost a session: a sweep printed 278/645
as a dead number, and a cold-tree red nearly pushed a `--no-verify`. Before
the first gate or test run in a new or rebased worktree:

```sh
build/ensure-seat.sh --verify   # default seat: this checkout; pass a seat path to materialize a sibling
```

- The inventory of untracked trees lives in `.gov/materialization.json`,
  and the script is its only executor — when a gate gains a new untracked
  dependency, update the manifest, never this file. It rsyncs each tree
  from the primary checkout of the worktree graph: rsync resumes cleanly
  after an interrupted run (never `cp`, whose killed run poisons the
  target) and is fully offline — the primary seat is the only source.
- `--verify` probes the base gates (`bundle-files`, `closures`) after
  staging. The `build/build.sh sync <platform>` verbs an earlier revision
  of this section gave as the entry point are now a script-internal step.
- Rebase → re-materialize → re-judge, every time. A cold-tree red is never
  a code regression; treat one as an environment finding, not a verdict.

### 3. Orchestrate with a dynamic workflow

Load the `dynamic-workflows` skill first — it owns script shape, `world.run`
gating, typed results, and the test bench; this section is only the mapping.

- One subagent per independent leg: research legs read-only, implement legs
  scoped to disjoint paths, one integration leg last.
- Any fan-out past three legs carries `max_concurrency`. A running convoy is
  corrected in place with AmendWorkflow — TaskStop only on purpose.
- Gate loops gate on `world.run` exit codes, never on a leg's self-report
  (rule 6: verify the world, not the self-report). Guard piped commands —
  `sh ... | tail` eats the exit code.
- Worktrees isolate files; they do not isolate shared state. When legs touch
  `.gov/`, `gates.json`, or shared docs, add the `parallel-workers` lease
  protocol on top.
- Wait on conditions, not clocks — no sleep-polling inside a script
  (rule 8); poll the condition with a deadline or watch the event.

### 4. Task cards get one allocator

Card ids come from a per-worktree high-water mark: three worktrees once
allocated `T-0003` independently and the ids became permanently ambiguous
on main. Allocate cards on one seat (main or the lead worktree) before
fanning out and hand ids to the legs — or claim an existing card with
`gov task claim`. Commit `.gov/tasks` closes immediately: an uncommitted
close is invisible to sibling worktrees and the card can be re-claimed.

### 5. Land and clean up

Commit → push branch → `gh pr create` → watch `gates` (event-driven) →
squash merge with an Angular title. Pick the smallest covering gate set
with `pre-push-checks`; recall prior decisions with `recall-first` before
designing, not after. After merge, remove the seat the same day:

```sh
git worktree remove ../dsh-mobile-<topic> && git worktree prune
```

## Boundaries

- The worktree is a seat, not a review exemption — gates run in it, PRs
  land from it, and `.gov`/`.agents` content on the branch is real content.
- `tmp/` is gitignored, so worktree-local scratch is safe; generated
  untracked artifacts (Xcode projects, build output) stay out of commits.
- Detached-HEAD worktrees (release checks) are read-only seats: nothing
  commits or pushes from one without an explicit branch.
- A session running inside a worktree owns that worktree as its AOCI
  runtime root — author cognition entries there and land them via the PR
  like any other managed file.
- Process surprises go to the ledger the session they happen:
  `gov surprise record "<expected>" --reality "<what happened>"` (rule 11).
