# Agent Note: The README becomes a human-first front door; the evidence table is demoted but kept

Status: implemented

## Problem

The README read as an internal milestone ledger, not a front door. A first-time reader
got no "what is this / why does it exist" beyond one architecture-jargon paragraph
(Fabric interoperability model, three-layer stack, Web Client plugin — all HOW, no
WHAT); the very next screen was the milestone table whose Status cells are internal
acceptance receipts (scenario ids, x/y counts, artifact paths); there was no quickstart
(the build facade lived one hop away in BUILD.md with no minimal starting sequence
quoted), no "what works today" summary (the actual capability surface was buried inside
evidence cells), and the Documentation list gave no "when to read this" guidance while
missing plugin-dev, dsh-desktop-plugins, e2e-matrix, and troubleshooting entirely. The
D9 section header itself ("Upstream port (D9)") is an internal decision number an
outsider cannot parse. Nothing of the evidence was wrong — it was just addressed to the
people who already wrote it.

## Decision

README ±zh are restructured human-first while keeping every fact and the whole evidence
value: (1) an opening that says what the project is and why it exists (mobile host for
the DSH ecosystem; phones have no Linux shell ecosystem and desktop agents do not
install on phones; the isomorphic port route — upstream verbatim on QuickJS, platform
differences as capability negotiation); (2) a "What works today / 现状速览" snapshot,
one honest sentence per capability, each citing its receipt dir or PR; (3) a Quickstart
quoting the minimal `build/build.sh` sequence and pointing to BUILD.md / troubleshooting
instead of copying them; (4) an architecture one-screen (five layers, one line each)
linking ARCHITECTURE ±zh and sequence-diagrams ±zh; (5) the milestone table preserved
byte-for-byte as the "Project status & evidence" index, preceded by a reader-guidance
sentence ("if you are new here, the summary above is for you; this table is for
auditing") and extended with three fact-checked rows — the `dsh-shell-js` in-app shell
(#457 CLI 35/35 + the on-device shell turn, pass receipts on all three hosts,
`hosts/{ios,android,harmony}/artifacts/shell-turn/`, #491/#492), the iSH userland
retirement (#496/#497/#498, the decision addendum in doc/decisions.md), and the harmony
simulator-matrix leg going real (#475, `hosts/harmony/artifacts/simulator-matrix/`);
the D9 subsection stays a subsection with its totals refreshed to the current checker
run on this tree (118 dirs / 237 verdicts, was 93/211); (6) a Documentation-map table
(when to read what, nine entries); (7) Governance keeps the govrail content and adds
the two contributing facts (protected main, Angular Conventional Commits). Milestone
and workstream codes stay out of the prose per the 2026-09-23 note; artifact dirs,
scenario ids, and D-numbers stay verbatim as citations. Star History and the
not-an-official-product disclaimer are kept.

## Alternatives considered

- **Delete the milestone table entirely and keep only the prose summary** — rejected:
  the table is the evidence index this repository's culture runs on (rule 12: a status
  flip travels with the work that earns it; the e2e-matrix and receipts cite these
  rows' artifact dirs). A README without it would force every audit through
  doc/e2e-matrix.md and lose the at-a-glance provenance.
- **Shrink each table cell to one line and push the detail into the matrix doc** —
  rejected for this pass: the cells ARE the frozen acceptance claims; rewriting them is
  a content migration needing per-claim re-verification, not a front-door rewrite, and
  it would break the "preserved byte-for-byte" property that makes the demotion
  reviewable.
- **Fold D9 into the table as a new row** — rejected, consistent with the 2026-09-21
  consolidation note: D9 is a decision correction, not a milestone phase; it stays a
  subsection under the evidence section.
- **Translate artifact paths into friendly names in the new prose sections** —
  rejected: the paths are the citations; paraphrasing them would make every claim
  unverifiable at a glance, the exact opposite of the honest-unavailable culture.
