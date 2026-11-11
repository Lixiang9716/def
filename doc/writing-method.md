# Writing method

English | [中文](writing-method.zh.md)

Eight rules for any code that lands in the product face of this repository
(`runtime/`, `system-plugins/`, `presentation/`, `packages/`). Style follows
[defensive-patterns](../third-party/deepseek-harness/docs/defensive-patterns.md):
each rule is one sentence, its consequence is one sentence, and the referents
name where the practice is already proven.

**Source.** Derived from the 2026-11-11 full scan of the vendored upstream
reference — the docs under `third-party/deepseek-harness/docs/` and the
pinned package sources under `external/dsh@0.1.6-alpha.2` — aligned with the
community-skeleton decision (anywhere-labs/dsh-desktop; see
[dsh-desktop-plugins.md](dsh-desktop-plugins.md)). The decision record is the
2026-11-11 collapse note
(../.agents/notes/implemented/architecture/2026-11-11-collapse-the-dual-capability-planes.md).

**Gate status.** Each rule states whether a command already enforces it
(the gate id from `gates.json`) or it is currently a convention that review
enforces until a gate is written (the P3 phase of the seam-collapse program
promotes the checkable ones).

## 1. Place it, or it is not product content

Product content takes exactly two forms — a plugin (a `dsh-plugin-*`
package; this repo's outboard instances are the `system-plugins/dsh-*`
packages) or a composition declaration (bundle/patch data) — and the host
contributes only the privileged layer, the gateway bindings, and the
renderer. Behavior parked anywhere else — a module wired into a host, a
one-off script smuggled into boot — grows a third place capability logic
lives, and every later audit pays for it.

The vocabulary is the community DSH Desktop skeleton's (`dsh-plugin-*`
packages, `apps/fabric`'s vendored composition; the `vendor/` face is what
this repo actually pins — external/ensure-dsh.sh:101).

*Gate status:* convention awaiting a gate (the `staging-*`/`closures` gates
police where staged files go, not the shape of new product content).

## 2. Name the three roles before writing code

A new capability first names its Service Definition (a vendored or owner
package), its Provider (def), and its Consumers — and the package README
carries that naming — and a Service Definition is a Cordis Service, never a
TS interface. Unnamed roles grow a second implementation silently, which is
exactly the dual-plane disease the 2026-11-11 fs collapse note records.

The reference is the seams table's owner/implementations/consumers columns
(third-party/deepseek-harness/docs/capability-seams.md) and the primer's
service model (cordis-primer.md: "A plugin is a object [sic] that implements
Service"; dependencies resolve by `ctx.<key>`, not by import).

*Gate status:* convention awaiting a gate.

## 3. One plugin shape; the config validates before the body runs

A plugin is `{name, inject, apply}` plus a Schemastery Config (the TS
interface and its same-named schema), dependencies are declared with
`inject` and never assumed from mount order, and every registration carries
a disposer. Validate-first makes a bad configuration fail the fiber at
mount (FAILED) instead of detonating mid-turn; declared `inject` keeps the
composition order-free; a missing disposer leaks registrations across
reload and teardown.

The upstream primer states the shape (cordis-primer.md: "Declare service
dependency via `inject`"; "Every registration should have a disposer"), and
the vendored closure is full of it (e.g. the llm-retry mount in
runtime/dsh/upstream/boot.js: "Exports {Config, apply, inject, name} and no
default — the namespace object IS the plugin").

*Gate status:* convention awaiting a gate (`quickjs-boot-parse` catches
boot-graph parse errors, not config-schema validation).

## 4. Tools declare the whole contract; policy lives in the pipeline

A tool ships the full `defineTool` contract — parameter schema, the
mandatory `output.schema`, the pure `output.render` projection, and
`presentationMeta` for the card face — writes policy ONLY as listeners in
the pipeline's five slots (`tools/pre-execute`, guard, `tools/execute`,
`tools/post-execute`, `tools/result`), and lets the native card consume the
render intent. Policy smuggled into a tool body bypasses the registry's
guard/post slots — audits and permission flags stop seeing it — and breaks
replay, because the model-visible projection stops being a pure function of
(args, value).

The contract lives in the vendored types
(external/dsh/tools@0.1.6-alpha.2/lib/types/index.d.ts:16 for `defineTool`;
`render`/`presentationMeta` declared pure at :100-105; `output` mandatory
at :110) and the five slots in the registry's own words ("pre/guard/around/
post/result", external/dsh/tools@0.1.6-alpha.2/lib/index.js:2492; the
`ctx.tools` row in capability-seams.md names the same five).

*Gate status:* convention awaiting a gate.

## 5. Pick the event domain, respect the dispatch mode, delegate in waterfall

Choose the event domain before inventing a name — durable facts are session
events, interception of in-flight work is `agent/*`, additive policy is
capability events (`fs/*`, `tools/*`) — dispatch in one of the five
documented modes, and a waterfall listener that decorates or observes MUST
call `next()`. A decorator that returns without `next()` short-circuits the
around-middleware chain and silently swallows every downstream listener; an
invented name dodges the declared mode, and consumers never bind to it.

The semantics are the primer's (cordis-primer.md: the five modes
emit/waterfall/parallel/serial/bail; "return without `next()` to
short-circuit"), and the extension-point matrix is the name registry
(event-producer-consumer.md: `fs/write-intent`, `fs/edit-intent`,
`fs/observed`, `tools/pre-execute`, `tools/execute`, `tools/post-execute`,
`tools/result` are all declared rows).

*Gate status:* convention awaiting a gate.

## 6. Model-visible is recorded

Everything that enters a model request must be reconstructable from the
session log, so new model-visible input ships as a new session event and
every projection stays a pure function. An input that cannot be replayed
makes the next turn inexplicable — debugging, compaction, and cross-device
resume (D7) all read the log, and a gap reads as model misbehavior rather
than a recording defect.

*Gate status:* convention awaiting a gate.

## 7. Docs carry their weights; one fact, one home

A package README states its Model Experience (what the model sees, the
token effect, the KV-cache effect) and carries a mandatory Known
Limitations section; every fact lives in exactly one home; directory docs
migrate to generated-plus-integrity-guard-plus-verify instead of
hand-edited tables. A README without the model-facing weights makes every
consumer re-measure tokens from scratch, and a fact with two homes drifts —
the reader of a duplicated fact always picks the stale copy.

The README convention is the vendored packages' own
(external/dsh/tool-todo@0.1.6-alpha.2/README.md: `## Model Experience` and
`## Known Limitations and Deferred Work`); the generated-docs exemplar in
this repo is the e2e matrix (regenerated by `test/e2e/matrix.mjs --out`,
gated by the `e2e-matrix` gate).

*Gate status:* convention awaiting a gate (one exemplar already gated:
`e2e-matrix`; `doc-crosslinks` guards only link integrity).

## 8. Verify the world, not the self-report

Every behavior-bearing change carries its legs — the scenario leg (E2E by
logs, a unique `scenario-id`, expected↔logged matched one-to-one), a
real-composition boot assertion, a registry HMR-safety test (dispose the
contributing fiber, assert cleanup), and the parity differential leg —
because a green self-report is not evidence. A change that skips the legs
ships whatever mount order happened to do: the 2026-10-11 shell seat switch
found two latent defects in a plugin that had never been booted.

The legs' homes: doc/ARCHITECTURE.md ("every E2E scenario carries a unique
`scenario-id`"), the upstream testing bar (third-party/deepseek-harness/
docs/testing.md: "Every registry gets an HMR-safety test (dispose the
contributing fiber, assert cleanup)"), and the committed differential
ledger the sweep driver reads
(test/upstream-suite/differential-ledger.json).

*Gate status:* partly gated — `e2e-matrix` keeps the coverage matrix honest
and `test-taxonomy` classifies the suite; the four legs themselves are
convention awaiting a gate.
