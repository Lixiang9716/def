// dsh:logging-exempt (node-side driver)
/**
 * session-serve.js — the SessionServe wire client: the endpoints and their
 * exact envelope shapes, PORTED from web-client-v2's main.js/composer.js
 * call sites (not rewritten, not invented):
 *
 *   session/list    → rpc('session/list')            (bare {} payload, as main.js)
 *   session/create  → {args:{request:{}}}            (main.js)
 *   session/prompt  → {args:{request:{requestId, sessionId, mode:'steer',
 *                      content:[{type:'text',text}], clientTimeZone}}}
 *                                                      (composer.js admitPrompt)
 *   session/cancel  → {args:{request:{sessionId}}}   (composer.js requestCancel)
 *   session/follow  → mux stream {args:{request:{address:{sessionId},
 *                      assistantStream:true}}}       (main.js openSession)
 *
 * The session family wraps its parameters at payload.args.request — the
 * three-layer envelope — while other namespaces (e.g. workspaceFiles) take
 * them at args level directly; this client speaks only the session family.
 */

import { makeRpc, isRemoteError } from './api.js';
import { Mux, muxDiag } from './mux.js';

const mintRequestId = () =>
  (globalThis.crypto?.randomUUID?.() ?? `req-${Date.now()}-${Math.random()}`);

/** `muxUrl` overrides the ws endpoint (transport-level, like baseUrl): the
 * dev carrier's lynx face carries its `?token=` in the URL because a Node
 * WebSocket sends no Cookie header — a token folded into `baseUrl` itself
 * would corrupt the fetch path (`${baseUrl}/api/…` would land the API
 * path inside the query string). Default stays the same-origin mux path. */
export const createSessionServe = ({ baseUrl, muxUrl } = {}) => {
  const rpc = makeRpc(baseUrl);
  const mux = new Mux(muxUrl ?? baseUrl.replace(/^http/, 'ws') + '/api/remote.mux');

  const list = () => rpc('session/list');
  const create = () => rpc('session/create', { args: { request: {} } });
  const prompt = (sessionId, text) => rpc('session/prompt', {
    args: {
      request: {
        requestId: mintRequestId(),
        sessionId,
        mode: 'steer',
        content: [{ type: 'text', text }],
        clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    },
  });
  const cancel = (sessionId) =>
    rpc('session/cancel', { args: { request: { sessionId } } });
  const follow = (sessionId, handlers) => mux.open('session/follow', {
    args: { request: { address: { sessionId }, assistantStream: true } },
  }, handlers);
  const cancelFollow = (streamId) => mux.cancel(streamId);

  return {
    connect: () => mux.connect(),
    close: () => mux.close(),
    onStatus: (cb) => mux.onStatus(cb),
    list, create, prompt, cancel, follow, cancelFollow,
    diag: muxDiag,
    isRemoteError,
  };
};
