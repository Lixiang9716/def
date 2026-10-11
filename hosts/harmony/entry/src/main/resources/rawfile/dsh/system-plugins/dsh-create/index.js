// dsh:logging-exempt (plugin entry; logging happens through the mounted logger)
/**
 * dsh-create — the creation seat's product face, CORDIS-NATIVE (the
 * owner's bar: 基于cordis插件模式、在线插入,不是自造插件系统):
 *
 *   1. SCHEMA — plugin_create's args are the creation schema; the model
 *      authors the plugin's SOURCE (indexSource — a real cordis plugin
 *      exporting name/inject/apply) or takes the generated template.
 *   2. WRITE — the package lands at plugins/<name>/ (workspace grammar).
 *   3. LIVE MOUNT — plugin-mount.js's mountWorkspacePlugin(ctx, name) is
 *      the WHOLE product pipeline: the native presentApproval checkpoint
 *      (挂载插件…), the dsh.plugins/1 registry row, the __dshModuleDefine
 *      loader-seam registration + dynamic import() (real code, loaded
 *      post-boot), and ctx.plugin(ns) — the plugin is inserted INTO THE
 *      RUNNING SPINE as a real cordis plugin. Every step is
 *      plugin.mount.* E2E evidence.
 *   4. THE PLUGIN RUNS — its own apply() executes on mount: it posts the
 *      card.* bus lines itself (its own JS computes the face — a calendar
 *      computes today's date, a timer runs its own 1Hz re-arm loop). The
 *      host CardPlayerSurface only RENDERS what the plugin's code sends —
 *      the running is the plugin's, not this tool's.
 *
 * The hardening contract (the tool description is the model-facing
 * authority; this file is its implementation):
 *   - TEMPLATE KINDS are an enum (timer | calendar). A custom kind is a
 *     free manifest field but only WITH the author's own indexSource —
 *     the generated template cannot render one, so it refuses with the
 *     supported list instead of silently dating the card.
 *   - MOUNT REFUSALS are structured, never thrown: the model receives
 *     step + reason (the linked step's reason carries the underlying
 *     parse/link error verbatim) plus the one-line remediation — fix
 *     indexSource and re-call this tool with the same name; renaming
 *     never fixes source. A declined approval is a verdict, not a retry.
 *   - An indexSource that calls setInterval() still mounts, but the
 *     result carries a non-blocking discipline warn (one-shot re-arm is
 *     the timers contract, timers.js).
 */
import { createLogger } from 'logger.js';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { fsWrite } from 'gateway.js';
import { mountWorkspacePlugin } from 'plugin-mount.js';
import { workspacePrefix, joinScoped } from 'workspace-registry.js';
import 'upstream/shims/timers.js';

const log = createLogger('dsh.create');

export const manifest = {
  schemaVersion: 1,
  id: 'dsh-create',
  version: '0.3.0',
  type: 'service',
  entry: 'index.js',
  capabilities: { required: ['fsRead', 'fsWrite', 'presentApproval'], optional: [] },
  hooks: { activate: 'activate' },
};

const PKG_ID = /^[a-z0-9][a-z0-9.-]*$/;

/** The spine context, captured at apply — the live mount needs the REAL
 * cordis context (ctx.plugin). */
let spine = null;

/** The UTF-8 face (the workspace-registry resolution — quickjs has no
 * TextEncoder global by default; this MUST resolve, not construct). */
let utf8Encode = null;
const encodeUtf8 = async (text) => {
  if (utf8Encode === null) {
    const bufFace = await import('node:buffer').catch(() => undefined);
    utf8Encode = typeof bufFace?.encodeUtf8 === 'function'
      ? bufFace.encodeUtf8
      : (t) => new TextEncoder().encode(t);
  }
  return utf8Encode(text);
};

/** The kinds generatedIndex can render (the kind enum). Anything else
 * needs the author's own indexSource — with one, kind rides the manifest
 * as the free field it is. */
const TEMPLATE_KINDS = ['timer', 'calendar'];

/** The model-facing authoring contract, verbatim. Held at module level so
 * it costs no function span (the SHELL_DESCRIPTION precedent) — every line
 * below is a pinned fact, grounded in the consumers: ctx.effect semantics
 * (vendored cordis@4.0.2 _execute), the timers shim contract (v1.4.0
 * one-shot; timers.js), the loader's bare map (dsh_runtime_host.c), the
 * LlmAdapter base (vendored dsh-llm), and the three hosts' card faces
 * (CardPlayerSurface.swift / CardSurface.kt / CardFace.ets). */
const PLUGIN_CREATE_DESCRIPTION = [
  'MANDATORY: any make-a-runnable-thing ask — 做/生成/创建 a 插件 (plugin), 应用 (app), 番茄钟, 日历, 倒计时/时钟, 打卡, any 小工具 — call',
  'this tool IMMEDIATELY in your FIRST reply: never answer in text, never ask for confirmation. It writes plugins/<name>/ and',
  'LIVE-mounts it into the running cordis spine (read → validated → approved → adopted → linked → mounted; the user approves a native',
  'dialog); the plugin then runs its own apply(). Acceptance = the plugin.mount.* / plugin.running / card.posted logs — never screenshots.',
  'indexSource (preferred) = YOUR cordis plugin module: object form (name/inject/apply), `export default (ctx) => …`, or one Service-class',
  'export. Without indexSource you get the generated template: kind "timer" (countdown, needs durationMs) or "calendar" (date face) — the',
  'ONLY template kinds; any other kind without indexSource is refused with the supported list. With indexSource, kind is a free manifest field.',
  'AUTHORING CONTRACT — a break refuses the mount with step + reason; fix indexSource and re-call this tool with the SAME name:',
  '1. apply runs ONCE on mount. ctx.effect(setup) runs setup IMMEDIATELY; its return value IS the disposer:',
  '`ctx.effect(() => { const t = setTimeout(tick, 1000); return () => clearTimeout(t); });` Promise/generator returns collect async',
  'disposers, null/undefined register no cleanup, any other return type throws TypeError.',
  '2. Timers: `import "upstream/shims/timers.js";` first. setTimeout is ONE-SHOT — repeat via a re-arm loop (`while (left > 0) { await new',
  'Promise((r) => setTimeout(r, 1000)); … }`). setInterval exists as a re-arm polyfill but breaks the discipline: a throwing callback',
  'stops its loop and a non-integer delay throws (it still mounts — the result carries a warn).',
  '3. Imports resolve through the loader map only — the runtime bundle-root modules (logger.js gateway.js plugin-mount.js',
  'workspace-registry.js llm.js upstream/shims/timers.js …), shimmed node: builtins (path crypto util fs buffer os process url events …),',
  'and the pinned vendored packages (@deepseek-ai/dsh-tools @deepseek-ai/cordis @deepseek-ai/schemastery @deepseek-ai/dsh-llm zod js-yaml …):',
  'treat that as the supported surface — anything the map cannot resolve (or absent from the bundle tree) fails the link (step "linked").',
  '4. LLM adapters MUST `class X extends LlmAdapter` ("@deepseek-ai/dsh-llm") implementing `async *stream(options)` — the base owns',
  'providerInfo/providerRetryPolicy/listModels/resolveModel/prepareCall; a bare object fails registerAdapter with "not a function".',
  'Register with `ctx.llm.registerAdapter(["your-provider"], adapter)`; every provider HTTP request must carry attributionHeaders().',
  '5. Cards — `globalThis.__dshBusPost?.(JSON.stringify(msg))`: {type:"card.present", card:{ id — REQUIRED, a missing id is silently',
  'dropped by every host | kind (only "timer" gets the countdown face; default "info") | title (defaults to id) | subtitle (rendered',
  'by iOS/Android, not harmony) | durationMs (local countdown anchor) }} — presenting again REPLACES the card, no dismiss first;',
  '{type:"card.state", id, state:{ remainingMs, label }} re-anchors countdown/label, nothing else is read (hosts tween locally at 250ms,',
  'so 1Hz patches suffice — never spam); {type:"card.complete", id, message} — iOS/Android auto-dismiss ~2.5s later, harmony keeps the',
  'card; unknown fields are ignored everywhere, nothing throws.',
  'A runnable timer plugin, whole (note the alive flag — the disposer must stop the loop AND the posts):',
  '  import "upstream/shims/timers.js";',
  '  const post = (m) => globalThis.__dshBusPost?.(JSON.stringify(m));',
  '  export const name = "pomodoro";',
  '  export const apply = (ctx) => {',
  '    const CARD = "create-pomodoro";',
  '    post({ type: "card.present", card: { id: CARD, kind: "timer", title: "番茄钟", subtitle: "专注 25 分钟", durationMs: 1500000 } });',
  '    ctx.effect(() => {',
  '      let remaining = 1500000, alive = true;',
  '      (async () => {',
  '        while (remaining > 0) {',
  '          await new Promise((r) => setTimeout(r, 1000)); remaining -= 1000;',
  '          if (!alive) return;  // unloaded mid-tick — the disposer stopped us',
  '          post({ type: "card.state", id: CARD, state: { remainingMs: remaining, label: "剩 " + Math.ceil(remaining / 1000) + " 秒" } });',
  '        }',
  '        post({ type: "card.complete", id: CARD, message: "番茄钟完成" });',
  '      })();',
  '      return () => { alive = false; };  // stops the loop AND any further posts',
  '    });',
  '  };',
].join('\n');

/** The generated plugin — a REAL cordis plugin whose apply() IS the run:
 * a timer runs its own one-shot re-arm loop; a calendar computes today's
 * date in its own JS. The card face is the plugin's own bus posts. */
const generatedIndex = ({ id, title, kind, durationMs }) => `// Authored by the creation turn — a real cordis plugin, mounted LIVE.
import 'upstream/shims/timers.js';
import { createLogger } from 'logger.js';
const log = createLogger('plugin.${id}');
const post = (msg) => globalThis.__dshBusPost?.(JSON.stringify(msg));
const CARD = 'create-${id}';
export const name = '${id}';
export const inject = [];
export const apply = (ctx) => {
  log.info('e2e', { scenario: 'plugin.${id}', event: 'plugin.running', kind: '${kind}' });
  post({ type: 'card.present', card: {
    id: CARD, kind: '${kind}', title: '${title}',
    subtitle: '创作插件 · 已在线挂载', durationMs: ${durationMs} } });
  log.info('e2e', { scenario: 'plugin.${id}', event: 'card.posted', id: CARD });
${
  kind === 'timer'
    ? `  let remaining = ${durationMs};
  let alive = true;
  ctx.effect(() => () => { alive = false; }); // unmount stops the loop AND the posts
  (async () => {
    while (remaining > 0) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      remaining -= 1000;
      if (!alive) return;
      post({ type: 'card.state', id: CARD, state: {
        remainingMs: remaining, label: '剩 ' + Math.ceil(remaining / 1000) + ' 秒' } });
    }
    post({ type: 'card.complete', id: CARD, message: '${title} 完成' });
  })();`
    : `  const now = new Date();
  const label = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0')
    + '-' + String(now.getDate()).padStart(2, '0');
  post({ type: 'card.state', id: CARD, state: { label } });`
}
};
`;

/** Write the package (step: package.written). Returns {name,title,
 * indexSource} or a refusal string. */
const writePackage = async (args, dir) => {
  const name = String(args.name ?? '');
  if (!PKG_ID.test(name)) {
    return `plugin_create: name must match ${PKG_ID} (got ${JSON.stringify(name)})`;
  }
  const kind = args.kind === undefined ? 'timer' : String(args.kind);
  const title = args.title === undefined ? name : String(args.title);
  const durationMs = Math.max(0, Math.trunc(Number(args.durationMs ?? 0)));
  const authored = typeof args.indexSource === 'string' && args.indexSource.length > 0
    ? args.indexSource
    : null;
  // The kind enum: the template renders timer|calendar only. A custom kind
  // is a free manifest field, but only WITH authored source — refuse with
  // the supported list (before any write) instead of silently dating it.
  if (authored === null && !TEMPLATE_KINDS.includes(kind)) {
    return `plugin_create: template kind must be one of ${TEMPLATE_KINDS.join(' | ')} `
      + `(got ${JSON.stringify(kind)}) — pass indexSource to author a custom plugin `
      + '(with source, any kind is a free manifest field)';
  }
  if (kind === 'timer' && !(durationMs > 0)) {
    return 'plugin_create: timer cards need a positive durationMs';
  }
  const indexSource = authored ?? generatedIndex({ id: name, title, kind, durationMs });
  const pluginManifest = {
    id: name, name: title, version: '1.0.0', entry: 'index.js',
    capabilities: [], kind,
  };
  await fsWrite('app', `${dir}/manifest.json`,
    await encodeUtf8(`${JSON.stringify(pluginManifest, null, 2)}\n`));
  await fsWrite('app', `${dir}/index.js`, await encodeUtf8(indexSource));
  log.info('e2e', { scenario: 'create.card', event: 'package.written', name });
  return { name, title, indexSource };
};

/** The create.chain's E2E narration (the create.card scenario the manifest
 * pins — the same id writePackage's package.written already rides), as the
 * mount's opts.onStep: approved → approval.answered, adopted →
 * registry.installed. Module-level: a pure log mapping, no closure state. */
const narrateCreateStep = (step, fields) => {
  if (step === 'approved') {
    log.info('e2e', { scenario: 'create.card', event: 'approval.answered',
      name: fields.spec, approved: fields.approved === true });
  } else if (step === 'adopted') {
    log.info('e2e', { scenario: 'create.card', event: 'registry.installed',
      name: fields.spec });
  }
};

/** Live-mount through the cordis seam: approval → registry → dynamic
 * import → ctx.plugin — the plugin's apply() runs as a result. The mount
 * pipeline's own records stay under its plugin.mount.* scenario; the
 * creation chain narrates through narrateCreateStep. The mount
 * chain never throws: a refusal comes back as the structured value
 * {mounted:false, step, reason} and THIS face turns it into the model's
 * in-band diagnostic. */
const execute = async (args) => {
  const name = String(args.name ?? '');
  // The SAME derivation plugin-mount reads with (the pinned globals passed
  // explicitly — the no-arg call answers the bare prefix and the mount
  // then refuses at read: the write must land exactly where it reads).
  const prefix = workspacePrefix({
    containerRoot: globalThis.__dshProfileCwd,
    scopeRoot: globalThis.__dshProfileScopeRoot,
  });
  const dir = joinScoped(prefix, `plugins/${name}`);
  const written = await writePackage(args, dir);
  if (typeof written === 'string') return written;
  // Non-blocking discipline warn: setInterval WORKS (the shim's re-arm
  // polyfill) — it just breaks the one-shot timers contract. It rides every
  // post-write result (the source is on disk whatever the mount answers) —
  // a reminder, never a refusal.
  const warns = written.indexSource.includes('setInterval(')
    ? ['warn: indexSource calls setInterval — it runs as the timers shim\'s re-arm polyfill, '
       + 'but the one-shot discipline (setTimeout re-arm loop) is the contract; a throwing '
       + 'callback stops its loop. Prefer the re-arm loop.']
    : [];
  if (!spine) {
    return ['plugin_create: no cordis spine on this seat (mount impossible)', ...warns].join('\n');
  }
  const outcome = await mountWorkspacePlugin(spine, written.name,
    { onStep: narrateCreateStep });
  if (!outcome.mounted) {
    // The structured refusal, in full: step + reason (reason carries the
    // underlying parse/link/apply error verbatim), plus the remediation.
    // 'context' here can only be already-mounted (the spine check passed):
    // NO session tool unmounts a live fiber — plugin_manager remove_bundle
    // edits the registry row only (dsh-plugin-manager-tools removeLeg),
    // and the unmounting remove face is the app's plugin-management plane
    // (web-write-plugin-manager) — so the honest remediation is a new name
    // or a user-mediated unload, never the same-name retry loop.
    const remediation = outcome.step === 'approval'
      ? '用户在原生对话框拒绝了挂载 — 这是决定,不是错误;除非用户再次要求,不要重试。'
      : outcome.step === 'context'
        ? '该名字的插件已在运行 — 会话工具卸载不了已挂载的插件:换一个新名字重新创作'
          + '(旧的继续运行),或请用户在应用的插件管理里移除后再同名重挂。'
        : '修复 indexSource 后重调本工具(同名重挂);不要换名字绕过。';
    return [`plugin_create: 挂载未完成(${outcome.step}): ${outcome.reason ?? ''}`,
      ...warns, remediation].join('\n');
  }
  const done = `插件「${written.title}」已作为真实 cordis 插件在线插入:审批通过 → 注册表落库 → `
    + '动态加载 → ctx.plugin 挂载,插件自身代码已在运行(plugin.mount.* 事件链为证)。';
  return [done, ...warns].join('\n');
};

const pluginCreateTool = () => defineTool({
  name: 'plugin_create',
  description: PLUGIN_CREATE_DESCRIPTION,
  parameters: {
    name: { type: 'string', required: true,
      description: 'Package id, kebab-case (e.g. "calendar-plugin").' },
    title: { type: 'string', required: true,
      description: 'Display title (approval dialog + card).' },
    kind: { type: 'string',
      description: 'Template kind: "timer" (needs durationMs) or "calendar". Any other '
        + 'kind is refused unless indexSource accompanies it (then kind is a free '
        + 'manifest field).' },
    durationMs: { type: 'number',
      description: 'Timer duration in ms (1500000 = 25 min); omit for calendar.' },
    indexSource: { type: 'string',
      description: 'YOUR authored cordis plugin source (exports name/inject/apply) — '
        + 'preferred over the template; see the AUTHORING CONTRACT in the description.' },
  },
  output: {
    schema: { type: 'string' },
    render: (_args, value) => [{ type: 'text', text: value }],
  },
  execute,
});

export function activate() {
  log.debug('dsh-create activated', {});
}

/** The E2E drive's entry (scenario/create-card.js): the same execute. */
export const pluginCreateExecute = execute;

export const name = 'dsh-create';
export const inject = ['tools'];

export const apply = (ctx) => {
  spine = ctx;
  ctx.tools.register(pluginCreateTool());
  log.debug('plugin_create registered (spine captured)', {});
};
