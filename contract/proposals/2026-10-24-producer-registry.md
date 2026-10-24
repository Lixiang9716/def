# Proposal: the producer registry — LLM producers declare themselves, and the mock face turns honest (v1.12.0 candidate)

> **Status: ADOPTED 2026-10-24 — implemented as `upstream/producer-registry.js` (#681) with the honest faces and the sink-pattern bound event (#682). This file is the rationale record.**

English | [简体中文](2026-10-24-producer-registry.zh.md)

## Motivation

The 2026-10-23 mock census (four-leg scan, independent verification) found
three confirmed product gaps that share one pathology: **the runtime knows
which producer is serving a data face, but nothing registers that fact, so
mocks can masquerade as configured reality**:

1. The official client (the Release default on all three hosts) has no
   product path off the mock leg of the `staged → byok → mock` chain
   (`web-write-onboarding.js:96-109` is consumed only by web-client-v2).
2. The Models page's own save flow is a dead end: `credentials/set` writes
   a display store no turn path reads, while `describe` answers
   `configured:true` — a false configured state shown to real users
   (`web-write-llm.js:88-136`).
3. The mock route's facts dress as a configured provider in four join legs
   with no `kind` filter: the directory row renders "OpenAI 兼容"
   (`llm-gateway-mount.js:36-41`), the `llm-mock` settings namespace
   registers the loopback as base (`web-write-settings.js:46-62`),
   `credentials/describe` answers `configured:true, source:'staged profile
   credential'` for `MOCK_API_KEY` (`web-write-llm.js:88-100`), and
   `session/modelCatalog` ships `{provider:'mock'}` to the composer
   (`web-write-catalog.js:141-165`).

The honest `kind:'mock'` fact exists — on the route object itself
(`llm-route.js:249-261`) — but only one consumer ever reads it
(`web-write-onboarding.js:73-88`, a wire the official client never calls).
DeepSeek's upstream shapes data flow as explicit producers and consumers;
this proposal gives dsh-mobile the same discipline for the ONE decision
that is currently implicit archaeology: **which producer is bound to a
data face, and why**.

## The design (v1: the LLM face only)

### 1. The producer record — one structure, registered at bind time

```js
// llm-route.js (ours, not vendored)
{
  id: 'staged:default' | 'byok:dsh.llm/byok-route' | 'mock:loopback'
        | 'pi-ai:<catalog-id>',      // registry identity, stable per boot
  face: 'llm',                        // v1: always 'llm'; the namespace later faces join
  kind: 'staged' | 'byok' | 'mock' | 'pi-ai',   // the route kinds that already exist
  provider, model,                    // the serving facts
  userEndpoint: boolean,              // already on every route
  reason: 'staged-config' | 'byok-credential' | 'no-credential-fallback'
        | 'gate:piaiSection',         // WHY this producer is bound — the census's
                                      // missing answer, one field
}
```

`resolveLlmRoute`, `bootRouteOf`, `rebindLlmRoute`, and `restoreBootRoute`
each already construct exactly one route; each now also **registers** its
record into a per-boot producer table (`registerProducer(ctx, record)`, a
module-level Map keyed by the boot context — the same keying discipline as
the route-disposer registries at `llm-route.js:341`, never the service
object). The fallback chain itself is unchanged: it becomes the table's
priority policy instead of scattered ifs.

### 2. The honest mock face (Gap #3's fix rides the kind field)

Every join leg that renders route facts reads the record's `kind`:

- the directory row's `displayName` for `kind:'mock'` becomes
  `脚本演示端点 (mock)` / `scripted demo endpoint (mock)` — never
  "OpenAI 兼容" (`llm-gateway-mount.js:38`);
- `credentials/describe` for a mock route's ref answers
  `{configured:false, source:'mock route — no credential is served'}` —
  the green dot dies (`web-write-llm.js:90-100`);
- `session/modelCatalog` marks the mock group
  `name:'mock-1 (scripted demo)'` and the single-row fallback stays
  honest (`web-write-catalog.js:128-165`);
- `llm/runtime` (the existing event, `llm-gateway-mount.js:42`) gains
  `kind` and `reason` fields — no new event vocabulary.

### 3. The bound event — the census question becomes a query

```
llm.producer.bound { producer: id, kind, reason, provider, model }
```

emitted at every bind site (boot, rebind, restore, the piaiSection gate
mount). E2E manifests pin it one-to-one (AGENTS constraint 7); the mock
census's question — "what is still mock and why" — becomes
`grep llm.producer.bound logs` or a future `--list-producers` CLI over the
table. No polling: a rebind re-emits, so the latest record always states
the live truth (rules D8, rule 8).

### 4. Gap #2's seam is named but NOT wired here

The registry makes Gap #2 visible (a `byok:*` producer never registers
from a Models-page save — the table shows the mock record still bound).
Wiring `credentials/set` → `keychainSet` + `rebindLlmRoute` is the
consumer side of this proposal and lands as its own change with its own
tests; this proposal only guarantees the dishonesty becomes impossible to
miss. Gap #1 (which client ships) stays an owner product decision.

## Non-goals

- **Channel semantics** (backpressure, multi-consumer broadcast,
  hot-swapping producers mid-turn): the D5 pool's event-channel line —
  this proposal is registration and honesty, not a bus redesign.
- **Other data faces** (fs, marketplace, web): the record's `face` field
  reserves the namespace; faces join when they grow a second producer.
- **Any vendored-package change**: everything lands in
  `llm-route.js`, `llm-gateway-mount.js`, `web-write-{settings,llm,catalog}.js`,
  `composer-web-live.js` — all first-party files; D6 untouched.

## Alternatives considered

- **Keep the implicit chain, document it**: rejected — the census proved
  documentation cannot answer at runtime; three gaps shipped green.
- **A `routeKind` flag on each join leg** (point fixes per leg): rejected —
  four legs already drifted independently; the record is one source joined
  by all, and the census's other 28 test-doubles never enter product
  surfaces so they need no registry.
- **Register producers for every mock in the census**: rejected — the
  registry covers PRODUCT data faces; test doubles live in harness paths
  the release builds refuse by name; registering them would noise the
  table with rows no consumer reads.

## Evidence

- The census: `dwfrun-7a772592` (four scan legs + independent verification,
  33 hits, 3 confirmed gaps, all file:line cited in the record).
- The route kinds and the fallback chain already exist:
  `llm-route.js:216-327` (`stagedRoute`/`mockRoute`/`byokRoute`/
  `resolveLlmRoute`/`bootRouteOf`).
- The one honest consumer: `web-write-onboarding.js:73-88` reads
  `kind === 'staged'` — proof the field carries, proof also that one
  consumer is not enough.
- The rebind/restore seams and their context keying:
  `llm-route.js:329-465`; the directory handle swap the registry rides:
  `llm-gateway-mount.js:36-45`.

## Sizing

M — one PR: the record + four registration sites + four join-leg reads +
the event + scenario/manifest/runner trio (E2E-by-logs) + the panel
registry assertions. The honest-face strings are the only UI-visible
delta; default boots change bytes only in log lines and the directory
row's mock displayName (the E2E manifests that pin those rows update in
the same PR — they are ours, not vendored).
