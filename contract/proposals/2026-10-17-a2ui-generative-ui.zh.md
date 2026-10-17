# 提案：agent-UI 缝——以 A2UI v0.9 作为声明式生成 UI 格式（仅格式收编候选）

> **状态：DRAFT（呈 owner 接受或否决；不翻转任何现状、不冻结任何条文、不附带
> 任何代码——本文件本身就是 D5 工件。尽可能最轻的收编：只在 data-protocols.md
> 增加一个带版本的格式定义，零新原语、零新通道。）**
> English | [简体中文](2026-10-17-a2ui-generative-ui.zh.md)（本文件）

## 动机

今天 agent 能递到用户面前的像素有三类，没有一类进过合同：

1. **卡面是非正式格式。** 插件经总线投递 `card.present` / `card.complete`
   （`__dshBusPost`，见 `runtime/dsh/system-plugins/dsh-create/index.js:131-160`
   的生成插件）：`{ id, kind, title, subtitle, durationMs }`。没有 schema、没有
   版本、没有符合性规则——番茄钟 create-loop 落地（#427）留下的知名尾账"卡面
   JSON 契约"。每种新卡形都是一门私有方言。
2. **全屏档只有命令式。** 渲染面（v1.10.0，primitives.md §4）给了 agent
   `presentSurface`/`surfaceDraw` 和封闭算子集 `surface.ops@1`——那是画板，不是
   UI 工具箱。表单、列表、确认卡该用的是组件树，而合同里没有。
3. **业界已经标准化，而且标准站在我们这边。** 2026 现状（2026-10-17 调查）：
   AG-UI 1.0（2026-09-30；Google/Microsoft/AWS）、MCP Apps 成为 MCP 首个官方
   扩展（2026-01-26，SEP-1865）、Google 的 A2UI（2025-12-15，开源，Apache-2.0）
   作为声明式格式在 web、移动、桌面原生渲染且**不执行任意代码**。而我们的渲染
   缝 Lynx 已经有官方渲染器：`@lynx-js/genui` v0.7.0（lynx-stack，列于
   [a2ui.org/ecosystem/renderers](https://a2ui.org/ecosystem/renderers)，Lynx
   Mobile/Web/Desktop，**A2UI v0.9**）。

与此同时生态席位空缺：2026-10-17 的五路核查（本仓、上游 pin 表、
`external/dsh` checkout、deepseek-ai org、GitHub 代码搜索）确认 **DSH 侧零
A2UI**。最接近的上游资产只有静态渲染意图词汇表
（`external/dsh/tools@0.1.6-alpha.2/lib/types/presentation.d.ts`）和客户端 UI
槽位机制（`dsh-client-ui-slots` renderer install contract）——是地板，不是
协议。

2026-09-30 的 Lynx 试点注记
（`.agents/notes/implemented/architecture/2026-09-30-the-lynx-render-surface-client-is-a-pres.md`）
确立了本提案沿用的纪律：客户端面作为可整体替换的 presentation-plane 插件跑在
SessionServe 线上，零网关原语。本提案把这条纪律延伸到消息层：选定 Lynx 面已经
能渲染的行业格式，钉住版本，把卡面欠账收编进去。

## 提案

采纳 **A2UI v0.9**（`@lynx-js/genui` 渲染的精确版本）作为合同的声明式
agent-UI 格式，增量定义为 data-protocols.md 新节 **`a2ui.messages@0.9`**
（与 `surface.ops@1` 的定义方式互为镜像），缝位如下：

- **下行（agent → 客户端）：零新原语、零新通道。** A2UI 消息是会话内容，与
  工具调用卡同一海拔：runtime 在会话流上发出，客户端经既有 SessionServe 线
  接收（三层信封不动）。各宿主用自己的渲染器渲染——Lynx 面用
  `@lynx-js/genui/a2ui`（`createMessageStore` + `<A2UI catalogs onAction>`）；
  Web Client 沿用沙箱 iframe 创作查看器作为地板。
- **上行（客户端 → agent）：动作以用户轮进入。** 渲染出的 A2UI 面上的
  `onAction` 变成带组件路径与消息实例 id 标记的用户轮事件——它本身不授予任何
  能力，与一切用户发起的请求过同样的审批缝（#441）。v0 不设 `ui.action` 通道；
  若收编证据表明"标记为轮"有损，升级路径是 §5 加通道，届时凭证据决定。
- **目录：提取，而非发明。** 会话提供给模型的组件目录从已声明资产派生——卡面
  schema（迁移后的 `card.present` 词汇）、上游 presentation 意图词汇
  （`presentation.d.ts`）、插件声明组件。提取器是 runtime 闭包内的纯 JS，
  不经宿主。
- **安全规则随格式节走：** 组件字符串字段是文本——绝不是标记，绝不是会被自动
  抓取的 URL；v0 没有 HTML 逃生舱（开放端生成保持它的现状：经审批缝的创作模式
  源码，创作查看器地板不变）；每轮消息数与树尺寸预算；生成内容可流式解析，故
  敌意或跑飞的模型输出会被截断，永远不会卡死 runtime（QuickJS 保持单线程；
  渲染器在玻璃另一侧的客户端里、Lynx 自己的引擎中——两个 JS 世界不共享状态，
  依 ARCHITECTURE.md §6）。
- **版本钉死是合同的一部分。** `a2ui.messages@0.9` 把 spec 版本写进格式名；
  只有当我们钉住的 Lynx 渲染器支持更高版本时才升级（渲染器今天仅 v0.9，而
  spec 已继续滚动——这个落差正是版本要进格式名的原因）。

## 位置（三档地图）

| 档 | 机制 | 收编后的合同状态 |
| --- | --- | --- |
| 静态卡 | `card.present` 总线投递 | 遗留；映射进 A2UI 目录，弃用评估在收编时做——绝不强制迁移 |
| 声明式 UI | **本提案：`a2ui.messages@0.9`** | data-protocols.md 的带版本格式 |
| 全屏图形 | `presentSurface`/`surfaceDraw`（`surface.ops@1`，v1.10.0） | 不变——命令式，互补 |
| 开放端代码 | creation mode（README.md:55） | 不变——源码经审批缝 |

## 被否决的备选

- **OpenUI Lang（Thesys）**作为目标格式：它在公开 token 基准上赢（约 4.8k 对
  ~10k tokens，首渲 19.4s 对 ~40s），Lynx 也为它带了渲染器——但 A2UI 背着更大
  的生态（Google 背书、目录协商、我们发布的每个平台都有原生渲染器），且 Lynx
  面的 A2UI 路径与它对齐。token 差距是真实风险，所以收编要求先在我们自己的
  LLM（glm-4.6，计划 P1）上实测基准；若 OpenUI Lang 在我们的流量上决定性胜出，
  本提案接受在收编前被重开。
- **Vercel json-render**：纸面渲染器覆盖面最宽，但没有 Lynx 渲染器、没有目录
  协商——它优化的是我们不托管的场景。
- **自造卡 schema**：那就是 `card.present` 的现状——临时格式是要退场的欠账，
  不是解法。
- **MCP Apps**：是把 UI 渲染进*别人*宿主客户端的传输；我们自己就是宿主。构造
  上出圈。
- **什么都不做 / 等上游 DSH**：上游零 A2UI、无新增信号；等待让卡面账本继续
  挂着，并把席位让出去。

## 非目标

- 本收编不新增网关原语、不新增事件通道、不写宿主代码。
- v0 不做 escape-hatch GeneratedView（声明式目录内嵌沙箱 HTML）——只有出现
  具体内容需求才重开。
- 不强制迁移既有 `card.present` 生产方。
- 不做 MCP Apps 宿主面；不改变创作查看器的地板姿态。

## 若被接受（收编计划）

1. 增量收编：data-protocols.md 增 `a2ui.messages@0.9`（格式、安全规则、预算）；
   primitives.md 只增一个指引。收编动作本身不翻转任何代码。
2. 任何实现落地前的证据腿（计划 P1–P4，立册于
   `.zcode/plans/a2ui-generative-ui-plan.md`）：agent 侧 prompt/校验器/目录
   提取器纯 JS；真 lynx-view 经 `@lynx-js/genui` 渲染 runtime 发出的消息（走
   vendor-package 流程钉入，仅客户端侧）；`onAction` → 用户轮回流；注入红队
   用例（不可信文本转义，依 SAEP 结论）；E2E 走结构化日志、唯一 scenario-id、
   期望↔日志一一对应。
3. 每条腿沿用 Lynx 注记的试点纪律：客户端面工作加零原语，在属于自己的收编前
   不碰 `contract/` 下任何文件。

## 证据基线

- `@lynx-js/genui` v0.7.0：lynx-stack `packages/genui/README.md` +
  `CHANGELOG.md`（PR #4127–#4190）；提案讨论 lynx-family/lynx-stack#2453。
- A2UI：[a2ui.org](https://a2ui.org)（开源，Apache-2.0，2025-12-15）；
  [生态渲染器页](https://a2ui.org/ecosystem/renderers)（Lynx 条目，v0.9）；
  Google developers blog（A2UI v0.9，2026-04）。
- 业界调查 2026-10-17：openui.com "The State of Generative UI in 2026"（传输
  × 三档生成；OpenUI Lang token 基准）；AG-UI 1.0（copilotkit.ai，
  2026-09-30）；MCP Apps（blog.modelcontextprotocol.io，2026-01-26）。
- 仓内锚点：`runtime/dsh/system-plugins/dsh-create/index.js:131-160`
  （card.present 投递）；`contract/primitives.md` §4 渲染面 / §5 事件通道
  （v1.10.0）；`external/dsh/tools@0.1.6-alpha.2/lib/types/
  presentation.d.ts`；`presentation/lynx-client`（RenderSurfaceClient 缝，
  PR #248）；doc/ARCHITECTURE.md:205；README.md:55。
