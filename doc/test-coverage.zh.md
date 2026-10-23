# Node 侧可测面的行覆盖 — vitest、聚合 runner 与 coverage-floor 门

[English](test-coverage.md) | 简体中文

[English](test-coverage.md) | 简体中文

## 四层(D20)

本仓每个测试产物都声明且仅声明一个层级,由 `test-taxonomy` 门对照
`test/taxonomy.json` 强制;注册表的腿同样带 `kind`
(`node test/verifications.mjs --list`)。四层回答不同的问题,永远不能互相顶替:

| 层级 | 回答的问题 | 是否执行被测系统 | 例子 |
| --- | --- | --- | --- |
| **static(静态)** | 形状、声明、已提交证据是否一致? | 从不 | code-size、shellcheck、pairing、e2e-matrix 证据审计 |
| **unit(UT)** | 这个模块单独、秒级、确定性地跑,行为对吗? | 单模块 | panel vitest 套件、工具测试 |
| **integration(集成)** | 拼装后的运行时,无头跑,行为对吗? | 完整运行时,无 app 壳 | core CLI proof legs、681 条上游 sweep、MCP proof leg |
| **e2e(端到端)** | 装进设备的包,用户真实路径对吗? | 出货物,经 UI 或 launch 参数 | gateway-drive、device-plane、boot-carrier、各宿主 E2E runner |

试金石:static 在删掉产品代码后仍能运行;unit 只跑一个模块;integration
无头跑拼装运行时;e2e 跑用户会安装的那个包。**证据审计不是一个层**——它是
e2e 已提交证据的执法模式,所以 `e2e-matrix` 门名字里带 e2e 却从不启动 app。
"CI 绿"必须说明实际跑的是哪几层:2026-10-23 发布预检抓到一条真 e2e 腿坏了
五周,而 CI 一直绿——因为 CI 从没包含它(D20 记录全案)。

本仓真实的行为覆盖网不经过任何覆盖率工具:681 个上游官方 spec 压在
QuickJS 运行时与自研 shims 上,外加 e2e 证据矩阵与 gov 门。行覆盖只在一条
轴上补充这张网——**我们自研代码中 Node 可测的面**。本页是它的契约:测什么、
诚实不测什么,以及盯着它的 warn 档地板门。

## 跑法

```sh
sh tools/test/run-coverage.sh          # 逐面 vitest + 一张聚合表
sh tools/test/run-coverage.sh --check  # 同上,并强制地板(低于地板 exit 1)
```

runner 按 `tools/test/run-coverage.sh` 顶部的面注册表行走,缺依赖时自动
安装,以 v8 provider 跑各套件(reporter:text + lcov + json-summary),从
json-summary 报告汇总出聚合表。手动跑单面:

```sh
npm --prefix presentation/lynx-client run test:coverage
```

## 实测基线(2026-09-30,vitest 4.1.11 + @vitest/coverage-v8 4.1.11)

| 面                       | 行    | 分支   | 用例  |
|--------------------------|------:|-------:|------:|
| presentation/lynx-client | 84.2% |  66.5% | 36/36 |

## 地板与 warn 门

`tools/test/coverage-floors.json` 把每个面的地板钉在**实测值减 5 个点**
(lynx-client 今日:行 79.2、分支 61.5)——诚实的地板,真回退会亮、正常
抖动不扰。`gates.json` 的 `coverage-floor` 门跑
`sh tools/test/run-coverage.sh --check`,按面所在目录树 scoping,带
`allowFailure: true`——**warn 档:红只记录,不阻断**。它的 rule-6 反证
用例(`.gov/rejections/case-coverage-floor.sh`)全沙箱地证明门有牙——
地板注册表拷贝到临时目录、伪造的度量放在临时 measurements 根下
(`--floors` / `--measurements-root`),真实树永远不会被开变更窗(用例被杀
也零残留):地板临时抬到 100% 会红且具名,同一状态在无 `--enforce` 时保持
advisory,真实地板能咬住低度量,高于地板则绿。runner 本身刻意写成 POSIX
sh——门的 argv 经 `sh` 调用,而 govrail 无 shell 直 exec 该 argv,CI 的
dash 必须能跑(数组与 `pipefail` 在那里是语法错误)。

正当降地板的方式:重测,把地板移到新实测 − 5,并在 PR 里说明理由
(没有实测依据的地板改动是漂移,不是维护)。

## 诚实边界 — 具名的不计入项

`presentation/lynx-client` 内部,vitest 覆盖只含 `driver/**` + `shared/**`
(套件真正压住的 seam 库):

- `bundle/` — ReactLynx 渲染面跑在 Lynx 引擎上,不是 Node。在 node 侧
  假装行覆盖,与给 QuickJS 绑定的 shims 假装 node 覆盖是同一种谎。
- `driver/driver.js`、`driver/skin-*.js`、`driver/run-*.mjs`、
  `driver/mock/mock-serve.mjs` — CLI/e2e 面,只被入口引用;两种 skin 的
  完整 driver 回路由 `test/e2e/run-cli-lynx-mount.sh` 压住(stub 与 lynx
  两份 receipt 在案)。
- `theme/gen.mjs` — 归 `theme:check` 脚本门管。

整体未注册的面:

- `test/upstream-suite` — 它的 vitest 配置跑的是上游 harness 自带的
  spec(与 CLI 套件经 QuickJS 形态 harness 跑的 spec 同族)。那里的覆盖
  度量的是钉死的上游代码在 Node 语义下的行数——既不是我们的行覆盖,也不
  是 CLI 套件的行为证明。
- `presentation/web-client*` — 纯浏览器 JS,无运行器、无测试;Node 侧
  `import` `main.js` 直接失败(`document is not defined`)。
- `runtime/dsh`(QuickJS 运行时 + shims)— 交付语义是 QuickJS 的;
  行为网负责它们。

## 新增一个面

1. 给该面一个 vitest 配置,`coverage.include` 具名其 Node 可测的产品代码
   (排掉 `node_modules/`、`artifacts/`、`dist/` 与每一个叫得出名字的边界)。
2. 把目录加进 `tools/test/run-coverage.sh` 的 `SURFACES`。
3. 跑一次 runner,读真实数字,把 `tools/test/coverage-floors.json` 的地板
   设为实测 − 5。
4. 门已经盯着每个注册面——不需要改 gates.json。

## 测试加固计划（2026-10-15）

加固计划，已经 owner 批准——2026-10-15 为 16 项，2026-10-16 随 wave-2 扩充增补
四个座位（17-23 行）：分三波，每项方法作为独立的腿/座落地并附证据；
行的状态在落地它的 PR 里翻转。截至 2026-10-20，全部 20 行均为**已落**——
第 15 行（App 升级矩阵）是最后一条，当日在 main 上重证。它是对上方地板的补充而非替代——覆盖面回答
"表面测了没有"，下列方法回答"断言够不够硬"以及"边界上会发生什么"。

| # | 方法 | 波次 | 状态 | 落地形态 |
|---|------|------|------|----------|
| 1 | 敌意 LLM mock 画像（畸形 SSE、截断、slow-drip、超大块） | 1 | **已落**（#528） | mock-llm-server.mjs 画像 + 传输守卫腿 |
| 2 | C 宿主 ASan/UBSan CI 腿 | 1 | **已落**（#526） | c-core sanitizer 构建 |
| 3 | axe-core 可访问性回归（web-client-v2，接 #519 手工审查） | 1 | **已落**（#527） | 套件腿 |
| 4 | 视觉回归 diff（dev-carrier 截图；warn 级，绝不做 CI 日志断言） | 1 | **已落**（#527） | ui-sweep 像素 diff |
| 5 | 收窄变异试点（Stryker：shell-js 拒绝词汇、lynx fold/surface-core、publisher-token） | 1 | **已落**（信息性，2026-10-16） | 分数 shell-js 83.45% / lynx-fold 95.42% / publisher-token 98.29%（`test/mutation/reports/`）；分诊：存活体=scope 守卫等价 + 措辞 + 嵌套工作区 toGateway 族（需 fixture）；节奏：家族变更时重跑，永不作门禁 |
| 6 | bash 差分测试（POSIX 子集，dsh-shell-js 对真 bash，Linux CI） | 2 | **已落**（#540） | c-core Linux 腿 |
| 7 | 属性测试解析器（fast-check：parser-syntax、path、semver-range） | 2 | **已落**（#541） | panel 套件族 |
| 8 | 持久化 journal schema 迁移测试（跨版本重放） | 2 | **已落**（#538） | 迁移腿 |
| 9 | 静态分析：clang-tidy（src）、detekt（Kotlin） | 2 | **已落**（#536） | CI 腿 |
| 10 | vendored npm 闭包供应链审计（CVE + license） | 2 | **已落**（#535） | vendoring 步骤 |
| 11 | 老化 soak 腿（1-2 小时：堆/fd/journal 完整性） | 3 | **已落**（soak runner，2026-10-16） | soak-aging CLI 腿：单个长命会话承受持续 mock 轮次 `DSH_SOAK_MINUTES`（默认 90——owner 仪式，不作门禁），逐心跳采样堆（gc 收集括号 + 逐轮预算），journal 阶梯每心跳与收官全量连续，宿主 fd 由 runner 采样并按爬升设门（`runtime/dsh/ci/run-soak-aging.sh`） |
| 12 | gateway 线/SSE 解析器的结构感知生成式 fuzz | 3 | **已落**（信息性，2026-10-16） | fast-check SSE fuzz 经真实 `streamChat` 缝：任意字节切块下的重组、不可解析行的类型化失败、[DONE] 后静默（`test/panel/fastcheck/llm-sse-fuzz.test.js`）；裸线路半边归 21 例网关 fuzz 电池 |
| 13 | Provider cassette 重放（LLM 契约怪癖离线化） | 3 | **已落**（信息性，2026-10-16） | provider-cassettes 套件：九段录制线形（reasoning 约定、DONE 前 usage、中途换 model、CRLF、keep-alive 注释、无 [DONE] 关闭、中行录制切点）经真实 `streamChat` 缝回放（`test/panel/fastcheck/`，fixtures 带出处）；传输层变更时重跑，不作门禁 |
| 14 | 宿主队列边界并发压测（D2 派发缝） | 3 | **已落**（spine 套件，2026-10-16） | queue-boundary-stress spine 腿：4 会话×4 排队轮次一次性突发、SSE 抖动节奏，真 spine 上全部 drain，逐会话 journal 归因 + wire 级 journal 连续性（`test/panel/spine/run.sh`）；派发缝变更时重跑，不作门禁 |
| 15 | App 升级矩阵（跨版本 install -r；资产 stamp 对账） | 3 | **已落**（#569；2026-10-20 在 main 上重证） | upgrade-matrix Android 腿：两份 debug 构建只差一个 probe asset（runner 自管 probe 生命周期——创建 → 构建 A → 删除 → 构建 B——从不提交）；以 B 对 A 的 `adb install -r` 替代 restart 腿的 force-stop，跨构建覆盖 persist-restart 流程（A 上 create 腿 → B 上 resume 腿；检查器 46/46 与 restart 腿共用 manifest），外加 run-as 盘面断言（stale probe 被 stamp 对账清掉、`files/profiles/` 下 canary 完好、B 启动后 stamp 在位）。THE FINDING：journal 位于被同步树 `<filesDir>/dsh` 内，stamp-mismatch wipe 曾把它吃掉——`JournalKeeper` 现在把 `dsh/sessions` rename 到被清树之外、清完再放回（`JournalKeeper.kt`，由 `MainActivity.syncAssetDir` 调用；腿：`hosts/android/ci/run-upgrade-matrix.sh`）；节奏：asset-staging / 对账器 / profile-container 变更与发版前重跑，永不作门禁 |
| 16 | 资源饥饿行为（journal 写满盘、低内存） | 3 | **已落**（heap 面 2026-10-16；disk-full journal 面 2026-10-19，真 fs 挂载下） | 低内存面已证：`DSH_HEAP_LIMIT_MB` C 宿主测试旋钮封顶引擎堆，OOM 可捕获、具名、宿主存活（`resource-starvation.js` heap 腿，绿）。disk-full journal 面在门控真 fs 挂载下转绿：journal 在 runner 自持的 5 MB RAM 盘上增长直至卷拒写，持久化发布（契约 v1.11.0 `fsPublishAtomic`，由 `sessionPersistence.realFs` 拉起）在写边界具名损失（`journal.starve.named by=durable-publish`）——#571 静默丢失类在根因处被排除（`run-starvation.sh` journal 腿） |
| 17 | 网关审计完备性不变量（每个 v1.x 调用对宿主审计流配对、有序、零载荷——契约 §6） | 2 | **已落**（#537，2026-10-16） | gateway-audit-invariant CLI 腿（build.sh test core）：49 呼叫台账过裸缝，与宿主审计流一对一、有序、仅元数据配对；桌面宿主在 settle 点逐呼叫发审计记录 |
| 18 | 安装管线路径穿越钉（zip-slip 类：敌意成员驱过真实 `installPackage`；REL_PATH 拒绝内部 `..`） | 2 | **已落**（#539） | install-path-traversal 面板钉（19 条） |
| 21 | 多会话交错压测（单 spine 4 会话：journal 归属、投影、逐会话恢复） | 3 | **已落**（#543） | session-multi-stress e2e 腿 |
| 23 | 敌意工具调用参数混沌（type-error / missing-field / deep-nesting / oversized 过校验层；结构化拒绝、绝不炸 turn） | 1 | **已落**（#542） | llm-chaos-toolargs e2e 腿 |

行不得静默回退：已落地的行其腿消失即为 finding（与覆盖地板同一精神）。
