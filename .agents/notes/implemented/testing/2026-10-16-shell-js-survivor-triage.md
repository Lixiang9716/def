# Agent Note: The shell-js survivor triage: equivalents, wording, and one fixture gap

Status: implemented

## Problem

The mutation pilot's landing (#551) deferred the survivor triage: 58 survived
mutants in applets-support.js + 2 in applets-shelljs.js, with no recorded
verdict on whether any represented a real test gap.

## Decision

Triaged off `test/mutation/reports/shell-js.json`: the population is (a)
equivalent under the scope-guard invariant — the abs-true branches of the
path face are unreachable because `normalizeInternal` nulls escaping paths,
and `lastIndexOf('/') === 0` never occurs on workspace-relative paths, so
`<`→`<=` and the abs ternaries cannot change observable behavior; (b) wording
and result-object defaults (StringLiteral/ObjectLiteral the panel suites
never assert verbatim); (c) ONE real fixture gap — the `toGateway`
nested-workspace prefix branches (applets-support.js:122/158) need a fixture
where workspace ≠ scope root, which the harness cannot express today (tests
always seed at the root). Six direct pins were added anyway
(shell-js-applets.test.js › "path face edges") locking the GNU semantics of
`P.dirname`/`P.basename`/`P.relative` — they do not change the score (the
mutants they touch are class (a)) but they freeze behavior the commands only
exercise through the node:path shim. Class (c) is the only actionable debt:
it lands with a harness fixture, not with more pins.

## Alternatives considered

- **Pin the abs-true branches through forced absolute paths** — rejected:
  reaching them requires an escaping path, which the scope guard correctly
  refuses; testing the refusal already exists (the #505 wording pins).
- **Accept (c) silently in the note only** — rejected: the row cell in
  doc/test-coverage ±zh now names the nested-workspace fixture gap so the
  next harness change sees it.
