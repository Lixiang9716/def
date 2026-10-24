# Agent Note: the producer registry — LLM producers declare themselves, the mock face turns honest

Status: implemented
Related: proposal contract/proposals/2026-10-24-producer-registry, the mock census (2026-10-23)

## Problem

The mock census found three confirmed product gaps sharing one pathology:
the runtime knows which producer serves the llm face, but nothing registers
that fact, so a mock can masquerade as configured reality — the directory
row renders "OpenAI 兼容" for the loopback, credentials/describe answers
configured:true for MOCK_API_KEY, and "which producer is bound and why"
was an archaeology question (grep the resolver, trace the env, read the
mounts).

## Decision

`upstream/producer-registry.js` (split from llm-route.js at the code-size
gate the same day): `producerRecord(route, reason)` builds
{id, face:'llm', kind, provider, model, userEndpoint, reason} — never the
credential material — and `registerProducer(ctx, …)` keys it by the boot
context (the seam registries' discipline; the module is deliberately
acyclic: BYOK_REF is inlined because the qjs loader resolves an
llm-route ↔ producer-registry cycle differently than Node and the export
vanishes). Every bind site registers and emits `llm.producer.bound`
(boot via llm-gateway-mount, rebind/restore/mountByokPiai in llm-route,
the piaiSection gate mount); `reasonOfRoute` names the policy
(staged-config / byok-credential / no-credential-fallback / gate:piaiSection).
The fallback chain is unchanged — it is now the table's priority policy.
The honest mock face rides the kind field: the directory displayName, the
coverage and shell credentials/describe answers, and the modelCatalog group
label all declare the mock for what it is.

## Alternatives considered

**Per-leg routeKind patches** (four point fixes): rejected — the legs had
already drifted independently; the record is one source joined by all.
**Registering the census's 28 test doubles too**: rejected — they live in
harness paths the release builds refuse by name; registering them adds rows
no consumer reads. **Keeping the chain implicit with better docs**:
rejected — three gaps shipped green under exactly that regime.

## Consequences

The census question is now `grep llm.producer.bound` in any evidence log;
the onboarding-flow E2E (15/15) pins the live table both ways (save flips
the row to byok-credential, clear restores no-credential-fallback), and the
panel suite pins the record shapes including the never-the-credential
guarantee. Gap #2's wiring (credentials/set → keychain+rebind) and Gap #1's
product decision (which client ships) remain open and are now visible in
the table the moment they matter.
