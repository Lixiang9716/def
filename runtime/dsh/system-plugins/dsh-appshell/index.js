// dsh:logging-exempt — the mounted logger carries every canonical line.
/**
 * dsh-appshell: one-prompt app surfaces. The model authors an app-shell spec
 * (declarative component tree, app-shell/0.9); the client renders it with its
 * own catalog. Zero gateway primitives — specs ride session content.
 *
 * Mock/real switch: DSH_APPSHELL_MODE=mock serves bundled fixtures
 * (lib/mock.js); real validates model tool-call args. Both feed the SAME
 * validate->expand->render pipeline (lib/render.js).
 *
 * Tool contract (the vendored @deepseek-ai/dsh-tools shape the spine's
 * ToolRuntime enforces): every tool declares output { schema, render } —
 * execute returns the schema-shaped value, refusals THROW (the structured
 * error outcome; a forged surfaceId never yields an executable success).
 * render emits the JSON echo as the card text — the exact content shape the
 * web client's appshell toolview parses (parity with the dev-carrier's
 * synthesized tool cards).
 */
import { createLogger } from 'logger.js';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { MODE, modeAnnounce, mockSpec, fixtureKeys } from './lib/mock.js';
import { validate, mergeUpdate } from './lib/validate.js';
import { SPEC_VERSION } from './lib/catalog.js';

const log = createLogger('dsh.appshell');

export const name = 'dsh-appshell';
export const inject = ['tools'];

const RULES = 'Author an app-shell spec: {"spec":"' + SPEC_VERSION + '",theme:{accent},tabs:[2..5 strings],actions:[ids],screen:node}. ' +
  'Node types (closed): text,image,button,row,column,card,progressbar,badge + templates search-bar,tab-bar,chat-row,service-grid,banner-card,hcard-row,balance-card,mini-player. ' +
  'Every button.action must be declared in actions. Text fields are plain text. Call appshell_catalog for the full rules. ' +
  'Design constitution — the target device is a PHONE (390x844 portrait, touch, one-handed thumb reach): ' +
  '一屏克制 screen 顶层 children ≤8; 文案短 标题≤10字/副题≤24字/按钮 2-4 字动词; 移动模板优先 search-bar/tab-bar/mini-player/chat-row/service-grid/hcard-row 至少 2 种; tabs 2-5 个每个≤4字; 嵌套≤3 层, 重要信息在最上、操作元素靠下; theme.accent 单色贯穿且 mode=light, 不发明第二个强调色; 不做桌面形态. ' +
  '视觉表达: 首屏第一块用 banner-card 做 hero(title=今天最重要的信息); 卡片与列表项配 image(emoji+color=theme.accent) 作视觉锚点, hcard-row 每项 cover 带 color; 文字三档 title/body/small+muted 都要出现; 数字用 title 档并配 small muted 单位; accent 只落在按钮/进度条/封面底色 3-5 个点位.';

// The surface registry — the sixth red-team gate (forged-surfaceId update).
// appshell_render mints the id; appshell_update must name a surface this
// process actually rendered. A forged id is refused BEFORE any spec work:
// cross-surface pollution is an authorization failure, not a validation one.
let surfaceSeq = 0;
const liveSurfaces = new Map();

const mintSurfaceId = (spec) => {
  surfaceSeq += 1;
  const id = 'appshell-' + surfaceSeq;
  liveSurfaces.set(id, spec);
  return id;
};

/** Test seam: isolate the registry between panel-test cases. */
export const _resetSurfaces = () => {
  surfaceSeq = 0;
  liveSurfaces.clear();
};

const echoText = (_args, value) => [{ type: 'text', text: JSON.stringify(value) }];

const ECHO_OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      ok: { type: 'boolean', required: true },
      title: { type: 'string', required: true },
      surfaceId: { type: 'string', required: true },
      spec: { type: 'object', required: true, additionalProperties: true },
    },
  },
  render: echoText,
};

const renderTool = () => defineTool({
  name: 'appshell_render',
  description: 'Render a full app surface from an app-shell spec. ' + RULES +
    (MODE === 'mock' ? ' [MOCK MODE: arg {fixture:"wechat"|"netease"|"alipay"} serves a bundled fixture instead.]' : ''),
  parameters: MODE === 'mock'
    ? { fixture: { type: 'string', description: 'fixture key: ' + fixtureKeys().join('|') } }
    : { spec: { type: 'object', description: 'the app-shell spec object', additionalProperties: true } },
  output: ECHO_OUTPUT,
  async execute(args) {
    const spec = MODE === 'mock' ? mockSpec(args.fixture || 'wechat') : args.spec;
    if (spec === null) throw new Error('unknown fixture; keys: ' + fixtureKeys().join('|'));
    const result = validate(spec);
    if (!result.ok) {
      log.info({ event: 'appshell.render', mode: MODE, ok: false, errors: result.errors.length });
      throw new Error('spec rejected: ' + JSON.stringify(result.errors));
    }
    const surfaceId = mintSurfaceId(spec);
    log.info({ event: 'appshell.render', mode: MODE, ok: true, errors: 0, surfaceId });
    const title = MODE === 'mock' ? (args.fixture || 'wechat') : (spec.title || 'app');
    return { ok: true, title, surfaceId, spec };
  },
});

const updateTool = () => defineTool({
  name: 'appshell_update',
  description: 'Update an already-rendered app surface in place. surfaceId must be the one a prior appshell_render returned. The spec may be FULL or INCREMENTAL (only screen [+theme/tabs/actions] — the rest stays from the render); the echo returns the payload as received.',
  parameters: {
    surfaceId: { type: 'string', description: 'the surface to update (as returned by appshell_render)' },
    spec: { type: 'object', description: 'the new app-shell spec', additionalProperties: true },
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ok: { type: 'boolean', required: true },
        surfaceId: { type: 'string', required: true },
        spec: { type: 'object', required: true, additionalProperties: true },
      },
    },
    // The echo carries the applied spec — the same card shape appshell_render
    // emits, so a client applies the update to the open surface in place
    // (the D-4 single-surface replace) instead of re-asking for a render.
    render: echoText,
  },
  async execute(args) {
    const surfaceId = String(args?.surfaceId ?? '').slice(0, 64);
    if (!liveSurfaces.has(surfaceId)) {
      log.warn({ event: 'appshell.update', mode: MODE, surfaceId, ok: false, reason: 'unknown-surface' });
      throw new Error('unknown-surface: ' + surfaceId);
    }
    // The wire may carry an INCREMENTAL payload (screen [+theme/tabs]) —
    // merged over the spec this surface was rendered from before the four
    // gates judge it; the echo returns the payload AS RECEIVED so the wire
    // (and the model's output tokens) stay small. A full spec merges to
    // itself. The stored origin advances to the merged form: the next
    // update compounds over the current truth.
    const merged = mergeUpdate(liveSurfaces.get(surfaceId), args?.spec);
    const result = merged === null ? null : validate(merged);
    if (result === null || !result.ok) {
      log.info({ event: 'appshell.update', mode: MODE, surfaceId, ok: false });
      throw new Error('spec rejected: ' + JSON.stringify(result === null ? [{ code: 'BAD_FIELD', path: '$', msg: 'spec must be an object' }] : result.errors));
    }
    liveSurfaces.set(surfaceId, merged);
    log.info({ event: 'appshell.update', mode: MODE, surfaceId, ok: true });
    return { ok: true, surfaceId, spec: args.spec };
  },
});

const catalogTool = () => defineTool({
  name: 'appshell_catalog',
  description: 'Return the full app-shell component catalog and authoring rules.',
  parameters: {},
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        rules: { type: 'string', required: true },
      },
    },
    render: (_args, value) => [{ type: 'text', text: value.rules }],
  },
  async execute() {
    return { rules: RULES };
  },
});

export function apply(ctx) {
  modeAnnounce(log);
  for (const tool of [renderTool(), updateTool(), catalogTool()]) ctx.tools?.register?.(tool);
}

/** Test/inspection seam: the activate hook the manifest names. */
export function activate({ register }) {
  register('appshell', {
    render: (spec) => {
      const result = validate(spec);
      return result.ok ? { ok: true } : { ok: false, errors: result.errors };
    },
    mode: MODE,
  });
}
