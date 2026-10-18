// appshell-core tests: two-layer expansion, defensive re-check, and the
// security posture (markup inert by construction) — plain node, no DOM.
import { describe, it, expect } from 'vitest';
import { expandSpec, checkShallow, mergeUpdate } from '../../../presentation/web-client-v2/web/js/appshell-core.js';

const V = 'app-shell/0.9';
const base = (screen, tabs) => ({
  spec: V, theme: { accent: '#1677FF', mode: 'light' },
  tabs: tabs || ['一', '二'], actions: ['demo.tap'], screen,
});

describe('expandSpec — the eight templates expand to pure primitives', () => {
  const TEMPLATES = [
    ['search-bar', { placeholder: '搜索' }],
    ['tab-bar', { tabs: [{ label: '一' }, { label: '二' }], active: 0 }],
    ['chat-row', { avatar: { emoji: '张', color: '#123' }, name: '张伟', preview: '在吗', time: '9:41' }],
    ['service-grid', { items: [{ icon: '📷', label: '扫' }, { icon: '💳', label: '付' }, { icon: '🚌', label: '行' }, { icon: '⚡', label: '充' }] }],
    ['banner-card', { title: '横幅', subtitle: '副标' }],
    ['hcard-row', { items: [{ cover: { emoji: '🌙', color: '#123' }, title: '卡', sub: 's' }] }],
    ['balance-card', { label: '余额', value: '8,482.10', actionLabel: '转入', action: 'demo.tap' }],
    ['mini-player', { cover: { emoji: '🎧', color: '#333' }, title: '歌', sub: '播放中', action: 'demo.tap' }],
  ];
  for (const [name, fields] of TEMPLATES) {
    it('expands ' + name + ' with zero template types remaining', () => {
      const r = expandSpec(base({ type: name, ...fields }));
      expect(r.errors).toEqual([]);
      const types = [];
      (function walk(n) { types.push(n.type); for (const c of n.children || []) walk(c); })(r.screen);
      for (const t of types) expect(TEMPLATES.some(([tn]) => tn === t)).toBe(false);
      expect(types.length).toBeGreaterThan(0);
    });
  }
});

describe('checkShallow — the defensive client gate', () => {
  it('accepts a well-formed spec', () => {
    const r = checkShallow(base({ type: 'text', text: 'hi' }));
    expect(r.ok).toBe(true);
    expect(r.screen.type).toBe('text');
  });
  it('rejects a non-catalog type', () => {
    const r = checkShallow(base({ type: 'iframe', src: '//evil' }));
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.code === 'UNKNOWN_TYPE')).toBe(true);
  });
  it('rejects a wrong spec version', () => {
    const r = checkShallow({ ...base({ type: 'text', text: 'x' }), spec: 'app-shell/1.0' });
    expect(r.ok).toBe(false);
  });
  it('rejects a spec over the byte cap', () => {
    const r = checkShallow(base({ type: 'text', text: 'x'.repeat(40000) }));
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.code === 'SPEC_TOO_LARGE')).toBe(true);
  });
  it('rejects unknown tabs shape', () => {
    const r = checkShallow({ ...base({ type: 'text', text: 'x' }), tabs: '首页' });
    expect(r.ok).toBe(false);
  });
  it('rejects garbage input without throwing', () => {
    expect(checkShallow(null).ok).toBe(false);
    expect(checkShallow('string').ok).toBe(false);
  });
});

describe('M4 red-team — hostile text survives verbatim in the expanded tree', () => {
  const HOSTILE = [
    ['script tag', '<script>alert(1)</script>'],
    ['event handler', '<img src=x onerror=alert(1)>'],
    ['quote break', '点我" onclick="alert(1)'],
    ['template literal', '${process.exit()}'],
  ];
  for (const [name, payload] of HOSTILE) {
    it('preserves ' + name + ' as inert text', () => {
      const r = expandSpec(base({ type: 'text', text: payload }));
      expect(r.errors).toEqual([]);
      const texts = [];
      (function walk(n) { if (n.text !== undefined) texts.push(n.text); for (const c of n.children || []) walk(c); })(r.screen);
      expect(texts).toContain(payload);
    });
  }

  it('the DOM layer never assigns innerHTML (structural injection guard)', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(
      new URL('../../../presentation/web-client-v2/web/js/appshell.js', import.meta.url),
      'utf8');
    expect(source.includes('innerHTML')).toBe(false);
    expect(source.includes('document.write')).toBe(false);
  });
});

describe('mergeUpdate — the incremental update seam (M3)', () => {
  it('a screen-only partial keeps the render origin theme/tabs/actions', () => {
    const current = base({ type: 'text', text: 'x' });
    const merged = mergeUpdate(current, { spec: V, screen: { type: 'text', text: 'y' } });
    expect(merged.theme).toEqual(current.theme);
    expect(merged.tabs).toEqual(current.tabs);
    expect(merged.actions).toEqual(current.actions);
    expect(merged.screen).toEqual({ type: 'text', text: 'y' });
    expect(checkShallow(merged).ok).toBe(true);
  });

  it('present overrides win; a full payload merges to itself; a non-object is null', () => {
    const current = base({ type: 'text', text: 'x' });
    expect(mergeUpdate(current, { spec: V, tabs: ['甲', '乙'], screen: { type: 'text', text: 'z' } }).tabs).toEqual(['甲', '乙']);
    expect(mergeUpdate(current, current)).toEqual(current);
    expect(mergeUpdate(current, null)).toBeNull();
  });
});

// ---- swarm: lenient JSON-prefix parse + ghost-tree projection --------------

import { parseJsonPrefix, swarmCardModel } from '../../../presentation/web-client-v2/web/js/appshell-core.js';

const C1 = { type: 'banner-card', title: '节奏', subtitle: '方案一' };
const C2 = { type: 'text', text: '每周复原一张母带', size: 'small', tone: 'muted' };
const C3 = { type: 'mini-player', cover: { emoji: '▶', color: '#e05537' }, title: 'A 面', action: 'demo.tap' };
const swarmDoc = () => ({
  swarm: { slot: 2, of: 3, pen: '赤笔', accent: '#e05537', slots: 3 },
  spec: {
    spec: 'app-shell/0.9', theme: { accent: '#e05537', mode: 'light' },
    tabs: ['推荐', '黑胶', '乐库'], actions: ['demo.tap'],
    screen: { type: 'column', children: [C1, C2, C3] },
  },
});

describe('parseJsonPrefix — the certainly-complete prefix of a streamed doc', () => {
  const full = JSON.stringify(swarmDoc());

  it('parses the complete document to itself', () => {
    expect(parseJsonPrefix(full)).toEqual(swarmDoc());
  });
  it('empty, key-only, and mid-string prefixes yield nothing complete', () => {
    expect(parseJsonPrefix('')).toBeNull();
    expect(parseJsonPrefix('   ')).toBeNull();
    expect(parseJsonPrefix('{"swarm"')).toBeNull();
    expect(parseJsonPrefix('{"swarm":')).toBeNull();
    expect(parseJsonPrefix('{"swarm":{"pen":"赤')).toBeNull();
  });
  it('the pen meta lands the moment its object closes; a dangling comma is dropped', () => {
    const cut = full.slice(0, full.indexOf(',"spec"'));
    expect(parseJsonPrefix(cut)).toEqual({ swarm: swarmDoc().swarm });
    expect(parseJsonPrefix(cut + ',')).toEqual({ swarm: swarmDoc().swarm });
  });
  it('a number at EOF is still growing — it is dropped, the string before it stays', () => {
    expect(parseJsonPrefix('{"swarm":{"pen":"赤笔","slots":3')).toEqual({ swarm: { pen: '赤笔' } });
    expect(parseJsonPrefix('{"swarm":{"pen":"赤笔","slots":3}')).toEqual({ swarm: { pen: '赤笔', slots: 3 } });
  });
  it('whitespace between tokens never blocks completion', () => {
    expect(parseJsonPrefix('{ "swarm" : { "pen" : "赤笔" } ')).toEqual({ swarm: { pen: '赤笔' } });
  });
});

describe('swarmCardModel — ghost-tree diff over the staged arrival', () => {
  const full = JSON.stringify(swarmDoc());
  const atChild = (n) => full.indexOf(JSON.stringify([C1, C2, C3].slice(0, n + 1)[n]));

  it('nothing arrived: full plan as ghosts, growth at slot 0', () => {
    const opener = full.slice(0, full.indexOf('"children":[') + '"children":['.length);
    const model = swarmCardModel(opener);
    expect(model.pen).toBe('赤笔');
    expect(model.accent).toBe('#e05537');
    expect(model.slots).toBe(3);
    expect(model.closed).toEqual([]);
    expect(model.ghosts).toBe(3);
    expect(model.growth).toBe(0);
  });
  it('child 1 closed, child 2 half-arrived: the half is dropped, ghost stays', () => {
    const after1 = swarmCardModel(full.slice(0, atChild(0) + JSON.stringify(C1).length) + ',');
    expect(after1.closed).toEqual([C1]);
    expect(after1.ghosts).toBe(2);
    expect(after1.growth).toBe(1);
    const mid2 = swarmCardModel(full.slice(0, atChild(1) + 4));
    expect(mid2.closed).toEqual([C1]);
    expect(mid2.ghosts).toBe(2);
  });
  it('all children closed but the document not yet sealed: zero ghosts', () => {
    const trailing = full.slice(0, full.length - 3);
    const model = swarmCardModel(trailing);
    expect(model.closed).toEqual([C1, C2, C3]);
    expect(model.ghosts).toBe(0);
    expect(model.growth).toBe(3);
  });
  it('non-swarm arguments and hostile shapes answer null, never throw', () => {
    expect(swarmCardModel('')).toBeNull();
    expect(swarmCardModel('{"fixture":"wechat"}')).toBeNull();
    expect(swarmCardModel('{"swarm":3')).toBeNull();
    expect(swarmCardModel('<script>alert(1)</script>')).toBeNull();
  });
});

describe('swarmCardModel — identity hardening', () => {
  it('pen capped, non-hex accent falls back, hostile text survives as data', () => {
    const hostile = JSON.stringify({
      swarm: { pen: '笔'.repeat(60), accent: 'javascript:alert(1)', slots: 2 },
      spec: { screen: { type: 'column', children: [
        { type: 'text', text: '<script>alert(1)</script>' },
      ] } },
    });
    const model = swarmCardModel(hostile);
    expect(model.pen).toHaveLength(40);
    expect(model.accent).toBe('#8a8f98');
    expect(model.closed[0].text).toBe('<script>alert(1)</script>');
    expect(model.slots).toBe(2);
    expect(model.ghosts).toBe(1);
  });
});
