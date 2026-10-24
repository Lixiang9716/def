// dsh:logging-exempt (a pure registry: no logging of its own)
/**
 * upstream/producer-registry.js — the producer registry (proposal
 * 2026-10-24, producer-registry v1). Split from llm-route.js at the
 * code-size gate the same day it landed; llm-route re-exports the face so
 * every importer's specifier is unchanged.
 *
 * Every route constructor also yields a PRODUCER RECORD — the one
 * structure that answers "which producer is bound to the llm face, and
 * why" without archaeology (the mock census's three confirmed gaps share
 * that pathology). Keyed by the boot context like llm-route's seam
 * registries (same discipline, same measured reason: ctx.get('llm')
 * hands out a fresh wrapper per access). The record NEVER carries the
 * credential or the key material — producer identity and reason only.
 */
// BYOK_REF inlined to keep this module acyclic (llm-route imports it;
// it must not import llm-route back — the qjs loader resolves the cycle
// differently than Node and the export vanishes).
const BYOK_REF = 'dsh.llm/byok-route';

const producerRegistry = new Map();

/** The record a route constructs: id (stable per boot), face, kind (the
 * route kinds that already exist), the serving facts, and reason — WHY this
 * producer is bound (the mock census's missing answer, one field). */
export const producerRecord = (route, reason) => ({
  id: route.kind === 'staged' ? 'staged:default'
    : route.kind === 'byok' ? `byok:${BYOK_REF}`
    : route.kind === 'mock' ? 'mock:loopback'
    : `pi-ai:${route.provider}`,
  face: 'llm',
  kind: route.kind,
  provider: route.provider,
  model: route.model,
  userEndpoint: route.userEndpoint === true,
  reason,
});

/** The event sink one boot registers (proposal §3: the bound event fires at
 * EVERY bind site — boot, rebind, restore, the gate mount — and llm-route's
 * seam sites hold no onEvent of their own; the boot site hands one in). */
const producerSinks = new Map();

export const registerProducerSink = (ctx, emit) => {
  producerSinks.set(ctx, emit);
};

/** Register (or re-register on rebind/restore) the boot's live producer and
 * emit llm.producer.bound through the boot's sink. Returns the record. */
export const registerProducer = (ctx, route, reason) => {
  const record = producerRecord(route, reason);
  producerRegistry.set(ctx, record);
  producerSinks.get(ctx)?.(record);
  return record;
};

/** The live record for a boot context (undefined before the first bind —
 * a face no producer ever registered, itself an honest answer). */
export const producerOf = (ctx) => producerRegistry.get(ctx);


// ---- the reason policy ------------------------------------------------------
// Which leg of the fallback chain selected the producer — the census
// answer riding the resolver. The chain itself is unchanged; the reason
// names the POLICY, so the registry row explains itself.

export const reasonOfRoute = (route) =>
  route.kind === 'staged' ? 'staged-config'
  : route.kind === 'byok' ? 'byok-credential'
  : route.kind === 'mock' ? 'no-credential-fallback'
  : 'gate:piaiSection';
