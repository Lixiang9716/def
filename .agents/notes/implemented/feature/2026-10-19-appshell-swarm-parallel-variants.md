# appshell swarm: the Pencil-style parallel-variants experience

Status: implemented
Date: 2026-10-19
Class: feature
Related: PR #585/#586 (the browser legs + M3 seam), PR #590 (boot mount), PR #594 (a2ui.messages@0.9 adopted), the swarm workflow run dwfrun-cc10f88e, OpenPencil (MIT) as the pattern source

## Problem

The owner asked for the Pencil experience — many pens drawing all the
prototypes at once — on our stack, with visual acceptance as a hard
requirement, referencing OpenPencil's code where portable (MIT; their stack
is Vue/canvaskit/yjs, ours vanilla DOM, so the port is at the pattern level).

## Decision

- **The swarm interaction** (one prompt → three variant app shells drawn side
  by side): the carrier scripts a swarm prompt as staged deliveries — three
  `appshell_render` variant cards (distinct theme accents + content) whose
  specs arrive in STAGES, so the progressive render is exercisable
  deterministically. Variants and staging live beside the existing fixtures
  in `tools/dev-web-carrier/appshell-scripts.mjs`, exported for tests.
- **The client swarm strip**: variant cards render side by side, each with a
  colored pen identity (color + name label); during arrival, closed
  components render immediately while pending regions show ghost outline
  boxes (the OpenPencil presence pattern: ghost rects for in-flight content,
  colored cursor at the growth point); picking a variant promotes it through
  the existing `openSurface` (the single-surface posture unchanged; the
  other two stay selectable). Pure logic (lenient JSON-prefix parse, ghost
  tree diff) lives in `appshell-core.js` with unit tests in the webclient
  suite; DOM wiring in `appshell.js`/`render-chat.js`/`main.js` under the
  code-size caps.
- **Verification, three layers**: (1) DOM assertions — the browser leg
  (`appshell-swarm.test.mjs` + runner) pins milestones one-to-one
  (scenario `appshell.swarm`) incl. per-variant DOM=spec parity and zero
  page errors, the CI-verdict altitude; (2) an independent visual-acceptance
  reviewer judged the three staged screenshots (generating-with-ghosts /
  all-three-complete / promoted-fullscreen) strictly against the written
  requirements — passed, with one zoom-verified non-blocking observation
  (consistent card-height bottom edge, confirmed design not breakage);
  (3) both local suites (panel + webclient) green in the deciding run.
  Per repo law the screenshots are local visual evidence — the DOM layer is
  the gate.
- **The dynamic workflow** (dwfrun-cc10f88e) did the building: a research
  agent extracted OpenPencil's portable patterns, an implementer worked the
  tree through two local-suite gates, the script ran the browser leg and
  published the staged shots, and the visual reviewer looped fixes until
  acceptance — the integration (mirrors, gov gates, receipts, this note,
  the PR) stayed with the main session.

## Alternatives considered

- **Port OpenPencil code directly** — rejected on stack grounds (Vue +
  canvaskit-wasm + yjs vs our vanilla no-framework client); the MIT license
  permits it, the dependency discipline (no framework, no wasm in the
  web client) does not. Patterns ported: ghost outlines of in-flight
  content, per-agent color/name identity, growth-point cursor.
- **Real parallel model calls for the demo tier** — deferred: this leg is
  the deterministic carrier tier (CI-verifiable); the real-model tier rides
  the provider-neutral benchmark tooling (LLM_* env) when wanted — three
  parallel deepseek-v4-flash calls ≈ ~5s wall, measured basis.

## Consequences

- The morph demo now has the Pencil moment: watch three apps draw themselves
  and pick one. Zero contract changes (everything is app-shell/0.9 content
  over the existing session stream — the adopted §10 shape held).
- The webclient mirror tax is paid (android + harmony staged, byte-verified);
  BUNDLE_FILES unchanged (client files replace in place).
- Real-model swarm and the pen-cursor-on-real-streaming (tool-call deltas
  through the spine) remain open demo-tier items; the ghost-render seam
  (appshell-core) is ready for them.
