# 一句话换 App（Prompt-App Morphing）详细计划 v2（2026-10-17 立项；同日两轮评审）

结论先行：**目标 = 对 web GUI 的 agent 说一句"变成网易云音乐"，整个应用壳（主题/标签页/首页结构）在流式中重生成，三连换（微信→网易云→支付宝）无感切换，全程无一行 HTML/JS 出自模型。** 这是 #567 提案（a2ui.messages@0.9）的第一个真实消费者，也是 def"无定义 app"的旗舰演示。路线：**web GUI 先行、自研 mini-catalog 渲染器、全屏可关闭表面承载、Lynx 延后为第二渲染面**。状态：v2 底稿（含两轮评审修复），等 owner go。

## 0. 演示靶子（先定"什么算成了"）

- **A1 生成**：真 glm-4.6 轮产出**过校验器**的 app-shell spec（scenario `appshell.spec`，E2E 日志一一对应）
- **A2 渲染**：web client 原地换壳（主题/标签/内容三换），dev-web-carrier 可复现；截图仅本地证据
- **A3 回流**：spec 内交互元素回流 agent 并驱动 update
- **A4 安全**：红队 ≥20 注入用例全数拒绝/净化
- **A5 跨端**：同一份 spec 在第二渲染面（Lynx web-core）渲染成功
- **A6 成本**：实测入册，阈值见 M4（完整 morph P50 ≤3k / P95 ≤5k tokens；update P50 ≤1.2k；端到端 P50 ≤20s）

**验收三性（全任务卡总原则）**：完整 = 覆盖该任务全部交付面，无"待定"行；准确 = 判定物是仓库内可复核的产物（receipt/日志/报告/截图），不是口头自评；可量化 = 每条标准带数字阈值，数字以实测为准、禁止引用记忆。

## 1. 已验证的地基（本会话完成）

- demo `one-prompt-app-morph.html`：手写渲染器 ~300 行换壳三套界面——同时证明了**渲染器量级可控**和**复合组件（聊天行/宫格/迷你播放条/余额卡）可由少量原语组合**（前者进 D-2，后者进 D-1 两层制）。
- 三层模型定型：GM 编（spec 生成）/ JEV 判（后置层，v0 不阻塞）/ 引擎算（校验器+渲染器确定性）。
- 生态参考：a2ui-render-in-dsh（三工具模式、流式截断修复）、@ant-design/x-card（官方 A2UI 实现）、dsh-genui（fence 路线的安全对照面）。

## 2. 关键设计决策

### D-1 组件两层制：原语层 + 模板层
- **原语层**：词表 = **A2UI v0.9 标准集 ∩ Lynx catalog 支持集**（M0 冻结，硬约束 ≥12）；这是唯一进合同的词汇。
- **模板层**：demo 里的聊天行/宫格/迷你播放条等复合组件定义为 schema 模板——**每个模板必须可展开为纯原语树**（校验器强制检查展开性）。
- 为什么这样切：模板在 spec 侧是写作糖，**编译回原语树后第二渲染面天然可渲染**——跨端承诺（A5）由构造保证，不靠 Lynx 追赶我们的目录。M0 分别量化两层。

### D-2 渲染器：自研 mini-catalog（否决 x-card）
x-card 是 React 系，web-client-v2 是无框架原生 JS 客户端——嵌 React 违和且拉重依赖。自研渲染器量级已由 demo 证明（一个组件/模板 = 一个纯函数 `spec.node → DOM`）。渲染器可整体替换，spec 是唯一合同。渲染器**按组件分文件、目录表驱动注册**——20+ 组件塞单文件必撞 500 行 code-size 门。

### D-3 Agent 侧形态：三工具插件（社区验证模式）
`appshell_render`（渲整壳）、`appshell_update`（按 surfaceId 原地更新子树——增量省 token）、`appshell_catalog`（按需返回目录+写作规则，一次/会话）。落点 system-plugins 或 runtime 内置，M1 定。**写作规则与目录走工具描述 + `appshell_catalog` 按需返回——v0 不动 presets/系统提示词装配**（tools/presets 装配纪律）。

### D-4 传输、表面姿态与生成期 UX
- **表面姿态：全屏可关闭表面**——时间线里出一张摘要卡，点开（或自动）进入全屏 App 表面，右上角关闭回对话。先例：创作查看器（"above the Web Client, closable by the user"）。**不在时间线内做内联换壳**——那等于把对话流整个替换掉，既危险又不可逆。
- 传输：spec 走会话内容（工具调用卡）；web-client-v2 timeline 的 toolview 面渲染（M0 定插入点）。
- 生成期 UX：spec 到达前显示 typing 指示；spec 分块到达时**分块渐进渲染**（先壳后内容）。
- **单表面策略**：已开表面收到新 render = 同 surfaceId **原地替换**（demo 的 morph 语义；对照 render surface v0 单表面 fail-soft 先例）；不做多表面并行。
- **动作可见性**：动作类点击 = **带组件路径标记的用户轮**（诚实审计，走 #441 同款接缝）；tab 本地切换静默、不产生轮——避免每次点击淹没时间线。
- **spec 重放**：表面关闭后重开 = 从 journal 的工具调用参数重放 spec（复用既有 session persistence，零新存储）。
- **web-client-v2 是 product tree（三处 staged 镜像）**：每次改动 `build/build.sh sync` + asset-mirrors 双向过门（#286 纪律），工作量计入 M2。

### D-5 安全模型（A4）
校验器四闸：组件白名单（原语+已注册模板，目录外拒绝+重生成提示）、文本节点纯文本转义（永不解释为标记/URL）、尺寸帽（消息 ≤32KB、组件 ≤200、嵌套 ≤8 层）、动作枚举（动作只能是目录注册的 action id）。

### D-6 测试场景一拆为二
- **`appshell.spec`**（CLI 可验，进 CI c-core 腿）：生成→校验→工具调用，mock 与真模型两档——CLI 没有浏览器，**渲染不在它的验证范围**；
- **`appshell.morph`**（dev-web-carrier + 浏览器断言，本地脚本腿，puppeteer-core）：换壳渲染、原地更新、console error=0——需要浏览器的断言全部住在这里。
- 一个场景验两层是假验收——拆开后每条腿的断言物各自诚实。

## 3. 任务卡（背景 / 目标 / 量化验收）

总原则：验收三性（完整/准确/可量化），数字以实测为准、禁止引用记忆。

### M0 组件盘点 + 插入点确认（1 天）
- **背景（前置条件）**：#567 已入册（main ≥ `524d0bf2`）；demo 可行性已证；需网络读取 lynx-stack 与 a2ui spec（走既有直连兜底手段）。
- **目标**：冻结两层组件表；确定 toolview 插入点与全屏表面复用面。
- **量化验收**：
  1. 原语层：A2UI v0.9 官方全集 N₁（逐个列出）、x-card 支持集 N₂、`@lynx-js/genui` catalog 支持集 N₃；交集表每行"组件名 / 三端 ✓✗ / 备注"，**无"待定"行**；
  2. 原语交集 **≥12**（<12 触发 §5 风险 3 降级路径）；模板层：demo 的 **8 类复合组件**逐个给出原语展开树（展开后 100% 落在原语交集内）；
  3. 插入点结论精确到**文件 + 函数**（预期 timeline.js 的 fold），新增 toolview 类型改动 **≤2 文件**；
  4. **全屏表面复用确认**：web-client-v2 的创作查看器式 fullscreen 机制（或等价姿态）存在性与复用面——文件 + 函数 + 复用改动 **≤2 文件**；不存在则给出新建面的最小方案；
  5. x-card 技术栈结论 1 行（React / 否）——informational，可跳过；
  6. M0 报告全项有数据才算完成。

### M1 app-shell schema + 校验器 + prompt builder（2-3 天）
- **背景（前置条件）**：M0 两层组件表冻结（硬前置）；glm-4.6 BYOK 路由可用；code-size 门生效中。
- **目标**："模型产出格式永远合法的 spec"的生成-校验闭环——写作规则随工具描述走，**零 preset 手术**。
- **量化验收**：
  1. schema 覆盖：原语交集 **100%**（各有定义+≥1 合法样例）；模板层 8 类全部定义且**每个模板的展开树 100% 落在原语交集内**（校验器可机械验证）；
  2. 校验器单测：合法用例 **≥10** 全过；恶意用例 **≥16**（未知组件/脚本注入/超尺寸/动作逃逸，四类各 ≥4）**拒绝率 100%**、返回结构化错误码；模板展开性攻击（伪模板不可展开）≥2 例全拒；
  3. 真模型基准：glm-4.6 同 prompt 连续 **10** 次，首轮流过 **≥8/10**，错误回执重生成后累计 **≥9/10**；
  4. 单 spec tokens **≤3k**、生成耗时 **≤15s**（10 次实测中位数）；
  5. code-size 门 **0 违例**。

### M2 web 渲染面（3-4 天）
- **背景（前置条件）**：M1 就绪；demo 渲染器为原型；staged mirrors 纪律生效。
- **目标**：dev-web-carrier 真对话三连换，全屏表面原地换壳——**第一演示时刻**。
- **量化验收**：
  1. 渲染器实现原语交集 **100%** + 模板 **8/8**（每项 = 纯函数，无白名单外特判）；
  2. **确定性 E2E（mock）**：三连换 **3/3 成功**（CI 口径）；**真模型演示**（demo 时刻）：三连换成功 ≥1 轮并录像/截图 ≥3 张；
  3. 单次"prompt → 新壳可交互"**≤20s 含模型**（3 次中位数）；mock 口径 ≤3s；
  4. DOM 组件节点数 = spec 声明数 **100%**（模板按展开树计）、console error **= 0**；
  5. 门全绿：asset-mirrors、staging-generated、code-size。

### M3 动作回流（2-3 天）
- **背景（前置条件）**：M2 就绪；会话内工具调用通道已有；动作枚举已在 M1 schema 定义。
- **目标**：本地类动作（tab 切换）不发模型；动作类（按钮）回流 agent 驱动 `appshell_update` 原地刷新。
- **量化验收**：
  1. 本地类响应 **≤50ms**（实测）；
  2. 回流闭环（点击 → agent → update → 刷新）**≤15s 含模型**；结构化日志链 ≥4 条（action / tool_call / update / render）一一对应；
  3. 增量 update tokens ≤ 全量 re-render 的 **40%**（同场景对照实测）；
  4. update 后 DOM 与新 spec 一致：组件 100% 渲染、旧节点 **0 残留**。

### M4 安全红队 + 总验收（2 天）
- **背景（前置条件）**：M1-M3 全绿；`doc/security-threat-model.md` 四腿对抗先例可循。
- **目标**：A4 闭环 + A1-A6 总验收出数。
- **量化验收**：
  1. 红队注入 **≥20** 用例（未知组件/脚本与事件属性/超尺寸 32KB+/动作逃逸/嵌套深度/**越权 update——伪造 surfaceId**，六类各 ≥3）：**拒绝或净化率 100%**，0 个产生可执行内容、目录外渲染或跨表面污染；
  2. `appshell.spec` E2E（CLI，CI）绿：manifest 期望行 = 实际行；`appshell.morph`（浏览器腿，本地脚本）绿：puppeteer 断言全过；
  3. 成本入册：morph **P50 ≤3k / P95 ≤5k** tokens；update **P50 ≤1.2k**；端到端 **P50 ≤20s**；
  4. 文本安全：含 `<`、`"`、`onerror=` 字段抽测 **100%** 纯文本渲染。

### M5 跨端第二渲染面（2 天）
- **背景（前置条件）**：M0 两层组件表在手；`@lynx-js/genui` v0.7.0 公开可装；**载体 = `@lynx-js/web-core`（Pages 已在用的浏览器内 Lynx 运行时，无需真机）**。
- **目标**：A5——同一份 spec 在第二渲染面成功渲染。
- **量化验收**：
  1. 模板先编译为原语树，**≥3 套** spec 经 web-core 渲染成功（渲染产物 + catalog 缺失报错 = 0），一条命令可复现；
  2. 若原语交集仍有缺口：差距记录 **100% 覆盖**（每个有名有姓 + 替代映射建议），并用子集重写 **≥3 套**渲染成功。
- 跨端是承诺不是前提：M5 不合格顺延，**不阻塞 M0-M4**。

### 收尾（0.5 天）
Agent Note（Problem/Decision/Alternatives）+ #567 提案状态注记（app-shell/0.9 为首个 profile）。

总计净估 **2.5-3.5 周**（单人节奏，含门与同步税）。

## 3.5 测试栈与成功认定

**测试六层**（判定物必须是仓库内可复核产物；日志是裁决、截图仅人看的证据）：

| 层 | 测什么 | 怎么测 | 在哪 | 通过判定 |
|---|---|---|---|---|
| L1 纯逻辑 | 校验器、渲染器纯函数 | vitest 表驱动：合法 ≥10 全过、恶意 ≥16 全拒、模板展开性全验；golden spec → DOM 断言 | CI 每 PR | 100% / 0 违例 |
| L2 契约 E2E | agent 确定性链路（spec 生成+工具调用） | `mock-llm-server.mjs` 脚本 SSE；scenario `appshell.spec` | CI c-core 腿 | 期望行=实际行 |
| L3 真模型统计 | glm-4.6 生成质量 | 同 prompt 连续 10 次；家族变更重跑、不作门禁 | 手动基准 | receipt 数字 |
| L4 浏览器渲染 | 换壳完整性、console | dev-web-carrier + puppeteer-core：DOM=spec（模板按展开树）、console error=0；`appshell.morph` 本地脚本腿 | 本地/PR | 100% / 0 |
| L5 安全对抗 | 四闸+模板展开性 | ≥20 注入用例走原始路径 | CI 安全腿 | 拒绝率 100% |
| L6 成本基准 | tokens/延迟 | morph/update 分列 P50/P95 | M4 入册 | M4 阈值 |

**成功认定分两级**：
- **功能成功** = A1-A4 全绿，逐条映射产物（校验器单测 / E2E manifest+verdict / 红队用例集 / 成本 receipt）。
- **设计成功** = 三个可证伪的反事实测试全过：
  1. **"第四个 App"测试**：新增"抖音"主题只新增一份 spec、渲染器一行不改——凡渲染路径需要改代码即设计失败（M2 收尾当天执行）；
  2. **"换渲染面"测试**：同一份 spec 不改一字在第二渲染器（M5）渲染成功；
  3. **"换模型"测试**：更换模型提供商跑 L3 基准，带重生成累计 **≥8/10** 不崩——接缝在 schema+校验器而非特定模型。

**认定流程**：每 PR 跑 L1/L2/L5；每里程碑对照量化标准逐条核销、证据链接进 PR 证据表；偶发红走 `rerun --failed` 先例；M4 收尾交《验收对照表》（左列标准、右列证据链接）——**认定人是 owner，逐条核销后功能才算设计成功**。

## 4. 明确非目标

- 不做通用 HTML/iframe 渲染（fence 路线——dsh-genui 已占的位，安全面不同）；
- 不动 Lynx/移动端主体（M5 仅浏览器内 web-core 证明）；游戏（口袋地城）封存为移动阶段压轴；
- 不在 v0 做 spec 持久化工作台/多人协作；不引入 React/重型框架进 web-client-v2；
- v0 不接 JEV（校验器是确定性闸已足够；JEV 意图分类/安全闸后置为体验增强）；
- 不在时间线内做内联换壳（D-4：全屏表面姿态）。

## 5. 第一轮审核记录

**过检**：D5 合同纪律（v0 不碰 contract/）✓；D6 上游纪律（自研非 vendor 改动）✓；Lynx 试点注记纪律（客户端面零新原语）✓；D8 事件驱动（spec 是事件流上的一次性内容，update 是增量事件）✓；门 7 日志验收 ✓；试点不 front-run ✓。
**风险与降压**：①toolview 机制现状未知 → M0 第一优先；②staged mirrors 税 → 每子任务收尾即 sync；③模型产出畸形 spec → 白名单+错误回执重生成，最坏降级"模板填充"；④JEV 缺席不阻塞；⑤成本失控 → update 增量+尺寸帽+schema 瘦身触发器。
**诚实未知**：x-card 技术栈（不影响 D-2）；Lynx catalog 交集大小（M0 出数）。

## 6. 第二轮评审修复记录（2026-10-17）

| # | 发现的问题 | 定性 | 修复 |
|---|---|---|---|
| 1 | 生成的 App 在客户端里的表面姿态未定义（M2 第一行代码就要回答） | 设计缺口 | 新增 D-4：全屏可关闭表面（创作查看器先例），明确不做时间线内联换壳 |
| 2 | M4 验收"E2E appshell.morph CLI 腿"自相矛盾——CLI 无浏览器，验证不了渲染 | 假验收 | 新增 D-7：场景一拆为二——`appshell.spec`（CLI/CI）与 `appshell.morph`（carrier+浏览器腿），L2/L4/M2/M4 同步改 |
| 3 | demo 的复合组件（聊天行/宫格/播放条）不在 A2UI v0.9 原语集，按旧口径三套界面"不合法" | schema 现实性缺口 | D-1 改两层制：原语层（⊆三端交集）+ 模板层（原语组合，校验器验展开性）；M0/M1 量化拆两层；跨端由"模板编译回原语树"构造保证 |
| 4 | M2"真对话三连换"混淆 mock（CI 口径）与真模型（演示口径） | 口径含混 | M2 验收拆确定性 E2E（mock, CI）与真模型演示（≥1 轮+录像）两行 |
| 5 | A6 与 M1/M4 阈值口径不齐（1-2k 预期 vs ≤3k/≤5k 阈值） | 口径不齐 | A6 改为直接引用 M4 阈值 |
| 6 | M5"Lynx 渲染"未写运行载体 | 不可执行 | 载体明确为 `@lynx-js/web-core`（Pages 先例，浏览器内无需真机） |
| 7 | 生成期 UX（spec 未到时用户看什么）未定义 | 体验缺口 | D-4 补：typing 指示 + 分块渐进渲染（先壳后内容） |

## 7. 第三轮评审修复记录（2026-10-17）

| # | 发现的问题 | 定性 | 修复 |
|---|---|---|---|
| 8 | "prompt builder 进 system prompt"撞 preset 装配纪律（不动 tools/presets 装配） | 纪律冲突 | 规则改走**工具描述 + appshell_catalog 按需目录**，v0 零 preset 手术（D-3/M1 同步） |
| 9 | 动作点击的可见性未定义——每次点击刷一条用户轮会淹没时间线 | 体验/审计缺口 | D-4 补策略：动作类 = 带组件路径标记的用户轮（诚实审计）；tab 本地切换静默 |
| 10 | 已开表面再收 render 的行为未定义（再开一个表面？） | 生命周期缺口 | D-4 补单表面策略：同 surfaceId 原地替换（render surface v0 单表面先例） |
| 11 | 表面关闭/页面刷新后 spec 丢失 | 持久化缺口 | D-4 补：从 journal 工具调用参数重放（复用 session persistence，零新存储） |
| 12 | 红队缺"越权 update"类——伪造 surfaceId 更新他人表面 | 红队盲区 | M4 红队五类扩六类（越权 update），判定加"跨表面污染=0" |
| 13 | M0 漏了全屏表面的复用确认——创作查看器机制在 web-client-v2 的存在性未验 | 插入点盲区 | M0 加第 4 项：viewer 机制存在性 + 复用改动 ≤2 文件，不存在则给最小新建方案 |
| 14 | 渲染器 20+ 组件塞单文件必撞 500 行 code-size 门 | 门冲突 | D-2 补：按组件分文件、目录表驱动注册 |
| 15 | "换模型 ≥6/10"与 L3 基准 ≥8/10 阈值打架 | 口径不一致 | 统一为带重生成累计 ≥8/10 |
| 16 | M0 的 x-card 结论在 D-2 已定后失去决策价值 | 精简 | 降为 informational、可跳过 |

## 8. 执行进度（2026-10-18 更新）

**已合并**：M1=#574（契约+四闸校验器+两层目录，0b4666b7）；M2+M3+M4=#576（web 渲染面三镜像、动作回流、红队断言，f09c6d84）；L3 prompt 迭代=#578。M0 交集 16≥12 达标。

**M5 翼已合并（PR #579 → main f3745b76，2026-10-18，CI 5/5 绿；任务卡 T-0248 全绿 28 门关闭；Agent Note 已落 .agents/notes/implemented/feature/）**：原落地分支 feat/appshell-l3-a2ui。
- 映射层对齐 @lynx-js/genui v0.7.0 冻结目录：action={event:{name}}、Card/Button 单 child（card→Card(child:Column)、button label→Text kid、无 action 合成 'tap'）、badge/image/progressbar→Text(caption)/Text(h4)/Slider(0..100) 记入 §M5 item 2 gap ledger、root 恒 id='root' 且数组首位、expandedToA2UI 对模板节点 fail loud、specToA2UI=raw 入口（validate→expand→convert）。
- L1：test/panel/appshell-a2ui.test.js（10 测试：22 名冻结目录、逐组件 prop 白名单、必需 props、id 唯一/解析、action 形状、计数算术、确定性、fail-loud、toGenuiMessages 形状）；appshell 测试族 98/98。
- e2e receipt：test/panel/a2ui-genui-e2e.mjs —— 3/3 夹具经 genui MessageProcessor，beginRendering+surfaceUpdate、root=root、引用全解析、零错误（genui 以 --no-save 装 test/panel，不进 lockfile）。
- L3 复跑（10×glm-4.6）：首过 8/10 ✓、重试腿累计 10/10 ✓、tokens P50 2570 ✓；**latency P50 30.8s vs ≤15s 杆 = miss**（非流式 ~85tok/s 物理量，M1 item 4 记 partial——流式 TTFT 或压缩 spec 是候选改进）。

**M1 核销**：item1 ✓（catalog 测试 12）· item2 ✓（validate 34+coverage 11，四类各≥4+伪模板≥2）· item3 ✓（8/10+10/10）· item4 **partial**（tokens ✓ / latency ✗）· item5 ✓（code-size 0 违例）。
**M2 核销（部分）**：item1 ✓（8 原语+8 模板渲染器）· item3/item4 部分（webclient 套件 10 测+镜像门绿；DOM=spec 浏览器口径与三连换 E2E 未落）· item5 ✓（asset-mirrors/staging-generated/staging-check/check/panel-tests 全绿）。
**M2-M4 全关欠**：~~L2 `appshell.spec` e2e 腿（CI）~~、L4 `appshell.morph` 浏览器腿（接线+跑绿）、~~红队第六类（越权 update）~~、M3 数字（≤50ms 本地/≤15s 闭环/增量 ≤40%）、M4 成本入册（morph/update 分列 P50/P95）、文本安全抽测表。

**清账腿 1（2026-10-18，PR #582，分支 feat/appshell-spec-e2e，T-0250 关）**：L2 + 第六类落地。
- 插件重写为**真 vendored defineTool 契约**（output{schema,render}、拒绝=throw）——原假 ctx 形状在真 ToolRuntime 上根本注册不上（"must declare output"）。
- render 铸 `surfaceId`（appshell-N 模块级注册表）；update 对未知 surfaceId **先于校验拒绝**（unknown-surface，warn 级日志）。
- 场景 `appshell.spec`：office 先例的场景侧挂载 + 一轮真 agent 轮（DSH_MOCK_TOOL_NAME/ARGS 脚本工具调用）→ 真 ToolRuntime dispatch → 四闸过 → echo 带 surfaceId；再驱动伪造/真 id update 对 + catalog。**14/14 一一对齐 PASS**，接进 build.sh test core。
- 镜像税：`runtime/dsh/system-plugins/dsh-appshell` 镜像新建（loader 单一来源——#574 只落了市集侧）、android assets 整目录 staged、ios-TREES.rows 加一行+re-emit；harmony 导入图派生=正确缺席。
- panel 族 +12 测（工具层双 MODE），110/110；gov 门 20/20（路径域）+28 全模式（卡关）。
- 顺带发现：morph e2e 的工具卡是载体侧合成（next-mode.mjs）——浏览器腿从未跑过真插件；boot 级产品挂载（哪席供应 appshell 工具）留作后续决定。
- AOCI 认知尾：deferred——主树在 #571 脏态上，PR 合并后清。
