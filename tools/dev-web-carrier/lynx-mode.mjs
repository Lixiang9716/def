// dsh:logging-exempt (node-side driver: console IS the product)
/**
 * lynx-mode.mjs — `dev-carrier.mjs --client lynx`: the carrier's lynx
 * render face. The SAME fixture machine as next (next-mode.mjs — the same
 * wire, never a parallel copy): /api answers session/list|create|prompt|
 * cancel + the BYOK onboarding legs, and WS /api/remote.mux carries the
 * live session/follow streams. What changes is the RENDER SEAT: after
 * listen, this process mounts the lynx RenderSurfaceClient over its own
 * serve — createSessionServe + createLynxSkin(host:'cli') + createDriver,
 * the same four shapes as test/e2e/lynx-mount.mjs — and opens the seeded
 * fixture session. There is no HTTP page: every non-/api path is a bare
 * 404, because the face renders in the mounted skin (the CLI transcript
 * here; an on-device LynxView when a real engine host embeds the other
 * half — pixels stay engine-only), never a web page.
 *
 * Auth: the mux upgrade gate accepts `?token=` (muxUpgradeAllowed — the
 * same secret authLite mints cookies with) because the lynx wire's Node
 * WebSocket sends no cookie headers; the token rides the ws URL
 * (session-serve's muxUrl). The HTTP /api branch stays unauthenticated
 * exactly as the next-style service has always had it.
 *
 * Error faces (honest, roster-style): a missing or too-small ReactLynx
 * bundle fails loud out of verifyBundleArtifact and surfaces through
 * main().catch as `[dev-web-carrier] fatal:` + exit 1 — same route as
 * every roster/argument error. The mount path needs NO npm dependencies:
 * it drives the bundle's real seam core (shared/surface-core.js), not the
 * engine; only REBUILDING the bundle needs @lynx-js (see
 * presentation/lynx-client/bundle).
 *
 * stdout is the render log (AGENTS "E2E by logs"): roster, client.selected
 * + face.mounted (face, selection source, mount mechanism, artifact
 * bytes/sha256), connection/drawer/seed settles, and every transcript
 * change re-printed — tmp/lynx-smoke.sh asserts on exactly these lines.
 */
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acceptUpgrade } from './ws-lite.mjs';
import { createCarrierMachine, muxUpgradeAllowed, serveApi, handleMux } from './next-mode.mjs';
import { createSessionServe } from '../../presentation/lynx-client/driver/wire/session-serve.js';
import { createDriver } from '../../presentation/lynx-client/driver/driver.js';
import { createLynxSkin } from '../../presentation/lynx-client/driver/skin-lynx.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCENARIO = 'lynx.client-select';
const DEADLINE_MS = 20_000;
const COOKIE = 'dsh-dev-carrier';

const say = (event, fields = {}) =>
  console.log(`[dev-web-carrier:lynx] ${event} ${JSON.stringify(fields)}`);

/** Wait on conditions, not clocks (rules.md 8): poll the transcript until
 * fn holds or the deadline passes, then fail loud naming the condition. */
const poll = async (what, fn) => {
  const deadline = Date.now() + DEADLINE_MS;
  while (Date.now() < deadline) {
    if (fn()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`[dev-web-carrier:lynx] deadline exceeded waiting for: ${what}`);
};

/** The HTTP+WS seat: /api answers from the shared machine, the mux upgrade
 * takes the token query (muxUpgradeAllowed), every other path is a bare
 * 404 — the lynx face has no web page to serve. */
const startLynxServer = (machine, token) => {
  const isAuthed = (req) => (req.headers.cookie ?? '').split(';')
    .map((c) => c.trim()).some((c) => c === `${COOKIE}=${token}`);
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const respond = (status, mime, body) => {
      const buf = Buffer.from(body, 'utf8');
      res.writeHead(status, { 'Content-Type': mime, 'Content-Length': buf.length });
      res.end(buf);
    };
    try {
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        return serveApi(machine, req, url, respond);
      }
      return respond(404, 'text/plain', '');
    } catch (error) {
      console.error('[dev-web-carrier:lynx] request failed:', error?.stack ?? error);
      respond(400, 'text/plain', '');
    }
  });
  server.on('upgrade', (req, socket) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (!muxUpgradeAllowed(req, url, token, isAuthed)) return socket.destroy();
    say('mux.upgrade', { accepted: true, auth: 'token-query' });
    const ws = acceptUpgrade(req, socket);
    if (ws !== null) ws.onText((text) => handleMux(machine, ws, text));
  });
  return server;
};

/** The render seat: the same four mount shapes as test/e2e/lynx-mount.mjs
 * with the carrier's own serve; then the seeded fixture session opens and
 * every transcript change is re-printed as the render log. */
const mountLynxFace = async (server, token, seededCount) => {
  const { port } = server.address();
  const skin = createLynxSkin({ host: 'cli' });
  const serve = createSessionServe({
    baseUrl: `http://127.0.0.1:${port}`,
    muxUrl: `ws://127.0.0.1:${port}/api/remote.mux?token=${token}`,
  });
  const driver = createDriver({ skin, serve });
  await driver.mount();
  say('client.selected', {
    face: skin.face, source: '--client lynx (host roster)', scenario: SCENARIO,
  });
  say('face.mounted', {
    face: skin.face, mode: skin.mountMode,
    artifactBytes: skin.artifact.bytes, artifactSha256: skin.artifact.sha256,
  });
  let last = '';
  const printTranscript = () => {
    const text = skin.transcript;
    if (text === last) return;
    last = text;
    console.log(`[dev-web-carrier:lynx] transcript (${text.split('\n').length} lines)`);
    for (const line of text.split('\n')) console.log(`[dev-web-carrier:lynx] | ${line}`);
  };
  setInterval(printTranscript, 200);
  await poll('connection open', () => skin.transcript.includes('已连接'));
  say('connection.opened', { status: '已连接' });
  await poll('drawer settle', () => skin.transcript.includes('s-dev-ca'));
  say('drawer.settled', { sessions: seededCount });
  await driver.openSession('s-dev-carrier-0001');
  await poll('seed replay', () => skin.transcript.includes('回合结束'));
  say('seed.settled', { sessionId: 's-dev-carrier-0001', rebuilt: 'from the fixture journal' });
  printTranscript();
};

/** `--client lynx` entry (dev-carrier.mjs dispatch): the fixture machine,
 * the seat, and the mount — in THIS process (no separate driver process:
 * the seam is the in-process loopback pair, exactly the lynx-mount
 * shape, with the carrier standing in for the mock serve). */
export const runLynxClient = async (args, sessionsFixture) => {
  const machine = createCarrierMachine({
    sessionsFixture,
    journalPath: join(HERE, 'fixtures/journal.jsonl'),
  });
  const token = randomBytes(16).toString('hex');
  const server = startLynxServer(machine, token);
  await new Promise((resolve) => server.listen(args.port, '127.0.0.1', resolve));
  const { port } = server.address();
  console.log(`[dev-web-carrier:lynx] listening on http://127.0.0.1:${port}/`);
  console.log('[dev-web-carrier:lynx] render face = the mounted lynx skin (CLI transcript), '
    + 'not an HTTP page — non-/api paths are bare 404s; pixels stay engine-only');
  await mountLynxFace(server, token, Array.isArray(sessionsFixture?.items) ? sessionsFixture.items.length : 0);
};
