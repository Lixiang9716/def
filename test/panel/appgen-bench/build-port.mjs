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
  // Round-20 expansion: 12 → 20 instructions. Same domains (social, job
  // search, travel, forums, productivity, news, CRM, publishing); the new
  // upstream instructions name BOTH background and component colors and
  // their DV cases verify both, so the def-native prompts carry both asks.
  '000090': '做一个社交分享应用的首页：顶部搜索栏，中间是个人主页卡片（头像、昵称、动态）和内容流（图片卡片、可投票、含积分展示），action 含注册登录、邀请好友、上传图片、内容投票。背景用浅青色（light cyan），主题色用军校蓝（cadet blue）。',
  '000053': '做一个实习招聘应用的首页：顶部搜索栏，中间是实习职位卡片列表（职位、公司、地点），支持学生浏览和申请职位、企业发布职位，action 含学生/企业面板切换、申请、发布。背景用薄荷奶油色（mint cream），主题色用鸭绿色（teal）。',
  '000098': '做一个租车预订应用的首页：顶部搜索栏，中间是可选车辆卡片列表（车型、价格、状态），支持选车、选租赁起止时间、下单支付、查看订单记录，action 含预订、支付方式选择、我的订单。背景用木瓜色（papaya whip），主题色用深橙色（dark orange）。',
  '000026': '做一个在线投票应用的首页：顶部标题栏，中间是投票选项列表（可浏览各选项的当前票数），支持为选中选项投票、查看实时投票结果（占比可视化），action 含投票、查看结果。背景用白色（white），主题色用海军蓝（navy）。',
  '000077': '做一个工程师工具库应用的首页：顶部搜索栏，中间是工具卡片列表（名称、描述、功能、价格），支持注册登录、按类目筛选、查看工具详情、评论评分，action 含搜索、筛选、详情、评论。背景用象牙色（ivory），主题色用森林绿（forest green）。',
  '000064': '做一个航运新闻资讯应用的首页：顶部导航，中间是新闻文章列表和公司名片、活动卡片，支持浏览新闻、查看公司和活动详情、订阅简报，action 含资讯、公司、活动、订阅。背景用旧蕾丝色（old lace），主题色用玫瑰棕（rosy brown）。',
  '000023': '做一个销售线索管理应用的首页：顶部操作栏，中间是线索卡片列表（姓名、状态、分类），支持新增线索、更新线索状态、自动发送消息、查看报表和最佳实践建议，action 含新增、更新、消息、报表。背景用木瓜色（papaya whip），主题色用深橙色（dark orange）。',
  '000089': '做一个创业文章阅读应用的首页：顶部搜索栏，中间是分类文章卡片列表（封面、标题、摘要），支持注册登录、搜索、收藏文章、分享文章、查看阅读历史，action 含搜索、收藏、分享、我的收藏。背景用旧蕾丝色（old lace），主题色用玫瑰棕（rosy brown）。',
};

const byId = new Map(corpus.map((r) => [r.id, r]));
const missing = Object.keys(SELECTION).filter((id) => !byId.has(id));
if (missing.length) { console.error('selection ids not in corpus:', missing); process.exit(1); }

const port = {
  port_version: 2,
  source: 'WebGen-Bench test corpus (mnluzimu/WebGen-Bench, data/test.jsonl, NeurIPS 2025 D&B)',
  note: 'Test cases verbatim from the upstream corpus; instructions re-phrased def-native (mobile app face, capabilities preserved). Execution tier v1 = spec-inspection judge; the action-execution leg upgrades it to real dispatch. v2: 20 instructions (round 20; v1 ledgers ran the first 12, whose prompts and order are unchanged).',
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
