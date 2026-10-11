// dsh:logging-exempt (shim layer; transport face, no logging surface)
/**
 * anthropic-client — the composed `@anthropic-ai/sdk` face the vendored
 * @earendil-works/pi-ai lazy api module dynamic-imports at LIVE-TRANSPORT
 * build time (`import Anthropic from "@anthropic-ai/sdk"` in dist/api/
 * anthropic-messages.js). The openai-client.js precedent: no vendored
 * tarball (the heavy SDK was deliberately left unfetched — npm-bridges
 * note), so the face is COMPOSED over the runtime's own fetch — the
 * in-process loopback serves in-test servers, the fetch-gateway bridge
 * (installed by the gated pi-ai mount) carries declared user endpoints,
 * and anything else keeps fetch's fail-loud network rejection.
 *
 * Only the surface the pinned pi-ai 0.85.1 dist touches is implemented
 * (measured against the vendored dist):
 *   - `new Anthropic({ apiKey, authToken, baseURL, dangerouslyAllowBrowser,
 *     fetch, defaultHeaders })` — apiKey → the `x-api-key` header,
 *     authToken → `authorization: Bearer` (the SDK's two auth spellings;
 *     pi-ai passes exactly one non-null).
 *   - `client.beta.messages.create(params, {signal, timeout, maxRetries})`
 *     → `.asResponse()` → `{ status, headers, body }` — headers iterates
 *     `entries()` (headersToRecord), body is the RAW SSE byte stream
 *     (iterateSseMessages getReader()s and decodes `event:`/`data:` lines).
 *   - `params.betas` rides the `anthropic-beta` header (the beta namespace's
 *     wire spelling), never the JSON body.
 *   - non-2xx → throws with the SDK's error-field shapes the suite probes:
 *     `.status` (number) + `.error` (parsed body) + `.message`
 *     (the openai-client extractStatus/extractBody order).
 * `timeout`/`maxRetries` are accepted and inert (the runtime keeps no
 * wall-clock seam and pi-ai passes `maxRetries: 0` expecting NO sdk retry).
 */

/** The wire path and protocol version the beta messages namespace speaks. */
const MESSAGES_PATH = '/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

/** One wire request: the injected (or global) fetch, the SDK's header order
 * (auth first, caller defaultHeaders LAST so profile headers win — the
 * openai-client precedent), and the non-2xx → status/error/message throw. */
async function wireRequest(client, params, options) {
  const doFetch = client.fetchImpl();
  const { betas, ...body } = params ?? {};
  const headers = {
    ...(client.authToken !== undefined && client.authToken !== null
      ? { authorization: `Bearer ${client.authToken}` }
      : { 'x-api-key': String(client.apiKey ?? '') }),
    'anthropic-version': ANTHROPIC_VERSION,
    'content-type': 'application/json',
    'accept': params?.stream === true ? 'text/event-stream' : 'application/json',
    ...(Array.isArray(betas) && betas.length > 0
      ? { 'anthropic-beta': betas.join(',') }
      : {}),
    ...client.defaultHeaders,
  };
  const response = await doFetch(`${client.baseURL}${MESSAGES_PATH}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    ...(options?.signal ? { signal: options.signal } : {}),
  });
  if (!response.ok) {
    const raw = await response.text();
    let parsed;
    try { parsed = JSON.parse(raw); } catch { parsed = undefined; }
    const bodyMessage = parsed?.error?.message;
    const error = new Error(typeof bodyMessage === 'string' && bodyMessage.length > 0
      ? bodyMessage
      : `${response.status} ${response.statusText ?? ''}`.trim());
    error.status = response.status;
    error.error = parsed;
    throw error;
  }
  const headersRecord = {};
  for (const [name, value] of response.headers.entries()) headersRecord[name] = String(value);
  return { response, headersRecord };
}

/** The create() return: `.asResponse()` resolves the APIResponse face pi-ai
 * consumes — `{ status, headers (entries()-iterable), body (the raw SSE byte
 * stream) }`; the thenable face carries the same (pi-ai never awaits create()
 * directly — it always goes through asResponse()). */
function apiPromise(settled) {
  const withResponse = () => settled;
  return {
    asResponse: withResponse,
    then: (onFulfilled, onRejected) => settled.then(onFulfilled, onRejected),
    catch: (onRejected) => settled.catch(onRejected),
    finally: (onFinally) => settled.finally(onFinally),
  };
}

export class Anthropic {
  constructor(options = {}) {
    this.apiKey = options.apiKey;
    this.authToken = options.authToken;
    this.baseURL = String(options.baseURL ?? 'https://api.anthropic.com').replace(/\/+$/, '');
    this.defaultHeaders = options.defaultHeaders ?? {};
    // The injected fetch is read at CALL time (the suite may stub the global
    // per test); the loopback dispatch / gateway bridge is the served transport.
    this.fetchImpl = () => options.fetch ?? globalThis.fetch;
    this.messages = this.#namespace();
    this.beta = { messages: this.#namespace() };
  }
  #namespace() {
    const client = this;
    return {
      create: (params, options) => apiPromise((async () => {
        const { response, headersRecord } = await wireRequest(client, params, options);
        return {
          status: response.status,
          statusText: response.statusText,
          headers: { entries: () => Object.entries(headersRecord) },
          body: response.body,
        };
      })()),
    };
  }
}

export default Anthropic;
