// Coverage closer for the app-shell contract: every remaining branch in
// lib/vnode.js, lib/catalog.js and lib/validate.js, hit explicitly.
import { afterAll, describe, expect, it } from 'vitest';
import { h, walk, countNodes } from '../../system-plugins/dsh-appshell/lib/vnode.js';
import { validate } from '../../system-plugins/dsh-appshell/lib/validate.js';
import { renderSpec } from '../../system-plugins/dsh-appshell/lib/render.js';
import { defineTemplate, templates } from '../../system-plugins/dsh-appshell/lib/catalog.js';
import { FIXTURES } from '../../system-plugins/dsh-appshell/lib/mock.js';

const V = 'app-shell/0.9';
const TempTemplates = templates;

describe('vnode helpers', () => {
  it('walk visits every node depth-first', () => {
    const tree = h('div', {}, [h('span', { text: 'a' }), h('span', { text: 'b' })]);
    const seen = [];
    walk(tree, (n, d) => seen.push(n.tag + ':' + d));
    expect(seen).toEqual(['div:0', 'span:1', 'span:1']);
  });
  it('countNodes counts the whole tree', () => {
    const tree = h('div', {}, [h('span', { text: 'a' }), h('span', {}, [h('b', { text: 'c' })])]);
    expect(countNodes(tree)).toBe(4);
  });
});

describe('catalog expand failure branches', () => {
  afterAll(() => {
    TempTemplates.delete('expand-throws');
    TempTemplates.delete('expand-recursion');
    TempTemplates.delete('expand-to-template');
  });
  it('a template whose expand() throws is EXPAND_FAILED', () => {
    defineTemplate('expand-throws', { expand: () => { throw new Error('boom'); } });
    const r = validate({ ...FIXTURES.wechat, screen: { type: 'expand-throws' } });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.code === 'EXPAND_FAILED' && e.msg.includes('boom'))).toBe(true);
  });
  it('a template that expands to another template is EXPAND_FAILED', () => {
    defineTemplate('expand-to-template', { expand: () => ({ type: 'search-bar', placeholder: 'x' }) });
    const r = validate({ ...FIXTURES.wechat, screen: { type: 'expand-to-template' } });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.code === 'EXPAND_FAILED')).toBe(true);
  });
  it('structural self-recursion is stopped by the expansion depth guard', () => {
    defineTemplate('expand-recursion', { expand: () => ({ type: 'column', children: [{ type: 'expand-recursion' }] }) });
    const r = validate({ ...FIXTURES.wechat, screen: { type: 'expand-recursion' } });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.code === 'EXPAND_FAILED' && e.msg.includes('deeper than'))).toBe(true);
  });
});

describe('validate remaining field branches', () => {
  it('screen as a non-object is BAD_FIELD', () => {
    const r = validate({ ...FIXTURES.wechat, screen: 42 });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.code === 'BAD_FIELD' && e.path === '$.screen')).toBe(true);
  });
  it('node.type as a number is BAD_FIELD', () => {
    const r = validate({ ...FIXTURES.wechat, screen: { type: 42 } });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.code === 'BAD_FIELD' && e.msg.includes('type must be a string'))).toBe(true);
  });
  it('actions containing a non-string is BAD_ACTION', () => {
    const r = validate({ ...FIXTURES.wechat, actions: ['chat.open', 42] });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.code === 'BAD_ACTION' && e.path === '$.actions')).toBe(true);
  });
  it('missing theme is tolerated (accent defaults downstream)', () => {
    const spec = { ...FIXTURES.wechat };
    delete spec.theme;
    const r = validate(spec);
    expect(r.errors.filter((e) => e.path === '$.theme')).toHaveLength(0);
  });
});

describe('image/progressbar render directly (fixture gap)', () => {
  it('image renders an inert emoji block', () => {
    const r = renderSpec({ ...FIXTURES.wechat, screen: { type: 'image', emoji: '🖼', color: '#5a7cd4' } });
    expect(r.ok).toBe(true);
    expect(JSON.stringify(r.vnode)).toContain('🖼');
  });
  it('progressbar clamps and carries its label', () => {
    const r = renderSpec({ ...FIXTURES.wechat, screen: { type: 'progressbar', label: '进度', value: 142 } });
    expect(r.ok).toBe(true);
    const out = JSON.stringify(r.vnode);
    expect(out).toContain('进度');
    expect(out).toContain('100%');
  });
});
