# Node 侧可测面的行覆盖 — vitest、聚合 runner 与 coverage-floor 门

[English](test-coverage.md) | 简体中文

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

16 项加固计划，已经 owner 批准：分三波，每项方法作为独立的腿/座落地并附证据；
行的状态在落地它的 PR 里翻转。它是对上方地板的补充而非替代——覆盖面回答
"表面测了没有"，下列方法回答"断言够不够硬"以及"边界上会发生什么"。

| # | 方法 | 波次 | 状态 | 落地形态 |
|---|------|------|------|----------|
| 1 | 敌意 LLM mock 画像（畸形 SSE、截断、slow-drip、超大块） | 1 | **已落**（#528） | mock-llm-server.mjs 画像 + 传输守卫腿 |
| 2 | C 宿主 ASan/UBSan CI 腿 | 1 | planned | c-core sanitizer 构建 |
| 3 | axe-core 可访问性回归（web-client-v2，接 #519 手工审查） | 1 | **已落**（#527） | 套件腿 |
| 4 | 视觉回归 diff（dev-carrier 截图；warn 级，绝不做 CI 日志断言） | 1 | **已落**（#527） | ui-sweep 像素 diff |
| 5 | 收窄变异试点（Stryker：shell-js 拒绝词汇、lynx fold/surface-core、publisher-token） | 1 | planned | 信息性分数 + 存活体分诊 |
| 6 | bash 差分测试（POSIX 子集，dsh-shell-js 对真 bash，Linux CI） | 2 | planned | c-core Linux 腿 |
| 7 | 属性测试解析器（fast-check：parser-syntax、path、semver-range） | 2 | planned | panel 套件族 |
| 8 | 持久化 journal schema 迁移测试（跨版本重放） | 2 | planned | 迁移腿 |
| 9 | 静态分析：clang-tidy（src）、detekt（Kotlin） | 2 | planned | CI 腿 |
| 10 | vendored npm 闭包供应链审计（CVE + license） | 2 | planned | vendoring 步骤 |
| 11 | 老化 soak 腿（1-2 小时：堆/fd/journal 完整性） | 3 | planned | CLI/模拟器 runner |
| 12 | gateway 线/SSE 解析器的结构感知生成式 fuzz | 3 | planned | fuzz 基建 |
| 13 | Provider cassette 重放（LLM 契约怪癖离线化） | 3 | planned | 录制 fixtures |
| 14 | 宿主队列边界并发压测（D2 派发缝） | 3 | planned | 派发压测 harness |
| 15 | App 升级矩阵（跨版本 install -r；AssetSync stamp） | 3 | planned | 升级腿 |
| 16 | 资源饥饿行为（journal 写满盘、低内存） | 3 | planned | 饥饿腿 |

行不得静默回退：已落地的行其腿消失即为 finding（与覆盖地板同一精神）。
