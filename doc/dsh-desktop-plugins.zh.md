# dsh-desktop 插件接入账本

[English](dsh-desktop-plugins.md) | 简体中文

本文件记录"完全接入除 Electron 之外的所有 dsh-desktop 插件"在本仓库的
账目：上游有什么、本仓库接入了什么、下一步排期是什么、什么被排除以及
原因。上游在 `0.1.6-alpha.2` 锚点的面：**293 个已发布的
`@deepseek-ai/dsh-*` 运行时/客户端包**（上游
`vendor/dsh-runtime/0.1.6-alpha.2/manifest.json`）加 **5 个桌面产品
workspace 包**，共 298 个。

"接入一个插件"指走仓库七条接缝之一：运行时服务插件（`upstream/boot.js`
的 `mountSpine`）、ToolRuntime 上的工具包、vendor 锚点
（`vendor/ensure-dsh.sh`）+ shim 行（`upstream/shims/` 与裸名映射）、
被认领的 web API 面（`upstream/web-write.js`）、staged 客户端 bundle
（`presentation/official-web/client-bundles/`）、自研系统插件
（`system-plugins/`），或宿主能力（`hosts/*/`，受契约约束）。

## 已接入（本宿主；以 #507 后的 main 为准，2026-10-15 刷新）

| 层 | 包 | 方式 |
| --- | --- | --- |
| 运行时主干 | session、agent、system-prompt、tools、session-projection、settings、agent-loop、llm（传递引入 sandbox、scope、brand、invariants、timeout、typert-protocol、util-crypto、util-values）+ 子代理控制面（dsh-subagent + session-query） | `mountSpine`，逐字 vendored 包 |
| 预设数据源 | agent-presets + cordis-plugin-loader（连带 home-paths、atomic-write、js-yaml） | 真·上游服务；一个 Loader 同时服务 presets 注入与客户端组装（T-0035） |
| 文件工具行 | fs-local、tool-fs、tool-str-replace-editor、attachment（+ npm diff） | 内存工作区世界跑 vendored fs-local 后端；read/write/edit + str_replace_editor 注册进 ToolRuntime（T-0035） |
| 工具移植 | tool-todo；自研工具行——open-design、plugin-manager（`plugin_manager`）、create（`plugin_create`）、office（OOXML 编写工具）；`dsh-shell-js` 自 2026-10-11 起持有 `shell` 席位，`dsh-shell-wasm` 仅为引擎门保留 | ToolRuntime；背后是契约 fs 原语 / `wasmRun`（`dsh-shell-ish` 已随 iSH 引擎于 2026-10 退役） |
| 技能与交互行 | 技能（dsh-skill + skill-filesystem `watch:false` + tool-skill）；命令（dsh-commands + command-feedback）；目标（dsh-goal + command-goal）；文件引用（dsh-file-reference-local） | 门控 boot 行（`options.skills/commands/goals/fileReferences`）；已接入三宿主的 serve 席位 |
| Web 面 | dsh-web + tool-web——仅 `web_search`，走无密钥 DuckDuckGo 提供方 | `mountWebPlane` 跑在网关 `httpFetch` 上；`web_fetch` 在 fetch 提供方出现前保持关闭 |
| MCP client（streamable-HTTP） | @modelcontextprotocol/client + core（连带 jose、eventsource、pkce-challenge） | 产品闭包锚点（`external/ensure-dsh.sh`，2026-10-20）+ `upstream/mcp-http-transport.js` 跑在网关 `httpFetch` 上；仅 CLI 证明——尚未 staged 进三宿主 bundle，也未挂为工具行；stdio 仍排除 |
| 会话持久化 | dsh-session-persistence-jsonl（逐字 vendored；桌面的 koffi/flock 原生行由 flock shim + 编译内联的 zstd 应答） | 门控 boot 行，三宿主 serve 席位均接线 `sessionPersistence: true`（#463）；逐宿主验证强制杀死后的重启恢复 |
| 官方 web 层 | 58 包应用层 + 5 个 shell 静态模块 + 构建出的 SPA | staged 客户端 bundle 在运行时组装，由 carrier 服务 |
| 镜像 API | api-session-controller、api-settings-controller 的行为 | 写面板（web-write.js）——真正的控制器包未挂载 |
| Web API（T-0035 + #335） | pluginInventory/list、agentPresets/list\|read\|copy\|deletePreset\|select；pluginManager 的 list 腿与写腿——installBundle\|removeBundle\|setBundleEnabled\|setPluginEnabled\|inspect 走真实 §4 安装管线 + 回执日志 + dsh.plugins/1 注册表（cancelInstall 应答 `not-running`）；会话深页腿（page\|search\|rename\|updateQueue\|fork\|selectModel\|cancel\|delete）、subagents/*、workspaceFiles/*（+ `fs/observed` 流）、marketplace/install、dynamicCordisRunner 各腿、credentials/describe、session/modelCatalog、`permissionPresets/catalog`（诚实空表） | 已认领端点；workspace 层是安全边界（只收裸注册表名） |

## 排期中（以 #624 后的 main 为准，2026-10-20 刷新）

上一版单段清单双向过时了：大多数项其实落了，另有一员被证伪为墙。
以下逐项按文件级证据重判。

### 其间已落

- **shell/终端栈**——`dsh-shell-js` 持有 `shell` 席位（2026-10-11）；
  `ishRun` 退役，dsh-shell-ish 树于 2026-10-14 整体移除
  （`upstream/boot.js` shell 席位注释；`system-plugins/dsh-shell-js/`）。
  #505 的 `s///` 拒绝措辞修正只是措辞——方言边界未动。
- **持久化/恢复**——vendored `dsh-session-persistence-jsonl` 后端挂在
  `options.sessionPersistence` 之后（`upstream/boot-session-persistence.js`；
  默认根 `<cwd>/dsh/sessions`，zstd），三宿主 serve 席位均接线
  `sessionPersistence: true`（#463：`hosts/ios/App/Source/SessionServe.swift`、
  `hosts/android/.../SessionServe.kt`、
  `hosts/harmony/.../OfficialServe.ets`），逐宿主验证强制杀死重启腿
  （`hosts/*/artifacts/session-persist-restart/`、
  `runtime/dsh/web-live/session-persist-restart-core.js`，CLI 腿
  `runtime/dsh/artifacts/macos-cli-session-persistence/`）。剩余后续：
  页面会话清单合并/重挂接缝（e2e-matrix 已知缺口，2026-10-12）。
- **技能（fs 发现）**——dsh-skill + skill-filesystem（`watch:false`——
  无 fs 事件接缝）+ tool-skill 挂在 `options.skills` 之后
  （`upstream/boot.js mountSkillPlane`）；三宿主均交付 staged 技能目录；
  E2E `runtime/dsh/scenario/agent-flow.js`。
- **commands/goals（连带 file-references）**——交互行挂在
  `options.commands/goals/fileReferences` 之后
  （`upstream/boot-coverage-rows.js`）；已接线三宿主 serve 席位；CLI 证据
  `runtime/dsh/artifacts/macos-cli-seam-inventory/`。
- **web 工具（搜索半边）**——dsh-web + tool-web 以
  `search: true, fetch: false` 挂载，搜索走 `httpFetch` 上的无密钥
  DuckDuckGo 提供方（`upstream/web-search-keyless.js mountWebPlane`；
  tool-web 预设行已于 2026-10-03 移出移动端缺席集，
  `upstream/preset-mobile-rows.js`）。
- **workspace-files 与文件侧栏**——workspaceFiles 读族
  （stat/list/read/readAll/readBytes/readRelated + `fs/observed` 变更流）
  由真实 vendored `fs` 服务应答（`upstream/web-write-files.js`）；侧栏
  变更 + 归档集走工作区注册表（`upstream/web-write-workspace.js`）；
  探针 `runtime/dsh/scenario/api-coverage-probe.js`。
- **plugin-manager**——工作区注册表之上的 `plugin_manager` 工具
  （`system-plugins/dsh-plugin-manager-tools`，#346），且写腿已认领
  （#335 A1）：install/remove/enable/inspect 走真实 §4 安装管线 +
  回执日志（`upstream/web-write-plugin-manager.js`，认领于
  `upstream/web-write.js`）。旧的"写腿有意不认领"表述作废。
- **会话质量层，先落的三片**——compaction（token-meter +
  compaction-basic 挂在 `options.compaction` 之后，
  `upstream/boot-compaction.js`；CLI 证据
  `runtime/dsh/artifacts/macos-cli-upstream-compaction/`）；persona 前缀
  （SystemPrompt 配置，`upstream/boot.js`）；手动标题（`session/rename`，
  镜像 dsh-session-title 语义，`upstream/web-write-session.js`——无自动
  生成）。
- **审批/提问，服务半边**——dsh-user-questions 已 vendored；
  UserQuestionService 经 `presetJoin` 下的组合宿主面挂载
  （`upstream/boot-coverage-rows.js mountCompositionHostPlane`）；
  Harmony serve 席位加入默认预设
  （`hosts/harmony/.../OfficialServe.ets`）。插件审批走网关
  `presentApproval` 原语（`system-plugins/dsh-ui`）。
- **streamable-HTTP 上的 MCP client**——vendored 的
  @modelcontextprotocol/client@2.0.0（连带 core、jose、eventsource、
  pkce-challenge）自测试表转正进产品闭包（`external/ensure-dsh.sh` 的
  MCP CLIENT 行，2026-10-20）；streamable-HTTP 传输经
  `upstream/mcp-http-transport.js` 跑在网关 `httpFetch` 上（vendored 的
  `StreamableHTTPClientTransport` 组合在 `gatewayFetch` 之上——
  `upstream/fetch-gateway-bridge.js` 的导出）；CLI 证据
  `runtime/dsh/artifacts/macos-cli-mcp-streamable-http/`（腿
  `runtime/dsh/ci/run-mcp-streamable-http-e2e.sh`，`build.sh test core`）。
  剩余边界：宿主闭包 staging（iOS TREES / harmony CLOSURE / android pin
  行 + `build/build.sh sync`）与 MCP 工具行挂载是下一步——client 今日仅是
  产品闭包/CLI 面；stdio 传输仍留在物理不可能集（见下）。

### 仍在排期

- **网关 fs 作用域之上的 fs + tool-fs-search**——文件工具行仍跑内存
  工作区 VFS（真实磁盘直写镜像提供了持久性，但 VFS 仍是记录世界，
  `upstream/shims/fs-workspace.js`）；tool-fs-search 的引擎是
  @vscode/ripgrep 打包二进制——等子进程/fs 服务接缝
  （`external/ensure-dsh.sh` 的 tool-fs-search 跳过项；
  `upstream/README.md` 映射表 ripgrep 行）。
- **web fetch + 有密钥搜索**——`web_fetch` 关闭（`fetch: false`——
  `httpFetch` 上还没有 fetch 提供方）；`web-fetch-http` 未 vendored；
  无密钥提供方之旁的有密钥提供方是已记录缺口
  （`upstream/web-search-keyless.js` 诚实边界头注）。
- **其余席位的提问面**——tool-ask-user 已由探针证实
  （`runtime/dsh/scenario/interactive-circle-probe.js`），但今日只有预设
  join 路径可达（Harmony）；iOS/Android serve 席位未传 `presetJoin`；
  `dsh-user-approval` 仍未 vendored（subagent 的 ctx.get() 软 peer，
  `upstream/README.md`）。
- **compaction 宿主接线**——boot 行已由 CLI 证明，但尚无 serve 席位传
  `options.compaction`；`/compact` UI 集成是已登记的已知缺口
  （e2e-matrix，2026-10-12）。
- **标题（自动）/ plan-mode / permission-presets**——dsh-plan-mode 已
  vendored 但仅通过加载验证（interactive-circle 探针未挂载它）；标题
  自动生成未携带（`session/rename` 仅手动）；`permissionPresets/catalog`
  应答诚实空表（`upstream/web-write.js`），dsh-permission-presets 未
  vendored。
- **tool-cordis**——运行时侧两条腿已应答（#335 B3），但该工具的线需要
  仅 vendored cordis-host-runner 提供的 `cordisInspect` HOST 服务
  （`upstream/preset-mobile-rows.js`）。

每条仍在排期的行都是一次 vendor 锚点 + shim 行 + 一次挂载——文件工具行
（T-0035）是模板。

### 新证为排除

- **workflow 家族**——`workflow-ptc`（其受限访客域就是 `node:vm`——
  子进程级接缝，`upstream/README.md` shim 表）、`tool-workflow`（其唯一
  引擎在被墙的 PTC 宿主 runner 上；常挂会让该行停摆——2026-10-08 实测，
  `upstream/preset-mobile-rows.js`）、`tool-presentation`（同乘该
  runner）。旧"commands/goals/workflows"项的第三员无法落在本锚点；
  commands 与 goals 两半已落（见上）。

## 已排除，含原因

- **Electron 层（所有者的排除项）：** `dsh-plugin-desktop`、
  `dsh-plugin-desktop-beta`、`dsh-desktop-next`（其依赖清单是接入
  checklist，不是要移植的代码）、`dsh-community-market`、
  `dsh-community-fabric`（纯文档）。
- **本宿主物理不可行（无契约原语，也无隐含路径）：** browser/
  computer-use（驱动桌面 GUI）；ssh、subprocess-ssh、http-proxy、
  lsp-stdio、mcp stdio（原始 TCP 套接字——网关只有 `httpFetch`）；
  win32/pwsh 各行；原生插件行（`session-query-sqlite`、
  `storage-sqlite`——koffi/sqlite；`session-persistence-jsonl` 已随
  vendored 逐字后端接入而移出本集——见"已接入"）；外部 CLI 编排器
  （hooks/subagent-claude-code/-codex）；worker 线程行（单串行运行时，
  决策 D2）；`office-to-pdf`（LibreOffice 二进制）；桌面入口机械
  （`host-webserver`、`cmdline`、`headless`、`app-boot`——已被本仓库
  的 carrier + boot 替代）。
- **仅测试/构建期：** testkit、loader、replay/mock server、
  hmr/生成器工具——只在产品包需要时按需 vendored，永不挂载。

## 证据

- `runtime/dsh/artifacts/macos-cli-settings-surfaces/` —— CLI 上应答
  的预设名册（cordis/minimal/ptc/standard，标记部署默认）与插件清单
  （16 行主干 + 58 个客户端 bundle + 4 个组合），12/12 期望↔日志。
- `runtime/dsh/artifacts/macos-cli-tool-fs/` —— 走真实工具分发的
  create/read/write/edit/view/str_replace，含边界拒绝。
- `runtime/dsh/artifacts/macos-cli-upstream-compaction/`、
  `macos-cli-session-persistence/`、`macos-cli-seam-inventory/` ——
  门控行的 CLI 判定（compaction 39/39；跨两进程的 create→resume；
  presetJoin 交互席位）。
- `hosts/ios/artifacts/b4-write-live/` —— 设备上的同一批面，由 b4
  驱动断言（以日志为准；`screens/` 里的截图仅作人的证据）。
- `hosts/*/artifacts/session-persist-restart/` —— 三宿主的强制杀死
  重启家族。
