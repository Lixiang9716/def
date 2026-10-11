// dsh:logging-exempt (transport seam: honesty rides the mount's onEvent, never console)
/**
 * upstream/fetch-gateway-bridge.js — the ONE gated upgrade of
 * `globalThis.fetch` from fail-loud+loopback to fail-loud+loopback+USER
 * ENDPOINT: a non-loopback http(s) dial crosses the frozen gateway
 * `httpFetch` primitive (contract v1.0.0, D5) and comes back as a real
 * web-fetch-values Response.
 *
 * WHY THIS EXISTS: pi-ai's protocol implementations dial `globalThis.fetch`
 * (upstream/llm-piai-mount.js's transport-honesty note). The runtime installs
 * that global as the fail-loud + in-process-loopback face
 * (upstream/shims/web-fetch-values.js), so only loopback servers could ever
 * stream the library's real wire layer. The BYOK surface (llm-route.js)
 * serves user endpoints whose flavors the gateway adapter cannot speak —
 * anthropic-messages — through the pi-ai mount, and those dials need a real
 * network face. THIS module is that face, installed ONLY by the gated mount
 * (mountPiAiProviders) when at least one mounted route declares a
 * non-loopback baseURL; an absent gate never even imports this file (the
 * dynamic-import discipline llm-piai-mount.js already keeps).
 *
 * THE DISPATCH ORDER IS FROZEN — the wrapped fetch consults the PREVIOUS
 * global first and takes over ONLY on its loud rejection:
 *   (1) an installed undici proxy policy routes (dispatchViaDispatcher),
 *   (2) an in-process loopback server serves (dispatchLoopback),
 *   (3) NEW: a non-loopback http(s) URL dials the gateway httpFetch,
 *   (4) else the original loud TypeError propagates byte-for-byte.
 * A loopback-matching host (127.x/::1, node-http-loopback's address rule)
 * NEVER reaches the gateway: loopback stays the E2E determinism boundary.
 *
 * TIMING + STREAMING (D8): the promise settles on response HEADERS (the
 * gateway call result's {status, headers, bodyId}), and the body is a
 * ReadableStream fed chunk-by-chunk from httpFetch's AsyncIterable as the
 * gateway delivers it — never a blocking whole-result. Abort maps onto the loopback convention:
 * a caller signal wires `abort()` on the in-flight response and surfaces the
 * DOMException-shaped AbortError ('This operation was aborted'); a
 * GatewayError 'cancelled' on the body maps to that same AbortError when the
 * caller's signal fired, and stays a transport error otherwise.
 *
 * NO POLICY IS INVENTED here: no timeout, no retry, no redirect follow —
 * those are host defaults v0 does not expose (contract/primitives.md). The
 * honest install label (hostnames only — never a path, never key material)
 * is emitted by the MOUNT through its onEvent; this module stays silent.
 *
 * HONEST SCOPE (the review-round-1 note): the upgrade is PROCESS-wide —
 * once installed, every non-loopback http(s) dial through globalThis.fetch
 * crosses the gateway, not only the routes the mount declared (globalThis
 * is a process global; there is no per-caller fetch). The mount's gate is
 * what makes that honest: every route it mounts is either provably loopback
 * or a DECLARED user endpoint, and the bridge never installs unless such a
 * route exists. `hosts` in the install call is the DECLARED LABEL SET for
 * the honesty event, not a dial firewall.
 *
 * DEFAULT-OFF: nothing in this file runs unless the mount calls
 * installFetchGatewayBridge — a boot without `options.llm.piaiProviders`
 * (or with loopback-only routes) keeps today's fetch byte-identical.
 */
import { httpFetch } from '../gateway.js';

/** The loud rejection the un-bridged fetch faces (web-fetch-values.js) — the
 * exact string is the seam marker: taking over on ANY other rejection would
 * swallow real transport errors. */
const LOUD_NO_NETWORK =
  'fetch: the dsh runtime has no network surface — the gateway owns the network seam (httpFetch)';

/** node-http-loopback's address rule (mirrored, not imported — the shims
 * layer stays import-clean of upstream; this module reads it as the SAME
 * boundary the in-process registry serves). `localhost` is deliberately NOT
 * in the set: a named host is a routing decision a user endpoint may make. */
const isLoopbackHostname = (hostname) =>
  hostname === '::1' || hostname === '127.0.0.1' || hostname.startsWith('127.');

/** Module state: the bridged face installs ONCE per process. */
let bridge = undefined;

/** The input's target href, when the caller named one (string, URL, or a
 * Request-like carrying .url). Anything else keeps the plain fetch path. */
const targetHref = (input) => {
  if (typeof input === 'string') return input;
  if (typeof URL === 'function' && input instanceof URL) return input.href;
  if (input !== null && typeof input === 'object' && typeof input.url === 'string') return input.url;
  return undefined;
};

/** The loopback AbortError shape (node-http-loopback-dispatch's own). */
const abortError = () => {
  const error = new (globalThis.DOMException ?? Error)('This operation was aborted');
  error.name = 'AbortError';
  return error;
};

/** init.headers → a plain Record<string,string> (the gateway primitive's
 * HttpFetchInit.headers shape): a Headers instance via its entries, a pair
 * iterable verbatim, a plain object copied. */
const headersRecord = (init) => {
  const headers = init?.headers;
  if (headers === undefined || headers === null) return {};
  if (typeof globalThis.Headers === 'function' && headers instanceof globalThis.Headers) {
    const record = {};
    for (const [name, value] of headers.entries()) record[name] = value;
    return record;
  }
  if (typeof headers === 'object' && Symbol.iterator in Object(headers)) {
    const record = {};
    for (const pair of headers) record[pair[0]] = pair[1];
    return record;
  }
  return { ...headers };
};

/** init.body → the bytes the gateway primitive carries (it base64-encodes at
 * the bridge seam). Strings encode; typed-array views view; a streamable
 * body (Request-face streams) drains — a request body is small JSON on every
 * served path, and the primitive has no chunked upload half. */
const bodyBytes = async (body) => {
  if (body === undefined || body === null) return undefined;
  if (typeof body === 'string') return new globalThis.TextEncoder().encode(body);
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(body)) {
    return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  }
  if (typeof body === 'object' && (typeof body.getReader === 'function'
    || typeof body[Symbol.asyncIterator] === 'function')) {
    const chunks = [];
    let total = 0;
    for await (const chunk of body) { chunks.push(chunk); total += chunk.length; }
    const out = new Uint8Array(total);
    let at = 0;
    for (const chunk of chunks) { out.set(chunk, at); at += chunk.length; }
    return out;
  }
  throw new TypeError(`fetch-gateway-bridge: unsupported request body ${typeof body}`);
};

/** The response half of the gateway dial: settle on headers, stream the
 * body chunk-by-chunk, wire the caller's signal to the in-flight abort.
 * Returns the raw mapped pieces {status, headers, stream}. */
const gatewayResponse = (res, signal) => {
  if (signal?.aborted) { res.abort(); throw abortError(); }
  const onAbort = () => res.abort();
  if (signal !== undefined && typeof signal.addEventListener === 'function') {
    signal.addEventListener('abort', onAbort);
  }
  const iterator = res.body[Symbol.asyncIterator]();
  // The body source arms its drain at stream start: chunks enqueue as the
  // gateway delivers them, and the abort signal errors the stream (the
  // cancelled code maps to the AbortError the classifiers expect). This is
  // the SAME eager-once-armed model the shim Response body already applies
  // (web-fetch-values' streamBranch pump drains its source the moment the
  // body is first touched) — the bridge never buffers a WHOLE result, and a
  // slow consumer sees chunks queue, never a blocking whole-result (D8).
  // A pull-per-read source was measured (2026-10-12, the user-endpoint leg)
  // to deadlock behind the shim's #maybePull busy-guard: an arm landing
  // inside a pending pull is dropped, and a source that pends across events
  // never gets re-armed.
  const stream = new globalThis.ReadableStream({
    start: (controller) => {
      (async () => {
        for (;;) {
          const { value, done } = await iterator.next();
          if (done) { controller.close(); return; }
          controller.enqueue(value);
        }
      })().catch((error) => {
        if (signal?.aborted === true && error?.code === 'cancelled') controller.error(abortError());
        else controller.error(error);
      });
    },
    cancel: () => {
      if (signal !== undefined && typeof signal.removeEventListener === 'function') {
        signal.removeEventListener('abort', onAbort);
      }
      res.abort();
    },
  });
  return { status: res.status, headers: res.headers, stream };
};

/** One gateway dial mapped onto the fetch return shape: settle on headers,
 * stream the body, map the cancelled-code body failure to the AbortError
 * the abort classifiers expect (only when the caller actually aborted). */
const viaGateway = async (href, init) => {
  const method = String(init?.method ?? 'GET').toUpperCase();
  const signal = init?.signal;
  if (signal?.aborted) throw abortError();
  const headers = headersRecord(init);
  const body = (method === 'GET' || method === 'HEAD')
    ? undefined
    : await bodyBytes(init?.body);
  let res;
  try {
    res = await httpFetch(href, { method, headers, ...(body === undefined ? {} : { body }) });
  } catch (error) {
    if (signal?.aborted) throw abortError();
    throw error;
  }
  const mapped = gatewayResponse(res, signal);
  return new globalThis.Response(mapped.stream, {
    status: mapped.status,
    headers: mapped.headers,
    url: href,
  });
};

/** The bridged fetch: consult the previous global FIRST (the proxy-policy
 * and loopback branches live there); take over ONLY when it rejects with
 * the loud no-network TypeError AND the target is a non-loopback http(s)
 * URL. Every other rejection propagates untouched. */
const bridgedFetch = (baseFetch) => (input, init) => {
  const href = targetHref(input);
  if (typeof href === 'string' && /^https?:\/\//i.test(href)) {
    let hostname = '';
    try { hostname = new URL(href).hostname; } catch { /* keep the plain path */ }
    if (hostname !== '' && !isLoopbackHostname(hostname)) {
      return Promise.resolve(baseFetch(input, init)).catch((error) => {
        if (error instanceof TypeError && error.message === LOUD_NO_NETWORK) {
          return viaGateway(href, init);
        }
        throw error;
      });
    }
  }
  return baseFetch(input, init);
};

/**
 * Install the bridge over `globalThis.fetch`. Called ONLY by the gated
 * pi-ai mount after its routes land, and ONLY when at least one mounted
 * route declares a non-loopback baseURL. Idempotent: a second call unions
 * the hosts and returns the existing face (never a wrapped wrapper).
 * @param hosts - the non-loopback hostnames the mount is serving (the
 *   honesty fact the caller emits; hostname-only by the label discipline).
 * @returns {installed: true, hosts: the bridged hostname set}.
 */
export const installFetchGatewayBridge = ({ hosts = [] } = {}) => {
  if (bridge !== undefined) {
    for (const host of hosts) bridge.hosts.add(host);
    return { installed: true, hosts: [...bridge.hosts].sort() };
  }
  const baseFetch = globalThis.fetch;
  if (typeof baseFetch !== 'function') {
    throw new Error('fetch-gateway-bridge: no globalThis.fetch to wrap — the web-fetch value family must install first');
  }
  if (baseFetch.__dshFetchGatewayBridge === true) {
    throw new Error('fetch-gateway-bridge: the fetch global is already bridged by another instance');
  }
  const wrapped = bridgedFetch(baseFetch);
  wrapped.__dshFetchGatewayBridge = true;
  globalThis.fetch = wrapped;
  bridge = { baseFetch, hosts: new Set(hosts) };
  return { installed: true, hosts: [...bridge.hosts].sort() };
};

/** Whether the bridge is live (the mount's honesty event reads this). */
export const fetchGatewayBridgeInstalled = () => bridge !== undefined;

/** The bridged hostname set (hostname-only labels; sorted for determinism). */
export const fetchGatewayBridgeHosts = () =>
  bridge === undefined ? [] : [...bridge.hosts].sort();
