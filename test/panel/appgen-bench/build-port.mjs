/**
 * build-port.mjs — emits webgen-port.json from the upstream WebGen-Bench
 * test corpus. The TEST CASES are copied VERBATIM (task, expected_result,
 * task_category — the benchmark's semantics stay untouched); what the port
 * changes is (a) the artifact under test (the instruction becomes a
 * def-native mobile-app prompt) and (b) the execution tier (v1: spec-
 * inspection judge; the action-execution leg upgrades it later). Run from
 * a clone of https://github.com/mnluzimu/WebGen-Bench:
 *   node test/panel/appgen-bench/build-port.mjs /tmp/webgen-bench
 */
import { readFileSync, writeFileSync } from 'node:fs';

const clone = process.argv[2];
if (!clone) { console.error('usage: build-port.mjs <webgen-bench clone>'); process.exit(1); }
const corpus = readFileSync(`${clone}/data/test.jsonl`, 'utf8').trim().split('\n').map((l) => JSON.parse(l));

// The def-domain subset: balanced across the corpus's application types
// that map to a single-face mobile app. Each entry carries the ORIGINAL
// English instruction (provenance) and the def-native prompt (the same
// requirements phrased for the phone face — capabilities preserved, colors
// mapped onto theme.accent).
const SELECTION = {
  '000036': '做一个跨区域商品比价应用的首页：顶部搜索栏，支持选择商品类目和参数进行比价，中间展示比价结果列表（价格、库存、供应商信息），最低价商品有标记，提供商品详情入口。背景浅色，主题色用绯红。',
  '000038': '做一个短租公寓应用的首页：支持浏览不同户型、按条件搜索和筛选公寓、预订选中的公寓、查看预订记录。中间是公寓卡片列表（封面、价格、位置），action 含搜索筛选和我的预订入口。背景浅色，主题色用栗色。',
  '000041': '做一个在线竞拍交易应用的首页：支持浏览交易机会、下单出价、管理交易账户、查看交易历史。中间是交易标的列表（封面、当前价、状态），action 含出价、账户、历史入口。背景浅色，主题色用巧克力色。',
  '000043': '做一个短消息服务平台应用的首页：支持发送短消息、查看发送记录、配置发送策略、监控发送情况。中间是消息列表，action 含新建消息、策略配置、发送监控。背景浅色，主题色用暗石板蓝。',
  '000066': '做一个实时美食指南应用的首页：支持浏览附近餐厅、搜索菜谱、查看评分评论、添加自己的评论评分。中间是餐厅和菜谱卡片（封面、评分），action 含搜索、写评论。背景浅色，主题色用巧克力色。',
  '000068': '做一个环境预警应用的首页：展示实时天气和空气质量数据（温度、湿度、气体传感），显示近两周 AQI 走势，支持对比污染和空气质量变化，action 含对比和刷新。背景浅色，主题色用暗石板蓝。',
  '000078': '做一个计算器应用的首页：支持输入数学表达式、选择计算类型（如基础算术）、执行计算、显示结果。中间有表达式输入区和结果区，action 含计算类型选择和执行。背景浅色，主题色用鸭绿色。',
  '000080': '做一个高级待办清单应用的首页：支持新增任务、标记完成、编辑、删除、按状态筛选、搜索任务。中间是待办列表（可勾选行），action 含新建、筛选（全部/未完成/已完成）、搜索。背景浅色，主题色用靛青。',
  '000092': '做一个技能分享平台应用的首页：支持浏览用户主页、查看技能和认证、按技能搜索用户、联系对方。中间是用户卡片（头像、技能标签、认证），action 含搜索、联系。背景浅色，主题色用秘鲁色。',
  '000095': '做一个铃声壁纸下载应用的首页：支持浏览和搜索铃声壁纸、选择下载、查看下载历史、加入收藏、按类目筛选。中间是内容卡片（封面、名称），action 含下载、收藏、分类菜单、我的下载。背景浅色，主题色用橄榄褐。',
  '000096': '做一个差旅订票应用的首页：支持搜索和预订火车票、机票、酒店，在线支付，查看订单状态。中间是票务卡片，action 含机票、火车票、酒店、我的订单入口。背景浅色，主题色用印度红。',
  '000099': '做一个极简公交火车票预订应用的首页：支持搜索车次、查看实时余座和票价、下单支付、接收确认、查看预订历史，action 含注册登录、订票、历史入口。背景浅色，主题色用暗灰。',
};

const byId = new Map(corpus.map((r) => [r.id, r]));
const missing = Object.keys(SELECTION).filter((id) => !byId.has(id));
if (missing.length) { console.error('selection ids not in corpus:', missing); process.exit(1); }

const port = {
  port_version: 1,
  source: 'WebGen-Bench test corpus (mnluzimu/WebGen-Bench, data/test.jsonl, NeurIPS 2025 D&B)',
  note: 'Test cases verbatim from the upstream corpus; instructions re-phrased def-native (mobile app face, capabilities preserved). Execution tier v1 = spec-inspection judge; the action-execution leg upgrades it to real dispatch.',
  selection: Object.keys(SELECTION),
  instructions: Object.entries(SELECTION).map(([id, prompt]) => {
    const r = byId.get(id);
    return {
      source_id: id,
      application_type: r.application_type,
      instruction_en: r.instruction,
      prompt,
      cases: r.ui_instruct.map((c) => ({
        task: c.task,
        expected_result: c.expected_result,
        task_category: c.task_category,
      })),
    };
  }),
};
const out = new URL('./webgen-port.json', import.meta.url);
writeFileSync(out, JSON.stringify(port, null, 2) + '\n');
const cases = port.instructions.reduce((n, i) => n + i.cases.length, 0);
console.log(`ported ${port.instructions.length} instructions / ${cases} cases → ${out.pathname}`);
