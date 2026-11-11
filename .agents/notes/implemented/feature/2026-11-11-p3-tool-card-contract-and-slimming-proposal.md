# P3 of the seam-collapse program — the pinned tool-card face on every def tool plugin, and the primitive-slimming proposal

Status: implemented

Date: 2026-11-11 · Class: feature · Seat: feat/seam-collapse-p2p3 (P3 of the seam-collapse program — 2026-11-11-collapse-the-dual-capability-planes.md, same directory; plan.md §13)

## Problem

P3 of the seam-collapse program (plan.md §13) carries two contract debts the
first two phases exposed:

1. **The def tool plugins registered on the pin's partial face.** The pinned
   `@deepseek-ai/dsh-tools@0.1.6-alpha.2` `defineTool` carries a full
   presentation contract — `output { schema, render, presentationMeta? }`
   plus `presentCall`/`presentResult` render-intent cards
   (`external/dsh/tools@0.1.6-alpha.2/lib/types/index.d.ts:98-105`,
   `lib/types/schema.d.ts:178-239`, the view vocabulary in
   `lib/types/presentation.d.ts`) — and the registry projects
   `presentationMeta` into `result.meta` for top-level calls
   (`lib/index.js:3541-3548`). Our def plugins (dsh-office, dsh-appshell,
   dsh-create, dsh-plugin-manager-tools, dsh-open-design) declared only
   `schema + render` (office had `presentCall`), so every card consumer had
   to re-parse model-facing narration text, and replay carried no
   presentation structure at all — while the first-party upstream tools at
   the same pin (tool-fs read, tool-web) ship the full face as the posture
   to match.

2. **The frozen primitive table drifted in both directions.** Rows whose
   engine is gone (`ishRun`, no host since 2026-10) or that nothing
   implements (the v1.9.0 channel seam: zero implementations repo-wide) sit
   frozen beside rows every host serves but the table does not name (the
   capability plane: `cameraCapture`/BLE/`micStart`/`micStop` — the carrying
   2026-09-30 proposal still says "nothing implemented"). The slimming
   direction had to be expressed without touching a frozen shape (D5).

## Decision

### The tool-card upgrades (the code half)

Every def tool plugin now registers on the pin's full face; all presenters
are PURE (no I/O, no session state, no clock — the upstream presenter
discipline) and TOTAL:

- **dsh-office** (word.js, excel.js, ppt-create.js, ppt-read.js, shared.js):
  `output.presentationMeta` on all eight tools — the read tools project the
  tool-fs read pattern (`word_read` carries line-numbered `lines`/
  `totalLines` and `presentResult` narrows `result.meta` back into a
  `card:'read'` view; `excel_read` projects the sheet grid summary; the ppt
  tools project the slide outline), the create/update tools project the
  document structure (`view:'edit'` + counts), and each
  `presentResult` degrades to `undefined` (the pin's generic fallback) on
  error results and alien meta shapes. Shared narrowing helpers
  (`metaObjectOf`, `linesOf`) live in shared.js.
- **dsh-appshell** (index.js): `presentationMeta` carries the structured
  surface intent `{surfaceId, title, spec}` (render) / `{surfaceId, spec}`
  (update) so a card consumer stops re-parsing the echo JSON; all three
  tools declare `presentCall`; render/update declare `presentResult`. The
  header's "output { schema, render }" contract comment updated to name the
  meta.
- **dsh-create** (index.js): `plugin_create`'s meta carries
  `{title, kind, durationMs}` — the exact fields the native CardPlayer eats
  today as `card.present` bus lines — closing the tool→card gap the pin
  already provided.
- **dsh-plugin-manager-tools** (index.js): the meta parses the validated
  JSON line (pure `JSON.parse`) and projects the roster/bundle ids; a
  non-JSON body keeps the minimal `{view, ok, action}` shape — never
  `undefined`, because the registry's `snapshotProjection` throws on a
  non-lossless projection and would fail the call
  (`external/dsh/tools@0.1.6-alpha.2/lib/index.js:2564-2573`).
- **dsh-open-design** (new present.js + index.js wiring): the three tools'
  presenters live in one pure module; the artifact save card carries the
  shareable locator; the metas pin `ok` from the validated envelope.

Pinned by `test/panel/tool-card-face.test.js` (18 assertions: totality,
fail-soft degradation, the pin's card vocabulary), which needed one alias
addition (bare `fflate` → the tracked android staged copy, the fs-local
precedent) and a `gateway.js` mock adding the bus's `onEvent` no-op for
dsh-create's timers shim. The four affected e2e legs re-ran green with the
meta projector live on the real dispatch path (office 20/20, appshell-spec
15/15, plugin-forms 34/34, open-design 16/16 — a throwing projector would
have failed the one-to-one log match); the artifacts changed only in
nondeterministic tmpdir names. The full panel suite: 671/671.

Mirrors and staging updated in the same change: root `system-plugins/`
(byte-identical), harmony rawfile copies + one new BUNDLE_FILES row
(`system-plugins/dsh-open-design/present.js`) via
`tools/gen-staging-emit.mjs --emit`, the android assets copies, and the iOS
RESOURCES row (`plugin_open_design_present_js`) + the BundleStager write.
`staging-check`, `staging-generated`, and `check-bundle-files` all green.

**Deferred, honestly**: no seat surface consumes `presentCall`/
`presentResult`/`result.meta` yet — the native CardPlayer eats
`card.present` bus lines (hosts/ios/App/Source/CardPlayerSurface.swift:67-72)
and the appshell face eats app-shell→A2UI, so the consumer side is P4/R3
work (the minimal-consumption clause of the P3 ask found no existing
render-intent data plane to wire). The marketplace site tgz
(deploy/marketplace/site) was NOT rebuilt: the publish pipeline repacks from
`system-plugins/` at publish time (#284 flow; the P1 precedent — #762 also
did not rebuild it).

### The slimming proposal (the contract half)

`contract/proposals/2026-11-11-gateway-primitive-slimming.md` (+ .zh.md +
.i18n.yaml, pairing confirmed): annotate the irreducible native ABI per
family with per-host service truth; deprecate `ishRun` (v2.0.0 removal; no
capability consumer — the enumerated mechanical tail, the web-live probe /
gateway wrapper export / manifest capability row / audit-invariant cells,
rides the removal PR) and recommend the same marking for the
never-implemented channel seam, whose one designed carrier (the capability
plane's camera-frames half) the proposal re-shapes to the dedicated-seat
precedent the shipped mic/BLE faces already follow; keep the socket rows
(real C-spine implementation + audit boundary) with the vacancy annotated;
fold the capability-plane rows every host already serves (with the
v1.12.0-collision disposition against net-fd-wrap recorded); and name the
boundary rule — security-bearing validation (scope-escape rejection,
permission flags, audit) stays at the gateway, data-shaping ceremony (the
three-copy address derivation, the stale mountWorkspace wording) sinks into
providers. All evidence path:line-cited; no frozen shape touched (D5). The
revision round (the proposal review's five findings — channel-half
disposition, version collision, the mechanical tail, cite drift, the
contract README's DRAFT pointer) landed in the same seat; the README
pointer now names this third DRAFT.

The writing-method→gates promotion named by plan.md §13 P3's item stays
🔒 owner call and does not land here.

## Alternatives considered

- **Wait for a consumer before declaring any presentation hooks** —
  rejected: the pin's registration already enforces the output face, and the
  replay journal only carries meta if the projector exists when the call
  runs; deferring the declaration would keep every future session
  un-replayable as a card for one line of presenter code per tool.
- **Diff cards for the office create/update tools** — rejected: the pin's
  `DiffResultView` carries text `oldText`/`newText`, and an OOXML package is
  a binary zip; a diff card would be dishonest. Generic result cards with
  structure metas instead (an excel grid summary and a slide outline are not
  line-numbered code, so the read-card vocabulary fits only `word_read`).
- **Rebuild the marketplace site tgz in this change** — rejected: the
  publish workflow signs and repacks from source at publish time; in-repo
  rebuilds would churn signed bytes with a test key for no consumer (the P1
  precedent did not rebuild either).
- **Express the slimming by editing primitives.md directly** — rejected:
  D5 freezes the shapes and the document's contract face for the life of
  major version 1; annotation/deprecation is a proposals/ record until the
  owner adopts it (the producer-registry adoption precedent).
