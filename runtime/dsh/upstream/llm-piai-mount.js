// dsh:logging-exempt (mount seam: honesty events ride caller hooks; the
// byok rebind's bridge line logs through createLogger — no console here)
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
 * pattern) streams the library's REAL wire layer. A route declaring a
 * NON-LOOPBACK baseURL is a user-supplied endpoint: it must SAY SO with
 * `userEndpoint: true` on its row (the named-exception discipline
 * llm-transport.js keeps at its own construction gate), and only then does
 * this mount install the fetch→gateway bridge (upstream/
 * fetch-gateway-bridge.js) that carries such dials across the frozen
 * httpFetch seam. Every route that does not declare it keeps the loud fetch
 * rejection; the loopback E2E determinism boundary is untouched. The
 * `llm.piai-probe` scenario proves the loopback face; `llm.piai-user-endpoint`
 * proves the gate and the bridge.
 */
import { createLogger } from '../logger.js';

const log = createLogger('dsh.llm-piai-mount');

/** Validate the gate payload shape: the plugin's providers dict, verbatim. */
const demandProvidersDict = (providers) => {
  if (typeof providers !== 'object' || providers === null || Array.isArray(providers)) {
    throw new Error(
      'llm-piai-mount: options.llm.piaiProviders must be the dsh-llm-pi-ai providers dict '
      + `(routes keyed by provider), got ${Array.isArray(providers) ? 'an array' : typeof providers}`,
    );
  }
};

/** The loopback address rule (node-http-loopback's own set): a host in this
 * set is the in-process E2E boundary, never a user endpoint. */
const isLoopbackBaseURL = (baseURL) => {
  let hostname = '';
  try { hostname = new URL(baseURL).hostname; } catch { return false; }
  return hostname === '::1' || hostname === '127.0.0.1' || hostname.startsWith('127.');
};

/** Fail loud naming every route that dials past the loopback boundary
 * without declaring `userEndpoint: true` (rule 5 — the guard is named at the
 * call site or it does not exist). An EXPLICIT non-loopback baseURL is the
 * obvious case; a row with NO baseURL names no target we can prove loopback
 * either — its catalog default is a real endpoint (the vendored catalog
 * defaults to the provider's public origin), so it declares too or it does
 * not mount. Loopback rows pass unchanged — the probe's face stays
 * byte-identical. */
const demandUserEndpoints = (providers) => {
  const undeclared = Object.entries(providers)
    .filter(([, row]) => (typeof row?.baseURL !== 'string'
      || !isLoopbackBaseURL(row.baseURL)) && row.userEndpoint !== true)
    .map(([route]) => route);
  if (undeclared.length > 0) {
    throw new Error(`llm-piai-mount: route(s) ${undeclared.join(', ')} dial a non-loopback endpoint — `
      + 'declare userEndpoint: true on the provider row (a user-supplied endpoint is a named '
      + 'decision at the call site, never a quietly weakened guard)');
  }
};

/** The egress facts the bridge-install decision consumes: the non-loopback
 * hostnames the mounted routes explicitly name (the honesty label set —
 * hostnames only, never a path, never key material) and the declared routes
 * that name NO baseURL (their catalog default is non-loopback but not ours
 * to name). */
const egressFacts = (providers) => {
  const hosts = [...new Set(Object.values(providers)
    .filter((row) => typeof row?.baseURL === 'string' && !isLoopbackBaseURL(row.baseURL))
    .map((row) => new URL(row.baseURL).hostname))].sort();
  const catalogRoutes = Object.entries(providers)
    .filter(([, row]) => typeof row?.baseURL !== 'string' && row.userEndpoint === true)
    .map(([route]) => route).sort();
  return { hosts, catalogRoutes };
};

/** The bridge-install decision, shared by the boot mount AND the byok
 * rebind seam (a saved credential's declared non-loopback endpoint rides
 * the same seam as a boot-declared one). Installs when any mounted route is
 * egress-effective; the bridge module never loads for loopback-only sets.
 * NOTE the honest scope: the bridge upgrades the PROCESS fetch face for
 * non-loopback http(s) dials once installed (globalThis is process-global);
 * `hosts`/`catalogRoutes` are the DECLARED label set, not a dial firewall. */
const installEgressBridge = async (providers) => {
  const { hosts, catalogRoutes } = egressFacts(providers);
  if (hosts.length === 0 && catalogRoutes.length === 0) return null;
  const face = await import('upstream/fetch-gateway-bridge.js');
  const installed = face.installFetchGatewayBridge({ hosts });
  return { installed: installed.installed, hosts: installed.hosts,
    ...(catalogRoutes.length === 0 ? {} : { catalogRoutes }) };
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

/** Mount the vendored plugin instance (the dynamic import the absent gate
 * never pays) and hand the registry back. */
const mountPlugin = async (ctx, providers) => {
  // Dynamic import: the vendored lib links the pi-ai bridge faces at load,
  // and the bridges register when boot.js imports npm-bridges.js — before
  // any mount body runs. An absent gate never pays the load.
  const PiAi = await import('@deepseek-ai/dsh-llm-pi-ai');
  await ctx.plugin(PiAi, { providers });
  const runtime = ctx.get('llm');
  if (runtime === undefined) throw new Error('llm-piai-mount: the llm service vanished before the pi-ai mount');
  return runtime;
};

/** Demand the configured routes landed, yielding (bounded, fail loud) while
 * the plugin's registration settles — its section watcher replaces routes
 * across microtasks. */
const demandRoutesLandedSettled = async (runtime, providers) => {
  for (let guard = 0; ; guard++) {
    try {
      return demandRoutesLanded(runtime, providers);
    } catch (error) {
      if (guard >= 32
        || /an empty piaiProviders dict mounts nothing/.test(String(error?.message))) {
        throw error;
      }
      await Promise.resolve();
    }
  }
};

/**
 * Mount the vendored dsh-llm-pi-ai plugin with the caller's provider routes.
 * @param ctx - the boot context (llm + settings already mounted; the plugin's
 *   `inject: ['llm']` and its settings-section install resolve against them).
 * @param providers - the plugin's Config.providers dict, verbatim (routes
 *   keyed by provider; each names api/baseURL/models/apiKeyEnv; a route
 *   dialing past loopback MUST carry `userEndpoint: true`).
 * @param onEvent - the boot observability hook; emits `llm/piai` once, after
 *   the routes are proven registered, plus `llm/piai-bridge` when the fetch
 *   bridge installed (additive events: absent option never fires them,
 *   loopback-only configs leave `llm/piai` byte-identical).
 * @returns the configured route keys, in configuration order.
 */
export const mountPiAiProviders = async (ctx, providers, onEvent) => {
  demandProvidersDict(providers);
  demandUserEndpoints(providers);
  const runtime = await mountPlugin(ctx, providers);
  const routes = await demandRoutesLandedSettled(runtime, providers);
  // The gate file owns the honesty statement.
  const bridge = await installEgressBridge(providers);
  if (bridge !== null) onEvent('llm/piai-bridge', bridge);
  onEvent('llm/piai', {
    plugin: '@deepseek-ai/dsh-llm-pi-ai',
    routes,
    protocols: [...new Set(routes.map((route) => providers[route]?.api).filter(Boolean))].sort(),
  });
  return routes;
};

/** The vendored plugin's settings-section namespace (its `NS`) — the one
 * SUPPORTED update seam: the plugin watches the section and re-registers its
 * adapter routes on every committed write, so a BYOK rebind rides the
 * plugin's own reactivity instead of a second plugin instance. */
export const PIAI_SECTION_NS = 'llm-pi-ai';

/**
 * The BYOK rebind seam for a pi-ai-served route (upstream/llm-route.js calls
 * this when the saved credential's flavor needs the multi-protocol family).
 * Mounts the plugin once (an empty base layer — the byok rows ride the user
 * layer, so a clear replaces them away cleanly), then hands the route dict
 * to the plugin's own settings section; the plugin re-registers its routes.
 * @returns an async revert — the restore leg calls it to put the section
 *   back to the rows it named before this rebind (empty for a fresh mount,
 *   which unregisters the byok route through the same watcher).
 */
export const rebindPiAiProviders = async (ctx, providers) => {
  demandProvidersDict(providers);
  demandUserEndpoints(providers);
  const settings = ctx.get('settings');
  if (settings === undefined || typeof settings.replace !== 'function') {
    throw new Error('llm-piai-mount: the byok pi-ai rebind needs the settings service — '
      + `the "${PIAI_SECTION_NS}" section is the plugin's only supported update seam`);
  }
  const before = settings.get(PIAI_SECTION_NS)?.providers ?? {};
  const runtime = settings.get(PIAI_SECTION_NS) === undefined
    ? await mountPlugin(ctx, {}) // the base layer stays EMPTY: the byok rows ride the user layer, so a clear replaces them away
    : ctx.get('llm');
  if (runtime === undefined) {
    throw new Error('llm-piai-mount: the llm service vanished before the pi-ai rebind');
  }
  await replaceSection(settings, providers);
  await demandRoutesLandedSettled(runtime, providers);
  // A declared non-loopback byok endpoint rides the SAME bridge the boot mount
  // installs (the save path has no boot onEvent; the wired logger carries
  // the honesty line).
  const bridge = await installEgressBridge(providers);
  if (bridge !== null) log.info('llm/piai-bridge', bridge);
  return async () => {
    await replaceSection(settings, before);
  };
};

/** One committed section write (the user layer replaced wholesale — the
 * removal path a merge patch cannot express), retried across the plugin's
 * asynchronous section registration, fail loud on exhaustion. */
const replaceSection = async (settings, providers) => {
  for (let guard = 0; ; guard++) {
    try {
      await settings.replace(PIAI_SECTION_NS, { providers });
      return;
    } catch (error) {
      if (guard >= 32 || !/is not registered/.test(String(error?.message))) throw error;
      await Promise.resolve();
    }
  }
};
