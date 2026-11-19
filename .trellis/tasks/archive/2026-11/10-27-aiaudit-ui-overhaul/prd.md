# PRD: AI Audit 界面整改（布局 / 信息架构 / 详情抽屉 / 数据正确性）

## 背景（已核查的事实）

1. AI Audit 是 `view: "aiaudit"` 的 ephemeral block，入口在 AISessions 头栏
   `fa-clipboard-list`（`frontend/app/view/aisessions/aisessions.tsx:237`），
   以视口 80% 的浮层打开（`frontend/layout/lib/layoutModel.ts:2064-2074`）。
2. 视图根节点 `frontend/app/view/aiaudit/aiaudit-view.tsx:165` 为
   `flex h-full min-h-0 flex-col bg-block-solid p-3`，**缺少 `w-full`**。
   `.block-content` 是 `display:flex; width:100%`（`frontend/app/block/block.scss:130`），
   子节点在 flex 行里按 max-content 收缩，因此表格只占内容自然宽（≈660px），
   右侧 40%+ 视口宽度完全空置。同项目其它视图（`aisessions.tsx:2019`、`vcs.tsx:589`）
   均为 `h-full w-full`。
3. `aiaudit-view.tsx:279` 残留空的 `<i className="fa-sharp fa-solid mr-1" />`，不渲染任何内容。
4. 状态筛选下拉（`aiaudit-view.tsx:112-127`）只有 `done / failed / cancelled`，
   而后端状态域为 5 个：`queued / running / done / failed / cancelled`
   （`pkg/aisessions/audit_store.go:32-36`）。**queued 无法筛选**，而真实数据里 queued 占多数。
5. `AuditBegin` 只在任务真正开始执行时写入（`titleautogen.go:420`、`annotation_assist_jobs.go:148`），
   完成才由 `AuditFinish` 更新；进程崩溃 / 回调丢失会留下**永久 queued 行**，
   后端没有任何补偿逻辑（`pkg/aisessions` 无 orphan sweep）。截图中 10-26 的 12 条 queued 即此类。
   `AuditStateRunning` 常量存在但从未被写入。
6. `aiaudit-model.ts:64` 中 `refresh=false` 时 `AuditStats()` 被短路为 `Promise.resolve(null)`，
   而 4s 轮询与事件触发都传 `refresh=false` → **顶部统计永远停在首次加载的值**。
7. 搜索：`audit_store.go:352-357` 用 `LIKE '%'+lower(query)+'%'`，但列未 lower，
   SQLite LIKE 对 ASCII 已忽略大小写，lower 只作用于 pattern → 输入含大写的 pattern 反而搜不到。
8. 统计口径：`audit_store.go:394-406` 的 `AVG(duration_ms)` 把 queued/failed 的 0ms 计入，
   头部 `avg` 被系统性低估。
9. 详情弹窗（`aiaudit-view.tsx:243-320`）只渲染 `rawRequest / rawResponse` 文本，
   完全未使用 `rawTruncated`（`AuditView.rawTruncated`，`frontend/types/gotypes.d.ts:664`），
   也没有 model / connection / trigger / anchors 等结构化字段；ESC 与点遮罩都不关闭
   （`onClick` 内 `stopPropagation`）。
10. 列表行用 `<tr onClick>` 打开详情，无 `tabIndex` / `role` / 键盘处理；`Clear 30d`
    是普通灰按钮，点击立即删除且丢弃后端返回的删除条数（`aiaudit-model.ts:93-96`）。
11. RPC 已支持分页：`AISessionsAuditListRequest.Offset`（`aisessionsservice.go:1514`），
    但前端固定 `limit:100` 且无「加载更多」。
12. 列表行数据已包含 `aiModel / connection / trigger / anchorTotal / anchorKept / resultCount`，
    但表格只展示 4 个字段，且 `Feature` / `Source` / `Session` 三列语义高度重复。

## 目标

1. **铺满**：AI Audit 浮层在任意宽度下内容占满可用宽度，无右侧空白。
2. **一眼可读**：失败行、卡住的 queued 行、正常行在 200ms 内可区分；每列含义自解释。
3. **可操作**：状态可筛（含 queued）、可翻页、失败可重试、危险操作有确认与结果反馈、行可键盘操作。
4. **详情有结构**：Drawer 展示 Summary / Request / Response，明确标注 payload 是否截断。
5. **数据不再说谎**：统计随列表刷新、avg 口径正确、永久 queued 行被回收为失败并可见。
6. **视觉与全站一致**：仅使用 `--color-*` token（`frontend/tailwindsetup.css:9-47`），
   字号收敛到 10/11/12/13px 档，间距 8/12px 网格。

## 非目标

- 不改审计的写入时机、不新增审计字段以外的业务埋点。
- 不做跨会话聚合报表 / 导出 / 图表库引入（迷你柱状图用纯 div 实现）。
- 不改 ephemeral block 的浮层尺寸策略（不追求「全屏」）。
- 不重做 AISessions 主列表样式。
- 不引入新的 UI 组件库或 modal 框架。

## 约束

- 只能改 `frontend/app/view/aiaudit/`、`pkg/aisessions/audit_store.go`（及必要类型）、
  生成文件通过 `node scripts/run-task.mjs generate` 重生成，禁止手改生成产物。
- 轮询不得在 `document.hidden` 时打 DB；可见时应 ≤ 1 req/4s。
- 后端 `go test ./pkg/aisessions/` 必须全绿；前端 `vitest` 相关用例必须全绿。
- 所有新增文案为英文（与现有 UI 一致）。
- 破坏性操作（Clear）必须二次确认，且确认后回报删除条数。

## 验收标准

1. 打开 AI Audit，`document.querySelector('.aiaudit-root').getBoundingClientRect().width`
   等于 block 内容区宽度（误差 ≤ 2px），表格表头横线延伸到右边界。
2. 状态下拉包含 queued / running / done / failed / cancelled 五项；选 queued 时列表只剩 queued。
3. 存在 queued 且 `now - createdAt > 30min` 的行显示琥珀色 `stuck` 标记，
   且后端在下次列表请求时已把该行改写为 `failed`（error 含 `orphaned`）。
4. 顶部统计中的 failed 数量可点击 → 等价于选择 failed 筛选；列表刷新后统计同步变化。
5. 失败行有区分度（左侧 2px error 色条 + 淡红底），`Retry` 仍可用且不影响行点击。
6. 底部有 `Load more`：`total > entries.length` 时可见，点击后追加下一页（offset 递增）。
7. 详情 Drawer：ESC 关闭、点遮罩关闭；`rawTruncated` 为真时显示截断警告；
   Summary 页展示 feature/scope/model/connection/trigger/结果/anchors/耗时/时间。
8. 行可 Tab 聚焦，Enter/Space 打开详情。
9. `Clear 30d` 需二次确认，完成后显示 `Cleared N entries`。
10. `node scripts/run-task.mjs generate` 后 `git diff frontend/types/gotypes.d.ts` 仅含
    `AuditStatsResult` 新增的 hourly 字段；`go test ./pkg/aisessions/` 与新增前端单测全绿。
