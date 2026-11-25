> **Confirmed: 2026-11-25 @nita**

# CommonText 发送 Agent 模型与路径选择

## Goal

让 CommonText 的发送目标浮层具备与 Overview New Agent 一致的模型选择与路径选择体验，同时保留现有聚焦块 / 新建、Tab、后台执行与发送语义。

## Background

用户已审阅并批准原型 `design/prototypes/commontext/commontext-send-agent-unify/`，明确核心缺口是“模型选择”和“New Agent 那种路径选择”，不是只做视觉换皮。

当前实现事实：

- `frontend/app/commontext/commontext-send-button.tsx` 的 `SendTargetPanel` 只有纯 logo Agent 行、Tab picker、目录下拉与后台执行开关。
- `CommontextSendConfig` 尚无模型字段；`previewSendTarget` 只按 Agent / Tab / Folder 判定 existing 或 create。
- `frontend/app/workspace/agent-launch.ts:971-980` 的 `createAgentBlockDefForProfile` 已支持第 7 个 `modelOverride` 参数，无需改后端或建块底层。
- `frontend/app/workspace/agent-catalog.ts` 已提供 `loadAgentCatalog` / `findAgentProfile` / `modelOptionsFor` / `pickDefaultModel`，Overview New Agent 与定时任务共用同一数据源。
- `commontext-send-target.ts` 已提供按所选 Tab 收集、去重、排序路径候选的 `collectFolderCandidatesForTab`，路径数据源无需重写。
- 现有真机验证台 `scripts/verify/commontext-send-agent-block/verify.mjs` 仍断言旧目标卡、目录下拉与 ≤320px 高度，需要随新信息架构更新。

## Requirements

### R1 · Agent 与模型选择

- Agent 使用命名 chip，保留默认项提示与选中态。
- Agent 下方展示模型选择器：目录有模型时使用下拉，首项为“自动（可能按项目偏好）”；目录不可用时允许手填模型。
- 模型候选来自 `loadAgentCatalog`，与 New Agent 同源。
- 切换 Agent 时清空模型选择，避免把不同 profile 的模型 ID 带到新 Agent。

### R2 · 模型只影响新建块

- 选择具体模型后，本次发送必须判定为新建，不能注入已存在的聚焦块。
- 新建块时把模型作为 `modelOverride` 传给 `createAgentBlockDefForProfile`。
- “自动”不传 override，继续沿用 profile / vendor 默认模型。
- 已存在聚焦块的运行模型不可被本次发送改写。

### R3 · 可见路径列表

- 目录不再只是下拉触发器，而是直接展示可滚动路径候选列表。
- 列表复用 `collectSendFolderCandidates(config)`，候选顺序、去重与 Tab 联动保持不变。
- 未显式选择时默认选中该 Tab 的第一条推荐路径，并显示“跟随 Tab / 默认”。
- 点击任意路径即显式选择并切换到新建；切 Tab 后重置为推荐路径。
- 保留“浏览其他目录…”入口。

### R4 · 保留现有发送行为

- 保留聚焦块 / 新建两种模式、Tab 选择、新建 Tab、后台执行开关和动态发送按钮。
- 保留本地 existing 走后端 `AgentSendCommand`、远端 existing 走前端 paste、create 建块后后台发送的既有链路。
- 浮层 header / 内容 / footer 固定，长路径列表内部滚动，不整体撑高页面。

### R5 · 主题与文案

- 新控件使用现有语义 token，支持深色、浅色、单色主题。
- 中英文案齐备，`check-parity` 不新增缺失。
- 所有自定义可点控件有可见名字、键盘焦点与选中语义。

### R6 · 回归器具

- 更新单元测试与 DOM 测试，覆盖模型强制新建、模型透传、Agent 切换重置、路径列表与 Tab 联动。
- 更新 `commontext-send-agent-block` 真机验证台，覆盖模型与路径真实交互、布局和新面板高度。

## Acceptance Criteria

- [ ] AC1：`previewSendTarget` 在 `config.model` 非空时返回 `kind=create`，即使 Agent / Tab / Folder 与聚焦块全等。
- [ ] AC2：create 路径调用 `createAgentBlockDefForProfile` 时把模型作为第 7 个参数传入；`model=null` 时传 `undefined`，行为与现状一致。
- [ ] AC3：DOM 中同时存在命名 Agent chip、模型选择器、Tab 行、可见路径列表与后台执行开关。
- [ ] AC4：切换 Agent 后模型回到“自动”；选择具体模型后模式变为新建，主按钮为“新建并发送”。
- [ ] AC5：点击路径行后 footer 落点摘要更新；切 Tab 后路径候选整体更新并回到默认推荐行。
- [ ] AC6：真机验证台在深色主题完成模型选择、路径选择、Tab 联动与发送按钮状态断言，退出码为 0。
- [ ] AC7：`node scripts/i18n/check-parity.mjs` 通过，无新增中英文 key 缺失。
- [ ] AC8：窄视口无横向溢出，header / footer 不被长路径列表顶走。

## Out of Scope

- Vendor 选择、供应商模型固定、定时发送、搜索 / 历史。
- 修改已存在 Agent 会话的运行模型或恢复参数。
- 重写 `resolveSendTarget`、后端 RPC、调度器或 pending-input 链路。
- 修改 Overview New Agent 自身行为。

## Risks and Deferred Items

- GitNexus 索引当前 stale 且 FTS 缺失；实现前必须重跑分析并补齐 `previewSendTarget`、`SendTargetPanel`、`CommontextSendButton` 的 upstream impact。若索引仍不可用，先修复索引再改符号。
- 模型目录 RPC 失败时必须有手填回落，不能阻塞发送。
- 真机验证台旧高度 ≤320px 与目录下拉断言会因新信息架构失效，必须同批更新，不能通过删除断言“修绿”。

## G1 签字

待用户在最终规划摘要后明确批准。
