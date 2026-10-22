# dsh-mobile — 计划（2026-10-21，合并版）

[English](plan.md) | 中文

所有必须做、应该做、可以做的事的唯一事实来源。合并了 2026-10-21 的车队草稿（MCP 席与 row-15 席落在主树根下的 `plan.md`）、会话记忆里的待办，以及 2026-10-20 的两次调研（node 差分腿 #626/#627、iOS 进程方案普查）。基线：main = `722d69fe`（#632 MCP streamable-HTTP 已并）。按规则 12，某阶段落地的 PR 同时更新本文件。

**图例。** 规模：S（< 1 天）· M（数天）· L（数周）。门：🔒 需 owner 决策 / 明确 go · 🔧 硬件、凭据、外部方 · — 无。状态：open（待做）· in flight（进行中）· blocked（受阻）· parked（搁置）。每行"为什么 / 入口"给证据或接手会话的起点。

## 1. 🔴 立即——AOCI 认知收口（唯一卡在 owner 手里的阻塞）

2026-10-20 起 `aoci_maintain` 报 `blocked: scope_change_required`：#625 放宽的预算 identity 未激活。**27 个未索引源在等它**（#632 的 MCP 新文件、#631 的 `tools/test/sweep*.mjs`、改动后的 `test/verifications.mjs`、shim、note、证据文件）。`T-0268`（sweep 驱动卡，6/7 已勾）第 7 项随产出的 `chore(aoci)` PR 勾完。

- **批准会应用什么**（新 preview `activate-1904454454`，2026-10-21 在 §6.0 处理完后的干净树上生成，取代 `activate-2582042714`、`activate-3410094958`、`activate-1967926623`）：policy identity 不变；**budget identity `56f2…` → `54b0…`**（#625 重基线——风险等级 `high` 的唯一原因：`budget_relaxation`）；**index_added 15**（flakes.json、ensure-seat.sh、mcp-http-transport.js ×2、mock-mcp-server.mjs、run-mcp-streamable-http-e2e.sh、mcp-streamable-http.js 及其 scenario JSON、verifications.mjs、fras-lint.mjs、flake-retry.mjs、sweep.mjs + 2 个测试、SchibstedGrotesk woff2）；**index_removed 1**（`test/e2e/run-ios-m1.sh`，2026-10-20 已改名）；observe_added 17（Stryker 残留删掉前是 111）。`scope apply` 会要 preview 里的确认短语。
- Owner（或 owner 明确委托）按顺序执行：
  `~/tools/aoci/aoci --repo <root> scope approve --preview-file .aoci/scope-change/activate-1904454454/preview.json --actor <id> --out-file .aoci/scope-change/activate-1904454454/approval.json`
  再 `scope apply --preview-file … --approval-file …`。**agent 永不自行签名**——只能在 owner 明确指示下、以 owner 的身份执行。
- 批完后 agent 接手：`aoci_maintain` → 为约 27 个源写 FRAS → `node tools/aoci/fras-lint.mjs` 预检 → `aoci_update_entry` → `chore(aoci)` PR。半个会话。关掉 T-0268 第 7 项。规模 S。门 🔒。状态 done（2026-10-21——owner 批准 `activate-1904454454`，收口落地：五个机器批共 61 源撰写，aligned，T-0268 关闭）。

## 2. 现在就发（接下来 2–4 周）

| # | 事项 | 为什么 / 入口 | 规模 | 门 | 状态 |
|---|---|---|---|---|---|
| 2.1 | **v0.0.3 发布**：全量 feature-test 预检 → `bump.py` + 打 tag（D12–D14 管线）→ TestFlight · APK 走 GitHub Releases（自签）· Harmony 旁载 | launch sprint 2026-09-30 零阻塞，此后无公开构建；woaiys3（513★）证明 GitHub Releases 发 APK 可行。下一个 tag 按 `doc/github-owner-actions.md` 是 v0.0.3。发布需明确 go | M | 🔒 | open |
| 2.2 | Pages 英雄视频（≤ 60 秒）：对话 → 生成插件 → 当场插入 → 玻璃卡面 | Pages 缺"它能干什么"的证据；闭环已通（#427、#599） | S | — | open |
| 2.3 | Google Play 2SV 解卡 | 2026-10-07 起卡在 owner 手机端 | S | 🔧 | blocked |
| 2.4 | Marketplace v0 真部署：服务器凭据 + `deploy/marketplace/deploy-local.sh`；IdP 按 owner-actions 文档同为 STANDBY | 6/6 已落，只差凭据 | S | 🔧 | blocked |
| 2.5 | `doc/github-owner-actions.md` 刷新（S3）：条目 5 "Pages — landed red" 已过期（2026-10-15 上线，HTTP 200）；复核 1/3/4/7/8；未完成项：Dependabot security updates · `release` environment 加 required reviewer（没它每次 release run 死锁）· Discussions · marketplace publish secrets + environment · 删退役的 `RELEASE_PLEASE_TOKEN` · 发布 go · Play 行确认或删 · marketplace/IdP STANDBY 决定 · `~/tools/aoci` 升正式版 | 分钟级；双语 + `gov verify pairing --write` | S | — | open |
| 2.6 | 带证据关闭"已修未关"的 issue（常态） | 2026-10-19 发现六条 | S | — | recurring |

## 3. 验证基础设施（2026-10-20/21 查出来的）

| # | 事项 | 为什么 / 入口 | 规模 | 门 | 状态 |
|---|---|---|---|---|---|
| 3.1 | **3.2 的前置：给 86 条 "NO" 行分类**（#631 之后 node 列诚实了；族分布 hooks 9、llm 9、web 8、session 6、shell 6……）分四类：(a) #626 类 harness 伪像、(b) Node 面缺口、(c) 真实运行时差异、(d) 规格依赖 Node 独有能力。分类表决定 3.2 的重基线范围与第二档取舍；注册表 `reason` 改成分类实况 | 入口：`/tmp/dsh-sweep-differential/sweep-compare.md`，或 `node tools/test/sweep.mjs --paral 4` 过滤 `agree==NO`（每行两份日志 `tmp/upstream-suite-logs/<stem>.{qjs,node}.log`）。形状：一族一子代理 + 确认者抽检 + `world.run` 单 spec 两腿复跑作确定性门 | M | — done（2026-10-21——逐族工作流跑在新鲜 681 spec 树上：a 58（#626 波及面）· b 15（node 腿缺缝：fixture 播种、storage 全局、fetch loopback、tsx 宿主内在）· c 24（真实运行时差异——差分的价值所在）· d 4（持久化 worker；二档）。53 行独立复核、53 行过两腿重跑门。分类表见 testing/2026-10-21 note；注册表 reason 已改写为分类实况） |
| 3.2 | **#626** node 腿：`test/upstream-suite/smoke-hooks.mjs` 加 `NODE_BUILTIN_PASSTHROUGH = new Set(['node:child_process'])` + 一行早返回；改正 `test/verifications.mjs` reason/status；用 Node 驱动 / 周扫重测 | 根因已双向复现（9/22 ↔ 31/0） | S 代码 / M 测量 | — | done（2026-10-21——passthrough 落地；重基线刻意不是干净翻转：101→83 分歧，58 条 a 行中 21 行干净翻绿，37 行真跑真败（新分诊清单→3.17），4 条新分歧；surprise ×3 随本变更） |
| 3.3 | node 腿第二档：11 个 `node:*` shim 行全部直通真内建；单独 PR、单独重基线（`node:vm` 等翻成 qjs 红/node 绿 = 真运行时缺口） | `runtime-modules.js` 的行：string_decoder、stream/promises、tls、inspector、dns/promises、readline、vm、http、net、child_process、url | M | — done（2026-10-21——NODE_BUILTIN_PASSTHROUGH 扩至全部 11 行 node:*；重基线：83→63 分歧，25 行干净翻绿（fetch/proxy/egress 全族终于跑真传输），5 行回归已带签名重分类（ssh TLS 行→d；acp bridge 与 otel egress→c）。终表 a 18 / b 18 / c 17 / d 10——见 Tier-2 testing note） |
| 3.4 | **#627** ensure-seat 补全：`external/node_modules` 农场行（或直接跑 `parity-node-modules.sh`）、sweep 自建农场、对 `third-party/deepseek-harness` 做 `git submodule update --init`、node_modules 链接指向席位、`generation.mjs` 指纹覆盖 submodule 语料（`git ls-tree HEAD third-party/deepseek-harness` + 依赖路径探针）、`transpile.mjs` 遇 ENOENT 排除时至少 warn 而不静默改写已跟踪的 manifest。验收：新席位转译 = 681 且 stamp 与 main 一致 | 席位 648 vs 681 而 `.generation` 相同；manifest.json（已跟踪）被静默改写 681→648。#629 已往 materialization 加了 `presentation/official-web/dist` + `client-bundles/npm`——同一个文件。surprise sig `linked-worktree-materialized-buildensure-seatsh` | S–M | — done（2026-10-21——manifest 增 `provision` 数组（clone-submodule + parity 农场，席位内建、绝不 rsync）；generation 指纹覆盖 submodule；transpile 高声告警；sweep 自物化农场；验收：新席位转译 681 = main，零缺零多） |
| 3.5 | sweep 驱动后续（#631）：`MODULE-LEVEL FAILURE` / `ERR_DSH_NO_SEAM` 归为环境红；3.2 之后分诊 node NOSUM 43 | node 列自 #631 起诚实 | S | — | open |
| 3.6 | 注册表状态由运行结果派生（live/dead/divergent 从最新 sweep 表算出，文字只写原因） | 同一条腿状态文案 2026-10-20 错了两次 | M | — | open |
| 3.7 | 冷席位 CI 腿：新鲜 worktree → `ensure-seat --verify` → 转译 → 单 spec qjs+node 冒烟，作物化完整性的门 | 本可抓到农场 + submodule | M | — | open |
| 3.8 | **#633** e2e-matrix currency：33 条 `runtime/spike/artifacts` 改 `runtime/dsh/`；Totals 从 93/206/213 重生成为 `matrix.mjs` 实测 137/257/250；补 2026-10 CLI 腿行（llm.piai-probe、dsh-shell-js、appshell-spec、llm.chaos.*、seam-inventory、mcp-streamable-http…）；可选：totals 由 `matrix.mjs --out` 生成（根治漂移）。en+zh + `gov verify pairing --write e2e-matrix` | 半小时级 | S–M | — | open |
| 3.9 | qjs 腿 lsp-stdio `instance.spec` 22/1（backpressure 时序；#614 回退也复现） | lsp 家族唯一真残留 | S | — | open |
| 3.10 | 回执 tree 行卫生（S2）：`hosts/android/ci/run-ble.sh:151` / `run-device-plane.sh:191` / `run-session-persist-restart.sh:161` 在回执时读树——原位重跑必被标 dirty；照 `run-upgrade-matrix.sh`（#629）处理。定 `"tree": "origin/main <sha>"` 字面：#629 复核 22/36 已提交回执的 sha 不在 origin/main 上 | note：`.agents/notes/implemented/testing/2026-10-20-upgrade-matrix-receipt-tree-line-pinned-.md` | S | — | open |
| 3.11 | **#628** `AssetSync.kt` 死副本：建议 **删除**（detekt baseline 允许收缩）；备选 B = 诚实完成抽取（AssetSync 成唯一实现 + JournalKeeper，`MainActivity.syncAssetDir` / `SessionPersistRestartSession` 改走它）；两者都要把 JournalKeeper 的 R 从 "called by AssetSync" 改成 `MainActivity.syncAssetDir` | 零调用点；原样接回会复发 journal 被吃 | S | — done（2026-10-21——采建议 A：AssetSync.kt 已删，零调用点已验；row-15 标题改指机制本身；AOCI 关系随下轮维护重绑） |
| 3.12 | #258 TLS 设计轮 · #260 `node:net` fd 包装（D5 草案 `contract/proposals/2026-10-19-net-fd-wrap.md` 已写，等采纳）· #257 socket seam 各宿主 serve 腿 + e2e | socket seam 家族，L/M/L | L | 🔒（设计轮） | open/parked |
| 3.13 | Windows 梯子第 4 级：**A（推荐）** 给 ios-boot-carrier / panel / harmony-host-e2e 补 `drive` → `run-verifications.mjs` 调度器吃整张表 → `gov run` 独立 mode（"govrail 管选/判/证，Node 管执行语义，重仪式独立 mode，retry 留驱动"）；第一步 = drive schema 草案 + 能 `--dry-run` 打整表计划的调度器骨架。**B** Windows 面：MSVC 探测、无壳 spawn 改可执行解析（`npm.cmd`），CRLF 已容忍。bash shim 退场至少留一个 weekly 周期（规则 10 全扫：weekly `run:` 行、`doc/release-checks/`、注册表散文、ops-dispatch） | 1–3 级已落 #624/#625/#631；gates.json 字段已核 | M | — | open |
| 3.14 | Stryker 政策：家族变更时重跑，永不作门禁。残留 `test/mutation/.stryker-tmp`（502 MB，两份沙箱）**2026-10-21 已删**——它在 scope 评估里占了 111 条 observe 行 | 试点抓到死反例网（publisher-token） | S | — | done |
| 3.15 | 共享 `.git` 里两个陈旧 stash（gaps-integration 2026-10-11；feat/device-plane WIP）——落地或丢弃 | 2026-10-21 看到 | S | — | open |
| 3.16 | 2026-10-26 03:17 UTC：看 weekly-sweep 首次 Node 驱动跑（totals 解析、首批 NO 行、NOSUM 缩水）；数字回填驱动的 note；红 = inspection 发现而非基础设施失败 | 入口：`.github/workflows/weekly-sweep.yml`；`node test/verifications.mjs --why upstream-sweep` | S | — | scheduled |

| 3.17 | #626 passthrough 落地后重分诊 37 条原 a 行 + 4 条新分歧行（它们现在真跑 spawn、因自身 merit 失败：preset-mount loader 缝、hooks 真 spawn 行为、spawn-runner 的 seam 时代断言、media-references 的 qjs 缺口、sdk-client 一例之差、subprocess egress 的 ALL_PROXY） | #641 分类表的 (a) 标签本意是"根本没跑到被测代码"——passthrough 揭开了它们；注册表 reason 已带修后计数 | M | — done（2026-10-21——重分诊在 Tier 2 之后一次完成（一次 sweep 服务两事）：终表 a 18 / b 18 / c 17 / d 10；Tier-1 快照的 41 行全部带机制重分类；重跑门因席位路径迁移执行 0 次——已如实披露；计数由三次对比 sweep 与周扫继续锚定）  node 腿补缝席位落了 18 条 b 行中的 6 条（web 面、tsx 内在、FormData 双脸）：63→58，b 18→12；余 12 条需要逐族 fixture 播种设计、loader internals 接线、node-pty vendor 行、resolve 语义修复  fixture 播种又落地 24 行（每进程工作根——隔离优先于泄漏）：63→58→46，五条泄漏 blessed 行翻为 NO——新的分诊材料（testing note 2026-10-21, fixture seeding）  shim 表格在 node 腿接线（runtime-modules + npm-bridges-c 启动即执行）：行内测试数大幅改善（mount 14/39→51/2、inventory 全败→9/3），分歧面稳在 46——剩余行均已具名机制（loader-internals 边角、node-pty vendor 行[需 owner 决策]、typert 的 staged-fs manifest 读） |

## 4. 🧭 MCP 上机（"万能工具"主线，两步）

| # | 事项 | 为什么 / 入口 | 规模 | 门 | 状态 |
|---|---|---|---|---|---|
| 4.1 | **Host staging**：5 个转正的 MCP pin 加进每宿主 embed 清单（iOS `ios-TREES.rows` / harmony `harmony-closure.rows` @walk / android `android-pins.rows`）→ `build/build.sh sync ios+android+harmony` → closures/bundle-files/staging 三门绿。关键决策：**包体裁剪**——client dist 带 .cjs/.map/.d.ts（数 MB），设备只要 dist/*.mjs（白名单行，或 ensure 提取面加只取 .mjs 的变体） | #632 落了传输 + 探针，设备上还不可达。`vendor-package` skill 是流程规范；materialization.json 不用动 | M（镜像重物化是大头） | — | open |
| 4.2 | **`dsh-mcp` 系统插件**：配置面（`__dshMcpServers` 全局或 `DSH_MCP_SERVERS` env，凭据走 keychain）→ boot 时对每个 server `createMcpHttpTransport` + `Client.connect` → `listTools` 以 `mcp_<server>_<tool>` 注册进 `ctx.tools` → `callTool` 转发。探针 = mock server + scenario + manifest + runner（#632 模板）。铁律：D6（组合 vendored client 零改）、D8（工具执行事件驱动）；Agent Note 里征求意见：审批粒度（建议首版按 server 一次性授权） | 插件 OS 需要外部工具；#632 账本点名为下一步 | M | — | open |
| 4.3 | 4.2 之后：stdio 桥仍判物理不可行（无 subprocess 缝），除非 D5 出新原语——勿重开；MCP 资源面/prompt 面保持 absent-features 行；OAuth step-up 与 BYOK 凭据存储一起评 | 2026-10-21 车队草稿 | — | — | parked |
| 4.4 | 上游 re-pin 评估：09-23 调研时上游领先 pin 0.1.6-alpha.2 共 1754 commits；re-pin 连锁（presets seed 重生成、receipt 版本字面量、E2E manifest 重钉） | owner 定节奏 | M | 🔒 | open |

## 5. 入口与增长契约（1–2 个月）

| # | 事项 | 为什么 / 入口 | 规模 | 门 | 状态 |
|---|---|---|---|---|---|
| 5.1 | SAEP/豆包 ingress 四件套走 D5：静态声明 + deeplink scenario 路由表 + SessionServe + 审批缝延伸到 deeplink | owner 2026-10-15 拍板；报名窗口现在零成本；在 D5 提案池 | M | 🔒 冻结 | open |
| 5.2 | Android 做"手"：screen/ui/input 原语族 + 编排插件 | 竞品 APK 已带 accessibility/shizuku——入场券 | L | 🔒 契约 | open |
| 5.3 | iOS 做"嘴"：App Intents + Live Activity（Tier 1）；ReplayKit 只读可选；Tier 3 不做 | iOS 唯一允许的形态；无人有 iOS 宿主 | L | 🔒 | open |
| 5.4 | #266 真机腿——**前置是签名**：iOS 免费 Apple ID 自动签（7 天过期、3 设备）；Harmony 需实名 Huawei 开发者账号（本机无 DevEco、无签名材料） | 相机 iOS/Harmony、BLE ×3、Harmony parity + 矩阵 | M | 🔧 | blocked |
| 5.5 | 生态 API 直连插件（"点奶茶"最现实的第一步 = cordis 路线） | 千问也是 API 直连而非屏幕操控 | M | 🔧 BD | open |
| 5.6 | 进口标准：SKILL.md 兼容 + MCP 客户端（4.2 之后补 server 目录 + 导入 UX） | OpenMinis 行动项 | M | — | open |
| 5.7 | **#268** D5：profile 即 app manifest——无定义 app 自我定义（def 拱顶石）；D5 池还有 AgentVM/WALI 契约、event-channel v1.6.0 与 system-capability-plane 的冻结节奏 | 2026-09-30 起未冻结 | L | 🔒 | open |
| 5.8 | `def` 定名写入 `doc/decisions.md`（目前只在记忆；D18 已是 WALI） | 2026-09-27 定名未入账 | S | 🔒 | open |

## 6. 文档与仓库结构

| # | 事项 | 为什么 / 入口 | 规模 | 门 | 状态 |
|---|---|---|---|---|---|
| 6.0 | 主树根下散落的 `plan.md`（MCP/row-15 车队草稿，untracked）：已并入本文件，并于 2026-10-21 **移到 `../dsh-mobile-lsp-diff-fork/tmp/plan-fleet-draft-2026-10-21.md`**，免得 AOCI 把未跟踪文件绑进索引；本 plan 落地后删掉那份副本 | 曾两份 plan 并存 | S | — | done |
| 6.1 | 结构可读性 A 轨：布局图 + 无文档根目录的 README（2026-10-21 实测：21 个顶层目录只有 contract/ presentation/ runtime/ system-plugins/ 有 README）+ `.gitignore` 一遍，一个 PR。（车队草稿称 A 轨已落——实测未落。） | owner 2026-10-19："看不出来什么是什么" | S–M | — | open |
| 6.2 | B 轨改名（`src`→`host-core`、`third-party`→`upstream`、`external` 深整合） | 改名搅动所有开着的席位；放发布后 | M | 🔒 | parked |
| 6.3 | ARCHITECTURE §10：核实 2026-10 四个里程碑（shell-js、ishRun 退场、鸿蒙转真、加固）在 #625 计数修正后都在 | 规则 12 | S | — | open |
| 6.4 | Agent notes 归档巡检（400 implemented / 0 archived） | archive-agent-notes skill | S–M | — | open |
| 6.5 | ops-dispatch 验收（试金石 prompt） | #622 已落 | S | — | open |
| 6.6 | 文档工具决策：doc-refine skill vs writing-for-agents vs 不做 | 2026-10-16 起未拍板 | S | 🔒 | open |
| 6.7 | Vendor 闭包漂移：宿主资产镜像树半边 | staging 半边 2026-10-19 收官 | M | 🔒 | open |
| 6.8 | 上游 submodule ↔ pin 表机器绑定 | 上游 issue 已开，等 owner | S | 🔧 | blocked |

## 7. 产品打磨

| # | 事项 | 为什么 / 入口 | 规模 | 门 | 状态 |
|---|---|---|---|---|---|
| 7.1 | GenUI 方向评审 + 落产：v6 管线（colors.csv 193 色板检索 → 构建 → 批评家 R1–R10）与 v7（四份 skill 60 KB + 390×844 画布 + 自由创作）等 owner 评；def 交互原型 v1（`/tmp/def-prototype`——先确认还在）同批。落产形态：skill pack 进插件 + 管线 + CSS 一个 PR | 历轮最佳（一次性出图 9/10） | M | 🔒 评审 | open |
| 7.2 | 流式 TTFT 渐进渲染 | 思考期 11–26 秒主导；体验层 | M | — | open |
| 7.3 | **#267** 主题梯第 2 级：单源 token 机制上的编辑器 | token 在，机制缺 | M | — | open |
| 7.4 | **#265** Lynx client：宿主侧 `--client` 选择 + 真机像素 | 试点 #248 已落 | M | — | open |
| 7.5 | 番茄钟尾巴：卡面 JSON 契约；serve 座 app 层缺陷 | #427 遗留 | S | — | open |
| 7.6 | Desktop-plugins staged-next 账本（附录 A）：fs over gateway scopes + tool-fs-search（ripgrep 二进制）、web fetch + keyed search、tool-ask-user / dsh-user-approval（presetJoin 只在 Harmony）、compaction 宿主接线（serve 席 `options.compaction` + `/compact` UI）、titles(auto) / plan-mode / permission-presets、tool-cordis（需 `cordisInspect` HOST service） | `doc/dsh-desktop-plugins.md` "Still staged" 段 | 合计 M，单行 S | — | open |
| 7.7 | Open Design 安装 | 需外部 nexu-io daemon | — | 🔧 | parked |

## 8. 架构赌注（一个季度；排在 §2 之后）

| # | 事项 | 为什么 / 入口 | 规模 | 门 | 状态 |
|---|---|---|---|---|---|
| 8.1 | AgentVM wasm 住户：契约提案；两周 spike——wasm3 解释器住户 vs WebContent 进程住户（经 JSPI 借 WebKit wasm 引擎，Wasmer 2026-09 路线；需 iOS 27+；桥的税）。操作者仍是原生 QuickJS（"全转 wasm 是倒退"不变） | 2026-10-20 普查：WebContent 是 iOS 给第三方的唯一带 JIT 第二进程 | L | 🔒 | open |
| 8.2 | 住户的 fiber 调度器 | 只有设计 | L | — | parked |
| 8.3 | 云住户作为能力协商出的执行面 | Cosyra（2026）信号；差异化仍是本地驻留 | M | 🔒 | parked |
| 8.4 | **#264** forkpty 面：v1.9.0 提案 DRAFT → 冻结进 `primitives.md` | 已实现（D-b） | S | 🔒 | open |
| 8.5 | 真 fs 阶梯（S6）：① strict mirror（S）——sessions root 真盘镜像失败改为可观测/抛错（dropped-bytes 计数；根因已翻案：`fs-workspace-write.js` 的 best-effort 镜像吞错，不是上游后端）；② 真 fs 适配器 flag-gated 默认关（M）——`fs-promises` 按挂载根把 sessions root 路由到真盘（骑 v1.11.0 `fsPublishAtomic/fsSync`），验收 = row-16 满盘腿从"仪器"翻成真回归（`run-starvation.sh` journal 面）；③ gateway 级完备（D5）：link/fsync/truncate/mkdtemp/realpath，等第二个真盘消费者 | #580/#584 守卫已落；#571 类静默丢失 | S/M/🔒 | open |
| 8.6 | 裸金属第二阶段（纯数据变换下沉；永不动 tools/presets/commands/skills/plugins） | 两阶段策略 | L | 🔒 | parked |
| 8.7 | MCU/XS 方向（ESP32-S3 走 wasm3 ~64 KB；XS 候选；AsyncContext 重推） | 探索性 | L | 🔒 | parked |

## 9. 治理、govrail、AOCI（§1 之后）

| # | 事项 | 为什么 / 入口 | 规模 | 门 | 状态 |
|---|---|---|---|---|---|
| 9.1 | 落 surprise 记录：lsp 席位的两条（分支 `docs/plan-2026-10`）；冷树签名家族已 ≥ 3 → 规则 11 process note。⚠️ govrail#456 修好前：任何追加 `.gov/surprises.jsonl` 的 PR 开之前先 rebase 到 origin/main（GitHub 不认自定义 merge driver → 并行 surprise PR 直接 CONFLICTING 且零 check） | 规则 11 | S | — | open |
| 9.2 | govrail 存量（已立，等修）：#454 `gov task new` id 碰撞死循环（本机 site-packages 热修，**任何 `uv tool install govrail` 都会抹掉**——"bumping" 刷屏即复现）；#455 `task tick --evidence` 让勾选可审计（T-0246 假勾）；#456 surprises.jsonl 的 merge driver 被 GitHub 忽略 → 账本每条一文件；#457 `note check` 常驻无关 "superseded by" banner + `task close` 对落地后事实项无出口；#458 `gov verify pairing <stem>` 只读形态是 usage error（两席都撞过）。再核 #385：`task close` 仍全量跑 28 门 | 常备职责 | — | 🔧 上游 | recurring |
| 9.3 | AGENTS.md 的 surprise 摘要块（复发 ≥ 2 入块、晋升出块）+ first-contact 注入 | 2026-10-18 提案，准入线未拍板 | S | 🔒 | open |
| 9.4 | AOCI 服务 → 正式 release（今天是 rc20-62 dev 构建） | 外部 | — | 🔧 | blocked |

## 10. 本机卫生（不发 PR）

- Stryker 残留 2026-10-21 已删（见上）。
- Android 模拟器 `pixel`（emulator-5554）自 2026-10-20 起一直在跑——不用就关。
- 兄弟席位（含 `../dsh-mobile-lsp-diff-fork`）：各自工作落地当天 `git worktree remove`。

## 11. 观察清单

- 同类：woaiys3/deepseek-harness-android-app（513★，活跃）、PalmClaw（1169★，停更）、OpenMinis（5.3k★）、Cosyra（云端 agent）、Lobbowen "Lob OS"。完全同构仍无第二家；无人有 iOS 宿主。
- 平台：Wasmer 的 WebKit/JSPI 路线要 iOS 27+；DMA 引擎资格仅 EU、JIT 仍受限；TrollStore 起进程在 iOS 18+ 关门；UTM SE 说明 Apple 接受纯解释执行的仿真器。
- 上游 DSH：pin 0.1.6-alpha.2（+#632 的转正）；下一次升 pin 触发 upstream-suite 重扫（见 4.4）。

## 12. 建议顺序（合并）

1. ✅ §1 AOCI approve/apply（owner）+ 认知收口 PR（61 源，关 T-0268）——2026-10-21 落地。
2. 🟢 落本 plan（`docs/plan-2026-10` 开 `docs(plan)` PR）+ "证据卫生"小车队：#633（3.8）+ #627（3.4）+ #628（3.11）+ tree 行（3.10）——文件互不相碰。
3. ✅ 3.1 已分类（2026-10-21：101 行 = a 58 / b 15 / c 24 / d 4）→ §3.2 #626 修复连同重基线（预期变化：58 条 a 类翻转）。
4. 🟢 2.1 发布预检 → v0.0.3 go（owner）→ 2.2 视频。
5. 🧭 4.1 → 4.2 MCP 主线（2–3 个会话）。
6. 🟠 5.x 契约、6.x 文档、7.1 GenUI 评审——按 owner 优先级，互不阻塞。
7. 👀 3.16 周扫首次 Node 驱动跑（2026-10-26）。

## 附录 A — dsh-desktop-plugins "still staged"（#632 之后）

| 行 | 缺口 | 备注 |
|---|---|---|
| fs over gateway scopes + tool-fs-search | subprocess/fs-service 缝；ripgrep 二进制 | 真盘 write-through 已议未做 |
| web fetch + keyed search | `fetch: false`，无 fetch provider over httpFetch | keyless 已在；keyed 是记录的缺口 |
| tool-ask-user / dsh-user-approval | presetJoin 只在 Harmony；iOS/Android 席未传 | probe 已证 |
| compaction 宿主接线 | boot 行 CLI 已证；serve 席缺 `options.compaction`；`/compact` UI | known gap 2026-10-12 |
| titles(auto) / plan-mode / permission-presets | dsh-plan-mode vendored 未挂；titles 未携带；permissionPresets 空表 | 各自独立小活 |
| tool-cordis | 需 vendored cordis-host-runner 的 `cordisInspect` HOST service | 唯一缺 host service 的行 |
