// dsh:logging-exempt — pure logic; logging stays in the caller (plugin index.js / scenarios).
/**
 * Mock/real switch — the ONE place the data source is decided.
 *
 *   DSH_APPSHELL_MODE=mock  -> appshell_render serves bundled fixtures;
 *                              every log line carries mode:"mock" and the
 *                              first announce is a warn (impossible to miss).
 *   anything else           -> real: specs come from model tool calls and go
 *                              through the same validate->expand->render pipe.
 *
 * The pipeline downstream of the spec source is identical in both modes, so
 * flipping the switch changes WHERE a spec comes from — nothing else. E2E
 * manifests assert the mode field, which is what makes "forgot to switch
 * back" a loud red instead of a silent lie.
 */

export const MODE = process.env.DSH_APPSHELL_MODE === 'mock' ? 'mock' : 'real';

const base = (accent, tabs, screen, actions) => ({
  spec: 'app-shell/0.9',
  theme: { accent, mode: 'light' },
  tabs,
  actions,
  screen,
});

/** The three demo fixtures — also the golden specs for validator tests. */
export const FIXTURES = {
  wechat: base('#07C160', ['微信', '通讯录', '发现', '我'],
    { type: 'column', children: [
      { type: 'search-bar', placeholder: '搜索' },
      { type: 'chat-row', avatar: { emoji: '张', color: '#5a7cd4' }, name: '张伟', preview: '明天发布会的材料我发你了', time: '22:41' },
      { type: 'chat-row', avatar: { emoji: '产', color: '#4d9e5f' }, name: '产品交流群 (45)', preview: '@你 发布清单已更新', time: '21:07' },
      { type: 'chat-row', avatar: { emoji: '妈', color: '#e0a04c' }, name: '妈妈', preview: '记得吃早饭', time: '20:15' },
    ] },
    ['chat.open', 'compose.new']),
  netease: base('#ec4141', ['我的', '音乐馆', '云村', '账号'],
    { type: 'column', children: [
      { type: 'banner-card', title: '每日推荐 · 31 首', subtitle: '根据你的口味生成，周三 06:00 更新' },
      { type: 'service-grid', items: [
        { icon: '🎵', label: '私人FM' }, { icon: '📅', label: '每日推荐' },
        { icon: '📚', label: '歌单' }, { icon: '🏆', label: '排行榜' },
      ] },
      { type: 'hcard-row', items: [
        { cover: { emoji: '🌙', color: '#5a7cd4' }, title: '深夜学习 BGM', sub: '钢琴·白噪音' },
        { cover: { emoji: '🚶', color: '#4d9e5f' }, title: '通勤路上', sub: '流行·通勤' },
        { cover: { emoji: '☕', color: '#d4779a' }, title: '咖啡馆爵士', sub: 'Jazz' },
      ] },
      { type: 'mini-player', cover: { emoji: '🎧', color: '#3d3d8f' }, title: '夜航星', sub: '虚拟歌手 · 正在播放', action: 'player.toggle' },
    ] },
    ['player.toggle', 'playlist.open']),
  alipay: base('#1677FF', ['首页', '理财', '生活', '我的'],
    { type: 'column', children: [
      { type: 'balance-card', label: '余额 (元)', value: '8,482.10', actionLabel: '转入 · 领积分', action: 'balance.topup' },
      { type: 'service-grid', items: [
        { icon: '📷', label: '扫一扫' }, { icon: '💳', label: '收付款' },
        { icon: '🚌', label: '出行' }, { icon: '⚡', label: '充值' },
        { icon: '🩺', label: '医疗' }, { icon: '📈', label: '理财' },
        { icon: '🍜', label: '外卖' }, { icon: '⊞', label: '更多' },
      ] },
      { type: 'banner-card', title: '为你推荐', subtitle: '通勤公交卡 · 周一至周五 已开通' },
    ] },
    ['balance.topup', 'service.open']),
};

export function mockSpec(key) {
  return FIXTURES[key] || null;
}

export function fixtureKeys() {
  return Object.keys(FIXTURES);
}

/** Loud startup announce — mock mode must never be silent. */
export function modeAnnounce(log) {
  if (MODE === 'mock') log.warn({ event: 'appshell.mode', mode: 'mock', note: 'MOCK MODE — appshell_render serves fixtures, not model output' });
  else log.info({ event: 'appshell.mode', mode: 'real' });
}
