# M0 组件词汇盘点：A2UI v0.9 × @lynx-js/genui × @ant-design/x-card

日期：2026-10-17。方法：三源全部在线核实（a2ui.org 渲染页 + GitHub raw 源文件 + GitHub API 目录 + npm registry JSON），每个清单给出来源 URL 与核实方式。本报告为 M0（两层组件表）的原语层输入。

## 0. TL;DR

- **A2UI v0.9 官方全集 = 18 个原语**（spec 双源核实）。
- **@lynx-js/genui 的 a2ui catalog = 22 个组件**（目录 + index.ts 双源核实），其中 **16 个与 A2UI v0.9 同名同词**，缺 Video/AudioPlayer，多 6 个扩展。
- **交集 16 ≥ 12 达标**——A2UI v0.9 作为跨端契约词表成立，Lynx 侧覆盖率 16/18（88.9%）。
- **@ant-design/x-card = React 栈**（peerDeps react/react-dom ≥18），Ant Design X 生态、基于 A2UI 协议的动态卡片渲染器，本计划不用它渲染（M2 禁 React），仅作生态参照。

## 1. 三源清单

### 1.1 A2UI v0.9 官方标准组件全集（18 个）

来源（两处独立核实，内容一致）：

- 官网渲染页 Basic Component Catalog → Components 表：
  https://a2ui.org/specification/v0.9-a2ui/
- 仓库 spec 源文件 `specification/v0_9/docs/a2ui_protocol.md`（表头 `| Component | Description |`，18 行）：
  https://raw.githubusercontent.com/a2ui-project/a2ui/main/specification/v0_9/docs/a2ui_protocol.md

spec 顺序全集：

| # | 组件 | 分类（官网 gallery 口径） |
|---|---|---|
| 1 | Text | Display |
| 2 | Image | Display |
| 3 | Icon | Display |
| 4 | Video | Display |
| 5 | AudioPlayer | Display |
| 6 | Row | Layout |
| 7 | Column | Layout |
| 8 | List | Layout |
| 9 | Card | Container |
| 10 | Tabs | Container |
| 11 | Divider | Display |
| 12 | Modal | Container |
| 13 | Button | Interactive |
| 14 | CheckBox | Interactive |
| 15 | TextField | Interactive |
| 16 | DateTimeInput | Interactive |
| 17 | ChoicePicker | Interactive |
| 18 | Slider | Interactive |

版本注意（钉 v0.9 的理由更足了）：

- 官网当前版本线：v0.9.1 = "Current"，v1.0 = "Candidate"，v0.8 = legacy（https://a2ui.org/ 导航）。
- 仓库 `main` 的机器可读目录已滚到 `catalogs/basic/v1/catalog.json`（https://api.github.com/repos/a2ui-project/a2ui/contents/catalogs/basic/v1）——**main 不再代表 v0.9**，v0.9 的权威出处是上面两处 v0.9 专属路径。
- Component Gallery（https://a2ui.org/reference/components/）只画了 16 个标准组件（**缺 Video、AudioPlayer**），且把 v0.8 的 `MultipleChoice` 与 v0.9 的 `ChoicePicker` 并列展示。**以 spec 表为准；契约词表里不要混入 v0.8 名 `MultipleChoice`。**

### 1.2 @lynx-js/genui 的 a2ui catalog（22 个组件）

来源（三处核实，互相一致）：

- 目录树 `packages/genui/a2ui/src/catalog`（24 个子目录 = 22 组件目录 + `utils` + 4 个文件）：
  https://api.github.com/repos/lynx-family/lynx-stack/contents/packages/genui/a2ui/src/catalog
- catalog 注册表 `src/catalog/index.ts`（22 条组件 export）：
  https://raw.githubusercontent.com/lynx-family/lynx-stack/main/packages/genui/a2ui/src/catalog/index.ts
- 包入口 `src/index.ts`（再确认：组件只从 `./catalog` 出，"There is intentionally no all-in-one aggregate"，**全文无 Video / AudioPlayer**）：
  https://raw.githubusercontent.com/lynx-family/lynx-stack/main/packages/genui/a2ui/src/index.ts

组件全集（index.ts export 顺序）：

Button, Card, CheckBox, ChoicePicker, Column, DateTimeInput, Divider, Icon, Image,
LazyComponent, LineChart, List, Loading, McpApp, Modal, PieChart, RadioGroup, Row,
Slider, Tabs, Text, TextField

包事实：

- npm 发行名 `@lynx-js/genui`，subpath `/a2ui`（README 原句："A2UI renders agent-generated UI messages that follow the A2UI v0.9 protocol"，https://raw.githubusercontent.com/lynx-family/lynx-stack/main/packages/genui/README.md）；仓库内 workspace 包名为 `@lynx-js/genui-a2ui` v0.0.0（https://raw.githubusercontent.com/lynx-family/lynx-stack/main/packages/genui/a2ui/package.json）。
- 依赖：deps `@a2ui/web_core`、`@lynx-js/react-signals`；peerDeps `@lynx-js/lynx-ui`、`@lynx-js/react` —— 是 ReactLynx 面的 React 实现，**不是 vanilla web 代码**。
- 本地底稿记载 npm 已发行 v0.7.0（`.zcode/plans/a2ui-generative-ui-plan.md`，本次未上 npm 复核该版本号）。

### 1.3 @ant-design/x-card 技术栈（一句话）

**React 栈**：npm registry 元数据（https://registry.npmjs.org/@ant-design/x-card/latest）显示 v2.9.0，description "React card loader for dynamic content loading and management"，`peerDependencies` 明写 `"react": ">=18.0.0"` + `"react-dom": ">=18.0.0"`（deps 仅 rc-util/classnames/@babel/runtime/@ant-design/icons）；ant-design/x 仓库将其定位为"基于 A2UI 协议的动态卡片渲染组件"（https://github.com/ant-design/x）。→ 与 M2 的"不引 React 进 web-client-v2"红线冲突，**只作生态参照，不作渲染实现**。

## 2. A2UI v0.9 ∩ genui catalog 交集表（16 个）

精确同名匹配：

| # | 组件 | A2UI v0.9 spec | genui catalog | 备注 |
|---|---|---|---|---|
| 1 | Text | ✓ | ✓ | |
| 2 | Image | ✓ | ✓ | |
| 3 | Icon | ✓ | ✓ | |
| 4 | Row | ✓ | ✓ | |
| 5 | Column | ✓ | ✓ | |
| 6 | List | ✓ | ✓ | |
| 7 | Card | ✓ | ✓ | |
| 8 | Tabs | ✓ | ✓ | |
| 9 | Divider | ✓ | ✓ | |
| 10 | Modal | ✓ | ✓ | |
| 11 | Button | ✓ | ✓ | |
| 12 | CheckBox | ✓ | ✓ | |
| 13 | TextField | ✓ | ✓ | |
| 14 | DateTimeInput | ✓ | ✓ | |
| 15 | ChoicePicker | ✓ | ✓ | v0.8 名 MultipleChoice 已废，两边都用新名 |
| 16 | Slider | ✓ | ✓ | |

**intersectionCount = 16**。

### 双侧缺口

- **A2UI 有、genui catalog 无（2 个）：`Video`、`AudioPlayer`**。spec 表在册（第 4、5 行），genui 的 catalog 目录、`src/catalog/index.ts`、`src/index.ts` 三处都没有——Lynx 官方渲染器的实装滞后于 spec，不是命名差异。
- **genui 有、A2UI v0.9 spec 无（6 个）：`LazyComponent`、`LineChart`、`Loading`、`McpApp`、`PieChart`、`RadioGroup`**。属于渲染端扩展/工程件，不在 v0.9 契约词表内。注意单选语义：genui 用独立 `RadioGroup`，A2UI 契约里没有——跨端 spec 要单选就走两边都有的 `ChoicePicker`。

## 3. 对 M2（web 渲染面）的建议

1. **渲染契约直接采用 A2UI v0.9 的 18 个原语名**，web 侧自写 vanilla DOM 渲染器全集覆盖 18 个：M2 无构建步骤、禁 React（appshell-morph-plan.md:144），genui 的 React 实现搬不进来，但 18 个原语在 web 上全是平凡映射（`<video>`/`<audio>` 原生标签反而最容易）——**web 侧不必跟着 Lynx 缺 Video/AudioPlayer**。
2. **16 个交集名是"换渲染面"对齐的锚**：同一份 spec 里凡只用交集词的部分，M2（web）与 M5（Lynx）行为天然一致；模板层（D-1 第二层）编译目标只允许落在 18 个原语上。
3. **genui-only 6 个扩展不进契约词表**，在两层组件表里记为"渲染端扩展"：谁想用图表，走模板层组合或后续按端扩展，不写进 spec 校验器必过词表。
4. **词表版本卫生**：校验器只认 v0.9 名（含 `ChoicePicker`），把 v0.8 的 `MultipleChoice` 列为显式拒绝项——gallery 页两代名词并列展示，prompt 里很容易混入。

## 4. 对 M5（@lynx-js/web-core 跨端第二渲染面）的建议

1. **交集 16/18 意味着"同一份 spec 不改一字在第二渲染面渲染"（M5 验收）只有两个洞**：Video/AudioPlayer。建议在两层组件表里给这两个标 `lynx:unsupported`，并写死降级行为（降级为 Image 占位 + Text 说明，或 M5 演示 spec 避用）——降级规则进 spec 校验器而不是渲染器里隐式兜底。
2. **Pin 对象是 `@lynx-js/genui`（subpath `/a2ui`），不是内部名 `@lynx-js/genui-a2ui`**（后者是 workspace 内 v0.0.0）。vendor-package 流程注意依赖链：deps `@a2ui/web_core` + `@lynx-js/react-signals`，peer `@lynx-js/react` + `@lynx-js/lynx-ui`——这四个都要进 web-core 载体清单；README 明写仅支持 A2UI v0.9，与"锁 v0.9"决策一致（a2ui-generative-ui-plan.md:69）。
3. **main 已滚 v1**：上游 `catalogs/basic` 只剩 `v1/catalog.json`，等 Lynx 官方跟进 v1.0 前不要追 main 的 catalog 结构；升级触发条件照旧"等 Lynx 官方渲染器跟进"。

## 5. 来源汇总

- https://a2ui.org/ （版本线：v0.9.1 Current / v1.0 Candidate / v0.8 legacy）
- https://a2ui.org/specification/v0.9-a2ui/ （v0.9 Basic Component Catalog，18 组件）
- https://raw.githubusercontent.com/a2ui-project/a2ui/main/specification/v0_9/docs/a2ui_protocol.md （v0.9 spec 源文件，同表）
- https://a2ui.org/reference/components/ （Component Gallery，16 标准件 + v0.8/v0.9 名词并列）
- https://github.com/a2ui-project/a2ui （仓库主体，Apache-2.0，"Early stage public preview"）
- https://api.github.com/repos/a2ui-project/a2ui/contents/catalogs/basic/v1 （main 已滚 v1 目录）
- https://api.github.com/repos/lynx-family/lynx-stack/contents/packages/genui/a2ui/src/catalog （genui catalog 目录树）
- https://raw.githubusercontent.com/lynx-family/lynx-stack/main/packages/genui/a2ui/src/catalog/index.ts （22 组件 export）
- https://raw.githubusercontent.com/lynx-family/lynx-stack/main/packages/genui/a2ui/src/index.ts （包入口，无 Video/AudioPlayer）
- https://raw.githubusercontent.com/lynx-family/lynx-stack/main/packages/genui/a2ui/package.json （@lynx-js/genui-a2ui v0.0.0 及依赖）
- https://raw.githubusercontent.com/lynx-family/lynx-stack/main/packages/genui/README.md （"follow the A2UI v0.9 protocol"）
- https://registry.npmjs.org/@ant-design/x-card/latest （React peerDeps ≥18）
- https://github.com/ant-design/x （x-card = 基于 A2UI 协议的动态卡片渲染）
- 本地底稿：`.zcode/plans/a2ui-generative-ui-plan.md`（P0–P4、锁 v0.9、@lynx-js/genui v0.7.0 记载）；`/Users/lixiang/workspace/dsh-mobile/.zcode/plans/appshell-morph-plan.md`（M2/M5 定义、D-1 两层制、禁 React 红线）

### 本次未做/未核实（如实记录）

- `@lynx-js/genui` 在 npm 上的最新版本号（本地底稿记 v0.7.0，本次未上 npmjs 复核——vendor 时以 pin 实查为准）。
- A2UI v1.0-RC 的 catalog 全集（`catalogs/basic/v1/catalog.json` 内容未展开，任务口径锁 v0.9）。
- genui catalog 各组件的 props 级行为与 A2UI spec 的逐字段一致性（本次只盘名词层；props 层留给 M0 后续或 M1 校验器编写时核对）。
