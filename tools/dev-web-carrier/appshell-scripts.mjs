// dsh:logging-exempt (carrier script table: data + pure builders)
/**
 * appshell-scripts.mjs — the dev carrier's app-shell turn scripts, split
 * from next-mode.mjs at the code-size gate: the three product themes
 * (render), the M3 incremental loop-back answer (update), and the M4
 * hostile text-safety fixture — all pure (turn, prompt, attemptId) →
 * script, exported for the e2e legs to measure the exact wire bytes.
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
