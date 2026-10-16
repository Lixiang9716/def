# dsh-mobile

[English](README.md) | 简体中文

**先在浏览器里看：**[项目主页](https://lixiang9716.github.io/dsh-mobile/)——是什么与为什么、
能力卡片，以及真实 Lynx 渲染面客户端的实时呈现（静态壳，无会话）。

## 这是什么？

dsh-mobile 是 DSH（DeepSeek Harness）生态的**移动宿主**：把上游 DSH agent——桌面端的
Harness 运行时——完整搬上手机，覆盖三个移动平台（Android、iOS、HarmonyOS）。一切都发生在
设备本地：单线程 QuickJS 运行时在进程内承载 Harness 核心，能力网关把每个操作系统的原生服务
收拢到一份狭窄的原语契约之后，UI 是可插拔的 Web Client 而非写死的界面。进程内 shell、插件
市场、真实 LLM 会话、乃至 agent 驱动的插件创作——全部本地完成，没有云端中继。

**为什么存在。** 手机上没有供 agent 立足的 Linux shell 生态，桌面 agent 也无法直接安装到
手机上。基于社区 Fabric 互操作模型，dsh-mobile 证明了一条同构移植路线：上游包在 QuickJS 上
**原样**运行（pin + sha256 校验，绝不改动 vendored 副本），一切平台差异都表达为对冻结契约的
能力协商——一份核心，三个宿主。

> 社区独立项目，非 DeepSeek 官方产品。上游生态参考
> [anywhere-labs/dsh-desktop](https://github.com/anywhere-labs/dsh-desktop) 与 DSH
> Community Fabric 草案。

## 现状速览

下面每一行都有仓内证据背书——回执位于 `hosts/*/artifacts/` 与 `runtime/dsh/artifacts/`，
汇总在 [doc/e2e-matrix.md](doc/e2e-matrix.md)：

- **三个宿主的应用内 agent 会话**——交互席经回环 carrier 服务官方 Web Client；composer
  一句话发起提示，token 增量流式渲染、工具执行、工具卡呈现，并落盘持久会话日志
  （`hosts/{ios,android,harmony}/artifacts/shell-turn/`，全部 pass）。
- **真正的应用内 shell**——`dsh-shell-js`，一个三宿主共用的 bash 子集执行器（管道、重定向、
  coreutils 表面）架在冻结的 fs 原语上；如实声明这是 shell 模拟——无内核身份、无 ELF 执行、
  无包管理器（#457；CLI 腿 35/35，`runtime/dsh/artifacts/macos-cli-dsh-shell-js/`）。
  它在 Linux CI 上被一份对照真实 bash 的差分契约约束着
  （`runtime/dsh/artifacts/shell-diff/`，#540）。
- **创建模式**——一句话变成一个真插件：agent 写出插件包、你批准、热挂载、卡片实时渲染
  （`create.card` 三宿主回执，`hosts/{ios,android,harmony}/artifacts/create-card/`）；
  凭暂存或 BYOK 凭据时，创作回合打真实 LLM。
- **三宿主的真实 LLM 流式**——`llm.live-stream` 腿对 OpenAI 兼容后端，逐字记录服务端报告的
  模型名，并对每条日志行断言 API 密钥零泄漏（`hosts/{ios,android,harmony}/artifacts/`）；
  敌意线缆 chaos 腿进一步锤炼传输层——畸形 SSE、截断、超限增量——可重试与致命的裁决逐条
  断言（`runtime/dsh/artifacts/macos-cli-llm-chaos/`，#528）。
- **插件市场**——签名目录（ed25519）经同一条验证 + receipt 提交的安装流水线安装
  （`runtime/dsh/artifacts/macos-cli-marketplace-install/`）。
- **BYOK**——你的密钥存放在宿主 keychain；多协议家族（OpenAI 兼容 + anthropic-messages）
  拨打用户声明的端点（#467，`runtime/dsh/artifacts/macos-cli-byok-piai-anthropic/`）。
- **会话扛住重启**——force-stop 之后日志重载、会话续聊
  （`hosts/{ios,android,harmony}/artifacts/session-persist-restart/`）；一条压力腿在单
  spine 上并发驱动四个会话，并逐一独立恢复
  （`runtime/dsh/artifacts/macos-cli-session-multi-stress/`，#543）。
- **UI 即插件**——整客户端替换与组件 slot 均在设备端验证（`ui.client-swap` 7/7），另有
  Lynx 渲染面客户端试点第二张脸。

诚实边界：没有任何宿主提供真实子进程或 Linux userland（iSH 实验已于 2026-10 退场——见下方
证据表）；模拟器没有电台，相机 / 麦克风 / BLE 按宿主如实协商，该能力面的鸿蒙腿等待真机回执；
后台驻留是 checkpoint/resume，不是桌面级常驻。

## Quickstart

```sh
git clone https://github.com/Lixiang9716/dsh-mobile
cd dsh-mobile
build/build.sh --list          # 各平台及其工具链需求
build/build.sh android         # sync → compile → 模拟器上的日志验证 e2e
```

- 一份门面驱动所有平台："build" 永远是 **sync → compile → test**——与该平台 CI 完全相同的
  三步。iOS 只能在 macOS 上编译；工具链缺失时响亮失败，点名缺什么、去哪装。
- 手头没有移动端工具链？core CLI 是最便宜的验证载体：`build/build.sh compile core` 构建出
  各平台内嵌的那个 C 宿主。完全没有工具链？[项目主页](https://lixiang9716.github.io/dsh-mobile/)
  在浏览器里展示客户端面孔。
- 在对应模拟器/仿真器上启动构建出的应用，它会进入交互席——官方 Web Client 由回环 carrier
  服务。

完整门面（CMake 层、closures 门禁、模拟器矩阵）：[BUILD.md](BUILD.md)。运行出问题时：
[doc/troubleshooting.md](doc/troubleshooting.md)。

## 架构一屏

五层，每层一句话：

1. **Presentation**——UI 是 Web Client 插件，经回环 HTTP/WS carrier 渲染在系统 WebView 里；
   宿主不写死任何 UI。
2. **Harness 核心**——上游 DSH 运行时在单线程 QuickJS 协程引擎上原样运行（仅一条串行 JS
   线程；子进程语义在进程内重新实现）。
3. **系统实现插件**——JS 插件把网关原语组合成上游服务契约（fs、subprocess、shell、凭据……）。
4. **能力网关**——一份狭窄、版本化的原语表，带能力检查、权限旗标与审计日志；宿主固定，
   永远不是插件。
5. **特权层**——薄薄一层原生壳（Swift / Kotlin+NDK / ArkTS+NAPI），持有 entitlements、
   keychain、选择器、通知。

平台差异是能力协商，永远不是 `hostType` 分支。完整设计：
[doc/ARCHITECTURE.md](doc/ARCHITECTURE.md)；全流程端到端（启动、网关调用、LLM 流式、安装、
验证机制本身）：[doc/sequence-diagrams.zh.md](doc/sequence-diagrams.zh.md)。

## 项目状态与证据

下表是**逐里程碑的验收证据索引**——本仓库就是这样为状态断言举证的（状态翻转与赚到它的工作
同 PR 落地）。初次到访的读者，面向人的概括是上方的["现状速览"](#现状速览)；这张表供审计用。
场景 id 与 artifact 路径有意原样引用——它们引用的是磁盘上的记录。

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| 契约冻结 | 原语契约 v0 + 数据协议三件套（bundle 布局 / manifest / receipt） | 已完成（冻结于 v1.0.0；经可加性扩展——primitives v1.8.0 socket 缝，data-protocols v1.1.0 §7 插件市场背后的签名目录） |
| 运行时与宿主 dsh | Dsh：quickjs-ng 垫层跑通纯逻辑包 + iOS 宿主骨架 + 本机 carrier | 已完成（运行时 dsh 已在 iOS/Android/鸿蒙 + macOS 验证；本机 carrier——回环静态文件 + WS↔QuickJS 泵——已在 iOS 模拟器验证） |
| 首个真机会话 | 系统实现插件（fs/subprocess/ui）+ Web Client 挂载 + 首个设备端会话 + 真实 LLM API | 完成（系统插件 + Web Client 挂载 + 首个设备端会话：`dsh-fs`/`dsh-subprocess-quickjs`/`dsh-ui` 插件，`session.mock-llm` 在 CLI 与设备端均 23/23 通过，Web Client `dsh-web-client` 经 carrier WS 挂载并实时渲染 —— 证据见 `runtime/dsh/artifacts/macos-cli-m2-session/` 与 `hosts/ios/artifacts/m2-session/`；真实 LLM API 已随场景 `llm.live-stream` 交付：经网关 `httpFetch` 形态的 OpenAI 兼容流式客户端（`runtime/dsh/llm.js`），由 RuntimeDescriptor 协商执行腿 —— CLI 脚本化 SSE 腿 `llm.live-stream` 19/19（`runtime/dsh/artifacts/macos-cli-m2-llm/`），iOS 模拟器与 Android 模拟器上的真实 z.ai 流式（`hosts/ios/artifacts/m2-llm/`、`hosts/android/artifacts/m2-llm/`），reasoning+content 增量按事件序列流出、逐字记录服务端报告的模型名、并对每条日志行断言 API 密钥零泄漏（泄漏即响亮失败）） |
| 插件系统 | 插件安装链路 + UI 插件化（三级 UI 插件、能力协商） | 完成（安装 = 冻结 fs 原语上的 receipt 事务 —— `install.verified-tarball` 在 CLI 22/22：内容寻址 blob、信任记录校验、严格 manifest 校验、对照 RuntimeDescriptor 的安装期能力协商、暂存树读回校验、receipt 提交、被篡改的包在解包前被拒绝；基于 FETCH 的安装器把 httpFetch 流式 body 送入同一条流水线 —— CLI 用带日志的桩 `install.full-cycle` 41/41（`runtime/dsh/artifacts/macos-cli-m3-complete/`），设备端直接对回环 carrier 本身用真实 `httpFetch` `install.from-http` 46/46 + carrier 证据 `install.carrier-evidence` 11/11（`hosts/ios/artifacts/m3-complete/`），并包含 append-only receipt 日志上的 pending-receipt 启动重放（暂存树可验证 → 提交；暂存不完整 → 回滚且已安装树不动）；三级 UI 插件均在设备端验证 —— 配置层（`cordis.patch` 分层覆盖）选择活动 Web Client 并覆盖工具栏 slot 集合，另有整客户端替换与组件 slot（`ui.client-swap` 7/7，`hosts/ios/artifacts/m3-pluginization/`）；回归 `session.mock-llm` CLI + 设备端 23/23，`run-ios.sh` 4/4） |
| Android 宿主 | Android 宿主（QuickJS 同构） | 完成（完成会话 `android.capability-binding` 在模拟器 35/35 全绿：回环 carrier 将内嵌的 Web Client 装载进真实 WebView 并实时渲染会话；九原语网关真实绑定——描述符 9 可用 / 0 不可用，强制审计经 `gateway.audit` 16/16 复核；三场景回归同跑保持全绿——证据 `hosts/android/artifacts/m4-complete/`；同一真实 httpFetch 绑定亦在模拟器上驱动真实 LLM 流式会话 `llm.live-stream` —— `llm.live-stream` 设备端 期望 14 / 实记 171 + carrier 7/7，证据 `hosts/android/artifacts/m2-llm/`） |
| 鸿蒙宿主 | 鸿蒙宿主（ArkTS + NAPI） | 完成（同构宿主已验证：回环载体——向 Web Client 提供静态文件服务 + RFC 6455 WS 泵——ArkWeb 挂载实时会话；九项契约原语全部在模拟器上真实可用，描述符 9 可用 / 0 不可用：notify、presentApproval、fsScope、HUKS 封装的 keychain（AES-256-GCM；set → get 字节一致，set null 即删除）、基于 DocumentViewPicker 的 presentPicker（取消 → null；授权 → 用户作用域并完成 fsScope persist/resolve 与内容一致读回；用户作用域面为只读，与 Android 孪生端一致）、对宿主自身回环载体的流式 httpFetch（body 在响应头即 settle，随后按块事件流出、绝非整块返回；体中 abort → `cancelled`）——`harmony.capability-binding` 27/27 加上 `boot.verification`/`gateway.bridge-smoke`/`session.mock-llm`（23/23）回归一次启动全绿——证据见 `hosts/harmony/artifacts/m5-host/` 与 `hosts/harmony/artifacts/m5-primitives/`；本宿主的 `llm.live-stream` 真实 LLM 腿同样已接通——由启动参数 `aa start … --ps dsh.e2e.leg llm.live-stream` 选中（该腿单独运行，默认链路因此不消耗任何推理配额），运行未改动的 `runtime/dsh/scenario/llm-live-stream.js`，经同一条 httpFetch 绑定协商出真实腿，并实现本平台强制的凭据交接（运行时写入 0666 占位文件 → 运行脚本 `hdc file send` 覆盖 → 应用导入、如实报告封存状态、运行结束即删除），载体挂载链（`client.selected` → `webclient.mounted` → `ws.connected` → `slot.registered`）已在模拟器上验证；其传输往返已端到端证实——请求经本宿主 httpFetch 离开设备并有真实后端应答——且配额重置后该腿重跑转绿：真实推理回合已可宣称（`llm.live-stream` 14/130 + `llm.live-stream.carrier` 7/7，证据 `hosts/harmony/artifacts/m5-llm-live-stream/`，产出 2026-09-28，原始日志的密钥泄漏审计干净）） |
| 渲染面客户端（Lynx 试点） | `presentation/lynx-client/` —— 一个可整体替换的渲染面**客户端插件**（不是 system-plugin）：ReactLynx bundle（纯表现）+ 宿主侧 driver，架在 `RenderSurfaceClient` 缝（mount / pushViewEvent / onIntent / teardown）上；主题 token 单源同时生成 web CSS 变量与 Lynx 样式常量 | Done（试点构建 + 验收：rspeedy bundle（149.6 kB）已入库并在挂载时做 sha256 校验；`lynx.mount` CLI 腿跑完整 mock-LLM driver 环路——提交 → 流式增量 → 工具卡三态 → 收拢输出 + 创作卡 → 中途重进 seed 重建 → 乐观取消 → fail-loud 腿——两条皮肤在同一流上各 34/34，即可替换性证明，证据在 `presentation/lynx-client/artifacts/cli-lynx-mount-{lynx,stub}/`；vitest 缝契约套件 36/36；bundle 在 @lynx-js/web-core 平台的 headless Chrome 上真实渲染（人看截图在 gitignored 的 `artifacts/screens/`）；真机像素留给 LynxExplorer/真机轮） |
| 设备面（契约 v1.5.0） | 宿主平台 SDK 表面：`deviceInfo` / `haptic` / `clipboardRead`+`clipboardWrite` / `presentShare` / `keepAwake` + `presentPicker` `mode:"media"` | 已完成（一份平台中立场景 `device.plane` 逐宿主在真实特权层上驱动——描述符 iOS 22 可用 / Android 23 / 鸿蒙 15，剪贴板审批梯（Approve → Approve & Remember → 常设授权）、分享面板经 Copy 完成、keepAwake 闩锁、多媒体选择器对用户所选项授予读穿透作用域；模拟器失效的剪贴板服务如实拒绝 `unavailable`，审批梯照常运行；凭据 `hosts/{ios,android,harmony}/artifacts/device-plane/`；运行器 `test/e2e/run-ios-device-plane.sh`、`hosts/android/ci/run-device-plane.sh`、`hosts/harmony/ci/run-device-plane.sh`） |
| 模拟器矩阵 | 发布级证据网：每宿主一条命令（`tools/test/run-simulator-matrix.sh`）证明 flavor 切分的两半——Release 构建直接启动、零 drive 编排、零 debug/info 日志记录、并按名拒绝 drive；既有 e2e 运行器原样再驱动 Debug harness | 已完成（iOS `simulator-matrix/release/release-proof.json`（缺席 + 拒绝证明）+ `simulator-matrix/gateway-drive`：`boot.verification` 8/8、`carrier.loopback` 7/7、`gateway.audit` 16/16、`gateway.binding` 19/19，另 `simulator-matrix/device-plane` 16/16 + 审计；Android `simulator-matrix/release/release-proof.json` + `simulator-matrix/regression`：`boot.verification` 8/8、`gateway.bridge-smoke` 6/6、`session.mock-llm` 23/23，另 `simulator-matrix/device-plane` 15/15 + 审计；凭据仅在绿路径由机器写入；鸿蒙：无 DevEco/hdc 目标时出具诚实 skip 凭据 `matrix-skip-receipt.json`（D-g 待命）；证据 `hosts/{ios,android,harmony}/artifacts/simulator-matrix/`；有意不接入门禁 DAG——发布仪式） |
| 系统能力面（契约 v1.10.0 candidate） | 相机、麦克风、BLE 置于同一 OS 权限同意模型之下——先调用方 manifest 的 grant 家族旗标（gateway 层），后 OS 权限，拒绝按层审计；每面一份平台中立场景逐宿主驱动（提案 `contract/proposals/2026-09-30-system-capability-plane.md`，#249；三个面 #252 / #255 / #254） | iOS + Android 已完成（相机 `camera.plane` iOS 6/6 + 审计——模拟器如实回答 capture-unavailable——Android 8/8 + 审计且模拟器虚拟相机真实出片（2 帧 / 44157 字节 / 457 ms）加 maxBytes 丢弃腿；麦克风 `mic.plane` iOS 11/11 / Android 9/9——武装梯带真实 PCM 帧、stop 记录的时长/字节、exactly-once 收尾、幂等；BLE 每宿主 `ble.plane` 16/16（确定性 mock 电台）+ 8/8（如实电台缺席）——没有一台模拟器有可用电台，mock 与真实电台共用同一套 gateway 强制、同意层与审计，真机腿走 D-g 一键契约；证据 `hosts/{ios,android}/artifacts/{camera-plane,mic-plane,ble-mock,ble-skip}/`；鸿蒙三面已实现，凭据等真机——D-g 脚本备好，不合成任何证据） |
| 应用内 shell（`dsh-shell-js`） | 一个 JS shell 服务三宿主：bash 子集执行器（管道、重定向、coreutils 表面）架在冻结的 fs 原语上——进程内、无内核身份、无 ELF 执行、无包管理器；如实声明这是 shell 模拟（ARCHITECTURE.md §12） | 完成（CLI 腿 `dsh-shell-js` 35/35，随行 pin 好的 33 包 parser 闭包——`runtime/dsh/artifacts/macos-cli-dsh-shell-js/`，#457；随后是设备端 shell 回合——经交互席 composer 线路的真实提示驱动 shell 工具、官方 UI 渲染工具卡、执行器的 fsWrite 在容器磁盘上逐字节落定——三宿主 pass 回执 `hosts/{ios,android,harmony}/artifacts/shell-turn/`，#491/#492） |
| iSH userland 退场 | 契约 v1.3.0 的 `ishRun` 模拟 Linux userland（iSH-arm64 引擎，D16）离开仓库——引擎、guest userland、缝、最后一个宿主实现全部移除；冻结的契约条目保留（D5：major v1 存续期内形态不可变），因此每个宿主都以契约如实的 `unavailable` 应答 `ishRun`，且没有描述符将其列为可用 | 完成（三个 PR：`dsh-shell-ish` JS 面及其场景家族与市场挂 listing #496、iOS 宿主面 #497、引擎与 CI 逃生门 #498；退场附录见 [doc/decisions.md](doc/decisions.md)；GPL-3.0 分发问题与"guest 在审计边界之外"的披露随 guest 一并消失） |
| 鸿蒙矩阵腿转真 | 有 hdc 目标在线时，`tools/test/run-simulator-matrix.sh --platform harmony` 跑真腿——harness 阶梯（`run-host-e2e.sh`：8/8 verdict + 绿路径回执）与 release 腿（release HAP 朴素启动即服务官方 UI，在 socket 层证明——经 `hdc fport` 探测 serve 的 LISTEN；零 drive 编排记录；按名拒绝 drive）——无在线目标的机器仍出具诚实 skip 回执 | 完成（2026-10-12，#475，dsh_phone 仿真器；证据 `hosts/harmony/artifacts/simulator-matrix/{harness,release}/` 含 `release-proof.json`；首批真跑清出了腿死亡期间无人能看见的四处置钉漂移） |
| 测试加固计划 | 一份 20 行加固计划（[doc/test-coverage.md](doc/test-coverage.md)）：敌意线缆 chaos + 畸形工具参数腿、把 `dsh-shell-js` 按方言契约对照真实 bash 的差分 harness、运行时解析器的 property 套件、日志 schema 迁移测试、ASan/UBSan + clang-tidy/detekt CI 腿、vendored 闭包的供应链审计、安装 zip-slip 钉、多会话压力 | 完成——20 行中 12 行已落地（逐行状态以文档为准）：chaos 画像 #528（`runtime/dsh/artifacts/macos-cli-llm-chaos/`）、sanitizer #526、axe 无障碍 + 视觉 diff #527、bash 差分 `runtime/dsh/artifacts/shell-diff/` #540、fast-check property 套件 #541、日志迁移 #538、静态分析 #536、供应链审计 #535、安装路径穿越钉 #539、toolargs chaos #542（`runtime/dsh/artifacts/macos-cli-llm-toolargs/`）、多会话压力 #543（`runtime/dsh/artifacts/macos-cli-session-multi-stress/`） |

### 上游移植（D9）

上表记录各里程碑以自身证据证明的内容。自决策 [D9](doc/decisions.md) 起，Harness 层本身
不再是自研重实现：上游 DSH 运行时在 quickjs 上**原样**运行——26 个包由
`external/ensure-dsh.sh` pin 并做 sha256 校验（21 个上游 DSH 包
@ 0.1.6-alpha.2 + 5 个 pinned npm 依赖），自研代码只留胶水（垫层、适配器、契约 carrier）。
经 carrier 在 iOS / Android / 鸿蒙上已点亮：官方 client-modules web 启动、官方 App 壳
（#61 的 58 包 application 层）、真实 `session.list`/日志，以及 composer 写入路径。汇总
数字与逐目录清单见 [doc/e2e-matrix.md](doc/e2e-matrix.md)——本树 127 个证据目录、246 条绿色
verdict（2026-10-16 checker 实跑）——位于 `hosts/{ios,android,harmony}/artifacts/`（`b1-official-web`、
`session-live-read`、`composer-live-write`、`android-upstream`、`android-session-live`、
`d9-official-web`、`d9-session-live`、`d9-write-live`）。

## 文档地图

| 当你想…… | 读 |
| --- | --- |
| 理解分层设计与决策依据（D0–D18） | [doc/ARCHITECTURE.zh.md](doc/ARCHITECTURE.zh.md) |
| 端到端看任一流程——启动、网关调用、LLM 流式、安装 | [doc/sequence-diagrams.zh.md](doc/sequence-diagrams.zh.md) |
| 构建某个宿主，或排查构建问题 | [BUILD.zh.md](BUILD.zh.md) |
| 为本宿主写插件 | [doc/plugin-dev.zh.md](doc/plugin-dev.zh.md) |
| 把桌面 DSH 插件移植过来 | [doc/dsh-desktop-plugins.zh.md](doc/dsh-desktop-plugins.zh.md) |
| 核对某条断言背后的证据 | [doc/e2e-matrix.zh.md](doc/e2e-matrix.zh.md) |
| 排查一次出问题的运行 | [doc/troubleshooting.zh.md](doc/troubleshooting.zh.md) |
| 切一个版本化发布 | [doc/release.zh.md](doc/release.zh.md) |
| 提议改动某个已定决策 | [doc/decisions.md](doc/decisions.md)——先读它 |

## 治理

本仓库由 [govrail](https://github.com/Lixiang9716/govrail) 门禁管理：pre-commit 内容门、
推送前 `gov run` 门 DAG、CI 强制（`.github/workflows/gov.yml`），并采用其 `agent-heavy`
preset 所描述的多 agent 并行开发实践（`parallel-workers` skill + `verify-decisions` 门）。
安装方式 `uv tool install govrail`（或 `pip install govrail`），入口命令为 `gov`。

`main` 受保护：变更经 pull request 落地、`gates` 检查绿后方可合并；提交信息遵循 Angular
Conventional Commits（`type(scope): subject`）。

## License

MIT

## Star History

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=Lixiang9716/dsh-mobile&type=Date&theme=dark" />
  <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=Lixiang9716/dsh-mobile&type=Date" />
  <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=Lixiang9716/dsh-mobile&type=Date" />
</picture>
