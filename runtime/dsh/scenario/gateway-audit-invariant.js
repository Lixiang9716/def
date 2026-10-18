// dsh:logging-exempt (dev script: the log stream is the product)
/**
 * Scenario `gateway.audit-invariant` — the audit-COMPLETENESS invariant leg
 * (contract/primitives.md §6: audit is mandatory and host-fixed; §7 #2 makes
 * the per-call records a conformance requirement). Every primitive of the
 * frozen v1.x table is driven through the states this seat can reach —
 * success, a contract-§3 rejection, and the honest `unavailable` — through
 * the RAW `__dshGatewayCall` seam exactly as run-security-gateway-fuzz.js
 * does, and each call is LEDGERED as one structured record as it settles.
 * The ledger is the call half of the pairing; the host's audit stream (the
 * `{"audit":...}` lines this seat prints beside the log) is the record half.
 * runtime/dsh/ci/run-gateway-audit-invariant.sh walks the two streams and
 * fails naming any call whose paired record is missing, any record with no
 * call, any order violation, and any payload bytes inside a record — an
 * unaudited call is a §6 violation even when the call itself succeeds, so
 * this leg MUST stay red until the host audits every call.
 *
 * The ledger's `audit` field names the record each call expects (the seat's
 * dotted socket-verb convention where one exists, the verbatim primitive
 * name everywhere else — both spellings are this repository's own audit
 * planes). Payload values carry the `audit-inv-canary` marker so the
 * runner's leak scan has something sharp to find: §6 forbids payload
 * contents in records, and a canary that shows up in the audit stream is
 * that violation caught red-handed.
 */
import { createLogger } from '../logger.js';

const SCENARIO = 'gateway.audit-invariant';
const log = createLogger('dsh.gateway.audit.invariant');
const emit = (event, fields = {}) => log.info('e2e', { scenario: SCENARIO, event, ...fields });
const fail = (reason) => {
  log.debug('scenario failed', { reason: String(reason).slice(0, 200) });
  emit('scenario.failed', { reason: String(reason).slice(0, 300) });
  globalThis.__dshComplete(false, String(reason).slice(0, 300));
};
const demand = (cond, reason) => {
  if (cond) return true;
  fail(reason);
  throw new Error(reason);
};

/** The ledger: one entry per gateway call, in exact call order — the pairing
 * input the runner walks against the host's audit stream. */
const ledger = [];

/** One RAW gateway call + its ledger entry, recorded as the call settles.
 * `audit` names the record this call must pair with (the invariant's
 * identity half); `state` is which of the three matrix states the cell
 * drives; `code` carries the observed §3 code of a rejection cell. */
const raw = async (cell, primitive, audit, state, args) => {
  log.debug('cell fire', { cell, primitive, state });
  const argsJson = typeof args === 'string' ? args : JSON.stringify(args);
  const out = await globalThis.__dshGatewayCall(primitive, argsJson).then(
    (res) => ({ ok: true, res }),
    (err) => ({ ok: false, code: err?.code ?? null }),
  );
  const code = state === 'rejected' ? out.code : null;
  ledger.push({ cell, primitive, audit, state, code });
  emit('audit.probe', { cell, primitive, audit, state, code });
  return out;
};

/** Poll the server side until the kernel connect completes and the accept
 * lands (the accept also emits the host-initiated socket.accept audit
 * record). Bounded spin on the synchronous host intrinsic — nothing else is
 * pending on the runtime queue here, and the deadline fails loud (rule 8).
 * The intrinsic returns the PARSED poll object ({kind, accepted|...}). */
const pollUntilAccepted = (serverId) => {
  log.debug('poll for accept', { serverId });
  for (let i = 0; i < 5000; i++) {
    const out = globalThis.__dshSocketPoll(serverId);
    if (out.kind === 'server' && out.accepted.length > 0) return out.accepted[0];
  }
  return null;
};

// Canary base64 literals (payload markers the runner's leak scan matches on;
// hard-coded so the scenario depends on no base64 helper). Roundtrips assert
// on exact base64 equality — the transport encoding IS the comparison.
const CANARY_B64 = 'YXVkaXQtaW52LWNhbmFyeS1ieXRlcw==';
const SOCKET_B64 = 'YXVkaXQtaW52LWNhbmFyeS1zb2NrZXQ=';

/** The success quadrant: one granted+ok cell per servable row, each verified
 * past its resolution where a roundtrip exists. */
const successCells = async (mockUrl) => {
  const probePath = 'audit-inv/canary-fswrite/probe.txt';
  await raw('fs.write.ok', 'fsWrite', 'fsWrite', 'ok',
    { scope: 'app', path: probePath, bytesB64: CANARY_B64 });
  const read = await raw('fs.read.ok', 'fsRead', 'fsRead', 'ok',
    { scope: 'app', path: probePath });
  demand(read.ok && read.res.bytesB64 === CANARY_B64, 'fs.read.ok roundtrip mismatch');
  const stat = await raw('fs.stat.ok', 'fsStat', 'fsStat', 'ok',
    { scope: 'app', path: probePath });
  demand(stat.ok && stat.res.kind === 'file', 'fs.stat.ok kind mismatch');
  await raw('fs.scope.persist.ok', 'fsScope.persist', 'fsScope.persist', 'ok', { scope: 'app' });
  await raw('fs.scope.resolve.ok', 'fsScope.resolve', 'fsScope.resolve', 'ok', { ref: 'bkm:tmp' });
  const removed = await raw('fs.remove.ok', 'fsRemove', 'fsRemove', 'ok',
    { scope: 'app', path: probePath, recursive: false, missing: 'error' });
  demand(removed.ok, 'fs.remove.ok failed');
  // The durable pair (v1.11.0): publish into a directory fsWrite's mkdirs
  // already created (publish never creates parents), read the artifact back
  // byte-exact — the roundtrip IS the durability claim — then both barrier
  // kinds on what really exists.
  const pubPath = 'audit-inv/canary-fswrite/published.txt';
  const published = await raw('fs.publish.ok', 'fsPublishAtomic', 'fsPublishAtomic', 'ok',
    { scope: 'app', path: pubPath, bytesB64: CANARY_B64 });
  demand(published.ok && published.res.written > 0, 'fs.publish.ok did not publish');
  const pubRead = await raw('fs.publish.readback.ok', 'fsRead', 'fsRead', 'ok',
    { scope: 'app', path: pubPath });
  demand(pubRead.ok && pubRead.res.bytesB64 === CANARY_B64, 'fs.publish.readback.ok mismatch');
  await raw('fs.sync.file.ok', 'fsSync', 'fsSync', 'ok',
    { scope: 'app', path: pubPath, kind: 'file' });
  await raw('fs.sync.dir.ok', 'fsSync', 'fsSync', 'ok',
    { scope: 'app', path: 'audit-inv/canary-fswrite', kind: 'dir' });
  await raw('keychain.set.ok', 'keychainSet', 'keychainSet', 'ok',
    { ref: 'audit-inv/canary-cred', secretB64: CANARY_B64 });
  const got = await raw('keychain.get.ok', 'keychainGet', 'keychainGet', 'ok',
    { ref: 'audit-inv/canary-cred' });
  demand(got.ok && got.res?.secretB64 === CANARY_B64, 'keychain.get.ok roundtrip mismatch');
  const armed = await raw('timer.schedule.ok', 'timerSchedule', 'timerSchedule', 'ok',
    { delayMs: 1, tag: 'audit-invariant' });
  demand(armed.ok && Number.isInteger(armed.res.timerId) && armed.res.timerId >= 1,
    'timer.schedule.ok did not arm');
  const cancelled = await raw('timer.cancel.ok', 'timerCancel', 'timerCancel', 'ok',
    { timerId: armed.res.timerId });
  demand(cancelled.ok && cancelled.res.cancelled === true, 'timer.cancel.ok mismatch');
  await raw('http.fetch.ok', 'httpFetch', 'httpFetch', 'ok',
    { url: `${mockUrl}/audit-inv-canary-http`, method: 'GET' });
};

/** The rejection quadrant: one contract-§3 code per reachable row, pinned to
 * this seat's observed vocabulary (a drift is a visible verdict change). */
const rejectionCells = async () => {
  const cells = [
    ['wasm.run.io', 'wasmRun',
      { scope: 'app', path: 'audit-inv/absent.wasm', func: 'f', input: '' }, 'io'],
    ['http.fetch.invalid', 'httpFetch', { method: 'GET' }, 'invalid'],
    ['http.fetch.io', 'httpFetch', { url: 'http://127.0.0.1:1/dead', method: 'GET' }, 'io'],
    ['fs.read.denied', 'fsRead', { scope: 'session', path: 'x.txt' }, 'denied'],
    ['fs.write.invalid', 'fsWrite',
      { scope: 'app', path: '../escape.txt', bytesB64: CANARY_B64 }, 'invalid'],
    ['fs.stat.invalid', 'fsStat', { scope: 'app', path: '../escape.txt' }, 'invalid'],
    ['fs.remove.invalid', 'fsRemove', { scope: 'app', path: '../escape.txt' }, 'invalid'],
    ['fs.publish.invalid', 'fsPublishAtomic',
      { scope: 'app', path: '../escape.txt', bytesB64: CANARY_B64 }, 'invalid'],
    ['fs.publish.denied', 'fsPublishAtomic',
      { scope: 'session', path: 'x.txt', bytesB64: CANARY_B64 }, 'denied'],
    // publish creates no parents (fsMkdir first): the missing parent is the
    // contract's own io ladder — mkstemp cannot open in a nonexistent dir.
    ['fs.publish.missing-parent.io', 'fsPublishAtomic',
      { scope: 'app', path: 'audit-inv/no-such-dir/x.txt', bytesB64: CANARY_B64 }, 'io'],
    ['fs.sync.invalid.kind', 'fsSync', { scope: 'app', path: 'x.txt', kind: 'symlink' }, 'invalid'],
    ['fs.sync.denied', 'fsSync', { scope: 'session', path: 'x.txt', kind: 'file' }, 'denied'],
    ['fs.sync.missing.io', 'fsSync',
      { scope: 'app', path: 'audit-inv/absent-sync.txt', kind: 'file' }, 'io'],
    // kind must match what the path is: published.txt exists as a FILE (the
    // success quadrant made it), so a dir barrier on it rejects io.
    ['fs.sync.kind-mismatch.io', 'fsSync',
      { scope: 'app', path: 'audit-inv/canary-fswrite/published.txt', kind: 'dir' }, 'io'],
    ['keychain.get.invalid', 'keychainGet', { ref: 'k'.repeat(4096) }, 'invalid'],
    ['keychain.set.invalid', 'keychainSet',
      { ref: 'k'.repeat(4096), secretB64: CANARY_B64 }, 'invalid'],
    ['timer.schedule.invalid', 'timerSchedule', { delayMs: -5 }, 'invalid'],
  ];
  for (const [cell, primitive, args, code] of cells) {
    const out = await raw(cell, primitive, primitive, 'rejected', args);
    demand(!out.ok && out.code === code,
      `${cell}: expected ${code}, got ${out.ok ? 'ok' : out.code}`);
  }
};

/** The socket seam's faces: the granted listen→connect→accept→write→end→
 * close walk over REAL loopback TCP, then the two audited denials (the
 * five-rule model's narrowest-scope default). */
const socketCells = async () => {
  const listen = await raw('socket.listen.ok', 'socketListen', 'socket.listen', 'ok',
    { scope: 'loopback', port: 0 });
  demand(listen.ok && listen.res.port > 0, 'socket.listen.ok did not bind');
  const connect = await raw('socket.connect.ok', 'socketConnect', 'socket.connect', 'ok',
    { scope: 'loopback', host: '127.0.0.1', port: listen.res.port });
  demand(connect.ok, 'socket.connect.ok refused');
  const accepted = pollUntilAccepted(listen.res.serverId);
  demand(accepted, 'the own-server accept never landed');
  emit('audit.host', { cell: 'socket.accept', audit: 'socket.accept', hostInitiated: true });
  // Complete the client side's non-blocking connect the same way the shim
  // pump does — one poll of the CONNECTION id (a host intrinsic, not a
  // gateway call, so no ledger entry) — or the write hits "not connected".
  globalThis.__dshSocketPoll(connect.res.connectionId);
  const wrote = await raw('socket.write.ok', 'socketWrite', 'socket.write', 'ok',
    { connectionId: connect.res.connectionId, bytesB64: SOCKET_B64 });
  demand(wrote.ok, 'socket.write.ok failed on the accepted connection');
  const ended = await raw('socket.end.ok', 'socketEnd', 'socket.end', 'ok',
    { connectionId: connect.res.connectionId });
  demand(ended.ok, 'socket.end.ok failed');
  const closedConn = await raw('socket.close.conn.ok', 'socketClose', 'socket.close', 'ok',
    { id: connect.res.connectionId });
  demand(closedConn.ok, 'socket.close.conn.ok failed');
  const closedServer = await raw('socket.close.server.ok', 'socketClose', 'socket.close', 'ok',
    { id: listen.res.serverId });
  demand(closedServer.ok, 'socket.close.server.ok failed');
  const lanListen = await raw('socket.listen.denied', 'socketListen', 'socket.listen', 'rejected',
    { scope: 'lan', port: 0 });
  demand(!lanListen.ok && lanListen.code === 'denied', 'a lan listen was not denied');
  const metaDial = await raw('socket.connect.denied', 'socketConnect', 'socket.connect', 'rejected',
    { scope: 'loopback', host: '169.254.169.254', port: 80 });
  demand(!metaDial.ok && metaDial.code === 'denied', 'a metadata dial was not denied');
};

/** The unavailable quadrant: rows this seat declares or serves as honestly
 * absent (contract §7 #1 — absence is information), through v1.9.0's channel
 * seam and v1.10.0's render surface. */
const unavailableCells = async () => {
  const cells = [
    ['fs.list', 'fsList', { scope: 'app', path: '.' }],
    ['fs.mkdir', 'fsMkdir', { scope: 'app', path: 'audit-inv/dir' }],
    ['fs.rename', 'fsRename', { scope: 'app', from: 'a', to: 'b' }],
    ['ish.run', 'ishRun', { scope: 'app', path: '.', argv: ['/bin/true'], timeoutMs: 0 }],
    ['notify', 'notify', { title: 'audit-inv-canary-notify', body: 'x' }],
    ['present.approval', 'presentApproval', { title: 'x' }],
    ['present.picker', 'presentPicker', { mode: 'file' }],
    ['device.info', 'deviceInfo', {}],
    ['haptic', 'haptic', { pattern: 'light' }],
    ['clipboard.read', 'clipboardRead', {}],
    ['clipboard.write', 'clipboardWrite', { text: 'audit-inv-canary-clipboard' }],
    ['present.share', 'presentShare', { text: 'audit-inv-canary-share' }],
    ['keep.awake', 'keepAwake', { hold: true }],
    ['channel.open', 'channelOpen', { source: 'battery' }],
    ['channel.close', 'channelClose', { channelId: 'ch:1' }],
    ['present.surface', 'presentSurface', { kind: 'canvas2d', title: 'x' }],
    ['surface.draw', 'surfaceDraw', { surfaceId: 's:1', ops: [] }],
    ['close.surface', 'closeSurface', { surfaceId: 's:1' }],
  ];
  for (const [cell, primitive, args] of cells) {
    const out = await raw(`unavailable.${cell}`, primitive, primitive, 'unavailable', args);
    demand(!out.ok && out.code === 'unavailable',
      `unavailable.${cell}: expected unavailable, got ${out.ok ? 'ok' : out.code}`);
  }
};

await (async () => {
  if (!globalThis.__dshGatewayNegotiate('gateway@1')) {
    fail('gateway negotiation failed');
    return;
  }
  const env = JSON.parse(globalThis.__dshLaunchEnv?.() ?? '{}');
  const mockUrl = env.DSH_MOCK_HTTP_URL;
  if (!mockUrl || !mockUrl.startsWith('http://127.0.0.1:')) {
    fail(`missing loopback DSH_MOCK_HTTP_URL (${mockUrl ?? 'absent'})`);
    return;
  }
  const descriptor = JSON.parse(globalThis.__dshGatewayDescriptor());
  emit('audit.started', { leg: 'full-matrix' });
  emit('audit.descriptor', {
    available: descriptor.available.length,
    unavailable: descriptor.unavailable.length,
  });
  await successCells(mockUrl);
  await rejectionCells();
  await socketCells();
  await unavailableCells();
  // The bridge's abort control face is a gateway call too (iOS audits it as
  // httpFetch.abort); fire-and-forget here, counted all the same.
  await globalThis.__dshGatewayAbort(1);
  ledger.push({ cell: 'http.abort', primitive: 'httpFetch.abort',
    audit: 'httpFetch.abort', state: 'accepted', code: null });
  emit('audit.probe', { cell: 'http.abort', primitive: 'httpFetch.abort',
    audit: 'httpFetch.abort', state: 'accepted', code: null });
  emit('audit.passed', { calls: ledger.length });
  emit('scenario.complete', { status: 'pass' });
  globalThis.__dshComplete(true, 'ok');
})();
