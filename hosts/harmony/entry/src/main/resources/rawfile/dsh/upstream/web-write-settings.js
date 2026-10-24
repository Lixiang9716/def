// dsh:logging-exempt (adapter over vendored code; logging stays in the caller)
/**
 * upstream/web-write-settings.js — the settings legs of the WRITE SURFACE
 * (decision D9, W-RPC leg): the settings-controller surface the official
 * page drives at boot and in its onboarding flow, answered by the REAL
 * vendored settings service. The mobile `ui-onboarding` namespace (the
 * product-wide GUI onboarding facts the page persists) is registered with a
 * REAL schemastery schema, mirroring the desktop web composition's host
 * rows; writes commit to the volatile in-memory provider (the durable
 * settings file is the staged gap). Failures stay loud: a missing provider
 * is a RemoteError, not a silent empty answer.
 */
import Schema from '@deepseek-ai/schemastery';
import { installEgressBridgeForSection, PIAI_SECTION_NS } from 'upstream/llm-piai-mount.js';
import { tryRebindFromSavedState } from './web-write-onboarding.js';
import { readStore as readCredentialStore, deriveKeyRef } from './web-write-llm.js';
export { readCredentialStore };

/** One registered namespace → the wire namespaceView (the controller's
 * own descriptor shape: ns/schema/value/base?/user?/applies/secrets/
 * revision). */
export const wireNamespaceView = (d) => ({
  ns: String(d.ns),
  schema: d.schema,
  value: d.value,
  ...(d.base === undefined ? {} : { base: d.base }),
  ...(d.user === undefined ? {} : { user: d.user }),
  applies: d.applies,
  secrets: (d.secrets ?? []).map((sec) => ({ path: [...sec.path], set: sec.set })),
  revision: d.revision,
});

/** The settings namespace one provider route's configuration lives under
 * (upstream convention: provider `deepseek-official` → `llm-deepseek`). */
export const providerSettingsNs = (provider) => `llm-${String(provider)}`;

/** The models 设置页 renders a provider row only when its settingsNs
 * resolves in the settings mirror; an unregistered route is invisible. The
 * MOBILE COMPOSITION therefore registers the configured route's namespace
 * with the LIVE ROUTE as its base layer — the truthful topology (one profile
 * `default`, backed by whatever the route currently is: the staged
 * credential, or the BYOK credential a save rebound — base-owned so the page
 * cannot offer 移除 on a route the host staged). The user layer stays free
 * for the page's writes. A route swap (BYOK save/clear) lands under a NEW
 * provider name, so the guard top-ups the registration per provider as the
 * live route's provider changes; the superseded namespace stays registered
 * (the settings service has no unregister) but names no directory row
 * anymore — the directory handle swap (llm-route.js) is what delists it. */
const registerProviderNamespace = (settings, llmRoute) => {
  settings.register(providerSettingsNs(llmRoute.provider), Schema.object({
    providers: Schema.object({
      default: Schema.object({
        baseURL: Schema.string(),
        model: Schema.string(),
        apiKeyEnv: Schema.string(),
      }),
    }),
  }), {
    // The honest producer face (producer-registry v1, census gap #3 leg b):
    // a mock route pre-fills NOTHING — the edit form must not present the
    // scripted loopback as a user-configurable endpoint. Staged/byok routes
    // keep their facts as the base layer (the page edits over them).
    base: llmRoute.kind === 'mock' ? { providers: {} } : { providers: { default: {
      baseURL: llmRoute.baseURL,
      model: llmRoute.model,
      apiKeyEnv: deriveKeyRef(llmRoute.provider),
    } } },
  });
};

/** Memoized registration of the namespaces the OFFICIAL web composition
 * registers host side. The acknowledgement write lands only after this
 * resolves, so every settings call awaits it first. The provider-route
 * namespace re-checks per call: a BYOK save/clear swaps the live route's
 * provider, and the FIRST settings call after that registers the new
 * provider's namespace with the route's current facts as its base layer. */
export const makeNamespaceGuard = (ctx, llmRoute) => {
  const registered = new Set();
  let ready = null;
  // DIRECT service calls, not ctx.plugin: a plugin apply re-fires every
  // injected callback on the context — the pi-ai plugin's
  // ctx.inject(['settings']) included — and its installSection then
  // re-registers 'llm-pi-ai' over a live registration ('already
  // registered', measured live 2026-10-24). The namespaces this guard owns
  // land on the MOUNTED settings service; the service is present whenever
  // this guard is constructed (web-write.js builds it after boot).
  const register = async () => {
    const settings = ctx.get('settings');
    if (settings === undefined) return;
    if (!registered.has('ui-onboarding')) {
      settings.register('ui-onboarding',
        Schema.object({ welcomeNoticeVersion: Schema.string() }));
      registered.add('ui-onboarding');
    }
    if (llmRoute !== undefined && !registered.has(llmRoute.provider)) {
      registered.add(llmRoute.provider);
      registerProviderNamespace(settings, llmRoute);
    }
  };
  return () => {
    ready ??= register();
    return ready.then(() => {
      if (ctx.get('settings') === undefined || llmRoute === undefined) return;
      // The pi-ai section's namespace is registered by the PLUGIN's own
      // apply (ctx.inject(['settings'])) — a host-side register here is the
      // 'already registered' collision (measured live on the models-byok-add
      // leg, 2026-10-24: the compose rebind remounts pi-ai, then this guard
      // fired for the swapped provider... whose ns IS llm-pi-ai).
      if (llmRoute.provider === 'mock' || llmRoute.kind === 'mock') {
        // mock routes never rebind, but a compose-completed byok route can
        // hand a provider named like anything — the skip condition is the
        // SECTION namespace itself, not the provider name.
      }
      if (llmRoute.kind === 'mock') return; // the mock face: plugin/ns absent
      if (registered.has(llmRoute.provider)) return;
      registered.add(llmRoute.provider);
      registerProviderNamespace(ctx.get('settings'), llmRoute);
    });
  };
};

/** The REAL provider describe, mapped through the upstream namespaceView:
 * writable/hasDocument report the provider truth (in-memory: writable, no
 * document) and namespaces list every registered section. */
export const makeDescribeSettings = (ctx, ensureNamespaces) => async () => {
  await ensureNamespaces();
  const settings = demandSettings(ctx);
  const namespaces = settings.describe({ redactSecrets: true })
    .map(wireNamespaceView);
  return {
    writable: settings.writable === true,
    hasDocument: settings.documentPath !== undefined,
    namespaces,
  };
};

/** One claimed settings-write endpoint (update/mutate): run the vendored
 * write, then answer with the namespace's wire view. A COMMITTED write to the
 * pi-ai section replaces the plugin's provider rows (its section watcher
 * re-registers the routes), so the fetch→gateway egress bridge re-arms
 * against the NEW row set before the view is answered — the same seam the
 * boot mount and the byok rebind install; the page's section write is the
 * third path a declared non-loopback row arrives by. The hook runs only
 * after `run` resolved (a rejected write never arms anything) and stays
 * uncaught: a row that cannot bridge fails the write loud (rule 5). */
/** The update/mutate pair with the Gap#2 compose tail (routeView +
 * credential store): web-write.js spreads this instead of building the two
 * rows inline. */
export const makeSettingsWriteHandlers = (ctx, deps, ensureNamespaces) => ({
  'settings/update': makeSettingsWrite(ctx, ensureNamespaces,
    (settings, args) => settings.update(
      String(args.ns), args.patch, args.expectedRevision),
    deps.llmRoute, readCredentialStore),
  'settings/mutate': makeSettingsWrite(ctx, ensureNamespaces,
    (settings, args) => settings.mutate(
      String(args.ns), args.ops, args.expectedRevision),
    deps.llmRoute, readCredentialStore),
});

export const makeSettingsWrite = (ctx, ensureNamespaces, run, routeView, readCredentialStore) => async (args) => {
  await ensureNamespaces();
  const settings = demandSettings(ctx);
  await run(settings, args);
  if (String(args.ns) === PIAI_SECTION_NS) await installEgressBridgeForSection(settings);
  // Gap#2: a committed write on a provider route's namespace is the PROFILE
  // half of the Models-page save — with the key already stored this
  // completes the compose and rebinds (either save order converges here).
  if (/^llm-[a-z0-9-]+$/.test(String(args.ns)) && String(args.ns) !== PIAI_SECTION_NS) {
    await tryRebindFromSavedState(ctx, {
      settings, store: await readCredentialStore(), routeView,
    });
  }
  const descriptor = settings.describe({ redactSecrets: true })
    .find((d) => d.ns === String(args.ns));
  return wireNamespaceView(descriptor);
};

/** The mounted settings provider, or a loud RemoteError (the literal triple
 * keeps this module free of the web-write import cycle; errorOf maps it). */
const demandSettings = (ctx) => {
  const settings = ctx.get('settings');
  if (settings === undefined) {
    throw { remote: true, code: 'gateway/unavailable',
      message: 'no settings provider is mounted', details: {} };
  }
  return settings;
};
