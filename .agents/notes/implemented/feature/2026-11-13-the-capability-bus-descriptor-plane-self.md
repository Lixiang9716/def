# Agent Note: the capability-bus descriptor plane — self-describing descriptors, the registry generator, structural audit pairing

Status: implemented
Related: D5

## Problem

Every OS capability the gateway serves is re-declared by hand in seven
lockstep places (contract/proposals/2026-11-13-capability-bus.md, the
measured motivation): the frozen §2 table, the iOS serving list (whose own
comment admits it is "a second copy of a truth" held by comment discipline),
the Android serving list copied by SIX session classes, the harmony
descriptor twice in two languages (kept honest only by a dedicated parity
gate whose buffer check once measured a 511/512 one-row-from-brick
near-miss), the per-host census counts pinned in 25 E2E manifests, the
audit-invariant leg's hand-enumerated cell list, and the typed shim. Adding
ONE primitive mechanically reddens every one of those places until hands
re-pin them. Nothing in the tree could answer "what does THIS host serve,
and what is each row's audit posture and permission flag" without reading
native code — the descriptor named rows but carried no per-row facts.

## Decision

The descriptor plane of the capability-bus proposal, steps 1/3/4 (the
machinery WITHOUT the describe primitive — that rides the proposal's D5
adoption):

- **One source table**: `tools/generated/capability-registry.json` — 46
  rows (name, origin, family, permissionFlag, auditClass, schemaVersion),
  authored from contract/primitives.md §2 (the v1.11.0 33-row table — the
  v1.12.0 fold had not landed on origin/main) plus the capability plane's
  13 rows (the camera trio, the BLE family, the mic pair), and each host's
  serve/absent policy extracted verbatim from the descriptor lists that
  existed. `auditClass` marks the timer pair `unaudited` (its calls ride the
  runtime's own re-arm machinery, the #397 seam — the mic-plane audit
  manifests' skip lists are the precedent); every other row is `audited`.
- **The generator**: tools/check-descriptor-parity.mjs grows from a harmony
  parity gate into a parity gate + GENERATOR. `--emit` writes five blocks
  between `dsh:capability-registry:` markers: the per-entry facts tables in
  GatewayCore.swift and GatewayCore.kt, the Android serving table
  (PRIMITIVES), and the two harmony descriptor literals (ArkTS
  BINDING_DESCRIPTOR + C DSH_BINDING_DESCRIPTOR) — both faces from ONE
  policy, lockstep by construction. `--check` (the default, the gate) keeps
  every pre-existing harmony face check, adds: entries lockstep between the
  two harmony faces and the registry policy (order-sensitive); facts-table
  equality with the registry on both hosts; and the registration-flow
  derivation — the gate statically extracts every
  `core.register(name:)`/`register("...")` site, folds dotted sub-verbs to
  their base row (fsScope.persist/resolve ride fsScope), and requires the
  result to equal the host policy (Android minus the retired rows). The
  gate's paths grow to cover the new inputs (sealed-file edit accepted via
  verify-plane --write).
- **Self-describing descriptors** (step 1, additive only): each descriptor
  gains an `entries` array — {name, schemaVersion, auditClass,
  permissionFlag} per declared row — beside the unchanged available/
  unavailable name arrays. The harmony buffer grew 2048 → 8192
  (napi_init.cpp; the descriptor is 4364 bytes and phase_str_arg rejects
  len >= sizeof). The served/absent NAME SETS are byte-identical to before.
- **Registration-driven derivation** (step 3): iOS's descriptor is now
  BUILT from the registration flow — register() records the name, the
  builder folds dotted riders to base rows, looks up the generated facts
  (a row the registry does not know fails loud), and the three iOS session
  sites consume it; the hand `primitives` list is deleted (its
  identity-demand comment is now structural, and the gate asserts the list
  stays gone). Android keeps an emitted serving table (Kotlin's
  per-instance registration cannot feed a companion constant) whose
  identity with the registration flow the gate enforces; the six Android
  session sites consume GatewayCore.descriptorJSON instead of hand-assembled
  JSON. Harmony's two faces stay cross-checked by the gate.
- **Structural audit pairing** (step 4): the audit-invariant leg derives
  the audited-class set from the LIVE descriptor the runtime declared
  (entries when present; every declared row otherwise) and fails naming any
  declared audited row the battery does not drive; it emits `audit.coverage`
  {declared, audited, uncovered, verdict, entries}, which the manifest pins
  as ONE verdict row (no counts — the derivation is the assertion), and the
  runner's pairing gate re-checks independently against its own pairing
  walk. New rows join the invariant by EXISTING in the descriptor.

The pinned census counts in the other 24 manifests stay pinned (out of
scope); the machinery emits the derived census in the descriptor so a
future leg can re-pin. The CLI seat's descriptor (example/main_cli.c) does
not carry the entries field yet — the scenario defaults every declared row
to audited there.

## Alternatives considered

- **Make the available/unavailable arrays carry the per-entry objects**
  (the proposal's "each entry self-describing" read literally) — rejected:
  it changes the JSON shape every existing consumer parses (the scenario
  census reads, the negotiation metadata, the 25 pinned manifests) and is
  NOT additive. The sibling `entries` array carries the same facts with the
  name arrays untouched; the grammar fold into the contract docs can adopt
  either form, and the entries array maps 1:1 onto the object form.
- **Registration-order descriptor lists on all three hosts** — rejected for
  Android and tempered on iOS: three of the six Android session faces
  deliberately over-declare (their comment says "registered handler set is
  fs + httpFetch" while the descriptor names the full table), so deriving
  their lists from their own registration would CHANGE the served sets,
  breaking the additive-only constraint. Android keeps the emitted table +
  gate-enforced registration identity; iOS derives for real (all three iOS
  faces register the full table before the descriptor is passed — verified
  in the session flows).
- **Generalize the manifest to a structural matcher in check.mjs** —
  rejected: the one-to-one checker's grammar (name + exact matchers) has no
  existential form, and growing it for one leg broadens every manifest's
  blast radius. The structural assertion lives where the leg already has
  free-form machinery: the scenario's derivation (fail-loud, names the
  uncovered rows) + the runner's pairing gate (independent re-check), with
  the manifest pinning only the coverage verdict. A detector-level negative
  test proves the runner arm names an uncovered entry.
- **Also derive the CLI seat's descriptor** — deferred: out of this
  change's file scope; the scenario's default-to-audited path keeps the leg
  green there, and the CLI face can adopt the grammar with the same
  generator when the describe primitive lands.
