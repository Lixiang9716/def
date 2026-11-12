# 数据协议 — Bundle 布局、Manifest、Receipt、签名目录(v1.4.0)

> **状态:契约冻结阶段冻结**(2026-09-19,决策 D5);**以可加性方式扩展到 v1.4.0**
> (2026-11-13:§11 原生面载荷 `face.*@1`——提案
> [2026-11-12-native-face-schemas.zh.md](proposals/2026-11-12-native-face-schemas.zh.md),ADOPTED;
> 2026-10-19:§10 `a2ui.messages@0.9`——提案
> [2026-10-17-a2ui-generative-ui.zh.md](proposals/2026-10-17-a2ui-generative-ui.zh.md),ADOPTED;
> v1.2.0:§8–§9;v1.1.0:§7 签名目录——提案
> [2026-10-01-plugin-marketplace.zh.md](proposals/2026-10-01-plugin-marketplace.zh.md),ADOPTED)。
> 这是每个宿主、每个插件构建都必须遵守的四份数据协议。
> 机器可读 schema 见 [schemas/](schemas/)。配套文档:[primitives.md](primitives.zh.md)。
> [English](data-protocols.md) | 简体中文

## 1. Bundle 布局

已安装的插件是 profile 下一个自包含目录:

```
profiles/<name>/
├── profile.json
├── cordis.patch.yml
├── plugins/<pkg>@<semver>/
│   ├── manifest.json          # 静态 manifest(§2)—— schema:schemas/manifest.schema.json
│   ├── integrity.json         # 逐文件摘要账本(§3)—— schema:schemas/integrity.schema.json
│   ├── bundle/                # JS ESM 源码(代码即数据),入口由 manifest 指定
│   └── web/                   # Web Client 静态资源;仅 type "web-client" 存在
├── receipts/                  # 安装/移除事务日志(§4)
├── sessions/*.jsonl
└── state/
```

- `<pkg>` 是 manifest 的 `id`,`<semver>` 是 manifest 的 `version`——每个版本一个目录,
  降级与并存因此都是纯数据操作。
- `bundle/` 源码由宿主的 ESM loader 读取;宿主可将其预编译为字节码放进 `cache/blobs/`;
  该缓存可再生,不承载任何权威性。
- `receipts/` 日志(事务记录,§4)是对 ARCHITECTURE.md §7 存储图景的扩展;sessions 与
  state 仍按该节的规定。

## 2. 插件 Manifest

`manifest.json` 是**静态的**:读取它绝不能执行代码。Schema:
[schemas/manifest.schema.json](schemas/manifest.schema.json)。

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `schemaVersion` | integer | manifest schema 版本,本冻结中为 `1`(§6) |
| `id` | string | 包身份,如 `dsh-fs-ios`;跨版本稳定 |
| `version` | string | 本包的 semver 2.0.0 |
| `type` | `"service"` \| `"web-client"` | service = JS 实现插件;web-client = 完整 Web Client 插件 |
| `entry` | string | 相对 `bundle/` 的 ESM 入口(`service` 必填) |
| `web` | string | 相对包根的静态资源目录(`web-client` 必填) |
| `capabilities` | object | `required[]` / `optional[]` 能力字符串(§5) |
| `hooks` | object | 可选的 `activate` / `deactivate` ESM 导出名——确定性生命周期 |

语义:

- **协商**:仅当宿主 `RuntimeDescriptor` 满足全部 `capabilities.required` 时才激活插件;
  `optional` 项在存在时调整行为。宿主自身的能力面包含 `gateway@1`(原语契约)及其声明的
  原语。请求宿主已声明 unavailable 之原语的 manifest 协商失败——可见地失败,绝不静默。
- **生命周期**:`activate` 在协商通过后运行;`deactivate` 在卸载前运行。钩子是入口模块的
  普通命名导出,各调用一次,按序,无重入。
- **隔离**:每插件一个 QuickJS 运行时,零共享;一切平台访问都经网关原语
  ([primitives.md](primitives.zh.md))。

## 3. 完整性账本

`integrity.json` 覆盖已安装树的每一个文件,使任何宿主都能在不信任传输的前提下校验任何
安装。Schema:[schemas/integrity.schema.json](schemas/integrity.schema.json)。

- `algorithm`:`"sha256"`(v1 中唯一取值)。
- `files`:包根相对路径 → 小写十六进制摘要的映射。
- `manifestSha256`:`manifest.json` 本身的摘要(也出现在 `files` 中)。

重算摘要与 `integrity.json` 不符的树即视为损坏:宿主拒绝激活,并指出不匹配的路径。

## 4. 安装事务与 Receipt

安装是**内容寻址、崩溃安全的事务**(对齐上游 `desktopPnpm.installPlugin` 的
recovery-receipt 语义):

1. 取得包 tgz → 计算摘要 → 存入 `cache/blobs/<sha256>`;
2. 校验摘要;不符则在解包之前中止;
3. 原子解包到 `plugins/<pkg>@<semver>/`,并按包内 `integrity.json` 复验;
4. 把 receipt 追加进 `receipts/` —— receipt 的写入即**提交点**。

receipt 是记录性日志;schema:[schemas/receipt.schema.json](schemas/receipt.schema.json)。

- `status: "pending"` —— 步骤 1–3 被打断(崩溃、断电)。宿主启动时重放每一条 pending
  receipt:暂存树校验通过则完成安装,否则回滚并把 receipt 标为 `rolled-back`。宿主绝不
  留下未经检查的 pending receipt。
- `status: "committed"` —— 已安装树是权威的;`previousVersion` 记录被替换者(全新安装
  为 `null`)。
- `action: "remove"` —— 对称:摘除目录树,receipt 记录被移除的 `version` 与
  `previousVersion` 供审计。
- receipt 只追加;改写或删除已提交的 receipt 是违反契约。

## 5. 能力字符串文法

与原语契约共享:`<name>` 或 `<name>@<major>`。名字为小写字母数字与 `-`/`.`。保留名:
`gateway`(本契约集,如 `gateway@1`);[primitives.md](primitives.zh.md) 的每条原语权限位
都是合法能力名。

## 6. 版本化

- 四份 schema **独立于原语契约版本化**:manifest 携带 `schemaVersion: 1`,receipt 携带
  `receiptVersion: 1`(integrity 为 `ledgerVersion: 1`),目录索引携带自己的 `schemaVersion: 1`
  (§7)。
- 增补可选字段 = 次版本;任何移除、改型、必填字段新增 = 主版本,并附迁移说明。宿主对
  不理解的主版本的 manifest/receipt/目录 —— 响亮地拒绝(fail-loud 规则),绝不尽力解析。

## 7. 签名目录(v1.1.0 —— 插件市场)

产品身份中的注册表一半是**一份签名的静态 `index.json` 加上托管在普通文件服务(对象存储 /
GitHub Releases)上的包 tarball**。目录是数据,不是服务:无常驻服务进程、无数据库、无账号;
它可以从仓库复现(由 CI 署名,与 vendor pin 表同一纪律)。发现与安装都走冻结的 `httpFetch`
原语;这里不发明任何包格式——目录上的包就是 §1–§4 的格式。提案:
[2026-10-01-plugin-marketplace.zh.md](proposals/2026-10-01-plugin-marketplace.zh.md)(ADOPTED,
owner 2026-10-01 拍板:手机侧 dsh 插件市场,上游插件、本仓库 `system-plugins/` 与 web-client
皮肤同属一种格式)。Schema:
[schemas/marketplace-index.schema.json](schemas/marketplace-index.schema.json)。

```json
{
  "schemaVersion": 1,
  "marketplace": "dsh",
  "generatedAt": "2026-10-01T00:00:00Z",
  "keys": { "dsh-market-1": "ed25519 公钥,base64(32 字节)" },
  "entries": [
    {
      "id": "dsh-office", "version": "0.1.0", "type": "service",
      "tgzUrl": "https://…/packages/dsh-office@0.1.0.tgz",
      "blobSha256": "…", "manifestSha256": "…",
      "capabilities": { "required": ["fsRead"], "optional": [] },
      "summary": { "en": "…", "zh": "…" }
    }
  ],
  "signatures": [ { "key": "dsh-market-1", "value": "ed25519 签名,base64(64 字节)" } ]
}
```

- `entries[]` 只镜像消费方在**下载之前**需要的冻结 manifest 字段;其余都在取包之后从包自带的
  `manifest.json` 读取。这里的 `capabilities` 只是**建议性的展示数据**——包 manifest(§2)
  仍是唯一事实源,授权只发生在安装期、经冻结管线里的 §2 协商。
  `blobSha256`/`manifestSha256` 就是 §4 事务的信任记录。
- `keys` 携带**当前**验证密钥集。`signatures` 平时携带一条 ed25519 签名(RFC 8032
  PureEdDSA),轮换窗口期内携带两条(见下)。

### 7.1 签名规则

- 签名覆盖除 `signatures` 之外全部内容的**规范 JSON**:UTF-8 编码,对象键递归排序(按码元
  字典序),数组保持顺序,无无意义空白。
- **签名即信任。**消费方拒绝一切无法验证的目录,且只信任它钉住过的、或按 §7.2 学到的密钥。
  验签失败、未知签名密钥、目录畸形、条目缺失,全部走安装器既有的 `InstallRejected` 词表
  响亮拒绝——每一条可审计,零暂存。
- 验证公钥由宿主侧钉住,带外进行,与 vendor pin 表同一纪律(密钥轮换是索引事件,不是应用
  升级)。初始钉扎是仓库配置;私钥只存在于签名 CI 环境——绝不入库。

### 7.2 密钥轮换

一次轮换会在一个轮换窗口期内发布由新旧两把密钥共同签名的索引。宿主用它已信任的密钥验证,
然后**学到**新密钥——但只从这种双签且验证通过的索引学:宿主既没钉过、也没见过在已验证索引
上联署的密钥就是未知密钥,仅由它签名的目录会被拒绝。窗口随后关闭:发布的索引去掉旧签名;
观察过窗口的宿主继续工作,从未观察过的宿主(陈旧钉扎)在观察到双签索引之前拒绝窗口后的
目录。学习是会话态,不持久化——重启的宿主回落到钉扎,被攻破的宿主因此无法绕过窗口纪律。

### 7.3 消费流(resolver 缝)

```
marketplace.lookup(id@range?)   → 验证过的目录条目
  → installFromFetch({ url: entry.tgzUrl, id: entry.id,
      trust: { blobSha256, manifestSha256 }, … })     // §4,既有且不改
```

resolver(经 `httpFetch` 取索引 + §7.1 验签 + §7.2 轮换状态 + 条目查找)是唯一的新缝;
§4 安装事务零改动——resolver 把签名的信任记录原样透传,因此被篡改的托管永远产不出可安装的
包(签名覆盖摘要;事务从字节重新推导它们)。

## 8. 通道负载(v1.2.0 —— `channel.payloads@1`)

v1.9.0 事件通道缝的每源封闭 schema([primitives.zh.md](primitives.zh.md) §4「the channel
seam」)。源表随本节版本化:加一个源是此处的次要版本,改既有负载形状是主版本。

| 源 | 负载 | 说明 |
| --- | --- | --- |
| `motion` | `{ ts, accel: { x, y, z }, gyro?: { x, y, z } }` | `ts` 是宿主的 ISO-8601 采样时刻;SI 单位(m/s²、rad/s);平台提供时有 `gyro`——缺失是诚实的,绝不零填充 |
| `battery` | `{ level, state }` | `level` 为 0–1;`state` 为 `"charging" \| "discharging" \| "full"`;仅在变化时投递 |

## 9. Surface 操作词汇(v1.2.0 —— `surface.ops@1`)

v1.10.0 render 面 `surfaceDraw` 的封闭、版本化操作集([primitives.zh.md](primitives.zh.md)
§4「the render surface」)。一个操作列表 = 一帧原子绘制;畸形操作使整次调用失败、上一帧
保留。fold 在提案草稿之上补了 `arc`(首个消费者要创作的正是圆形 UI 类)。加操作或字段是
此处的次要版本;改/删是主版本。

操作按提交顺序:

| 操作 | 字段 | 含义 |
| --- | --- | --- |
| `clear` | `{ op: "clear", color? }` | 填充后备缓冲(默认不透明黑) |
| `setStyle` | `{ op: "setStyle", fill?, stroke?, lineWidth?, font? }` | 后续操作的样式状态;颜色为 `#rrggbb`/`#rrggbbaa`;`font` 为 `<size>px <family>` |
| `fillRect` | `{ op: "fillRect", x, y, w, h }` | 以当前 fill 画轴对齐矩形 |
| `strokePath` | `{ op: "strokePath", d }` | `d` 为子路径数组(见下),以当前 stroke/lineWidth 描边 |
| `fillPath` | `{ op: "fillPath", d }` | 同一子路径数组,填充 |
| `text` | `{ op: "text", x, y, text, baseline? }` | fill 样式文本;`baseline` 为 `"top" \| "middle" \| "bottom"`(v0 默认 `"top"`) |
| `drawImage` | `{ op: "drawImage", path, x, y, w?, h? }` | 解码已授权 fs scope 内的图片并绘制;`path` 相对范围 |

`strokePath` / `fillPath` 的子路径项(`d`):`{ c: "move", x, y }`、`{ c: "line", x, y }`、
`{ c: "quad", cx, cy, x, y }`、`{ c: "arc", x, y, r, start, end, ccw? }`(角度为弧度)、
`{ c: "close" }`。不以 `move` 开头的 `d` 按使整帧 `invalid` 拒绝。

## 10. Agent-UI 消息（v1.3.0 —— `a2ui.messages@0.9`）

声明式 agent-UI 格式：agent 以**会话内容**（与工具调用卡同层）发出的带版本
UI 载荷，各宿主用自己的渲染器渲染。采纳自
[proposals/2026-10-17-a2ui-generative-ui.md](proposals/2026-10-17-a2ui-generative-ui.md)
（2026-10-19 ADOPTED）；本节冻结的正是已落地的 `dsh-appshell` 插件与 web
客户端渲染器所实现的形态。零网关原语、零新通道（提案的非目标全部守住）。

- **格式名与版本钉。** `a2ui.messages@0.9` 钉 A2UI 规范 **v0.9** ——所钉
  Lynx 渲染器（`@lynx-js/genui` v0.7.0）所讲的版本。只有当新钉的渲染器
  支持更新规范时才升版并重钉本节；版本写进格式名正是因为这个缺口存在。
- **下行（agent → 客户端）。** UI 载荷随会话流走 SessionServe 线；三层
  信封不动。宿主用自己的目录渲染：Lynx 面走 genui 的 MessageProcessor，
  web 客户端走树内组件渲染器。渲染永不执行模型产的代码。
- **上行（客户端 → agent）。** 渲染表面的 `onAction` 以**带组件路径标记的
  用户轮**进入（已落地拼写：`[appshell:<action>] <label>`），过与任何用户
  请求相同的审批缝（#441）。v0 没有 `ui.action` 通道。
- **Profile。** 首个冻结 profile 为 **`app-shell/0.9`**——两层词汇表：
  8 个原语（`text image button row column card progressbar badge`，唯一
  渲染词汇）+ 8 个模板（编译为纯原语树；校验器强制验展开性）。一个
  profile 声明组件目录、逐组件 props 与校验闸；四闸 = 白名单 / 文本纯度 /
  尺寸帽 / 动作枚举。
- **表面与增量。** render 铸造 echo 返回的 `surfaceId`；update 必须点名
  活表面（伪造 id 在任何 spec 处理之前被拒——跨表面污染是授权失败而非
  校验失败）。update 载荷可为**全量或增量**——`screen` 替换树、
  `theme`/`tabs`/`actions` 在场则覆盖；线上载荷原样往返，两侧各自与渲染源
  合并。
- **安全规则。** 组件字符串字段是文本——永不是标记、永不自动抓取 URL；
  v0 无 HTML 逃生门。逐消息预算：序列化 spec ≤32KB、展开树 ≤200 节点、
  深度 ≤8、文本字段 ≤500 符文、children ≤24。输出可流式解析——敌意或
  失控的模型输出被截断，永不卡死运行时。

遗留的 `card.present` 总线词汇映射进 A2UI 目录（提取器是运行时闭包内的
纯 JS）；弃用时间表另行决定——永不强制迁移。

## 11. 原生面载荷（v1.4.0 —— `face.*@1`）

**不可约原语之上**的版本化载荷 schema 族：原生声明式面——PiP 卡片总线面、带内问询面，
以及骑在冻结的同意面原语（`presentApproval` / `presentPicker` / `notify`）之上的请求载荷。
采纳自
[proposals/2026-11-12-native-face-schemas.zh.md](proposals/2026-11-12-native-face-schemas.zh.md)
（2026-11-13 ADOPTED）；本节冻结的正是五个独立渲染器靠对称性已经共同持有的形状
（三个原生宿主、运行时桥、web 客户端的卡片面），现在把它声明出来。零网关原语、
零新事件通道——每一帧都骑在已经存在的通道上
（[primitives.zh.md](primitives.zh.md) §4/§5）。命名规则：每个族是
`face.<name>@<major>`；载荷携带整数 `schemaVersion`，指明生产方所讲的家庭版本。
标 **v1-add** 的字段是仅有的新增字段；其余全是今天的形状，现在只是声明出来。

### 版本化规则（自第一天起就是加性的）

- `schemaVersion` 是每个面载荷上的**可选整数**：总线帧放在顶层
  （`{type:"card.present", schemaVersion:1, card:{…}}`），原语载荷放在请求对象内
  （`presentApproval({schemaVersion:1, title, detail})`)。**缺席 = 遗留 = 今天的
  确切行为，永远如此**——不带该字段的载荷在每个宿主上的渲染完全一致，总线面没有
  弃用时钟（已文档化的生产方容忍度继续成立：未知字段到处被忽略，任何东西都不抛）。
- 增补铸造下一个整数（`face.card@2`）并附迁移说明——§6 纪律。因为每项增补都是
  可选的、核心形状永不动，宿主可以渲染**更新**的载荷：忽略未知字段加一条 warn。
  **在族内禁止移除、改型、必填字段新增**——那要铸造新的族名，伴随主版本折叠与
  迁移说明（§6 的响亮边界）。

### face.card@1 —— PiP 卡片总线面

总线线 `card.present` / `card.state` / `card.complete` / `card.dismiss`
（三个原生宿主与 web 客户端的卡片面渲染），加上 v1-add 的宿主→运行时回报
`card.action`：

| 帧 | 字段 | 类型 / 默认 |
| --- | --- | --- |
| `card.present` | `card.id` | string,**必填**——缺失 id 被拒（不渲染）并 warn,绝不静默丢弃 |
| | `card.title?` | string,默认取 id |
| | `card.subtitle?` | string;平台支持处渲染,不支持处忽略 |
| | `card.kind?` | **封闭集** `{info, timer}`（默认 `info`）；未知 kind 降级为 `info` 并记一条 warn |
| | `card.durationMs?` | number——本地倒计时锚点 |
| | `card.label?` | string——非 timer 的文本行 |
| | `card.actions?` | **v1-add**：`[{id, label}]`——声明式动作按钮;无按钮支持的宿主忽略该数组并记一条 warn（卡片照常渲染） |
| `card.state` | `state.remainingMs?` | number——重锚本地时钟（宿主本地 250 ms 补间;1 Hz 补丁足够——绝不刷屏） |
| | `state.label?` | string——替换文本行 |
| `card.complete` | `message?` | string,默认 `"完成"`；iOS/Android 约 2.5 s 自动消失，harmony 保留卡片 |
| `card.dismiss` | `{}` | 所有宿主都接受 |
| `card.action` | **v1-add**（宿主→运行时） | `{id, action: "close" \| "drag-end" \| "button", actionId?, at}`——动作回报事件（见下） |

**消失的权威留在插件手里**——本地关闭的卡片只是忽略后续的 `card.state` /
`card.complete` 记录。`card.action` 让本地关闭变得*可观察*，绝不让它变成权威：
生产方听见关闭并可以反应（发 `card.dismiss`、重新 present、停掉自己的循环），
但它拿不到表面的控制权。

### face.question@1 —— 带内问询面

总线帧 `question.request` / `question.answer` / `question.decided`
（iOS 与 Android 原生渲染；harmony 经 WebView 作答）：

| 帧 | 字段 | 类型 / 默认 |
| --- | --- | --- |
| `question.request` | `id` | string,**必填**（askId） |
| | `questions[].id?` | string,默认 `q<n>` |
| | `questions[].header?` | string——对话框标题 |
| | `questions[].question?` | string——消息正文 |
| | `questions[].options[]` | **v1-add 规范化**：`{id, label}` 对象是规范形态；裸字符串仍被接受为 `{id: <字符串>, label: <字符串>}`；答案按 **id** 认选项，绝不按回显的显示文本 |
| `question.answer` | `outcome` | **v1-add**：`"answered" \| "cancelled"`——**缺席 = `answered`**（遗留帧不变）；cancelled 让被搁置的轮次落地 |
| | `answers[].id` | string——问题 id |
| | `answers[].selected` | `string[]`——v1 下为选项 **id**（遗留帧里是 label） |
| | `answers[].custom?` | string——自由文本答案 |
| `question.decided` | `{id}` | 不变——跟随落地 |

### face.approval@1 —— 同意阶梯请求面

仅请求侧：冻结的 `presentApproval` 结果 `{approved, remember?}` 逐字节不动
（[primitives.zh.md](primitives.zh.md) §4）。载荷恰是宿主已经在读的字段，现在
声明为全族形状——同一形状服务同意孪生面（clipboardRead 同意、BLE 提示层），
第四个手搓对话框由此变成一次载荷读取：

| 字段 | 类型 |
| --- | --- |
| `schemaVersion?` | integer（上面的族规则） |
| `title` | string（宿主默认 `""`/`"Approval"`） |
| `detail?` | string——**规范的 detail 字段；不给 `message` 别名背书** |
| `allowRemember?` | boolean——为 true 时呈现「记住」UI |

v1 拒收（还没有消费者索要；克制规则同样约束载荷面）：结构化风险对象、
拒绝理由/评论通道、i18n 按钮文案、宿主侧过期。每一项都是可加的 v2 候选。

### face.picker@1 —— OS 选择器请求面

仅请求侧；冻结的 `presentPicker` 结果 `{scope, path} | null` 逐字节不动——
用户放弃仍是 null 值，绝不是错误：

| 字段 | 类型 |
| --- | --- |
| `mode` | `{file, directory, media}`（iOS/Android 默认 `file`）——在服务集合，含 v1.5.0 的 `media` 扩展 |
| `suggestedName?` | string——全族声明;尚未服务处为加性（未知字段被忽略） |

v1 拒收：内容过滤与多选——两者都会改动冻结的结果形状（主版本素材）。

### face.notify@1 —— 本地通知请求面

仅请求侧；冻结的 `notify` 结果 `{id}` 逐字节不动：

| 字段 | 类型 |
| --- | --- |
| `title` | string,**必填**——宿主对缺失 title 以 `invalid` 拒绝；绝不静默代入默认值 |
| `body?` | string |
| `threadId?` | string——全族声明（尚未服务处为加性） |
| `data?` | `map<string, any>`——全族声明（尚未服务处为加性） |

v1 拒收：通知动作类别（没有任何宿主注册过）。

### 动作回报契约（D8——事件序列，绝不轮询）

用户动作作为事件回到运行时，走的全是已经存在的通道。零新网关原语、零新事件
通道、零共享宿主状态：

1. **`card.action`** 骑在 `question.answer` 已经在用的宿主→运行时总线投递上。
   顺序保证：每个卡片 id 至多一个终态动作（`close` 压过挂起的 `button`），
   按发生次序排列。
2. **带 `outcome: "cancelled"` 的 `question.answer`** 让被搁置的问询落地；
   `question.decided` 保持其落地后的位置。
3. **`notify.response`** 保持 [primitives.zh.md](primitives.zh.md) §5 的冻结
   事件通道；已发布的顺序——先 `notify.response` 后 `app.state`
   `"foreground"`——钉为族行为。
4. **Approval/picker/notify 结果骑冻结的原语 settle**——零新事件。

### 降级阶梯（绝不崩溃，绝不静默）

每个面渲染器实现的有序规则：

1. **未知面类型或未知 `kind` → 渲染通用形态**（标题 + 文本），经宿主统一日志
   通道记**一条**结构化 warn——绝不抛，绝不静默丢弃。
2. **`schemaVersion` 高于宿主已知上限 → 遗留渲染 + warn**（忽略未知字段——
   已文档化的容忍度）。
3. **未知字段 → 忽略**（今天的行为，现在声明出来）。
4. **必填字段缺失 → 不渲染 + 一条指名帧与字段的结构化 warn**——替换静默丢弃。
   诚实的修正是那条日志，不是渲染：生产方契约文档化了丢弃行为，所以丢弃保留；
   要改掉的只是「静默」。
5. **原语载荷畸形保持冻结的 `invalid` 拒绝**
   （[primitives.zh.md](primitives.zh.md) §4）。

### fail-soft / fail-loud 边界

面是 **chrome**，fail-soft：面渲染器绝不压垮运行时，也绝不把载荷样式问题变成
被拒绝的调用——面是用户可见的 chrome，绝不是授权材料。安装文档保持相反极：
manifest / receipt / 目录继续执行 §6 的 fail-loud 规则（未知主版本响亮拒绝，
绝不尽力解析）。承载安全的校验（权限旗标、审计记录）留在网关，分毫不动——
`face.*@1` 中没有任何东西携带权威。
