# Agent Note: the governance plane upgrades to govrail 0.52.0

Status: implemented

## Problem

The plane ran govrail 0.48.0 (init 2026-09-22) while the tool moved to
0.52.0, so every adopter-side surface drifted: the shipped rules gained a
concurrency clause for live-tree rejection cases (rule 6) and a card
exemption for report-only observation runs (rule 9, #444); the injected
pre-push hook carried a **local** GOV_CHANGE_ROOT patch for a class govrail
fixed upstream in 0.49 (#371 — new-branch pushes dying on self-test scratch
repos); and the surprise ledger's read side (keyword lookup, #382), the
scoped run (#388), and two hook-honesty fix batches (#424, #447) all
postdate the checkout. Unupgraded, the plane keeps re-applying a local hook
patch after every `gov init --hooks`, and `gov surprise list` — the
"have I seen this before?" lookup — is the version that still crashes on
this repo's ledger (govrail #448, fix pending upstream).

## Decision

The plane upgrades to govrail 0.52.0 with per-file dispositions from the
`gov init --upgrade` drift report:

- `rules.md` = the 0.52 template (rules 6 and 9 amendments) **plus the
  local rule 12** — 12 rules total; the local status-document rule
  coexists with the template's 11.
- `.gov/rejections/README.md` re-adopted (UPSTREAM MOVED, local untouched
  since adoption — the safe adopt case).
- `.agents/skills/govrail/SKILL.md` taken from the 0.52 template
  wholesale; the local copy's only delta was a line reflow.
- `pairing.json`, `pre-push-checks/SKILL.md`, `code-review/SKILL.md` kept
  local: their deltas are the `doc/` (not `docs/`) include-scope
  adaptations that match this repo's layout.
- `.gov/hooks/pre-push` re-wired from the 0.52 template by
  `gov update --apply` — **the 0.48-era local GOV_CHANGE_ROOT patch
  retires**; upstream #371 declares the new-branch fork-point root, which
  is what the patch existed for. The template's #402 cold-tree judging
  (the pushed sha materialized into a temporary detached worktree) then
  needed **one new local adaptation**: this repo's gates depend on
  untracked materialization (`external/` vendor trees, the harmony
  rawfile closure staging) that CI builds in workflow steps before
  `gov run`, so the cold judged tree was structurally red (every staging
  row read "missing"; self-test's baseline probes named it
  environment-suspect). The hook now mirrors that materialization from
  the pushing tree into the judged tree (APFS clone, no network) before
  judging — `external/`, the harmony rawfile closure staging, and the
  `runtime/dsh/vendor -> ../../external` symlink (an untracked link the
  import-graph walk resolves through). A second lesson from the same
  chase: the DAG's concurrency wave raced self-test's live-tree case
  mutations against sibling gates — three red pushes on a tree that is
  green gate-by-gate — fixed by the new rule 6 itself: the self-test
  gate is now `"exclusive": true` in gates.json. As with the retired
  #371 patch, re-apply both after any `gov update --apply` re-wires the
  hook; the general fixes (a repo-declared materialization seam, and
  per-gate exclusivity discovery) are filed upstream.
- `gates.json` untouched: the 0.52 template made no shipped-gate change,
  and the repo's ~20 product gates stay as sealed. The new rule 6
  exclusive clause is satisfied by the existing per-worktree lock
  serialization of the live-tree rejection cases (T-0078) — the rule's
  own "or serialize it another way" branch.
- `.github/workflows/gov.yml` keeps its local shape (vendor cache +
  materialization legs, pinned actionlint/shellcheck, node-fresh action
  versions — all richer than the generic template); only the govrail pin
  moves to 0.52.0.
- `docs/decisions.md`, `docs/postmortem/README.md`, `.claude/settings.json`
  stay unadopted: this repo keeps `doc/decisions.md`, has no postmortem
  dir, and runs no agent platform config (deliberate since the 0.48 era).

## Alternatives considered

- **Staying on 0.48.0** — lost the upstream hook fixes that make the local
  patch unnecessary, the surprise keyword lookup, and the report honesty
  batches; the drift report would keep growing.
- **`gov uninstall` + fresh `gov init`** — re-injects everything cleanly
  but clobbers the local customizations (pairing scope, CI workflow, rule
  12) that the drift report shows are deliberate; the two-step
  hand-merge keeps exactly the customizations and no more.
- **Adding `"exclusive": true` to the live-tree rejection-case gates in
  the same change** — rejected for this PR: the cases already serialize on
  per-worktree locks (T-0078), and flipping concurrency semantics is a
  measured change that deserves its own evidence run, not a rider on an
  upgrade.
