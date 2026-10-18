# 生成式 UI 落地计划：A2UI × Lynx × DSH（2026-10-17 立项底稿）

结论先行：**DSH 生态零 a2ui（五层核实），席位空缺且缝位现成。** 本计划把悬置的"生成 UI 契约欠账"（卡面 JSON 尾账）收敛为：**以 A2UI v0.9 为目标格式**（与 Lynx 官方 `@lynx-js/genui` 对齐，不自造格式），**P0 先在 `contract/proposals/` 走 D5 提案**；agent 侧（QuickJS 纯 JS）产出/校验 A2UI 消息 + 组件目录提取，渲染末端挂既有 Lynx 渲染缝（RenderSurfaceClient / lynx-view），交互经 gateway 事件回流。最小闭环**不需要新增宿主原语**。状态：底稿，等 owner go 后动 P0。

## 0. 背景（一句话版）

2026 年生成式 UI 已定型为两轴：**传输**（AG-UI 1.0=自己 app 的流式事件，2026-09-30；MCP Apps=2026-01-26 成 MCP 首个官方扩展 SEP-1865，别人宿主里渲染）× **生成三档**（Static 选组件 / Declarative 声明式=生产默认 / Open-ended 全代码 5-10 倍成本）。Lynx 官方已把三档全装进 `@lynx-js/genui` 一个包。权威综述：openui.com "The State of Generative UI in 2026"。完整调查记录见会话调研（2026-10-17）。

## 1. 证据基线（2026-10-17 查实）

### 1.1 协议与格式格局

| 东西 | 状态 | 与本计划的关系 |
|---|---|---|
| AG-UI 1.0 | 2026-09-30 稳定版，Google/MS/AWS 背书，~16 事件 | 传输层参考；我们自有 gateway/SessionServe 事件流，不强依赖 |
| MCP Apps (SEP-1865) | 2026-01-26，MCP 首个官方扩展 | **非目标**（我们不做别人宿主里的 UI） |
| A2UI v0.9 | Google 2025-12-15 开源；spec 已滚 v1.0，多数渲染器在 v0.8/v0.9 | **目标格式**；锁 v0.9 与 Lynx 官方渲染器对齐 |
| OpenUI Lang (Thesys) | 行式 DSL，token 效率赢一倍（4.8k vs ~10k，首渲 19.4s vs ~40s） | 基准对照组；`@lynx-js/genui` 同时带它的渲染器，P1 可实测 |
| `@lynx-js/genui` v0.7.0 | lynx-stack 正式包，A2UI 官方 Community Renderers 页在册（Lynx Mobile/Web/Desktop，**仅 v0.9**） | 渲染末端候选实现 |

### 1.2 Lynx 侧（渲染末端已备好）

`@lynx-js/genui`（packages/genui，CHANGELOG 高频迭代 PR #4127–#4190）关键入口：

- **A2UI 渲染**：`./a2ui`、`./a2ui/0.9`、`./a2ui/store`（createMessageStore，transport 推协议消息）、`./a2ui/react`（`<A2UI messageStore catalogs onAction>`）、`./a2ui/catalog`、`./a2ui/snapshot`、`./a2ui/functions`、styles
- **Agent 侧配套**：`./a2ui-prompt`（buildA2UISystemPrompt）、`./a2ui-catalog-extractor`（+/cli、**+/skill** —— 目录提取的 agent skill 形态先例）
- **OpenUI Lang v0.5 流式渲染**：`./openui`（createOpenUiLibrary、OpenUiRenderer，isStreaming 缓存完成语句+预览未完成尾部）、`./openui/explicit`、`./openui/chat/<Component>`、`./openui/data-tools`
- **全代码档**：`./reactlynx`（REACTLYNX_SYSTEM_PROMPT + parseReactLynxSource 校验 + buildReactLynx Node 编译）；`./lynx-xml`（headless 装配+normalize）
- Peer 依赖：`@lynx-js/react`（必）、`@lynx-js/lynx-ui`（部分面）

### 1.3 DSH 侧空位（五层核实，零 a2ui）

本仓 grep（假阳性=base64 夹具+genuine 撞词）、pin 表 30 个 @deepseek-ai 包、上游 checkout 55+ 包、deepseek-ai org 代码搜索、npm（网络失败，GitHub 侧已足）——**全部无 a2ui**。两个最接近的上游资产：

1. `external/dsh/tools@0.1.6-alpha.2/lib/types/presentation.d.ts`：工具渲染意图词汇表（presentCall/presentResult；generic/terminal/diff 卡、ToolCallKind、FileLocation follow-along、FileDiff）——**Static 档已在**，provider-neutral，可作 catalog 的存量输入之一。
2. `dsh-client-ui-slots`（typed slots + Component Factories + **renderer install contract**，React-free）+ `dsh-client-ui-cordis` + `dsh-web`——宿主侧"UI 挂哪里"的既有机制。

### 1.4 本仓缝位（全部现成）

- Lynx 渲染缝：doc/ARCHITECTURE.md:205（render-surface client），RenderSurfaceClient 双皮肤（PR #248）；Pages 已有真 lynx-view
- 生成侧既有实践：creation mode（README.md:55，全代码档在跑）；番茄钟/日历 LLM 亲笔源码在线插入；原生卡面 JSON（#427 尾账=卡面 JSON 契约未入 contract/）
- 传输：SessionServe / gateway 事件流（D8 齐备）；E2E 日志断言体系（门 7）

## 2. 目标 / 非目标

**目标**：agent 能在会话中产出符合 A2UI v0.9 的 UI 消息；宿主（Lynx 面）渲染并回流交互；组件目录从我们的插件/卡面资产提取；转义、无任意代码执行、执行预算写进验收；卡面 JSON 存量给出迁移评估。

**非目标**：不做 MCP Apps 宿主侧；不动卡面 JSON 存量行为（只评估迁移）；不在 QuickJS 里跑 ReactLynx/React（渲染在宿主 Lynx 引擎，QuickJS 只产/校验消息）；本计划不引入宿主新原语（若 P3 回流需要新原语，回 D5 补）。

## 3. 分阶段

### P0 — D5 提案（唯一立即项，等 go）
产出：`contract/proposals/2026-10-XX-a2ui-generative-ui.md`。内容：目标格式锁 A2UI v0.9（写死版本，防 spec 滚动）；消息流（SessionServe 事件承载）；组件目录来源（卡面 JSON + presentation.d.ts 词汇表 + 插件声明）；事件回流缝（onAction→gateway 事件，是否需新原语在此定）；转义/安全规则；escape-hatch 边界（默认不开 GeneratedView 沙箱档，留提案讨论）。验收：提案入册，owner 批。

### P1 — agent 侧 QuickJS 闭环（纯 JS）
产出：system prompt builder（A2UI v0.9 约束，参考 a2ui-prompt 思路自实现）+ catalog extractor（输入=卡面 schema/插件清单）+ 消息校验器（落点 `runtime/dsh/` 或 outboard 包，P0 提案定）。同时跑 **A2UI vs OpenUI Lang token/延迟基准**（glm-4.6 实测），把数据带回给 owner 定主格式。验收：真 LLM 轮产出过校验器的 A2UI 消息，日志断言（scenario-id 齐备）。

### P2 — 渲染末端（宿主 Lynx 面）
产出：dev-web-carrier lynx-view（或 iOS Lynx 宿主，优先级待拍板）挂 `@lynx-js/genui/a2ui`；vendor-package 流程 pin（新上游包，走 D6：pin 表+embed 清单，宿主侧资产不进 QuickJS 闭包）。验收：P1 消息在真 lynx-view 渲染出界面（截图仅本地调试，CI 走日志）。

### P3 — 事件回流闭环
产出：`<A2UI onAction>` → gateway 事件 → agent 续轮；卡面交互验收走 E2E 日志。验收：点生成的按钮→agent 收到→回复更新界面，全链路事件序列在日志可断言。

### P4 — 安全与存量
产出：不可信文本转义规则+注入红队用例（SAEP 教训：生成 UI 截图/卡面文本必须转义）；执行预算/超时兜底（生成跑飞不卡主线程）；卡面 JSON→A2UI 迁移评估报告。验收：红队用例全绿；报告入册。

## 4. 风险与开放点

- **spec 滚动**：A2UI 已滚 v1.0 而 Lynx 渲染器仅 v0.9——锁 v0.9 提案写死；升级等 Lynx 官方跟进。
- **token 成本**：A2UI JSON ~10k vs OpenUI Lang 4.8k——P1 基准定夺；渲染末端两者都在 `@lynx-js/genui` 里，切换成本可控。
- **vendor 体积**：`@lynx-js/genui`+`@lynx-js/react`(+lynx-ui) 只进宿主 Lynx 面（iOS/harmony/carrier），不进 QuickJS 闭包——但 iOS 体积增量要在 P2 实测。
- **边界清晰性**：ReactLynx 跑在宿主 Lynx 引擎（PrimJS），与我们 QuickJS 单线程无冲突；两个 JS 世界经 SessionServe 消息缝互通，不共享状态（合 §6 线程/模块规则）。

## 5. 待 owner 拍板

1. 主格式：A2UI v0.9（推荐，Lynx 官方对齐+生态最大）vs OpenUI Lang（token 减半，P1 基准后可改）。
2. escape-hatch（catalog 内注册沙箱 GeneratedView 全代码档）：默认不开，是否留提案讨论。
3. P2 渲染宿主优先级：dev-web-carrier lynx-view（快、零签名成本）先，还是 iOS Lynx 宿主先。

## 6. 来源

- @lynx-js/genui：github.com/lynx-family/lynx-stack/blob/main/packages/genui/README.md（+CHANGELOG）；提案 discussion #2453
- A2UI：a2ui.org（+/ecosystem/renderers、/ecosystem/a2ui-in-the-world）；developers.googleblog.com A2UI 开源与 v0.9 公告
- 综述：openui.com/blog/state-of-generative-ui-report（2026-06-10）；copilotkit.ai AG-UI 1.0；blog.modelcontextprotocol.io MCP Apps（2026-01-26）
- Lynx：lynxjs.org/next/blog/lynx-open-source-roadmap-2026（"explore generative UI…key direction"）
- 本仓：doc/ARCHITECTURE.md:205；README.md:55；external/ensure-dsh.sh pin 表；external/dsh/tools@0.1.6-alpha.2/lib/types/presentation.d.ts
