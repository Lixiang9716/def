# 提案:生产者登记表——LLM 生产者自报身份,mock 诚实亮明(v1.12.0 候选)

[English](2026-10-24-producer-registry.md) | 简体中文

## 动机

2026-10-23 的 mock 普查(四腿扫描+独立核验)确认了三条产品缺口,共享同一个病理:**runtime 知道哪个生产者在服务某个数据面,但没有任何机制登记这个事实,于是 mock 能假扮"已配置的现实"**:

1. 官方客户端(三宿主 Release 默认)没有任何产品路径能离开 `staged → byok → mock` 链的第三级(`web-write-onboarding.js:96-109` 只被 web-client-v2 消费)。
2. Models 页自己的保存流是死路:`credentials/set` 写一个 turn 路径从不读的展示 store,而 `describe` 照答 `configured:true`——假"已配置"状态直接呈现给真实用户(`web-write-llm.js:88-136`)。
3. mock 路由的事实被四条无 kind 过滤的 join 腿装扮成"已配置 provider":目录行渲染"OpenAI 兼容"(`llm-gateway-mount.js:36-41`)、`llm-mock` 设置命名空间把 loopback 注册为 base(`web-write-settings.js:46-62`)、`credentials/describe` 对 `MOCK_API_KEY` 照答 `configured:true, source:'staged profile credential'`(`web-write-llm.js:88-100`)、`session/modelCatalog` 把 `{provider:'mock'}` 发给 composer(`web-write-catalog.js:141-165`)。

诚实的 `kind:'mock'` 事实**存在**——就在路由对象上(`llm-route.js:249-261`)——但只有一个消费者读过它(`web-write-onboarding.js:73-88`,一条官方客户端从不调用的 wire)。DeepSeek 上游把数据流显式建模为生产者与消费者;本提案给 dsh-mobile 同一纪律,管住当前全靠考古的那个决定:**哪个生产者绑定在数据面上,为什么**。

## 设计(v1:仅 LLM 面)

### 1. 生产者记录——一个结构,绑定时登记

```js
// llm-route.js(我们自己的文件,非 vendored)
{
  id: 'staged:default' | 'byok:dsh.llm/byok-route' | 'mock:loopback'
        | 'pi-ai:<catalog-id>',      // 登记身份,每次 boot 稳定
  face: 'llm',                        // v1 恒为 'llm';后续数据面加入此命名空间
  kind: 'staged' | 'byok' | 'mock' | 'pi-ai',   // 既有路由种类
  provider, model,                    // 服务事实
  userEndpoint: boolean,              // 每条路由已有
  reason: 'staged-config' | 'byok-credential' | 'no-credential-fallback'
        | 'gate:piaiSection',         // 为什么绑定的是它——普查缺的那个答案,一个字段
}
```

`resolveLlmRoute`、`bootRouteOf`、`rebindLlmRoute`、`restoreBootRoute` 各自本就恰好构造一条路由;现在各自**登记**记录进一张 per-boot 生产者表(`registerProducer(ctx, record)`,模块级 Map,按 boot context 键——与 `llm-route.js:341` 路由处置注册表同款键纪律,绝不用 service 对象)。兜底链本身不变:它降级为表内的优先级策略,不再是散落的 if。

### 2. 诚实的 mock 面(Gap #3 的修法骑在 kind 字段上)

所有渲染路由事实的 join 腿读记录的 `kind`:

- `kind:'mock'` 的目录行 `displayName` 变为 `脚本演示端点 (mock)`——绝不再是"OpenAI 兼容"(`llm-gateway-mount.js:38`);
- mock 路由的 ref 在 `credentials/describe` 答 `{configured:false, source:'mock route — no credential is served'}`——绿点消失(`web-write-llm.js:90-100`);
- `session/modelCatalog` 给 mock 组标 `name:'mock-1 (scripted demo)'`,单行回退保持诚实(`web-write-catalog.js:128-165`);
- 既有事件 `llm/runtime`(`llm-gateway-mount.js:42`)增加 `kind` 与 `reason` 字段——不新增事件词汇。

### 3. 绑定事件——普查之问变成一次查询

```
llm.producer.bound { producer: id, kind, reason, provider, model }
```

在每个绑定现场发出(boot、rebind、restore、piaiSection gate 挂载)。E2E manifest 一对一钉住(AGENTS 规则 7);普查之问——"还有什么在 mock、为什么"——变成 `grep llm.producer.bound` 或将来表上的 `--list-producers` CLI。无轮询:rebind 重发,最新记录永远陈述活的真相(规则 D8、规则 8)。

### 4. Gap #2 的接缝在此命名,但不在此接线

登记表让 Gap #2 显形(Models 页保存永远不会注册出 `byok:*` 生产者——表显示 mock 记录仍在服务)。把 `credentials/set` → `keychainSet` + `rebindLlmRoute` 接通是本提案的**消费者侧**,作为独立变更落地、带自己的测试;本提案只保证"不诚实"从此藏不住。Gap #1(发哪个客户端)仍是 owner 的产品决策。

## 非目标

- **通道语义**(背压、多消费者广播、turn 中热切换生产者):D5 池的事件通道线——本提案是登记与诚实,不是总线重设计。
- **其他数据面**(fs、marketplace、web):记录的 `face` 字段预留命名空间;某面长出第二个生产者时再加入。
- **改任何 vendored 包**:全部落在 `llm-route.js`、`llm-gateway-mount.js`、`web-write-{settings,llm,catalog}.js`、`composer-web-live.js`——一方文件;D6 无恙。

## 备选方案

- **保持隐式链,写文档**:否——普查证明文档无法在运行时回答;三条缺口在绿光下出货。
- **每条 join 腿各打 `routeKind` 补丁**:否——四条腿已经各自漂移;记录是所有腿 join 的唯一来源,且普查其余 28 个测试替身不进产品面,无需登记。
- **给普查里每个 mock 都登记**:否——登记表管**产品**数据面;测试替身活在 release 构建按名拒绝的 harness 路径里;登记它们只会给表添没人读的噪声行。

## 证据

- 普查:`dwfrun-7a772592`(四扫描腿+独立核验,33 命中,3 confirmed,file:line 全录)。
- 路由种类与兜底链已存在:`llm-route.js:216-327`。
- 唯一的诚实消费者:`web-write-onboarding.js:73-88` 读 `kind === 'staged'`——既证明字段能传,也证明一个消费者不够。
- rebind/restore 接缝及其 context 键纪律:`llm-route.js:329-465`;登记表依附的目录句柄置换:`llm-gateway-mount.js:36-45`。

## 规模

M——一个 PR:记录+四个登记现场+四条 join 腿读取+事件+场景/manifest/runner 三件套(E2E-by-logs)+panel 断言。诚实面文案是唯一 UI 可见增量;默认 boot 的字节变化只在日志行与目录行的 mock displayName(钉这些行的 E2E manifest 同 PR 更新——它们是我们的,不是 vendored 的)。
