// dsh:logging-exempt (carrier script table: data + pure builders)
/**
 * appshell-scripts.mjs — the dev carrier's app-shell turn scripts, split
 * from next-mode.mjs at the code-size gate: the three product themes
 * (render), the M3 incremental loop-back answer (update), the M4
 * hostile text-safety fixture, and the swarm visual (three pen-identity
 * variant cards grown over STAGED spec arrival) — all pure
 * (turn, prompt, attemptId) → script, exported for the e2e legs to
 * measure the exact wire bytes.
 */
/** The app-shell leg: a prompt naming a known app theme renders that theme
 * as an appshell_render tool call whose result echoes the spec — the exact
 * shape the plugin emits, mocked carrier-side (no runtime here). Themes are
 * matched by regex; unknown prompts fall through to the echo turn. */
const APP_SHELL_THEMES = {
  wechat: { label: '微信', re: /微信|wechat|weixin/i, accent: '#07C160',
    tabs: ['微信', '通讯录', '发现', '我'] },
  netease: { label: '网易云音乐', re: /网易云|云音乐|netease/i, accent: '#ec4141',
    tabs: ['我的', '音乐馆', '云村', '账号'] },
  alipay: { label: '支付宝', re: /支付宝|alipay|支付/i, accent: '#1677FF',
    tabs: ['首页', '理财', '生活', '我的'] },
};

/** The M4 text-safety fixture: EVERY text-bearing field carries a hostile
 * payload (script tag, quote-break, onerror handler). The validator passes
 * it — plain strings are legal text — and the browser leg asserts the whole
 * stack renders them 100% as literal text with zero executable structure. */
export const APP_SHELL_HOSTILE_TEXTS = [
  '<script>alert(1)</script>',
  '点我" onclick="alert(1)',
  '<img src=x onerror=alert(1)>',
];

const hostileSpec = () => ({
  spec: 'app-shell/0.9', title: 'hostile', theme: { accent: '#666666' },
  tabs: ['<t>', '点我" onclick="x'] .slice(0, 2), actions: [],
  screen: { type: 'column', children: [
    { type: 'banner-card', title: APP_SHELL_HOSTILE_TEXTS[2], subtitle: APP_SHELL_HOSTILE_TEXTS[1] },
    { type: 'text', text: APP_SHELL_HOSTILE_TEXTS[0] },
    { type: 'badge', text: APP_SHELL_HOSTILE_TEXTS[2] },
    { type: 'service-grid', items: [
      { icon: '⚠️', label: APP_SHELL_HOSTILE_TEXTS[1] },
      { icon: '🧪', label: APP_SHELL_HOSTILE_TEXTS[0] },
    ] },
  ] },
});

export const appShellScriptFor = (turn, promptText, attemptId) => {
  const swarm = swarmScriptFor(turn, promptText, attemptId);
  if (swarm) return swarm;
  if (!/hostile|安全抽测/i.test(promptText)) {
    return appShellThemeScriptFor(turn, promptText, attemptId);
  }
  const spec = hostileSpec();
  const callId = `dev-hostile${turn}`;
  const appText = '敌意字段已渲染（应当全部是纯文本）。';
  return {
    steps: [
      { type: 'turn/start', data: { turn } },
      { type: 'step/start', data: { turn, step: 1 } },
    ],
    stream: [
      { type: 'start', attemptId, turn, step: 1 },
      { type: 'chunk', attemptId, chunk: { type: 'text-delta', index: 0, text: appText } },
      { type: 'end', attemptId },
    ],
    settle: [
      { type: 'assistant/message', data: { turn, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: appText }] } } },
      { type: 'tool/call', data: { turn, step: 1, callId, name: 'appshell_render', arguments: JSON.stringify({ spec }) } },
      { type: 'tool/result', data: { turn, step: 1, message: { role: 'user', content: [{ type: 'tool-result', toolCallId: callId, isError: false, content: [{ type: 'text', text: JSON.stringify({ ok: true, title: 'hostile', surfaceId: `dev-app-${turn}`, spec }) }] }] } } },
      { type: 'step/end', data: { turn, step: 1 } },
      { type: 'turn/end', data: { turn, reason: { kind: 'stop' } } },
      { type: 'session/title', data: { title: 'hostile · 安全抽测' } },
    ],
  };
};

const appShellThemeScriptFor = (turn, promptText, attemptId) => {
  const appKey = Object.keys(APP_SHELL_THEMES).find(
    (k) => APP_SHELL_THEMES[k].re.test(promptText));
  if (!appKey) return null;
  const app = APP_SHELL_THEMES[appKey];
  const spec = {
    spec: 'app-shell/0.9', theme: { accent: app.accent, mode: 'light' },
    tabs: app.tabs, actions: ['demo.tap'],
    screen: { type: 'column', children: [
      { type: 'banner-card', title: app.label, subtitle: '由一句话生成 · app-shell/0.9' },
      { type: 'service-grid', items: [
        { icon: '📷', label: '入口一' }, { icon: '💳', label: '入口二' },
        { icon: '🚌', label: '入口三' }, { icon: '⚡', label: '入口四' },
      ] },
      { type: 'hcard-row', items: [
        { cover: { emoji: '🎵', color: '#5a7cd4' }, title: '精选 A', sub: 'demo' },
        { cover: { emoji: '🌙', color: '#4d9e5f' }, title: '精选 B', sub: 'demo' },
      ] },
      { type: 'mini-player', cover: { emoji: '▶', color: app.accent }, title: '演示条目', sub: '点按动作回流', action: 'demo.tap' },
    ] },
  };
  const appCallId = `dev-app${turn}`;
  const appText = `已按你的描述生成 **${app.label}** 表面（app-shell/0.9 · 声明式组件树）——卡片上「打开」进入全屏，点按元素动作回流。`;
  return {
    steps: [
      { type: 'turn/start', data: { turn } },
      { type: 'step/start', data: { turn, step: 1 } },
    ],
    stream: [
      { type: 'start', attemptId, turn, step: 1 },
      { type: 'chunk', attemptId, chunk: { type: 'text-delta', index: 0, text: appText } },
      { type: 'end', attemptId },
    ],
    settle: [
      { type: 'assistant/message', data: { turn, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: appText }] } } },
      { type: 'tool/call', data: { turn, step: 1, callId: appCallId, name: 'appshell_render', arguments: JSON.stringify({ fixture: appKey }) } },
      { type: 'tool/result', data: { turn, step: 1, message: { role: 'user', content: [{ type: 'tool-result', toolCallId: appCallId, isError: false, content: [{ type: 'text', text: JSON.stringify({ ok: true, title: app.label, surfaceId: `dev-app-${turn}`, spec }) }] }] } } },
      { type: 'step/end', data: { turn, step: 1 } },
      { type: 'turn/end', data: { turn, reason: { kind: 'stop' } } },
      { type: 'session/title', data: { title: app.label + ' · 生成表面' } },
    ],
  };
};

/** The M3 action loop-back: a tagged [appshell:…] user turn is answered by
 * an appshell_update tool call whose payload is INCREMENTAL — screen only,
 * no theme/tabs (they stay from the render) — so the wire (and the model's
 * output tokens, which this script stands in for) carries a fraction of a
 * full re-render. Exported so the M3 leg measures the very payloads the
 * wire carries, never a re-typed copy. */
export const APP_SHELL_UPDATE_SPEC = {
  spec: 'app-shell/0.9',
  screen: { type: 'column', children: [
    { type: 'balance-card', label: '已选歌单', value: '3 首 · 12 分钟' },
    { type: 'hcard-row', items: [
      { cover: { emoji: '🎧', color: '#5a7cd4' }, title: '增量更新' },
    ] },
  ] },
};

export const appShellUpdateScriptFor = (turn, promptText, attemptId, surfaceId = 'dev-app-1') => {
  if (!/^\[appshell:/.test(promptText)) return null;
  const callId = `dev-upd${turn}`;
  const text = '已按你的动作更新表面（增量 screen 载荷 · app-shell/0.9）。';
  return {
    steps: [
      { type: 'turn/start', data: { turn } },
      { type: 'step/start', data: { turn, step: 1 } },
    ],
    stream: [
      { type: 'start', attemptId, turn, step: 1 },
      { type: 'chunk', attemptId, chunk: { type: 'text-delta', index: 0, text } },
      { type: 'end', attemptId },
    ],
    settle: [
      { type: 'assistant/message', data: { turn, step: 1, message: { role: 'assistant', content: [{ type: 'text', text }] } } },
      { type: 'tool/call', data: { turn, step: 1, callId, name: 'appshell_update', arguments: JSON.stringify({ surfaceId, spec: APP_SHELL_UPDATE_SPEC }) } },
      { type: 'tool/result', data: { turn, step: 1, message: { role: 'user', content: [{ type: 'tool-result', toolCallId: callId, isError: false, content: [{ type: 'text', text: JSON.stringify({ ok: true, surfaceId, spec: APP_SHELL_UPDATE_SPEC }) }] }] } } },
      { type: 'step/end', data: { turn, step: 1 } },
      { type: 'turn/end', data: { turn, reason: { kind: 'stop' } } },
    ],
  };
};

// ---- the swarm visual (staged variant growth) ------------------------------

/** One swarm prompt dispatches three pens over the same brief. The pens are
 * the identity contract the strip renders: a name label + a color, three
 * hues mutually distinct, one per variant card. */
export const SWARM_PENS = [
  { pen: '青笔', accent: '#18b3c6' },
  { pen: '赤笔', accent: '#e05537' },
  { pen: '紫笔', accent: '#8a63d2' },
];

/** The three music-app variants: same brief, different accent AND different
 * content (banner copy, component mix, playing item). Fresh objects per
 * call — the e2e leg derives its DOM-parity expectations from these very
 * bytes, never from a re-typed copy (the APP_SHELL_UPDATE_SPEC discipline). */
export const swarmVariants = () => {
  const [qing, chi, zi] = SWARM_PENS;
  return [
    { slot: 1, ...qing, title: '节奏音乐', tabs: ['发现', '电台', '我的'], children: [
      { type: 'banner-card', title: '节奏 · 每日新歌单', subtitle: '方案一 · 青笔起稿' },
      { type: 'service-grid', items: [
        { icon: '🎧', label: '每日推荐' }, { icon: '📻', label: '私人电台' },
        { icon: '💽', label: '歌单广场' }, { icon: '🎤', label: '一起唱' },
      ] },
      { type: 'hcard-row', items: [
        { cover: { emoji: '🌅', color: '#5a7cd4' }, title: '晨间律动', sub: '28 首' },
        { cover: { emoji: '🌙', color: '#4d9e5f' }, title: '夜航电台', sub: '12 首' },
      ] },
      { type: 'mini-player', cover: { emoji: '▶', color: qing.accent }, title: '晨间律动 · 第 3 首', sub: '点按动作回流', action: 'demo.tap' },
    ] },
    { slot: 2, ...chi, title: '黑胶音乐', tabs: ['推荐', '黑胶', '乐库'], children: [
      { type: 'banner-card', title: '黑胶俱乐部', subtitle: '方案二 · 赤笔起稿' },
      { type: 'balance-card', label: '连续收听', value: '第 7 天' },
      { type: 'hcard-row', items: [
        { cover: { emoji: '💽', color: '#b0723a' }, title: '复刻黑胶 1987', sub: '限量' },
        { cover: { emoji: '🎼', color: '#8a63d2' }, title: '母带档案', sub: '新到' },
      ] },
      { type: 'text', text: '每周复原一张 1980 年代模拟母带', size: 'small', tone: 'muted' },
      { type: 'mini-player', cover: { emoji: '◉', color: chi.accent }, title: '黑胶俱乐部 · A 面', sub: '点按动作回流', action: 'demo.tap' },
    ] },
    { slot: 3, ...zi, title: '脉冲音乐', tabs: ['脉冲', '排行', '收藏'], children: [
      { type: 'banner-card', title: '脉冲电台', subtitle: '方案三 · 紫笔起稿' },
      { type: 'service-grid', items: [
        { icon: '⚡', label: '高能脉冲' }, { icon: '📈', label: '飙升榜' },
        { icon: '🎯', label: '口味调频' }, { icon: '🔊', label: '环绕声' },
      ] },
      { type: 'balance-card', label: '乐龄', value: '1,204 小时' },
      { type: 'hcard-row', items: [
        { cover: { emoji: '⚡', color: '#e0a037' }, title: '高能脉冲 · 第 12 期', sub: '更新' },
        { cover: { emoji: '🌌', color: '#18b3c6' }, title: '深空氛围', sub: '常驻' },
      ] },
      { type: 'mini-player', cover: { emoji: '≫', color: zi.accent }, title: '高能脉冲 · 直播中', sub: '点按动作回流', action: 'demo.tap' },
    ] },
  ];
};

/** Stage one variant's arguments document for STREAMING: the opener
 * announces the pen identity AND the slot plan (the top-level children
 * count) so the client can ghost the not-yet-arrived parts from frame one;
 * each later chunk closes exactly one top-level child; the closer seals the
 * document. chunks.join('') === JSON.stringify(doc), so the durable
 * tool/call carries byte-identical arguments to what the stream built —
 * the invariant the e2e leg pins. */
export const swarmStagedArguments = (variant) => {
  const spec = {
    spec: 'app-shell/0.9', theme: { accent: variant.accent, mode: 'light' },
    tabs: variant.tabs, actions: ['demo.tap'],
    screen: { type: 'column', children: variant.children },
  };
  const doc = {
    swarm: {
      slot: variant.slot, of: 3, pen: variant.pen,
      accent: variant.accent, slots: variant.children.length,
    },
    spec,
  };
  const opener = '{"swarm":' + JSON.stringify(doc.swarm) + ',"spec":'
    + JSON.stringify({ spec: spec.spec, theme: spec.theme, tabs: spec.tabs, actions: spec.actions })
      .replace(/\}$/, ',"screen":{"type":"column","children":[');
  const chunks = [opener];
  variant.children.forEach((child, i) => {
    chunks.push(JSON.stringify(child) + (i < variant.children.length - 1 ? ',' : ''));
  });
  chunks.push(']}}}');
  return { doc, chunks };
};

export const SWARM_FRAME_GAP_MS = 260;
const SWARM_PROMPT_RE = /swarm|蜂群|(三个|三张|三支|3\s*个|3\s*张)[\s\S]{0,12}(方案|变体|设计)/i;

/** The swarm turn: three appshell_render builders stream their staged
 * arguments INTERLEAVED (round-robin by stage, so all three cards grow
 * together — the swarm read), then the durable settle lands one tool/call +
 * tool/result per variant (the timeline keeps its normal cards; the
 * conversation flow is never replaced). frameGapMs paces the stream slowly
 * enough that the progressive-render window is deterministically observable. */
export const swarmScriptFor = (turn, promptText, attemptId) => {
  if (!SWARM_PROMPT_RE.test(promptText)) return null;
  const variants = swarmVariants();
  const staged = variants.map(swarmStagedArguments);
  const callId = (v) => `dev-swarm${turn}-${v + 1}`;
  const text = '三支彩笔并行起稿：**'
    + variants.map((v) => `${v.title}（${v.pen}）`).join('、')
    + '**。变体卡生成中——已闭合的组件即时可见，虚线幽灵框是尚未到达的部分；点一张完成的卡可放大为全屏表面。';
  const stream = [
    { type: 'start', attemptId, turn, step: 1 },
    { type: 'chunk', attemptId, chunk: { type: 'text-delta', index: 0, text } },
  ];
  const stages = Math.max(...staged.map((s) => s.chunks.length));
  for (let s = 0; s < stages; s += 1) {
    staged.forEach((entry, v) => {
      if (entry.chunks[s] === undefined) return;
      stream.push({ type: 'chunk', attemptId, chunk: {
        type: 'tool-call-delta', index: v + 1, id: callId(v),
        ...(s === 0 ? { name: 'appshell_render' } : {}),
        argumentsDelta: entry.chunks[s],
      } });
    });
  }
  stream.push({ type: 'end', attemptId });
  const settle = [
    { type: 'assistant/message', data: { turn, step: 1, message: { role: 'assistant', content: [{ type: 'text', text }] } } },
  ];
  staged.forEach((entry, v) => {
    settle.push({ type: 'tool/call', data: { turn, step: 1, callId: callId(v), name: 'appshell_render', arguments: entry.chunks.join('') } });
    settle.push({ type: 'tool/result', data: { turn, step: 1, message: { role: 'user', content: [{ type: 'tool-result', toolCallId: callId(v), isError: false, content: [{ type: 'text', text: JSON.stringify({ ok: true, title: variants[v].title, surfaceId: `dev-swarm-${turn}-${v + 1}`, spec: entry.doc.spec }) }] }] } } });
  });
  settle.push(
    { type: 'step/end', data: { turn, step: 1 } },
    { type: 'turn/end', data: { turn, reason: { kind: 'stop' } } },
    { type: 'session/title', data: { title: '三个音乐 app 方案 · 蜂群' } },
  );
  return {
    steps: [
      { type: 'turn/start', data: { turn } },
      { type: 'step/start', data: { turn, step: 1 } },
    ],
    stream, settle, frameGapMs: SWARM_FRAME_GAP_MS,
  };
};
