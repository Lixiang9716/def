/**
 * upstream/mcp-http-transport.js — the MCP streamable-HTTP transport over the
 * frozen gateway `httpFetch` primitive: the VENDORED
 * `@modelcontextprotocol/client` StreamableHTTPClientTransport composed with
 * its `fetch` option injected. Zero upstream bytes change (D6), zero new
 * gateway primitives (D5), the response body streams chunk-by-chunk (D8).
 *
 * WHY THE VENDORED TRANSPORT WITH AN INJECTED FETCH, NOT A TRANSPORT OF OUR
 * OWN: streamable HTTP is not "POST JSON, read JSON". The vendored class owns
 * the protocol — the mcp-session-id round trip (captured off the initialize
 * response, replayed on every later dial, withheld on the handshake), the
 * mcp-protocol-version and body-derived mcp-method headers, the Accept
 * negotiation that lets a server answer either application/json or
 * text/event-stream per request, the SSE parse with resumption tokens
 * (last-event-id) and reconnection backoff, the 202 "accepted" path for
 * notifications, DELETE session termination, and the OAuth step-up flows.
 * Re-typing that in runtime/dsh/ would be a second, drifting implementation
 * of a spec the pinned package already tracks — the copy D6 forbids. The
 * class takes `opts.fetch` and dials `(this._fetch ?? fetch)(url, init)` for
 * every request (POST, the GET SSE stream, DELETE), so the ONE platform fact
 * — QuickJS has no sockets — is expressed at the one seam the upstream API
 * already exposes, and protocol correctness stays upstream's.
 *
 * WHY THE GATEWAY: the dsh runtime has exactly one network surface, the
 * gateway `httpFetch` (contract v1.0.0). `gatewayFetch` (upstream/
 * fetch-gateway-bridge.js) maps that primitive onto the fetch return shape —
 * settle on headers, a ReadableStream body pumped as the gateway delivers
 * chunks, caller-signal abort — so the transport's
 * `body.pipeThrough(new TextDecoderStream())` SSE reader runs over real wire
 * bytes with no second transport and no touch of `globalThis.fetch` (nothing
 * here installs a global; the installed bridge face stays the pi-ai mount's
 * gated decision). Loopback is NOT excluded on this entry: the E2E probe
 * dials its loopback mock over the REAL httpFetch.
 *
 * WHAT THIS MODULE DOES NOT DO: invent timeout, retry, or redirect policy
 * (the transport's own reconnection options and the host's httpFetch
 * defaults stand); import boot.js; register anything. The SDK is loaded by
 * DYNAMIC import: its bare specifier is served by the npm-bridges runtime
 * row (shims/npm-bridges-b.js), which exists only after that module body has
 * run — a static import would be linked before any body executes and fail
 * loud as unmapped (the discipline boot.js keeps for every bridged package).
 */
import { createLogger } from 'logger.js';
import { gatewayFetch } from './fetch-gateway-bridge.js';

const log = createLogger('dsh.mcp.http');

/** The vendored MCP client's module namespace (`@modelcontextprotocol/client`),
 * resolved through the npm-bridges row at call time (see the header). */
export const loadMcpSdk = async () => {
  log.debug('loadMcpSdk');
  return await import('@modelcontextprotocol/client');
};

/** The endpoint as a URL, http(s) only. The dsh URL shim is LENIENT for
 * scheme-less input (a bare path parses into path space instead of throwing
 * node's Invalid URL), so the scheme is demanded explicitly — a misspelled
 * endpoint fails here, at construction, not at the first dial. */
const endpointUrl = (url) => {
  log.debug('endpointUrl', { kind: typeof url });
  let target;
  try {
    target = new URL(url);
  } catch (error) {
    throw new TypeError(`mcp-http-transport: url is not a parseable URL, got ${String(url)} (${error?.message ?? error})`);
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw new TypeError(`mcp-http-transport: url must be an http(s) URL, got ${String(url)}`);
  }
  log.debug('endpointUrl parsed', { host: target.host });
  return target;
};

/** The observer's view of the target: the pathname of the URL dialed (string,
 * URL, or Request-like input); undefined when nothing parses — the observer
 * never fails a dial that already settled. */
const dialedPath = (input) => {
  log.debug('dialedPath', { kind: typeof input });
  if (typeof URL === 'function' && input instanceof URL) return input.pathname;
  const href = typeof input === 'string' ? input : input?.url;
  if (typeof href !== 'string') return undefined;
  try {
    return new URL(href).pathname;
  } catch {
    return undefined;
  }
};

/** Media essence of a content-type header value: the lowercase type/subtype
 * before any parameter — the same reading the vendored transport applies
 * before choosing its JSON or SSE branch. undefined when the header is absent
 * (Headers.get answers null). */
const mediaEssence = (contentType) => {
  log.debug('mediaEssence', { present: typeof contentType === 'string' });
  if (typeof contentType !== 'string') return undefined;
  return contentType.split(';')[0].trim().toLowerCase();
};

/** The JSON-RPC method a request body names, when the body is a JSON string
 * carrying one at the top level. A batch array, a non-string body, or a body
 * that does not parse yields undefined — the field is evidence, never a
 * gate. */
const rpcMethodOf = (body) => {
  log.debug('rpcMethodOf', { kind: typeof body });
  if (typeof body !== 'string') return undefined;
  try {
    const method = JSON.parse(body)?.method;
    return typeof method === 'string' ? method : undefined;
  } catch {
    return undefined;
  }
};

/** Wrap a fetch so every SETTLED response reports its wire facts to onWire,
 * synchronously, before the transport sees it: {method, path, status,
 * contentType, rpcMethod} — plain deterministic fields only (no header
 * values, no body, no key material), the scenario-log evidence an E2E
 * matrix asserts on. A rejected dial reports nothing and propagates
 * untouched; an observer that throws fails the dial (a broken observer is a
 * defect to surface, not to swallow). */
const observedFetch = (baseFetch, onWire) => {
  log.debug('observedFetch wrap');
  return async (input, init) => {
    const method = String(init?.method ?? 'GET').toUpperCase();
    log.debug('observedFetch dial', { method });
    const response = await baseFetch(input, init);
    onWire({
      method,
      path: dialedPath(input),
      status: response.status,
      contentType: mediaEssence(response.headers.get('content-type')),
      rpcMethod: rpcMethodOf(init?.body),
    });
    return response;
  };
};

/**
 * Build one streamable-HTTP MCP transport for `url` over the gateway.
 * @param url - the MCP endpoint (string or URL); must be http(s).
 * @param requestInit - the vendored option, handed over verbatim: the
 *   transport spreads it into every dial and merges its `headers` (an
 *   Authorization bearer, say) into the protocol headers.
 * @param onWire - optional observer of every settled response (see
 *   observedFetch). Absent = no observation: the fetch is handed over bare.
 * @param fetch - optional dial override (a test's scripted fetch); default
 *   gatewayFetch. Orthogonal to onWire — an override is observed too when
 *   onWire is given.
 * @returns the vendored StreamableHTTPClientTransport, not yet started
 *   (Client.connect() calls start()).
 */
export const createMcpHttpTransport = async ({ url, requestInit, onWire, fetch: fetchOverride } = {}) => {
  log.debug('createMcpHttpTransport', {
    observed: onWire !== undefined,
    overridden: fetchOverride !== undefined,
    requestInit: requestInit !== undefined,
  });
  if (onWire !== undefined && typeof onWire !== 'function') {
    throw new TypeError(`mcp-http-transport: onWire must be a function when given, got ${typeof onWire}`);
  }
  if (fetchOverride !== undefined && typeof fetchOverride !== 'function') {
    throw new TypeError(`mcp-http-transport: fetch must be a function when given, got ${typeof fetchOverride}`);
  }
  const target = endpointUrl(url);
  const baseFetch = fetchOverride ?? gatewayFetch;
  const fetchFn = onWire === undefined ? baseFetch : observedFetch(baseFetch, onWire);
  const sdk = await loadMcpSdk();
  return new sdk.StreamableHTTPClientTransport(target, { fetch: fetchFn, requestInit });
};
