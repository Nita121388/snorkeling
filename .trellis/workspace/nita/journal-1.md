# Journal - nita (Part 1)

> AI development session journal
> Started: 2026-10-03

---

## 2026-10-21 Wave AI：`ai:endpoint` 填 base URL 导致 chat 404

用户报「设置模型后报 404 page not found，但获取模型正常」。根因不是模型选择，是 endpoint 契约：
`ai:endpoint` 一直是完整请求 URL，而 cc-switch 导入和手填都会给成 base URL。FetchModels 早就会
剥 `/chat/completions`，所以模型列表看着正常；三条 chat 链原样 POST 裸 base，网关回 404。

修复走 Lyra `joinUrl` 的思路但更保守：新增 `pkg/aiusechat/aiutil/endpoint.go`，只把「确定是 base」
的形态（裸主机、版本段结尾）补上终止路径，自定义路径（Wave `/api/waveai`、Azure `?api-version=`、
Gemini `models/<m>:method`）一律原样返回。接入 openai-chat / openai-responses / anthropic /
gemini + FetchModels，错误信息加上实际 URL。24 个单测 + openaichat 2 个，全绿，真实端点复验 404→401。

## 2026-10-30 opencode 作为 agent 的支持缺口补齐（进行中）

梳理后发现 opencode 支持是「壳子接好、核心没落地」。三件事落地 + 一个架构性发现：

1. **后端 provider 重写（10-26）**：实测 opencode 1.18.32 真实 schema 是
   `session(model JSON, parent_id, directory)` + `message(data.role)` + `part(type=text/tool)`，
   `session_message` 0 行且无 role/content。旧代码全查错列 → provider 整体扫不到。
   已重写 `provider_opencode.go`：路径探测改 XDG data home（`~/.local/share/opencode`）优先、
   session 读真实列 + 解析 model JSON 填 VendorID + parent_id→Kind/ParentKey、
   消息走 message+part 聚合、工具从 part.type=tool 提取、snippet 走 bounded JOIN、
   新增 LoadMessageDelta（基于 LastSeq 行游标）。legacy role/content 保留为防御回退。
   测试套件按新 schema 全重写 + 新增 model/parent/delta 用例。`go test ./pkg/aisessions` 全绿。

2. **前端 ccswitch loader bug（10-30-ccswitch-loader-fix）**：`loadCcSwitchVendors` 只分
   codex/claude，opencode/pi 全落 claude RPC → opencode 厂商下拉实际是 claude 厂商。
   已补 opencode→CcSwitchListOpenCodeVendorsCommand、pi→...PiVendorsCommand。tsc 该文件 0 错。

3. **关键实测发现：`OPENCODE_HOME` 对 opencode 完全无效**（用非法 json 探测：
   `OPENCODE_CONFIG_DIR` 会报解析错=生效，`OPENCODE_HOME` 无反应=无效）。
   项目里 agent-launch / resume 命令 / cc-switch 物化全用 `OPENCODE_HOME`，等于厂商隔离一直没生效。
   已把 agent-launch 和 restoreCommandForSession 的注入改成 `OPENCODE_CONFIG_DIR`（实测有效），测试同步。

4. **架构性缺口（待决策）**：opencode 会话存在单一全局 DB，`model.providerID`（opencode-go）
   是 opencode 自带 provider，≠ cc-switch vendor id。所以「按会话恢复原厂商」反推不出来，
   恢复隔离对 opencode 不成立。需要产品决策：要么接受 opencode 恢复不隔离厂商，要么在启动时
   把 block→vendor 映射落库做 provenance。

5. **agent-status 钩子**：hookinstall 已用 `OPENCODE_CONFIG_DIR`（正确），但插件自动发现
   需 TUI 启动验证事件 payload，non-interactive 探不到，留作 10-30-hook-verify 真机项。

## 2026-11-04 下班快照 · 11-04-preview-edit-verify-harness

- 已提交：验证台骨架(b88a24f9)、软换行+内联标记样式+整块像素判据(62b92ce7)、撤销污染宿主窗口的 caret 注入(c8b4b77d)
- 工作区未提交/未验证：折叠式有序项的「首行缩进」几何建模（resolveListContinuation + data-list-indent-mode="first-line"）
  - 真因：渲染态是首行缩进(首行77/续行44)，我原来是悬挂缩进(两行77)，续行右移 33.02px（历史报的 2px/38px 都是墨迹行带假数据）
  - 中断点：验证时 ol-collapsible 双击打不开；stash 对照证明不是我的改动，是实例状态异常（上一轮 Esc 在编辑器未打开时把 block 关掉了）
- 待办：① 复跑验证 ② observe 的 Esc 要判 overlay 存在 ③ 关掉我开出的 8 个重复 preview block（用户已提醒）④ 全绿后 check/spec/commit/finish
- 详见 `.trellis/tasks/11-04-preview-edit-verify-harness/notes.md`

## 2026-11-04 任务盘点（只盘点，未开发）

- 45 个活跃任务逐一用「git log + 源码存在性」核对，不依赖 checkbox。
- 结论：22 个已落地待归档；5 组该关闭/转形态；真正未开工 8-10 个。
- 新需求「图片预览跨文件夹翻页」已完成 PRD 级设计（DFS 图库序列 + 锚点目录），未开工。
- 分支侧：13 个 snorkeling worktree；A 档 7 个可安全删，B 档 4 个需确认，C 档 3 个不可动
  （含 snorkeling-gui-chat 独立 clone 的 24 个未提交 chat 运行时改动）。
- 决策稿：Obsidian `My Projects/Snorkling/方案/2026-11-04-任务盘点与下一步编排.md`

## 2026-11-05 下班快照 · 交付批 4/4（功能 4 未完待接手）

- 已交付发版：0.0.115 验证台 / 0.0.116 图片翻页 / 0.0.117 Overview 看板
- 功能 4 Files VCS 树标记：实现 + 真机 31/31 已绿，**未发版**；剩余 3 条审核建议 + 发版 0.0.118
- 接手文档：`.trellis/tasks/11-04-files-vcs-tree-status/implement.md`（剩余 TODO 按优先级排好，含验证命令与发版步骤）

## 2026-11-05 功能 4 收尾 + 0.0.118

- 三条审核建议全部落地（a7c149c7）：中间层符号链接对齐（情形 C 子序列+首尾双锚定）、
  commit/sync 成功后清 VCS 缓存、树视图行名 title（`getLabelTitle`）。
- 实现取舍：原计划的「B 分支尾对齐」推导后发现退化成 `resolved=仓库根`，只覆盖一半场景且放松了
  无关仓库防护；改用子序列双锚定，两方向都覆盖，同级无关目录不产假标记。
- 验证：vitest 26 例 + treeview 23 例全绿，tsc 69 基线不变，真机 CDP 31/31。
- 踩坑：真机 verify 在 Windows 上必须用带盘符的 fixture（`VCS_FIXTURE=E:/tmp/vcs-fixture`）——
  `/tmp` 只有盘符相对语义，git rootpath 带盘符后两边拼写对不上；现象是 rows=0 或 rows 有但
  marks 全 undefined。已写进 preview-edit-harness spec。
- 发版：bump 0.0.118（12eab5dc）+ tag `snorkeling-v0.14.6-beta.0-0.0.118` 已推，CI run 41947396042。
- 观察（未修，非本任务范围）：情形 A 的「共享单个尾部组件」对叶子名相同的同级目录仍会误映射（既有行为）。

## 2026-11-02 Agent Control Surface P0：会话面 + 会话卡

用户要「本地 Agent 能用 wsh 受控地读实时会话、写会话卡」。设计文档 1367 行早已就位，代码只落了
只读那一半（c235c39b），而且带着三处硬伤。这一轮把 P0.0 补齐、P0.1 从零做完。

**先做同步**：分支落后 origin/main 138 个提交。`git merge-tree` 先验 → 零冲突、两边改动文件完全不重叠
（我碰 agentcontrol/wshrpc/wshcmd，main 那 138 个提交碰的是 aisessionsservice origins 与前端 agent-card）。
merge 后 go build ./... 通过、四包测试全绿、`task generate` 无 diff。分支此前没 push 过，顺手建了跟踪。

**P0.0 修的三处**：
1. **违反扫描契约（真 bug）**：`fillSummaries` 对每条会话调一次 `Manager.Summary`。
   Summary → resolveSession → refreshAllSummaries，N 条未命中 = N 次全量扫描 —— 正是
   `aisessions-scan-contract.md` 记载的 OOM 成因。新增 `Manager.ResolveSummaries`：
   live registry（内存）→ 一次开库按主键批量 GetSession → 仅未知项限流升级。
2. **`card.hash` 从来没填**：prd 要求 hash 能直接喂给 `card set`，代码里 `SessionLiveCard.Hash` 是空的。
   改用 `agentdata.HashSession`，与 agentdata 校验前置条件时算的是同一个函数。
3. **零测试**：只有 redact 两个用例。补了 24 个表驱动用例（freshness/idle/过滤/排序/去重/chatKey）
   + golden 快照锁字段名、null-vs-省略、脱敏，+ 拆 `session.go` 把 live.go 从 556 行降到 428。

**P0.1 从零做**：`SetAITitle(force)` + `ErrTitleProtected`（守 title contract 的 user > ai）、
`session_title.update` / `session_prop.update` 两个 op 全部复用既有 validate/preview/apply 管线
（所以白拿 dry-run/备份/审计/前置条件）、`wsh agent card get/set`、两个新 RPC。

**过程中撞出的两个真缺陷（都不是我写的，但必须修）**：
1. `sessionPropDiff` 把没变的 prop 也报成 changed —— "跳过 user 值" 会被误报成已修改。
2. **多 op patch 永远无法生效**：`applyOperation` 拿同一 patch 里前序 op 已改过的状态重新校验
   `expectedHash`，必然冲突，还会触发备份回滚把刚写的 note 撤掉。`card set --note --title` 必挂。
   改成只在写前统一校验一次前置条件（`ApplyPatch` 本来就这么做，只是 apply 侧重复校验了）。

**验收**：P0 全部可验证项打勾并标注对应测试；真机项（UI 一致性、kill→stale、P95）明确留白，
没有假装完成。全仓 `go test ./...` 只剩 `conncontroller` 一个既有失败（改动前后一致，已比对确认）。

**教训**：写完"能编译"不等于写完。这三处硬伤里，扫描契约那条只有读了 spec 才会发现，
`card.hash` 那条只有对着 prd 验收项逐条核才会发现 —— 任务文档的验收清单不是装饰。

## 2026-11-09 Inline Tab「更多」下拉：删除后保持菜单打开

用户报 Tab 化 Block 的「更多」下拉点 × 删一条后菜单就关了，无法连续删。根因是
`inlinetab-dropdown.tsx` 里 `handleClose` 和键盘 Delete/Backspace 都显式 `onOpenChange(false)`
（d0d4a582 有意为之，但交互上不合理）。修复：删除后不关菜单，行列表随 store 更新刷新；
键盘删除记录 `{被删行索引, blockId}`，待 `tabs` 收缩后按索引恢复焦点（越界取最后一条，
行删空落回菜单容器 tabIndex=-1）；确认弹窗取消（行还在）只清引用不动焦点。溢出消失或
组内剩 1 个 block 时由父组件自然关闭，这两条保留。14 例单测（3 个新焦点用例）+ 相关面
37 例全绿；真机 verify 台 skipped（无对应 area），已记台账。教训写进 quality-guidelines：
列表型下拉的每行删除默认不得顺手关菜单，键盘删除必须恢复焦点。

## 2026-11-09 · pi/codex 会话模型解析（9c4f7329）

- 根因：`pkg/aisessions` 的 pi/codex provider 从不解析 `Message.Model`；11-04 任务误判「上游不暴露」（实测 pi 有 message.model + model_change，codex 有 turn_context.payload.model）。claude/opencode 一直正常。
- 修复：pi 单行直取 + model_change 兜底；codex 新增跨行 codexMessageParser。真实数据 169/169、7/7 填充。
- 待办：G7 人验收——重新构建 app 后看 Agent 悬浮卡/Tab more/弹窗副标题不再是「未指定」（codex delta 路径消息可能缺 Model，已记 design 取舍）。gemini 无 session provider，属独立能力缺口。
- loop 引擎在本机路径失效（E:/primary/... Windows 路径），未记台账。

## 2026-11-10 · CommonText Send 目标选择器（2af9d894）

- 四轮原型迭代后定稿：聚焦 Agent Block（agent 小卡）+ 选择 Agents / Type（Tab，+新建）/ Folder（cwd，+浏览）三项正交 + 底部确认「发送」；existing 当且仅当三项全等聚焦块，否则按所选 Tab+Folder 新建块。
- pending input 队列独立模块（首输出+600ms 静默窗口→terminal.paste，TTL 60s 回退剪贴板），绝不依赖 cmd:initialinput（零消费点坑）。
- 单测 25 个 + commontext 回归 124 全绿；真机 verify 台 scripts/verify/commontext-send-agent-block 14/14 PASS。
- 踩坑（已写 quality-guidelines）：TUI 首启提示（claude 目录信任 / codex 升级提示）会吞注入按键 → 验证按 snorkeling:pending-input-injected 事件断言，不读 TUI 文本；多 agent 并行跑 verify 必须用 VERIFY_PROFILE/端口错开（否则两台验证台互读对方的块）。
- 提交混入：term.tsx 的 pending-input effect 先被并行 agent 的 f30e14c8（feat(cfa)）捎带提交，其余全部在本任务 2af9d894；task 已归档。

## 2026-11-16 CommonText 同步实时推送（WebSocket rev 通知）

- 起源：设置面板「应用 0.14.6-beta.0.snorkeling.0.0.123 · 协议 v1」+「实时推送：不支持」被误读成故障。实际：123 是**服务器二进制**版本（health.appVersion），协议 v1 匹配即兼容；「不支持」是真没实现（`CapWebSocket` 只有常量声明）。
- 落地 `.trellis/tasks/11-16-commontext-sync-websocket-push`（loop 包 `F-1116-commontext-sync-ws-push`，arch，G1/G2/G5/G6 已清）：
  - 服务端 `cmd/snorkeling-sync/hub.go` + `/v1/ws`（requireAuth 包裹），push 使 rev 前进才广播 `{"type":"rev","rev":N}`；health capabilities += `websocket`。
  - 客户端 `syncclient.Watch(ctx, onEvent, onConnected)`：wss/ws 推导 + Bearer + ping/pong + 握手成功回调。
  - `syncmanager/watcher.go`：常连接 + 指数退避 1s→30s + 容量 1 通道 500ms 防抖 → `SyncNow("notify")`；非网络错 3 次停到下次 reload（老服务器不刷日志）；`Nudge()` 2s 防抖 → `SyncNow("save")`，挂在 service Update/RenameTag/SyncResolve 之后。
- 复核时自己补了两处（`trellis-check` 没抓到）：`ErrAlreadyRunning` 被写进 `lastRunError`（提取 `recordRunOutcome`）→ 良性；`Status.Realtime` 在 dial 前就置真 → 改成握手成功才置真。
- 沉淀：`.trellis/spec/snorkeling-docs/backend/commontext-sync-realtime-contract.md`（7 条 + prove 判据）。
- **挂起**：break.ccwu.cc 仍是 0.0.123 老二进制（无 `/v1/ws`），端到端「A 保存 → B ≤2s 看到 trigger=notify」要等人工重编译部署后验收（G7）。

## 2026-11-17 · loop 台账收尾（F-1117 补记 + Tab「收起到更多」补包）

- 起因：拉取最新代码（717f4c6d1→83b6e5c8d，7 提交）后盘点 11-17 交付，发现两处没进账。
- **F-1117-overview-card-props**（83b6e5c8d）：代码与 G1/G2/G5 都在，但 item 文档「背景/记录」全待补、
  绿证没跑、台账零事件。处理：跑 `overview-board-props.test.ts` 11/11 passed（红证 11 failed → 绿证成立），
  按事实补 item 背景/来源/记录，G6/G7 与人门留给引擎侧与人。
- **Tab「收起到更多」**（f44ec0942）：完全游离提交（无任务/无包/无台账）。处理：补建 Trellis 任务
  `11-17-tab-collapse-to-more` + loop item `N-1117-tab-collapse-to-more`，并**补造红证**——
  临时回退 `tabcontextmenu.ts`/`vtabbar.tsx`/`tab.tsx` 到 `f44ec0942^` 跑同套 5 例全 FAIL，
  还原后 5/5 passed，红证存 `loop/red/N-1117-tab-collapse-to-more.txt`。
- **关键约束**：LEDGER/gates/queue.json 只能由引擎写（单一写者契约，L-0005 明确禁止手改）；
  本机 macOS 跑不了 queue.mjs（钩子与引擎路径写死 `E:/primary/projects/loop`，INBOX 11-05 已记）。
  所以引擎侧欠账（F-1117 补事件、新包入库分诊、G1 签字）只能写 INBOX，**不伪造事件、不代签人门**。
- 顺手发现：`package-lock.json` 版本字段 0.0.127 落后 package.json 的 0.0.128（npm install 会同步），
  已还原并记 INBOX。
- 复核未动：conn-typeahead（r3 绿 3/3，真机台按用户 11-17 指示挂起补跑）、v2-gutter（代码+单测全绿，
  剩 5 项人工走查，真机按指示跳过）——两者都等 G7 人验收，不是我该代签的。

## 2026-11-18 · Hero Block Header 身份显示（F-1118-hero-header-display / 11-18-hero-block-header-display）

- 起因：nita 报「打开的 Hero，Agent Block Header 显示 `E:\primary\heros/hero-feaa3f86` 不友好」——
  据点目录名是磁盘不变量（ValidateID 目录名==id，中文名必然 hero-<hash8>），不能动磁盘，只改显示层。
- 改动：启动时写 meta `hero:name`/`display:name`（hero-launch）；`block.tsx` defaultTitle agent 分支
  优先身份（frame:title 仍最高）；`buildCmdCwdHeaderElem` displayText 用身份、复制/tooltip 仍完整路径；
  新增 `displayPath()`（仅展示、Windows 归一分隔符、远端块禁用）。
- 红证 4 文件/7 例 → 绿证 hero-launch 19/19 · view/term 147/147 · block 153/153 · i18n parity 0 ·
  tsc 55 全为既有错误（触达文件 0）。提交 016775e89 + cfcd4520e（台账）。
- 排障沉淀 L-0007：`.cache/tmp/wt-head` 旧 worktree 快照（10 月，gitignored）被 vitest 当测试收集，
  旧代码的 pre-existing 失败染红新改动 → 删本地缓存 + spec 写入排查规则；blockregistry 单测
  5s 超时误红 → 放宽 20s。
- 已知边界：旧 Hero 块 meta 无 hero:name，仍显示哈希目录名（重新登场即生效）；懒回填（启动时按
  meta.hero 查 roster 补 meta）留后续包。G7 人验收待 nita 真机看 Header。

## 2026-11-18 程序化创建 agent block + 投递文本（agentlaunch / agentsend）

- 需求：昨天 CommonText「一步发布到 agent block」的注入半段是纯前端（隐藏挂载 + xterm paste），
  外部 agent 调不到 → 要做后端化，且调用方能选 agent / Tab / 路径；块照常展示（后台≠隐藏）。
- 两个包：`11-09-agent-block-create`（`wsh agent launch`，建块半段）+ 新建 `11-18-agent-block-send`
  （`wsh agent send` / `launch --send`，发送半段）。提交 `3a2c93831`。
- 建块：catalog 单一事实源（未知 profile 不兜底同名二进制）、meta 与 GUI createAgentBlockDef 对齐、
  复用 CreateBlockCommand、新 scope `launch`、MCP `snorkeling_agent_create`、`defwidget@agent` 改走默认 profile。
- 发送：`blockcontroller.SendInput` 唯一写入口；bracketed paste + 150ms 后单独 `\r`；
  就绪判定改看块 term 文件 quiet（后端可判，不依赖前端挂载）；controller 未起则 ResyncController。
- 真机（dev 实例 verify-agent-launch，跑完已关）踩到两个真实缺陷：
  1) `ShellController` 先报 running 后建 `ShellInputCh` → 首次写入 `no shell input chan`（限时重试 3s）。
  2) pi 裸模型 id 跨 provider 歧义（目录 18 模型/6 provider，运行时 8 provider 已认证）→
     目录条目带 provider 时统一展开 `provider/id`。
- 数字：go build ./... 0；agentcatalog/agentscope/agentmcp/waveobj/wshrpc/cmd:wsh 全绿；
  真机 7/7（launch pi + --send → pi 回 OK；term 探针 exitcode 0；非 term E_BLOCK_NOT_READY；
  70KB E_USAGE；bad model 块数 12→12；bad profile E_PROFILE_UNKNOWN）。
- 待办：G7 人验收（nita 真机看 Tab 里新建 agent 块与消息落地）；`scripts/verify/agent-send` 验证台
  尚未建（当前证据是 wsh 直连 + filestore 核对，不是 verify 台）。

## 2026-11-19 Tab 切换卡顿调查 + reinitWave 减负（child1 提交 f61ad7c29）

- 用户反馈「页面加载时影响切 Tab / 切换卡断」。先只读调查（未改代码），定位两个叠加原因：
  ① 冷切换（cache miss）在主进程串行动作队列里等 `initPromise` + `waveReadyPromise`
  （`emain/emain-window.ts:524-547`）；② 温切换每次重跑 `reinitWave()` 的 5 次串行 RPC +
  N 次 workspace tab reload（`frontend/wave.ts:175`）。
- 已存在缓解 R9.1 乐观高亮 / R9.2 双入队去重（`tab-optimistic-active.ts` / `emain.ts:131`），
  只治视觉高亮，不解根因。R9 任务明确把「队列插队（C）」与「reinitWave 减负（D）」列为后续片。
- 建任务树：父 `11-19-tab-switch-perf` + child1 `11-19-reinitwave-relief` + child2
  `11-19-tab-switch-queue-decouple`（deferred，默认关）。本机性能差，用户豁免真机验证。
- child1 实现：新建纯函数 `frontend/app/wave/reinit-wave-plan.ts`（`planReinitWave` /
  `planWorkspaceTabReload` / `forEachTabToReload` / `SIDE_EFFECT_ORDER` / 开关
  `REINITWAVE_RELIEF_ENABLED=true`）。wave.ts 改为按批次 `Promise.all`，结果按 kind 存 map 传依赖
  （window→workspace / tab→layout）；tabids 未变时跳过 N 次 reload；7 项副作用全保留。
- 设计期微调：纯函数拆二 —— RPC 前只出批次/副作用，RPC 后用新鲜 ws.tabids 单独决策 tab reload，
  避免伪造中间态入参。已回写 design.md 与 spec（state-management.md 新增「派生决策拆两纯函数」）。
- 判据：13 单测全绿（含 A3「调用次数为 0」字面断言、off 路径逐项回归锁）；白名单 tsc 0 error；
  eslint 0 error（仅 wave.ts:66 既有 prefer-const warning）。全仓 tsc 55>47 是共享工作区其他任务
  的漂移，8 条全不在白名单。trellis-check 通过（4 条非阻断观察，A3 断言已补）。
- 提交 `f61ad7c29`，只提交我的 14 文件；工作区其他 21 个在途改动未动。
- 效果判断（诚实）：机制上有效，但未量化。最实在收益是跳过 N 次 tab reload（tab 越多越明显）；
  5→2 批并行的收益量级未知。child1 只改善温切换，冷切换「页面加载卡断」主因在队列（child2）。
  reinitWave 无分解计时日志，主进程 27-42ms 温切换日志不含它（renderer WSH 通道异步）。
- 下一步建议：① 补执行器级 mock 测试拿「RPC 次数下降」机器证据；② 有真机数据后再评估解锁
  child2（6 项竞态：activeTabView 覆盖 / finalizePositioning 移屏 / focus 守卫失效 /
  wave-init 早于 handler / R9.2 去重依赖队列 / 半初始化 view 被 close）。
- 调查页：`docs/answers/tab-switch-perf-20261119-131307.html`、
  `tab-switch-risk-20261119-131626.html`、`next-step-recommendation-*.html`、
  `child1-effect-assessment-*.html`。

## 2026-11-19 agent card set --prop-add-option（写值同时追加候选，代码+测试完成，真机待验）

- 问题：`--prop-scope agent` 走 `upsertSchemaDef` 只改 key/name/type/scope、Options 保留原样，
  新值进不了下拉候选；加候选只能整条重写 agent:propertyschema（易丢其它属性、setconfig 无 dry-run）。
- 实现：`--prop-add-option key=v1,v2`（可重复、逗号分隔）；合并单点 `agentdata.MergePropertyOptions`
  （幂等/保序/大小写不敏感去重/绝不删已有）；schema 侧 `appendSchemaOptions/upsertSchemaDef`
  无新增时返回原 slice（settings 字节级不变）；dry-run `propOptionPreview` 现算 `prop:<key>.options` diff。
  两条不变量：scope 必须 agent/all（CLI 报错 + agentcontrol E_USAGE 兜底）；key 必须同时出现在 --prop。
  wshrpc/agentdata/agentdata patch 管线（dry-run/expectedHash/backup/audit）全复用；gotypes.d.ts 已重新生成。
- 判据：`go test ./pkg/agentdata ./pkg/agentcontrol ./cmd/wsh/cmd` 全绿 + `go build ./...` 通过 + go vet 通过；
  新 e2e `TestAgentCardEndToEndAppendsPropOptions` 覆盖 dry-run→E_USAGE→真写→读回→重复不重复。
- 真机未验：运行中的 dev wavesrv 是旧二进制，会静默丢弃 addoptions（实测 dry-run 无 option diff）；
  进程内链路已全验。今晚先重启 app 再按文档 §7 六条验收。
- 顺手发现未改：`patchDomains` 不给纯 props 补丁打 SQLite backup（title/prop 均不在列），既有缺口，
  归 11-09-agentdata-backup-granularity。
- 文档：`docs/project/agent-card-prop-add-option.md`（全量：改动/测试/验收清单/今晚待做/提交文件清单）。
  HANDOFF.md 已置顶一节。未 commit/push；提交时只带本包 10 文件（清单见文档 §6）。

## 2026-11-19 CommonText 弹窗性能整改（进行中，晚上继续）

- 任务 `.trellis/tasks/11-19-commontext-compose-perf/` 已 `in_progress`；用户下班，进度已写入 `implement.md` 的 Progress Snapshot。
- 基线：commontext 三个目标测试 82 例全绿。
- 已完成 model 层：`caretContextSignature`（当前行+当前词）、`searchCommonTextComposeItemsFromBase`、搜索字段 WeakMap；model 测试 61 例全绿。
- 已完成 modal 大部分骨架：三开关、searchText/searchCaret/caretTokenRevision、pendingSearchRef、flushSearch、baseItems memo、关闭态 guard、CommonTextRow、listWindow/scroll 换算、nowMinute。
- 16:15 更新：列表渲染已切到 `listWindow + CommonTextRow + 上下 spacer`；旧全量行 DOM 保留在开关 false 分支作回滚基线。Enter/行内插入已先 flushSearch；行回调用 ref 稳定化。
- 未完成：ResizeObserver 150ms 静默提交未做；DOM/source 的 Enter flush/关闭态断言未补；perf 探针未建；verify 台未适配；tsc baseline 未跑。已跑 source+dom 25 例全绿，model 61 例全绿。下次先补测试与 tsc。
- 注意事项：本机性能差，用户豁免真机；只跑 commontext 目标文件，不跑全量 vitest。

## 2026-11-19 16:0x：闪退时「PowerShell 未处理异常」根因查清（fsmonitor 泄漏，纯调查，未改代码）

- **结论**：PS 弹窗 = `powershell.exe` 的 `System.OutOfMemoryException`，整机 commit 耗尽（26.4GB 上限用掉 24.9GB）
  的受害者，不是凶手；同一分钟 dwm.exe 崩 + wavesrv `fatal error: out of memory`（errno=1455=ERROR_COMMITMENT_LIMIT）。
  用户报的「闪退时弹 PS 未处理异常」= 旧版 emain 在 wavesrv exit 就 `app.quit()`，弹窗压在整窗消失那一瞬。
- **OOM 频次**：11-16~11-19 共 8 次（11-19 三次：09:26/11:12/13:36）；当前这套 Snorkeling 进程全是 14:55 那次闪退后重启的。
- **新泄漏（2.85GB）**：67 个 `git fsmonitor--daemon`，父进程全退出、最老 434 分钟、无空闲超时、一仓一只。
  根因三层：① `D:/SoftWare/Git/etc/gitconfig` 系统级 `core.fsmonitor=true`（Git for Windows 默认）；
  ② 任何刷索引的 git 命令首跑即拉起 per-worktree daemon 且永不退；
  ③ `pkg/wshrpc/wshremote/vcs.go detectRepoRoots`（`MaxVcsRepos=64` / `scanDepth=3`）对目录 WalkDir 后逐仓跑
  `git status --porcelain=1 -uall`，把几十个仓的 daemon 一次全拉起 —— 观测 ~60 个真实仓 daemon 与 64 上限吻合。
  临时仓也中招：data-guardian 的 `dgdb_check.py` 用 `mkdtemp` 建仓不清理，%TEMP% 已 225 个 `dgdb-check-*`。
- **顺手记下**：`%LOCALAPPDATA%\snorkeling-agentstatus-hook.log` 230MB/145万行无轮转；PRD 说 pagefile 已调 16/24GB 但实测上限仅 26.4GB，需复查。
- **改动**：无代码改动。证据、时间线、复现命令、今晚待办全文见
  `.trellis/tasks/11-19-wavesrv-oom-flash-quit/findings-fsmonitor-leak-20261119.md`；可视化页
  `docs/answers/crash-powershell-oom-20261119-1532.html`。
- **今晚第一步**：按 command line 过滤 PID 清掉 67 个 fsmonitor daemon（回收 ~2.9GB），再决定系统级关 `core.fsmonitor`
  还是产品侧 `newVcsCommand` 统一加 `-c core.fsmonitor=false`（那一行已有 `core.quotePath=false`，改一处即全量生效）。
- **是否开 Trellis 包**：未开（等用户拍）。建议新包承载「git 调用带 fsmonitor=false + detectRepoRoots 扫描收敛 + dgdb 清理」，
  不塞进 11-19-wavesrv-oom-flash-quit（那包的 R1/R2/R3 已交付且 GOMEMLIMIT 治不了本根因）。

## 2026-11-19 晚：批量清账——19 个「已完成未关闭」任务归档（判据可复现）

- 背景：活跃任务 115 个积压。用户提出「已随早期版本发布的任务应关闭」（当前 0.0.131）。
- 判据（三重机器证据，不凭印象）：① 交付提交被 ≤0.0.129 的 tag 包含（`git tag --contains`）
  ② loop 台账 runState ∈ {released, accepted, green, committed} 或文档「判据全绿」
  ③ 关键代码在 HEAD 抽验通过（i18n locales / vcs-history-graph / hero CHARTER / persona 前端 / ErrorBoundary / tab-collapse 在 main）。
- 归档 19 个（`task.py archive --no-commit`，避免把四个 worker agent 的在途改动一起提交）：
  11-06-move-block-tab-menu、11-06-overview-board-motion、11-06-overview-board-card-actions、
  11-06-agent-card-tag-picker、11-06-monochrome-degloom、11-07-commontext-sync-metadata、
  11-09-agent-chip-conditional-hook、11-12-persona-{create-ui,journal,relocate,roster-block,sync,widget-launch}、
  11-14-i18n-rollout、11-15-vcs-history-graph、11-16-hero-identity-inject、11-17-conn-typeahead-row-rail、
  11-18-tab-collapse-active、10-21-frontend-ui-prompt-audit（本来就是 completed 未归档）。
- 待用户确认的边界件：11-05-preview-pager-hover-hint（32/32 绿但 1 项未勾）、
  11-06-tab-hover-clip（修复已发布但 loop parked）、10-27-aisessions-scroll-perf（主修复已发布，剩余疑似被 virtual-row-stability 接走）。
- loop 台账滞后（引擎在 Windows）：N-1109-agent-chip-conditional-hook 修复已发布但 runState 仍 queued，
  需引擎侧 `queue accept`；本次归档动作本身未动 loop/。
- 归档时 task.py 的 node hook 报错（fail-open），归档本身全部生效（archive 目录 63→82，活跃 122→103 目录）。
- 同时段：4 个 worker agent 块（A/B/D 仍在跑，C=reinitwave-relief 已结束待收结果）。

## 2026-11-19 晚：agent launch --send 假成功（nita 实测）

- 现象：`wsh agent launch --profile pi --model deepseek-v4-pro --tab active --split right --send-stdin`（F 块 818035e2，
  任务 11-19-property-ui-add-option）返回 `send.ok=true injected=true submitted=true waitedms=403`，
  **但 pi TUI 实际没有收到文本**（nita 肉眼确认块空转）。前五个块（A-E）同样方式都成功，本块失败。
- 疑点：与 spec「ShellController 先报 running 后建 ShellInputCh」竞态一致，或 split 后目标块未聚焦/未挂载导致
  注入进了别的 PTY；`--wait` 只等 layout，不等 TUI 真正可读。
- 归属：`11-18-agent-block-send`（in_progress，其 verify 台 `scripts/verify/agent-send` 尚未建）。
  建议该包补一条断言：launch --send 后必须从块 term 输出文件回读确认文本真的出现在 TUI 输入框。
- 本次处置：nita 手动给该块发指令。后续 launch 大量并发的场景前，先修/先验这条链。

### 追记：根因确认（同日，20:0x）

- 上条「疑点」已证实：**就绪判定把「零输出」当「安静」**。F 的 `waitedms=403≈quietms+3` 是零输出指纹
  （A-E 为 605/1106/1109/604/704ms，均有真实首屏）。当时 5 个 pi + vitest 满载，第 6 个 pi 首屏 >403ms。
- 证据：filestore `db_wave_file` 里 F 的 term 输出 3.3MB（pi 后来正常起来）；输出内含 nita 手动发送后的
  「11-19-property-ui-add-option」测试代码，说明手动发送通、原 launch 的 send 落在 TUI 起来之前。
- 修复要求已落到 `.trellis/tasks/11-18-agent-block-send/FINDING-launch-send-race.md`：
  首字节门槛 + 发后回读验证 + verify 台慢启动用例。

## 2026-11-19 晚：归档 11-18-overview-select-component（AppSelect 统一下拉）

- 判据：提交 `363d70eb9`（新增 AppSelect + 总览两处下拉迁移）在 main；`select.tsx/scss/test.tsx` 在 HEAD；
  `session-overview.tsx` 两处 `<AppSelect>`（`data-overview-range` / `data-overview-group`）确认接线。
- **未做真机验收**（implement.md 3.1-3.4 的 overview-board / overview-timeline 两个 verify area 没跑）——
  nita 决定先归档。风险兜底：装 0.0.132 后若下拉异常，按 AppSelect 单测 + 新增真机台复查。
- 范围说明：本次只迁移 2 处；仓库仍有 8 个文件十余处原生 `<select>`（commontext 弹窗、定时任务、waveconfig、
  aiaudit、vcscommits 等），属后续「统一所有下拉」的独立工作。

## 2026-11-19 深夜收尾：fsmonitor 泄漏分析暂停点（明天继续）

- 责任链已定（三层）：Git for Windows 系统级默认 core.fsmonitor=true（开关）/ git daemon 无空闲超时（不退）/
  Snorkeling detectRepoRoots 逐仓 git status（数量放大 67≈64 上限）；辅凶 dgdb 临时仓。Mac 本机 0 daemon（Windows 专属）。
- 方案 A（产品侧 -c core.fsmonitor=false）缺点四条已记录（大仓变慢 / 治不了存量 / 覆盖面需收口两处构造器 /
  静默覆盖用户选择），nita 决定明天继续分析，未拍板未动工。全文见
  .trellis/tasks/11-19-wavesrv-oom-flash-quit/findings-fsmonitor-leak-20261119.md 末节「修复方案 A 的缺点分析」。
- 今晚暂停时的状态：A/D 两个 agent 仍在跑；B/C/E/F/G 已提交（d8e2d38ee 等）；活跃任务 87；
  待办：A/D 收口 → 0.0.132 发版（agent 全收工后）→ 真机验 E 截断修复 + 两个新下拉 + prop-add-option 六条。

## 2026-11-20 凌晨：11-19-scheduled-task-agent 收尾（commit a3466b225，已 push origin/main）

三阶段全部落地 + 真机判据 A1-A10 全过（临时 wavesrv + 自制 JWT mint / agent token 验证，环境已清理）。

- **P0 CLI+MCP**：`wsh scheduledtask list/get/create/update/delete/run`；create 默认 dry-run（`--yes` 落库）；
  MCP `snorkeling_scheduledtask_{list,create,run}` 同 handler；**createdBy 服务端判定**（`callerIsAgent`），
  agent 配额 10 → 第 11 个 `E_QUOTA (10/10)` exit 1；顺带堵了两个洞：update 不再 upsert（原实现缺 id 即 append，
  可绕过配额）、update 不能改 createdBy/createdAt（防改归属脱管）。
- **P1 双模式 + launch --headless**：`ScheduledTaskType.Mode(""|headless|block) + Tab(current|new|<tabid>)`；
  runner 走 `scheduler.HeadlessArgs` 单一参数表；block 模式注入 `LaunchBlock`（wshserver 复用 AgentLaunchCommand，
  校验失败不建块）；`wsh agent launch --headless` 与 `--tab` 互斥 E_USAGE，返回 exitcode/outputPath。
- **P2 启动补跑**：`CatchUpMissed`（CATCHUP_ENABLED 开关默认 true），按 lastRunAt 锚点算错过窗口 → 串行补跑一次 →
  LastRunStatus=missed-run；真机验证：lastRunAt 拨回 1h + every:10m → 重启补跑一次，再重启不重复。
- **判据数字**：A1 `go build ./...` 0 错；A2 三个包单测全绿；A3 list --json=[]；A4 dry-run 后 settings 任务数不变；
  A5 E_QUOTA(10/10) exit1（user 任务不计入，delete 释放后可再建）；A6 headless run 日志含 "ACK"、db_block 前后 0；
  A7 block run db_block 0→1、meta `agent:provider=pi`+`cmd:cwd`；A8 launch --headless exitcode 0 + outputpath、
  --tab 并给 E_USAGE；A9 见上；A10 生成物 add-only（0 删除行）。

### 踩坑与交接事项（留给主 agent / 后续包）

1. **go2ts 生成器 Origin 顺序随机翻转**（今天第二次踩）：`syncproto.Origin` 与 `hero.Origin` TS 名同名 → sort.Slice
   不稳定 tie → 每次 generate 可能互换。本次两次生成都翻成 hero 在前，已手工恢复 syncproto 在前、最终 diff add-only。
   **建议跟包修 generator**（tsgen.TypeToTSType 加包名前缀或 sort 加稳定 tie-breaker），否则每个改 wshrpctypes 的包都要手工还。
2. **wshcmd-mcp.go 的 rpcBackend 新增 3 方法**虽不在本包白名单，但是 Backend 接口扩展的必要适配（薄转发，无逻辑）——
   已在 commit 中，请知悉。
3. **scheduledtask\* 命令未加入 `agentscope.commandScopes`**（scope.go 不在白名单）：MCP 工具层 scopeAllows 已挡写类工具，
   但 scoped token 直连 RPC 时 transport 层不校验这些命令。非本包新引入（历史同款），建议后续补 gate（list→observe /
   create/update/delete→data / run→launch）。
4. 复用了 `canonicalizeModelArg`（经 `scheduler.CanonicalizeModelArg` 包级变量注入排 configure）：pi 裸 id 多 provider
   歧义问题在 scheduled headless 路径同样成立，已同一映射修正。
5. 真机事实：`~/.snorkeling/scheduledtask-runs/` 现留有本功能验收日志（含 05e0e8a3 开头的他人/后跑痕迹），属功能正常产物。

## 2026-11-20 下午：Overview 看板点 agent 卡「卡顿 / 点不开」诊断 + 建包（未改代码，晚上做）

- **主因已复现**：`overview-board.tsx` `openCardFromTarget` 的 `event.target !== event.currentTarget`
  卫语句（b35075532 / 11-08 引入）把卡片内部所有子 span 的点击全丢了 —— 只有卡片裸内边距能开弹窗。
  jsdom 实测：点标题/预览/头像 → onOpenCard 0 次；点内边距 → 1 次。
- **卡顿两个放大器（11-10 修复轮漏网，另拆包）**：① `columns`/`columnKeys` 未 memo → 每次渲染重跑
  `captureBoardSnapshot`（querySelectorAll + 每卡 getAnimations + rect）+ ResizeObserver 重建，点击的
  markBlockViewed 重渲正好压弹窗入场帧；② 15s summary 轮询 + 30s now tick 让 `boardCards`/`miniTimelines`
  全量换引用 → 整板全量重渲。
- **方案（nita 确认）**：整卡默认可点 + 热区白名单（button/a/input/[contenteditable]/[data-card-interactive]）；
  emoji 头像改独立 button 接 `openAgentEmojiPicker`（需给 `OverviewBoardCard` 补 raw `provider`）；
  顺带修 Enter 在内部按钮上冒泡双触发；选区非折叠时不开。
- **产出**：新建任务 `11-20-overview-board-card-click-hotzones`（PRD-only，已 start），
  记录 `.trellis/tasks/11-20-overview-board-card-click-hotzones/notes-20261120.md`；
  可视化 `docs/answers/overview-board-card-click-diagnosis-20261120.html` + `...-plan-20261120.html`。
- **晚上接手**：按 notes 末节「今晚开发步骤」1-4 走；性能两包单独立项。

## 2026-11-20 傍晚 · Overview 新建 Agent 弹窗 v2 + CommonText 发送失败诊断（只记录，晚上开发）

- **用户四条新反馈**：① 看板「＋ 新建」→「＋」；② 弹窗要有输入内容（语义 = 新建 agent **并发送**，不是只建空块）；
  ③ 点选 agent 要展示对应模型且可切换；④ 弹窗再大点、宽松点。
- **落档（未动代码）**：
  - `.trellis/tasks/11-20-f-1120-overview-add-agent-card/prd.md` 追加 **v2 四条**（V2-1 入口图标化 / V2-2 message + `AgentSendCommand`
    首发 / V2-3 弹窗内模型下拉（`loadAgentCatalog` + 照搬 scheduledtaskeditormodal 模式，值传 `createAgentBlockDefForProfile` 第 7 参）/
    V2-4 宽度 480→560、段距 10→14），含 v2 验收判据与代码锚点地图。
  - `.trellis/tasks/11-18-agent-block-send/PRD-ADDENDUM.md` 追加 **R10**：CommonText existing 发送路径收口到 `agentsend`
    （远端/E_UNSUPPORTED 回退旧 paste 链，失败必须走 onStatus 可见），create 路径不动（挂着 verify area）。
- **发送失败根因（前端链 5 入口）**：固定 150ms 回车竞态 / spinner 打穿 quiet 判定 / 60s TTL 兜底成剪贴板 / 隐藏挂载上限 2 /
  未就绪直报失败且只在 console。结论：别猜，改调后端 `agentsend`。
- **晚上接手顺序**：11-20 v2（前端四项，白名单 `frontend/app/session-overview/` + i18n）先做；11-18 R10 独立一包跟在后面，
  先跑 `node scripts/verify/commontext-send-agent-block/verify.mjs --attach` 与 `commontext-send-background` 定位失败入口。

## 2026-11-20 21:20 · 11-20 v2 落地（Overview 新建 Agent 弹窗四项）

- **V2-1** 看板入口「＋ 新建」→ 纯 ＋ 图标（保留 aria-label + title）。`overview-board.tsx` AddAgentButton。
- **V2-2** 弹窗顶部加「发送内容」多行输入；提交链路 = `CreateBlockInTab`（返回 blockId，不抢焦点）→ 非空则
  `RpcApi.AgentSendCommand({blockid, text64, submit:true})`。失败不回滚块，`onSubmit` 回执 `{ok:false,error}` →
  弹窗不关、内联报错、footer 只留「关闭」（不给重试，避免建第二个块）。远端路径禁用输入并提示（agentsend 本地限制）。
- **V2-3** 点 agent chip 后展示模型下拉：`loadAgentCatalog()` + `modelOptionsFor/pickDefaultModel`，默认项 value=""
  （跟随 profile 配置，行为不变），显式选中才写进 `modelOverride`；切 agent 自动回位；catalog 无模型 → 手填输入框。
- **V2-4** 弹窗 480→560、段距 10→14、路径列表 280/36vh→320/40vh，新增 message/model/hint/error 样式。
- **回归**：`npx vitest run frontend/app/session-overview` → 17 files / 244 tests 全绿；tsc 本包 0 错；eslint exit 0。
- **并发警告**：`session-overview.tsx` / `overview-board.tsx` 里同时有并行包（11-20-overview-board-card-click-hotzones）
  未提交改动（CardHotzoneSelector、provider raw key 等）。**本包暂不提交**，等对方收口后一起或按文件拆提交。

## 2026-11-20 21:35 · 11-18 R10 落地（CommonText existing 发送收口到 agentsend）

- `commontext-send-button.tsx` existing 分支：本地块 → `AgentSendCommand`（就绪等待+paste+回车全在后端），
  先报 sending(info) 再落 sent；远端 / E_UNSUPPORTED / E_NOT_FOUND 回退旧前端 paste 链；
  其它错误不回退（防双发）→ sendFailed 可见 + false。
- 新增 `commontext-send-existing.test.ts` 5 用例；`npx vitest run frontend/app/commontext` 191/191 全绿；
  tsc/eslint 0 错。新增 i18n key `commontext:send.sending`。
- **未提交**（与 11-20 v2 一致）：`session-overview.tsx` / `overview-board.tsx` / `session-overview.scss` 里
  混着并行包（hotzones）的未提交改动，等它收口再一起/分文件提交。R10 自身的三个文件是干净的，可先提。
- 真机 verify（commontext-send-agent-block / background + wsh block read 复核）留到与 11-20 v2 收尾一起跑。

## 2026-11-20 夜：11-20-overview-board-card-click-hotzones 收尾（实现 + 单测全绿，真机 skipped）

- **根因落地修复**：`overview-board.tsx` 去掉 `target === currentTarget` 卫语句 → `isCardHotzone` 白名单
  （button / a[href] / input / textarea / select / [contenteditable] / `[data-card-interactive]`，`closest` + `root.contains` 防越界）；
  卡片根唯一 click handler，head 上重复 onClick 删除；动作区 stopCardEvent（含 mousedown）保留。
- **emoji 独立热区**：`BoardAvatar` 双形态（有 `onPickEmoji` → `<button data-card-interactive>`，否则纯 span）；
  `OverviewBoardCard` 补 raw `provider`（取自 `OverviewBlock.agentProvider`），`isAgentLike && provider !== ""` 才接
  `openAgentEmojiPicker(..., "session", sessionId)`；兼容类 `.session-overview-board-card-avatar` + `data-avatar-kind` 保留给探针。
- **连修**：根 keyDown 加 `target !== currentTarget` 守卫（原在 emoji/动作按钮上按 Enter 会双触发开卡）；
  选区非折叠时点击不开卡（拖选文本松手不弹窗）。
- **判据**：`overview-board-hotzones.test.tsx` 14 例逐格（点标题/预览/无 provider 头像/裸内边距开卡；
  emoji 只开 picker 且参数全断言；jump/delete/close/chip 各自回调且不开卡；根 Enter 开卡、emoji Enter 不开卡；选区保护）；
  `npx vitest run frontend/app/session-overview` 17 文件 244 例全绿；tsc 58 < 69 基线（本包 0 新增）；eslint 0 error。
  旧 memo 用例「点子元素不开」正是本 bug 语义，已按新语义改写。
- **真机 skipped**：用户明确本机性能不够、不要真机验证；`scripts/verify/overview-board/verify.mjs` 已扩阶段 1a
  五条判据（真实指针点标题开弹窗 / 点 emoji 头像开 picker 且不开弹窗 / avatar-btn 计数），有环境直接跑；台账已记 skipped。
- **spec**：`quality-guidelines.md` 新增「卡片点击 = 热区白名单，不是 target === currentTarget」（含探针契约与 Enter 双触发坑）。

## 2026-11-21 12:15 · v2 事故根因闭合 + 修复（d4c699c81）

- **用户三连报障**：本地 Tab 弹窗提示「远端 Tab」、编辑不了消息；新建 agent 后消息从未送达；
  CommonText 发送也不正常（待复核——见下）。
- **排查手段**（全只读探针，未污染用户会话）：`%APPDATA%` asar 字符串核对版本归属 →
  DB（waveterm.db 块 meta connection 分布：8×preview+vcs 都是 "local"）→ CDP 动态 import
  实跑纯函数与 `executeCommonTextSend` 本体 → filestore.db term 文件核对注入原文。
- **根因**：`isLocal = connection == null` 语义错（"local" 是本机规范值）→ 本地 preview 块全被判远端
  → 弹窗 `isRemotePath` 误判 → 消息框锁死 + submit 静默丢消息。
- **修复**（d4c699c81）：`isLocalTargetConnection` 收口 + 路径行行级 isLocal + fallback 行带 Tab 连接
  + 远端+已写消息显式拦下（红提示+禁用创建，绝不静默丢）。
- **真机复核**：用户真实 tab-01 数据 9/9 targets、9/9 rows 全部 isLocal=true；
  后端 agentsend（后台 Tab 新块 injected/submitted=true，term 文件含探针文本）与
  CommonText existing（`发送中… → 已发送` + term 注入确认）都正常——失败不在这两条链。
- **遗留待用户确认**：① CommonText「发送也不正常」在哪个实例复现（安装版 0.0.133 是旧
  paste 链路，无 R10；dev 实例已实测正常）②「以前发送失败右上角显示复制信息给agent」具体指什么
  （词表里没有这个串，疑为已复制（无插入目标）/notReady 状态的旧记忆，下次出现请截图）。

## 2026-11-21 夜 · 方案 A 收口 + A+ 派发队列落地

- **方案 A（c0b7fe080）**：派发不等待（弹窗建块即关）+ 后端两阶段就绪门（启动标记期不打回车；
  标记消失后投 CR，ack 优先 agentstatus hook；窗口 60s→180s）。真机：pi 新建+立即发送 → retries=5
  → confirmed，模型真实回答。
- **A+（11-21-agent-dispatch-queue）**：服务端派发队列 `pkg/agentdispatch` + `agentsend async:true`
  + `agentdispatchlist|get|retry` RPC + CLI（`wsh agent send --async`、`wsh agent dispatch *`）
  + 前端改 async。真机：提交 421~866ms 返回 dispatchid → 后台投递 → confirmed（三段回执全 true）→
  模型真实回答（term 有回答与 token 计数）。
- **真机两次误判的教训（已写进代码注释与 PRD）**：agent 块的提交确认**只认 hook**（agent_start→working）；
  「输出增长」在 pi 启动期同样发生（banner 渲染），绝不能用它当 agent 的 ack。非 agent（shell）块才允许。
- 生成器坑：新增被 RPC 引用的包必须在 `cmd/generatego` 导入表加上，否则 `task generate` 重写
  wshclient.go 会丢 import 导致全仓编译失败（并且 generate 自己也会因此失败，被卡成鸡生蛋）。

## 2026-11-23 CommonText 弹窗失焦根治（11-23-commontext-modal-focus）

用户报「详情编辑容易失去焦点、拿不到焦点，切 app 的 Tab 再切回来才好」，此前几轮都修在
composer 编辑器/列表（重渲染、IME、hover）。这次真机 CDP 走查（真实指针+键盘）证明 textarea
自身受控更新路径稳定，真正问题在两层：①弹窗不写 `atoms.modalOpen`（只有 ModalsRenderer 写），
`.modal-wrapper` 全屏吃点击（tab 栏命中元素就是它），点外面 → 焦点掉 body → 按键被派发给背后
聚焦块（终端会写进 shell）；②tab 的 WebContentsView 会莫名丢 webContents 焦点，DOM activeElement
还在但键入收不到，只有切 Tab 的 `webContents.focus()` 能修——正是用户绕行路径的机制。

修法（4d6c4571f）：`modal-open-registry`（命名来源计数+sink，Modal 外壳/modalsModel 栈/tab-target-modal
共用，`app.tsx` 唯一写 atom）；`.modal-wrapper` pointer-events:none；弹窗失焦回收（relatedTarget==null
且 activeElement==body 才 rAF 回焦）；详情区合成期不重置字段；emain `on("focus")` 按
`shouldRefocusActiveView` 补 focus。判据：registry 6 + modal.dom 10 + compose-modal.dom 25 +
emain-window 12 全绿；真机探针 6/6 PASS（弹窗开着时新建 Tab 生效、切 Tab 往返弹窗仍在可编辑）。
教训已入 quality-guidelines：这类问题先分 DOM/外壳/窗口三层，别再改输入框内部。
