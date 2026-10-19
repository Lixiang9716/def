# Agent Note: util-crypto joins the sibling pin shape — the last staging audit finding is dispositioned (issue #263)

Status: implemented
Related: #263, the 2026-10-08 staging consolidation notes (harmony + android/ios)

## Problem

Issue #263 carried two audit findings from the Phase-2 roundtrip report: 312
duplicate rows in harmony BUNDLE_FILES, and util-crypto staged under a pin
shape no sibling uses (a LICENSE row plus three README rows). The first
finding died with the generated store (the rows file is set-shaped: 1238 raw
= 1238 unique). The second survived the consolidation *because of* it: the
2026-10-08 first emit honestly harvested the committed hand list into
`harmony-BUNDLE_FILES.policy.rows`, doc rows included, and the emit's carry
semantics — `policy = carried ∪ (committed Index.ets rows − derived)` — make
the four doc rows self-healing against a one-sided edit (deleting them from
either source alone gets restored from the other on the next `--emit`).

## Decision

The four doc rows (`vendor/dsh/util-crypto@0.1.6-alpha.2/{LICENSE,
README.i18n.yaml, README.md, README.zh.md}`) leave **both** sources in one
change — the Index.ets array block and the policy file — and the committed
rawfile mirrors are deleted. util-crypto now stages exactly the sibling shape
(`lib/index.js` + `package.json`, 1234 bundle rows). Safety verified before
the cut: no import edge reaches the doc rows, no code path references them
(the only tree hits were the manifest itself), iOS already stages only
`lib/index.js`, and android stages no extras. Scoped `gov run`: 27/27.

## Alternatives considered

- Keeping the LICENSE on-device for license display: nothing reads it there —
  the supply-chain audit (row 10) runs over the pinned closure from the
  ensure scripts, never over the staged bundle.
- Adding the rows to `harmony-BUNDLE_FILES.exclude.rows`: the wrong file —
  exclude exists for DERIVED rows the host declines to stage; these had no
  derivation edge, so exclusion would be a no-op while the policy rows
  kept re-adding them.

## Consequences

A no-edge row cannot leave the harmony bundle by editing one file: the
carry-union makes the store append-only in practice, and a removal must name
Index.ets and the policy file together. That is the documented remedy for the
next odd-shape disposition.
