// Design-success counterfactual #1 ("the fourth app"): a brand-new app theme
// must work with ZERO renderer changes — only a new spec. If this test ever
// needs a lib/ edit, the architecture has failed its own bar.
import { describe, expect, it } from 'vitest';
import { validate } from '../../system-plugins/dsh-appshell/lib/validate.js';
import { renderSpec } from '../../system-plugins/dsh-appshell/lib/render.js';

const DOUYIN = {
  spec: 'app-shell/0.9',
  theme: { accent: '#FE2C55', mode: 'dark' },
  tabs: ['首页', '朋友', '消息', '我'],
  actions: ['video.like', 'profile.open'],
  screen: { type: 'column', children: [
    { type: 'banner-card', title: '为你推荐', subtitle: '按住屏幕.none — 纯组件演示' },
    { type: 'hcard-row', items: [
      { cover: { emoji: '🎬', color: '#222' }, title: '深夜食堂 Vlog', sub: 'UP: 阿灶' },
      { cover: { emoji: '🐱', color: '#3a3a5c' }, title: '猫猫踩奶 4K', sub: 'UP: 喵部' },
    ] },
    { type: 'mini-player', cover: { emoji: '▶', color: '#FE2C55' }, title: '第 1024 期', sub: '滑动切换', action: 'video.like' },
  ] },
};

describe('设计成功反事实 #1：第四个 App（抖音）零渲染器改动', () => {
  it('validate passes with no catalog change', () => {
    const r = validate(DOUYIN);
    expect(r.ok, JSON.stringify(r.errors)).toBe(true);
  });
  it('renders to a VNode whose text set matches the spec, renderer untouched', () => {
    const r = renderSpec(DOUYIN);
    expect(r.ok).toBe(true);
    const texts = [];
    (function walk(n) { if (n.props && n.props.text !== undefined) texts.push(n.props.text); for (const c of n.children || []) walk(c); })(r.vnode);
    expect(texts.some((t) => t.includes('为你推荐'))).toBe(true);
    expect(texts.some((t) => t.includes('深夜食堂 Vlog'))).toBe(true);
  });
});
