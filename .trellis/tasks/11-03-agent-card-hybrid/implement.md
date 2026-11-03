# 执行清单：Agent Card 合体版

> **落地结果（2026-11-03）**：Step 1–8 全部完成。目标测试 778 passed（aisessions / info-card / store / block / term），
> 触达文件 `tsc --noEmit` 无新增错误，eslint 无 error（`property-ai.tsx` 的 `sessionId` unused 为既有警告）。
> 实机（隔离 CDP 实例）注入同结构 DOM 实测：@340 宽 251px（1 行标题）/ 259px（2 行标题 + tags + 2 行 note），
> 与原型 251px 一致；与旧卡 296px 对比 -15%。
>
> 落地时的三处偏差（均已写入 `design/prototypes/agent-card-hybrid/README.md`）：
> 1. 头像块不用紫色渐变，改中性底 + 保留厂牌 logo 自带色；
> 2. hover 卡不渲染 AI 标题 / metadata 两个生成按钮（写操作留在详情卡/弹窗），因此 `.agent-card-title-tools` 未实现；
> 3. 折叠属性开关未实现（保持 4 行常显）。
>
> 前置：所有 Step 都在 `task.py start` 之后执行。每步结束跑验证命令，失败即停并按该步回滚点回退。
> 包管理：`node scripts/run-task.mjs <task>`；测试用 `npx vitest run <path>`。

## Step 0 — 基线（只读确认）

- [ ] 0.1 确认行号与 design 引用一致：
      `rg -n "agent-card-status-row|agent-card-session-id|agent-card-logo" frontend/app/view/term/agent-hover-card.tsx`
      `rg -n "SecondaryBuiltinKeys|CardPropertyLimit|renderRow" frontend/app/view/aisessions/property/property-list.tsx`
      `rg -n "variant|footerExtra" frontend/app/element/info-card/session-note-section.tsx`（当前应为空）
- [ ] 0.2 记录基线测试：
      `npx vitest run frontend/app/view/aisessions/property frontend/app/store/session-note-hook.test.tsx frontend/app/element/info-card`
- [ ] 0.3 记录基线卡高（可选，需运行 app）：hover 任一 agent block，卡片高度截图存档。

## Step 1 — hook：星标

- [ ] 1.1 `frontend/app/store/session-note-hook.ts`：`SessionNoteState` 增加 `starPending`、`toggleStarred`。
- [ ] 1.2 实现：`Mark(summary.key, next === true, "")` → 成功 `dispatchAISessionNoteUpdated(updated)`；
      失败 `setSaveStatus("error")` + `setError(message)`；ref 防重入。
- [ ] 1.3 `session-note-hook.test.tsx` 加 3 个用例（成功 / 失败 / pending 禁用）。
- 验证：`npx vitest run frontend/app/store/session-note-hook.test.tsx`
- 回滚：只还原 hook 与测试两个文件。

## Step 2 — PropertyList：agent 布局

- [ ] 2.1 增加 `layout?: "notion" | "agent"`（默认 `notion`）。
- [ ] 2.2 `entries` 派生：agent 布局过滤 `starred` / `title_source`，按 `updated→created→tags→note→custom` 排序。
- [ ] 2.3 `ValueDisplay` 支持 `emptyText`（agent 传 `—`，类名 `property-empty--dash`）；时间用 `formatSessionRelativeTime` + `title` 绝对值。
- [ ] 2.4 `renderRow` 加 `.property-row--agent`、`.property-row__icon`（builtin key → FA icon 映射；自定义 → `fa-hashtag`）。
- [ ] 2.5 footer：agent 布局渲染 `.property-footer`（左 inline `+ Add property`，右 `footer` 插槽）。
- [ ] 2.6 `AddPropertyForm` 支持 inline 触发样式（类名 `property-add--inline`）。
- 验证：`npx vitest run frontend/app/view/aisessions/property`
- 回滚：还原 `property-list.tsx` / `property-list.scss`。

## Step 3 — PropertyList 样式

- [ ] 3.1 `property-list.scss` 追加 `.property-list--agent` 一组规则（见 design §3.3），不改既有 notion 规则。
- [ ] 3.2 检查浅色主题：`--secondary-text-color` 在 `—` 上是否过淡（必要时用 `color-mix(… 80%)`）。
- 验证：`npx vitest run frontend/app/view/aisessions/property` + 目测两套主题。

## Step 4 — SessionNoteSection：variant / footerExtra

- [ ] 4.1 增 `variant?: "detail" | "hover"`（默认 detail）、`footerExtra?: ReactNode`。
- [ ] 4.2 hover 分支渲染 `.agent-card-title-block`（2 行 clamp、`title` 全文、保留 `TitleSourceBadge`）。
- [ ] 4.3 hover 分支不再渲染自身放大按钮；`GenActionButton × 2` 收进 `.agent-card-title-tools`。
- [ ] 4.4 属性区：`<PropertyList layout={variant === "hover" ? "agent" : "notion"} … footer={<>{AI compact}{footerExtra}</>} />`。
- [ ] 4.5 `AIPropertiesButton` 增 `compact?: boolean`（仅图标 + `title`/`aria-label`），默认 false 保持详情卡文案。
- 验证：`npx vitest run frontend/app/view/aisessions frontend/app/element/info-card`
- 回滚：还原 `session-note-section.tsx` / `property-ai.tsx`。

## Step 5 — AgentHoverCard：头部与 footer

- [ ] 5.1 替换 `showMetaRow` 分支为「头像 + id + actions」，删除 `.agent-card-status-row`。
- [ ] 5.2 `agent-card-avatar` 三态：logo svg（16px、保留原色）/ emoji / 未来 badge；`title="设置 emoji 人格"` + 点击 picker 逻辑保留。
- [ ] 5.3 状态 chip 复用 `statusPres` / `statusAccent`；`title` 挂 `statusPres.description ?? label`。
- [ ] 5.4 星标按钮：`noteState.summary?.marked`、`toggleStarred`、`aria-pressed`、pending disabled。
- [ ] 5.5 放大按钮保留（`embedded` 时不渲染），尺寸改 20px 图标按钮类。
- [ ] 5.6 副标题：`model`（空 → `未指定`）+ `·` + `humanizeKey(titleSource)`。
- [ ] 5.7 删除 `.agent-card-session-id` 整行；把 sid（8+4）+ `CopyButton` 作为 `footerExtra` 传给 `SessionNoteSection`；保留 `copyFailed` 逻辑。
- 验证：`npx vitest run frontend/app/view/term frontend/app/element/info-card` + `npx tsc --noEmit`
- 回滚：还原 `agent-hover-card.tsx`。

## Step 6 — SCSS：agent-card 主块重写

- [ ] 6.1 删除 `.info-card.agent-card::before` 与 `border-radius: 0 6px 6px 0 / padding-left: 15px`，改 `width: 340px` + `padding: 11px 12px 0` + `border-radius: 9px`。
- [ ] 6.2 新增 `.agent-card-avatar / -id / -name / -sub / -actions / -status-chip / -icon-btn / -title-block / -title-tools / -sid`。
- [ ] 6.3 `.agent-card-expand-btn` 保留类名（复用 hover 显示），尺寸与 `.agent-card-icon-btn` 对齐。
- [ ] 6.4 删除 `.agent-card-status-row` / `.agent-card-status-dot` / `.agent-card-session-id*` / `.agent-card-logo` 死样式（先 `rg` 确认无其它引用）。
- [ ] 6.5 检查 `--frameless` / `--embedded` 覆盖是否仍成立（无色条后无需再覆盖 `::before`）。
- 验证：`rg -n "agent-card-status-row|agent-card-session-id|agent-card-logo" frontend/app` 应为空；
      `npx tsc --noEmit`；`npx vitest run frontend/app/element/info-card`
- 回滚：还原 `info-card.scss`。

## Step 7 — 真机视觉验收

- [ ] 7.1 启动 app（`npm run start` 或已有 dev 实例），带 CDP：`--remote-debugging-port=9222`。
- [ ] 7.2 `node scripts/inspect-electron-ui.mjs state` 找到 agent block。
- [ ] 7.3 校验项：头部三件套同行；副标题 `未指定 · First User Message`；标题 2 行；属性 4 行 + `—`；
      footer 单行；浅色/深色各看一次；`320 / 340 / 380` 三档宽度（改窗口或 DevTools 覆写 `width`）。
- [ ] 7.4 记录卡片实际高度（DevTools `$0.offsetHeight`），与原型 251px 对比，差异 > 15px 要写进设计文档。
- [ ] 7.5 弹窗形态（点放大）确认 520–640 宽下布局不塌、无重复卡片边框。

## Step 8 — 文档与索引同步

- [ ] 8.1 `design/prototypes/agent-card-hybrid/README.md` 状态标记 `▲ → ◐ 部分落地（已写入组件）`。
- [ ] 8.2 `design/prototypes/agent-card-accent/README.md` 标注「左侧色条被 11-03-agent-card-hybrid 取代」。
- [ ] 8.3 新增 `docs/project/agent-card-layout.md`（落地后事实：最终类名、尺寸、行为、测试位置）。
- [ ] 8.4 `design/prototypes/__REVIEW_GUIDE__.md` 更新两处状态。
- [ ] 8.5 `node docs/sync-audit/audit-sync.mjs` 无「镜像缺失」新增告警。

## Step 9 — 收尾

- [ ] 9.1 `detect_changes()` / 人工 diff review：确认只影响 agent card 相关符号。
- [ ] 9.2 提交：`fix(agent-card): 重排 hover 卡信息层级（C 行骨架 + 头像 + 右上三件套）`
      body 写明：移除左侧状态条、starred/title_source 移出属性区、footer 单行、卡高 296→25x。
- [ ] 9.3 `task.py finish` → `task.py archive 11-03-agent-card-hybrid`。

## 失败回滚点汇总

| Step | 回滚动作 |
| --- | --- |
| 1 | 还原 `session-note-hook.ts` + 测试 |
| 2–3 | 还原 `property-list.tsx` / `.scss` |
| 4 | 还原 `session-note-section.tsx` / `property-ai.tsx` |
| 5 | 还原 `agent-hover-card.tsx` |
| 6 | 还原 `info-card.scss` |

全部回滚（一次性）：
`git checkout -- frontend/app/view/term/agent-hover-card.tsx frontend/app/element/info-card/info-card.scss frontend/app/element/info-card/session-note-section.tsx frontend/app/view/aisessions/property/property-list.tsx frontend/app/view/aisessions/property/property-list.scss frontend/app/view/aisessions/property/property-ai.tsx frontend/app/store/session-note-hook.ts`
