# 发布回归·终局跑 — v0.0.3

[English](release-regression-v0.0.3.md) | 简体中文

> v0.0.3 的权威证据包,2026-10-23 由发布前回归产出(office-plane 教训所
> 要求:e2e-matrix 门只审计已提交证据;CI 跑不了的腿,**本地全量重跑是唯一
> 的网**)。下面每条结论都带产生它的命令。cut 序列(bump → merge → tag)
> 依据 owner 2026-10-23 的委托 go(plan-2.1 序列,原话"你给 go → tag");
> 该 go 以本证据包全绿为前提——前提成立。

## 本证据包的范围

- **基线**:运行时的 `main@2b1392c0`(#665)——含冷席判定门在内的全部
  已并工作。precheck 自带一个修复,而且是这次跑自己抓到的(网起作用
  了):iOS bundle 落盘清单缺 `fs-durable.js` 行——#666。main 上的网关
  驱动自 #593(2026-10-18)起就死在 import 上,CI 看不见,因为这条腿只
  在本地跑,提交证据停在 2026-09-28。
- **机器诚实**:本机无 Android NDK、无 DevEco CLT——Android/HarmonyOS
  腿由发布列车的既有方式覆盖:`dev-android`/`dev-harmonyos` CI 腿在
  bump PR 上跑,`release/android`/`release/harmony` workflow 在 tag 时
  构建安装包。未连接任何真机(iOS `xcrun devicectl`:无)——所有真机
  腿保持脚本待命,绝不伪造。`release` environment 未武装(无保护规则,
  见 doc/github-owner-actions.md 第 3 项),tag 推送不受门控:go 是
  记录在案的委托,不是环境。

## Run 0 — 全门矩阵

命令:`gov run --every-gate`。结果:**28 门:28 绿**(含 exclusive 的
`self-test`、`closures`、`e2e-matrix`、`vendoring-repro`、
`coverage-floor`、`panel-tests`)。

## Run 1 — core 工具链腿

命令:`build/build.sh build core`。结果:PASS(sync + `src/build.sh`
编译 + CLI 证明腿;其回执已在 #666 刷新)。

## Run 2 — iOS 调试 e2e 腿(跑了两次)

命令:`build/build.sh build ios`。首跑在网关驱动处失败——boot 8/8 绿、
carrier 7/7 绿、网关 0/26 事件(`cannot load module 'fs-durable.js'`;
debug 与 release 两种配置同病)。根因与修复:#666。修复树上重跑:绿——
boot 8/8、carrier 7/7、网关 26/26 + 回执
(`rt: sequence boot=PASS carrier=PASS gateway=PASS`)。

## Run 3 — iOS Release 配置 feature pass

命令:`build/build.sh build ios --release`。与 run 2 同形:修复前红,
修复后 PASS(`ALL CHECKERS PASS`)。

## Run 4 — 上游套件 sweep(Node 驱动)

命令:`node tools/test/sweep.mjs`。结果:PASS。差分账本的失败数分歧
(qjs vs node):22——账本已文档化 14(d-contract 9、c-delta 4、
both-red 1),**8 条 unexplained**,另有 1 条陈旧行
(`session__session-telemetry-otel__tests__egress`,不再分歧)。八条
unexplained 点名而非掩埋:`experimental__webworker-runtime__tests__node__fs`、
`llm__llm-deepseek__tests__egress`、`mcp__mcp-client__tests__egress`、
`util__http-proxy__tests__install`、
`util__http-proxy__tests__matcher-parity`、
`web__web-search-deepseek__tests__egress`、
`web__web-search-exa__tests__egress`、
`web__web-search-perplexity__tests__egress`——均为两腿之间的测试面分歧,
已排入账本清障(plan §3.19);不触碰任何出货面。
报告:`tmp/upstream-suite-report.tsv`。

## Run 5 — 模拟器矩阵(iOS)

命令:`tools/test/run-simulator-matrix.sh --platform ios`。三腿全绿:

```
matrix: [ios] release        -> PASS (0 drive markers / 0 debug+info; audit=668 warn=32; refusal by name)
matrix: [ios] gateway-drive  -> PASS (4 verdicts green + receipt — 首次尝试干净走通,重试未动用)
matrix: [ios] device-plane   -> PASS (device.plane + audit verdicts green + receipt)
```

gateway-drive 跑的是完整 UI 驱动(WDA/idb:通知横幅、审批对话框、Files
picker 走查、notes 选中)。precheck 的第一次矩阵跑中观察到一次环境红
——picker 走查在 iOS 26.5 远程面板上有竞态——#666 已给该腿 #515 的疗法
(先分类再重试);记录在案的这次跑无需重试。

## 这次跑修掉的(网的捕获)

- **#666 — 落盘行与诚实重试**:#593 加了场景 import 和 RESOURCES 嵌入
  行,但没加落盘行(BundleStager 手工清单类第四撞;文件里记录着前三
  撞)。CI 五周全绿,因为这条腿只在本地跑。类的跟进:#667(bundle 根级
  embed-by-existing;给这条腿一个 CI 的家;picker 走查的修复)。

## 打 tag 阶段的捕获(预检之后、同一天)

cut 本身又暴露两个预检看不见的缺陷——都在任何包流出前修完;tag 守卫三次
拒绝,坏包从未存在:

1. **版本流对 iOS 字段有两个写入者(#669)**:bump 写 `App/Info.plist`,
   而每次 gen.sh(任何门或构建都会跑)的 xcodegen 会按
   `hosts/ios/project.yml` 再生该 plist——#655 在那里钉了 `0.1.0`。
   bump 对 plist 的写入从未活到提交;`check-tag-version.sh` 拒绝 tag 并
   逐项点名失配。修法:版本流改写 project.yml(生成源);守卫守源。
2. **`release-ios.yml` 丢了 D9 翻转的 gen 步(#670)**:Xcode 工程自
   #402(2026-10-07)起就是 gitignore 的生成物;dev/ios 装 xcodegen 并跑
   gen.sh("翻转的新鲜克隆证明"),release 管线却从未跟上——坏了 16 天,
   CI 看不见,因为 CI 的 ios 腿就是 dev/ios。修法:两步镜像进 release
   管线;iOS 包经 `workflow_dispatch` 带 `release_tag: v0.0.3` 重建
   (doc/release.md 恢复路径 #5——tag 停在被评审过的提交上)。

`release/android` 与 `release/harmony` 在第一次正确的 tag 上即成功;
三个资产都挂在 v0.0.3 release 上。

## 阻塞项

无。

## 复现

    gov run --every-gate
    build/build.sh build core
    build/build.sh build ios            # 需 #666 之后
    build/build.sh build ios --release
    node tools/test/sweep.mjs
    tools/test/run-simulator-matrix.sh --platform ios

日志保留在运行机的 `tmp/release-precheck/` 下。
