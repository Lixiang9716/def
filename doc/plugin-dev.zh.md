# dsh-mobile 上的插件开发——与上游教程一一对应

本文是上游「第一个插件」教程(deepseek-harness 文档 → develop → basic)的移动端对应物:该教程讲授的每一项能力在移动宿主上都存在,走同一套 cordis 形状,由 `plugin.forms` E2E 腿实证(`runtime/dsh/ci/run-plugin-forms-e2e.sh`,回执在 `runtime/dsh/artifacts/macos-cli-plugin-forms/`)。

## 插件是什么

与上游完全一致:一个导出 `apply` 函数、接收 cordis `ctx` 的模块。三种形态都是一等公民(挂载链全部归一,`runtime/dsh/plugin-mount.js`):

| 形态 | 入口形状 | 用途 |
| --- | --- | --- |
| 对象 | `export const name/inject/apply`(或同样内容放 `default` 下) | 默认选择 |
| 函数 | `export default (ctx) => {}` | 最小插件 |
| 类 | `export class X extends Service`(单一类/函数导出会被自动选中) | 向其他插件提供服务的插件 |

```js
import { Service } from '@deepseek-ai/cordis';   // 设备上可解析(钉版 vendored 副本)
export class MyService extends Service {
  static inject = ['tools'];                     // 依赖先就绪,插件后加载
  constructor(ctx) { super(ctx, 'myService'); }
}
```

`inject` 的语义与上游一致:框架只在被点名的服务就绪后才加载插件。

## 声明 effect(以及必须知道的一个语义)

通过 `ctx` 注册的一切(监听器、工具、定时器)在卸载时自动清理。手工资源(网络连接等)用 `ctx.effect`——在 vendored 的 `cordis@4.0.2` 里,回调**立即作为 setup 执行,返回值才是清理器**:

```js
import 'upstream/shims/timers.js';

export const apply = (ctx) => {
  ctx.effect(() => {
    let beats = 60;
    (async () => {
      while (beats > 0) {
        await new Promise((r) => setTimeout(r, 1000));   // one-shot 重臂
        beats -= 1;
      }
    })();
    return () => { beats = 0; };                          // setup 返回清理函数
  });
};
```

timers shim 是这些全局量的唯一来源,且按契约 `setTimeout` 是一次性的——重复靠调用方重臂循环。`setInterval` 以重臂 polyfill 的形式存在,但回调一抛错整个循环就停;纪律做法(也是 `plugin_create` 创作契约的要求)是重臂循环。

## 插件如何挂载(移动端的差异点)

手机上没有 `pnpm dsh web`;三条注册路径对应教程的 `cordis.yml` insert:

1. **聊天创作**(产品路径):让 agent 做一个插件——模型书写插件树,原生审批门征询你,插件活挂载(`plugin-mount.js`:read → validated → approved → adopted → linked → mounted)。
2. **市场**:签名包经市场面安装——同一注册表,同一启动行为。
3. **开发者推送**(教程的迭代环):`tools/plugin/dev.sh` 在开发机上编译你的 TypeScript(**设备永不编译——只解释预构建字节**),暂存进模拟器的应用容器并启用注册表行。重启应用即把所有 ENABLED 的注册表行在脊柱启动时挂载——与教程 `--patch` 层的一一等价物(同样是每次启动生效):

   ```sh
   tools/plugin/dev.sh my-plugin/            # 编译 → 暂存 → 启用 → 重启
   ```

   `my-plugin/` 就是教程 scratch-plugin 的移动端拼写:`plugin.json`(`{id, name?, version?, entry?, capabilities?}`)+ `src/index.ts`(或 `.js`,原样透传)。

## 聊天创作插件契约(plugin_create)

聊天路径就是 `plugin_create` 工具(`system-plugins/dsh-create`);工具描述是面向模型的权威文本,本节是同一份契约的人读版:

- **触发**:任何「做一个可运行的东西」的请求(插件、应用、番茄钟、日历、倒计时、打卡……)都必须以模型**首条回复**里的 `plugin_create` 调用作答——不用文字代替,也不询问确认。
- **两种创作面**:`indexSource`(作者自己的 cordis 插件——上面的对象/函数/Service 类三形态)或生成模板(`kind: "timer"`——倒计时,需要正的 `durationMs`;`kind: "calendar"`——今日日期面)。这两者是**仅有的**模板 kind:不带 `indexSource` 的其他任何 `kind` 会被拒绝并返回支持的列表;而**带上** `indexSource` 时,`kind` 是清单里的自由字段。
- **创作契约**——每条违反都会以 `step` + `reason` 拒绝挂载:
  - `apply` 在挂载时执行一次;资源一律经 `ctx.effect`/`ctx.on` 注册并**返回**清理器(setup 立即执行,返回值就是清理器——返回 Promise/generator 收集异步清理器,null/undefined 表示无清理器,其余类型抛 `TypeError`)。
  - 定时器先 `import 'upstream/shims/timers.js'`,并遵守 ONE-SHOT 重臂纪律。调用 `setInterval` 的 `indexSource` 仍会挂载——结果里会附一条非阻断 warn,因为 polyfill 的循环一遇回调抛错即停。
  - import 只经装载器裸名映射解析(运行时 bundle 根模块 `logger.js`、`gateway.js`、`plugin-mount.js`、`workspace-registry.js`、`llm.js`、`upstream/shims/timers.js`;被 shim 的 `node:` 内建;钉版的 `@deepseek-ai/dsh-tools`、`@deepseek-ai/cordis`、`@deepseek-ai/schemastery`、`@deepseek-ai/dsh-llm`、`zod`,以及闭包自己的 npm 钉版如 `js-yaml`——以上即受支持面)。映射解析不了(或 bundle 树上不存在)的一切都会在链接步失败(`linked`)。
  - LLM 适配器必须 `class X extends LlmAdapter` 并实现 `async *stream(options)`——裸对象会在 `registerAdapter` 处以 "not a function" 失败;每次 provider HTTP 请求必须带 `attributionHeaders()`。
  - 卡面是插件自己发的 `__dshBusPost` JSON 行。`card.id` 是唯一的必填字段(缺失时每家宿主都整条静默丢弃);只有 `kind: "timer"` 有倒计时面(`durationMs` 是本地补间锚点);`card.state` 只读 `{remainingMs, label}`,`card.complete` 只读 `{message}`——iOS/Android 约 2.5 秒后自动收卡,harmony 不收;多余字段一律忽略;重复 present 即替换;宿主本地补间,1Hz 补丁足够。
- **结构化拒绝**:挂载链从不 throw——模型收到 `挂载未完成(step): reason`(底层解析/链接错误原文随附),外加修复指引:修好 `indexSource` 后**同名**重调本工具(换名字从不修复源码);用户拒绝审批是一个决定,不是重试点;同名已挂载时如实相告——**没有任何会话工具能卸载活挂载**(`plugin_manager` 的 `remove_bundle` 只改注册表行;先卸载再移除的面在应用的插件管理面里),模型要么换新名字重新创作,要么请用户在插件管理里移除后再同名重挂。

## 卸载与重载

卸载是一等操作:`unmountWorkspacePlugin(spec)` 等待 cordis fiber 的 `dispose()`(插件注册的每个 effect 都随之收尾)并把注册表行置为禁用。再次挂载会在纪元查询(`?e=1`——装载器的 node 式缓存击穿)下重新链接**当前**源码,因此「编辑 → 重启」是真重载,不是旧模块。经插件管理器移除(`marketplace/remove`)会先卸载活挂载——树永远不会从运行中的 fiber 脚下消失。

## 写一个工具(develop/basic/tool)

教程的 `greet` 工具原样可跑——`defineTool` 经装载器裸名映射解析,注册即 effect,执行走真实 ToolRuntime:

```js
import { defineTool } from '@deepseek-ai/dsh-tools';

export const name = 'greet-tool';
export const inject = ['tools'];

export function apply(ctx) {
  ctx.tools.register(defineTool({
    name: 'greet',
    description: 'Greet someone by name.',
    parameters: { name: { type: 'string', required: true, description: 'Who to greet' } },
    output: { schema: { type: 'string' }, render: (_a, value) => [{ type: 'text', text: value }] },
    async execute(args) { return `Hello, ${args.name}!`; },
  }));
}
```

其他插件经 `ctx.on('tools/result', (exec, result) => …)` 独立观察每次调用——松耦合,二者互不 import。

## 插件配置(develop/basic/config)

导出 `Config` schema(Schemastery——任何 Standard Schema 校验器均可),`apply(ctx, config)` 收到的就是校验过、默认值补齐的配置:

```js
import Schema from '@deepseek-ai/schemastery';

export const Config = Schema.object({
  greeting: Schema.string().default('Hello'),
});
export const apply = (ctx, config) => { /* config.greeting 总是有值 */ };
```

配置经挂载选项传递(`pluginOpts`)。校验发生在 `ctx.plugin` 内部:非法配置会让挂载**响亮失败**(ValidationError),并回滚 adoption(启用位)——坏插件绝不会保持启用、每次启动重试。

活挂载上的配置还可以**热更新**——内核的 config-HMR 面,暴露为 `updateWorkspacePluginConfig(spec, config)`:更新先校验,fiber 原位重启(卸载 effect 运行、apply 重跑),非法更新被拒且旧配置继续运行。教程的 `.volatile()` 字段与 `!!js` YAML 标签仍是桌面组合层特性。

## 事件(develop/framework/events)

五种分发模式是 cordis 内核原生的,逐字可用:`ctx.emit`(广播)、`ctx.parallel`(扇出)、`ctx.bail`(首个非空返回短路)、`ctx.serial`、`ctx.waterfall`(每个监听器包裹 `next()`)。每个 `ctx.on` 都是 effect——卸载即摘除监听器。`tools/result` 及其他 `namespace/action` harness 事件与教程所示完全一致。

## 服务与依赖级联(develop/framework/service)

提供服务用类形态(`super(ctx, 'myService')`);消费用 `inject: ['myService']`(必需)或 `ctx.get('myService')`(可选)。级联契约在本宿主成立且已实证:**卸载提供方,依赖方随之销毁;服务恢复,依赖方自动重载。**

## 挂载被拒时:PENDING 诊断(cordis-tutorial 06)

`inject` 点名了无人提供的服务的插件,在上游会永远静默等待。本宿主的挂载会**拒绝**并给出诊断(`plugin is PENDING — an injected service is missing`),同时拆除 fiber、回滚 adoption。挂载必须现在就跑起来,否则干脆不挂。

## LLM 适配器(develop/practice/llm-adapter)

工作区插件可以服务自己的提供方——继承 `@deepseek-ai/dsh-llm` 的 `LlmAdapter` 并覆写 `stream()`(基类拥有 `providerInfo`/`providerRetryPolicy`/`resolveModel`/`prepareCall`):

```js
import { LlmAdapter } from '@deepseek-ai/dsh-llm';

class MyAdapter extends LlmAdapter {
  async *stream(options) { /* 产出 StreamChunk 协议 */ }
}

export const inject = ['llm'];
export const apply = (ctx) => { ctx.llm.registerAdapter(['my-provider'], new MyAdapter()); };
```

注册即 effect(卸载即撤下提供方),流经真实 `LlmRuntime` 的 waterfall。

## 三层拆分(develop/practice/)与发布(develop/basic/publish)

Definition / Provider / Consumer 对应三个工作区树(或三个市场包),说同一个 Service 名——机制就是上面的 Service 形态 + `inject`;仓库自己的能力面(shell → bash-local → tool-bash)就是参照。发布对应市场面:`dsh plugin add` ≈ `plugin_manager install_bundle`(来自市场索引的签名 uSTAR 包),`remove` ≈ `marketplace/remove`(先卸活挂载),profile 组合包列表 ≈ 启动列表所读的 `dsh.plugins/1` 注册表。npm/pnpm 打包章按设计属于桌面——设备永不编译;作者在自己机器上编译(`dev.sh`)或交付预构建包。

## E2E 实证在哪

`scenario/plugin-forms.js`(确定性、无模型):三形态全部挂载、`inject` 排序加载、服务经解析器应答、effect 清理在卸载时运行、编辑后的源码重载、配置校验(显式值 → 默认值 → 非法响亮失败)、全部五种分发模式分发(emit、bail、serial、waterfall、parallel)、greet 工具经真实 ToolRuntime 执行且有独立观察者、依赖级联销毁与重载、PENDING 挂载带诊断拒绝、工作区 LLM 适配器服务真实流、启动列表恰好挂载启用的行、创作拒绝探针响亮拒绝(坏语法、无插件导出、未知模板 kind、同名重挂、以及骑在正常结果上的 setInterval 纪律 warn)——34 个事件一一对应。用 `runtime/dsh/ci/run-plugin-forms-e2e.sh` 运行(已接入 `build/build.sh test core`);清单在 `test/e2e/scenarios/plugin-forms.json`。

## 策略钩子、后台任务与工具编写参考的其余部分(reference/cookbook)

深水区的工具编写面就是同一套 vendored `dsh-tools`,腿里已实证:

- **策略**:`tools/pre-execute` 瀑布可以拒绝调用(`{kind: 'deny', reason}`),`ctx.tools.guard` 单调拒绝——任何后续面都不能强行放行。两者都是 effect:卸载即解除。
- **后台工作**:组合面挂载的是真实 `LocalJobRegistry`——`ctx.jobs.start({kind, label, run})`、`wait`、`read`、`kill`。必须遵守的一个契约:合规生产者的 `cancel()` **必须最终兑现 `done`**(运行时等的是资源释放,不是 kill 请求)。`dsh-tool-jobs` 负责把任务状态渲染给模型。
- **UI 卡片**(`presentCall`/`presentResult`/`presentationMeta`):同一个 `defineTool` 的面;本宿主上面向模型的是 `output.render`,产品自己的原生卡面(`card.*` 事件)才是 UI 面。web `tool.call.toolview` 客户端槽位一章属于桌面 web 面。
- **PTC 模式**:程序化工具访问已经由 `ctx.tools.execute` 实证;完整 `run_code` PTC 面依赖 PTC host runner,移动墙(`preset-mobile-rows.js`)按设计将其禁用。
- `ctx.serial` 补齐四种分发模式;嵌套 `ctx.plugin(child)` 随父递归销毁;`ctx.provide` 是纯值提供面。

quickstart 的 Web-UI 流程(模型设置 → 工作区选择 → 带审批的真实回合)就是本应用的产品面——无需插件开发映射。

## seam 清点(reference/capability-seams,运行时实测)

`scenario/seam-inventory.js` 以生产等价脊柱(全部产品旗 + 组合面)启动,经与 `inject` 同一个解析器逐一探针上游目录的服务名。由 `test/e2e/scenarios/seam-inventory.json` 冻结;运行 `runtime/dsh/ci/run-seam-inventory-e2e.sh`。运行时的回答:

**已挂载(22)**:sessions、agents、systemPrompt、tools、sessionProjections、settings、agentLoop、llm、tokenMeter、jobs、userQuestions、subagentModelSelection、shell(dsh-shell-js 的 JS shell)、shellEnv、goals、commands、agentPresets、skills、fileReferences、web(免密钥面)、sessionQuery、sessionFeedback。

**缺席,属设计**——每一项都有移动等价物或记录在案的墙:

| 缺席 | 移动端处置 |
| --- | --- |
| credentials | 宿主侧存储:网关钥匙串 + profile 凭据文件(`loadCredential`) |
| approval | 网关 `presentApproval` 原语(契约优先;原生弹窗) |
| fs(网关,非 seam) | 宿主网关的 fs 原语就是 fs |
| subprocess、sandbox、terminals | 移动墙:无进程——shell 座位是走网关作用域 fs 面的 `dsh-shell-js` JS shell(wasm shell + 可选 iSH 两个座位已于 2026-10-11 退役,#457——再无任何宿主 stage 或挂载它们) |
| compaction | vendored 的 `BasicCompactionEngine` 挂在运行时的 `compaction` 门后(`upstream/boot-compaction.js`,#456;CLI 证据 `runtime/dsh/artifacts/macos-cli-upstream-compaction/`);门关时 `/compact`(command-compact)仍是唯一消费者——跨宿主 UI 集成是剩余后续(已登记于 e2e-matrix known gaps,2026-10-12) |
| sessionPersistence | jsonl 后端已 vendor 且经 ensure-dsh.sh sha256 钉版(`session-persistence@0.1.6-alpha.2`);#463 把 `sessionPersistence: true` 接进三宿主 serve 座——强杀重启恢复三宿主各有实证(`hosts/{android,harmony,ios}/artifacts/session-persist-restart/` + CLI 腿 `runtime/dsh/artifacts/macos-cli-session-persistence/`);页面会话 list-merge/re-attach 缝是剩余后续(已登记于 e2e-matrix known gaps,2026-10-12) |
| sessionTitle、attachments、schedule、planMode、messageFeedback、mcpResources、spillStore、workflowEngine、lsp | 尚未携带的桌面产品特性(每个都是候选后续,无一静默损坏) |
| invariant、configEditor、setting、workspaceRegistry | 桌面诊断/组合面;移动等价物是 settings 服务、网关工作区选择器、宿主工作区模型 |
| api-gateway(typert/Remote) | carrier API 桥:`/api/<endpoint>` + bus 认领端点表(session/*、goals/*、commands/*、marketplace/* 等)——同一命名空间面走 carrier 契约,无 typert wire |

## 文档审计覆盖(逐页,2026-10-10)

文档站每一页都已读过并与宿主比对。处置:

| 页面 | 处置 |
| --- | --- |
| develop/basic(第一个插件、工具、配置、发布) | 已实证——三形态、defineTool greet、Schemastery 配置、市场映射(`plugin.forms`) |
| develop/framework(生命周期、服务、事件) | 已实证——卸载/处置、依赖级联含重载、全部五种分发模式(`plugin.forms`) |
| develop/practice(三层拆分、LLM 适配器、持久化插件) | 已实证(Service+inject+适配器腿);dynamic-cordis 即聊天创作插件的产品流程本身 |
| develop/cordis-tutorial(7 章) | 已实证——各章即框架页的上手形态;第 6 章的 PENDING 陷阱即挂载拒绝诊断的出处 |
| reference/cordis-api(context、registry、fiber、events、service) | 面审计——18 方法 + 5 实例成员 + 7 个 Service 内核符号断言存在(`seam.inventory/cordis.face`);fiber.update 暴露为 `updateWorkspacePluginConfig` |
| reference/capability-seams | 运行时实测——seam 清点(22 挂载/20 记录处置,见上表) |
| reference/tool-execution-pipeline | 已实证——三瀑布 + 单调 guard + 结果观察(`plugin.forms` 策略相) |
| reference/agent-lifecycle | 概念页(回合/步骤;`session/event` 对 `agent/*`)——由 vendored agent-loop 原样携带 |
| reference/api-gateway | 已归类——桌面 typert/Remote 线;移动经 carrier 桥 + bus 认领端点服同一 `/api` 命名空间面 |
| reference/cookbook:adding-a-tool、adding-an-llm-adapter、extension-cookbook | 已实证/已归类——每个扩展模式(pre-execute、guard、post-execute、result、jobs、适配器注册)都在腿里 |
| reference/cookbook:adding-a-package | 桌面 monorepo 打包(pnpm/tsdown/约束)——移动端不适用;可移植部分是 locale(`meta.title`/`description`)与图标元数据约定,未携带(市场目录的 `summaries.json` 在目录层覆盖 en/zh)——列为后续 |
| guide/quickstart | Web-UI 流程即本应用的产品面 |
| guide/providers | 模型配置产品页;移动等价物是 BYOK/模型设置面(OpenAI 兼容端点);桌面多协议广度(经 llm-pi-ai 的 anthropic-messages / openai-responses)未在移动 vendor——列为后续 |
| guide/network-proxy、python-sdk | 启动环境代理变量 / 桌面 SDK profile——无插件作者面;不适用 |
| guide/github-review、guide/schedule、guide/mcp-memory | 建立在未携带 seam 上的桌面产品特性(webhookRuntime;schedule;mcp-memory——其 mcp-client 已 vendored 进产品闭包,streamable-HTTP 传输经网关 `httpFetch` 落地(`upstream/mcp-http-transport.js`,2026-10-20),而走 stdio 子进程的传输仍是无进程墙,memory 产品面本身未挂载)——列为后续 |
| 生成类 catalog(config/tool/persistence)+ subsystems(约 45 页) | 由同一批 vendored 包生成——构造性覆盖;抽查 tools 与 jobs:文档面与 vendored 库一致(文档站跟 master,个别类型名与我们的 0.1.6-alpha.2 钉版有漂移——以钉版为准) |

---

[English version](plugin-dev.md)
