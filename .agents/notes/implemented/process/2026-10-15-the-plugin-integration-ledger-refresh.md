# Agent Note: the plugin integration ledger refresh — "Staged next" re-judged item by item against post-#507 main

Status: implemented
Related: `doc/dsh-desktop-plugins.md` / `doc/dsh-desktop-plugins.zh.md` (the
ledger this note records); T-0220 (the refresh card); `doc/e2e-matrix.md`
(known gaps the follow-ups cite)

## Problem

The ledger's "Staged next (feasible, highest value first)" paragraph was
written as a forward-looking list and never re-audited: most of the eleven
items it named had since landed (persistence on all three hosts, skills,
commands/goals, the web search plane, workspaceFiles, the plugin-manager
write legs), while one member — the workflows third of
"commands/goals/workflows" — is not merely unlanded but unlandable on the
pinned stream (`workflow-ptc`'s confined realm IS `node:vm`, the
subprocess-class seam). A reader trusting the paragraph would re-plan work
that is already done and stay unaware of a wall. The "Integrated" table had
drifted too: it still said the plugin-manager write legs were "deliberately
unclaimed" (#335 A1 claimed them), and the Excluded section still listed
`session-persistence-jsonl` among impossible native-addon rows although the
vendored verbatim backend is now integrated.

## Decision

The ledger was refreshed against post-#507 main (2b0dcdb4) with a per-item
verdict pass — each of the eleven staged items re-judged against
file-level evidence only (boot mounts, claimed endpoint tables, host serve
seats, probe/assert scenarios, artifact verdicts; no memory or hearsay):

- "Staged next" became three honest sections: **Landed since** (each item
  with its evidence path), **Still staged** (each with what it needs — the
  subprocess/fs-service seam, a fetch provider, presetJoin on iOS/Android,
  compaction host wiring, an MCP integration round, the cordisInspect host
  service), and **Newly understood as excluded** (the workflow family:
  workflow-ptc / tool-workflow / tool-presentation behind the PTC
  host-runner wall).
- The Integrated table gained the rows that shipped whole (skill +
  interactive rows, the web plane, session persistence), the Tool ports row
  gained the in-house tool rows, the spine row gained the subagent control
  plane, and the stale plugin-manager "write legs unclaimed" claim was
  replaced with the claimed #335 A1 surface.
- The Excluded section dropped `session-persistence-jsonl` from the
  native-addon impossibility list (it integrated; the flock shim + zstd
  answered the native row) and keeps the remaining sqlite rows.
- The Chinese counterpart was rewritten content-equivalently in the same
  pass and the pairing record re-confirmed
  (`gov verify pairing --write doc/dsh-desktop-plugins.md`).

Verdict summary: landed — shell/dsh-shell-js, persistence/resume, skills,
commands/goals/fileReferences, web search, workspaceFiles, plugin-manager;
partial — web tools (web_fetch off), approval/questions (service half only,
Harmony-seat reach), session-quality (compaction CLI-proven but unwired,
persona prefix, manual titles only); not-landed — fs over gateway scopes,
tool-fs-search, MCP streamable-HTTP, tool-cordis; excluded — the workflow
family.

## Alternatives considered

- Leave the table as "after T-0035" and only rewrite the staged paragraph:
  rejected — the table is the accounting's headline and two of its claims
  were false in the false direction (understating integration); a ledger
  that says less than is true fails the same honesty test as one that says
  more.
- Fold the workflow family into the existing "physically impossible" bullet
  instead of a new subsection: rejected — the item moved from "staged" to
  "excluded" by this very refresh; burying the move inside a list the
  reader already skimmed would hide exactly the correction this pass
  produced.
- Delete superseded staged items silently: rejected — the Still-staged
  section keeps each surviving item with its unmet prerequisite, so the
  next refresh can re-run the same verdict pass instead of archaeology.
