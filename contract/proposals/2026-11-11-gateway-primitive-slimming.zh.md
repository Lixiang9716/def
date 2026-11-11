# 提案:网关原语瘦身——标注不可约原生 ABI,废弃空置的仪式行(v1.12.0 标注轮)

> **状态:DRAFT(D5 提案——不改任何已冻形状;本文件提出的是标注、废弃,以及把宿主已在服务的行折叠进表)。**

[English](2026-11-11-gateway-primitive-slimming.md) | 简体中文

## 动机

seam-collapse 程序(plan.md §13)前两阶段已落地:P1 把产品 fs 席位换成网关原语之上的 dsh-fs cordis provider(#762;`runtime/dsh/upstream/boot.js:198-211`——`mountFileTools` 把我们的 `DshFsProvider` 挂成 `ctx.fs` 服务,vendored fs-local 从产品 boot 退役),P2 审计 `ctx.shell`/`ctx.subprocess` 得 dualPlane:false,空席位以诚实方式留置(`.agents/notes/implemented/architecture/2026-11-12-p2-shell-subprocess-seam-audit.md`)。provider 现在是一个能力唯一的产品面;它脚下的网关表,是 provider 能向宿主要求的全部。

于是这张已冻表自身的诚实成了剩余的债,而且它已经**朝两个方向**漂移:

1. **引擎或实现已不存在的行。** `ishRun`(v1.3.0,primitives.md §4 "emulated userland")自 2026-10 退役起**没有任何在役宿主**——契约自己的状态注记已记录(primitives.md:123-129);iOS 保留该行只是为了诚实的 `unavailable` 回答仍然接线(`hosts/ios/App/Source/Gateway/GatewayCore.swift:127-141`),Android 出于同一理由放进 `RETIRED_ROWS`(`hosts/android/app/src/main/java/com/dshmobile/host/GatewayCore.kt:46-51`),harmony 声明为 unavailable(`hosts/harmony/entry/src/main/ets/model/HostPhase.ets:154`)。channel seam(v1.9.0,`channelOpen`/`channelClose`)**在任何地方都没有实现**——对 `*.c/*.swift/*.kt/*.ets/*.cpp` 全库 grep `channelOpen`,本提案之外零命中。socket seam(v1.8.0)在共享 C 脊柱里存在(`src/dsh_socket.c:146-246`,由 `src/dsh_runtime_host.c:3891-3893` 接线),但**没有任何产品宿主的 descriptor 点名这两行**(上文引用的 iOS/Android/harmony 三份清单都没有)。

2. **表里没有、而每个宿主都在服务的行。** 系统能力面——`cameraCapture`、八条 BLE 行、`micStart`/`micStop`——三个宿主全都在服务(iOS `GatewayCore.swift:138-141`,Android `GatewayCore.kt:35-38`,harmony `HostPhase.ets:149-151`),而承载它的提案仍写着"**状态:DRAFT(D5 提案——未冻结、未实现)**"(`contract/proposals/2026-09-30-system-capability-plane.md:3`)。已冻表(primitives.md §2,至 v1.11.0 共 33 行)一个都没有点名。比现实更薄的表,与比现实更厚的表是同一种不诚实:negotiation 读的是 descriptor,不是真相。

3. **不承载安全的仪式层还悬在表上方。** seam collapse 把能力面搬进了 provider,但一些非安全仪式仍以无 gate 互钉的多份拷贝存在:网关地址推导以相同算术存在三份(P2 审计已记为 deferred hygiene——shell `toGateway` `runtime/dsh/system-plugins/dsh-shell-js/applets-support.js:115-125`、`DshFsProvider.address` `runtime/dsh/system-plugins/dsh-fs/cordis.js:104-115`、office `scopePathFor` `runtime/dsh/system-plugins/dsh-office/fschannel.js:22-33`),fs-seam gate 的拒绝文本还在点名已退役的 `mountWorkspace`(`runtime/dsh/upstream/shims/fs-seam-gate.js:33`)。

本提案是程序的 P3 契约瘦身半场:**把诚实的协商面收缩到不可约原生 ABI,标注什么是仪式并下沉进 provider,给空置行一个明确的废弃姿态,而不是永恒的冻结沉默。** D5 原样成立:所有已冻形状逐字节不动;瘦身以标注、废弃、新消费者重定向表达——绝不以修改已冻形状表达。

## 设计

### 1. Tier A——标注不可约原生 ABI(全部是增量文档事实)

在冻结表 §2 每个家族加一句分类,说明该行为什么不可约(该能力唯一的供给者是 OS 或宿主进程本身),以及今天哪些宿主在服务它:

| 家族 | 行(§2 编号) | 不可约原因 | 在役宿主(2026-11-11) |
| --- | --- | --- | --- |
| fs 核心 | `fsRead`/`fsWrite`/`fsScope` #1-3、`fsStat`/`fsList`/`fsMkdir`/`fsRemove`/`fsRename` #10-14、`fsPublishAtomic`/`fsSync` #32-33 | 宿主的文件世界没有第二条路(D2:无子进程;D6:vendored 代码永不触盘) | iOS、Android、harmony(harmony 服务核心三件套+耐久对;元数据五行答 `unavailable`——`HostPhase.ets:152-154`) |
| 网络 | `httpFetch` #4 | 宿主网络栈是唯一出口 | 三者 |
| 同意面 | `notify` #5、`presentApproval` #6、`presentPicker` #7 | 面向用户的 OS 界面本身就是信任边界 | 三者 |
| 凭据 | `keychainGet`/`keychainSet` #8-9 | OS 凭据库 | 三者 |
| 执行 | `wasmRun` #15 | 进程内解释器定义上就是宿主机制(iOS 禁 JIT,别无替代) | iOS、Android(harmony:`unavailable`) |
| 定时器 | `timerSchedule`/`timerCancel` #17-18 | 未来的回调必须经宿主重入串行队列(D2/D8;v1.4.0 折叠的证据:没有它 22 个套件失败) | 三者 |
| 设备面 | `deviceInfo`/`haptic`/`clipboardRead`/`clipboardWrite`/`presentShare`/`keepAwake` #19-24 | 平台 SDK 访问,数项在 OS 权限弹窗之后 | 三者 |
| 渲染面 | `presentSurface`/`surfaceDraw`/`closeSurface` #29-31 | 宿主原生窗口是 OS 机制 | 仅 harmony(iOS/Android 以 Web Client 创作视图为协商下限) |
| socket | `socketListen`/`socketConnect` #25-26 | OS socket;**且审计记录就是控制本身**——把它们沉到网关之下等于删掉安全边界(五规则模型,primitives.md §4 "the socket seam") | 共享 C 脊柱 / CLI 宿主;**没有产品宿主装载它们** |

Tier A 行逐字节保留已冻形状;新 provider 与新消费者照旧协商。标注是关于*该行为什么存在*的文档事实,以 v1.12.0 文档修订版本化(不改形状,不改协商)。

### 2. Tier B——废弃空置仪式行,重定向新消费者

- **`ishRun`(#16)——现在标废弃,v2.0.0 移除。** 2026-10 起无在役宿主(证据见上);它的审计诚实缺口(§4:网关"无法审计 guest 内部程序的行为")使该行成为围着一个已不存在引擎的授权仪式。未来需要程序执行的消费者迁移路径:
  1. **上游 `ctx.subprocess` cordis 席位**——编写 `system-plugins/dsh-subprocess-<face>/cordis.js` 继承 vendored `SubprocessRuntime`(P2 审计记录的席位接线路径);
  2. 进程内解释器够用的场合走 **`wasmRun`**(wasm shell 先例)。
  今天没有能力消费者——剩下的机械尾巴(web-live boot 的可用性探针、wrapper 导出、死掉的 manifest 能力行、audit-invariant 腿的 `unavailable` 断言格)已在 §5 列尽,随移除变更一起走,废弃窗口零成本:v1.12.0 标 deprecated,沿 v1.x 线携带标记,v2.0.0 文档移除该行并附迁移说明(§8 本就预留了这套机制)。
- **`channelOpen`/`channelClose`(#27-28)——同一姿态决定,归 owner。** 零实现、零能力消费者,v1.9.0 折叠的源表(`motion`、`battery`)没有服务宿主。要么第一个消费者证明这条 seam(某宿主实现它),要么两行与 `ishRun` 一起进 v2.0.0 移除集。本提案建议现在就打废弃标记,窗口与 `ishRun` 相同,让已冻表不再暗示一个无人服务的服务面——并且 §3 对唯一仍以 `channelOpen` 为载体的设计(能力面的 camera-frames 半场)作出处置,使标记不留悬空消费者。
- **`socketListen`/`socketConnect`(#25-26)——保留(Tier A),标注空置。** 与 channel 行不同,它们承载真实审计边界与真实实现(C 脊柱;parity/suite 腿在行使)。标注记录:今天由 CLI 脊柱服务,没有产品宿主装载——缺席是协商的信息,永不伪造(§7 #1)。

### 3. 折叠现实已在服务的行(反漂移的另一半)

本提案请求的 v1.12.0 文档修订**同时**把能力面折叠进 §2——十一行(`cameraCapture`、八条 BLE、`micStart`、`micStop`)每个宿主都已在服务——即采纳 `contract/proposals/2026-09-30-system-capability-plane.md`,其状态行必须在采纳时修正(它的"未实现"声明对三份宿主清单已过期)。没有这一折叠的瘦身是不诚实的:表必须朝真相双向收缩。

**被采纳提案的 channel 半场在此处置,不是静默丢弃。** 2026-09-30 提案把连续 camera 帧流路由到 channel seam 上——"`channelOpen` 在其闭源版本化源表里**获得** `"camera"` **源**"(`2026-09-30-system-capability-plane.md:117-119`,权限表的 `channelOpen("camera")` 行见 :248)——恰是上文 Tier B 建议废弃的那一对。本提案记录哪个设计胜出:**已部署世界已经选定的专用席位先例。** 已实现的麦克风与 BLE 面已经拒绝 `channelOpen`-only 运载(该提案自己的 Alternatives,:314-318——`channelOpen` 的 `{ hz, tag }` 选项装不下音频格式、扫描过滤器或 GATT 元组),且已交付的投递走专用事件席位而非 `channel.event`:harmony 的麦克风直接发 `mic.frame` 桥事件(`hosts/harmony/entry/src/main/ets/model/MicPrimitives.ets:312`,`runtime/dsh/gateway.js:357,394-395` 消费)。因此采纳时,camera-frames 半场重塑为同一模式——专用 `cameraFramesOpen`/`cameraFramesClose` 控制对(或 capture 原语自己的 `camera.frame` 席位)走 seam 的投递*规则*(latest-wins、挂起期间不投递),绝不走 `channelOpen` 订阅面——两条分阶段 `cameraRecordStart`/`Stop` 行保持提案规定的形状(控制调用,非 channel 源),待其阶段落地时实现。重塑之后,现行设计无一再以 `channelOpen` 为载体,Tier B 废弃成立。若 owner 转而为 channel seam 的首个宿主出资,camera-frames 半场可保留 `channelOpen("camera")` 形状——但届时 §2 的 channel 条目翻转为 Tier A 空置标注,本 §3 重塑作废;这两个决定是同一个决定。

**版本号冲突,已处置(仓库的显式注记先例)。** 本轮声明的 v1.12.0 候选资格并非空闲:`contract/proposals/2026-10-19-net-fd-wrap.md:1` 是一份在册 DRAFT,标题即"(v1.12.0 candidate)",并论证"v1.12.0 is the next free additive number"(:276)——已采纳的 producer-registry 提案也曾携带同一候选标题而未取号。仓库已有约定(primitives.md:76-79,v1.9.0 折叠注记;net-fd-wrap 自己的"the fold renumbers per the next-free rule at adoption",:276)给出解法:**单调折叠顺序胜出。** 本标注轮现在就在跑道上,若先折叠即取 v1.12.0;net-fd-wrap 的候选资格移至 v1.13.0(其自己的 next-free 规则,在其采纳时应用),在此之前不改任何提案标题。在此记录冲突即修复;改另一份 DRAFT 的标题是其 owner 在改号时的一行事。

### 4. 边界规则:什么下沉进 provider,什么永不

- **承载安全的校验留在网关。** 作用域逃逸拒绝("越出作用域根的 path 在**任何**宿主调用之前**即被拒为 `invalid`**",primitives.md §4 "filesystem additions" :302-303)是授权,不是仪式。权限 flag 检查与 §6 审计记录同理。本提案不动它们分毫。
- **数据塑形仪式下沉进 provider。** 本程序已浮出的具体下沉项(P2 的 deferred hygiene,已为后续单独立项):
  1. 网关地址推导存在三份——去重为一条共享的 provider 侧规则,使未来对任意一份的修改不能重开 P1 关闭的双地址空间缺陷;
  2. shim gate 里过期的 `fs-local`/`mountWorkspace` 措辞(`fs-seam-gate.js:33`)及 P2 审计点名的 web-write 文件——仪式文本,provider 空间修复;
  3. 姿态不对称(未授权 scopeRoot:shell 大声拒绝,`cordis.address` 静默降级)——provider 空间对齐。
  一个能力的新消费者找**上游 seam**(`ctx.fs`、`ctx.subprocess`、tools 注册表),绝不找第二个网关面——P1/P2 确立的折叠纪律。

### 5. 消费方迁移路径与废弃窗口

| 行 | 今天的使用方 | 迁移路径 | 窗口 |
| --- | --- | --- | --- |
| `ishRun` | 无能力消费者(引擎 2026-10 退役);只剩机械尾巴——web-live boot 的可用性探针(`runtime/dsh/web-live/composer-web-live.js:433` 的 `probeIshRun()`)、wrapper 导出(`runtime/dsh/gateway.js:129-130`)、`runtime/dsh/manifest.json` `capabilities.required` 里死掉的 `ishRun` 项、audit-invariant 腿的 `unavailable` 断言格(`runtime/dsh/scenario/gateway-audit-invariant.js:232`) | `ctx.subprocess` cordis 席位(P2 的路径)或 `wasmRun`;尾巴随移除变更一起走:探针的期望答案翻为 `denied`,于是探针要么断言移除要么删除,wrapper 导出与 manifest 能力行随之移除,审计断言格更新——一个 PR,无兼容负担 | v1.12.0 标 deprecated;v2.0.0 移除并携带上述尾巴修改 |
| `channelOpen`/`channelClose` | 无能力消费者;同一条 audit-invariant 腿探这两行的 `unavailable` 回答(`runtime/dsh/scenario/gateway-audit-invariant.js:243-244`,由 `test/e2e/scenarios/gateway-audit-invariant.json:64-65` 钉住)——§3 已重塑唯一以 `channelOpen` 为载体的设计 | 某宿主实现证明该 seam(届时 §2 翻转为 Tier A 标注、§3 重塑作废),或随 v2.0.0 移除并携带审计断言格更新 | 与 `ishRun` 同标记 |
| `socketListen`/`socketConnect` | CLI 脊柱 / parity 套件腿 | 无需——行保留为 Tier A,标注空置 | 无 |
| 地址推导三份拷贝(非表行) | shell、dsh-fs、dsh-office | 一条共享 provider 规则;各使用方 import 它 | 以 P2 已记录的 P3 体量后续落地,先于任何新使用方加入 |

## 非目标

- **修改任何已冻形状**(D5):标注、废弃与能力面折叠是仅有的触碰;真正的移除归 §8 的主版本机制。
- **折叠之外的任何新原语**:表的克制规则(primitives.md §8)照立;其他需求照常论证必要性。
- **宿主分支**:上述每一项分类都是 RuntimeDescriptor 里的逐宿主服务事实——这是能力协商,绝不是 `hostType` 条件(RFC 0002)。
- **把权限检查或审计挪出网关**——§4 边界规则点名其为不可移动项。

## 考虑过的替代方案

- **对空置保持沉默(现状)**——否决:channel seam 证明了失败模式;三年"已冻"不等于三年"已服务",协商无法区分二者。
- **socket 行随 channel 行一起废弃**——否决:它们有真实实现、真实审计边界、真实(套件腿)消费者;诚实的标注是空置,不是死亡。
- **能力面折叠另起一轮**——作为时序否决:瘦身轮正是表对照现实重审之时;拆开会让"未实现"状态行再过期一个折叠周期。
- **由本提案顺手改掉 2026-09-30 提案的状态行**——否决:它的状态在它自己被采纳时更新(producer-registry 先例——采纳 PR 更新它采纳的提案);本文件只引用该漂移。

## 证据

- 已冻表与其双向漂移:`contract/primitives.md`(§2 行 #1-33 见 :153-253;ishRun 状态注记 :123-129;§4 语义;§8 演化 :701-718;单调折叠编号注记 :76-79)。
- 宿主服务事实(2026-11-11 于 feat/seam-collapse-p2p3 席位读取):`hosts/ios/App/Source/Gateway/GatewayCore.swift:127-141`(全表含 wasmRun :130、camera/BLE/mic :138-141;无 socket/channel/surface 行)、`hosts/android/app/src/main/java/com/dshmobile/host/GatewayCore.kt:30-51`(同上,camera/BLE/mic :35-38,+ RETIRED_ROWS :46-51)、`hosts/harmony/entry/src/main/ets/model/HostPhase.ets:143-154`(BINDING_DESCRIPTOR:surface 三件套+能力面 available :147-151;unavailable 块——分阶段 camera-record 两行、fs 元数据五行、wasmRun、ishRun——:152-154)。
- channel seam 的缺席:2026-11-11 对 `*.c/*.swift/*.kt/*.ets/*.cpp` 全库 `grep channelOpen` 零命中。
- channel seam 唯一的设计消费者及其重塑依据:能力面 camera-frames 半场骑 `channelOpen("camera")`(`2026-09-30-system-capability-plane.md:117-119`、:248)、mic/BLE 专用控制面对 channel-only 运载的否决(:314-318)、以及已交付的专用席位投递(harmony `mic.frame` 桥事件,`MicPrimitives.ets:312`,`runtime/dsh/gateway.js:357,394-395` 消费)。
- v1.12.0 冲突:`contract/proposals/2026-10-19-net-fd-wrap.md:1`("v1.12.0 candidate")与 :276(采纳时的 next-free 规则);`contract/proposals/2026-10-24-producer-registry.md:1`(同一候选标题,采纳时未取号)。
- ishRun/channel 的机械尾巴:`runtime/dsh/web-live/composer-web-live.js:433`(`probeIshRun()`)、`runtime/dsh/gateway.js:129-130`(wrapper 导出)、`runtime/dsh/manifest.json`(`capabilities.required` 仍列 `ishRun`)、`runtime/dsh/scenario/gateway-audit-invariant.js:232,243-244` 与 `test/e2e/scenarios/gateway-audit-invariant.json:64-65`(移除 PR 要更新的 `unavailable` 断言格)。
- socket seam 的脊柱实现:`src/dsh_socket.c:146-246`、`src/dsh_runtime_host.c:3891-3893`、`example/main_cli.c`。
- 本提案所依赖的 provider 席位机制(#762):`runtime/dsh/upstream/boot.js:198-211`(mountFileTools 把 `DshFsProvider` 挂为 `ctx.fs` 服务)、`runtime/dsh/system-plugins/dsh-fs/cordis.js:1-30`(网关原语之上的 cordis provider)、P2 审计的空席位纪律(`.agents/notes/implemented/architecture/2026-11-12-p2-shell-subprocess-seam-audit.md`)。
- 仪式下沉项:`applets-support.js:115-125`、`cordis.js:104-115`、`fschannel.js:22-33`(三份推导拷贝)、`fs-seam-gate.js:33`(过期措辞)——均由 P2 审计的 deferred-hygiene 节记录。

## 体量

S(文档轮):§2 标注 + 两处废弃标记 + 能力面折叠(携带 §3 的 channel 半场重塑与版本处置)+ 2026-09-30 状态修正 + `contract/README.md` 当前-DRAFT 指针刷新(今天只点名 forkpty 与能力面,`contract/README.md:20`;落地这第三份 DRAFT 与日后的折叠各触碰该行)——一个 PR,无宿主代码。§4 的 provider 空间仪式下沉是 P2 审计已另行立项的后续。P3 的代码半场(基于 pin 定版 `defineTool` 面的工具卡契约升级)与本提案同席位落地,记录在它自己的 Agent Note 里。
