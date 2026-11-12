# Agent Note: the permissionPresets face — a data-ized preset table the seat actually enforces

Status: implemented

## Problem

The staged-next ledger (doc/dsh-desktop-plugins.md appendix; plan.md
Appendix A) recorded "permissionPresets empty": the vendored subagent reads
`parent.ctx.get("permissionPresets")?.current(parent.session)`
(subagent@0.1.6-alpha.2, captureDelegatedPolicyOverrides) to carry the
parent's permission posture into child delegations, and the web plane's
`permissionPresets/catalog` leg — a claimed endpoint asserted by the
api-coverage gate legs — answered a hardcoded `{options: []}`. The service
was absent, so the read resolved to honest absence and the catalog leg was
a constant, not a face. The real `@deepseek-ai/dsh-permission-presets`
0.1.6-alpha.2 is vendored store-only and NOT mountable here: it declares
`inject: ["shell", "approval", "sessions", "sessionProjections"]` and
throws at construction over an unconfined executor ("presets bundle a
sandbox mode") — the mobile seat's enforcement story is the capability
registry's per-primitive permissionFlag at the host capability layer, with
no confining shell and no approval service to write through.

## Decision

The seat grows its own `permissionPresets` face (T-0299), mounted
unconditionally by boot.js beside the subagent rows:

- `runtime/dsh/upstream/permission-presets-data.js` — the preset table as
  pure data: one preset, `standard`, naming the capability registry's
  default flag set. The flag vocabulary is never copied here (a copy would
  drift from the one source table, tools/generated/capability-registry.json).
- `runtime/dsh/upstream/boot-permission-presets.js` — the face class
  (cordis `Service`, registered as `permissionPresets`; the one inject is
  `sessionProjections`). It carries the vendored READ contract — `names`,
  `current(session)` (a preset-name string), `catalog()`, `resolve(name)`
  (fail loud on unknown) — and the vendored WRITE vocabulary: the
  `permission/preset` session event folded by a `permissions` projection at
  the package's own stateVersion 2, keeping the sandbox/approval knob
  members in the fold so delegated or forked-in desktop events replay
  without loss. `set(session, name)` appends the durable intent event once
  (selecting the effective preset appends nothing — the upstream gate); a
  recorded name matching no table entry answers `custom` (the upstream
  derived state). No knob write-through: the seat carries no knobs, and the
  recorded event is the selection's whole effect until a session-scoped
  gateway enforcement seam is proposed in contract/.
- web-write.js forwards `permissionPresets/catalog` onto the face
  (makePermissionCatalogHandler, web-write-presets.js), replacing the
  hardcoded empty table; the api-coverage session gate legs assert the
  wire answer equals the mounted face and the face equals the data module.

Effect on the one live consumer: `current()` names `standard` for an
unrecorded session, and the subagent propagates only `auto` /
`danger-full-access`, so delegation behaves byte-identically to the honest
absence. The face's value is the resolved read for the day a provider
composition lands, plus a catalog that is data-derived instead of a
constant.

## Alternatives considered

- Mount the real vendored `@deepseek-ai/dsh-permission-presets` — lost: it
  hard-requires a confining `ctx.shell` and `ctx.approval`; composing it
  over this seat is the package's own documented misconfiguration, and its
  write path (setSandboxMode/setApprovalPolicy) targets desktop knobs this
  seat does not execute through.
- A multi-preset roster derived from the registry's flags ("readonly" =
  fs+network, "full" = everything) — lost: there is no session-scoped
  enforcement seam (gateway gating is per-primitiveFlag at the host
  layer), so switchable presets would be a fabricated control. The repo's
  own rule for this endpoint was "never a fabricated roster"; a richer
  table waits on a contract/proposals seam.
- Leave the service absent (the `?.` already makes the subagent work) —
  lost: the ledger item exists precisely to close "permissionPresets
  empty"; the hardcoded empty catalog was a constant masquerading as a
  face, and the delegation capture deserves a resolved read once a
  provider composition lands.
