# Owner 动作清单(Owner actions)

仓库的代理 workforce 手里没有仓库管理 PAT:本清单里的每一项都只有 owner
能做。它起初是 GitHub 网页设置清单——如今大多数条目仍然是设置页里的
一次点击——现在则收拢 owner 的全部积压:发布 go、手机端与服务端动作、
以及一条本机动作。一份要靠会话记忆重新拼起来的积压,就是一份会停滞的
积压。每条都写清 **入口**(具体设置路径或界面)、**为什么**(不开会坏
什么、漏什么)和 **完成标志**(事后核对的状态)。代理能准备文件和工作
流,但下面的开关是 owner 的手。

下文的仓库状态事实是 2026-10-13 用 API 只读核验的
(`gh api repos/Lixiang9716/dsh-mobile` 与
`gh api .../branches/main/protection`);当天未能复验的条目各自标注了
更早的日期。若时日已过,动手前先重查:

- `main` 的 required status checks:`gates` **与 `ci-verdict`**(第 2 条
  已完成)。
- Dependabot alerts:**关闭**(`gh api .../vulnerability-alerts` 返回
  404 "Vulnerability alerts are disabled");Dependabot security
  updates:**关闭**(`automated-security-fixes.enabled: false`)。
- Secret scanning:**已开**;push protection:**已开**(2026-09-30 核验;
  2026-10-13 的令牌读不到那个端点——无论哪种状态都无需动作)。
- Discussions:**关**。Pages:**关**。
- Environments:`release` 已存在但**没有任何保护规则**(打包工作流引用
  它之后 GitHub 自动建出的——即 [release.md](release.zh.md) 所述的惰性
  状态);`github-pages` 同理;**没有 `marketplace` 环境**。
- 三个打包工作流与 `marketplace-publish.yml` 现在都声明了各自的
  `environment:`——工作流侧已落地;剩下的是把它们配备起来(第 3、7 条)。
- 仓库目前唯一的 Actions secret 是已退役的 `RELEASE_PLEASE_TOKEN`
  (第 8 条);唯一的变量与发布无关。

---

## GitHub 网页动作

### 1. 打开 Dependabot security updates

- **入口**:Settings → **Code security** → Dependabot,按这个顺序:
  1. **Dependabot alerts** → **Enable**——这是前置,不是可选项。
  2. **Dependabot security updates** → **Enable**。
- **为什么**:版本更新已由 `.github/dependabot.yml` 接管(每周、group 合并:
  `github-actions` 管所有 workflow,`npm` 管带锁文件的
  `test/upstream-suite`)。那个节奏是按计划表升 pin;security updates 则是
  公告(advisory)一落地就对被 pin 的版本开 PR,不用等最长一周的下一次
  计划扫描。两者自动叠加——文件里没有、也不需要按 ecosystem 配安全开关。
- **为什么 alerts 在前**:security updates 是*由* Dependabot alerts *触发*的
  ——GitHub 文档明言该功能 "is available for repositories where you have
  enabled the dependency graph and Dependabot alerts",而 grouped security
  updates(正是 `dependabot.yml` 里 `npm` 组用的形态)额外要求 alerts 先开。
  alerts 关着,security updates 开关就没有公告来源:开关本身会不会拒绝启用
  无法只读验证,但可观察的失败更糟——开关显示已开,**Security** 页永远空白,
  这一项看起来完成了,实际上什么都不会发生。先开 alerts,Security 页同时
  也是验证面。
- **现状**:两者都关(2026-10-13 复验)。版本更新这一半明显活着——
  dependabot 的 PR 每周都在落(如 #481、#482)——缺的正是安全这一半。
- **完成标志**:Dependabot alerts 显示 Enabled,security updates 开关显示
  Enabled,且 **Security** 标签页列出 Dependabot alerts(及其安全更新
  PR)——而不是一片空白。

### 2. 把 `ci-verdict` 检查设为 `main` 的 required——已完成

- **现状(2026-10-13):已完成。** API 核验:`main` 的保护规则同时要求
  `gates` **与** `ci-verdict`。下面的论证保留存档——为什么是这个检查而
  不是某条平台流水线,以及为什么 merge queue 不顺手开。
- **入口**:Settings → **Branches** → `main` 的保护规则 → 编辑 →
  **Require status checks to pass** → 添加 **`ci-verdict`**(保留
  **`gates`**;GitHub 正在把这个页面迁往 Settings → Rules → Rulesets——若
  branch-protection 页面出现迁移横幅,就在那边做同样的修改)。
- **为什么**:这是一笔老欠账。三条平台流水线都带 path 过滤,纯文档 PR 一条
  都不会触发——把任何一条平台流水线设为 required 都会让它永远停在
  "expected",把合并卡死。`ci-verdict` 不带 path:它总是运行,结论由 head
  commit 上实际存在的每次 check run 推导,没运行的 leg 会被点名说出
  (见 `.github/workflows/ci-verdict.yml` 的文件头)。把它设为 required,
  "gates 绿了"和"跑了的都绿了"之间的缝就合上了。
- **操作细节**:检查名就是 `ci-verdict`(job id;该 job 没设显示名)。若
  选择器里还列不出来,就手动输入名字——选择器只列出至少跑过一次的检查。
- **Merge queue——先想清楚再动,别顺手开**:required checks 打开后,
  GitHub 会顺势建议开 merge queue,让"head 上绿"不至于悄悄变成"合并后红"。
  诚实的背景:`doc/decisions.md` 的 **D13** 记录过一次对
  `merge_group`/merge queue 的否决——但那次否决限定在另一个问题上(绕开
  release PR 的 check 来源问题:"it changes the merge model of the whole
  repository to work around one PR's provenance")。它不会自动外延,但
  merge queue 确实改变整个仓库的合并模型,而本仓库靠 owner 常设授权做
  squash 合并。建议:现在就把 `ci-verdict` 设为 required;merge queue 只在
  交错合并真把合并后的 main 弄坏过之后再重新考虑,并且作为独立评审过的
  决策落地。
- **本次刻意不推荐**:"Require review from Code Owners"
  (`.github/CODEOWNERS` 现已存在)。required reviews 为 0 是刻意的——
  那个文件是路由声明,不是闸;把它翻开会给每一次自动合并都加一道人工审批。
- **完成标志**:`main` 的 required checks 同时列出 `gates` 和 `ci-verdict`。
  *(已达成——2026-10-13 核验。)*

### 3. 给 `release` 环境配上 required reviewer(配备它)

- **入口**:Settings → **Environments** → `release` → **Required
  reviewers** → 添加你自己 → **Protect**。
- **现状**:按设计完成了一半。环境已存在但**没有任何保护规则**
  (2026-10-13 核验——惰性引用),而工作流侧已落地:三个打包 job
  (`release-ios.yml` 的 `ios-package`、`release-android.yml` 的
  `android-package`、`release-harmony.yml` 的 `harmony-package`)都声明了
  `environment: release`(#271)。原先"先建环境、再落工作流引用"的顺序
  警告已经了结;剩下的正是唯一一页复选框。
- **为什么**:这一步把"发布需要明确的 go"从约定变成机械审批闸——每次
  tag push,打包 job 都会暂停,等 reviewer 批准才继续构建。
- **单个复选框决定这道闸在单人仓库里值多少**:**Prevent self-review 保持
  关闭**。关着,reviewer 可以批准自己触发的运行——是一次有记录的 go,
  只不过是自己的;开着,推 tag 的那个人永远无法批准,在单人仓库里就是
  永远等待、把排队的发布运行全数停摆。把这次记录在案的批准当作未来的
  自己的一次郑重复看,而不是第二双眼睛(更完整的讨论在
  [release.md](release.zh.md))。
- **完成标志**:`release` 环境显示一个 required reviewer,且下一次 tag
  push 在打包前停在这个审批上。

### 4. 打开 Discussions

- **入口**:Settings → General → **Features** → 勾选 **Discussions** →
  **Set up discussions**。
- **为什么**:这是内测反馈的通道。默认分类集(Announcements、Ideas、
  Polls、Q&A——以 Q&A 作为自由讨论区)起步够用;内测流量提出需求后再调。
- **现状**:关(2026-10-13 复验)。
- **完成标志**:仓库的 **Discussions** 标签页能打开。

### 5. 配置 Pages——工作流已经落地并在红着

- **入口**:Settings → **Pages** → **Build and deployment** → **Source** →
  **GitHub Actions**。
- **为什么**:这里等的那件事已经发生了:部署工作流已落地
  (`.github/workflows/pages.yml`,lynx-client 在线 demo),而它的 deploy
  段在每次符合条件的 `main` push 上都失败。文件头把这写明为预期的
  首跑失败("Pages not enabled";最近一次红运行 2026-10-12)。所以这不再
  是"等工作流落地时把开关打开":工作流已经落地、一直红着,等你翻开。
  只有工作流从来不够——这个开关就是缺的那一半。
- **现状**:关(2026-10-13 复验——`has_pages: false`)。
- **完成标志**:`pages/demo` 下一次在 `main` 上的运行部署收绿,demo URL
  能打开。

### 6. Secret scanning——无需动作

- **现状**:secret scanning **和** push protection 都**已开**(2026-09-30
  核验;2026-10-13 的 API 复验因令牌权限读不到该端点——没有任何迹象
  表明有变化)。没有开关要动;写这一条是为了避免有人去找一个本来就已经
  打开的开关。(Validity checks 目前是关的;保持关闭没问题——打开它是
  可选的额外项,不在本清单范围内。)

### 7. 市场发布密钥与 `marketplace` 环境

- **入口**:Settings → **Secrets and variables** → **Actions**(下述三个
  secret + 一个 variable),以及 Settings → **Environments** →
  **New environment** → 名称 `marketplace` → **Required reviewers** →
  添加你自己 → **Protect**。
- **现状(2026-10-13)**:一样都还不存在——仓库唯一的 Actions secret 是
  已退役的 `RELEASE_PLEASE_TOKEN`(第 8 条),唯一的变量与发布无关,也
  没有 `marketplace` 环境。工作流侧就绪且惰性:`marketplace-publish.yml`
  已声明 `environment: marketplace`(#271)——把环境配备起来,go 闸才
  真的生效。
- **为什么**:`.github/workflows/marketplace-publish.yml` 把
  `system-plugins/` 打包成冻结的 DSH 包格式,并用 ed25519 给目录索引签名
  ——签名就是市场的信任本体(2026-10-01 契约提案:被篡改的托管永远产不出
  一个可安装的包)。没有签名 secret 时每次运行都按设计死在签名步骤:目录
  不存在未签名的形态。部署 secret 决定一次真发布是"响亮地失败"还是"真的
  部署";环境则保证真发布始终是人的决定。
- **按顺序添加**:
  1. 生成签名密钥:
     `node tools/marketplace-rotate-key.mjs gen --key-id dsh-market-1`。
     它会打印 SEED(种子)和原始公钥。种子只显示一次——仓库里不会存它,
     现在就复制。(日后轮换:同一工具的 `window-index` 子命令——其文件头
     记录了完整的双签窗口流程。)
  2. Secret **`MARKETPLACE_SIGNING_KEY`** = 第 1 步的种子(32 字节
     ed25519 种子的 base64——就是工具打印的那串)。
  3. Variable **`MARKETPLACE_BASE_URL`** = 包将来所在的公开 URL 前缀
     (例如 `https://dl.example.com/market`)。索引里每个 `tgzUrl` 都由它
     拼出;变量和 dispatch 输入都没设时,运行按设计失败——签名索引里
     绝不写占位 URL。
  4. 部署 secret(只有真发布需要;dry-run 不需要也能跑):
     **`MARKETPLACE_DEPLOY_HOST`**(`user@host` 或 ssh 别名)、
     **`MARKETPLACE_DEPLOY_PATH`**(目标绝对目录)、
     **`MARKETPLACE_DEPLOY_SSH_KEY`**(在该主机上已授权的私钥)、
     **`MARKETPLACE_DEPLOY_PORT`**(可选,默认 22)。缺了它们时真发布
     会响亮失败,并逐一报出缺失的 secret 名字。
  5. `marketplace` 环境,必选审核人是你自己。发布 job 会暂停等你批准
     ——与 `release` 环境(第 3 条)同一机制,同样的配备建议:
     **Prevent self-review 保持关闭**,solo 维护者是唯一审核人,勾上会
     让每次发布死锁。环境未配备时 workflow 的引用是惰性的——什么也不等。
- **GitHub 这一半只是一半**:真发布还需要托管服务器——自 2026-10-01
  探测起一直 **STANDBY**(不可达、无凭据;见第 11 条与
  [deploy/marketplace/README.md](../deploy/marketplace/README.md),那里
  有服务器侧清单)。`dry_run` 一腿既不需要部署 secret 也不需要服务器。
- **完成标志**:marketplace/publish 的一次 `workflow_dispatch` 运行
  (`dry_run: true`,默认值)收绿,并带着 `marketplace-dist` artifact,
  里面的索引通过签名验证;真发布(推 `marketplace-v*` tag,或 dispatch
  取消勾选 `dry_run`)先等你的批准,然后部署——`deploy.sh` 在上传后核对
  远端 index 摘要,所以这次运行同时也证明了落地的字节。

### 8. 删除已退役的 `RELEASE_PLEASE_TOKEN` secret

- **入口**:Settings → **Secrets and variables** → **Actions** →
  `RELEASE_PLEASE_TOKEN` → 移除。
- **为什么**:`release-please` 已退役(D14),release.md 明说该 secret
  "is read by nothing"(什么也不读它)——但它还设着(2026-10-13 核验)。
  一个没人读的活凭据既是攻击面也是漂移诱饵:下一个读者总要浪费一个来回
  去问它还重不重要。
- **完成标志**:Actions secrets 列表里不再出现 `RELEASE_PLEASE_TOKEN`。

## 发布侧动作

### 9. 给(或收回)发布 go——tag push

- **入口**:不是某个设置页。管线文档在 [release.md](release.zh.md):
  **PREPARE**——`packages/release/bump-version.py X.Y.Z`,读它写出的
  changelog,以**普通** pull request 落地——然后 **PACKAGE**——推
  `vX.Y.Z` tag;三条 `release/<host>` 工作流逐主机构建,把包挂到该 tag
  的 Release 上。第 3 条配备好后,每个打包 job 还会停下等你的批准:
  go 变成一次有记录的点击。
- **为什么**:这次发布从 2026-09-30 起就备好、明确等着 owner 的 go——
  草稿发布说明
  ([release-notes-v0.0.2.zh.md](release-notes-v0.0.2.zh.md))与回归证据包
  ([release-checks/release-regression-v0.0.2.zh.md](release-checks/release-regression-v0.0.2.zh.md))
  都是那天切出的,证据包原话:"No release action (bump,
  tag, release) was executed — that is the owner's explicit go."
  `version.txt` 仍是 `0.0.1`(2026-10-13 核验):v0.0.1(2026-09-21)之后
  什么都没发过。证据包写明了自己的切线,如今已陈旧两周——`main` 又前进
  了数百个提交——所以"知情的 go"要决定这意味着什么:重跑回归,还是接受
  CI 的 dev 腿并把这一选择记录下来。
- **版本号由你在 bump 时定**:备好的草稿写的是 v0.0.2,会话记忆里说过
  v0.0.3,而 `bump-version.py` 会按上个 tag 以来的提交打印一个暗示值
  ——人是做决定的那一方,脚本也坚持如此。
- **完成标志**:tag 的 Release 挂上三个包——或者搁置是明确的:一句带
  日期、带理由的"还没到时候",胜过无声的等待——无声的等待正是这一条
  变成积压行的原因。

### 10. Google Play 注册——仅记忆来源行,核实或删除

- **先说来源**:本行录自项目会话记忆(2026-10)。**仓库内没有任何东西
  能佐证它**——`doc/`、agent notes、提交日志里都没有 Play/2SV 记录
  (2026-10-13 检查过)。若你的 Play Console 里并没有这样的卡点,删掉
  本行;清单不能比事实活得久。
- **入口**:Play Console——两步验证(2SV)挑战(手机端;只有账号本人
  能完成)及其背后的账号面板。
- **为什么**:按那份记忆,注册流程停在 2SV 一步。清单的本事,是让卡点
  被唯一能解开它的人看见,而不是只活在某段聊天记录里。
- **完成标志**:2SV 通过、注册继续。此后,个人开发者账号(2023-11-13
  之后创建)在申请正式(production)权限前适用 Google 的标准要求:封闭
  轨道(closed track)上至少 **12 名测试者连续在轨 14 天**。测试者装的
  Android 包就是第 9 条的产物。

## 服务端动作——STANDBY 待命包

### 11. 市场托管:解除待命(或记录搁置)

- **入口**:[deploy/marketplace/README.md](../deploy/marketplace/README.md)
  的 owner 清单——一台可达的主机 + 一把已授权的 SSH 密钥、安全组放开
  80/443、一个带 TLS 的域名(推荐 caddy)——再加上第 7 条的
  `MARKETPLACE_DEPLOY_*` secrets。先是你的服务器控制台,然后才是 GitHub
  设置页。
- **为什么**:市场 v0 是一个签过名的静态站;CI 能给目录签名(第 7 条),
  但字节要有地方住。这套托管工具自 2026-10-01 探测起就是 **STANDBY**:
  服务器不可达、本机没有凭据——什么都没部署,README 也是这么诚实记录
  的,探测记录就附在旁边。`DEPLOY_HOST` 不存在时 `deploy-local.sh` 响亮
  失败:待命是设计出来的状态,不是一个要去绕过的错误。
- **完成标志**:对真实主机的 SSH 探测有应答,第 7 条的 secrets 已存在,
  且一次真发布把通过签名验证的索引留在域名下(`deploy.sh` 上传后核对
  远端摘要)——或者搁置被记录在这里,带日期。

### 12. IdP 待命包:部署或搁置

- **入口**:[deploy/idp/README.md](../deploy/idp/README.md) 的 owner
  清单——一台按 Logto 规格给量的 Linux 主机、操作者 SSH 密钥、安全组
  (80/443 公开,22 受限)、Logto `ENDPOINT`/`ADMIN_ENDPOINT` 两个 DNS
  名。
- **为什么**:市场 v2(发布者身份)需要一个 OIDC IdP。包已备好且钉死
  版本——首选 Logto,PocketBase 作为诚实兜底——并自 2026-10-01 起
  **STANDBY**(同样的探测结果:不可达、缺凭据)。今天没有下游被它卡住;
  这是一次 owner 的优先级决断——正因为如此,它才属于这份清单,而不是
  某人的记忆。
- **完成标志**:`./deploy.sh --host USER@HOST --check-only` 对真实主机
  有应答,然后你要么跑完整部署,要么记录搁置。

## 本机工具动作

### 13. 把 `~/tools/aoci` 升到下一个正式发布

- **入口**:`~/tools/aoci/aoci`——本机,不是 GitHub。
- **现状(2026-10-13)**:这个二进制是从上游 `main` 切出的一次性构建
  ——`v0.1.0-rc20-62-g7586820`,2026-10-13 构建——不是发布工件。它存在
  的原因是一个已解除的阻塞:上游
  [aoci-spec/aoci-code#117](https://github.com/aoci-spec/aoci-code/issues/117)
  (孪生同文的孤儿 Entry 删不掉,报一个语义反着的 `write_conflict`)。
  修复已落到上游 `main`,本地二进制从它切出,三个在册的孪生孤儿也用它
  删掉了(#490)——仓库今天报告的孤儿数为零。(issue 本身仍开着,等
  维护者在 rc21 上的验证轮。)本行更早的草稿写的是"等 rc21"——被事实
  超过了。
- **为什么**:dev 构建不可复现;正式发布 tag 才是被支持的工件,而且后续
  会话的认知回执引用的是 MCP 服务版本。
- **完成标志**:`~/tools/aoci/aoci --version` 报出正式发布 tag(rc21 或
  更新,不带 `-g<sha>` dev 后缀),且仓库的 MCP 服务在新版本上应答。
  在那之前没有任何事被卡住:当前构建比 rc20 新。

---

- 双语对侧:[github-owner-actions.md](github-owner-actions.md)
- 相关:[release.zh.md](release.zh.md)(`release` 环境闸住的那个
  tag-push 发布模型)· STANDBY 待命包:
  [deploy/marketplace/README.zh.md](../deploy/marketplace/README.zh.md) 与
  [deploy/idp/README.zh.md](../deploy/idp/README.zh.md)
