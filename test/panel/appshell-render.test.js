// Golden VNode tests for the app-shell render pipeline (renderSpec):
//   - the three bundled fixtures (wechat/netease/alipay, lib/mock.js) render ok=true
//     and every fixture's key text survives into the VNode tree (walk children,
//     collect props.text);
//   - h() shape contract regression guard: children live in vnode.children, never
//     in props.children (a past defect put them in props; vnode.js h() is fixed —
//     this test exists so the defect cannot silently return);
//   - all eight primitives get at least one direct render assertion;
//   - error path: renderSpec(illegal spec) returns ok=false with non-empty errors.
import { describe, it, expect } from 'vitest';
import { renderSpec } from '../../system-plugins/dsh-appshell/lib/render.js';
import { h, walk } from '../../system-plugins/dsh-appshell/lib/vnode.js';
import { FIXTURES } from '../../system-plugins/dsh-appshell/lib/mock.js';

/** Collect every props.text in a VNode tree — local recursion, deliberately NOT
 * the lib's walk(), so a walk() defect cannot mask a render defect here. */
function collectTexts(vnode, out = []) {
  if (vnode.props && vnode.props.text !== undefined) out.push(vnode.props.text);
  for (const c of vnode.children || []) collectTexts(c, out);
  return out;
}

/** All texts of one fixture-rendered tree as one joined blob for substring checks. */
function renderedTextBlob(vnode) {
  return collectTexts(vnode).join('\u0000');
}

const okSpec = (screen, extra) => ({
  spec: 'app-shell/0.9', theme: { accent: '#1677FF', mode: 'light' },
  tabs: ['首页', '我的'], actions: ['a.open'], screen, ...extra,
});

/* --- golden fixtures: ok=true + key-text sweep ------------------------- */

const GOLDEN_TEXTS = {
  wechat: [
    '🔍 搜索',                      // search-bar template -> text primitive
    '张伟', '明天发布会的材料我发你了', '22:41', // chat-row #1: name / preview / time
    '产品交流群 (45)', '@你 发布清单已更新',     // chat-row #2
    '妈妈', '记得吃早饭', '20:15',              // chat-row #3
  ],
  netease: [
    '每日推荐 · 31 首', '根据你的口味生成，周三 06:00 更新', // banner-card title/subtitle
    '私人FM', '排行榜',                        // service-grid labels
    '深夜学习 BGM', '咖啡馆爵士', 'Jazz',       // hcard-row titles/subs
    '夜航星', '虚拟歌手 · 正在播放', '▶',        // mini-player title/sub/button
  ],
  alipay: [
    '余额 (元)', '8,482.10', '转入 · 领积分',   // balance-card label/value/actionLabel
    '扫一扫', '收付款', '外卖', '更多',          // service-grid labels (8 items)
    '为你推荐', '通勤公交卡 · 周一至周五 已开通', // banner-card
  ],
};

describe('renderSpec — the three mock fixtures are VNode golden samples', () => {
  for (const key of ['wechat', 'netease', 'alipay']) {
    it(key + ': renders ok=true with a primitive-rooted VNode', () => {
      const r = renderSpec(FIXTURES[key]);
      expect(r.ok, JSON.stringify(r.errors)).toBe(true);
      expect(r.errors).toBeUndefined();
      expect(r.vnode).toBeDefined();
      // every fixture screen is a column -> root is the column renderer's VNode
      expect(r.vnode.tag).toBe('div');
      expect(r.vnode.props.class).toBe('ash-col');
      expect(r.vnode.children.length).toBeGreaterThan(0);
    });

    it(key + ': every key fixture text survives the render into props.text', () => {
      const r = renderSpec(FIXTURES[key]);
      expect(r.ok, JSON.stringify(r.errors)).toBe(true);
      const blob = renderedTextBlob(r.vnode);
      for (const t of GOLDEN_TEXTS[key]) {
        expect(blob).toContain(t);
      }
    });
  }

  it('fixture trees contain no template nodes and no markup — only rendered text', () => {
    for (const key of ['wechat', 'netease', 'alipay']) {
      const r = renderSpec(FIXTURES[key]);
      walk(r.vnode, (n) => {
        // template sugar must have been expanded away: tags are mount-layer tags
        expect(['div', 'span', 'button']).toContain(n.tag);
        // text rides props.text only — never innerHTML-style markup payloads
        expect(n.props.html).toBeUndefined();
        expect(n.props.markup).toBeUndefined();
      });
    }
  });
});

/* --- h() shape contract regression guard ------------------------------- */

describe('h() shape contract — children in vnode.children, never props.children', () => {
  it('direct h() call puts children in .children and leaves props.children unset', () => {
    const kid = h('span', { text: 'kid' });
    const parent = h('div', { class: 'box' }, [kid]);
    expect(Array.isArray(parent.children)).toBe(true);
    expect(parent.children).toHaveLength(1);
    expect(parent.children[0]).toBe(kid);
    expect(parent.children[0].props.text).toBe('kid');
    // the historical defect: children leaked into props.children
    expect(parent.props.children).toBeUndefined();
    expect('children' in parent.props).toBe(false);
    // no-children call still yields an array, never undefined
    expect(Array.isArray(h('div', {}).children)).toBe(true);
    expect(h('div', {}).children).toHaveLength(0);
  });

  it('every node of every rendered fixture tree keeps children in .children', () => {
    let nodes = 0;
    for (const key of ['wechat', 'netease', 'alipay']) {
      const r = renderSpec(FIXTURES[key]);
      expect(r.ok, key + ': ' + JSON.stringify(r.errors)).toBe(true);
      walk(r.vnode, (n) => {
        nodes += 1;
        expect(Array.isArray(n.children), key + ': children must be an array').toBe(true);
        expect(n.props.children, key + ': children must not ride in props').toBeUndefined();
        expect('children' in n.props, key + ': props must not own a children key').toBe(false);
      });
    }
    expect(nodes).toBeGreaterThan(20); // the guard actually swept real trees
  });
});

/* --- the eight primitives, one direct render each ---------------------- */

describe('renderSpec — the eight primitives, direct render assertions', () => {
  it('text: text rides props.text; size/tone shape class and style', () => {
    const r = renderSpec(okSpec({ type: 'text', text: '标题', size: 'title', tone: 'muted' }));
    expect(r.ok, JSON.stringify(r.errors)).toBe(true);
    expect(r.vnode.tag).toBe('div');
    expect(r.vnode.props.text).toBe('标题');
    expect(r.vnode.props.class).toBe('ash-text ash-title ash-muted');
    expect(r.vnode.props.style.color).toBe('#8a9199'); // TONE_COLOR.muted
    expect(r.vnode.props.style.fontSize).toBe('16px'); // SIZE_FONT.title
  });

  it('image: emoji becomes the text prop, color the background style', () => {
    const r = renderSpec(okSpec({ type: 'image', emoji: '🌟', color: '#5a7cd4' }));
    expect(r.ok, JSON.stringify(r.errors)).toBe(true);
    expect(r.vnode.props.class).toBe('ash-image');
    expect(r.vnode.props.text).toBe('🌟');
    expect(r.vnode.props.style.background).toBe('#5a7cd4');
  });

  it('button: label as text, action as data-action attr, accent background', () => {
    const r = renderSpec(okSpec({ type: 'button', label: '打开', action: 'a.open' }));
    expect(r.ok, JSON.stringify(r.errors)).toBe(true);
    expect(r.vnode.tag).toBe('button');
    expect(r.vnode.props.text).toBe('打开');
    expect(r.vnode.props.class).toBe('ash-btn');
    expect(r.vnode.props.attrs['data-action']).toBe('a.open');
    expect(r.vnode.props.style.background).toBe('#1677FF'); // spec.theme.accent via ctx
  });
});

describe('renderSpec — the eight primitives, direct render assertions (layout & content)', () => {
  it('row: renders children in order under an ash-row container', () => {
    const r = renderSpec(okSpec({ type: 'row', children: [
      { type: 'text', text: '左' }, { type: 'text', text: '右' },
    ] }));
    expect(r.ok, JSON.stringify(r.errors)).toBe(true);
    expect(r.vnode.props.class).toBe('ash-row');
    expect(r.vnode.children).toHaveLength(2);
    expect(collectTexts(r.vnode)).toEqual(['左', '右']);
  });

  it('column: renders children in order under an ash-col container', () => {
    const r = renderSpec(okSpec({ type: 'column', children: [
      { type: 'text', text: '上' }, { type: 'badge', text: '下' },
    ] }));
    expect(r.ok, JSON.stringify(r.errors)).toBe(true);
    expect(r.vnode.props.class).toBe('ash-col');
    expect(r.vnode.children).toHaveLength(2);
    expect(r.vnode.children[0].props.text).toBe('上');
    expect(r.vnode.children[1].tag).toBe('span');
  });

  it('card: renders children under an ash-card container', () => {
    const r = renderSpec(okSpec({ type: 'card', children: [{ type: 'text', text: '卡内' }] }));
    expect(r.ok, JSON.stringify(r.errors)).toBe(true);
    expect(r.vnode.props.class).toBe('ash-card');
    expect(r.vnode.children).toHaveLength(1);
    expect(r.vnode.children[0].props.text).toBe('卡内');
  });

  it('progressbar: percentage width and label text', () => {
    const r = renderSpec(okSpec({ type: 'progressbar', label: '进度', value: 42 }));
    expect(r.ok, JSON.stringify(r.errors)).toBe(true);
    expect(r.vnode.props.class).toBe('ash-progress');
    expect(r.vnode.props.style.width).toBe('42%');
    expect(r.vnode.props.text).toBe('进度');
  });

  it('badge: span with ash-badge class and text prop', () => {
    const r = renderSpec(okSpec({ type: 'badge', text: '新' }));
    expect(r.ok, JSON.stringify(r.errors)).toBe(true);
    expect(r.vnode.tag).toBe('span');
    expect(r.vnode.props.class).toBe('ash-badge');
    expect(r.vnode.props.text).toBe('新');
  });
});

/* --- error path --------------------------------------------------------- */

describe('renderSpec — illegal specs fail with structured errors, no vnode', () => {
  it('non-object spec: ok=false, BAD_FIELD, errors non-empty, no vnode', () => {
    const r = renderSpec(null);
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors[0].code).toBe('BAD_FIELD');
    expect(r.vnode).toBeUndefined();
  });

  it('unknown primitive type: ok=false with UNKNOWN_TYPE among structured errors', () => {
    const r = renderSpec(okSpec({ type: 'iframe', src: 'https://evil.example' }));
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors.some((e) => e.code === 'UNKNOWN_TYPE')).toBe(true);
    for (const e of r.errors) {
      expect(typeof e.code).toBe('string');
      expect(typeof e.path).toBe('string');
      expect(typeof e.msg).toBe('string');
    }
    expect(r.vnode).toBeUndefined();
  });

  it('undeclared action: ok=false with BAD_ACTION, vnode withheld', () => {
    const r = renderSpec(okSpec({ type: 'button', label: '开', action: 'a.undeclared' }));
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.code === 'BAD_ACTION')).toBe(true);
    expect(r.vnode).toBeUndefined();
  });
});
