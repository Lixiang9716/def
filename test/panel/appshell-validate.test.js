// M1 acceptance table for the app-shell/0.9 validator:
//   valid   >= 10, all pass
//   malicious >= 16 (four classes x >= 4), 100% rejected with structured codes
// Coverage target: lib/validate.js + lib/catalog.js expanders at 100% lines.
import { afterAll, describe, it, expect } from 'vitest';
import { validate } from '../../system-plugins/dsh-appshell/lib/validate.js';
import { renderSpec } from '../../system-plugins/dsh-appshell/lib/render.js';
import { defineTemplate, templates } from '../../system-plugins/dsh-appshell/lib/catalog.js';
import { FIXTURES } from '../../system-plugins/dsh-appshell/lib/mock.js';

// 递归/链式模板：仅本文件注册（vitest 文件隔离），测完清理
defineTemplate('expand-recursion', { expand: () => ({ type: 'column', children: [{ type: 'expand-recursion' }] }) });
for (let i = 0; i < 12; i++) {
  const next = 'chain-' + (i + 1);
  defineTemplate('chain-' + i, { expand: () => ({ type: next }) });
}
afterAll(() => {
  for (const t of ['expand-recursion', ...Array.from({ length: 12 }, (_, i) => 'chain-' + i)]) templates.delete(t);
});

const V = 'app-shell/0.9';
const okSpec = (screen, extra) => ({
  spec: V, theme: { accent: '#1677FF', mode: 'light' },
  tabs: ['首页', '我的'], actions: ['a.open'], screen, ...extra,
});

const VALID = [
  ['three fixtures', Object.values(FIXTURES)],
  ['all eight primitives', okSpec({ type: 'column', children: [
    { type: 'text', text: '标题', size: 'title' },
    { type: 'image', emoji: '🖼', color: '#5a7cd4' },
    { type: 'button', label: '打开', action: 'a.open' },
    { type: 'row', children: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] },
    { type: 'card', children: [{ type: 'text', text: '卡内' }] },
    { type: 'progressbar', label: '进度', value: 42 },
    { type: 'badge', text: '新' },
    { type: 'column', children: [{ type: 'text', text: '尾' }] },
  ] })],
  ['all eight templates', okSpec({ type: 'column', children: [
    { type: 'search-bar', placeholder: '搜索' },
    { type: 'tab-bar', tabs: [{ label: '一' }, { label: '二' }], active: 0 },
    { type: 'chat-row', avatar: { emoji: '张', color: '#5a7cd4' }, name: '张伟', preview: '在吗', time: '9:41' },
    { type: 'service-grid', items: [{ icon: '📷', label: '扫' }, { icon: '💳', label: '付' }, { icon: '🚌', label: '行' }, { icon: '⚡', label: '充' }] },
    { type: 'banner-card', title: '横幅', subtitle: '副标' },
    { type: 'hcard-row', items: [{ cover: { emoji: '🌙', color: '#123' }, title: '卡一', sub: 's' }] },
    { type: 'balance-card', label: '余额', value: '8,482.10', actionLabel: '转入', action: 'a.open' },
    { type: 'mini-player', cover: { emoji: '🎧', color: '#333' }, title: '夜航星', sub: '播放中', action: 'a.open' },
  ] })],
  ['deep but within cap (7 levels)', okSpec((function nest(d) {
    return d === 0 ? { type: 'text', text: '底' } : { type: 'column', children: [nest(d - 1)] };
  })(6))],
  ['193 nodes (one under the 200 cap, <=24 children per node)', okSpec((function many() {
    const groups = [];
    for (let g = 0; g < 8; g++) {
      const texts = [];
      for (let i = 0; i < 23; i++) texts.push({ type: 'text', text: 'g' + g + '-' + i });
      groups.push({ type: 'column', children: texts });
    }
    return { type: 'column', children: groups };
  })())],
  ['~29KB spec (under byte cap, every field <=500 runes)', okSpec({ type: 'column', children: Array.from({ length: 3 }, (_, g) => (
    { type: 'column', children: Array.from({ length: 20 }, (_, i) => ({ type: 'text', text: 'x'.repeat(490) + '-' + g + '-' + i })) }
  )) })],
  ['tabs at minimum (2)', okSpec({ type: 'text', text: 'hi' }, { tabs: ['一', '二'] })],
  ['no actions declared, no buttons', okSpec({ type: 'text', text: '纯展示' })],
];

const MALICIOUS = [
  // class 1: unknown types (x4)
  ['unknown type', okSpec({ type: 'iframe', src: 'https://evil.example' }), 'UNKNOWN_TYPE'],
  ['unknown script type', okSpec({ type: 'script', code: 'fetch("//evil")' }), 'UNKNOWN_TYPE'],
  ['template-smuggled unknown', okSpec({ type: 'column', children: [{ type: 'webview', url: 'https://evil.example' }] }), 'UNKNOWN_TYPE'],
  ['typo near-miss', okSpec({ type: 'colum', children: [] }), 'UNKNOWN_TYPE'],
  // class 2: bad fields & structure (x4) — markup-in-text is NOT here: it is
  // accepted and rendered inert by construction (see the inertness describe).
  ['template action undeclared', okSpec({ type: 'balance-card', label: '余额', value: '1.00', actionLabel: '转入', action: 'a.undeclared' }), 'BAD_ACTION'],
  ['tabs empty', { spec: V, theme: { accent: '#123456' }, tabs: [], screen: { type: 'text', text: 'x' } }, 'BAD_FIELD'],
  ['25 children in one row', okSpec({ type: 'row', children: Array.from({ length: 25 }, (_, i) => ({ type: 'text', text: 'c' + i })) }), 'NODE_OVERFLOW'],
  ['spec as string', 'not an object', 'BAD_FIELD'],
  ['structural template recursion', okSpec({ type: 'expand-recursion' }), 'EXPAND_FAILED'],
  ['template chain beyond depth cap', okSpec({ type: 'chain-0' }), 'EXPAND_FAILED'],
  // class 3: size caps (x4)
  ['oversized text field', okSpec({ type: 'text', text: 'x'.repeat(501) }), 'TEXT_TOO_LONG'],
  ['201 nodes', okSpec((function many() {
    const kids = [];
    for (let i = 0; i < 67; i++) kids.push({ type: 'row', children: [{ type: 'text', text: 'r' + i }, { type: 'badge', text: '·' }, { type: 'text', text: 's' + i }] });
    return { type: 'column', children: kids };
  })()), 'NODE_OVERFLOW'],
  ['9 levels deep', okSpec((function nest(d) {
    return d === 0 ? { type: 'text', text: '底' } : { type: 'column', children: [nest(d - 1)] };
  })(8)), 'DEPTH_OVERFLOW'],
  ['33KB serialized', okSpec({ type: 'column', children: Array.from({ length: 20 }, (_, i) => (
    { type: 'text', text: 'x'.repeat(1700) + i }
  )) }), 'SPEC_TOO_LARGE'],
  // class 4: action escape + bad fields (x4)
  ['undeclared action', okSpec({ type: 'button', label: '开', action: 'a.undeclared' }), 'BAD_ACTION'],
  ['action grammar escape', okSpec({ type: 'button', label: '开', action: 'DROP TABLE users', actions: ['DROP TABLE users'] }), 'BAD_ACTION'],
  ['wrong theme type', { spec: V, theme: 'dark', tabs: ['一', '二'], screen: { type: 'text', text: 'x' } }, 'BAD_FIELD'],
  ['tabs as string', { spec: V, theme: { accent: '#123456' }, tabs: '首页', screen: { type: 'text', text: 'x' } }, 'BAD_FIELD'],
];

describe('app-shell/0.9 validator — valid specs (M1: >=10, all pass)', () => {
  let n = 0;
  for (const [name, specs] of VALID) {
    for (const [i, spec] of [].concat(specs).entries()) {
      n += 1;
      it('valid #' + n + ': ' + name + (Array.isArray(specs) && specs.length > 1 ? ' #' + (i + 1) : ''), () => {
        const r = validate(spec);
        expect(r.ok, JSON.stringify(r.errors)).toBe(true);
        expect(r.errors).toHaveLength(0);
        expect(r.expanded).not.toBeNull();
      });
    }
  }
  it('valid table meets the M1 floor (>=10)', () => { expect(n).toBeGreaterThanOrEqual(10); });
});

describe('app-shell/0.9 validator — malicious specs (M1: >=16, 100% rejected)', () => {
  let n = 0;
  for (const [name, spec, code] of MALICIOUS) {
    n += 1;
    it('malicious #' + n + ': ' + name, () => {
      const r = validate(spec);
      expect(r.ok).toBe(false);
      expect(r.errors.length).toBeGreaterThan(0);
      expect(r.expanded).toBeNull();
      for (const e of r.errors) {
        expect(typeof e.code).toBe('string');
        expect(typeof e.path).toBe('string');
        expect(typeof e.msg).toBe('string');
      }
      if (code) expect(r.errors.some((e) => e.code === code)).toBe(true);
    });
  }
  it('malicious table meets the M1 floor (>=16)', () => { expect(n).toBeGreaterThanOrEqual(16); });
});

describe('app-shell/0.9 — markup in text is inert by construction (accepted, never executes)', () => {
  const cases = [
    ['script tag in text', okSpec({ type: 'text', text: '<script>alert(1)</script>' }), '<script>alert(1)</script>'],
    ['event handler in text', okSpec({ type: 'text', text: '<img src=x onerror=alert(1)>' }), '<img src=x onerror=alert(1)>'],
    ['quote break in button label', okSpec({ type: 'button', label: '点我" onclick="alert(1)', action: 'a.open' }), '点我" onclick="alert(1)'],
    ['markup in template field', okSpec({ type: 'chat-row', name: '<b>粗体</b>', preview: '<i>x</i>', time: 't' }), '<b>粗体</b>'],
  ];
  for (const [name, spec, literal] of cases) {
    it(name + ' — accepted and preserved verbatim as text', () => {
      const r = validate(spec);
      expect(r.ok, JSON.stringify(r.errors)).toBe(true);
      const rendered = renderSpec(spec);
      expect(rendered.ok).toBe(true);
      const texts = [];
      (function walk(n) { if (n.props && n.props.text !== undefined) texts.push(n.props.text); for (const c of n.children || []) walk(c); })(rendered.vnode);
      expect(texts.some((t) => t.includes(literal))).toBe(true);
    });
  }
});
