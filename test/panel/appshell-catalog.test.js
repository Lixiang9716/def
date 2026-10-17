// Expansion-contract tests for the app-shell/0.9 two-layer catalog:
//   1. Each of the eight built-in templates (catalog.js layer 2) validates
//      AND its expanded tree contains NO template type — every node is a
//      KNOWN_PRIMITIVES member (layer 1). "Templates are authoring sugar;
//      only primitives render" is checked mechanically on validate()'s
//      expanded output.
//   2. A non-expandable pseudo-template — one whose expand() returns a
//      template node, throws, or returns null — is rejected with
//      EXPAND_FAILED. Each pseudo-template is registered with
//      defineTemplate() inside its test and removed with templates.delete()
//      in a finally block, restoring the registry to the eight built-ins.
import { describe, it, expect } from 'vitest';
import { validate } from '../../system-plugins/dsh-appshell/lib/validate.js';
import {
  templates, KNOWN_PRIMITIVES, defineTemplate, p,
} from '../../system-plugins/dsh-appshell/lib/catalog.js';

const V = 'app-shell/0.9';
const okSpec = (screen) => ({
  spec: V, theme: { accent: '#1677FF', mode: 'light' },
  tabs: ['首页', '我的'], actions: ['a.open'], screen,
});

const BUILTIN_TEMPLATES = [
  'search-bar', 'tab-bar', 'chat-row', 'service-grid',
  'banner-card', 'hcard-row', 'balance-card', 'mini-player',
];

/** Every node.type in an expanded tree, in order. */
const collectTypes = (node, acc = []) => {
  if (!node || typeof node !== 'object') return acc;
  if (typeof node.type === 'string') acc.push(node.type);
  for (const c of node.children || []) collectTypes(c, acc);
  return acc;
};

/** Every text-bearing string (text / label fields) in an expanded tree. */
const collectStrings = (node, acc = []) => {
  if (!node || typeof node !== 'object') return acc;
  if (typeof node.text === 'string') acc.push(node.text);
  if (typeof node.label === 'string') acc.push(node.label);
  for (const c of node.children || []) collectStrings(c, acc);
  return acc;
};

// [template type, minimal node, expected root primitive after expand,
//  a source string that must survive into the expanded tree]
const TEMPLATE_CASES = [
  ['search-bar',
    { type: 'search-bar', placeholder: '站内搜索' }, 'card', '站内搜索'],
  ['tab-bar',
    { type: 'tab-bar', tabs: [{ label: '首页' }, { label: '发现' }, { label: '我的' }], active: 1 },
    'row', '发现 ·'],
  ['chat-row',
    { type: 'chat-row', avatar: { emoji: '张', color: '#5a7cd4' }, name: '张伟', preview: '晚上吃饭吗', time: '9:41' },
    'row', '晚上吃饭吗'],
  ['service-grid',
    { type: 'service-grid', items: [
      { icon: '📷', label: '扫一扫' }, { icon: '💳', label: '收付款' }, { icon: '🚌', label: '出行' }, { icon: '⚡', label: '充值' },
      { icon: '🎮', label: '游戏' }, { icon: '📚', label: '阅读' },
    ] }, 'card', '扫一扫'],
  ['banner-card',
    { type: 'banner-card', title: '会员日', subtitle: '限时五折' }, 'card', '限时五折'],
  ['hcard-row',
    { type: 'hcard-row', items: [
      { cover: { emoji: '🌙', color: '#223344' }, title: '夜航星', sub: '深夜电台' },
      { cover: { emoji: '🎧', color: '#334455' }, title: '白噪音', sub: '助眠' },
    ] }, 'row', '夜航星'],
  ['balance-card',
    { type: 'balance-card', label: '账户余额', value: '8,482.10', actionLabel: '转入', action: 'a.open' },
    'card', '8,482.10'],
  ['mini-player',
    { type: 'mini-player', cover: { emoji: '🎵', color: '#333333' }, title: '夜航星', sub: '正在播放', action: 'a.open' },
    'card', '正在播放'],
];

describe('app-shell/0.9 — the eight templates expand to pure primitive trees', () => {
  for (const [name, node, expectedRoot, mustContain] of TEMPLATE_CASES) {
    it('expand ' + name + ': validate() passes and the expanded tree has no template type', () => {
      // The input really is a registered template node (guards a vacuous test).
      expect(templates.has(name)).toBe(true);
      const r = validate(okSpec(node));
      expect(r.ok, JSON.stringify(r.errors)).toBe(true);
      expect(r.errors).toHaveLength(0);
      expect(r.expanded).not.toBeNull();
      // The template node itself is gone from the root position.
      expect(r.expanded.type).toBe(expectedRoot);
      const types = collectTypes(r.expanded);
      expect(types.length).toBeGreaterThan(0);
      for (const t of types) {
        // No registered template type anywhere in the expanded tree...
        expect(templates.has(t), 'template type "' + t + '" leaked into the expanded tree').toBe(false);
        // ...and nothing outside the closed primitive vocabulary.
        expect(KNOWN_PRIMITIVES, 'type "' + t + '" is not a primitive').toContain(t);
      }
      // Belt and braces against registry drift: none of the eight names either.
      expect(types.some((t) => BUILTIN_TEMPLATES.includes(t))).toBe(false);
      // Expansion really compiled the authoring fields across (not a stub).
      expect(collectStrings(r.expanded).some((s) => s.includes(mustContain))).toBe(true);
    });
  }
});

describe('app-shell/0.9 — non-expandable pseudo-templates are rejected with EXPAND_FAILED', () => {
  it('pseudo-template whose expand() returns a template node is rejected', () => {
    const name = 'pseudo-returns-template';
    expect(templates.has(name)).toBe(false); // guard: fresh name, safe to register
    defineTemplate(name, { expand: () => p('banner-card', { title: '走私', subtitle: 'x' }) });
    try {
      const r = validate(okSpec({ type: name }));
      expect(r.ok).toBe(false);
      expect(r.expanded).toBeNull();
      const hit = r.errors.find((e) => e.code === 'EXPAND_FAILED');
      expect(hit, JSON.stringify(r.errors)).toBeDefined();
      expect(hit.path).toBe('$.screen');
      expect(hit.msg).toContain('primitive');
    } finally {
      templates.delete(name); // restore the registry to its pre-test state
    }
    expect(templates.has(name)).toBe(false);
  });

  it('pseudo-template whose expand() throws is rejected', () => {
    const name = 'pseudo-throws';
    expect(templates.has(name)).toBe(false);
    defineTemplate(name, { expand: () => { throw new Error('boom: cannot compile'); } });
    try {
      const r = validate(okSpec({ type: name }));
      expect(r.ok).toBe(false);
      expect(r.expanded).toBeNull();
      const hit = r.errors.find((e) => e.code === 'EXPAND_FAILED');
      expect(hit, JSON.stringify(r.errors)).toBeDefined();
      expect(hit.path).toBe('$.screen');
      expect(hit.msg).toContain('boom: cannot compile');
    } finally {
      templates.delete(name);
    }
    expect(templates.has(name)).toBe(false);
  });

});

describe('app-shell/0.9 — pseudo-template registry hygiene', () => {
  it('pseudo-template whose expand() returns null is rejected', () => {    const name = 'pseudo-returns-null';
    expect(templates.has(name)).toBe(false);
    defineTemplate(name, { expand: () => null });
    try {
      const r = validate(okSpec({ type: name }));
      expect(r.ok).toBe(false);
      expect(r.expanded).toBeNull();
      expect(r.errors.some((e) => e.code === 'EXPAND_FAILED' && e.path === '$.screen')).toBe(true);
    } finally {
      templates.delete(name);
    }
    expect(templates.has(name)).toBe(false);
  });

  it('registry is restored: exactly the eight built-in templates remain', () => {
    expect([...templates.keys()].sort()).toEqual([...BUILTIN_TEMPLATES].sort());
  });
});
