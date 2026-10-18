# Proposal: the agent-UI seam — A2UI v0.9 as the declarative generative-UI format (format-only fold candidate)

> **Status: ADOPTED (2026-10-19) — folded as data-protocols.md §10 `a2ui.messages@0.9`
> (v1.3.0). This file is the rationale record; the frozen seams live in the contract
> doc. The owner adopted post-hoc: the seam had already shipped as the `dsh-appshell`
> plugin and the web-client renderer, and the fold freezes the implemented shape.**
> English | [简体中文](2026-10-17-a2ui-generative-ui.zh.md)

## Motivation

The agent today can put three kinds of pixels in front of the user, and none of
them is a contract:

1. **Card faces are an informal format.** Plugins post `card.present` /
   `card.complete` through the bus (`__dshBusPost`, see the generated plugin in
   `runtime/dsh/system-plugins/dsh-create/index.js:131-160`): `{ id, kind, title,
   subtitle, durationMs }`. There is no schema, no version, no conformance rule —
   the known tail account from the pomodoro create-loop landing (#427: "card-face
   JSON contract" left open). Every new card shape is a private dialect.
2. **The fullscreen tier is imperative only.** The render surface (v1.10.0,
   primitives.md §4) gives the agent `presentSurface`/`surfaceDraw` over the
   closed op set `surface.ops@1` — a drawing surface, not a UI toolkit. The right
   tool for a form, a list, or a confirmation card is a component tree, and the
   contract has none.
3. **The industry has standardized around us.** 2026 state (survey,
   2026-10-17): AG-UI 1.0 (2026-09-30; Google/Microsoft/AWS), MCP Apps as the
   first official MCP extension (2026-01-26, SEP-1865), and Google's A2UI
   (2025-12-15, open, Apache-2.0) as the declarative format rendered
   natively on web, mobile, and desktop without executing arbitrary code. Lynx —
   our render seam — now ships an official renderer:
   `@lynx-js/genui` v0.7.0 (lynx-stack, listed on
   [a2ui.org/ecosystem/renderers](https://a2ui.org/ecosystem/renderers), Lynx
   Mobile/Web/Desktop, **A2UI v0.9**).

Meanwhile the ecosystem seat is empty: a five-way check on 2026-10-17 (this
repo, the upstream pin table, the `external/dsh` checkout, the deepseek-ai org,
GitHub code search) found **zero A2UI anywhere in DSH**. The closest upstream
assets are a static render-intent vocabulary
(`external/dsh/tools@0.1.6-alpha.2/lib/types/presentation.d.ts`) and the client
UI slot mechanism (`dsh-client-ui-slots` renderer install contract) — a floor,
not a protocol.

The 2026-09-30 Lynx pilot note
(`.agents/notes/implemented/architecture/2026-09-30-the-lynx-render-surface-client-is-a-pres.md`)
established the discipline this proposal keeps: the client plane is replaceable
over the SessionServe wire with zero gateway primitives. This proposal extends
that discipline to the message layer: pick the industry format the Lynx face can
already render, pin it, and retire the card-face debt into it.

## Proposal

Adopt **A2UI v0.9** (the exact version `@lynx-js/genui` renders) as the
contract's declarative agent-UI format, defined additively as
**`a2ui.messages@0.9`** in a new data-protocols.md section — mirroring how
`surface.ops@1` is defined — with these seams:

- **Downlink (agent → client): no new primitive, no new channel.** A2UI messages
  are session content, the same altitude as tool-call cards: the runtime emits
  them on the session stream and clients receive them over the existing
  SessionServe wire (three-layer envelope unmoved). A host renders them with its
  own renderer — for the Lynx face, `@lynx-js/genui/a2ui` (`createMessageStore` +
  `<A2UI catalogs onAction>`); the Web Client keeps its sandboxed-iframe creation
  viewer as the floor.
- **Uplink (client → agent): actions enter as user turns.** An `onAction` from a
  rendered A2UI surface becomes a user-turn event tagged with the component path
  and message instance id — it grants nothing by itself and passes the same
  approval seams as any user-originated request (#441). No `ui.action` channel in
  v0; if the fold's evidence shows tag-as-turn is lossy, a `ui.action` channel
  (§5) is the upgrade path, decided at fold time with evidence.
- **Catalog: extracted, not invented.** The component catalog a session offers
  the model is derived from declared assets — card-face schemas (the migrated
  `card.present` vocabulary), the upstream presentation intent vocabulary
  (`presentation.d.ts`), and plugin-declared components. The extractor is pure
  JS in the runtime closure; no host involvement.
- **Security rules ride the format section:** component string fields are text —
  never markup, never URLs auto-fetched; there is no HTML escape-hatch in v0
  (open-ended generation stays what it already is: creation-mode source through
  the approval seam, per the creation viewer's floor); per-turn message count and
  tree-size budgets; generation is stream-parseable so a hostile or runaway model
  output truncates, never wedges the runtime (QuickJS stays single-threaded; the
  renderer lives on the client side of the glass, in Lynx's own engine — the two
  JS worlds share no state, per ARCHITECTURE.md §6).
- **Version pinning is part of the contract.** `a2ui.messages@0.9` names the
  spec version; upgrade to a newer A2UI only when the Lynx renderer we pin
  supports it (the renderer is v0.9-only today; the spec has since moved —
  that gap is exactly why the version lives in the format name).

## Where this sits (the three-tier map)

| Tier | Mechanism | Contract state after fold |
| --- | --- | --- |
| Static cards | `card.present` bus posts | legacy; mapped into the A2UI catalog, deprecation evaluated at fold time — never a forced migration |
| Declarative UI | **this proposal: `a2ui.messages@0.9`** | versioned format in data-protocols.md |
| Fullscreen graphics | `presentSurface`/`surfaceDraw` (`surface.ops@1`, v1.10.0) | unchanged — imperative, complementary |
| Open-ended code | creation mode (README.md:55) | unchanged — source through the approval seam |

## Alternatives rejected

- **OpenUI Lang (Thesys)** as the target format: it wins the published token
  benchmark (~4.8k vs ~10k tokens, first render 19.4s vs ~40s) and Lynx ships a
  renderer for it too — but A2UI carries the larger ecosystem (Google backing,
  catalog negotiation, native renderers on every platform we ship) and is what
  the Lynx face's A2UI path is aligned to. The token gap is a real risk, so the
  fold requires a measured benchmark on our own LLM (glm-4.6, plan P1); if
  OpenUI Lang wins decisively on our traffic, the proposal accepts being
  revisited before fold.
- **Vercel json-render**: widest renderer breadth on paper, but no Lynx renderer
  and no catalog negotiation — it optimizes for surfaces we do not host.
- **A custom card schema**: that is the `card.present` status quo — ad-hoc
  formats are the debt being retired, not the fix.
- **MCP Apps**: a transport for UI inside *other* hosts' clients; we are the
  host. Out of scope by construction.
- **Do nothing / wait for upstream DSH**: upstream has zero A2UI and no signal
  of adding it; waiting leaves the card-face account open and cedes the seat.

## Non-goals

- No new gateway primitive, no new event channel, no host code in this fold.
- No escape-hatch GeneratedView (sandboxed HTML inside a declarative catalog) in
  v0 — revisit only with a concrete content need.
- No forced migration of existing `card.present` producers.
- No MCP Apps host surface; no change to the creation viewer's floor posture.

## If accepted (fold plan)

1. Fold additively: data-protocols.md gains `a2ui.messages@0.9` (format,
   security rules, budgets); primitives.md gains nothing but a pointer.
   Nothing flips in code by the fold itself.
2. Evidence legs before any implementation lands (plan P1–P4, filed at
   `.zcode/plans/a2ui-generative-ui-plan.md`): agent-side prompt/validator/
   catalog-extractor in pure JS; a real lynx-view rendering runtime-emitted
   messages via `@lynx-js/genui` (vendored per the vendor-package process,
   client-side only); `onAction` → user-turn loop; injection red-team cases
   (untrusted text escaping, per the SAEP finding); E2E by structured logs with
   a unique scenario-id, one-to-one expected ↔ logged.
3. Each leg keeps the pilot discipline of the Lynx note: client-plane work adds
   zero primitives and edits nothing under `contract/` until its own fold.

## Evidence base

- `@lynx-js/genui` v0.7.0: lynx-stack `packages/genui/README.md` + `CHANGELOG.md`
  (PRs #4127–#4190); proposal discussion lynx-family/lynx-stack#2453.
- A2UI: [a2ui.org](https://a2ui.org) (open, Apache-2.0, 2025-12-15);
  [ecosystem renderers](https://a2ui.org/ecosystem/renderers) (Lynx entry,
  v0.9); Google developers blog (A2UI v0.9, 2026-04).
- Industry survey 2026-10-17: openui.com "The State of Generative UI in 2026"
  (transports × three generation tiers; OpenUI Lang token benchmark); AG-UI 1.0
  (copilotkit.ai, 2026-09-30); MCP Apps (blog.modelcontextprotocol.io,
  2026-01-26).
- In-repo anchors: `runtime/dsh/system-plugins/dsh-create/index.js:131-160`
  (card.present posts); `contract/primitives.md` §4 render surface / §5 event
  channels (v1.10.0); `external/dsh/tools@0.1.6-alpha.2/lib/types/
  presentation.d.ts`; `presentation/lynx-client` (RenderSurfaceClient seam,
  PR #248); doc/ARCHITECTURE.md:205; README.md:55.
