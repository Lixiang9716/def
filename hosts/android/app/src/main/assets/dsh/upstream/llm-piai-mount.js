// dsh:logging-exempt (mount seam: logging rides the wired logger)
/**
 * llm-piai-mount — the GATED multi-protocol LLM row (the llm-pi-ai leg).
 *
 * The vendored `@deepseek-ai/dsh-llm-pi-ai` plugin owns the multi-protocol
 * adapter family: one PiAiAdapter (an LlmAdapter subclass — the same base
 * contract the gateway adapter in upstream/llm-transport.js serves, so
 * providerInfo/listModels/resolveModel/prepareCall/stream all answer through
 * the same LlmRuntime registry) registered for every provider route the
 * caller's config names. Each route resolves its wire protocol
 * (anthropic-messages / openai-responses / openai-completions), endpoint,
 * model catalog, and credential reference from the plugin's own Config —
 * upstream's apply() shape, mounted verbatim. This module is ONLY the gate:
 * bootUpstream hands the config here when `options.llm.piaiProviders` is
 * present and never reaches this file when it is absent (the empty boot-list
 * precedent — every existing leg stays byte-identical).
 *
 * Transport honesty (the mobile seam, D6): pi-ai's protocol implementations
 * dial `globalThis.fetch`, which in this runtime is the fail-loud +
 * in-process-loopback face — the gateway `httpFetch` primitive is NOT
 * visible to the library. A route pointing at a loopback URL served by an
 * in-process `node:http`-shim server (the upstream suite's in-test-server
 * pattern) streams the library's REAL wire layer; any other target keeps
 * the loud fetch rejection. The `llm.piai-probe` scenario proves exactly
 * that face; a user-supplied non-loopback endpoint is the future BYOK
 * surface and stays out of scope here.
 */
/** Validate the gate payload shape: the plugin's providers dict, verbatim. */
const demandProvidersDict = (providers) => {
  if (typeof providers !== 'object' || providers === null || Array.isArray(providers)) {
    throw new Error(
      'llm-piai-mount: options.llm.piaiProviders must be the dsh-llm-pi-ai providers dict '
      + `(routes keyed by provider), got ${Array.isArray(providers) ? 'an array' : typeof providers}`,
    );
  }
};

/** Fail loud naming any configured route the registry did not pick up
 * (rule 5): a mounted plugin that registered nothing is a defect here, not
 * the plugin's dormant posture — the gate only mounts when routes are asked
 * for by name. */
const demandRoutesLanded = (runtime, providers) => {
  const configured = Object.keys(providers);
  if (configured.length === 0) {
    throw new Error('llm-piai-mount: an empty piaiProviders dict mounts nothing — omit the option instead');
  }
  const served = new Set(runtime.listProviders().map((info) => info.id));
  const missing = configured.filter((route) => !served.has(route));
  if (missing.length > 0) {
    throw new Error(`llm-piai-mount: provider route(s) ${missing.join(', ')} not registered after the dsh-llm-pi-ai mount`);
  }
  return configured;
};

/**
 * Mount the vendored dsh-llm-pi-ai plugin with the caller's provider routes.
 * @param ctx - the boot context (llm + settings already mounted; the plugin's
 *   `inject: ['llm']` and its settings-section install resolve against them).
 * @param providers - the plugin's Config.providers dict, verbatim (routes
 *   keyed by provider; each names api/baseURL/models/apiKeyEnv).
 * @param onEvent - the boot observability hook; emits `llm/piai` once, after
 *   the routes are proven registered (additive event type: absent option
 *   never fires it, existing manifests stay byte-identical).
 * @returns the configured route keys, in configuration order.
 */
export const mountPiAiProviders = async (ctx, providers, onEvent) => {
  demandProvidersDict(providers);
  // Dynamic import: the vendored lib links the pi-ai bridge faces at load,
  // and the bridges register when boot.js imports npm-bridges.js — before
  // any mount body runs. An absent gate never pays the load.
  const PiAi = await import('@deepseek-ai/dsh-llm-pi-ai');
  await ctx.plugin(PiAi, { providers });
  const runtime = ctx.get('llm');
  if (runtime === undefined) throw new Error('llm-piai-mount: the llm service vanished before the pi-ai mount');
  const routes = demandRoutesLanded(runtime, providers);
  onEvent('llm/piai', {
    plugin: '@deepseek-ai/dsh-llm-pi-ai',
    routes,
    protocols: [...new Set(routes.map((route) => providers[route]?.api).filter(Boolean))].sort(),
  });
  return routes;
};
