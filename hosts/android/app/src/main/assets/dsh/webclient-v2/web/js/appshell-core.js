// dsh:logging-exempt (web page: all E2E evidence flows through carrier/runtime logs)
/**
 * appshell-core.js — the client-side half of the app-shell/0.9 contract,
 * kept DOM-free so vitest covers it in plain node:
 *
 *   expandSpec(spec)  templates → pure primitive tree (mirrors the plugin's
 *                     catalog expanders; both sides must stay in lockstep)
 *   checkShallow(spec) defensive re-validation: whitelist, caps, action grammar
 *
 * The four authoritative gates live plugin-side (system-plugins/dsh-appshell/
 * lib/validate.js); this file never trusts what it is handed — a spec that
 * somehow arrived hostile still cannot render a non-catalog type.
 */

const PRIMITIVES = new Set(['text', 'image', 'button', 'row', 'column', 'card', 'progressbar', 'badge']);
const CAPS = { SPEC_BYTES: 32 * 1024, NODES: 200, DEPTH: 8, TEXT_RUNES: 500, CHILDREN: 24 };
const ACTION_RE = /^[a-z][a-z0-9.:-]{0,63}$/;

const TEMPLATES = {
  'search-bar': (n) => ({ type: 'card', style: { borderRadius: '14px', padding: '6px 10px' }, children: [{ type: 'text', text: '🔍 ' + String(n.placeholder || '搜索'), size: 'small', tone: 'muted' }] }),
  'tab-bar': (n) => ({ type: 'row', children: (n.tabs || []).map((t, i) => ({ type: 'badge', text: t.label + (i === (n.active || 0) ? ' ·' : '') })) }),
  'chat-row': (n) => ({ type: 'row', children: [
    { type: 'badge', text: (n.avatar && n.avatar.emoji) || '💬' },
    { type: 'column', children: [
      { type: 'text', text: String(n.name || ''), size: 'body' },
      { type: 'text', text: String(n.preview || ''), size: 'small', tone: 'muted' },
    ] },
    { type: 'text', text: String(n.time || ''), size: 'small', tone: 'muted' },
  ] }),
  'service-grid': (n) => {
    const items = (n.items || []).slice(0, 8).map((it) => ({ type: 'column', children: [
      { type: 'badge', text: it.icon || '·' },
      { type: 'text', text: String(it.label || ''), size: 'small' },
    ] }));
    const rows = [];
    for (let i = 0; i < items.length; i += 4) rows.push({ type: 'row', children: items.slice(i, i + 4) });
    return { type: 'card', children: rows };
  },
  'banner-card': (n) => ({ type: 'card', children: [
    { type: 'text', text: String(n.title || ''), size: 'title' },
    { type: 'text', text: String(n.subtitle || ''), size: 'small', tone: 'muted' },
  ] }),
  'hcard-row': (n) => ({ type: 'row', children: (n.items || []).slice(0, 6).map((it) => ({ type: 'card', children: [
    { type: 'image', emoji: (it.cover && it.cover.emoji) || '🎵', color: (it.cover && it.cover.color) || '#1677ff' },
    { type: 'text', text: String(it.title || ''), size: 'small' },
    { type: 'text', text: String(it.sub || ''), size: 'small', tone: 'muted' },
  ] })) }),
  'balance-card': (n) => {
    const kids = [
      { type: 'text', text: String(n.label || ''), size: 'small', tone: 'muted' },
      { type: 'text', text: String(n.value || ''), size: 'title' },
    ];
    if (n.actionLabel) kids.push({ type: 'button', label: String(n.actionLabel), action: n.action || 'balance.open' });
    return { type: 'card', children: kids };
  },
  'mini-player': (n) => {
    const kids = [
      { type: 'image', emoji: (n.cover && n.cover.emoji) || '🎵', color: (n.cover && n.cover.color) || '#1677ff' },
      { type: 'column', children: [
        { type: 'text', text: String(n.title || ''), size: 'body' },
        { type: 'text', text: String(n.sub || ''), size: 'small', tone: 'muted' },
      ] },
    ];
    if (n.action) kids.push({ type: 'button', label: '▶', action: n.action });
    return { type: 'card', children: kids };
  },
};

/** Expand templates to a pure primitive tree (structure mirrors the plugin). */
export function expandSpec(spec) {
  const errors = [];
  let nodes = 0;
  const expand = (node, path, depth) => {
    if (!node || typeof node !== 'object') { errors.push({ code: 'BAD_FIELD', path }); return null; }
    nodes += 1;
    if (nodes > CAPS.NODES) { errors.push({ code: 'NODE_OVERFLOW', path }); return null; }
    if (depth > CAPS.DEPTH) { errors.push({ code: 'DEPTH_OVERFLOW', path }); return null; }
    const type = node.type;
    if (typeof type !== 'string') { errors.push({ code: 'BAD_FIELD', path: path + '.type' }); return null; }
    if (TEMPLATES[type]) {
      let expanded;
      try { expanded = TEMPLATES[type](node); } catch { errors.push({ code: 'EXPAND_FAILED', path }); return null; }
      if (!expanded || TEMPLATES[expanded.type]) { errors.push({ code: 'EXPAND_FAILED', path }); return null; }
      return expand(expanded, path, depth + 1);
    }
    if (!PRIMITIVES.has(type)) { errors.push({ code: 'UNKNOWN_TYPE', path }); return null; }
    const out = { ...node };
    if (Array.isArray(node.children)) {
      if (node.children.length > CAPS.CHILDREN) { errors.push({ code: 'NODE_OVERFLOW', path: path + '.children' }); return null; }
      const kids = node.children.map((c, i) => expand(c, path + '.children[' + i + ']', depth + 1));
      if (kids.some((c) => c === null)) return null;
      out.children = kids;
    }
    return out;
  };
  const screen = spec && typeof spec === 'object' ? expand(spec.screen, '$.screen', 1) : null;
  return { screen, errors };
}

/** Defensive client-side re-check: the plugin gates authoritatively; this
 * never renders a non-catalog type even if a hostile payload arrived. */
export function checkShallow(spec) {
  const errors = [];
  if (!spec || typeof spec !== 'object') return { ok: false, errors: [{ code: 'BAD_FIELD', path: '$' }] };
  if (spec.spec !== 'app-shell/0.9') errors.push({ code: 'BAD_FIELD', path: '$.spec' });
  if (!Array.isArray(spec.tabs) || spec.tabs.length < 2 || spec.tabs.length > 5) errors.push({ code: 'BAD_FIELD', path: '$.tabs' });
  if (JSON.stringify(spec).length > CAPS.SPEC_BYTES) errors.push({ code: 'SPEC_TOO_LARGE', path: '$' });
  const expanded = expandSpec(spec);
  errors.push(...expanded.errors);
  return { ok: errors.length === 0 && expanded.screen !== null, errors, screen: expanded.screen };
}

/** Merge an INCREMENTAL update payload over the spec the open surface was
 * rendered from — the client twin of the plugin's mergeUpdate (the two must
 * stay in lockstep; the panel suite pins them equal on shared inputs).
 * `screen` replaces the tree, the rest overrides only when present. */
export function mergeUpdate(current, partial) {
  if (!partial || typeof partial !== 'object') return null;
  return {
    ...current,
    ...(partial.theme !== undefined ? { theme: partial.theme } : {}),
    ...(partial.tabs !== undefined ? { tabs: partial.tabs } : {}),
    ...(partial.actions !== undefined ? { actions: partial.actions } : {}),
    screen: partial.screen,
  };
}

// ---- swarm: staged spec arrival ---------------------------------------------

const CLOSERS = { '{': '}', '[': ']' };
const HEX_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;

/** The lenient-JSON scan: walks a streamed tool-arguments prefix and returns
 * {certain, stack} — `certain` is the length of the longest slice that
 * closes into valid JSON built from COMPLETE values only. A value counts
 * as complete when its terminator has arrived (closing quote, closing
 * bracket, or a number/literal followed by a delimiter); a number at EOF
 * might still grow digits, so it is dropped. Everything after `certain` is
 * still in flight — a half-arrived child never surfaces as if it were
 * closed. This is the ghost-tree half of the progressive render. */
function scanCertainEnd(text) {
  const stack = [];
  let marked = []; // the stack AS OF the last certain point — repairs close THIS
  let certain = 0;
  let last = ''; // last significant char: ':' marks the next string a VALUE, not a key
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { i += 1; continue; }
    if (ch === '{' || ch === '[') { stack.push(ch); last = ch; i += 1; continue; }
    if ((ch === '}' || ch === ']') && stack.length > 0) {
      stack.pop(); i += 1; certain = i; marked = [...stack]; continue;
    }
    if (ch === ',' || ch === ':') { last = ch; i += 1; continue; }
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      if (j >= text.length) return { certain, stack: marked }; // string still open
      i = j + 1;
      if (last !== ':' && stack[stack.length - 1] === '{') continue; // object key
      certain = i; last = '"'; marked = [...stack]; continue; // complete string value
    }
    let j = i; // number / literal run: complete only under a delimiter
    while (j < text.length && /[0-9a-zA-Z+.\-]/.test(text[j])) j += 1;
    if (j === i) return { certain, stack: marked }; // unrecognized char: stop honestly
    let k = j;
    while (k < text.length && ' \t\n\r'.includes(text[k])) k += 1;
    const next = text[k];
    if (next !== ',' && next !== '}' && next !== ']') return { certain, stack: marked };
    i = j; last = text[i - 1];
    if (next === ',') { certain = i; marked = [...stack]; } // '}' / ']' commit via the close branch next loop
  }
  return { certain, stack: marked };
}

/** Lenient JSON-prefix parse: the maximal certainly-complete value of a
 * streamed JSON document, or null when nothing complete has arrived. Never
 * throws on partial or hostile input — the worst case is a dropped tail. */
export function parseJsonPrefix(text) {
  if (typeof text !== 'string' || text === '') return null;
  const { certain, stack } = scanCertainEnd(text);
  if (certain === 0) return null;
  const closers = [...stack].reverse().map((open) => CLOSERS[open]).join('');
  const candidate = text.slice(0, certain) + closers;
  try { return JSON.parse(candidate); } catch { /* fall through */ }
  try { return JSON.parse(candidate.replace(/,\s*([}\]])/g, '$1')); } catch { return null; }
}

/** One swarm variant's card model, folded from its ACCUMULATED tool
 * arguments (the staged stream): pen identity, the certainly-closed
 * top-level children, and the ghost slots still to come (the opener
 * announces `slots` — the plan; ghosts = slots − closed). Pure — the DOM
 * half (appshell.js) renders this; the webclient suite pins the cuts.
 * Non-swarm arguments (the theme fixture's {"fixture":…}) answer null. */
export function swarmCardModel(argsText) {
  const doc = parseJsonPrefix(argsText);
  const meta = doc && doc.swarm;
  if (!meta || typeof meta !== 'object' || typeof meta.pen !== 'string' || meta.pen === '') return null;
  const children = doc?.spec?.screen?.children;
  const closed = (Array.isArray(children) ? children : []).slice(0, CAPS.CHILDREN);
  const slots = Math.max(0, Math.min(CAPS.CHILDREN, Math.floor(Number(meta.slots) || 0)));
  return {
    pen: meta.pen.slice(0, 40),
    accent: typeof meta.accent === 'string' && HEX_COLOR_RE.test(meta.accent) ? meta.accent : '#8a8f98',
    slot: Math.floor(Number(meta.slot) || 0),
    of: Math.floor(Number(meta.of) || 0),
    slots,
    closed,
    ghosts: Math.max(0, slots - closed.length),
    growth: Math.min(closed.length, slots),
  };
}
