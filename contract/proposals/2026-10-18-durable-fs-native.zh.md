# 提案：持久化 fs 原语 —— fsPublishAtomic + fsSync（v1.11.0 候选）

> **状态：DRAFT（D5 提案——未冻结、未实现）。**
> [English](2026-10-18-durable-fs-native.md) | 简体中文

## 动机

Issue #571 确证：vendored jsonl 会话后端的持久化契约骑在一条满盘即静默
失败的写路径上——dsh-mobile 的 fs shim 的 best-effort 磁盘镜像吞掉
ENOSPC，而后端（钉住的 0.1.6-alpha.2 与最新的 0.2.1-rc.2 经 dist 读码
核实）本会忠实传播错误，却从未见过一个。真 fs 修复需要冻结契约缺少的
两项 POSIX 级能力：原子持久发布，与显式持久化屏障。

证据腿已作为 PR #587 落地（`src/dsh_fs_port.{h,c}` +
`example/fs_port_test.c`）：统一 C 接口 + 按平台宏分发，Darwin 实测
8/8，Android API-35 模拟器 8 过 + 1 实时 `PASS-POLICY_BLOCKED`，OHOS
交叉编译通过。该电池的两个事实塑形了本提案：

1. **Android SELinux 策略拒绝 App 域 link(2) 自己的数据文件**（M 起，
   策略原文 "Do not allow untrusted_app to hard link to any files"；
   实测：root 能链，shell 与 App 域不能）。jsonl 后端的 link 基地发布
   舞蹈在 Android 上已死——发布必须以 RENAME 为基地。
2. `fsync(2)` 对文件与目录在我们可运行的每个平台都可用（Darwin 实测；
   Android 经公开 API 预期可用；OHOS 经 C spine）。rename 之后的目录
   fsync 是 rename 本身的崩溃持久性——每个天真实现都会忘的那一半。

## 原语（两个，加性）

### 1. `fsPublishAtomic`

```
fsPublishAtomic(scope, path, bytesB64, opts?) → { bytes: n }
```

把 `bytesB64` 作为**一次原子持久发布**写入 `path`：同目录临时文件 →
写入 → fsync(文件) → rename(temp, path) → fsync(目录)。任一步失败时
目标文件原封不动、无临时残留。整段舞蹈在宿主侧作为一步执行——序列的
原子性正是意义所在，因此不从更小的原语组合。

拒绝遵循 §3：`invalid`（路径逃逸作用域、字节畸形）、`denied`（作用域
未授予）、`io`（写/fsync/rename 失败——原因串指名失败步骤）。审计遵循
§6：原语名、判定、字节数——绝无载荷字节。

### 2. `fsSync`

```
fsSync(scope, path, opts { kind: 'file' | 'dir' }) → {}
```

对单个文件或目录按路径的显式持久化屏障。目录打开使用平台具目录能力的
API（见下映射）。拒绝语法相同。

## 实现策略：各宿主原生平台 API

刻意沿用既有网关模式——各宿主说母语，C spine 只做调度桥（CLI 宿主保留
#587 的 C 实现作为它的母语）：

| 面 | iOS | Android | HarmonyOS | CLI |
|---|---|---|---|---|
| publish | Swift 直调 POSIX（电池验证） | 临时文件 + `FileChannel.force()` + `File.renameTo()`——**link 永不调用**（政策证据） | `fs.write` + `fs.fsync` + `fs.rename`（@ohos.file.fs） | `dsh_fs_publish_atomic`（#587） |
| sync 文件 | `fsync(2)` | `FileChannel.force()` | `fs.fsync` | #587 |
| sync 目录 | `fsync(dirfd)` | `android.system.Os.open` + `Os.fsync`（API 21+，公开 API） | SDK 允许处 `fs.fsync` 目录句柄；否则 C spine 的 `fsync(dirfd)`（gateway_smoke.cpp 已在该端编译） | #587 |

Android 的目录同步单元格用 `android.system.Os`——公开 Android API，
不是绕行：它正是平台为此类需求提供的文档化 POSIX 面。

## 非目标

- **不做 `link` 原语。** 在 Android 上对 App 域实测已死；一个无法在
  一等宿主上服务的契约原语是契约自身的缺陷。RENAME 基地发布在我们
  目标的每个 POSIX 文件系统上等价。
- **不做裸 `fsync`/`truncate`/`mkdtemp` syscall 镜像。** 契约暴露的是
  持久化意图而非 POSIX 管道；缺口分析（#571 线程）表明意图级原语已
  覆盖后端真实需要。
- **暂不做 append-durable 原语。** jsonl 后端的追加速度先由 publish
  （整工件重写）服务；`fsAppendDurable` 延后到有消费者证明需要。
- **不动 shim/VFS 世界。** session-persistence 的真 fs 挂载（这些原语
  的消费者）是独立后续，走自己的 boot-row 门。

## 备选方案

- **一份共享 C 实现（#587 层）接进每个宿主**：作为原语实现被否——
  差异是政策级（Android SELinux）与 API 级（各平台目录 fsync 面），
  且每个宿主已有 GatewayCore 调度 + 审计 + 作用域检查层，原生实现
  免费继承。#587 C 层保留为 CLI 宿主实现与跨平台电池。
- **到处 link 基地发布**（后端自己的舞蹈）：Android 政策已死——实测
  而非假设（#587 电池）。
- **从 JS 用现有 `fsWrite` + `fsRename` 组合发布**：temp+fsync+rename+
  dirfsync 序列的原子性无法跨两次网关往返保证；舞蹈必须是宿主一步。

## 证据

- fs-port 电池：PR #587（已并）——Darwin 8/8；Android 8 过 + 1 实时
  政策受阻行，含 `publish_despite_link_block` PASS；OHOS aarch64 musl
  交叉编译干净。
- 静默丢失的根因链：#580（哨兵）、#584（水位 guard）、#571 评论串
  （fs shim 镜像吞 ENOSPC；后端 dist 读码证明其自身不吞）。
