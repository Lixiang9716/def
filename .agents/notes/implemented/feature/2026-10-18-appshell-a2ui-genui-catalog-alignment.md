# appshell A2UI mapping aligned to the genui v0.7.0 catalog

Status: implemented
Date: 2026-10-18
Class: feature
Related: PR #574 (app-shell/0.9 contract + validator), PR #576 (web render surface), plan `.zcode/plans/appshell-morph-plan.md` §M5

## Problem

The WIP A2UI mapping layer emitted components shaped by intuition — bare-string
`action.event`, `label` props on Button, `children` arrays everywhere — but
@lynx-js/genui v0.7.0's frozen basic catalog dictates a different contract:
actions are `{ event: { name } }`, Card and Button take a SINGLE `child` id
(not arrays), Text carries `variant` (not `size`/`style`), and Button requires
`action`. A mapping that ignored this would still ingest "successfully" (the
genui message store accepts any object with an `id`) yet render nothing — a
silent lie, exactly the failure mode the four-gate validator exists to prevent.
Separately, the WIP `specToA2UIMessages` converted RAW specs, silently
degrading every template node to a fallback Text.

## Decision

`appshell-to-a2ui.js` now compiles ONLY the expanded tree from `validate()`
and throws on template nodes (fail loud, rule 5); `specToA2UI(spec)` is the
raw-spec entry (validate → expand → convert, structured errors). The mapping
emits catalog-valid shapes only:

- `card` → `Card { child: columnId }` wrapping a `Column { children }` (Card.child is singular);
- `button` → `Button { child: labelTextId, variant: 'primary', action: { event: { name } } }` with the label as a Text kid; an actionless app-shell button synthesizes `'tap'` (catalog requires action);
- `progressbar` → `Slider { label, min: 0, max: 100, value }`, value clamped;
- `badge` → `Text(variation caption)`, `image` (emoji avatar) → `Text(h4)` — the two named substitutes in the M5 gap ledger (plan §M5 item 2), alongside progressbar;
- root entry is always id `root`, emitted first (genui's preferred root detection);
- accent rides the surface theme, not per-node styles.

The structural contract is pinned by `test/panel/appshell-a2ui.test.js`
(22 frozen catalog names, per-component emitted-prop sets, required props,
id uniqueness/resolution, action shape, count arithmetic, determinism,
fail-loud guard). Genuine ingestion is proven by
`test/panel/a2ui-genui-e2e.mjs`: all three mock fixtures through
`MessageProcessor.processMessages` → beginRendering + surfaceUpdate, root
detected, every child reference resolved, zero errors. The L3 benchmark now
runs the full pipeline per response and adds the M1 regeneration leg
(receipt: 8/10 first-pass, 10/10 cumulative, tokens P50 2570).

## Alternatives considered

- Emitting A2UI `component:` shapes directly from the template expanders
  (the original WIP direction): rejected — it forks the vocabulary (the web
  renderer consumes `type` trees) and breaks the validator's whitelist
  contract; expansion stays app-shell primitives and A2UI remains a
  downstream projection.
- Carrying accent into A2UI as per-node styles: rejected — the catalog has
  no style props; theme travels with the surface, which is the portable part
  of the cross-renderer promise (structure here, skin there).
- Asserting only structure in tests and skipping genui: rejected for the
  receipt script — the store accepts garbage, so only a real MessageProcessor
  pass proves "zero errors". Kept as a manual script (not a CI dep) to avoid
  pinning a browser-oriented package into the panel lockfile.
