// dsh:logging-exempt (node-side driver: console IS the product)
/**
 * onboarding-route.mjs — the BYOK onboarding endpoints of the dev-web-carrier
 * (POST /api/onboarding/status|save|clear): an in-memory port of the runtime's
 * coverage legs (runtime/dsh/upstream/web-write-onboarding.js over
 * upstream/llm-route.js) so the web-client-v2 BYOK panel boots in the local
 * loop instead of dying on gateway/unimplemented.
 *
 * The shapes are the REAL carrier's, field for field (the harmony seat's
 * recorded wire, hosts/harmony/artifacts/shell-turn/credential-wire.txt):
 *
 *   onboarding/status → {mode:'mock'|'byok', provider, model[, baseURL]}.
 *     No credential answers the runtime's mockRoute face (provider 'mock',
 *     model 'mock-1' — mode mock is what shows the panel); a saved one
 *     answers byok with provider/baseURL/model and NEVER the key (values do
 *     not cross the wire back — the credential-management plane's own rule;
 *     contextWindow is likewise resolved downstream, not echoed).
 *   onboarding/save   ← {provider, baseURL, apiKey, model, contextWindow?}.
 *     Validates with the runtime credential grammar (llm-route.js
 *     validateCredential, mirrored here — this tool never imports runtime
 *     code, the repo's stated mirroring convention), stores the credential
 *     in an in-memory mock keychain, answers {}. A violation answers
 *     gateway/bad-request, message `onboarding/save: <field> — <why>` (the
 *     wire leg's own message shape).
 *   onboarding/clear  ← no arguments. Deletes the ref, answers {}. Idempotent
 *     like the runtime leg (the B29 round): clearing an unset ref is fine.
 *
 * Honest boundary: the onboarding/test probe stream stays gateway/
 * unimplemented. A probe is one real chat-completions turn over the caller's
 * endpoint (streamChat) — a dev carrier that dials arbitrary URLs with
 * pasted keys would be a NEW surface, not a port of an existing one. The
 * panel renders the probe failure readably and keeps Save disabled (its own
 * gate), so the manage face and the status/save/clear round-trip stay fully
 * exercisable without it.
 *
 * Pure, exported face (the plugins-route.mjs precedent): createOnboarding +
 * onboardingOutcome; dev-carrier.mjs and next-mode.mjs mount it over their
 * own /api handlers. Nothing here reads the network, the clock, or the disk.
 */

/** The runtime credential grammar's bounds (upstream/llm-route.js mirrors —
 * the page's onboarding-core.js carries the same numbers). */
const PROVIDER_PATTERN = /^[a-z0-9][a-z0-9-]{0,40}$/;
const CONTEXT_WINDOW_MAX = 4000000;

/** The stored credential ref's grammar, @deepseek-ai/dsh-credentials
 * REF_PATTERN — a provider whose derived ref cannot spell is rejected (the
 * runtime leg's door, mirrored). */
const REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

const deriveByokRef = (provider) =>
  `${String(provider).toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`;

/** Pure validation for one credential {provider, baseURL, apiKey, model,
 * contextWindow?} → {error: {field, why}} | null. Field-for-field the
 * runtime's validateCredential: the same rejects, the same order, so a draft
 * the page accepts never bounces here either and a draft the runtime would
 * reject never lands in this keychain. */
export const validateCredential = (value) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { error: { field: 'credential', why: 'the credential is not an object' } };
  }
  const { provider, baseURL, apiKey, model, contextWindow } = value;
  if (typeof provider !== 'string' || !PROVIDER_PATTERN.test(provider)) {
    return { error: { field: 'provider', why: `provider must match ${PROVIDER_PATTERN}` } };
  }
  if (REF_PATTERN.test(deriveByokRef(provider)) === false) {
    return { error: { field: 'provider', why: 'provider has no expressible credential ref' } };
  }
  if (typeof baseURL !== 'string' || !/^https?:\/\/[^\s]+$/.test(baseURL)) {
    return { error: { field: 'baseURL', why: 'baseURL must be an http(s) URL' } };
  }
  if (typeof apiKey !== 'string' || apiKey.length === 0 || apiKey.length > 512) {
    return { error: { field: 'apiKey', why: 'apiKey must be 1..512 chars' } };
  }
  if (typeof model !== 'string' || model.length === 0 || model.length > 128) {
    return { error: { field: 'model', why: 'model must be 1..128 chars' } };
  }
  if (contextWindow !== undefined
    && (!Number.isSafeInteger(contextWindow) || contextWindow <= 0
      || contextWindow > CONTEXT_WINDOW_MAX)) {
    return {
      error: { field: 'contextWindow', why: `contextWindow must be an integer in 1..${CONTEXT_WINDOW_MAX}` },
    };
  }
  return null;
};

/** One fresh carrier state: the in-memory mock keychain, empty — the boot
 * route IS the runtime's mockRoute face (provider 'mock', model 'mock-1'). */
export const createOnboarding = () => ({ keychain: null });

/** The status answer: the keychain is the source of truth for 已配过 (the
 * runtime status leg's own rule). Never the key, never contextWindow. */
export const statusValue = (state) => {
  const saved = state.keychain;
  if (saved !== null) {
    return { mode: 'byok', provider: saved.provider, baseURL: saved.baseURL, model: saved.model };
  }
  return { mode: 'mock', provider: 'mock', model: 'mock-1' };
};

/** One onboarding endpoint → {ok, value}|{ok:false, error}|null. null means
 * "not an onboarding verb this module owns" — the caller falls through to
 * its own gateway/unimplemented envelope. */
export const onboardingOutcome = (state, endpoint, args) => {
  if (endpoint === 'onboarding/status') {
    return { ok: true, value: statusValue(state) };
  }
  if (endpoint === 'onboarding/save') {
    const invalid = validateCredential(args);
    if (invalid !== null) {
      return {
        ok: false,
        error: {
          code: 'gateway/bad-request',
          message: `onboarding/save: ${invalid.error.field} — ${invalid.error.why}`,
          details: {},
        },
      };
    }
    state.keychain = {
      provider: args.provider,
      baseURL: args.baseURL,
      apiKey: args.apiKey,
      model: args.model,
      // The optional window rides INTO the keychain only when carried (the
      // runtime encodeCredential shape); status never echoes it.
      ...(args.contextWindow === undefined ? {} : { contextWindow: args.contextWindow }),
    };
    return { ok: true, value: {} };
  }
  if (endpoint === 'onboarding/clear') {
    state.keychain = null;
    return { ok: true, value: {} };
  }
  return null;
};
