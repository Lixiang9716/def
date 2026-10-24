// dsh:logging-exempt (adapter over vendored code; logging stays in the caller)
/**
 * upstream/web-write-onboarding.js — the BYOK onboarding legs of the
 * COVERAGE plane (2026-09-30): the first-run credential panel's wire, grown
 * ENTIRELY on existing mechanisms. No new gateway primitive: the credential
 * persists through the frozen keychainGet/keychainSet (contract v1.0.0 rows
 * 8-9), the connection test streams one minimal real chat-completions over
 * the frozen httpFetch (runtime/dsh/llm.js streamChat — the same transport
 * path a turn takes), and the route rebind is the vendored LlmRuntime's own
 * registry API through upstream/llm-route.js.
 *
 *   onboarding/status → {mode: 'byok'|'staged'|'mock', provider?, baseURL?,
 *                        model?} — the panel's detect leg. NEVER the key:
 *                        values do not cross the wire back (the credential
 *                        management plane's own rule, web-write-llm.js).
 *   onboarding/test   (mux stream) → one probe turn over the caller-given
 *                        {provider, baseURL, apiKey, model}; progress rides
 *                        mux.item events (open/delta/done), failures one
 *                        mux.error with the wire's own code + message. The
 *                        key lives in the args only — it is not logged and
 *                        not echoed.
 *   onboarding/save   → keychainSet(BYOK_REF, credential bytes) THEN the
 *                        live rebind (dispose boot adapter → register the
 *                        user's) THEN the surface's llmRoute mutation, so
 *                        NEW sessions route to the user's endpoint. A host
 *                        without a keychain fails loud (gateway/unavailable)
 *                        — the CLI's honest pre-2026-09-30 shape, never a
 *                        plaintext fallback.
 *   onboarding/clear  → the inverse (the B29 round, 2026-10-01): keychainSet
 *                        (BYOK_REF, null) — the frozen delete half — THEN
 *                        restoreBootRoute (dispose the byok adapter,
 *                        re-derive the boot route through the registered
 *                        factory) THEN the surface's llmRoute mutation back.
 *                        The #280-era stance ("an in-process un-rebind would
 *                        be a lie") named the SURFACE's route view, which
 *                        deliberately carries no credential facts; the leg
 *                        lives RUNTIME-side like save does, so the honest
 *                        shape is the installer handing the boot-route
 *                        factory to upstream/llm-route.js — no key crosses
 *                        the wire in either direction (the call takes NO
 *                        arguments, returns {}). A surface whose installer
 *                        registered no factory fails loud at the call
 *                        (restoreBootRoute throws; the save leg's own
 *                        fail-loud precedent), never a silent fake restore.
 */
import { keychainSet, httpFetch } from '../gateway.js';
import { streamChat } from '../llm.js';
import {
  BYOK_REF, BYOK_PROVIDERS, decodeCredential, encodeCredential,
  validateCredential, rebindLlmRoute, restoreBootRoute, deriveByokRef,
} from 'upstream/llm-route.js';

const badRequest = (message) => (
  { remote: true, code: 'gateway/bad-request', message, details: {} });

/** The wire error triple for an arbitrary thrown value. The web-write.js
 * errorOf does exactly this, but importing it here would close the module
 * cycle web-write → web-write-coverage → HERE → web-write — and the error
 * legs would touch an uninitialized binding (measured: an unhandled
 * rejection the engine reports as an empty error). Local copy, same shape. */
const wireOf = (error) => (
  error !== null && typeof error === 'object'
  && (error.remote === true || error.isDSHRemoteError === true)
    ? { code: error.code, message: error.message, details: error.details ?? {} }
    : {
      code: 'gateway/unavailable',
      message: error instanceof Error ? error.message : String(error),
      details: {},
    });

/** One status row: the keychain is the source of truth for 已配过 (a saved
 * credential outlives boots); the route kind answers for staged/mock. */
const makeStatusHandler = (llmRoute) => async () => {
  const credential = await decodeCredential();
  if (credential !== null) {
    return {
      mode: 'byok', provider: credential.provider,
      baseURL: credential.baseURL, model: credential.model,
    };
  }
  if (llmRoute.kind === 'staged') {
    return {
      mode: 'staged', provider: llmRoute.provider,
      baseURL: llmRoute.baseURL, model: llmRoute.model,
    };
  }
  return { mode: 'mock', provider: llmRoute.provider, model: llmRoute.model };
};

/** The Models-page save compose (Gap#2, the mock census's dead-end fix):
 * the official settings-models page persists a provider profile through
 * settings.mutate (ns 'llm-<provider>', the whole profile at
 * providers.<route>) and the key through credentials/set — two independent
 * wire calls in either order. After EITHER half commits, try to compose
 * the serving credential from the saved state: the section's first
 * baseURL-carrying row + the store's key under the row's apiKeyEnv (else
 * the derived ref). Incomplete (no profile yet, or no key yet) is the
 * page's honest unconfigured state — no rebind, no error. Complete-but-
 * invalid fails loud naming the field (rule 5: a saved state that can
 * never serve must not save silently). A complete compose persists through
 * the SAME keychain ref + rebind seam onboarding/save rides, so the
 * producer registry flips to byok and llm.producer.bound fires (the sink).
 * Idempotent: a re-compose of the same state rebinds the same route. */
export const tryRebindFromSavedState = async (ctx, { settings, store, routeView }) => {
  // DYNAMIC imports: this helper is called from web-write-llm's
  // credentials/set, and web-write-onboarding's static imports of
  // llm-route would close a load-time cycle the qjs loader resolves
  // differently than Node (BYOK_PROVIDERS reads as uninitialized). At call
  // time every module is fully initialized — the cycle is harmless then.
  const { rebindLlmRoute, deriveByokRef, encodeCredential, validateCredential } =
    await import('upstream/llm-route.js');
  if (settings === undefined) return false;
  const sections = settings.describe({ redactSecrets: true });
  for (const section of sections) {
    if (!/^llm-[a-z0-9-]+$/.test(String(section.ns))) continue;
    // The pi-ai section's rows are PLUGIN-served: its section watcher
    // re-registers the routes itself — a gateway rebind here would double-
    // register (and the dial would hit the wrong adapter). Compose only
    // the plain provider namespaces (gateway flavor).
    if (String(section.ns) === 'llm-pi-ai') continue;
    const provider = String(section.ns).slice('llm-'.length);
    for (const [routeKey, row] of Object.entries(section.value?.providers ?? {})) {
      const composed = await composeRow(ctx, provider, row, store, routeView);
      if (composed !== null) return composed === true;
    }
  }
  return false;
};

/** Compose ONE saved row into a serving credential (or null when the row
 * is an in-progress draft: no endpoint, no model, or no key yet). A
 * complete row persists through the keychain + rebind seam and returns
 * true. Throws loud on a complete-but-invalid row (rule 5). */
const composeRow = async (ctx, provider, row, store, routeView) => {
  if (typeof row?.baseURL !== 'string' || row.baseURL.length === 0) return null;
  const ref = typeof row.apiKeyEnv === 'string' && row.apiKeyEnv.length > 0
    ? row.apiKeyEnv : deriveByokRef(provider);
  const apiKey = store?.[ref];
  if (typeof apiKey !== 'string' || apiKey.length === 0) return null; // no key yet
  // Two saved row shapes exist: the gateway-flavor rows carry `model`
  // (one serving model); the pi-ai section rows carry `models` (a roster —
  // the compose serves its first entry, the page's own default).
  const model = typeof row.model === 'string' && row.model.length > 0
    ? row.model
    : Array.isArray(row.models) && row.models.length > 0
      ? row.models[0]?.id
      : undefined;
  if (typeof model !== 'string' || model.length === 0) return null;
  const credential = {
    baseURL: row.baseURL, apiKey, provider, model,
    ...(row.contextWindow === undefined
      ? (Array.isArray(row.models) && row.models[0]?.contextWindow !== undefined
        ? { contextWindow: row.models[0].contextWindow } : {})
      : { contextWindow: row.contextWindow }),
  };
  const invalid = validateCredential(credential);
  if (invalid !== null) {
    throw { remote: true, code: 'gateway/unavailable',
      message: `llm-${provider}: the saved profile cannot serve — ${invalid.error.field}: ${invalid.error.why}` };
  }
  await keychainSet(BYOK_REF, encodeCredential(credential));
  const route = await rebindLlmRoute(ctx, credential);
  if (routeView !== undefined) {
    routeView.provider = credential.provider;
    routeView.model = credential.model;
    routeView.baseURL = credential.baseURL;
    routeView.kind = 'byok';
    routeView.contextWindow = route.contextWindow;
  }
  return true;
};

/** The save leg: persist into the keychain, then rebind, then point the
 * surface's route (read at session/CREATE time) at the user's endpoint. The
 * credential's optional contextWindow rides the same payload end to end
 * (validated by validateCredential, resolved to a default in byokRoute when
 * the draft carried none); the surface's route view carries the RESOLVED
 * window the rebound adapter answers compaction with. */
const makeSaveHandler = (ctx, llmRoute) => async (args) => {
  const invalid = validateCredential(args);
  if (invalid !== null) {
    throw badRequest(`onboarding/save: ${invalid.error.field} — ${invalid.error.why}`);
  }
  await keychainSet(BYOK_REF, encodeCredential(args));
  const route = await rebindLlmRoute(ctx, args);
  llmRoute.provider = args.provider;
  llmRoute.model = args.model;
  llmRoute.baseURL = args.baseURL;
  llmRoute.kind = 'byok';
  llmRoute.contextWindow = route.contextWindow;
  return {};
};

/** The clear leg: delete the keychain ref (the frozen delete half), then
 * restore the boot route through the registered factory, then point the
 * surface's route back. Idempotent by construction — clearing an unset ref
 * deletes nothing and the restored route IS the boot route. The key never
 * crosses the wire: the call takes no arguments and the answer is {}.
 * Sessions created while the byok route was live keep their provider
 * binding (session/CREATE reads the route then); their next turn fails loud
 * on the disposed adapter — the same live-session semantics a save's
 * rebind has always had, in reverse. */
const makeClearHandler = (ctx, llmRoute) => async () => {
  await keychainSet(BYOK_REF, null);
  const route = await restoreBootRoute(ctx);
  llmRoute.provider = route.provider;
  llmRoute.model = route.model;
  llmRoute.baseURL = route.baseURL;
  llmRoute.kind = route.kind;
  llmRoute.contextWindow = route.contextWindow;
  return {};
};

/** The connection test: ONE minimal real request over the gateway transport
 * (streamChat), streamed as mux items. A 24-token cap keeps the probe cheap;
 * the mock server's script answers in full either way. */
const runProbe = async (post, msg, args) => {
  const invalid = validateCredential(args);
  if (invalid !== null) {
    const wire = badRequest(`onboarding/test: ${invalid.error.field} — ${invalid.error.why}`);
    post({ type: 'mux.error', streamId: msg.streamId,
      code: wire.code, message: wire.message, details: wire.details });
    return;
  }
  try {
    await streamChat({
      fetchImpl: httpFetch,
      baseUrl: args.baseURL, apiKey: args.apiKey, model: args.model,
      messages: [{ role: 'user', content: 'ping' }], maxTokens: 24,
      on: (event, fields) => {
        if (event === 'open') post({ type: 'mux.item', streamId: msg.streamId,
          value: { kind: 'probe.open', status: fields.status } });
        else if (event === 'delta') post({ type: 'mux.item', streamId: msg.streamId,
          value: { kind: 'probe.delta', index: fields.index } });
        else if (event === 'done') post({ type: 'mux.item', streamId: msg.streamId,
          value: { kind: 'probe.done', deltas: fields.deltas, chars: fields.chars } });
      },
    });
    post({ type: 'mux.end', streamId: msg.streamId });
  } catch (error) {
    const wire = wireOf(error);
    post({ type: 'mux.error', streamId: msg.streamId,
      code: wire.code, message: wire.message, details: wire.details });
  }
};

/** The coverage api rows this module owns (spread into buildCoverageApi). */
export const buildOnboardingApi = (ctx, deps) => ({
  'onboarding/status': makeStatusHandler(deps.llmRoute),
  'onboarding/save': makeSaveHandler(ctx, deps.llmRoute),
  'onboarding/clear': makeClearHandler(ctx, deps.llmRoute),
});

/** The onboarding mux stream open leg (one endpoint: onboarding/test). The
 * probe outlives the open call — items post as they happen; a late cancel
 * finds the stream already ended (the extra mux.end is benign, the page's
 * mux closes idempotently). */
export const openOnboardingStream = (ctx, deps, post, msg) => {
  if (msg.endpoint !== 'onboarding/test') return undefined;
  runProbe(post, msg, msg.payload?.args).catch((error) => {
    const wire = wireOf(error);
    post({ type: 'mux.error', streamId: msg.streamId,
      code: wire.code, message: wire.message, details: wire.details });
  });
  return { kind: 'attached', endpoint: msg.endpoint };
};

/** The provider presets the panel renders (re-exported so the wire facts
 * stay in one runtime home; the page mirrors them for inline UI). A LAZY
 * getter: the module sits in llm-route's load cycle (web-write-llm's
 * credentials/set compose imports this module), and a top-level read of
 * BYOK_PROVIDERS executes before llm-route finishes initializing — the qjs
 * loader surfaces that as 'not initialized'. Evaluated at access time, the
 * binding is always settled. */
let _providersCache;
export const onboardingProviders = () => (_providersCache ??= BYOK_PROVIDERS);
