// L1 contract tests for the A2UI mapping (M5 wing): the expanded tree from
// validate() compiles to a flat component array that is catalog-valid for
// @lynx-js/genui v0.7.0 — every component name is in the frozen basic
// catalog (a2ui/dist/catalog.json in the package), every emitted prop is in
// that component's catalog prop set, required props are present, and every
// child reference resolves. The frozen shapes below are pinned by hand from
// catalog.json so a genui bump that breaks us fails HERE, loudly.
import { describe, it, expect } from 'vitest';
import { validate } from '../../system-plugins/dsh-appshell/lib/validate.js';
import { expandedToA2UI, specToA2UI, toGenuiMessages } from '../../system-plugins/dsh-appshell/lib/appshell-to-a2ui.js';
import { FIXTURES } from '../../system-plugins/dsh-appshell/lib/mock.js';

// genui v0.7.0 basic catalog — the 22 names our output may never leave.
const GENUI_CATALOG = new Set([
  'Button', 'Card', 'CheckBox', 'ChoicePicker', 'Column', 'DateTimeInput',
  'Divider', 'Icon', 'Image', 'LazyComponent', 'LineChart', 'List', 'Loading',
  'McpApp', 'Modal', 'PieChart', 'RadioGroup', 'Row', 'Slider', 'Tabs', 'Text',
  'TextField',
]);
// The props we emit per mapped component (catalog prop set, subset we use).
const EMITTED_PROPS = {
  Text: ['text', 'variant'],
  Button: ['child', 'variant', 'action'],
  Card: ['child'],
  Row: ['children'],
  Column: ['children'],
  Slider: ['label', 'min', 'max', 'value'],
};
const REQUIRED_PROPS = { Text: ['text'], Button: ['child', 'action'], Card: ['child'], Row: ['children'], Column: ['children'], Slider: ['max', 'value'] };

const V = 'app-shell/0.9';
const spec = (screen, actions) => ({
  spec: V, theme: { accent: '#1677FF', mode: 'light' }, tabs: ['首页', '我的'], actions, screen,
});

function countExpanded(node) {
  return 1 + (node.children || []).reduce((n, c) => n + countExpanded(c), 0);
}

function assertCatalogValid(components) {
  const ids = new Set();
  for (const c of components) {
    expect(GENUI_CATALOG.has(c.component), 'component name ' + c.component).toBe(true);
    const allowed = ['id', 'component', ...EMITTED_PROPS[c.component]];
    for (const k of Object.keys(c)) {
      expect(allowed.includes(k), c.component + ' prop "' + k + '" not in catalog set').toBe(true);
    }
    for (const k of REQUIRED_PROPS[c.component]) {
      expect(c[k] !== undefined, c.component + ' missing required "' + k + '"').toBe(true);
    }
    expect(ids.has(c.id), 'duplicate id ' + c.id).toBe(false);
    ids.add(c.id);
  }
  for (const c of components) {
    for (const kid of c.children || []) expect(ids.has(kid), 'children ref ' + kid).toBe(true);
    if (c.child !== undefined) expect(ids.has(c.child), 'child ref ' + c.child).toBe(true);
  }
}

describe('expandedToA2UI — the three fixtures', () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    it(name + ' compiles to a catalog-valid flat array', () => {
      const { ok, errors, expanded } = validate(fixture);
      expect(errors).toEqual([]);
      expect(ok).toBe(true);
      const { surfaceId, components } = expandedToA2UI(expanded, { accent: fixture.theme.accent });
      expect(surfaceId).toBe('appshell');
      expect(components[0].id).toBe('root');
      assertCatalogValid(components);
      // count arithmetic: each expanded node >= 1 component; cards add a
      // wrapper Column; buttons add a label Text.
      const cards = JSON.stringify(expanded).split('"type":"card"').length - 1;
      const buttons = JSON.stringify(expanded).split('"type":"button"').length - 1;
      expect(components.length).toBe(countExpanded(expanded) + cards + buttons);
    });
  }

  it('netease mini-player action survives as { event: { name } }', () => {
    const { expanded } = validate(FIXTURES.netease);
    const { components } = expandedToA2UI(expanded, {});
    const buttons = components.filter((c) => c.component === 'Button');
    expect(buttons.length).toBeGreaterThan(0);
    for (const b of buttons) {
      expect(b.action).toEqual({ event: { name: expect.any(String) } });
      expect(['player.toggle', 'tap']).toContain(b.action.event.name);
      expect(typeof b.child).toBe('string');
    }
    expect(buttons.some((b) => b.action.event.name === 'player.toggle')).toBe(true);
  });

  it('is deterministic — two runs produce identical JSON', () => {
    const { expanded } = validate(FIXTURES.wechat);
    const a = expandedToA2UI(expanded, {});
    const b = expandedToA2UI(expanded, {});
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('named substitute mappings (M5 gap ledger)', () => {
  const mixed = spec({
    type: 'column', children: [
      { type: 'tab-bar', tabs: [{ label: 'A' }, { label: 'B' }], active: 0 }, // badge → Text caption
      { type: 'progressbar', label: 'done', value: 120 }, // Slider, value clamps
      { type: 'image', emoji: '🎧', color: '#333' }, // Text h4
      { type: 'button', label: 'no action' }, // catalog requires action → 'tap'
    ],
  }, ['unused.open']);

  it('badge → Text(caption), progressbar → Slider(0..100, clamped), image → Text(h4)', () => {
    const { ok, a2ui } = specToA2UI(mixed, {});
    expect(ok).toBe(true);
    assertCatalogValid(a2ui.components);
    const byId = Object.fromEntries(a2ui.components.map((c) => [c.id, c]));
    const caption = a2ui.components.filter((c) => c.component === 'Text' && c.variant === 'caption');
    expect(caption.length).toBe(2); // two tab badges
    const slider = a2ui.components.find((c) => c.component === 'Slider');
    expect(slider.value).toBe(100); // 120 clamps
    expect(slider).toMatchObject({ min: 0, max: 100, label: 'done' });
    const emoji = a2ui.components.find((c) => c.component === 'Text' && c.text === '🎧');
    expect(emoji.variant).toBe('h4');
    const loose = a2ui.components.find((c) => c.component === 'Button');
    expect(byId[loose.child].text).toBe('no action');
    expect(loose.action).toEqual({ event: { name: 'tap' } });
  });
});

describe('specToA2UI — full pipeline and failure shape', () => {
  it('validates, expands and converts in one call', () => {
    const { ok, a2ui } = specToA2UI(FIXTURES.alipay, { accent: '#1677FF' });
    expect(ok).toBe(true);
    expect(a2ui.components[0].id).toBe('root');
    assertCatalogValid(a2ui.components);
  });

  it('returns structured errors, never throws, on an illegal spec', () => {
    const bad = spec({ type: 'marquee', text: 'x' }, []);
    const { ok, errors } = specToA2UI(bad, {});
    expect(ok).toBe(false);
    expect(errors[0]).toMatchObject({ code: 'UNKNOWN_TYPE' });
  });

  it('expandedToA2UI fails loud on an UNexpanded spec (template nodes)', () => {
    expect(() => expandedToA2UI(FIXTURES.wechat.screen, {})).toThrow(/not a primitive/);
  });
});

describe('toGenuiMessages — ingest sequence shape', () => {
  it('pairs createSurface with updateComponents on the appshell surface', () => {
    const { a2ui } = specToA2UI(FIXTURES.wechat, {});
    const messages = toGenuiMessages(a2ui.components);
    expect(messages).toHaveLength(2);
    expect(messages[0].createSurface).toEqual({ surfaceId: 'appshell', catalogId: 'appshell' });
    expect(messages[1].updateComponents.surfaceId).toBe('appshell');
    expect(messages[1].updateComponents.components).toEqual(a2ui.components);
  });
});
