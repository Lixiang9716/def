# 提案:原生声明式面——不可约原语之上的版本化载荷 schema 族(`face.*@1` 折叠候选)

> **状态:DRAFT(D5 提案——此处不冻结任何东西;采纳时以增量方式折叠为
> data-protocols.md 的一节)。不动任何原语行、任何已冻形状、任何结果形状。**

[English](2026-11-12-native-face-schemas.md) | 简体中文

## 动机

R3 普查(2026-11-12;四路扫描——iOS、Android、harmony 宿主与生产方)发现原生
render-intent 面处于三种漂移状态,而每一种都是已冻契约之上/旁边的无版本载荷漂移:

1. **只靠代码对称维持的总线面。** `card.*` 总线行与 `question.*` 帧由五个独立实现
   渲染(三个原生宿主 + runtime 桥 + web 客户端卡面——`presentation/web-client-v2/web/js/card-face.js:1-8`
   自述"the same contract verbatim"),无 schema、无版本,全部文档只有
   `PLUGIN_CREATE_DESCRIPTION` 里的一段散文(`runtime/dsh/system-plugins/dsh-create/index.js:110-115`)。
   活缺陷就骑在漂移上:iOS 取消按钮无处理器、永远不投递 `question.answer`
   (`hosts/ios/App/Source/SessionQuestions.swift:55`),Android 孪生同样只关闭不回答
   (`hosts/android/app/src/main/java/com/dshmobile/host/QuestionDialog.kt:114`)
   ——被挂起的 ask 于是按设计永远等待(`runtime/dsh/web-live/question-bridge.js:10-12`,
   "Without a page answer the ask stays parked");缺 id 的 `card.present` 被每个宿主
   静默丢弃、零日志(`hosts/ios/App/Source/CardPlayerSurface.swift:76-77`、
   `hosts/android/.../CardSurface.kt:95-96`、`hosts/harmony/.../CardFace.ets:50-53`)。

2. **已冻原语之上的载荷面——每样只有一句散文。** `presentApproval`/`presentPicker`/`notify`
   的结果是冻的(contract/primitives.md §4),但请求载荷是无文档散文,且漂移双向可测:
   - `runtime/dsh/plugin-mount.js:144-147` 传 `{title, message}`,而 iOS 读
     `{title, detail, allowRemember}`(`hosts/ios/App/Source/Gateway/UIPrimitives.swift:39-41`),
     Android 读同样三个(`hosts/android/.../UiPrimitives.kt:56-58`),harmony 只读
     `{title}`(`hosts/harmony/.../OfficialServe.ets:1246-1258`)——挂载闸的 detail
     行今天在任何宿主上都不渲染:`message` 键无人读。
   - 已冻 picker 散文说 `mode: "file" | "directory"`(primitives.md §4),而三个宿主
     全都服务 `"media"`(`UIPrimitives.swift:124-129`、`UiPrimitives.kt:44,137-145`、
     `PickerPrimitives.ets:47-50,154-157`)。
   - `notify` 的 title 在 iOS/Android 是必填-`invalid`(`NotifyPrimitive.swift:28-31`、
     `NotifyPrimitive.kt:46-47`),harmony 却静默默认 `'DSH'`(`HostPhase.ets:888`)。
   - 审批梯子以每宿主三份手写拷贝存在:presentApproval 本体、剪贴板读同意
     (`ClipboardPrimitives.swift:33-65`、`ClipboardPrimitives.kt:48-69`)、BLE 同意层
     (iOS `BLEPrimitives.swift:96-117` 全硬编码;Android `BleConsent.kt:60-94` 硬编码
     且**空置**——`capabilityPrompter` 只在 iOS 树里赋值),共享零份已声明载荷。

3. **已收敛的 render-intent 零原生消费者。** #764 落了生产侧——五个插件族对着
   vendored `@deepseek-ai/dsh-tools@0.1.6-alpha.2` 词表声明
   `presentationMeta` + `presentCall`/`presentResult`
   (`runtime/dsh/vendor/dsh/tools@0.1.6-alpha.2/lib/types/presentation.d.ts`),
   由 `test/panel/tool-card-face.test.js` 钉住——但没有任何已交付消费者运行这些
   presenter,appshell/A2UI 面在任何宿主上都没有原生渲染器(iOS:`hosts/ios/App/Source`
   里三个名字零命中;harmony:`app-shell/0.9` 零 ArkTS 消费)。

本提案:**给原生面 `surface.ops@1` 与 `a2ui.messages@0.9` 已经拥有的东西**——
data-protocols.md 里一个版本化、增量、逐字段声明的 schema 族,一个事件序列式的
动作回传契约(D8),以及一条绝不崩溃、绝不静默丢弃的降级阶梯——同时让其脚下的
网关原语保持不可约、逐字节冻结。

## 设计

### 1. 面词汇(普查收敛)

任务清单上的候选(card / question / approval-present / picker-present /
surface / settings-row)对照普查实情收敛为五个冻结候选、三个引用不重定义的格式、
两个诚实缓议:

| 面 / 格式 | 通道 | 今天的使用方(普查) | 处置 |
| --- | --- | --- | --- |
| `face.card@1` | 总线行 `card.present/state/complete/dismiss` | iOS `CardPlayerSurface.swift`、Android `CardSurface.kt`、harmony `CardFace.ets`、web `card-face.js` | **进 v1** |
| `face.question@1` | 总线帧 `question.request/answer/decided` | iOS `SessionQuestions.swift`、Android `QuestionDialog.kt`、web 页面卡面(harmony 经 WebView 回答——无原生面) | **进 v1** |
| `face.approval@1` | `presentApproval` 之上的请求载荷 + 同意孪生(clipboardRead、BLE 提示层) | 三份手写梯子(证据见上) | **进 v1**(仅请求侧;结果已冻) |
| `face.picker@1` | `presentPicker` 之上的请求载荷 | 三宿主(逐宿主校验 `mode`) | **进 v1**(仅请求侧) |
| `face.notify@1` | `notify` 之上的请求载荷 | 三宿主 | **进 v1**(仅请求侧) |
| `surface.ops@1` | `presentSurface`/`surfaceDraw` | harmony canvas 三件套 | **引用**——已冻(data-protocols.md §9);本提案不加一字 |
| `a2ui.messages@0.9` + `app-shell/0.9` | 经 SessionServe 的 session content | web 客户端 / Lynx 渲染器 | **引用**——已冻(data-protocols.md §10);原生渲染器是下方缓议项 |
| vendored 工具卡词表(`presentation.d.ts`,`presentCall`/`presentResult`/`presentationMeta`) | journal 工具记录 | 生产方已收敛(#764);无消费者 | **引用**——原生消费是 render-intent 分发义务(§7),不是新 schema |
| settings-row | 无 | **任何宿主都不存在原生设置面**:iOS 是文件中继 + CSS 注入(`SessionServe.swift:298-317`、`CarrierBootConfig.swift:93-125`),Android 是一条 CSS 行(`CarrierIndexRows.kt:37-49`)加"在设置面存在之前,撤销 = 删除应用"(`BleConsent.kt:15`),harmony 是无头文件握手(`LlmConfigStaging.ets:5-34`) | **缓议,点名**——天然的未来面(读常备授权库的撤销面);现在发明它等于冻结一个现实不服务的面 |
| 启动遮罩 / harness 控制台 | 宿主铬件 | iOS 启动串、仅调试构建的控制台 | **排除**——非产品面(iOS 控制台 release 永不构建;harmony verdict 面是 harness 铬件) |

### 2. 字段 schema(每个字段携带普查证据)

命名规则:每个族是 `face.<name>@<major>`;载荷携带整型 `schemaVersion`,指名生产方
所说的族版本。标 **v1 增** 的字段是仅有的新字段;其余全是今天的形状,从此有了声明。

#### face.card@1 —— PiP 卡总线面

| 帧 | 字段 | 类型 / 默认 | 证据 |
| --- | --- | --- | --- |
| `card.present` | `card.id` | string,**必填**——缺 id 拒绝渲染(不显示)并告警,绝不静默丢弃 | 生产方契约称 REQUIRED + "a missing id is silently dropped by every host"(`dsh-create/index.js:110-111`);iOS `CardPlayerSurface.swift:76-77`、Android `CardSurface.kt:95-96`、harmony `CardFace.ets:50-53` |
| | `card.title?` | string,默认 id | iOS `:81`、Android `:102`、harmony `CardFace.ets:120` |
| | `card.subtitle?` | string;iOS/Android 渲染,harmony 忽略 | 生产方文档(`dsh-create/index.js:111-112`);iOS `:82`、Android `:103` |
| | `card.kind?` | **闭集** `{info, timer}`(默认 `info`);未知 kind 降级为 `info` **并**告警——今天开放串静默落入非 timer 样式 | iOS `:83`、Android `:104`、harmony `:121,123`;生产方:'only "timer" gets the countdown face; default "info"'(`dsh-create/index.js:111`) |
| | `card.durationMs?` | number——本地倒计时锚点 | iOS `:79`、Android `:98`、harmony `:55` |
| | `card.label?` | string——非 timer 文本行 | iOS `:93-95`(state)、harmony `CardFace.ets:126-129` |
| | `card.actions?` | **v1 增**:`[{id, label}]`——声明式动作按钮;无按钮能力的宿主忽略该数组并告警(卡照常渲染) | 三宿主普查缺口:卡除本地关闭外零交互元素(Android `CardSurface.kt:204-210` 仅 ✕;harmony 普查"zero interactive elements beyond local ✕") |
| `card.state` | `state.remainingMs?` | number——重锚本地时钟 | iOS `:89-92`、Android `:113-117`、harmony `:62-66` |
| | `state.label?` | string——换文本行 | iOS `:93-95`、Android `:118-119`、harmony `:67-70` |
| | *(补间契约)* | 宿主本地 250ms 走秒;1Hz 补丁足矣——生产方钉死 | `dsh-create/index.js:113`("hosts tween locally at 250ms, so 1Hz patches suffice — never spam");iOS 定时器 `CardPlayerSurface.swift:141-143` |
| `card.complete` | `message?` | string,默认 `"完成"`;iOS/Android 约 2.5 秒后自动关闭,harmony 保留 | iOS `:102,105-107`、Android `:127,130`、harmony `:75`;生产方 `dsh-create/index.js:114` |
| `card.dismiss` | `{}` | 每个宿主都接受;树内无 JS 生产方发出 | iOS `:70`、Android `:72`、harmony(普查);生产方普查:"card.dismiss accepted by hosts, no JS producer in-tree" |
| `card.action` | **v1 增**(宿主→runtime):`{id, action: "close" \| "drag-end" \| "button", actionId?, at}` | 动作回传事件(§4) | 走 `question.answer` 已在用的投递路径(iOS `SessionServe.swift:461-462` `deliverRuntime`;Android `QuestionDialog.kt:156` `deliverRuntime`) |

#### face.question@1 —— 带内问询面

| 帧 | 字段 | 类型 / 默认 | 证据 |
| --- | --- | --- | --- |
| `question.request` | `id` | string,必填(askId) | `question-bridge.js:29-32` 铸 `question-<seq>-<ts>`;iOS `SessionQuestions.swift:19`、Android `QuestionDialog.kt:153` |
| | `questions[].id?` | string,默认 `q<n>` | iOS `:27`、Android `QuestionDialog.kt`(普查) |
| | `questions[].header?` | string——对话框标题,默认 `"def"` | iOS `:29`、Android `:136` |
| | `questions[].question?` | string——消息体 | iOS `:30`、Android `:137` |
| | `questions[].options[]` | **v1 增归一化**:`{id, label}` 对象为规范形;裸字符串仍接受,等价 `{id: <串>, label: <串>}`;答案以 **id** 标识选项,绝不以回显显示标签 | 今天选项是裸字符串或任意对象,Android 取最长字符串作标签(`QuestionDialog.kt:50-69`,"the key VARIES by model whim");iOS 只读 `option.label`(`SessionQuestions.swift:48`)且回答 `[label]`(`:50`)——重标签的选项会打断回程 |
| `question.answer` | `outcome` | **v1 增**:`"answered" \| "cancelled"`——缺省 = `answered`(旧帧不变);cancelled 结算被挂起的回合 | 缺陷:iOS 取消无处理器(`SessionQuestions.swift:55`),Android 取消不回答即关闭(`QuestionDialog.kt:114`),ask 永挂(`question-bridge.js:10-12`) |
| | `answers[].id` | string——问题 id | iOS `:39,50`、Android `:156` |
| | `answers[].selected` | `string[]`——v1 下为选项 **id**(旧帧为标签) | iOS `:39,50`;桥原样结算 `{answers}`(`question-bridge.js:21-27`) |
| | `answers[].custom?` | string——自由文本答案 | iOS `:40-42` |
| `question.decided` | `{id}` | 不变——跟在结算之后 | `question-bridge.js:35` |

#### face.approval@1 —— 同意梯请求面

仅请求侧;已冻结果 `{approved, remember?}` 逐字节不动(primitives.md §4)。载荷
就是宿主已在读的三个字段,从此全族声明——外加 `schemaVersion`:

| 字段 | 类型 | 证据 |
| --- | --- | --- |
| `title` | string(宿主默认 `""`/`"Approval"`) | iOS `UIPrimitives.swift:39`、Android `UiPrimitives.kt:56`、harmony `OfficialServe.ets:1247-1252` |
| `detail?` | string——规范 detail 字段;**不祝福任何 `message` 别名**(大声失败,规则 5) | iOS `:40`、Android `:57`;活漂移:`plugin-mount.js:146` 传 `message`,无宿主读它 |
| `allowRemember?` | boolean——真时呈现 Remember 选项 | iOS `:41`、Android `:58`;harmony 今天忽略它(只解析 `{title}`,`OfficialServe.ets:1249-1252`)——族声明使 harmony 解析器加宽成为迁移项 |
| *(同意孪生)* | clipboardRead 同意今天就在宿主默认文案之上读同样的 `{title?, detail?}`;BLE 提示层采用同一形状,装上空置的 Android prompter 从此是一次载荷读取,不是第四份手写对话框 | iOS `ClipboardPrimitives.swift:48-52`、Android `ClipboardPrimitives.kt:50-55`;BLE 硬编码:iOS `BLEPrimitives.swift:99-103`、Android `BleConsent.kt:78-81`;空置缝:全库 grep,`capabilityPrompter` 仅在 `BLEPrimitives.swift:50` 赋值(普查) |

v1 明确不做(尚无消费者提出;克制规则同样适用于载荷面):结构化风险对象、拒绝
原因/评论通道、i18n 按钮文案、宿主侧过期。各自是普查已记录的增量 v2 候选。

#### face.picker@1 —— OS 选择器请求面

| 字段 | 类型 | 证据 |
| --- | --- | --- |
| `mode` | `{file, directory, media}`(iOS/Android 默认 `file`) | iOS `UIPrimitives.swift:124-129`、Android `UiPrimitives.kt:44,137-145`、harmony `PickerPrimitives.ets:47-50,154-157`——注意已冻 §4 散文仍写 `"file" \| "directory"`;折叠记录被服务集(文档归真,不改形状——瘦身轮的反漂移规则) |
| `suggestedName?` | string——harmony 今天在服务,全族声明(他处增量:未知字段忽略) | `PickerPrimitives.ets:47-50` |
| *(结果)* | `{scope, path} \| null` 逐字节冻结;用户取消仍是 null 值 | iOS `UIPrimitives.swift:174-178,200`(普查)、Android `UiPrimitives.kt:203-204,233-234`(普查) |

v1 明确不做:内容过滤器与多选——两者都改已冻结果形状(主版本素材;iOS media 钉死
images、selectionLimit 1,普查)。

#### face.notify@1 —— 本地通知请求面

| 字段 | 类型 | 证据 |
| --- | --- | --- |
| `title` | string,**必填**——harmony 的静默 `'DSH'` 默认对齐为 iOS/Android 已有的 `invalid` 拒绝 | iOS `NotifyPrimitive.swift:28-31`、Android `NotifyPrimitive.kt:46-47`、harmony `HostPhase.ets:888` |
| `body?` | string | iOS `:50`、Android(普查 `:77`)、harmony `HostPhase.ets:1146` |
| `threadId?` | string——今天 iOS 服务,全族声明(增量) | iOS `NotifyPrimitive.swift:51` |
| `data?` | `map<string, any>`——今天 iOS 服务(userInfo),全族声明(增量) | iOS `:52` |
| *(结果)* | `{id}` 逐字节冻结 | iOS `:65`、Android `NotifyPrimitive.kt:63,88`(普查)、harmony `HostPhase.ets:1151` |

v1 明确不做:通知动作目录(无宿主注册任何目录——iOS 普查:事件的 action 字段
只可能是默认点按)。

### 3. 版本化——从第一天起增量

- `schemaVersion` 是每个面载荷上的可选整型:总线帧在顶层
  (`{type:"card.present", schemaVersion:1, card:{…}}`),原语载荷在请求对象内
  (`presentApproval({schemaVersion:1, title, detail})`)。**缺省 = 旧版 = 今天的
  精确行为**——容忍度已有生产方文档("unknown fields are ignored everywhere,
  nothing throws",`dsh-create/index.js:115`),故无该字段的载荷在每个宿主上永远
  渲染如初。
- 增量铸下一个整型(`face.card@2`)并附迁移说明——data-protocols.md §6 纪律。
  因为每个增量都是可选的且核心形状永不动,宿主可以忽略未知字段 + 一次告警来渲染
  更新的载荷;族内禁止移除、改型、加必填——那要铸新族名并走主版本折叠加迁移说明
  (§6 的大声边界)。
- **面软失败,安装文档大声失败。** data-protocols.md §6 让 manifest/receipt/catalog
  对未知主版本大声拒绝;渲染载荷是相反一极,保持软失败——正是 #764 收敛钉下的纪律
  ("presenters degrade to undefined, never throw")。面是用户可见的铬件,绝不是
  授权素材;§5 阶梯定义诚实的降级。
- 采纳时折叠为 **data-protocols.md §11 "Native face payloads (v1.4.0 —
  `face.*@1`)"**。v1.4.0 是该文档的下一个空闲增量号(现处 v1.3.0;没有 DRAFT
  认领 v1.4.0——proposals/ 里的 v1.4.0 字样指的是旧的原语 timer 折叠)。若另有
  候选先折叠,单调折叠顺序裁决(2026-11-11 瘦身轮记录的冲突规则)。

### 4. 动作回传契约(D8——事件序列,绝不轮询)

用户动作以事件经既有通道回到 runtime。不加网关原语、不加事件通道、不共享宿主状态:

1. **`card.action`** 走 `question.answer` 已在用的宿主→runtime 总线投递(iOS
   `SessionServe.swift:461-462`;Android `QuestionDialog.kt:156`)。顺序保证:每
   卡 id 至多一个终结动作(`close` 胜过未决 `button`),按发生排序。
   **关闭权威仍在插件**——今天"neither action crosses the contract (dismissal
   authority stays the plugin's — a locally closed card just ignores later
   card.state/complete records)"(`CardPlayerSurface.swift:218-223`);v1 让本地
   关闭*可观察*,永不夺权:生产方听得见关闭、可以反应(发 `card.dismiss`、重新
   present、停自己的循环);它不获得对表面的控制权。
2. **带 `outcome` 的 `question.answer`** 结算被挂起的 ask——vendored 服务的瀑布
   由任一监听者先答即解(`question-bridge.js:4-6`),桥把 `cancelled` 结局映射为
   服务结算(实现随批次 1 落地)。`question.decided` 保持结算后位置
   (`question-bridge.js:34-35`)。
3. **`notify.response`** 保持已冻 §5 事件通道;已交付顺序——`notify.response`
   然后 `app.state` "foreground"——钉为族行为(iOS `NotifyPrimitive.swift:84-94`)。
4. **审批/选择器/通知结果走已冻原语结算**——无新事件(A2UI 折叠的零新通道纪律,
   继续成立)。

### 5. 降级阶梯(绝不崩溃,绝不静默)

每个面渲染器实现的有序规则:

1. **未知面类型或未知 `kind` → 渲染 generic 形**(标题 + 文本),经宿主统一日志
   通道( `GatewayCore.uiMarker` / `hilog` / `android.Log` 族)告警一次;绝不抛出,
   绝不静默丢弃。这就是任务所说的"未知面类型=诚实降级 generic"。
2. **`schemaVersion` 高于宿主已知上限 → 旧版渲染 + 告警**(忽略未知字段——已文档
   的容忍)。
3. **未知字段 → 忽略**(今天的行为,从此声明)。
4. **必填字段缺失 → 不渲染 + 一条点名帧与字段的告警**——取代今天的静默丢弃
   (`CardPlayerSurface.swift:76-77` 无日志返回)。诚实修复在日志,不在渲染:
   生产方契约文档化了丢弃,丢弃保留——变的是静默。
5. **原语载荷畸形保持已冻的 `invalid` 拒绝**(`UiPrimitives.kt:138-145` mode;
   `NotifyPrimitive.kt:46-47` title;`OfficialServe.ets:1253-1256` bad args)。

### 6. 边界:原语保持不可约

`presentApproval`、`presentPicker`、`notify` 是 Tier A 同意面——"a user-facing
OS surface is itself the trust boundary"(2026-11-11 瘦身轮的分类)。本提案改动
**零行**:无新原语(§8 克制)、无形状编辑(D5)、无结果变化——
`{approved, remember?}`、`{scope, path} | null`、`{id}` 逐字节不动。R3 只统一
骑在其上的载荷 schema 与旁边的总线面。承载安全的校验(权限 flag、审计记录、§6
审计迹)分毫不动——瘦身轮的边界规则("security-bearing validation STAYS at the
gateway")延伸到载荷层:`face.*@1` 里没有任何东西携带权威。

### 7. 宿主义务与三批迁移

**义务(每个宿主,在其批次):** 一个面渲染器,(a) 读 `schemaVersion`,
(b) 渲染 `face.*@1`,(c) 按 §5 带日志降级,(d) 按 §4 发动作事件。无
`hostType` 分支(RFC 0002):宿主渲染哪些面是代码路径表达的协商能力,绝不是共享
逻辑里的平台条件。

| 批次 | 宿主 | 面 | 为何此序 | 验收 = 场景腿(D7:结构化日志、唯一 scenario-id、期望↔日志一一对应) |
| --- | --- | --- | --- | --- |
| 1(先导) | iOS | card + question + approval | 唯一一个所有面今天都原生渲染的宿主(卡面播放器、问询对话框、审批梯 ×3 含唯一已装的 BLE prompter、选择器、通知),普查的两个最强候选 + 整合项都在这里 | 扩展 card-player 腿(`runtime/dsh/scenario/card-player.js:39-63` + `schemaVersion` + `card.action` 回程);一条取消即投递 `outcome:"cancelled"` 的问询腿(永挂缺陷死去);挂载审批腿显示 detail 行(`message` 漂移修复,`plugin-mount.js:146`) |
| 2 | Android | approval 族 + question + card | 梯子以三份手写对话框存在;问询渲染器真实有损(最长字符串标签、≤3 按钮上限——`QuestionDialog.kt:58-69,138-139`);装上空置 prompter 成为一次载荷读取 | Android 席上重跑同样三条腿(`runtime/dsh/scenario/gateway-binding.js:188-218` 先例) |
| 3 | harmony | card + approval 载荷(+ picker/notify 对齐) | 审批解析器从 `{title}` 加宽到族形状(`OfficialServe.ets:1246-1258`);harmony 问询面不存在(WebView 回答)——原生问询是其自己的后续(ApprovalDialog 加宽),在此诚实缓议 | 重跑 `harmony-capability-binding.js` 腿;卡腿行使 ArkTS 面(`CardFace.ets:47-82`) |

**缓议且点名:** 原生 appshell/A2UI 渲染器(Swift/Kotlin/ArkTS 消费者零存在;
普查的"biggest gap, biggest cost, honest deferral candidate");settings-row(§1);
picker 过滤器/多选;notify 动作;结构化审批风险。**render-intent 分发层**——把
#764 presenter 的 `presentationMeta`/`presentCall`/`presentResult` 接到这些面上
——是同程序的姊妹工作项(任务 T-0290),消费被引用的词表;它不属于本提案的折叠。

## 非目标

- **修改任何已冻形状**(D5):原语表行、原语结果、`surface.ops@1`、
  `a2ui.messages@0.9`——全部逐字节相同。
- **新原语或新事件通道**——克制规则与 A2UI 折叠的零通道纪律都继续成立。
- **强迁旧生产方**——v0 帧(无 `schemaVersion`)永远渲染如初;增量契约对总线面
  没有废弃时钟。
- **原生 appshell/A2UI 渲染器**——带普查证据缓议。
- **触碰 vendored 包**(D6):工具卡词表按 pin 消费,绝不编辑。

## 考虑过的替代方案

- **把原生面折叠进 `a2ui.messages@0.9`**——否决:A2UI 是面向 WebView/Lynx 渲染器
  的 session-content 层;原生面是更粗粒度、绑定 OS 表面的载荷(PiP 卡、警示梯、
  通知),必须在无 WebView 存活、铬件归 OS 时也能渲染。两个各得其所的声明层加一座
  诚实的桥,胜过把一个格式硬拉过两层。
- **一个总揽 `face.present` 信封分发所有面**——否决:通道真实不同(总线行 vs 原语
  载荷);总揽信封会重路由已冻通道,重造原语已拥有的分发。
- **等上游 DSH 标准化**——否决:上游 `presentation.d.ts` 只覆盖工具卡;总线面与
  载荷面是我们的,而普查缺陷(永挂的 ask、无人读的 `message`)现在就活着。
- **逐宿主 schema(被点名的现状)**——否决:普查的漂移清单就是现状的代价——五个
  渲染器靠对称维持一个形状、三份梯子靠复制、一个无宿主读的 detail 键。

## 证据

- 四份 R3 普查(iOS、Android、harmony、生产方;2026-11-12)是语料;上文每张字段表
  引用其普查 `path:line`,承重引文已在本席位于 git `8ebde204` 复核:生产方卡契约
  (`dsh-create/index.js:110-115`)、问询桥(`question-bridge.js:1-38`)、iOS 面
  (`CardPlayerSurface.swift:64-121,218-232`、`SessionQuestions.swift:1-59`、
  `UIPrimitives.swift:28-130`、`ClipboardPrimitives.swift:10-65`、
  `BLEPrimitives.swift:45-114`、`NotifyPrimitive.swift:20-94`、
  `SessionServe.swift:398-462`)、Android 面(`QuestionDialog.kt:50-160`、
  `UiPrimitives.kt:39-150`、`ClipboardPrimitives.kt:40-82`、`BleConsent.kt:55-95`、
  `NotifyPrimitive.kt:40-69`、`CardSurface.kt:60-135`、`CarrierIndexRows.kt:20-50`)、
  harmony 面(`CardFace.ets:40-134`、`Index.ets:1348-1372`、
  `OfficialServe.ets:1244-1259`、`DevicePlanePrimitives.ets:55-68`、
  `PickerPrimitives.ets:42-71`、`HostPhase.ets:180-190,888,1110-1155`、
  `EntryAbility.ets:34-52`)、web 孪生(`presentation/web-client-v2/web/js/card-face.js:1-12`、
  `main.js:58-70`)与场景先例(`runtime/dsh/scenario/card-player.js:36-66`)。
- 本提案镜像的已冻邻居:data-protocols.md §6(版本化,:109-116)、§9
  `surface.ops@1`、§10 `a2ui.messages@0.9`(:234-279);primitives.md §4
  (notify/presentApproval/presentPicker 的一句载荷散文)与 §8(克制)。
- 生产侧收敛及其消费者缺口:vendored 词表
  (`runtime/dsh/vendor/dsh/tools@0.1.6-alpha.2/lib/types/presentation.d.ts`)、
  钉住测试(`test/panel/tool-card-face.test.js`,生产方普查运行 18/18 绿)与原生
  消费者缺席(普查 grep:`presentationMeta|presentCall|presentResult` 在
  `hosts/ios/App/Source` 零命中;Android `@Composable`/appshell 原生零命中;
  `app-shell/0.9` 零 ArkTS 消费)。
- 审批漂移三联:`plugin-mount.js:139-149`(`{title, message}` 调用)、三个宿主
  解析器(§2 已引)与空置的 Android prompter 缝(全库 `capabilityPrompter` grep
  ——唯一命中 iOS `BLEPrimitives.swift:50`)。
- 本族修复的活缺陷:永挂取消(`SessionQuestions.swift:55`、`QuestionDialog.kt:114`、
  `question-bridge.js:10-12`)、静默丢弃 id(`CardPlayerSurface.swift:76-77`)、
  无人读的 `message` 键(`plugin-mount.js:146` 对 `UIPrimitives.swift:39-41`)、
  `'DSH'` 默认(`HostPhase.ets:888`)。

## 体量

折叠 M(data-protocols.md §11 + 契约 README 指针 + 生产侧两条一行修改:plugin-mount
的 detail 修复与 question-bridge 的结局映射);每宿主批次 M(渲染器 + 腿),全程 L。
render-intent 分发层与先导接线是 T-0290 的姊妹项,另行计体量。
