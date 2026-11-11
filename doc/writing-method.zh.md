# 写作规约

[English](writing-method.md) | 中文

落入本仓库产品面（`runtime/`、`system-plugins/`、`presentation/`、
`packages/`）的一切代码，遵守以下八条。文体沿袭
[defensive-patterns](../third-party/deepseek-harness/docs/defensive-patterns.md)：
每条 = 规则一句 + 后果一句，所指（referents）给出该实践已被验证的位置。

**出处。** 源自 2026-11-11 对 vendored 上游参照的全量扫描——
`third-party/deepseek-harness/docs/` 下的文档与 `external/dsh@0.1.6-alpha.2`
下的 pinned 包源码——并与社区骨架决策对齐（anywhere-labs/dsh-desktop；见
[dsh-desktop-plugins.md](dsh-desktop-plugins.md)）。决策记录是 2026-11-11 的
塌层笔记（../.agents/notes/implemented/architecture/2026-11-11-collapse-the-dual-capability-planes.md）。

**门禁状态。** 每条标注该规则当前由命令强制（给出 `gates.json` 的门 id），
还是暂为约定、由评审执行、待立门（seam-collapse 程序的 P3 阶段把可检查的
约定升级为门）。

## 1. 先落位，否则不是产品内容

产品内容只允许两种形态——插件（`dsh-plugin-*` 包；本仓的外置实例即
`system-plugins/dsh-*` 包）或组合声明（bundle/patch 数据）——宿主只贡献
特权层、网关绑定与渲染器。行为落在其他任何地方——挂进宿主的模块、混进
boot 的一次性脚本——都会长出第三个能力逻辑的栖身之所，此后每次审计都得
为它付费。

词汇借自社区 DSH Desktop 骨架（`dsh-plugin-*` 包、`apps/fabric` 的
vendored 组合；本仓实际 pin 的是其 `vendor/` 面——external/ensure-dsh.sh:101）。

*门禁状态：* 暂为约定待立门（`staging-*`/`closures` 门只管暂存文件去哪儿，
不管新产品内容的形态）。

## 2. 三角色先认后写

新能力先指认它的 Service Definition（vendored 或 owner 包）、Provider
（def）与 Consumer——并把指认写进包 README——而 Service Definition 是
Cordis Service，绝不是 TS interface。角色未指认的能力会悄悄长出第二份
实现，这正是 2026-11-11 fs 塌层笔记记录的双面病。

参照即 seams 表的 owner/implementations/consumers 三列
（third-party/deepseek-harness/docs/capability-seams.md）与 primer 的服务
模型（cordis-primer.md："A plugin is a object [sic] that implements
Service"；依赖按 `ctx.<key>` 解析，不按 import）。

*门禁状态：* 暂为约定待立门。

## 3. 插件形态唯一；配置先校验后执行

插件是 `{name, inject, apply}` 加 Schemastery Config（TS interface 与同名
schema），依赖用 `inject` 声明、永不依赖挂载顺序，且每个注册都带 disposer。
校验先行，坏配置在挂载时就让 fiber 失败（FAILED），而不是运行中途引爆；
`inject` 声明让组合与顺序无关；缺 disposer 则注册在 reload 与 teardown 间
泄漏。

形态出自上游 primer（cordis-primer.md："Declare service dependency via
`inject`"；"Every registration should have a disposer"），vendored closure
里俯拾皆是（如 runtime/dsh/upstream/boot.js 的 llm-retry 挂载注释：
"Exports {Config, apply, inject, name} and no default — the namespace
object IS the plugin"）。

*门禁状态：* 暂为约定待立门（`quickjs-boot-parse` 只抓 boot 图解析错误，
不管配置 schema 校验）。

## 4. 工具声明完整契约；策略住在管线里

工具交付完整的 `defineTool` 契约——参数 schema、强制的 `output.schema`、
纯函数的 `output.render` 投影、卡面意图的 `presentationMeta`——策略只写成
管线五位的 listener（`tools/pre-execute`、guard、`tools/execute`、
`tools/post-execute`、`tools/result`），原生卡面消费 render-intent。策略
走私进工具体，就绕过了注册表的 guard/post 位——审计与权限旗标再也看不见
它——并破坏重放，因为模型可见投影不再是以 (args, value) 为入参的纯函数。

契约住在 vendored 类型里（external/dsh/tools@0.1.6-alpha.2/lib/types/
index.d.ts:16 的 `defineTool`；`render`/`presentationMeta` 在 :100-105 声明
为纯函数；`output` 在 :110 为强制）；五位出自注册表自己的话（"pre/guard/
around/post/result"，external/dsh/tools@0.1.6-alpha.2/lib/index.js:2492；
capability-seams.md 的 `ctx.tools` 行点名的正是这五位）。

*门禁状态：* 暂为约定待立门。

## 5. 先选事件域，遵守派发模式，waterfall 中委托（next()）

自造事件名之前先选事件域——持久事实 = session event，拦截进行中工作 =
`agent/*`，附加策略 = capability 事件（`fs/*`、`tools/*`）——按五种已文档
模式之一派发，而装饰/观察型的 waterfall listener 必须调 `next()`。装饰
listener 不调 `next()` 就返回，等于短路 around-middleware 链，悄悄吞掉全部
下游 listener；自造名字则躲开已声明的模式，consumer 永远绑不上。

语义出自 primer（cordis-primer.md：emit/waterfall/parallel/serial/bail 五
模式；"return without `next()` to short-circuit"）；扩展点矩阵就是名字
登记处（event-producer-consumer.md：`fs/write-intent`、`fs/edit-intent`、
`fs/observed`、`tools/pre-execute`、`tools/execute`、`tools/post-execute`、
`tools/result` 全是已声明行）。

*门禁状态：* 暂为约定待立门。

## 6. 模型可见即已记录

凡进入模型请求的内容，必须能从 session log 重建，因此新的模型可见输入以
新的 session event 落账，且一切投影保持纯函数。不可重放的输入让下一轮
变得无法解释——调试、压实、跨设备续跑（D7）读的都是日志，缺口读出来的是
"模型行为异常"，而不是记录缺陷。

*门禁状态：* 暂为约定待立门。

## 7. 文档带自重；一个事实一个家

包 README 写明它的 Model Experience（模型看到什么 / token 效果 /
KV Cache 效果），并带强制的 Known Limitations 段；一个事实只住一个家；
目录文档逐步迁到「生成 + 完整性卫兵 + verify 门」，不再手编表格。README
缺模型面自重，每个 consumer 都得从零重测 token；事实有两个家就会漂移——
读到重复事实的人拿到的永远是过时那份。

README 约定就是 vendored 包自己的规矩（external/dsh/tool-todo@0.1.6-alpha.2/
README.md：`## Model Experience` 与 `## Known Limitations and Deferred
Work`）；本仓生成文档的样板是 e2e 矩阵（`test/e2e/matrix.mjs --out` 再生成，
由 `e2e-matrix` 门把守）。

*门禁状态：* 暂为约定待立门（已有一例已立门：`e2e-matrix`；`doc-crosslinks`
只守链接完整性）。

## 8. 验证世界，不验自述

凡承载行为的改动都带齐四条腿——场景腿（E2E by logs，唯一 `scenario-id`，
期望↔日志一一对应）、真实组合 boot 断言、注册表 HMR 安全测试（dispose 挂载
fiber，断言清理）、parity 差分腿——因为绿色的自述不是证据。跳过腿的改动，
上线的就是挂载顺序碰巧做出的行为：2026-10-11 的 shell 换座正是在插件首次
被 boot 时抓出两个潜伏缺陷。

各腿的家：doc/ARCHITECTURE.md（"every E2E scenario carries a unique
`scenario-id`"）、上游测试标准（third-party/deepseek-harness/docs/
testing.md："Every registry gets an HMR-safety test (dispose the
contributing fiber, assert cleanup)"）、以及 sweep 驱动读取的已提交差分账
（test/upstream-suite/differential-ledger.json）。

*门禁状态：* 部分已是门——`e2e-matrix` 守住覆盖矩阵、`test-taxonomy` 管住
套件分类；四条腿本身暂为约定待立门。
