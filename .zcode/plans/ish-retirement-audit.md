# ishRun / iSH 退场审计(2026-10-14,只读底稿)

结论先行:**退场在架构上已基本完成**(2026-10-11 dsh-shell-js 独占 shell 席位,三宿主 staging 已摘除 dsh-shell-ish,CI 已全线 `--no-ish`),剩余工作是收尾:本地门族、iOS 宿主实现、市场目录、文档与记录面。合同 v1 冻结(D5)决定了 `ishRun` 的**合同条目不可删除**,只能全员诚实 `unavailable`。"37 次 ishRun 审计记录"在仓库内**不存在**对应账本(见 §7;真实数字:tracked 审计记录 23 条、run-ish-local 收据 11/11)。

## 1. 代码面

### 1.1 C seam 与 vendored 引擎(实现)

| 文件 | 角色 | 关键行 |
|---|---|---|
| `src/dsh_ish.c` | 实现:boot 一次/stage/run 一个客机程序;`dsh_ish_stage` 用 zlib 解包 pinned tarball | aoci.code.txt:1793;被 `hosts/ios/App/Source/Gateway/IshPrimitive.swift:142,166,260` 调用 |
| `src/dsh_ish.h` | seam 合同(boot/run/stage,`DSH_ISH_GUEST_MOUNT` 等) | `src/dsh_ish.h:1-60` |
| `src/dsh_ish_verify.c/.h` | rootfs 逐成员 seal/verify(TOFU,每次 boot 重验) | aoci.code.txt:1795-1796 |
| `src/ish/CMakeLists.txt` | 引擎构建(libishcore.a + libdsh_ish;`ISH_PIN` 镜像 `src/CMakeLists.txt:96`) | aoci.code.txt:1805 |
| `src/ish/gen-offsets.sh`、`src/ish/prebuilt/libvdso.so.elf`(+README) | 客机 vdso 生成脚本与**已提交的 pinned vdso 二进制** | aoci.code.txt:1806,1809;`git ls-files src/ish` 共 4 文件 |
| `src/CMakeLists.txt:96-120` | 条件编入:`EXISTS ${DSH_ISH_SRC}/kernel/calls.h` 才编 `dsh_ish.c` 并 `add_subdirectory(ish)`、`PUBLIC dsh_ish`;缺席则 STATUS 大声跳过(:113-117) | 实读 |
| `example/ish_smoke.c` | C 级门驱动(`dsh_ish_run`:47、`dsh_ish_stage`:101、`dsh_ish_boot`:109) | 实读 |
| `example/main_cli.c:24-33, 1033-1090, 1581` | 桌面 CLI 后端:`DSH_CLI_WITH_ISH` opt-in;`smoke_ish_run` 无 rootfs/无引擎均答诚实 `unavailable`(:1055, :1077-1082) | 实读 |
| `example/CMakeLists.txt:6,15-29` | ish-smoke 目标,`-DISH_SMOKE=1` 才拉引擎子项目 | 实读 |
| `external/ensure-ish.sh` | vendored 引擎取数脚本(tracked 溯源;PIN `e1d5794…`,:29-31;声明 GPL LICENSE 随源,:14-15) | 实读 |
| `external/ensure-ish-rootfs.sh` | Alpine 3.21.8 aarch64 minirootfs 取数脚本(URL+SHA256 :24-25,与 run-ish-local.sh:58-59 同 pin) | 实读 |
| `external/ish/` | 引擎源码本体,**untracked**(3.0 MB;`.gitignore:272`,`.zcodeignore:94`) | `git check-ignore` 实证 |

### 1.2 调用方

- **iOS 宿主(唯一实现宿主)**:`hosts/ios/App/Source/Gateway/IshPrimitive.swift`(全文 299 行,`guestWorkspace=/mnt/workspace`:24、缺 userland 答 `unavailable`:136-140、bundle tarball 现场解包:162-171、`declaredGuestRoot` 声明:180-188);`hosts/ios/App/Source/Bridge.h:5`(`#include "dsh_ish.h"`);`hosts/ios/App/Source/CRuntimeFactory.swift:21-52`(`DSH_ISH_ROOTFS` launch-env 声明 + `host.launch`/`ish.rootfs.declared` 记录);`hosts/ios/project.yml:180-213`(pre-build phase:ensure-ish.sh、vdso 构建、`-DISH_SDK`/`-DISH_VDSO_ELF_DIR`、build dsh_ish);`hosts/ios/gen.sh:10-17`(xcodegen 前 `ensure-ish-rootfs.sh App/Generated`)。**`BundleStager.swift` 已无任何 ish 行**(grep 0;2026-10-11 摘除,见 `.agents/notes/implemented/architecture/2026-10-11-the-shell-seat-switches-to-dsh-shell-js-.md:44-48`);aoci.code.txt:824 对它的描述已过时。
- **JS 脊**:`runtime/dsh/gateway.js:129-130`(ishRun 两行包装导出);`runtime/dsh/upstream/boot.js:74-86,178`(dsh-shell-js 独占席位,:76 注释记录 wasm/ish 退役;staged 孪生在 `hosts/android/app/src/main/assets/dsh/upstream/boot.js` 与 `hosts/harmony/entry/src/main/resources/rawfile/dsh/upstream/boot.js` 同内容)。
- **插件(席位已撤、树仍在)**:`system-plugins/dsh-shell-ish/{index.js,manifest.json}` 与 `runtime/dsh/system-plugins/dsh-shell-ish/{index.js,manifest.json}`(仓库根/运行时双树,manifest.json 声明 required `ishRun+fsRead`;index.js:151 `ISH_DESCRIPTION`、:167-174 从 `DSH_ISH_ROOTFS`/launch-env 解析 rootfs、:197)。无任何宿主 boot 挂载它;仅 marketplace 安装路径可达。
- **本地场景门**:`runtime/dsh/scenario-local/userland-shell.js:27`(静态 import dsh-shell-ish)、:45-48(经插件 `shellExecutor`)、:89-103;驱动器 `test/e2e/run-ish-local.sh`(全文,唯一 driver);checker `test/e2e/scenarios/userland-shell-local.json`(断言 `uname -m→aarch64`、`/etc/alpine-release→3.21.8`、`id -un→root`、管道、exit 7 stderr、超时击杀、deliverable 36 字节 sha256)。
- **CI/构建**:见 §4。
- **历史/证据(勿删错)**:`runtime/dsh/artifacts/macos-cli-userland-shell/`(现役证据,含 guest-root busybox 树)、`runtime/dsh/artifacts/macos-cli-ish-shell/`(旧证据,c-smoke.jsonl 仅 2 行)、`hosts/ios/artifacts/*` 中的 `ish.rootfs.declared` 行(如 `hosts/ios/artifacts/gateway/logs.txt:2`、`hosts/ios/artifacts/ios-live-test/C-tools/b4-write-live/logs.txt:60-61`)。git 全库 `-i ish` 路径 460 条,绝大多数是这两棵 guest-root 证据树。

### 1.3 Android / Harmony(应为零,已证实)

- Android 源码零实现:`hosts/android/.../GatewayCore.kt:24` 仅冻结表注释提及 "ishRun-unavailable-on-android";staging 由 `hosts/android/ci/stage-spine-closure.sh:372,375` 的 `RETIRED_PLUGINS="dsh-shell-wasm dsh-shell-ish"` 显式跳过;staged 资产文件已删除(grep 0)。行为实测:Android 的 ishRun 落 `denied "primitive not granted"`(非 unavailable,`.zcode/reports/refactor-same-different-matrix.md:117` 记录的偏离)。
- Harmony 零实现:仅"served-nowhere"诚实缺席清单——`hosts/harmony/entry/src/main/cpp/gateway_smoke.cpp:66,78,91,473,481`(smoke_known_absent)与 `HostPhase.ets:141,153`、`OfficialServe.ets:113` 注释;实测落 `invalid "unknown primitive"`(同 matrix:117)。

## 2. 合同面

- **条目**:`contract/primitives.md:20-27`(v1.3.0 增量注记:"a host without it answers unavailable")、**:159**(原语表第 16 行,permission flag `ishRun`,no streams)、**:314-345**(§4 "emulated userland (v1.3.0)":argv 而非命令行、`["/bin/sh","-c",line]`、非零退出是结果、未知程序 127、timedOut 报 128、truncated 排空不阻塞、无 staged userland 答 `unavailable`)。中文/类型镜像:`contract/primitives.zh.md:16,126,265,422,467`;`contract/primitives.d.ts:175-186`。
- **冻结与废弃路径**:primitives.md:8-9 — "FROZEN at the contract freeze (2026-09-19, **decision D5**)… immutable for the life of major version 1";§8(:605 起)minor=仅添加。**`contract/proposals/` 全目录(21 个文件)没有 ishRun 废弃提案**;因此退场的合同路径只有两条:(a) 保留条目、全体宿主答 `unavailable`(§7#1 明确允许,"absence is information for negotiation, never faked",:597 附近);(b) §8 major(v2)破坏性移除。所谓"D5 废弃提案路径"在仓库中不存在实体,实际是 D5 冻结条款本身。
- **审计边界条款**:§6 ":590-592"(audit mandatory, never payload)+ **§7 第 2 条 :601**("for `ishRun`, states in the descriptor what §6's audit cannot reach (the guest's own I/O)")。该"ishRun 规则"已被后续合同面复用为命名先例:channel seam(:526)、`contract/proposals/2026-09-26-event-channel.md:82`、`2026-09-30-system-capability-plane.md:258`、`2026-09-26-render-surface.md:126`(D16 教训引用)、`2026-09-29-forkpty-face.md:133`。
- **scenario/checker 断言**:只有 `userland-shell-local.json` 一个(内容见 §1.2),由 `run-ish-local.sh` 手动驱动,**未接入任何 CI workflow**(c-core.yml:17-24 注释明证:"NONE of the ten test-core legs touches ishRun/ish")。`example/ish_smoke.c`/`main_cli.c` 的 `DSH_CLI_WITH_ISH` 是 opt-in 编译面,无 checker 依赖 with-ish 链接。

## 3. 宿主面

- iOS:完整栈(见 §1.2),descriptor 诚实披露载体是 ARCHITECTURE §12 文档章节而非 descriptor JSON 字段(matrix:81 记录,仓库内部自洽)。
- Android/Harmony:零实现、零 staging、零引擎引用(§1.3),仅注释级"served-nowhere"名单与一条 RETIRED_PLUGINS。**证实为零**。

## 4. CI/门面——逐个判断"iSH 移除后特例能否整体删除"

| 特例 | 位置 | 移除 iSH 后 |
|---|---|---|
| c-core.yml `--no-ish` 逃生门 | `.github/workflows/c-core.yml:2-24,65-87,88-97`(工作流存在理由即"Linux 无法编 iSH asm";:15 明言 "The iSH line is awaiting removal") | **可整体删除**:注释块、ish 缓存排除说明、`--no-ish` 传参;工作流本身保留为 Linux CI 面 |
| gov.yml quickjs-boot-parse arm64-only 守卫 | `.github/workflows/gov.yml:130-158`(注释 :131-133 明说 arm64-only 是 iSH AArch64 asm 所致;ish 缓存 :152-153、`ensure-ish.sh` :157) | **可整体删除**:arm64 专属 job 与 ish 物化步骤;门可回归任意架构 |
| weekly-sweep 的 ish | `.github/workflows/weekly-sweep.yml:58-67`(缓存 key 含 ensure-ish.sh)、:84-92(`--no-ish` 构建) | **可整体删除** |
| src/build.sh `--no-ish` | `src/build.sh:18-27,41-80`(ish 分支 :54-65,else 分支 :70-73 保留 `-lsqlite3` 的注释已写明 ish 只是搭车) | **可整体删除**:ish 分支与 flag;`-lsqlite3` 并入固定链接 |
| build/build.sh `--no-ish` 透传 | `build/build.sh:45,52,170,173` | **可整体删除**(纯透传) |
| check-quickjs-boot-parse.sh arch guard | `runtime/dsh/ci/check-quickjs-boot-parse.sh:15-30`(arch guard)、:51-53(Linux miss-build `--no-ish`)、:60-62(ensure-ish 物化) | **可整体删除**,门变 arch-neutral |
| 其余 ci 脚本的 ensure-ish 预热 | `run-security-byok-leak.sh:31`、`run-security-manifest-forgery.sh:39`、`run-marketplace-install-e2e.sh:39,46`、`run-upstream-parity.sh:45,53`、`run-llm-piai-probe.sh:33,36`、`run-llm-piai-e2e.sh:26,41` | **均可删**:它们预热只因 with-ish CLI 链接引擎;引擎一走即无意义 |
| iOS 侧(project.yml pre-build、gen.sh FetchIshRootfs) | `hosts/ios/project.yml:180-213`、`hosts/ios/gen.sh:10-17` | **可整体删除**该 build phase 与取数步 |

## 5. 调用方盘点(真实 ishRun 调用)

1. **`userland.shell` 场景一族**(唯一场景级调用方):`run-ish-local.sh` → `scenario-local/userland-shell.js` → dsh-shell-ish `shellExecutor` → `gateway.js ishRun` → `main_cli.c smoke_ish_run`/`IshPrimitive.swift` → `dsh_ish.c`。手动本地门,无 CI 依赖。
2. **marketplace 的 dsh-shell-ish 包**:`deploy/marketplace/catalog.json:22-25`、`summaries.json:26-28`、`site/index.json:109-124`、tracked tarball `site/packages/dsh-shell-ish@0.1.0.tgz`;`tools/gen-marketplace-index.test.mjs:124` 用它当真实行;marketplace install e2e 预热 ensure-ish.sh。任何宿主上安装后,若宿主无 ishRun,合同规定答 `unavailable`——但 Android/Harmony 现状落 denied/invalid(§1.3,偏离点)。
3. **桌面 CLI/iOS gateway 后端**:仅服务上述两者,`--no-ish` 构建已答诚实 `unavailable`(main_cli.c:1077-1082)。

**dsh-shell-js 能否承接?** 不能完全承接,且不应改写该场景:
- 能承接:管道(stream.js 协程流水线)、退出码、分离 stderr、glob(minimatch)。
- 承接不了:场景断言的**客机身份**(`uname -m→aarch64`、`/etc/alpine-release→3.21.8`——dsh-shell-js 是 shelljs applet 近似,无真实内核身份);**真实 ELF 执行**(busybox/apk/musl);**命令替换 `$()`、反引号、算术展开被按名拒绝**(`runtime/dsh/system-plugins/dsh-shell-js/exec.js:86-92`);**超时不强制**(`dsh-shell-js/index.js` 头注:"timeoutMs… normalized and carried, **not enforced in v1**"),而 iSH 有真 deadline 击杀+击杀后恢复(场景 `guest.timeout`/`guest.recovered` 两条断言)。
- **裁决建议**:`userland.shell` 转"诚实退役"(归档证据、scenario 移除),而非用 dsh-shell-js 伪造等价;宿主面按合同 §7#1 全员 `unavailable`,descriptor 更新。

## 6. 删除面清单(退场时的完整改动)

**A. 引擎与 seam**:`external/ensure-ish.sh`、`external/ensure-ish-rootfs.sh`(pinned 溯源,唯一存在理由是引擎);`src/dsh_ish.{c,h}`、`src/dsh_ish_verify.{c,h}`;`src/ish/` 全目录(含提交的 `prebuilt/libvdso.so.elf`);`src/CMakeLists.txt:96-120`(条件编入块);`example/ish_smoke.c`;`example/CMakeLists.txt:6,15-29`(ish-smoke 块);`example/main_cli.c:24-33,1033-1090,1581`(opt-in 面与 `b.ish_mount`)。理由:唯一消费者消失,条件编入即死代码。

**B. iOS 宿主**:`hosts/ios/App/Source/Gateway/IshPrimitive.swift`(原语实现);`Bridge.h:5`;`CRuntimeFactory.swift:21-52`(DSH_ISH_ROOTFS 声明与 host.launch 记录——注意保留 DSH_ env 透传通道本身,只删 guest 部分);`project.yml:180-213`(pre-build phase);`gen.sh:10-17`;`GatewayCore.swift` 原语表 ishRun 行(matrix:185 记为 :122-133)与 descriptor 披露文本。理由:无引擎则原语无处落地。

**C. JS/运行时**:`runtime/dsh/system-plugins/dsh-shell-ish/` 与 `system-plugins/dsh-shell-ish/` 双树;marketplace 面(见 E);`gateway.js:129-130` ishRun 包装(可选:合同 d.ts 保留则运行时包装也可删,无其他 importer)。`boot.js:74-86` 注释可精简(staged 孪生随 closures 再生)。

**D. 门/CI**:§4 全表 + `test/e2e/run-ish-local.sh`、`test/e2e/scenarios/userland-shell-local.json`、`runtime/dsh/scenario-local/userland-shell.js`(三者一体退役);六个 ci 脚本的预热行。理由:唯一场景退场后门族无对象。

**E. 市场**:`catalog.json:22-25`、`summaries.json:26-28`、`site/index.json:109-124`、`site/packages/dsh-shell-ish@0.1.0.tgz`、`tools/gen-marketplace-index.test.mjs:124`(改用别的真实行)。理由:发布一个必然答 unavailable 的包是伪供给。

**F. 合同/文档**:`primitives.md/.zh.md` v1.3.0 注记与 §4 段**保留**(v1 冻结),建议加一条"已无在役宿主"的版本注记;`doc/ARCHITECTURE.md:154`(平台矩阵行)、**:211-241(§12 整段 iSH 诚实边界——退场后改为"无真实用户态"的新诚实声明)**;`doc/sequence-diagrams.md:178-190`(图 7)及 zh 镜像;`doc/dsh-desktop-plugins.md:27,37` 及 zh;`doc/research/upstream-dsh-anatomy.md:307,311,333,342`、`upstream-capability-mounting.md:83`;proposals 中的 "ishRun 规则" 引用保留(历史先例);`doc/decisions.md:129-138`(D16,历史决策记录保留,可加退役补记)。`contract/primitives.d.ts:175-186` 随合同保留。

**G. 记录/忽略面**:`.gitignore:95,138-144,239,272` 与 `.zcodeignore:88-100`(iSH/rootfs 忽略条目与注释);`.aoci/baseline.json`(example/ish_smoke.c :969、src/dsh_ish* :8599-8623、external/ensure-ish* :999-1011、scenario-local/userland-shell.js :6811、userland-shell-local.json :9756——随 aoci 再生);`aoci.code.txt` 约 25 条目(:39,62,793,824,841,990,1004,1031,1341,1560,1595-1597,1603-1604,1734-1735,1791-1809 等,再生);`tools/generated/staging/ios-TREES.rows:121` 注释;`hosts/android/ci/stage-spine-closure.sh:372`(RETIRED_PLUGINS 可只留 wasm);`GatewayCore.kt:24`、`gateway_smoke.cpp:66-91,473-481`、`HostPhase.ets:141,153`、`OfficialServe.ets:113`(served-nowhere 名单——若顺带修 §7.1 偏离,可改为真 `unavailable`);证据目录 `runtime/dsh/artifacts/macos-cli-{userland-shell,ish-shell}/` 归档或删除;`.gov/surprises.jsonl` 为 append-only,**不动**;untracked 的 `.zcode/reports/platform-code-map.md:21,161,185,190,211,225` 与 `refactor-same-different-matrix.md` 各行择机更新。

## 7. 风险与未知

- **仅 iSH 提供的语义**(dsh-shell-js 无对应):真实 ELF/AArch64 执行与真实 busybox/apk/musl(primitives.md:314-345 "an ordinary ELF binary");会话中途 `apk` 装包(doc/decisions.md:129 模拟器腿);真实 `/bin/sh` 全语义含 `$()`/算术(exec.js:86-92 拒绝);真 deadline 击杀与击杀后恢复(dsh-shell-js timeoutMs v1 不强制);客机文件效果为真实宿主文件(335 绝对符号链接的 stage/verify 完整性机制亦为 iSH 独有);guest 经宿主 BSD socket 的网络(§12 :230-235 的审计盲区条款因此存在)。ARCHITECTURE §12 曾声称 iOS 借此才有 `sh/apk/pip/npm`(§12 :219-224)——退场后该句必须改写,否则文档说谎。
- **GPL 红利**:iSH 为 GPL-2/3(+LICENSE.IOS),静态链接即 GPL-3.0 且仓库无 LICENSE 文件(doc/decisions.md:129 末句;ensure-ish.sh:14-15)。移除 iSH **同时消除**这一发行前悬案。
- **合同**:v1 冻结下条目不可删(§2);全员 unavailable 是唯一不动 major 的路径;需处理 §7.1 已记录的 denied/invalid 偏离(matrix:117)。
- **"37 次 ishRun 审计记录"出处排查(未找到)**:全仓库 `git grep '\b37\b'` 于 .agents/doc/baselines/contract 为 0 文件;宽匹配仅命中间戳数字误报(如 "24.637");tracked 工件中 `"primitive":"ishRun"` 审计记录总计 **23** 条(hosts/+runtime/);run-ish-local 收据记 **11/11** 一一对应(test/e2e/run-ish-local.sh:223);ish 命名提交共 **4** 个(4917388f feat(ish) #138、2dc9e7c3、8409315a、9c180376)。结论:仓库内不存在 37 计数账本,该说法为记忆误记;最接近的真实数字为 23(审计记录总数)与 11(单场景断言数)。
- **执行顺序未知项**:aoci 再生的工具链命令、marketplace e2e 换行后的 checker 期望、iOS artifact 证据再生是否纳入本仓——均需在执行提案中定,不影响"退场可行"的判定。

## 执行摘要

退场可行,且大半已完成:2026-10-11 dsh-shell-js 独占 shell 席位,三宿主 staging 均已摘除 dsh-shell-ish,C 核 CI 全线 `--no-ish`,Android/Harmony 仅剩注释级"served-nowhere"名单。真实调用方仅两处:`run-ish-local.sh` 驱动的 `userland.shell` 本地门族(无 CI 依赖)与 marketplace 目录中的 dsh-shell-ish 包;无任何 CI 腿触达 ishRun。dsh-shell-js 能承接管道/退出码/stderr,但接不住客机身份断言(aarch64、alpine-release)、真实 ELF/apk、`$()` 展开与强制超时——该场景应退役为诚实 unavailable,而非改写。合同 v1 冻结(D5)决定 ishRun 条目不可删,只能全员 unavailable 并更新 §12 诚实声明。最大风险:iOS"唯一真实用户态"承诺(真实 ELF、apk、审计盲区披露)散布于场景断言、aoci 基线、marketplace 目录与文档四处,退场须四处同步,漏一处即伪造证据链;附带红利是消除 GPL-3.0 悬案。
