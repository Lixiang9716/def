// dsh:logging-exempt (scenario; the logger face is the seat's emit)
/**
 * create-calendar-live — the cordis-native creation chain on a REAL model
 * (the calendar leg): ONE real-backend turn driven directly on the agent
 * (the real-create pattern — NO page in the critical path): the model
 * authors a calendar plugin through plugin_create, then the LIVE MOUNT
 * through plugin-mount.js — native approval (the scripted seam answers on
 * a drive) → registry → __dshModuleDefine dynamic import → ctx.plugin —
 * and the plugin's own apply() drives its card face (a date label).
 *
 * THE DRIVE-SEAT SHAPE (the gaps3/android-04 port): the seat delivers one
 * `runtime.config` as the GO trigger (the serve seat and the binding drive
 * both do), the staged credential at fs-app `llm/config.json` is the model
 * route ({baseUrl, apiKey, model, provider?} — the serve seat's own
 * credential file), and the profile container resolves from the gateway
 * fs's app scope. The previous committed shape waited for the serve seat's
 * web-boot machinery and dead-coded its own main() behind a shadowed
 * `booted` const (the boot result object is truthy, so `if (!booted)` never
 * ran) — this shape boots, turns, and mounts on any seat that delivers the
 * trigger. Boot-inventory records ride debug (the parity leg owns those
 * pins); the stream is this chain's own.
 */
import { createLogger } from 'logger.js';
import { fsRead, fsList, fsScope } from 'gateway.js';
import { utf8Decode } from 'llm.js';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { bootUpstream } from 'upstream/boot.js';
import { mountWorkspacePlugin, isMounted } from 'plugin-mount.js';

const SCENARIO = 'create.calendar.live';
const AGENT_ID = 'main';
const SESSION_ID = 's-calendar-live-0001';
const CONFIG_PATH = 'llm/config.json';
const SPEC = 'calendar-plugin';
const PROMPT = '做一个日历插件。用 plugin_create 工具,name=calendar-plugin,'
  + 'title=日历,kind=calendar。立刻调用工具,不要用文字回答。';

const log = createLogger('calendar.live.dsh');
const emit = (event, fields = {}) =>
  log.info('e2e', { scenario: SCENARIO, event, ...fields });
const fail = (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  log.debug('scenario failed', { reason: message });
  emit('scenario.failed', { reason: message });
  globalThis.__dshComplete(false, message);
};
const demand = (cond, reason) => {
  if (cond) return;
  fail(reason);
  throw new Error(reason);
};

/** The GO trigger: the seat delivers one runtime.config after eval — take
 * it off the bus queue (polled, no blind wait; rule 8). */
const queue = [];
let wake = null;
globalThis.__dshBusOnMessage = (line) => {
  queue.push(JSON.parse(line));
  wake?.();
};
const takeRuntimeConfig = async () => {
  const deadline = Date.now() + 60_000;
  for (;;) {
    const at = queue.findIndex((msg) => msg.type === 'runtime.config');
    if (at >= 0) return queue.splice(at, 1)[0];
    if (Date.now() > deadline) throw new Error('the runtime.config trigger never arrived within 60s');
    await new Promise((resolve) => { wake = resolve; });
    wake = null;
  }
};

/** The staged credential (the serve seat's own file — polled, no timer
 * sleep: each failed fsRead is itself a round trip that yields). The KEY
 * NEVER reaches a record: only baseUrl/model are logged. */
const readStagedConfig = async () => {
  const deadline = Date.now() + 60_000;
  for (;;) {
    let cfg = null;
    try {
      cfg = JSON.parse(utf8Decode((await fsRead('app', CONFIG_PATH)).bytes));
    } catch { cfg = null; }
    if (cfg !== null && typeof cfg.baseUrl === 'string'
        && cfg.baseUrl.indexOf('https://') === 0
        && typeof cfg.apiKey === 'string' && cfg.apiKey.length > 0
        && typeof cfg.model === 'string' && cfg.model.length > 0) {
      return cfg;
    }
    if (Date.now() > deadline) {
      throw new Error(`no usable staged credential at ${CONFIG_PATH} within 60s `
        + '(stage {baseUrl, apiKey, model} — the calendar-live leg runs a REAL turn)');
    }
  }
};

/** List the workspace tree to depth 2 (the authored files, by name). */
const listTree = async (rootPath) => {
  const out = [];
  const walk = async (rel, depth) => {
    const listing = await fsList('app', rel);
    const entries = typeof listing === 'object' && listing !== null
      ? (listing.entries ?? listing.files ?? listing) : listing;
    for (const entry of Array.isArray(entries) ? entries : []) {
      const name = typeof entry === 'string' ? entry : (entry.name ?? '');
      if (!name) continue;
      out.push(rel === '' ? name : `${rel}/${name}`);
      if (depth > 0 && typeof entry === 'object' && entry.isDirectory) {
        await walk(`${rel}/${name}`, depth - 1);
      }
    }
  };
  await walk(rootPath, 1);
  return out;
};

const spineOptions = (cfg, containerRoot) => ({
  scenario: SCENARIO,
  agentId: AGENT_ID,
  sessionId: SESSION_ID,
  cwd: containerRoot,
  creation: true,
  container: {
    cwd: containerRoot,
    scopeRoot: containerRoot,
    tmpdir: `${containerRoot}/tmp`,
    home: `${containerRoot}/home`,
    env: {},
    argv: ['dsh', '--profile', 'mobile'],
  },
  llm: {
    kind: 'staged',
    baseURL: cfg.baseUrl,
    apiKey: cfg.apiKey,
    provider: typeof cfg.provider === 'string' && cfg.provider.length > 0
      ? cfg.provider : 'openai-compatible',
    model: cfg.model,
    userEndpoint: true,
    // A reasoning model's first byte can take minutes over the emulator
    // network — the loop-u2 read-idle guard's 120s default would cut every
    // attempt mid-thinking (measured, the real-create demo: three
    // consecutive 120s cuts).
    readIdleTimeoutMs: 300_000,
    adapterName: 'openai-compatible chat-completions (gateway httpFetch, calendar live)',
    transportLabel: 'gateway httpFetch → real backend (calendar live demo)',
  },
  // Boot-inventory records ride debug, NOT the e2e stream: the parity leg
  // owns those pins; this stream is the calendar chain's own.
  onEvent: (event, fields) => log.debug('boot', { event, ...fields }),
});

/** The configured agent appears asynchronously past the AgentLoop mount
 * (the parity leg's wait). */
const waitForAgent = async (booted) => {
  let agent = null;
  let guard = 0;
  while (agent === null && guard++ < 10000) {
    agent = booted.ctx.agents.get(SESSION_ID) ?? null;
    if (agent === null) await Promise.resolve();
  }
  demand(agent !== undefined, `agent "${SESSION_ID}" never appeared in the registry`);
  return agent;
};

/** THE LIVE MOUNT — usually already done BY THE PRODUCT: the turn's own
 * plugin_create tool call runs the WHOLE pipeline (approval → registry →
 * dynamic import → ctx.plugin) inside dsh-create's execute, and the
 * plugin's apply() has been driving its card since. Re-mounting a live
 * spec is the one refusal mountWorkspacePlugin keeps (a spec cannot mount
 * twice), so this drive mounts only when the model authored the tree
 * WITHOUT the tool's mount landing (the reload case), and records the
 * truth either way. */
const ensureMounted = async (booted) => {
  if (isMounted(SPEC)) {
    emit('calendar/mounted', { spec: SPEC, mountedBy: 'plugin_create' });
    return;
  }
  const outcome = await mountWorkspacePlugin(booted.ctx, SPEC);
  if (!outcome.mounted) {
    fail(`mount refused at ${outcome.step}: ${outcome.reason ?? ''}`);
    return;
  }
  emit('calendar/mounted', { spec: outcome.spec, version: outcome.version });
};

const main = async () => {
  await takeRuntimeConfig();

  // The credential (the trigger first: a seat without a staged credential
  // fails LOUD here — the runner's blocked verdict names it before launch).
  const cfg = await readStagedConfig();
  emit('calendar/config/loaded', { baseUrl: cfg.baseUrl, model: cfg.model });

  const resolved = await fsScope.resolve('scope://app/');
  const root = resolved?.path;
  demand(typeof root === 'string' && root.startsWith('/'),
    `profile container not resolved: ${JSON.stringify(root)}`);

  const booted = await bootUpstream(spineOptions(cfg, root));
  demand(booted !== undefined && typeof booted.ctx === 'object',
    'the spine boot returned no ctx');
  emit('calendar/spine/booted', { sessionId: SESSION_ID });

  const agent = await waitForAgent(booted);
  emit('calendar/turn/begin', { prompt: PROMPT });
  agent.followup(createUserMessage({
    content: [{ type: 'text', text: PROMPT }],
    source: { kind: 'user' },
  }));
  await agent.whenIdle();
  emit('calendar/turn/settled', {});

  const files = await listTree('plugins/calendar-plugin');
  emit('calendar/files', { files });
  if (files.length === 0) {
    fail('the model did not author plugins/calendar-plugin (no plugin_create call)');
    return;
  }

  await ensureMounted(booted);
  emit('scenario.complete', { status: 'pass' });
  globalThis.__dshComplete(true, `create.calendar.live: ${SPEC} live-mounted`);
};

main().catch(fail);
