# appgen 自动研究循环

[English](appgen-auto-research.md) | 中文

## Problem(动机)

def 的应用生成能力——dsh-appshell 把一条 prompt 变成 app-shell spec,经四门
校验,再经 A2UI/lynx 面渲染到手机上——今天由三个单用途探针度量:L3
benchmark(单条 prompt × 10 跑,结构门)、M4 成本账本(morph/update 两档的
token/延迟 bars)、TTFT probe。它们都回答不了业主要求的两个问题:**生成质量
究竟在哪里失败**(后端交互设计、手机前端 UI),以及**上一次 harness 改动是否
让生成变得更好**。本程序:通过 harness 提升应用生成能力,由一个自动研究循环
驱动,其第一使命是找到 def 的问题,而不是证明健康。

## Decision(决策)

### 用什么测(benchmark 选型)

**主基准——仓库内部:`test/panel/appgen-eval.mjs`**(L3/M4 锚点之上的广度层):

- 8 类手机应用原型(音乐、钱包、聊天、工具箱、番茄钟、日历、电商、健身)×
  每类 N 跑;音乐类 prompt 与 L3 逐字相同,保持与已提交的 L3/M4 账本可比。
- 每跑受两道判:(a)**四门校验器**——产品在 `appshell_render` 处执行的同一套
  结构门;(b)**设计宪法的机器可查一半**(rubric:hero 先行、顶层块预算、嵌套
  深度、title 预算/长度、emoji 预算、tab 长度、移动模板数量、占位文案、封面
  色板、非空 actions)。宪法的视觉一半(hero 视觉重量、色场统治)留给未来的
  截图腿——是点名的盲区,不是隐瞒。
- 每个失败都带类别码(校验器码、`RUBRIC_*`、`UNPARSEABLE`、`HTTP`),且首过
  失败类别在重试成功后仍然保留——普查要的是失败信号,不是康复故事。
- Provider 中立(`LLM_*` 覆盖 `ZAI_*` 默认),账本按 `LEDGER_STEM` 键入
  `tools/dev-web-carrier/artifacts/appgen-eval/`,作为收据提交。
- 度量卫生,两处都咬过一次:延迟在**响应体收净之后**采样(M4 账本记录过的
  ~30× header 时间谎报),任何可疑数字先过 **nonce/方差对照**(同 prompt
  两跑必须不同;织入必填字段的 nonce 必须回来)再采信。

**方法供体——外部,按模式借鉴,绝不整体引入**(它们面向 HTML 网站或原生
app,不是 app-shell spec;四门校验器才是产品自己的契约):

| 供体 | 借什么 |
|---|---|
| [WebGen-Bench](https://github.com/mnluzimu/WebGen-Bench)(NeurIPS 2025 D&B) | 「生成→实际操作→断言」的验证形态 → 未来的 **action-execution 腿**:生成的 `actions` 对 mock 工具真派发、按结构化日志断言(harness 自己的 E2E-by-logs 法) |
| [WebCoderBench](https://arxiv.org/html/2601.02430v2) | 其指标清单(视觉/内容/可访问性/性能/对齐)是未来**视觉腿**(截图+判官)的维度来源 |
| [1D-Bench](https://arxiv.org/abs/2602.18548) | 带视觉反馈的迭代式 UI 生成——未来截图-修改腿的形状 |
| [OpenHarmony Bench](https://arxiv.org/abs/2608.16022) | 真机验证的应用级任务——harmony 面的语料供体,远期 |
| [Web-Bench](https://github.com/bytedance/web-bench)(ByteDance) | 项目内序贯依赖任务——未来多轮 morph/update 链 benchmark 的形状 |

**移植——百分值 benchmark**(语料和公式移植, harness 仍是自己的)。供体
benchmark 没法对 def 直接跑——WebCoderBench 24 个指标里 21 个的工具链挂在
HTML/CSS/JS 代码上而 JSON spec 没有这些东西,WebGen-Bench 的 647 条测试用例
是开浏览器操作网站的,它那家带法务限制的姊妹 benchmark 数据干脆没公开——所以
移植搬的是能穿过产物类型变化的部分:**测试用例、计分公式、诊断项**。

- **`test/panel/appgen-bench/webgen-port.json`**(由
  `appgen-bench/build-port.mjs` 从上游克隆生成):从 101 指令/647 用例的语料
  中选 12 指令/74 用例,按「能映射成单面手机应用」的应用类型均衡覆盖(电商、
  效率、资讯、社交、旅行、流媒体、消息)。**测试用例逐字保真**——task、
  expected_result、分类原封不动;只有指令被改写成 def 原生形态(功能全保留,
  颜色要求映射到 `theme.accent`),benchmark 的语义仍是 benchmark 的。
- **`test/panel/appgen-bench-port.mjs`** 原封不动地在**用例级**执行上游公式:
  `accuracy = (N_yes + 0.5 × N_partial) ÷ N_total × 100%`,外加上游诊断项
  (start-failed 率 = 生成没产出有效 spec,其用例全判 NO;judge 失败的用例从
  分母剔除)。细分:按用例类别(Functional / Data Display / Design
  Validation)和按指令。
- **执行层 v1 = spec 审查 judge**:异族 judge(生成 deepseek、判分
  glm-4.6——防同源偏好)对着生成的 spec 逐用例判:YES(内容在场且 action
  能交付)/ PARTIAL / NO。这是诚实的静态层;action-execution 腿落地后升级为
  真派发——升级属于 benchmark 变更(新 tier、新基线账本),不是悄悄改分。
- 循环在这条轴上的优化目标就是 **accuracy 百分值和它的三个类别百分值**——
  一轮一轮看 delta,账本形状和 census 相同。
- **链式移植(Web-Bench 的形状)**——`test/panel/appgen-chain.mjs`:对同一个
  表面做**序贯依赖**的修改任务(渲染→任务 1→任务 2→任务 3),update 载荷经
  产品自己的 `mergeUpdate` 合到当前真值、先过同四门、judge 再判任务。被拒绝
  的更新判 NO,链从最后的有效真值继续——就是产品的真实行为。产出链式
  accuracy % 和逐位衰减(越靠后的依赖任务存活率如何?)。这是**后端轴**的
  百分值 benchmark;上面的移植 benchmark 是一次性渲染轴。
- **不可移植,如实记录**:OpenHarmony Bench(任务是可构建的 ArkTS 工程真机
  验证——def 不生成 ArkTS)和 1D-Bench(其迭代指标依赖截图腿;形状留给那条
  腿的设计)。WebCoderBench 的规则系指标(Lighthouse/ESLint/Laplacian/
  MDN-BCD)对 JSON spec 无 input——只有它的 judge 系指标可移植,归未来的
  视觉腿。

### 循环怎么跑(auto-research 选型)

- **循环引擎:宿主 agent 定时执行**(ZCode cron),不架框架服务。deep-research
  引擎(GPT-Researcher、LangChain open_deep_research、dzhng/deep-research、
  HF open-deep-research)是自带模型管线的整套服务——对进程内循环过重;借的是
  **dzhng 的递归 search-refine 模式**(搜索→评估覆盖→补搜缺口)作为循环内的
  研究手法。AI-Scientist 家族(Sakana AI Scientist、Agent Laboratory、
  FutureHouse Kosmos)的目标产物是论文——对产品循环是错的工件。
- **发布与记忆**:普查账本提交入库;每轮 digest 落成 GitHub issue
  (agents-radar 形态——有日期、可检索、按标题去重);跨轮状态活在这些 issue
  和已提交的账本里。
- **周自审**(ai-research-arm 形态):提案采纳率、来源质量、账本陈化、以及
  rubric 是否偏离了产品宪法。

### 循环六步

1. **测**——全类目跑 `appgen-eval`,提交账本
   (`LEDGER_STEM=appgen-census-<model>-<date>`)。
2. **断**——归类首过失败;每个复现类别成为一个有名有据的问题(行、失败
   类别、计数)。
3. **研**——按问题类别做外部调研(论文、benchmark、开源同行),用递归
   search-refine 手法;改进提案写进当轮 digest。
4. **发**——digest(数字、问题清单、提案)落成打 `appgen-loop` 标签的
   GitHub issue。
5. **改**——获批提案走正常 PR 落地。优化面按杠杆排序:模型真正看到的撰写
   规则(`system-plugins/dsh-appshell/index.js` 的 `RULES`,即
   `appshell_render` 的 tool description)、校验器门(`lib/validate.js`)、
   组件目录(`lib/catalog.js`)、渲染面。`main` 受保护;评审就是门。
6. **复测**——落地 PR 重跑 `appgen-eval`;对上一份账本的 delta 就是收据。
   没有复测数字,不宣称改进。

### 边界

- **改进步已获 owner 授权自动执行**(2026-10-29:「自动更新 harness …插件,
  skills, prompt 等任何可以改变的内容」)——循环把 harness/prompt/validator/
  catalog 改动作为正常 PR 落地,不再逐项等 go;gates 和分支保护仍是防线,
  **发布动作(bump/tag/发布)仍需明确 go**。每个自主改进 PR 必须携带复测
  delta:没有 delta 数字,不合并。
- 普查真烧 token:默认每轮每类 2 跑(flash 档 ~16 次调用,量小);定 bars 的
  深跑(N=10,L3 深度)发生在落地 PR 里,不是每轮都跑。

### 首轮普查(v1,deepseek-v4-flash,2026-10-28)

账本:
`tools/dev-web-carrier/artifacts/appgen-eval/appgen-census-deepseek-v4-flash.json`
(8 类 × 2 跑,每失败一次再生腿)。建场期间全集跑了三遍,以下失败类别跨跑
稳定。按杠杆排序:

1. **action id 命名是主导结构失败(`BAD_ACTION`)**——违反
   `^[a-z][a-z0-9.:-]{0,63}$` 门的 id,在 `$.actions` 和节点 `.action`
   两条路径上都出现,恰好集中在 prompt 点名商业性多字动作的地方;失败是
   间歇的(temperature 方差——同 prompt 探针能过)但难恢复:电商类三遍普查中
   两遍 0/2 **final**,三遍合计 6 跑只救回 1 跑。校验器的拒绝消息只回显正则、
   从不指认违规 id,模型——以及带着同一张收据的重试腿——修不了自己看不见的
   东西。改进候选 #1:`lib/validate.js` 给出可行动的拒绝(引用违规值、给出
   合规改写)+ 重试指令改成修复形。
2. **Hero 先行 vs 工具型原型(`RUBRIC_HERO_FIRST`)**——工具类应用偶尔以功能
   九宫格而非横幅开场(每跑 1-2 次)。是宪法歧义,不是模型无能。
3. **深度越界(`RUBRIC_DEPTH`)**——偶发嵌套 4 层;次要。
4. **期望覆盖率跟随 prompt 显式度**——prompt 点名点到的组件近乎 100% 命中;
   钱包的 balance-card(只暗示、没点名)在某些跑中缺席。

度量卫生,第一天就挣来的:已提交账本的延迟在响应体收净后采样(M4 笔记的
~30× header 时间陷阱,建场期间又咬了一次、又修了一次),端点速度经方差 +
nonce 对照验证为真生成(同 prompt 两跑不同;织入必填字段的 nonce 会回来)。

## Consequences(后果)

- 生成质量从此有统一货币:每个 prompt/门/目录改动都能在同一账本格式、跨模型
  地出示 delta。
- rubric 有意只做「机器可查的一半」;视觉腿落地之前,审美回归对普查不可见
  ——这是循环已点名的盲区,排在 action-execution 腿之后的路线图上。
- 普查 prompt 集是版本化工件(`prompts.json` v1、`SYSTEM_V1` 冻结在
  `system-prompt.js`);prompt 迭代一律开新版本、绝不改旧的,旧账本才永远
  可解读。
