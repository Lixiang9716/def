# 提案:能力总线——冻结网关之上的自描述描述符平面(草案)

> **状态:DRAFT(D5 提案——未冻结、未实现;采纳时以可加方式折叠一条新原语行
> 和一个描述符文法)。不改任何冻结形状,不动权限与审计,本文件不提案任何宿主
> 代码变更。**
> [English](2026-11-13-capability-bus.md) | 简体中文

## 动机

今天新增 ONE 个 OS 能力,要按同一步调触碰七个位置——每一处都是对代码树已
经知道的事实的手工副本:

1. **冻结表。** `contract/primitives.md` §2 承载到 v1.11.0 为止的 33 行
   (`primitives.md:153-253`);新能力要按 §8 的克制规则争得自己那一行
   (`primitives.md:701-718`)。这个位置是稳定性合同,必须保留——本提案的
   要点恰恰是:它不该是唯一的位置。
2. **iOS 服务清单。** `GatewayCore.primitives` 是一条手工钉住的
   `static let`,它自己的注释承认这是第二份真相副本:"the name list IS
   the RuntimeDescriptor's available array, so it must stay identical to
   what `registerStandardPrimitives` actually wires"
   (`hosts/ios/App/Source/Gateway/GatewayCore.swift:123-129`,37 个名字的
   清单在 :130-143)。一条靠注释纪律而非靠构造维持的不变量——描述符
   pre-eval 再把清单复制一遍
   (`hosts/ios/App/Source/Gateway/GatewaySession.swift:351-359`)。
3. **Android 服务清单——乘以六。** `GatewayCore.PRIMITIVES` 加上
   `PHASED_ROWS`/`RETIRED_ROWS` 卫星清单
   (`hosts/android/app/src/main/java/com/dshmobile/host/GatewayCore.kt:23-51`)
   被 SIX 个 session 类复制成手工拼装的描述符 JSON
   (`BindingHost.kt:52-57`、`SessionServe.kt:318`、
   `SessionPersistRestartSession.kt:55`、`SessionLiveSession.kt:51`、
   `SessionWriteSession.kt:50`,以及诚实留空的 web-session 面
   `OfficialWebSession.kt:61`)。
4. **harmony 服务清单——两份、两种语言。** `HostPhase.ets` 以手工拼接的
   JSON 字符串承载描述符,注释写着 "Keep in sync with the C fallback in
   gateway_smoke.cpp"
   (`hosts/harmony/entry/src/main/ets/model/HostPhase.ets:136-154`);
   `gateway_smoke.cpp` 承载孪生副本并写着镜像指令("Keep in sync with
   HostPhase.ets's BINDING_DESCRIPTOR",
   `hosts/harmony/entry/src/main/cpp/gateway_smoke.cpp:70-94`)。维持孪生
   诚实要花一道专用门——`tools/check-descriptor-parity.mjs`(以
   `descriptor-parity` 门接线,`gates.json:237-252`)静态重推出四个面
   (两份描述符、C 转发表、ArkTS `onDispatch` 行、C `smoke_known_absent`
   集),它的缓冲检查记下了实测的擦边:28 行描述符坐在 `host_start` 固定
   缓冲的 **511/512 字节**——"one added row from a dead phase start"
   (`tools/check-descriptor-parity.mjs:203-207`)。
5. **手工钉住的每宿主普查计数。** 25 份 E2E manifest 把描述符的数字形状
   钉成字面 match 对象——能力绑定腿在 Android 钉 `36/3`
   (`test/e2e/scenarios/android-capability-binding.json:20-25`),harmony
   钉 `33/9`
   (`test/e2e/scenarios/harmony-capability-binding.json:34-38`);iOS 腿
   钉 `37/2`(`gateway-binding.json:14-18`、`device-plane.json:14-18`)和
   `35/2` + `blePlane: 8`(`ios-ble.json:14-18`、
   `ios-ble-denied.json:14-18`——被拒座位少服务两行);harmony BLE 家族钉
   `30/9` + 8(`harmony-ble.json:14-18`);smoke 面钉 `33/0` + 8
   (`camera-plane-capture.json:14-18`);fs 塌缩时代的 Android 座位钉
   `34/3`(`android-ble-absent.json:14-18`)。每加一行,宿主的每一份
   manifest 都机械变红,直到每处计数被手工重钉。
6. **审计不变式单元清单。** 审计完整性腿在场景脚本里手工枚举 59 个探测
   单元(`runtime/dsh/scenario/gateway-audit-invariant.js:99-283`——
   success、rejection、socket、`unavailable` 四个象限),再在 manifest 里
   重枚举成 59 条字面 `audit.probe` 期望
   (`test/e2e/scenarios/gateway-audit-invariant.json:10-69`,`calls: 59`
   钉在 :70,座位描述符钉 `13/9` 在 :9)。新行需要同时在两处加单元——
   否则不变式静默失去对它的覆盖。
7. **类型化 JS 垫片。** `runtime/dsh/gateway.js` 按冻结形状每原语一个
   导出("every primitive of contract/primitives.d.ts is exposed with its
   frozen shape",`gateway.js:2-5`;`fsRead` 在 :61 到 `micStop` 在
   :381)。这个位置是正当的——冻结形状之上的类型化面——但新行仍要在同
   一变更里在此加导出。

R3 面批次实测了这种步调的成本:每个宿主批次按 M 计,主要因为三个宿主各自
手工重声明共享事实("renderer + legs",
`contract/proposals/2026-11-12-native-face-schemas.md:279-283`(三个宿主
批次)、:371-377(计行 "M per host batch (renderer + legs), L across the
program"))。

提案:**冻结网关之上的自描述描述符平面**——Linux 上 `/proc/devices`(运行
中内核实际有什么)与 uAPI 头文件(用户态可以对什么钉住)的分工。一个词汇
表成为运行时 TRUTH,从已存在的代码推导;另一个保持 owner 把关的稳定性合
同。上述七个位置塌缩成两个写入者:注册点(原生代码里,一次)与合同折叠
(owner,一次)。

## 设计

### 1. 两个词汇表,故意的

- **RuntimeDescriptor 成为运行时 TRUTH。** 今天它是每个 pre-eval 点手工
   拼出来的两个平面数组(`available`/`unavailable`;
   `GatewaySession.swift:354-359`、`BindingHost.kt:52-57`、
   `HostPhase.ets:143-154`)。提案让每个条目自描述:行携带 `name`、它所
   讲冻结形状的 `schemaVersion`、审计类别(§6 的每调用记录;
   audited-never-settled 的控制面如 `httpFetch.abort`——
   `GatewayCore.swift:306-310`;宿主发起的记录如 `socket.accept`——
   `gateway-audit-invariant.js:199`),以及权限旗标(或没有——见下面
   `deviceInfo` 先例)。每个字段必须可从 boot 注册事实 DERIVE,不得是
   手工编写的散文。描述符天然按宿主而异,且永远不被编辑——只被构建。
- **`primitives.md` 保持稳定性合同。** Owner 把关、按 §8 折叠,它仍是
   插件 PIN 的对象:manifest 的 `capabilities.required` 点名的形状、§3
   冻结的错误码、§6 强制的审计姿态。两个词汇表回答不同的问题——描述符
   回答"这个宿主现在服务什么",合同回答"跨宿主跨时间我可以依赖什么"。
   插件**对着描述符协商;对着合同钉住**。谁也不吸收谁的职责。

### 2. boot 自注册已经存在——描述符只是不再对它撒谎

原生 handler 本来就在 boot 时注册进派发表:iOS 核是 "dispatch table
name→handler"(`GatewayCore.swift:117-122`),`register(name:_:)` 是唯一
入口(:183-185),`registerStandardPrimitives` 是每个完整座位保持与手工
清单一致的唯一 boot 调用(:150-167);Android 的 `register` 在
`GatewayCore.kt:152`。唯一没有从注册推导出来的就是描述符——这正是每个
宿主都要写一条命令自己保持一致的注释的原因(`GatewayCore.swift:124-126`、
`HostPhase.ets:141-142`、`gateway_smoke.cpp:81-82`)。变更只有一步:
**注册完成时从注册表构建描述符**,删掉手工清单。harmony parity 门的四
个面塌缩成一个——构建出的描述符就是被服务的面,门停止比较副本,开始比
较构建结果与转发/派发现实(它已经会做的检查,
`check-descriptor-parity.mjs:103-183`)。

### 3. `describe` 原语——唯一的新词汇行

一条可加原语在运行时暴露枚举:`describe`(一个名字的行)与
`describeAll`(整张表)。只有元数据——名字、版本、审计类别、权限旗标;
绝无 payload 内容,绝无调用方未持旗标文法的能力。协商类先例是
`deviceInfo`:冻结表以无权限旗标承载它(`primitives.md:205`,`—` 单元),
iOS handler 服务只读事实、无同意面
(`hosts/ios/App/Source/Gateway/DevicePlanePrimitives.swift:5-6`、:18、
:26-40)——关于设备的元数据,不是对设备的权力。`describe` 是同一姿态指
向网关自身;它自己的调用照 §6 照常审计。

**诚实缺席即采纳路径**(§7 #1 已经写下的法则:"declares an absent
primitive `unavailable` honestly in its `RuntimeDescriptor` — absence is
information for negotiation, never faked",`primitives.md:683-685`):未
采纳 `describe` 的宿主对它答 `unavailable`,看到 `unavailable` 的调用方
回落到冻结表作为枚举词汇——是协商,不是分支。

**版本号冲突,提前处置。** 下一个可加 minor 是争议地段:
`contract/proposals/2026-11-11-gateway-primitive-slimming.md` 声称
v1.12.0 并对 `net-fd-wrap` 的在途候选记录了单调折叠次序规则(:167-180;
候选标题在 `contract/proposals/2026-10-19-net-fd-wrap.md:1`,它自己的
next-free 规则在 :270-276;惯例本身是 v1.9.0 注,
`primitives.md:76-79`)。本提案现在不认领任何号:**在它自己的采纳时点按
同一规则取下一个空闲号**——若当前处置保持(slimming v1.12.0、
net-fd-wrap v1.13.0)则为 v1.14.0,若跑道次序不同则按单调折叠次序重排。

### 4. 派生普查——manifest 不再钉数字

25 份 manifest 的 `descriptor.declared` 钉变为检查器验证的结构性不变式
而不是字面计数:检查器读运行时实际声明的描述符(审计腿已经在做的
`__dshGatewayDescriptor` 读,`gateway-audit-invariant.js:267-272`),断
言真正要紧的性质——审计配对完整性(下)、available/unavailable 不相交、
无幻影行(描述符里有而没有任何被服务面回答的名字)、只有场景真正关于某
平面时才看平面尺寸(BLE 腿的 `blePlane: 8`)。这就是 `doc/e2e-matrix.md`
停止手工维护表格时已经记录的哲学:"the three tables below are
regenerated from `node test/e2e/matrix.mjs --out` (the machine inventory),
closing the doc-drift class this page had accrued"
(`doc/e2e-matrix.md:9-11`;`test/e2e/matrix.mjs:3-6`)。钉住的计数是产出
它的代码树的回执,不是合同;重新生成胜过重新钉。

### 5. 结构化审计配对——不变式泛化

`gateway.audit-invariant` 自身的设计已经是配对行走而非形状检查:"The
ledger is the call half of the pairing; the host's audit stream … is the
record half. … fails naming any call whose paired record is missing, any
record with no call, any order violation, and any payload bytes inside a
record"(`gateway-audit-invariant.js:10-16`,账本在 :50-61)。提案泛化其
输入:检查器从描述符推导单元集——**每个已注册 handler 必须有一条配对的
审计记录**——而腿保持它已执行的三态矩阵(ok / 一个 §3 拒绝 / 诚实
`unavailable`)作为每行覆盖标准。新行靠存在加入不变式,而不是靠被加进
两份清单。

## 边界(不可协商)

- **总线就是特权层。** 描述符平面由合同冻结的那同一个 host-fixed 网关
  服务——"host-fixed, never a plugin. It is the only door between the JS
  runtime and the platform"(`primitives.md:140-141`,架构图行
  `doc/ARCHITECTURE.md:33`)。它永远不是 system 插件、永远不可市场安装:
  市场的 ed25519 目录签名是插件平面的信任根("The signature is the
  trust",`data-protocols.md:163`)——把描述符权威挪到它后面等于把 OS
  边界塞进分发平面。姿态即 Linux lockdown:设备表随签名内核镜像发布;
  签名模块只在强制下加载。这里的 driver = 编进 store 签名宿主二进制的
  handler,仅此而已。
- **每个冻结形状逐字节不动(D5)。** §2 的 33 行、§3 错误码、§5 通道、
  §6 审计记录——全部不碰。`describe` 作为新行加入;描述符文法作为合同
  文档的新节折叠;现存的一切不动。
- **安全承载的校验留在网关**——派发前的权限旗标检查与 §6 审计记录
  (瘦身轮的边界规则,
  `2026-11-11-gateway-primitive-slimming.md:184-188`;§6 的 "Audit is
  mandatory and host-fixed",`primitives.md:675-677`)。`describe` 不带
  走任何校验;它报告校验器已经在执行的东西。
- **两层同意不变**——网关授权在前、OS 权限在后,互不替代
  (`2026-09-30-system-capability-plane.md:49-55`)。描述符行指名旗标;
  它不授予任何东西。

## 非目标

- **不改任何冻结形状**(D5):不改行、不改结果、不改错误码;折叠只可加。
- **不做运行时可下载 driver**:不动态加载 handler、不描述符编写能力、
  不插件提供行——注册点就是 store 签名二进制里的原生代码。
- **不削弱权限或审计**:没有任何东西搬出 §6;审计不变式腿变得更强(派生
  覆盖),绝不更松。
- **不做 `hostType` 分支**(RFC 0002):宿主服务哪些行是描述符里的能力
  协商数据——瘦身轮已把这种每宿主服务真相归类为协商,绝非平台条件
  (`doc/ARCHITECTURE.md:158`、`primitives.md:134-136`)。
- **不扩展 cordis 平面**:总线不是插件 API;§备选记录了插件平面为何承
  载不了它。

## 备选考虑

- **扩展 vendored cordis 充当总线**——否决:信任根不能住在插件平面。
  system 插件本来就是 cordis 插件——运行时引导 vendored
  `@deepseek-ai/cordis` Context(`runtime/dsh/upstream/boot.js:27`,钉在
  `runtime/dsh/vendor/npm/cordis@4.0.2`),每个 provider 面都是网关之上
  的 cordis 服务(`runtime/dsh/system-plugins/dsh-fs/cordis.js:2`)。
  插件可扩展的描述符平面会让可枚举面在合同的克制规则之下生长,而 D6
  禁止为试错而改 vendored 包。网关之所以是信任边界,正是因为它下面没有
  任何东西可加载。
- **单一词汇表——让描述符取代冻结表**——否决:冻结正是插件钉住的对象;
  §8 的克制规则("Restraint is the point of a narrow table",
  `primitives.md:717-718`)与 §7 符合性定义是合同文档属性,不是运行时
  属性。运行时推导的表无法为 major version 1 的一生冻结一个形状——这
  不是运行中的系统能承诺的东西。两个诚实推导的词汇表,胜过一个假装两者
  兼是的词汇表。
- **维持现状(保留七位置步调)**——否决:成本是实测的,不是假设的。
  harmony 孪生需要一道专用 parity 门,其缓冲检查抓住了差一行就砖死的
  擦边(`check-descriptor-parity.mjs:203-207`);R3 面批次按每宿主 M 计,
  很大程度上因为三个宿主手工重声明共享事实
  (`2026-11-12-native-face-schemas.md:371-377`);且每加一个能力都会让
  25 份 manifest 加两份审计清单变红,直到人手重钉(§动机 5-6)。

## 证据

以下引用均为本座位在 docs/capability-bus-draft 切点(`d3375af4`)新读:

- 冻结合同:`contract/primitives.md`——v1.11.0 标题(:1)、冻结姿态
  (:3-4)、单调折叠惯例(:76-79)、协商/无分支框架(:131-136)、§1
  "host-fixed, never a plugin"(:138-141)、§2 的 33 行(:153-253)与
  `deviceInfo` 无旗标行(:205)、§6 审计(:669-677)、§7 符合性与诚实缺席
  法则(:679-697,#1 在 :683-685)、§8 版本化与克制(:701-718)。
- 手工维护的服务清单与其同步指令:`hosts/ios/App/Source/Gateway/`
  `GatewayCore.swift:117-185`(类文档、要求一致的注释 :123-129、37 名
  清单 :130-143、`phasedRows` :144-147、`registerStandardPrimitives`
  :150-167、`register` :183-185)与 abort 控制面 :306-310;
  `hosts/android/app/src/main/java/com/dshmobile/host/GatewayCore.kt:23-51`
  (PRIMITIVES/PHASED_ROWS/RETIRED_ROWS)与 `register` :152;Android 六个
  描述符 pre-eval 点(`BindingHost.kt:52-57`、`SessionServe.kt:318`、
  `SessionPersistRestartSession.kt:55`、`SessionLiveSession.kt:51`、
  `SessionWriteSession.kt:50`、`OfficialWebSession.kt:61`);iOS pre-eval
  (`GatewaySession.swift:351-359`);harmony 孪生(`HostPhase.ets:136-154`、
  `gateway_smoke.cpp:70-94`)。
- 只因清单是手工副本才存在的 parity 门:
  `tools/check-descriptor-parity.mjs:4-19`(四个面与其执行的 §7 #1 规则)、
  :89-93(描述符差异检测器)、:103-183(转发/派发/known-absent 交叉检
  查)、:203-207(511/512 固定缓冲发现),以 `descriptor-parity` 门接线
  (`gates.json:237-252`)。
- 普查钉:`test/e2e/scenarios/` 下 25 份 manifest 带字面计数的
  `descriptor.declared` match——计数经目录 grep 验证;具名样例及其钉:
  `android-capability-binding.json:20-25`(36/3)、
  `harmony-capability-binding.json:34-38`(33/9)、
  `gateway-binding.json:14-18`(37/2)、`device-plane.json:14-18`(37/2)、
  `ios-ble.json:14-18`(35/2 + blePlane 8)、`ios-ble-denied.json:14-18`
  (33/2 + 8)、`harmony-ble.json:14-18`(30/9 + 8)、
  `camera-plane-capture.json:14-18`(33/0 + 8)、
  `android-ble-absent.json:14-18`(34/3 + 8)。
- 审计不变式配对设计与手工枚举单元:
  `runtime/dsh/scenario/gateway-audit-invariant.js:2-16`(配对合同)、
  :50-61(账本)、:99-283(四象限 59 单元)、:267-272(运行时描述符读);
  `test/e2e/scenarios/gateway-audit-invariant.json:9`(13/9 描述符钉)、
  :10-69(59 条字面探测行)、:70(`calls: 59`)。
- 类型化垫片:`runtime/dsh/gateway.js:2-5`(每原语一导出的头部声明)、
  代表性导出 `fsRead` :61、`httpFetch` :176、`deviceInfo` :228、相机三件
  :297-315、BLE 家族 :317-349、`micStart`/`micStop` :366-381。
- 重新生成而非手工维护的先例:`doc/e2e-matrix.md:9-11`、
  `test/e2e/matrix.mjs:3-6`。
- 本提案处置进入的版本冲突记录:
  `2026-11-11-gateway-primitive-slimming.md:167-180`(规则与 v1.12.0 声
  称)、`2026-10-19-net-fd-wrap.md:1` 与 :270-276(候选与 next-free 规
  则)、`primitives.md:76-79`(惯例)。
- 边界锚点:`primitives.md:138-141` 与 `doc/ARCHITECTURE.md:33`
  (host-fixed, never a plugin)、`data-protocols.md:163`(市场签名即信任)、
  `2026-09-30-system-capability-plane.md:49-55`(两层同意)、
  `doc/ARCHITECTURE.md:158` 与 `primitives.md:134-136`(RFC 0002 反模式
  禁令)、瘦身轮的安全留在网关规则
  (`2026-11-11-gateway-primitive-slimming.md:184-188`),以及插件平面的
  cordis 身份(`runtime/dsh/upstream/boot.js:27`、
  `runtime/dsh/vendor/npm/cordis@4.0.2`、
  `runtime/dsh/system-plugins/dsh-fs/cordis.js:2`)。
- 步调成本先例:R3 三个宿主批次及其计行
  (`2026-11-12-native-face-schemas.md:279-283`、:371-377)。

## 体量

提案折叠本身为 S:`describe`/`describeAll` 行 + 合同文档的描述符文法节 +
contract README 指针,一个 PR。实现骑在已有机制上——boot 注册
(`GatewayCore.swift:150-167`、`GatewayCore.kt:152`)、既有的配对行走
(`gateway-audit-invariant.js:10-16`)、parity 门的检测器集
(`check-descriptor-parity.mjs:103-183`)——所以迁移是:注册时构建描述符
(跨三宿主 M,每处主要是删手工清单)、describe handler(每宿主 S,共享
形状)、manifest 普查翻转(S——检查器模式 + 移除重钉)、审计不变式派生
(M——检查器长出描述符驱动的单元集)。全程不改任何冻结形状、权限检查、
审计记录。
