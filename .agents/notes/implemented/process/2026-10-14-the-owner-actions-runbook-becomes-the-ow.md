# Agent Note: The owner-actions runbook becomes the owner's whole backlog

Status: implemented
Related: D14

## Problem

The owner-actions runbook (doc/github-owner-actions.md + .zh.md) scoped
itself to GitHub web-UI switches, and its state facts were an API snapshot
from 2026-09-30 — already wrong in four places (ci-verdict is now required,
the release environment exists, the package workflows carry their
`environment:` keys, the Pages workflow has landed red). Meanwhile the rest
of the owner-only backlog lived nowhere durable: the release go has been
openly waiting since 2026-09-30, the marketplace and IdP packages sit at a
documented STANDBY whose unblocking steps exist only inside their deploy
READMEs, and one action (the Google Play 2SV block, the AOCI tool refresh)
survived only in session memory — the exact failure mode where the one
person who can act cannot see the queue. A backlog the owner has to
reassemble from chat logs is a backlog that stalls.

## Decision

The runbook is refreshed into the owner's one-stop backlog and re-verified
against live state (GitHub API read-only, 2026-10-13). Scope expands from
"GitHub web actions" to four sections: GitHub web actions (items 1-8,
including a new cleanup row — delete the retired `RELEASE_PLEASE_TOKEN`
secret, read by nothing since D14), release-side actions (the release go,
item 9; the Google Play registration, item 10), server-side actions (the
two STANDBY packages, items 11-12), and local machine actions (item 13).
Completed rows are marked DONE and kept for their rationale rather than
deleted; every state claim carries its verification date; one row (Google
Play) is provenance-flagged as session memory with an explicit
confirm-or-strike instruction because nothing in the repository corroborates
it. The AOCI row corrects an earlier memory claim: the #117 twin-orphan
blocker is resolved (fix on upstream main, orphans removed in #490), so the
remaining action is only getting off the dev build once rc21+ ships.

## Alternatives considered

- Keep the runbook GitHub-web-only and open separate docs per surface —
  lost: the point of the refresh is one surface the owner can clear in one
  sitting; four docs re-fragment the queue the runbook exists to consolidate,
  and the deploy READMEs already hold the per-package detail (linked, not
  duplicated).
- Drop the unverifiable Google Play row — lost with a caveat: writing
  unverified facts as facts would poison the runbook's verified-facts
  discipline, but dropping the only surviving pointer to a real block wastes
  it; the provenance flag (memory-only, confirm-or-strike) keeps the lead
  without asserting it.
- Mark stale rows done and delete their bodies — lost: item 2's merge-queue
  analysis and item 3's sequencing history are the reasoning a maintainer
  re-litigates without; the DONE marker satisfies the status need at zero
  information cost.
