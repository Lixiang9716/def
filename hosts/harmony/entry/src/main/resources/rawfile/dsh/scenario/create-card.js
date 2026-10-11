// dsh:logging-exempt (scenario; the logger face is the seat's emit)
/**
 * Scenario `create.card` — the create-approve-hotmount loop's E2E leg
 * (PR-2/PR-3): invokes dsh-create's plugin_create execute directly (the
 * same function the agent loop dispatches through ctx.tools; the scripted
 * tool-call half is the mock's PLUGIN_CREATE_TURN leg). The chain it
 * proves, on the REAL seat:
 *
 *   package written (workspace plugins/<name>/) → NATIVE presentApproval
 *   (the scripted-approval seam answers) → registry row installed
 *   (dsh.plugins/1) → the LIVE card face (card.present/state/complete over
 *   the bus, one-shot timer re-arm ticks) → the native CardPlayerSurface
 *   renders the pomodoro in the app's own chrome.
 *
 * THE SPINE SEAT (the gaps3/android-01 fix): the mount needs a REAL cordis
 * context (ctx.plugin) — the bare binding seat's module import never runs
 * dsh-create's apply(), so its module-global spine stays null and the
 * mount refuses ("no cordis spine on this seat"). This drive therefore
 * boots the FULL mobile profile spine first (upstream/boot.js — the same
 * boot the parity leg rides): DshCreate mounts inside it and captures the
 * context, and the live mount inserts the authored plugin into THAT
 * running spine. The llm route below is required boot wiring (no
 * transport-free boot) and is NEVER dialed — no model turn runs here.
 *
 * The duration is deliberately short (the evidence window; the real chat
 * passes 1500000 for a full 25-minute pomodoro).
 */
import { createLogger } from '../logger.js';
import { scenarioModule } from '../transport-tokens.mjs';
import { fsScope } from 'gateway.js';
import { bootUpstream } from 'upstream/boot.js';
import { pluginCreateExecute } from 'system-plugins/dsh-create/index.js';

const SCENARIO = 'create.card';
const log = createLogger(scenarioModule);
const emit = (event, fields = {}) => log.info('e2e', { scenario: SCENARIO, event, ...fields });
const fail = (reason) => {
  log.debug('scenario failed', { reason });
  emit('scenario.failed', { reason });
  globalThis.__dshComplete(false, reason);
};
const demand = (cond, reason) => {
  if (cond) return;
  fail(reason);
  throw new Error(reason);
};

const DURATION_MS = 8000;

emit('create.card.begin', {});
if (!globalThis.__dshGatewayNegotiate('gateway@1')) {
  fail('gateway negotiation failed');
} else {
  emit('create.card.seat.ready', { gateway: 'gateway@1' });

  // The profile container: the same scope://app resolution the parity leg
  // uses (the gateway fs's app scope IS the container; the workspace prefix
  // collapses to the bare spelling — plugins/<name> at the scope root).
  const resolved = await fsScope.resolve('scope://app/');
  const root = resolved?.path;
  demand(typeof root === 'string' && root.startsWith('/'),
    `profile container not resolved: ${JSON.stringify(root)}`);

  // Boot the spine — DshCreate's apply() runs inside it (boot.js's
  // tool-plugin-create row) and captures the cordis context the mount
  // inserts into. Boot-inventory records ride debug, NOT the e2e stream:
  // this manifest's story is the mount chain (the parity leg owns the boot
  // inventory's pins); a boot that stayed silent here would be a lie of a
  // different kind, so the lines exist — below the assertion stream.
  const booted = await bootUpstream({
    scenario: SCENARIO,
    agentId: 'main',
    sessionId: 's-create-card-0001',
    cwd: root,
    onEvent: (event, fields) => log.debug('boot', { event, ...fields }),
    container: {
      cwd: root,
      scopeRoot: root,
      tmpdir: `${root}/tmp`,
      home: `${root}/home`,
      env: {},
      argv: ['dsh', '--profile', 'mobile'],
    },
    llm: {
      baseURL: 'http://127.0.0.1:9/never-dialed',
      apiKey: 'unused',
      provider: 'mock',
      model: 'mock-1',
    },
  });
  demand(booted !== undefined && typeof booted.ctx === 'object',
    'the spine boot returned no ctx');
  emit('create.card.spine.booted', { sessionId: booted.sessionId });

  const result = await pluginCreateExecute({
    name: 'pomodoro-create',
    title: '番茄时钟 · 创作',
    kind: 'timer',
    durationMs: DURATION_MS,
  });
  // The success predicate rides the plugin's OWN success vocabulary, both
  // spellings of it: the live-mount rewrite (dsh-create 0.1.6-alpha.2)
  // answers 已作为真实 cordis 插件在线插入 where the pre-cordis installer
  // answered 已安装并激活 — a stale predicate here failed the leg AFTER the
  // mount had in fact succeeded (measured on-device, 2026-10-11: package
  // written, approval answered, registry row installed, the plugin live in
  // ctx.plugin — then the scenario failed on its own string).
  const installed = typeof result === 'string'
    && (result.includes('已安装并激活') || result.includes('在线插入'));
  emit('tool.returned', {
    ok: installed,
    text: typeof result === 'string' ? result.slice(0, 80) : String(result),
  });
  if (!installed) {
    fail(`plugin_create did not install: ${JSON.stringify(result)}`);
  } else {
    // The card face runs fire-and-forget; let the ticks land, then settle.
    // The margin is GENEROUS on purpose: the plugin's re-arm loop re-arms
    // only after each fire crosses back onto the runtime queue, and this
    // seat carries the whole spine's boot traffic — the measured drift grew
    // the tick gaps to ~2.4s by the eighth, landing card.complete ~600ms
    // PAST a +1500 window: the scenario completed first, m4End tore the
    // runtime down, and the complete line never crossed (the missing
    // card.face.completed, first run). +6000 covers the loaded seat.
    await new Promise((resolve) => setTimeout(resolve, DURATION_MS + 6000));
    emit('create.card.done', { durationMs: DURATION_MS });
    emit('scenario.complete', { status: 'pass' });
    globalThis.__dshComplete(true, 'create.card settled');
  }
}
