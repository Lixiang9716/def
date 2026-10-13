# 暂存清单往返证明:从四份手单到生成商店(2026-10-13)

[English](staging-manifest-roundtrip.md) | 简体中文

本笔记最初(2026-09-29)是四份手维护暂存清单的往返**证据**;它提出的工具
此后成为仓库的权威。今天清单是**生成的**:`tools/generated/staging/` 下的
声明/推导行商店,由 `tools/gen-staging-emit.mjs` 物化进宿主;其 `--check`
即阻塞级 `staging-generated` 门。本次重写记录已落地的事实(#413 校验器、
#420 清单商店、#485 closure/pin/zod 清单、以及 2026-10-13 收官:webclient
腿、规范化排序、shim 命名空间政策、生成器自身退役)。

## 1. emit 契约(取代往返报告的东西)

一个权威,一对动词:

```
node tools/gen-staging-emit.mjs --check tools/generated/staging   # 门(漂移退 1)
node tools/gen-staging-emit.mjs --emit tools/generated/staging    # 物化;正确树上零字节差异
```

- **generated = (derived − exclude) ∪ policy。** derived 行来自现实(导入
  图、物化 pin 树);policy 行是手声明的暂存决策、必须存在于盘。policy/
  exclude 文件可手编辑——一行的迁移就是 diff 里可见的暂存决策;derived
  文件绝不手改。
- **宿主块由商店机器拼接**(Index.ets 的 BUNDLE_FILES、stager 的清单块、
  py 块),顺序为**规范化排序**——排好序的清单就是清单本身,盘上商店与宿主
  源一致。机器块的任何手改或手重排都是漂移;正确树上 emit 是字节零操作。
- **vendored pin 的翻转契约**:物化 pin 树中的新文件只有经 `--emit`+提交
  才进入暂存清单(diff 里显式过目)。翻转前 find 生成的 span 现为商店中的
  `@walk` 标记行,check/emit 时对物化树重算——find 的自动性按设计消失。
- **check-staging 仍是第二张网**(`staging-check` 门):三个宿主的
  图→清单覆盖方向与清单→盘陈旧行方向,阻塞。

## 2. 商店清单(本提交的盘上计数)

| 商店文件 | 行数 | 是什么 | 拼接进 |
|---|---|---|---|
| harmony-BUNDLE_FILES.rows(+ .policy/.exclude) | 1227(policy 1078) | 推导图 ∪ policy − exclude | Index.ets BUNDLE_FILES |
| android-scenario.rows / android-web-live.rows(各含 .policy) | 17 / 14 | 宿主条目 policy ∪ 传递可达 | stage-spine-closure.sh 的 scenario+web-live for-in 头(stage+verify 孪生) |
| ios-RESOURCES.rows / ios-TREES.rows | 125 / 106 | 声明式接入表 + 镜像根 | gen_bundle_resources.py RESOURCES / gen_bundle_header.py TREES |
| harmony-closure{,-spine,-shelljs}.rows | 132 / 247 / 47 | vendor-official.sh 的拷贝清单(字面 policy + `@walk` pin span) | CLOSURE、SPINE_OURS、SHELLJS_PARSER_FACES 三个赋值 |
| android-pins.rows(`# block:` 分节) | 54 | stager 的 pin/face 名册 | 六个 stage+verify `for pkg in` 头 + 三个 SHELLJS_* 值 |
| ios-zod.rows | 79 | DERIVED:zod pin 的导入闭包(对 py 的 ZOD_ROOT 跑 zodClosureRows) | py 的 ZOD_FILES 块 |
| webclient{,-v2,-compact,-mini}.rows | 3 / 16 / 4 / 3 | 每个暂存 web client 的声明随发文件清单 | 无——stager 整树拷贝;商店是门判断产品树、镜像与 iOS 声明的依据 |
| shim-namespace.policy.md | — | 「推导不可见行」的记录性声明 | — |

受 code-size 门拆分的卫星模块:`gen-staging-emit-hosts.mjs`(android+ios)、
`gen-staging-emit-closure.mjs`(closure/pin/zod 三腿)、
`gen-staging-emit-web.mjs`(webclient 腿;兼独立 CLI 供 presentation
runner 使用),机制在 `gen-staging-legs.mjs`。

## 3. 各腿推导 vs 声明

- **推导**:harmony 图闭包(boot 根 + 暂存 scenario 上的 walkGraph);
  android scenario/web-live 的传递导入;zod 闭包(pin 自身的相对导入
  图);所有 `@walk` span(domino/turndown-plugin-gfm libs、goal 三连、
  14 个 dsh spine pin——对物化树重算)。
- **声明**:哪些 scenario 暂存;以 dsh 相对路径暂存的 npm faces;accessor
  后缀(Swift 链接符号);镜像根;随发文件清单;harmony closure 块的每个
  字面行。
- **按设计不可推导**:shim 命名空间与桥接解析的 npm faces——见
  `tools/generated/staging/shim-namespace.policy.md`,它回答了本笔记旧
  §4 的悬案(C bare map 与 `__dshModuleDefine` 表是 JS walk 有意不可见的
  数据)。该文件即这一边界的记录性声明,含接受的残余风险(C 表有行而清单
  无行时 CI 不可见)及其缓解。

## 4. 剩余手维护面(诚实的零)

拷贝**名册**已全部归商店所有——最初四份手单没有一份仍以手单形式存在。
仍为手写的是组装与构造,不是名册:

- vendor-official.sh 的 CLOSURE **组装尾块**(llm.js、manifest.json、平面
  scenario、system-plugins 行)——缝合各商店块的那一行,仍带自己的字面行;
- 脚本侧按**整体**而非清单的暂存块:npm-face 暂存调用、MOBILE 预设 cp 块、
  NOBLE_DIR/PIAI_DIR 整 pin 扫描、webclient find 循环;
- android stager 的整目录镜像(upstream/、system-plugins/——构造性免漂移)、
  其 12 文件 dsh 根清单、RETIRED_PLUGINS 座位表;
- ios 嵌入器的 WEBCLIENT_TREES(由 web 腿对照 webclient 商店家族判定)。

## 5. 字节不变量

翻转改变的是「谁写清单」,从未改变被暂存的字节:每次落地后
`sh build/build.sh sync android && sh build/build.sh sync harmony` 再生暂存
树均**零漂移**(assets/、rawfile/ 与 iOS Generated 包 porcelain 干净),且
组装后的 shell CLOSURE 值与翻转前的 eval 逐字节 diff 相等。本次收官的规范
化排序按设计重排拼接块——行的**集合**不变,因此每个被拷贝文件不变;每次
落地由双 sync 证明。

## 6. 复现

```
external/ensure-dsh.sh                                   # 物化 vendored pins
node tools/gen-staging-emit.mjs --check tools/generated/staging   # 门:绿
node tools/gen-staging-emit.mjs --emit tools/generated/staging    # 正确树上零操作
node tools/gen-staging-emit-web.mjs --check tools/generated/staging  # webclient 家族独立面
node tools/check-staging.mjs --block harmony,android,ios # 校验器:绿
sh build/build.sh sync android && sh build/build.sh sync harmony  # 暂存树零漂移
node tools/check-asset-mirrors.mjs                       # 阻塞级跨宿主字节面:绿
```
