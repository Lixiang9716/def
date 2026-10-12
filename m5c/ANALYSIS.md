# Seat m5c — feat/harmony-httpfetch

**Summary**: seat 干净得只剩 4 个已跟踪文件的未提交改动——全是 httpFetch 上桥这一特性的早期 WIP 草稿，其语义内容已被 main 在合并后以更好的实现整体接住（#402 重构删除了 spike host、重写了 napi phase host 与 smoke 网关），故全部判 junk（superseded）；无 untracked、无 .gov/ 脏文件、无需要打捞的 main 缺失内容。

- Seat: `/Users/lixiang/workspace/dsh-mobile-m5c`，分支 `feat/harmony-httpfetch`，HEAD `f68056ae`（经 `git merge-base --is-ancestor HEAD origin/main` 验证为 origin/main `98869dd1` 的祖先——分支已随 PR 并入 main，工作区只是旧树 + 未提交草稿）。
- 审计命令：`git -C /Users/lixiang/workspace/dsh-mobile-m5c status --porcelain`；每文件 `git -C <seat> diff origin/main -- <path>`；`git -C <seat> diff HEAD > tracked.patch`（178 行，已归档）。
- Untracked：无（porcelain 输出零 `??` 行），故无文件拷入归档目录，也无 >5MB/vendor 产物需要记 note。
- Ledger-residue：无（无 `.gov/` 路径），故按步骤规则未生成 SALVAGE-NOTES.md。
- 各文件 `diff origin/main` 行数（均非空）：gateway_smoke.cpp 392 / gateway_smoke.h 73 / napi_init.cpp 679 / dsh_spike_host.c 772。非空的原因不是「未落地的活」，而是 main 在合并后又大幅演化了这些文件（`git diff HEAD origin/main --stat`：gateway_smoke.cpp +257/−34，gateway_smoke.h +13/−12，napi_init.cpp +213/−119，dsh_spike_host.c −745 整文件删除）。

## Per-file verdicts

| path | verdict | note |
|---|---|---|
| `hosts/harmony/entry/src/main/cpp/gateway_smoke.cpp` | junk | 未提交改动（httpFetch 从 unavailable 挪进 available、smoke_serve 转发 `httpFetch`/`httpFetch.abort`）已被 main 的演化实现取代：origin/main 版同文件把 httpFetch 放进 available 描述符（第 82 行）并转发 httpFetch 与 httpFetch.abort 控制面（约 485–524 行，转发集合远大于 WIP 的两个名字）；WIP 草稿补不到 main 的代码结构上。 |
| `hosts/harmony/entry/src/main/cpp/gateway_smoke.h` | junk | 仅注释更新（前向集合描述加 httpFetch/httpFetch.abort）；main 的 cpp 早已如此运作，main 版头文件注释仍留旧措辞——纯文档残渣，无功能内容，不构成可打捞工作。 |
| `hosts/harmony/entry/src/main/cpp/napi_init.cpp` | junk | WIP 的三个点全被 main 更好的实现覆盖：scenario 名进 verdict 行 → main 用 `run_scenario(..., scenario)`/`verdict_line(scenario, …)` 线程化传名（约 116–196 行）；host_event 2048→32768 固定缓冲 → main 改为动态 malloc 缓冲并明确注释 http.body 16KB→~22KB、超长必须 throw 不许截断（约 595–624 行）；settle 2048→4096 未被采纳（main 重构后仍 2048）。 |
| `runtime/spike/host/dsh_spike_host.c` | junk | WIP 给该文件加的 `abort_target()`（解析 `body:<callId>`）所依附的文件在 main 已被 #402（`2dc9e7c3`，spike/m4/m5 代号语义化重构）整个删除（`git diff HEAD origin/main --stat`：−745 行）；`body:<callId>` 容错在 main 由 ArkTS 侧 `hosts/harmony/entry/src/main/ets/model/HttpFetch.ets:189-192` 的 `abort()` 承接。 |

## Salvage

`salvageFiles` 为空：无 `.gov/` 脏文件；四份未提交改动的语义内容均已以演化形式存在于 main（逐点核对见上表 note），无 main 缺失的内容需要打捞。全部原始改动已完整保存在本目录 `tracked.patch`。

## Archived artifacts

- `tracked.patch` — `git diff HEAD` 全量（178 行）。
- 无 untracked 拷贝（不存在 untracked 文件）。
- 无 SALVAGE-NOTES.md（无 ledger-residue 文件，步骤 4 的写入条件未触发）。
