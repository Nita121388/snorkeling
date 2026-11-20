# Overview 看板 Tab 下新建 Agent 卡

## Goal

Overview 看板（看板视图，按 Tab 分组）与列表视图的每个 Tab 组底部提供「＋ 新建」入口，
点击弹出**居中弹窗**（chrome/样式与 New Agent 弹窗一致），可选手动 agent、覆盖模型、从该 Tab 的路径候选中选择工作目录；
确认后在该 Tab 内创建一个新的 agent 块（不切换焦点、不抢当前 Tab）。

## 做什么

1. **看板入口**：`overview-board.tsx` 在 `group === "tab"` 时，每个 Tab 列卡片列表末尾渲染虚线占位按钮
   `.session-overview-board-add`（文案「新建」，复用 `workspace:agentLaunch.newAction`）。
2. **列表入口**：`session-overview.tsx` 的 `TabGroupSection` 卡片列表末尾渲染 `＋ 在此 Tab 新建 agent` 行
   （`.session-overview-tab-add`）。
3. **分组守卫**：仅容器型分组（`tab`）显示入口；`status` / `provider` / `project` / `tags` 是派生列，不显示
   （避免「把卡片塞进 working 列 = 让它变 working」的假交互）。纯函数 `shouldShowAddAgent(group)` 承载该规则。
4. **新建弹窗** `overview-add-agent-modal.tsx`：
   - 容器：全局 `<Modal>`（`frontend/app/modals/modal.tsx`）→ 居中 + backdrop；
   - chrome 复刻 New Agent 弹窗（`hero-launch-window.tsx`）：标题行 + 右侧 ✕、段标签 `text-xxs muted`、
     agent **chip 行**（选中 `bg-accent/12` + 左 2px accent 条）、`h-[28px]` 模型输入框、`border-t` footer；
   - 内容两段：选择 agent 类型（profile chips）、选择一个路径。（**可滚动候选列表**）；footer 取消/创建；
     **本版不提供模型覆盖输入框**（`modelOverride` 恒 null，用 profile 默认模型）—— 2026-11-20 用户反馈「暂时不要」；
   - 文案全部复用 `workspace:agentLaunch.*` 词表，Tab 名只在头部出现一次。
5. **路径候选随 Tab**：候选来自该 Tab（`collectAgentLaunchTargetsInTab`），经 `collectFolderCandidatesForTab`
   去重排序；默认选中「随 Tab」项；远端 Tab 每行第二行显示 connection（如 `ssh://mac`）。
6. **建块**：`createAgentBlockDefForProfile(profile, settings, context)`，其中
   `context = { connection, cwd, inheritWorkspaceContext: false }`（不继承当前焦点块上下文），
   再用 `ObjectService.CreateBlockInTab(tabId, blockDef, DefaultRuntimeOpts, false, false)` 建到目标 Tab，
   **activateTargetTab=false**（不抢焦点）。
7. **i18n**：仅新增 aria-label 等辅助串到 `session-overview` 命名空间（中英各一份）；可见文案一律复用既有 key。

## 不做什么

- 不做自定义笔记卡 / 卡内层级子卡 / 拖拽建卡。
- 不沿用 New Agent 弹窗的「启动方式（TUI/GUI）」「环境变量」「cc-switch 供应商选择」三块（本入口只做最小创建）。
- 不在 `status` / `provider` / `project` / `tags` 分组下提供新建入口。
- 不改 `hero-launch-window.tsx` / `widgets.tsx`（New Agent 弹窗本体零改动）。
- 不改后端（无 Go / RPC 变更；`CreateBlockInTab` 既有能力）。
- 空 Tab 在看板列里本来就不渲染（既有行为，不在本包改动）。

## 验收判据

- [ ] `npx vitest run frontend/app/session-overview/overview-add-agent.test.ts` → `passed`
- [ ] `npx vitest run frontend/app/session-overview/overview-add-agent-modal.dom.test.tsx` → `passed`
- [ ] `npx vitest run frontend/app/session-overview/overview-board-add.test.tsx` → `passed`
- [ ] `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "overview-add-agent"` → `0`
- [ ] `npx eslint frontend/app/session-overview/overview-add-agent.ts frontend/app/session-overview/overview-add-agent-modal.tsx frontend/app/session-overview/overview-board.tsx frontend/app/session-overview/session-overview.tsx` → `0`

> 注：仓库 tsc 基线非零（其他在途包 58 条），`session-overview/` 整目录还有 3 个老夹具因
> `propRows` 新字段未补而红（11-17-overview-card-props 在途）。本包只对**自己新增/改动的
> 文件**取 0 错误基线，不替别人的包背债。

判定细节（由上述测试锁住）：

- `shouldShowAddAgent("tab") === true`；`status/provider/project/tags` 均为 `false`。
- 看板 `group="tab"` 时每列渲染 1 个 `.session-overview-board-add`；`group="status"` 时 0 个。
- 弹窗：标题 = 新建 Agent；Tab 名在头部出现一次；段标签 exact 为 `选择 agent 类型` / `选择一个路径。`；
  默认预选第一个探测到的 profile（与 New Agent 弹窗一致），「创建」立即可用；点其它 chip 即切换选中；
  不渲染模型输入框（`.session-overview-add-agent-model` 0 个）。
- 路径列表：`role=listbox`，行数 = 候选数，默认选中「随 Tab」项；普通本地候选无第二行，远端项有 connection 行。
- 创建时回调携带：`tabId`（列/组所属 Tab）、`profileName`、`path`（选中项，默认 Tab cwd）、
  `modelOverride`（本版恒 null）、`connection`（远端 Tab 保留）。
- 创建后请求体断言：`activateTargetTab === false`、`context.inheritWorkspaceContext === false`。

## 备注

- 原型（G3 产物）：`design/prototypes/overview-dashboard/overview-add-agent-card/`（v5，HTML + jsdom 冒烟 21 条）。
- 设计评审记录：2026-11-20 五轮反馈收敛（锚定弹层 → 居中 → New Agent 同款 chrome → 滚动路径列表 → 去冗余文案）。
- 分类：命中 `*.scss` → `redesign`（G1/G3/G4 人签 + G2/G5 机器）。

---

# v2 追加（2026-11-20 白天与用户收敛，当晚待开发）

用户四条新反馈（原话：「1. "+新建"改为"+" 2. 弹窗中应该需要用户输入内容，这个功能本身的意思是新建agent并发送内容，而不是只新增agent 3. 点击agent,展示对应的模型，支持切换」「弹窗还可以再大点 宽松一点」）。
v1 已交付的部分（入口/分组守卫/弹窗骨架/路径候选/建块链路）全部保留，v2 只做以下四项。

## V2-1 入口收敛为「＋」（仅看板）

- `overview-board.tsx` `AddAgentButton`（~L437）：去掉 `<span>{i18n.t("workspace:agentLaunch.newAction")}</span>`，只留 ＋ 图标；`aria-label`（`session-overview:board.addAgentAria`）与 hover `title`（`workspace:agentLaunch.newAction`）保留。
- 列表视图入口（`session-overview.tsx:2167` `session-overview-tab-add`「＋ 在此 Tab 新建 agent」）**保留文字**（用户未要求，列表里裸 + 不可读）。
- 同步改 `overview-board-add.test.tsx` 若有对入口文字的断言。

## V2-2 弹窗增加「发送内容」——语义改为新建并首发消息

- 弹窗顶部加多行输入（`session-overview-add-agent-message` textarea）：留空 = 纯建块（兼容 v1）；填了 = 建块后立即发送。
- 提交链路 `session-overview.tsx submitAddAgent`：`ObjectService.CreateBlockInTab`（已有，返回 blockId，`activateTargetTab=false` 不变）之后，消息非空时追加
  `RpcApi.AgentSendCommand(TabRpcClient, { blockid, text64: stringToBase64(text), submit: true })`。
  - 后端就绪等待（term 输出 quiet 轮询）、bracketed paste、回车提交全部由 `agentsend` 承担（11-18 包落地能力），**前端不写第二份等待逻辑**。
  - 失败语义与 11-18 对齐：建块成功但发送超时不回滚块；错误状态要在 UI 上报（弹窗内 status 或 toast，不做静默 console.warn）。
- 边界：`agentsend` 拒绝远端块（`agentsend.go` E_UNSUPPORTED）→ 选中远端路径行时禁用消息输入并显示提示（`AddAgentPathRow.isLocal===false` 判定已有）。
- `AddAgentSubmitRequest` 增加 `message: string | null`（trim 后非空才算）。

## V2-3 点选 agent → 展示模型 → 可切换

- 弹窗内点选 agent chip 后，chip 行下方出现该 agent 的模型选择器（`session-overview-add-agent-model`）。
- 数据源：`loadAgentCatalog()`（`frontend/app/workspace/agent-catalog.ts`，RPC `agentprofilelist`，60s 缓存；pi/codex/claude/opencode/gemini 有真实模型发现链）。**模式照搬 `scheduledtaskeditormodal.tsx`**：`modelOptionsFor` / `pickDefaultModel` / 切 agent 自动落回该 agent 默认模型。
- 选中值传 `createAgentBlockDefForProfile` 第 7 参 `modelOverride`（v1 恒 null，字段本来预留）。
- catalog 返回空模型列表时回退手填输入框（与 hero-launch-window 一致）。
- **确认过用户的意图是弹窗内切模型**，不是看板卡片点击换模型（后者要重启进程丢会话，另议）。

## V2-4 弹窗加大放宽

- `session-overview.scss`：`.session-overview-add-agent-modal` 宽度 `min(480px, …)` → `min(560px, calc(100vw - 48px))`；段间距 `& + &` 的 `margin-top/padding-top` 10px → 14px；路径列表 `max-height: min(280px,36vh)` → `min(320px,40vh)`；新增 message/model 控件样式同段内风格。

## v2 不做什么

- 不动 CommonText 前端发送链（existing 路径收口到 agentsend 的方案记录在 11-18-agent-block-send 的 PRD-ADDENDUM，那个包管）。
- 不做看板 agent 卡片点选换模型（V2-3 已确认排除）。
- 不改后端（`agentsend` RPC 现成可用，零 Go 改动）。

## v2 验收判据（机器可判定）

- [x] `npx vitest run frontend/app/session-overview/overview-add-agent.test.ts` → passed（新增 normalizeAddAgentMessage 3 用例）
- [x] `npx vitest run frontend/app/session-overview/overview-add-agent-modal.dom.test.tsx` → passed（13/13：三段结构；message 空 null / 非空 trim 下发；远端行 disabled + 提示；模型下拉默认项随 agent 切换回位；modelOverride 显式切换才有；发送失败内联报错 + footer 只留「关闭」+ 不重复建块）
- [x] `npx vitest run frontend/app/session-overview/overview-board-add.test.tsx` → passed（入口无可见文字断言本就未锁文字）
- [x] `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "overview-add-agent"` → `0`（2026-11-20 实测 0）
- [x] `npx eslint frontend/app/session-overview/overview-add-agent*.ts* frontend/app/session-overview/overview-board.tsx` → `0`（2026-11-20 实测 exit 0）
- [x] 整目录回归：`npx vitest run frontend/app/session-overview` → 17 files / 244 tests 全绿
- [ ] 真机（收尾）：`node scripts/verify/index.mjs` 跑 overview 相关 area；与并行包（11-20-overview-board-card-click-hotzones 同时在改 session-overview.tsx / overview-board.tsx）一起收尾跑，避免双实例

## v2 实现记录（2026-11-20 21:20）

- 落地文件：`overview-board.tsx`（V2-1）、`overview-add-agent-modal.tsx`（V2-2/3 重写）、`overview-add-agent.ts`（normalizeAddAgentMessage）、`session-overview.tsx`（submitAddAgent 建块后 `RpcApi.AgentSendCommand` 发送）、`session-overview.scss`（V2-4 + message/model/error 样式）、i18n en/zh（`session-overview:addAgent.*`）。
- 发送失败语义：`onSubmit` 回执 `AddAgentSubmitResult{ok, blockId, error}`；失败时弹窗不关、内联报错、footer 只留「关闭」，杜绝「重试又建一个块」。
- 模型下拉默认项 value=""（跟随 profile 配置，行为与 v1 一致）；显式选中才形成 modelOverride。catalog 空 → 手填输入框。
- 注意：`AgentSendCommand` 默认 WaitMs=30s，发送期间弹窗按钮保持 disabled（后端在等 TUI quiet）——可接受，后续如嫌慢可传 waitms 调低。
- 遗留：本包**未提交**——`session-overview.tsx` / `overview-board.tsx` 同时有并行包（hotzones）未提交的改动，等它收口后一起提交或分文件提交。

## v2 备注与代码锚点（当晚开发的现成地图）

- 弹窗组件：`frontend/app/session-overview/overview-add-agent-modal.tsx`（结构：profile chips → 路径列表两段；`modelOverride: null` 注释处即 V2-3 落点）。
- 纯函数层：`frontend/app/session-overview/overview-add-agent.ts`（`isRemoteConnection` / `AddAgentPathRow.isLocal` 已有，message 归一函数加这里保持可单测）。
- 提交处：`frontend/app/session-overview/session-overview.tsx` `submitAddAgent`（~L2732）。
- catalog 模式参考：`frontend/app/modals/scheduledtaskeditormodal.tsx` L69-75、161-186。
- RPC 客户端：`frontend/app/store/wshclientapi.ts` `AgentSendCommand`（L82，请求体 `AgentSendRequest`：blockid/text64/submit）。
- i18n：新 key 放 `session-overview` 命名空间（en/zh 各一份）：messageLabel / messagePlaceholder / messageRemoteBlocked / modelLabel（可复用 workspace:agentLaunch.modelLabel 则复用）。
