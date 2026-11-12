# Agent Note: the capability-bus D5 draft — two vocabularies over the frozen gateway

Status: implemented

Date: 2026-11-13 · Class: architecture · Seat: docs/capability-bus-draft (worktree off origin/main `d3375af4`) · Task: T-0293

## Problem

Adding one OS capability to the gateway touches seven hand-maintained places
in lockstep: the frozen §2 table, the per-host serving lists (iOS
`GatewayCore.primitives` with a comment ordering itself to stay identical to
what registration wires, Android `PRIMITIVES` copied into six session
classes' descriptor JSON, harmony's twin descriptors in ArkTS and C kept in
sync by a dedicated parity gate whose buffer check caught a one-row-from-
brick 511/512 near-miss), 25 E2E manifests hand-pinning descriptor census
counts, the audit-invariant leg's 59 hand-enumerated probe cells (script
plus manifest), and the typed JS shim's one export per primitive. The cost
is measured, not hypothetical — the R3 face batches were sized M per host
largely because three hosts re-declare shared facts by hand. Without a
design that stops the copying, every future capability addition pays the
same seven-place tax and the descriptor keeps drifting risk in both
directions (a list thinner than the served face or fatter than the
contract's restraint rule).

## Decision

`contract/proposals/2026-11-13-capability-bus.md` (+ `.zh.md` + `.i18n.yaml`,
pairing confirmed) lands as a DRAFT D5 proposal — document only, no frozen
shape touched, nothing implemented:

1. **Two vocabularies on purpose** — the Linux `/proc/devices` vs uAPI-header
   split: the RuntimeDescriptor becomes derived runtime truth (per-host,
   self-describing rows: name, schemaVersion, audit class, permission flag),
   while `primitives.md` stays the owner-gated stability contract plugins
   pin against. Plugins negotiate against the descriptor; pin against the
   contract.
2. **Boot-time self-registration** — the descriptor stops being a hand list
   and is built from the dispatch registry the handlers already register
   into at boot; the sync-by-comment invariants become construction.
3. **The `describe`/`describeAll` primitive** — the one new vocabulary row,
   metadata-only, riding the `deviceInfo` no-permission-flag negotiation
   precedent and §7 #1's honest-`unavailable` adoption path; no version
   number claimed — the next free number at adoption under the
   monotonic-fold-ordering rule (v1.14.0 if the slimming/net-fd-wrap
   disposition holds).
4. **Derived census** — the 25 manifests' literal descriptor-count pins
   become checker-verified structural invariants (the
   regenerate-don't-hand-maintain philosophy `doc/e2e-matrix.md` already
   recorded).
5. **Structural audit pairing** — `gateway.audit-invariant` derives its cell
   set from the descriptor ("every registered handler must have a paired
   audit record") instead of 59 hand-enumerated cells, generalizing the
   pairing walk it already performs.

The boundary section names the non-negotiables: the bus IS the privileged
layer (never a plugin, never marketplace-installable — drivers ship only in
the store-signed binary), every frozen shape byte-for-byte, security-bearing
validation stays at the gateway, the two consent layers unchanged, and no
`hostType` branching. Alternatives recorded and rejected in the proposal:
extending vendored cordis into the bus (the trust root cannot live in the
plugin plane; D6), one vocabulary replacing the frozen table (the freeze is
what plugins pin against), and the status quo (the measured seven-place
tax). The contract READMEs' proposals pointer row now names the fifth
DRAFT, bilingual lockstep, both pairs re-confirmed with
`gov verify pairing --write`.

## Alternatives considered

- **Implement the descriptor build now (skip the proposal)** — rejected:
  D5 is contract-first; the descriptor grammar and the `describe` row are
  new gateway vocabulary, which lands as a proposal first, and the fold
  (a new primitive row) is the owner's adoption call, not a drive-by edit.
- **Fold the descriptor grammar into the native-face-schemas proposal** —
  rejected: that proposal's scope is payload schemas above/beside frozen
  primitives (`face.*@1` in data-protocols.md); the capability bus changes
  WHERE the descriptor comes from (a primitives.md concern) and adds a
  primitive row — different contract doc, different adoption surface,
  different reviewers.
- **Have the parity tool auto-derive the harmony descriptor instead of a
  contract proposal** — rejected: it would fix one host's symptoms while
  the seven-place tax stays; the descriptor's authority question (runtime
  truth vs stability contract) is a contract-level decision every host and
  the shim inherit.
