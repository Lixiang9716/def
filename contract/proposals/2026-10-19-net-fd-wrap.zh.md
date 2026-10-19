# 提案：net fd-wrap 面 —— 面向 dsh-subprocess 控制缝的 Socket({fd})（v1.12.0 候选）

> **状态：DRAFT（D5 提案——未冻结任何内容，未实现任何内容）。**
> [English](2026-10-19-net-fd-wrap.md) | 简体中文

## 动机

Issue #260 确证：`node:net` 的 **fd-wrap socket**——`new Socket({fd})`——无人服务，
而 dsh-subprocess 家族正需要它：其控制缝恰好开在这个构造器上。这道缺口由 socket
缝自己的落地（PR #251）点名为后续项：fd 采纳「按设计在 v1.8.0 grant class 之外」
——该缝授予的是运行时自己开的门（`socketListen` / `socketConnect`），从不授予它
已持有的描述符。T-0264 跟踪本提案。

消费者原文（vendored `subprocess@0.1.6-alpha.2`，`lib/control.js`）：
`openInheritedControlChannel()` 消费启动标记 `DSH_SUBPROCESS_CONTROL`（:7、
:16-18——读取、删除、非 `"pipe"` 即抛）并返回 `new Socket({ fd: 7, readable:
true, writable: true, allowHalfOpen: true })`（:19-24）——一条继承在预留描述符上
的**额外全双工字节管道**，不是 stdio 接管。包自述其法则（:9-13）："The returned
stream owns the descriptor"、"Call once before executing untrusted code;
messages remain untrusted even though the endpoint was inherited"。另一端按朴素
的 `net.Socket` 双工面书写，且比常见清单更长：`ptc-runtime-node@0.1.6-alpha.2`
运行 `runNodeMain(openInheritedControlChannel(), maxMessageBytes, …)`
（lib/process-entry.js:4、lib/process.js:1061），经 `stream.on("data")`（:224）、
`stream.on("error")`（io，:225、:230-231）、`stream.on("end")`（:226——承重：程序
未结清前的读侧 EOF 本身就是协议失败「ended before the program settled」，io，
:236-238）、`stream.cork()` / `stream.write(header)` / `stream.write(body, cb)` /
`stream.uncork()`（:295-300）、`stream.off(...)`（:315-316）、`stream.destroy()`
（:317）、`stream.once("close")`（:1074）驱动 JSON 帧通道——帧上限随调用携带，
在缝之上。

这条缝的两个角色，宿主都已有 fd 现实。作为**父方**，v1.5.0 时代 subprocess 缝的
extras 本就是双工字节管道：`dsh_proc_fork_exec` 为每个 piped extra 建一条
`socketpair(AF_UNIX, SOCK_STREAM)`，把子端 `dup2` 到 fd 3+i，父端留非阻塞于
`dsh_proc.extra_r[5]`（src/dsh_runtime_host.c:1906-1914、:1955、:2003-2008；
ptc 控制通道骑子侧 fd 7——:146）。QuickJS 父侧把 `child.stdio[7]`——「the
operative consumer」——作为跑在 `(pid, slot)` intrinsics 上的 duplex-lite 服务
（`wireExtraChannels`，shims/node-child-process.js:176-210）。作为**子方**，CLI
宿主——C 宿主 CLI（BUILD.md）——本身只是一个进程：被 dsh-subprocess 启动器以
`stdio: { stdin: 4, stdout: 5, stderr: 6, control: 7 }` 启动（vendored 启动器
自己的请求形状，subprocess-local@0.1.6-alpha.2/lib/spawn-runner.js:240）时，
描述符 7 就在它的描述符表里——而今天的 `node:net` 面仍以诚实 throw 拒绝它，其
措辞声称一个 v1.8.0 记录并不携带的「named non-goal」（shims/node-socket-tcp.js
:455-464；该缝真正的 named non-goals 是远程作用域、TLS、UDS/multicast 与后台监
听——2026-09-28-socket-seam.md:95-103——且 primitives.md 的缝小节通篇没有 fd
字样）。

所以边界是真的，但从未被命名。本提案命名它，并狭窄地服务这个需要：
**采纳既有通道成为一个网关原语，为运行时家族自己创建的通道（父方）或出生即继承
的通道（子方）铸出 socket 缝自己的 `connectionId`**。`Socket({fd})` 的其余一切
不变。

## 原语（一个，加性）

按 §8 的 minor 规则加性：没有该面的 `gateway@1` 宿主对每次调用回答
`unavailable`，协商保留全部现有底线。

### `procChannel` —— 采纳一条既有子进程通道

```ts
export type ProcChannelRequest =
  | { source: "spawn"; pid: number; slot: number }  // 父腿：slot 0..4 ↔ 子 fd 3..7
  | { source: "inherited"; fd: number };            // 子腿：被武装的控制 fd（v0：7）
export declare function procChannel(
  request: ProcChannelRequest,
): Promise<{ connectionId: string }>;
```

以 socket 缝自己的 `connectionId` 命名空间内的 id 兑现：`data` / `close` /
`error` 按 `connectionId` 键控骑 `socket` 通道（§5）——被采纳的 id 没有
`serverId`，也从不发出 `connection.accepted`（fold 在 §5 行散文里补进这句）。
写走 `connection.write`，半关走 `connection.end()`——`shutdown(SHUT_WR)`，恰是
`__dshProcEndFd` 已服务的面（src/dsh_runtime_host.c:2541-2553）。读侧 EOF 不是
§5 事件种类，也保持不是：shim 从泵的 EOF 指示合成 node 的 `end`——socket shim
自己的既有机制（`res.eof` → `emit('end')`，两个半部**都**完成才 `close`，
node-socket-tcp.js:217-222、:284-288；proc 侧同形状是 `extraEof`）——因此
vendored 通道的 `end` 语义与 `allowHalfOpen` 原样成立，冻结的 §5 载荷词表零扩展。
无新权限旗标，也从不 resolve `null`（§3 把它留给用户拒绝弹窗授权；这里没有可拒
绝的弹窗）。

**通道从哪来——两条腿。** *父腿*采纳本运行时自己活着的子进程的一条 extra 通
道：`(pid, slot)`，slot 0..4 ↔ 子 fd 3..7（C 表自己的查找，:153；其余皆
`invalid`——别人的子进程采纳不了）。*子腿*采纳恰好**一个**描述符：被武装的控制
fd——dsh-subprocess 惯例点名的那一个，`SUBPROCESS_CONTROL_FD` = 7（control.js
:5）——而不是整个预留窗口。[3, 8) 的其余部分是启动形状、不是通道形状：直接启动
用 `'ignore'`（/dev/null——活描述符，采纳它会铸出幻影通道：读即 EOF、写无声消
失）垫满 fd 3-6，runner 形状把 fd 3 留给 `'ipc'`（runner-launch.js:110-116、
:118-128）。凡不是被武装描述符的 fd 皆 `invalid`，原因串指名这条法则。

**标记只武装，从不删除。**启动时、先于任何不可信代码，宿主从环境读取
`DSH_SUBPROCESS_CONTROL`，值为 `"pipe"` 即武装控制描述符——宿主侧状态，记录一
次。运行时**绝不**改写环境：control.js 自己的消费次序（:16-18 读取、删除、校
验）随后在 QuickJS 内原样运行——boot 就删会让它的 `marker !== "pipe"` 检查抛
出，验收路径第一行即死。武装只依赖 boot 时刻的值，vendored 代码之后对它的 env
面做什么都无关紧要；标记字符串本身不带权力——知道 `"pipe"` 什么也换不来，因为
武装是宿主状态，不是那个环境变量。

**所有权移动；绝不共享，也绝不来第二次。**采纳是 MOVE：兑现之时描述符的唯一主
人是这条通道，proc 轮询停止 drain 已采纳的 slot（同一 socketpair 端两个读者会把
字节流劈开）。destroy 或对端关闭恰好关闭描述符一次——「The returned stream
owns the descriptor」是 control.js 自己的句子，本契约照单收编。采纳每通道一生仅
一次：对已采纳通道的第二次采纳是 `invalid`，对已耗尽通道的采纳同样是
`invalid`——close 之后武装不重置，fd 编号什么也证明不了（W8 类危险：复用的编号
指的是表里现在装着的任何东西）。proc 槽位的释放条件（已收割且每条流已结清，
:2164-2177）只在通道关闭后才把已采纳的 slot 计为结清；写硬错误关闭通道并浮出
`error` + `close`，绝不无声复活（:2526 的规则平移过来）。已采纳通道占 socket 缝
连接表的一个条目——归那个 cap 的纪律管，不归 proc 表的 64 槽（:142）。

**无作用域轴。**v1.8.0 五规则模型按方向与对端给门分级（primitives.md:515-531）；
继承的 socketpair 两者皆无——没有拨号，没有开门，端点在运行时开始之前就已固
定。因此 `procChannel` 不取 scope，也不需要 socket 授权。

**契约行：无权限旗标，一道所有权检查。**spawn 面今天不携带任何契约门——它是冻
结表之下的宿主 intrinsic（vendored 适配器甚至声明
`capabilities: { required: [], optional: [] }`），所以这里不存在可「复用」的门，
诚实胜过虚构：fold 的 §2 行权限旗标格冻 `—`（`deviceInfo` 先例）并给出这条理
由，streams：无。强制是结构性的：

- **父腿**不多授予调用者自己的 spawn 未曾创造的一分权力。宿主按 pid 记录驱动
  spawn 的调用者身份，只有该调用者可采纳其通道——他人一律 `denied`（插件 A 铸
  不出指向插件 B 子进程的 socket 面）；
- **子腿**的描述符先于运行时存在——从未有过属于我们的 manifest 可设门；本契约
  添加的是武装纪律、仅一次法则与审计，而非一块纯属演戏的门。

若 subprocess 家族日后获得契约旗标，父腿按 §8 加性搭车。在不可能是被启动子进程
的宿主上（没有 App 进程会在 exec 时被交来控制描述符），子腿回答 `unavailable`
——能力协商，不是平台分支（RFC 0002 反模式规则）。

**错误**，§3 词表：slot 越界、pid 非本运行时活子进程、fd 非被武装描述符、标记缺
失、对已采纳通道的第二次采纳——或对已耗尽通道的采纳，皆 `invalid`；父腿上非
spawn 者本人调用 `denied`；描述符到货即死者 `io`（control.js 自己的「@throws
when the inherited descriptor cannot be opened」）；加性规则照旧 `unavailable`。
审计遵循 §6：采纳时一条记录（调用者、判定、来源腿、`(pid, slot | fd)`、结局），
close 时一条记录并定稿该通道累计流量字节数——长命通道的字节不是逐调用事实。绝
无载荷字节。

**消息保持不可信。**通道载运字节；成帧、尺寸上限与认证留在缝之上的协议层。
control.js 的「messages remain untrusted even though the endpoint was
inherited」被原句引入本契约，而非被它软化。

## 实现策略：一个 C spine，两条腿

| 腿 | 服务于 | C 侧动作 |
|---|---|---|
| `inherited`（{fd}） | 仅 CLI 宿主——一个 dsh-subprocess 启动器启动得了的进程 | boot 时窥视并武装（绝不改写环境）；采纳时把被武装描述符移入 socket 缝的泵表并铸 `conn:N` |
| `spawn`（(pid, slot)） | 有活 spawn 面的宿主——C proc spine 四端皆编译（:140-141），但运行时没有活子进程就无可采纳，逐调用答 `unavailable` | 把 `extra_r[slot]` 移入 socket 缝的表，slot 标记 adopted，铸 `conn:N` |

JS shim 按字面兑现 vendored 构造器：窗口已武装时，`new Socket({ fd: 7, readable:
true, writable: true, allowHalfOpen: true })` 经子腿兑现，返回 socket 缝背书的
双工，具备 JsonChannel 实际驱动的全部面——`data`、`write(+callback)`、`off`、
`destroy`、`once("close")`、`error`、`end`，以及 `cork`/`uncork`（seam 双工今天
就答 `cork`/`uncork`——现为 no-op，node-socket-tcp.js:171-172；真批量化是 shim
侧缓冲，不新增网关面）。`allowHalfOpen` 映到缝的半关；对端关闭抵达时尾随字节已
送达——socket 缝自己的规则。其余一切的诚实 throw 照旧，措辞改为指向已服务的
面，而非声称一个从未被命名的 non-goal——六份提交 shim 副本（两文件 × 三束：
`node-socket-tcp.js` 与 `npm-bridges-c.js` × runtime/android/harmony）随 fold
同步。

## v0 刻意排除的（named non-goals）

- **不做任意描述符采纳**（完整的 node `Socket({fd})` 语义）：stdio、文件、监听
  器、启动形状自己的垫片（`'ignore'` 的 fd 3-6、runner 的 `'ipc'` fd 3）、外来
  描述符——照旧拒绝。[3, 8) 窗口仍是 subprocess 缝的冻结几何（W8 法则：pre-exec
  close 绝不碰它——src/dsh_runtime_host.c:1965-1971），子腿只采纳其中被武装的
  **那一个**描述符（v0：7），绝不碰邻居——本运行时里裸描述符编号不指任何稳定之
  物（W8：裸 fd 7 杀掉了 slot 4 刚 dup 好的端，控制通道到货即死）。
- **无成帧协议**：只有字节——JsonChannel 的 JSON 帧与 `maxMessageBytes` 留在消
  费者，恰如 TLS 留在 socket 缝之外。
- **不是 stdio 接管**：stdin/stdout/stderr 面留在 v1.5.0 时代 subprocess 缝安放
  的位置；控制通道是那条额外双工管道，仅此而已。
- **不动已交付的父侧面**：`wireExtraChannels` 的 duplex-lite 仍是父侧面，直到有
  消费者需要真 `net.Socket`；父腿的存在是为了让同一条缝的两端骑同一契约行。
- **无弹窗、无持久化**：没有可 remember 的授权；通道随其进程关系生灭（缝的
  session-scoped 姿态）。

## 备选方案

- **保留 duplex-lite，维持排除（现状）**：否——排除从未被命名（throw 的
  「named non-goal」措辞在 v1.8.0 记录中无载体），家族的子角色在 QuickJS 中无法
  运行，且每个消费者怪癖都在把 duplex-lite 临场养大（`closed` getter，
  node-child-process.js:189-192，为一次销毁断言而生）。
- **到处裸 fd 采纳（完整 node 语义）**：断然否——描述符编号会整体绕过授权、审计
  与方向分级，正是「宿主持 fd、藏于带审计的 id 之后」这一模型要关死的洞
  （dsh_socket.h 的 `srv:N`/`conn:N` id；缝的五规则）；编号本身也不可靠（W8，
  如上）。
- **只扩 spawn intrinsics，不加契约行**：否——D5 契约先行：该面跨界网关（JS 向
  宿主要一条受治理的流、收回一个带审计的 id），这就是原语的定义；不受治理的
  intrinsic 正是网关所拒绝之物。
- **两条腿拆两个原语**：v0 否——一个按 `source` 判别的请求让表保持窄（§8 的克制
  规则），两腿又铸同一个 id；日后拆分是加性，合并不是。

## 验证计划

- Issue 的验收原话：在 CLI 宿主上，武装启动标记之下，`new Socket({ fd: 7,
  readable: true, writable: true, allowHalfOpen: true })` 构造出可用双工流，且
  要它的那条 dsh-subprocess 控制路径（control.js 的
  `openInheritedControlChannel` → JsonChannel 往返，含 cork/uncork 与 `end`）
  跑绿——control.js 自己的标记检查（:16-18）原样通过本身就是测试的一部分，这正是
  运行时只武装不删除的原因。
- 子腿的拒绝是测出来的，不是散文：非被武装描述符的 fd（启动形状 `'ignore'` 垫的
  3-6、runner 的 `'ipc'` 3——runner-launch.js:110-128）、第二次采纳、close 后再
  采纳，全部 `invalid`。
- 几何回归：pre-exec close 纪律——绝不碰 [3, 8)——带一条具名测试，其拒绝用例就
  是 W8 事故本身（裸 fd 7 杀掉 slot 4 的通道）。
- 父腿对 vendored 子进程往返一份载荷，与 duplex-lite 路径逐字节一致，并以
  `denied` 拒绝外来调用者。
- 协商底线：没有该面的宿主对每次调用答 `unavailable`；在不可能是被启动子进程的
  宿主上子腿答 `unavailable`；现有行为零变化。

## 版本

v1.12.0 候选（加性：一个原语；无新事件通道——socket 缝自己的通道载运流量；无新
权限旗标）。最近一个冻结 minor 是 v1.11.0（durable-fs，2026-10-19）；在案草稿
携带的候选号已被 fold 占用（forkpty v1.9.0、system-capability-plane v1.10.0——
「monotonic fold ordering wins」，primitives.md v1.9.0 注），故 v1.12.0 是下一
个空闲加性号；fold 时按 next-free 规则落号。
