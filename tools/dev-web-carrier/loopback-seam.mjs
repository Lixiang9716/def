// dsh:logging-exempt (node-side driver: console IS the product)
/**
 * loopback-seam.mjs — the recording seat's loopback httpFetch staging:
 * one REAL http.request per gateway httpFetch call, the response relayed
 * back as http.body/http.end events keyed by the bodyId.
 *
 * The relay starts only in a FRESH macrotask after the resolveStage: the
 * gateway registers its stream-map entry in the post-await microtasks
 * (two ticks deep through the seam wrapper), but a loopback mock delivers
 * headers + chunks in ONE I/O cycle — an immediate relay beats the
 * registration and every event drops (the read-idle watchdog then aborts
 * a fully streamed response after 120s of silence). Bytes arriving
 * meanwhile buffer in the paused socket until the relay pulls.
 */
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);

export const stageLoopbackHttpFetch = (seams, baseURL) => {
  const { request: httpRequest } = require_('node:http');
  let bodySeq = 0;
  const prefix = `${baseURL.split('/').slice(0, 3).join('/')}/`;
  seams.stagedHttp.set(prefix, (args) => new Promise((resolveStage, rejectStage) => {
    const body = args.bodyB64 !== undefined ? Buffer.from(args.bodyB64, 'base64') : undefined;
    const req = httpRequest(args.url, { method: args.method ?? 'POST', headers: args.headers ?? {} }, (res) => {
      const bodyId = `body:mock-${++bodySeq}`;
      setImmediate(() => {
        resolveStage({ status: res.statusCode, headers: res.headers, bodyId });
        setTimeout(() => {
          void (async () => {
            try {
              for await (const chunk of res) {
                globalThis.__dshGatewayOnEvent?.(JSON.stringify({ callId: bodyId, event: 'http.body', chunkB64: chunk.toString('base64') }));
              }
              globalThis.__dshGatewayOnEvent?.(JSON.stringify({ callId: bodyId, event: 'http.end' }));
            } catch (error) {
              globalThis.__dshGatewayOnEvent?.(JSON.stringify({ callId: bodyId, event: 'http.error', code: 'io', message: error?.message ?? 'response failed' }));
            }
          })();
        }, 0);
      });
    });
    req.on('error', (error) => rejectStage(Object.assign(error, { code: 'io' })));
    if (body !== undefined) req.write(body);
    req.end();
  }));
};
