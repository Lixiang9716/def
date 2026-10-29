// dsh:logging-exempt — pure logic; logging stays in the caller (plugin index.js / scenarios).
/**
 * app-shell/0.9 component catalog: the two-layer vocabulary contract.
 *
 * Layer 1 — PRIMITIVES: the only vocabulary that renders. v0 ships the
 * demo-proven eight; the M0 three-source inventory (A2UI v0.9 ∩ x-card ∩
 * Lynx genui) gates additions — a primitive joins only when it is in that
 * intersection, keeping the cross-renderer promise true by construction.
 *
 * Layer 2 — TEMPLATES: authoring sugar. Every template has an expand()
 * that compiles it to a pure primitive tree; the validator runs expand()
 * on every template node, so a template can never smuggle a non-primitive
 * past the whitelist. Cross-renderer compatibility is thereby structural.
 *
 * This file is the single owner of the vocabulary. Component render
 * functions live in lib/render/<name>.js and register through the maps
 * below; they never widen the vocabulary themselves.
 */

export const SPEC_VERSION = 'app-shell/0.9';

/** Hard caps (gate 3). A spec breaching any of these is rejected wholesale. */
export const CAPS = {
  SPEC_BYTES: 32 * 1024,
  NODES: 200,
  DEPTH: 8,
  TEXT_RUNES: 500,
  CHILDREN: 24,
};

/** Gate 4: actions are closed enums declared on the spec, never free strings. */
export const ACTION_RE = /^[a-z][a-z0-9.:-]{0,63}$/;

/**
 * The authoring rules the model actually sees — the appshell_render tool
 * description's operative prompt, single-sourced here so the benchmarks
 * measure the product prompt rather than a harness copy. The ACTION IDS
 * sentence is load-bearing: the validator enforces this exact grammar
 * (gate 4), and generation-time violations were the census's dominant
 * failure class until the format was stated with examples.
 */
export const RULES = 'Author an app-shell spec: {"spec":"' + SPEC_VERSION + '",theme:{accent,background,mode},tabs:[2..5 strings],actions:[ids],screen:node}. ' +
  'Node types (closed): text,image,button,row,column,card,progressbar,badge + templates search-bar,tab-bar,chat-row,service-grid,banner-card,hcard-row,balance-card,mini-player. ' +
  'ACTION IDS are dot.case ASCII matching ' + ACTION_RE.source + ' — like "player.toggle", "order.pay", "flash.sale": start with a lowercase letter, use only a-z 0-9 . : - inside; NEVER Chinese, spaces, underscores or uppercase (button labels may be Chinese; ids may not) — the classic slip is camelCase after a dot: "playAll"→"playall", "markAllRead"→"markallread", every rune after each dot stays lowercase. ' +
  'COVERAGE: inventory EVERY user operation the request names and give each one an action id plus a visible entry (button/tab/grid item) — account settings, registration, history, export, print all get one; a capability without an entry does not exist. ' +
  'COLORS: when the request names a standard color, use its EXACT CSS hex, never an approximation or an invented tone — chocolate #D2691E, indian red #CD5C5C, dim gray #696969, lemon chiffon #FFFACD, peach puff #FFDAB9, snow #FFFAFA, seashell #FFF5EE, linen #FAF0E6, mint cream #F5FFFA, cornsilk #FFF8DC, lavender #E6E6FA, azure #F0FFFF, aliceblue #F0F8FF, ivory #FFFFF0, beige #F5F5DC, gold #FFD700. The COMPONENT-color ask goes to theme.accent, the BACKGROUND-color ask goes to theme.background — e.g. "background lemon chiffon, components chocolate" → {"accent":"#D2691E","background":"#FFFACD"}. When the request names the background color, theme.background is that name\u0027s EXACT hex — NEVER invent a harmonious tone; the harmonious-light-background fallback applies ONLY when no background color is named (for a non-standard name like "azure mist" or "light goldenrod", use the closest standard color\u0027s hex — azure #F0FFFF, lightgoldenrodyellow #FAFAD2 — and never a near-miss tone you invent). ' +
  'Every button.action must be declared in actions. Text fields are plain text. Call appshell_catalog for the full rules. ' +
  'Design constitution — the target device is a PHONE (390x844 portrait, touch, one-handed): ' +
  '一屏一主角: screen.children[0] 必须是 banner-card hero 或大封面 hcard-row; 顶层 4-6 块, 主角块视觉重量≥其余总和; 嵌套≤3 层(模板算一层). ' +
  '色彩统治: 第一屏大面积被彩色 hero 与封面占据; hero 用最深色混 accent 的浓色场; theme.accent 全屏 ≤2 点位(主 CTA+活动处); 音乐/夜间类 theme.mode="dark". ' +
  '文案真实: 具体数字与真实名目("¥1,920"), 禁占位词; 标题≤10字、按钮 2-4 字动词; emoji 只做内容一屏≤4. ' +
  '字阶与数字主角: title 是海报, 全屏 ≤3 处(hero 主标题+数字主角); 数字/金额/进度用 title 档放大. ' +
  '封面成套: hcard-row 每项 cover 带 color, 4 色板逐项错开; 卡片配 image(emoji+color) 锚点. ' +
  '移动模板 ≥2 种; tabs 2-5 个每个≤4字; 不做桌面形态.';

/** PRIMITIVE registry: name -> render(node, ctx) -> VNode (lib/render/<name>.js). */
export const primitives = new Map();

/** Gate-1 whitelist: the closed primitive vocabulary (single source of truth). */
export const KNOWN_PRIMITIVES = ['text', 'image', 'button', 'row', 'column', 'card', 'progressbar', 'badge'];

/** TEMPLATE registry: name -> { expand(node) -> primitive node }. */
export const templates = new Map();

export function definePrimitive(name, render) {
  primitives.set(name, render);
}

export function defineTemplate(name, def) {
  templates.set(name, def);
}

/** Primitive node factory — what expand() produces and validate() whitelists. */
export function p(type, fields) {
  return { type, ...fields };
}

/* ---------------------------------------------------------------- */
/* Templates (layer 2): demo-proven eight, each expands to primitives. */
/* Colors ride theme.accent / explicit per-item colors as plain style  */
/* values — the validator treats them as inert strings (gate 2).       */
/* ---------------------------------------------------------------- */

defineTemplate('search-bar', {
  expand: (n) => p('card', { style: { borderRadius: '14px', padding: '6px 10px' }, children: [
    p('text', { text: '🔍 ' + String(n.placeholder || '搜索'), size: 'small', tone: 'muted' }),
  ] }),
});

defineTemplate('tab-bar', {
  expand: (n) => p('row', { children: (n.tabs || []).map((t, i) => p('badge', {
    text: t.label + (i === (n.active || 0) ? ' ·' : ''),
  })) }),
});

defineTemplate('chat-row', {
  expand: (n) => p('row', { children: [
    p('badge', { text: (n.avatar && n.avatar.emoji) || '💬' }),
    p('column', { children: [
      p('text', { text: String(n.name || ''), size: 'body' }),
      p('text', { text: String(n.preview || ''), size: 'small', tone: 'muted' }),
    ] }),
    p('text', { text: String(n.time || ''), size: 'small', tone: 'muted' }),
  ] }),
});

defineTemplate('service-grid', {
  expand: (n) => {
    const items = (n.items || []).slice(0, 8).map((it) => p('column', { children: [
      p('badge', { text: (it.icon || '·') }),
      p('text', { text: String(it.label || ''), size: 'small' }),
    ] }));
    const rows = [];
    for (let i = 0; i < items.length; i += 4) rows.push(p('row', { children: items.slice(i, i + 4) }));
    return p('card', { children: rows });
  },
});

defineTemplate('banner-card', {
  expand: (n) => p('card', { children: [
    p('text', { text: String(n.title || ''), size: 'title' }),
    p('text', { text: String(n.subtitle || ''), size: 'small', tone: 'muted' }),
  ] }),
});

defineTemplate('hcard-row', {
  expand: (n) => p('row', { children: (n.items || []).slice(0, 6).map((it) => p('card', { children: [
    p('image', { emoji: (it.cover && it.cover.emoji) || '🎵', color: (it.cover && it.cover.color) || '#1677ff' }),
    p('text', { text: String(it.title || ''), size: 'small' }),
    p('text', { text: String(it.sub || ''), size: 'small', tone: 'muted' }),
  ] })) }),
});

defineTemplate('balance-card', {
  expand: (n) => {
    const kids = [
      p('text', { text: String(n.label || ''), size: 'small', tone: 'muted' }),
      p('text', { text: String(n.value || ''), size: 'title' }),
    ];
    if (n.actionLabel) kids.push(p('button', { label: String(n.actionLabel), action: n.action || 'balance.open' }));
    return p('card', { children: kids });
  },
});

defineTemplate('mini-player', {
  expand: (n) => {
    const kids = [
      p('image', { emoji: (n.cover && n.cover.emoji) || '🎵', color: (n.cover && n.cover.color) || '#1677ff' }),
      p('column', { children: [
        p('text', { text: String(n.title || ''), size: 'body' }),
        p('text', { text: String(n.sub || ''), size: 'small', tone: 'muted' }),
      ] }),
    ];
    if (n.action) kids.push(p('button', { label: '▶', action: n.action }));
    return p('card', { children: kids });
  },
});
