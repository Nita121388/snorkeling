# 夜间自主执行任务清单 — AISessions / 文件预览 / 交互性能

> 状态：● 待执行（用户已列出需求，尚未逐条确认方案）
> 用途：交给夜间 Agent 自主排序、实现、验证。
> 生成时间：2026-09（由 pi 整理）

## 使用说明（给执行 Agent）

1. **先读** `AGENTS.md`、`CLAUDE.md`、`.kilocode/rules/rules.md`，遵守现有工程约束。
2. 每改一个符号前先跑 GitNexus `impact({target, direction:"upstream"})`；HIGH/CRITICAL 必须先在此文件"风险"处记录再动手。
3. 提交前跑 `detect_changes()`。
4. 任务分 `P0 / P1 / P2`，**独立可并行**的按"批次"分组；同批内不要两人改同一文件。
5. 每个任务完成必须写：改了什么文件、验证命令与结果、剩余风险、是否需要在 UI 里手动确认。
6. 拿不准的产品决策 → **不要猜**，在本文末尾"待用户确认"追加条目并跳过该任务，继续做其它任务。
7. 工具链：`npm run setup` → `node scripts/run-task.mjs <task>`；Go 测试用 `powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go test ./pkg/...`。
8. UI 验证走 CDP：`node scripts/inspect-electron-ui.mjs state|elements|style|click|screenshot`（应用需 `--remote-debugging-port=9222`）。

---

## 批次总览

| 批次 | 主题 | 任务 | 可否并行 |
|---|---|---|---|
| A | AISessions 详情 | T1 Load all、T6 性能/超时 | 否（同文件） |
| B | AISessions 交互 | T4 刷新按钮重叠、T8 列表/详情分离 | 与 A 冲突（同文件）→ 串行 |
| C | 通用输入 | T5 CommonText 粘贴图片 | 可并行 |
| D | 文件预览 | T9 txt 预览、T10 html 三模式 | 可并行（preview 目录） |
| E | 执行记录 | T2 脚本执行删除/撤回 | 需先澄清范围 |
| F | 悬停性能 | T11 Widget 悬停弹窗延迟、T12 Tab 组 + 号二级弹窗延迟 | 可并行（不同文件） |

> A/B 都改 `frontend/app/view/aisessions/*`，必须串行：建议顺序 T1 → T6 → T4 → T8。

---

## T1 · [P1] Session Detail 的 "Load more" 增加 "Load all"

**现状（已核实）**
- 前端分页是**纯前端切片**：`frontend/app/view/aisessions/session-detail.tsx`
  - `visibleMessageCount` 初始 `defaultVisibleMessageCount = 30`，步长 `visibleMessageCountStep = 30`（`types.ts`）
  - `readableMessages.slice(-visibleMessageCount)` 只渲染尾部 N 条
  - 按钮文案 `Load more` → `loadPreviousMessages()` 一次 +30
- 后端 `Detail` 已**一次性返回整段 messages**（`pkg/aisessions/manager.go` `Manager.Load`，`LoadOptions.IncludeTools` 时才额外解析 toolCalls）。所以"Load all"不增加任何后端请求。

**方案**
1. 在 `Load more` 旁加 `Load all` 按钮（仅 `hasPreviousMessages` 时显示）。
2. `Load all` = `setVisibleMessageCount(readableMessages.length)`，一次到位。
3. 保留 `Load more` 作为渐进路径；`Load all` 后按钮组整体隐藏。
4. **性能护栏**：若 `readableMessages.length > 300`（阈值可调，常量放 `types.ts`），`Load all` 走 `startTransition` 包裹，并在按钮上显示 `Loading N messages…` 短暂状态，避免一次同步渲染卡死。
5. 可选（P2）：记住用户偏好到 `localStorage`（`aisessions.loadAllByDefault`），下次自动全量。默认 **关闭**，避免误伤长会话。

**性能判断（用户问的"会不会很影响性能"）**
- 数据量：messages 已在内存；成本在 React 渲染 `MessageCard` × N。30 → 全量时，1000 条会话会明显掉帧。
- 结论：**保留分页为默认**，`Load all` 作为显式操作 + 大列表走 transition 即可；不建议把默认值改成无限。

**验收**
- 短会话（<30 条）不出现按钮。
- 点击 `Load all` 后首条消息可见，滚动位置不跳到顶部（保持底部锚定）。
- 500+ 条会话点击后无白屏 > 1s（可用 Performance 面板粗测）。

---

## T2 · [P1] 报错的脚本/工具执行：支持删除 + 支持撤回

> ⚠️ **范围需澄清**（见"待用户确认 U1"）。下面给两种解读，执行 Agent 先按 A 实现，B 保留待确认。

**解读 A（推荐先做）：Scheduled Tasks 的运行历史**
- 现状：`pkg/scheduler/store.go` `RunStore` 是**内存 map**，无删除接口；前端 `frontend/app/view/scheduledtasks/scheduledtasks-view.tsx` 的 History 弹窗只读列表。
- 方案：
  1. `RunStore` 增加 `DeleteRun(taskId, index)` / `ClearRuns(taskId)`，`pkg/wshrpc/wshrpctypes.go` 加 `ScheduledTaskRunDeleteCommand`，`wshserver/scheduledtask.go` 实现。
  2. 前端 History 弹窗每行加删除按钮 + 顶部 `Clear all`，删除后本地 atom 同步移除（不重新拉全量）。
  3. "撤回"：`RunStore` 里已删除的记录在内存保留一份 `lastDeleted`（带 taskId），提供 `UndoDelete`（单条、3 秒内有效，Toast 提示）。**不落盘**，因为历史本来就不持久化。

**解读 B：AI 会话里的工具调用（tool call）失败项**
- 现状：toolCalls 来自 provider 解析，属会话文件内容，**不是独立实体**，删除会破坏会话一致性。
- 若要支持，只能做"UI 折叠/隐藏"（本地 meta 存 hidden seq 列表），不能物理删除。这是产品决策，等确认。

**验收（A）**
- History 弹窗删除单条 → 列表消失，重新打开弹窗仍不在。
- Clear all 清空该 task 全部历史。
- 撤回 3 秒内可恢复；超时 Toast 消失且不可恢复。

---

## T3 · [P2] （占位）方案确认项汇总

见文末"待用户确认"。执行 Agent 不要在此项下写代码。

---

## T4 · [P1] AISessions 右上角：自动刷新按钮与关闭按钮重叠

**现状（已核实）**
- `frontend/app/view/aisessions/aisessions.tsx` 的 `endIconButtons` 里，刷新按钮 `zone: "pinned"`；`blockframe-header.tsx` 的 Close 按钮也是 `zone: "pinned"`。
- `block.scss` 里已有一段"补丁"注释：`.block-frame-end-icons .wave-iconbutton.aisessions-auto-refresh { width:auto; min-width:24px; flex-shrink:0; margin-right:2px; }`——说明之前修过一次，但 `RefreshStatusIcon` 的 "Auto" 徽标宽度仍是动态的，徽标文案/倒计时变长时仍会挤压。
- 根因：pinned 区固定 `width: 24px` 的通用规则 + 徽标内容宽度不可控，靠 `width:auto` 打补丁不稳。

**方案**
1. 布局层面：给 pinned 区加 `gap: 2px`（或 `column-gap`），并给 `.end-icon-pinned` 明确 `flex: 0 0 auto`，禁止压缩。
2. 刷新按钮本身：把 "Auto" 徽标改为**独立元素**，设置 `max-width` + `overflow:hidden` + `text-overflow:ellipsis`，或改为纯图标 + tooltip 显示倒计时（推荐后者，最稳）。
3. 保留 24px 图标位，徽标绝对定位在图标右下角（`position:absolute; right:-2px; bottom:-2px; font-size:9px`），**不参与布局宽度**，从根上消除重叠。
4. 用 CDP 取 `getBoundingClientRect()` 验证两按钮矩形不相交。

**附带产品问题（用户问的"为什么要显示 auto 刷新，价值在哪里"）**
- 现状价值：会话列表来自本地文件扫描 + SQLite 索引，**外部 agent 进程（pi/codex/claude）在后台写会话时，列表不会自己更新**。自动刷新就是为这个场景。
- 建议改进（P2，可后置）：
  - 默认间隔从 60s 保持；但把"Auto"文案换成**只在鼠标悬浮时出现的 tooltip**（"Auto-refresh every 60s"）。
  - 在"后台无外部会话活动"时降低刷新频率（可结合 `use-sessions-running.ts` 的 running 状态：有 running 会话时 15s，否则 60s）。
  - 提供一键"关闭自动刷新"，并记住到 block meta（已有 `aisessions:autorefreshintervalms`，直接用 0 即可，只需在 UI 暴露）。

**验收**
- 任意窗口宽度（窄到 320px）下刷新按钮与 X 不重叠、不互相遮挡点击。
- 悬浮刷新按钮能看清倒计时/上次刷新时间。

---

## T5 · [P1] CommonText 支持粘贴图片

**现状（已核实）**
- `frontend/app/commontext/commontext-compose-modal.tsx` 主体是原生 `<textarea>`（详情 body + 顶部 editor），`commontext-model.ts` 的数据模型是纯文本（title/text/tags）。
- 目前**没有** `onPaste` 处理，粘贴图片会得到空内容。

**方案（分两步，第一步先交付）**
1. **MVP：粘贴即存为附件 + 插入 Markdown 图片语法**
   - 在 textarea 上监听 `onPaste`：`event.clipboardData.items` 中筛 `type.startsWith("image/")`。
   - 转 base64 或 Blob → 通过新增 RPC `commontext.SaveImage` 存到 `%LOCALAPPDATA%/snorkeling/commontext/images/<uuid>.<ext>`（与现有 commontext 存储同目录，复用 `pkg/service/commontextservice`）。
   - 在光标处插入 `![](file:///...)`（本地绝对路径）或自定义 `![[commontext:<id>]]`。**推荐前者**，无需新渲染器。
   - 若无图片（纯文本粘贴），保持默认行为，不要 `preventDefault`。
2. **渲染**：CommonText 预览/列表里已有 markdown 渲染就走 markdown 图片；没有则 P2 再加。
3. **P2**：把 textarea 换成 contenteditable/BlockEditor 以获得内联图片预览（成本高，先不做）。

**风险**
- base64 直接塞进 text 字段会让条目体积暴涨（不建议）；必须落盘 + 引用路径。
- 远程连接场景：图片存本地，插入的 `file://` 路径在远端不可用。若当前 block 是远程连接，降级为"提示不支持"。

**验收**
- 截图后 Ctrl+V 到 CommonText 编辑器 → 生成图片文件 + 文本里出现图片引用 + 复制到终端时引用仍是文本。
- 粘贴纯文本行为不变。

---

## T6 · [P0] AI 会话接口频繁超时（Detail / Note / Tag）

**现状（已核实）**
- HTTP 层硬超时：`pkg/web/web.go`
  - `HttpWriteTimeout = 21s`、`HttpTimeoutDuration = 21s`，`/wave/` 路由包在 `http.TimeoutHandler` 里 → **超过 21s 直接返回 "Timeout"**。
- `Detail` 慢的根因链：
  1. `Manager.Load` → `resolveSession`：sqlite 未命中时走 **`ScanSummaries` 全量扫描所有 provider 的所有会话文件**（`pkg/aisessions/manager.go:955`）。
  2. `loadMessages`：sqlite 未命中 → 解析整份 JSONL（大文件 10MB+ 很常见）。
  3. `IncludeTools: true` 时**再解析一遍整份文件**取 toolCalls（`toolProvider.LoadToolCalls`）——等于同一文件读两遍。
  4. 前端 `loadDetail` 传 `refresh` 时强制绕过 sqlite 缓存（`loadMessages` 里 `!refresh` 才走缓存）。
- `Note`/`NoteAndTags` 慢的根因：`managerForIdentifier` 每次 `NewManager`（每次重新打开 meta/sqlite），且 `Note` 内部要 `resolveSession`（同样可能触发全量扫描）。

**方案（按性价比排序）**
1. **P0-a 合并一次读盘**：`Manager.Load` 里 messages 与 toolCalls 共用一次文件读取/一次 provider 解析（provider 接口加 `LoadMessagesAndTools`，或在 manager 层缓存 raw bytes）。预计 Detail 降 30–50%。
2. **P0-b 前端不要默认 refresh**：`loadDetail(session, refresh=false)` 在"用户点选列表项"时传 false；只有显式刷新/详情过期才 true。检查 `aisessions.tsx` 与 `session-detail.tsx` 里所有 `loadDetail(..., true)` 调用点，逐个确认是否必要。
3. **P0-c 超时可配置**：把 `HttpTimeoutDuration` 从常量改为可被 `settings.json` 覆盖（如 `web:servicetimeoutms`），默认仍 21s 但允许 60s。注意：`TimeoutHandler` 只影响 `/wave/`，改动面小。
4. **P1-a Note/Tag 走轻路径**：`Note`/`NoteAndTags` 不需要完整 summary；新增 `Manager.SetNoteByKey(key)` 直接用 `key` 定位 meta/sqlite 行，**跳过 `resolveSession`**（key 本身已含 source+id）。这是最大的一处收益，且改动局部。
5. **P1-b 前端写 Note/Tag 加乐观更新 + 去抖**：已有 `session-note-autosave.ts`（`NoteAutoSaveDelayMs`），确认走的是 debounce 而非每次击键；同时 UI 先本地更新，失败再回滚（当前 `agent.tsx:469` 是等 RPC 返回才更新）。
6. **P1-c 索引预热**：`ScanSummaries` 在 app 启动/首次进入 AISessions 时后台预热一次，避免用户第一次点会话触发全量扫描。
7. **P2**：`Detail` 支持 `includeTools=false` 先返回消息，toolCalls 异步补齐（前端已有 `loadDetailTools` / `refreshToolCallsOnly` 的基础设施，改动较小）。

**必须避免**
- 不要把 `TimeoutHandler` 直接删掉（会导致挂死的请求永久占用连接）。
- 不要在前端加"无限重试"掩盖超时。

**验收**
- 冷启动后首次点开一个 10MB 会话，Detail 在 5s 内返回（改前可复现 21s Timeout）。
- Note 保存 < 300ms 返回。
- 记录改前/改后耗时（Go 侧已有 `debugf("Manager.Load success ... duration=")`，直接采集）。

---

## T7 · [P2] （占位）文档与回归汇总

夜间结束时统一产出：`docs/project/` 下的事实记录 + 本文件勾选状态。

---

## T8 · [P1] AISessions：列表与详情分离（多 Block / Tab 化 / Ctrl+点击新开）

**现状（已核实）**
- 已有基础设施：`frontend/app/view/aisessions/session-detail-block.ts` 的 `openAISessionDetailBlock(sessionId, sourceBlockId, connection, cwd)`，会创建 `view: "aisessions"` + `aisessions:sessionid` + `aisessions:sessionlistcollapsed: true` 的 block，优先从 source block 水平 split。
- 但**入口只有一个**（详情头部/列表的某个按钮），且没有"再点一次变 Tab 化"的语义。
- 全局 block 创建：`frontend/app/store/global.ts` 的 `createBlock(blockDef, magnified, ephemeral)`、`createBlockSplitHorizontally`。
- Tab 组化已有能力：`layoutModel.inlineMinimizeBlock(blockId)` / `restoreInlineTabBlock`（见 `blockframe-header.tsx` 的 `inline-tab-minimize`）。

**方案（对齐用户描述的三段行为）**

1. **列表 → 详情打开策略（新增统一入口函数）**
   ```
   openSessionDetail(sessionId, { modifier })
   - 普通点击：若当前 tab 里没有该 session 的 detail block → 在当前 tab 新建 block（split 到右侧）；
                若已有 → 聚焦它（不重复创建）。
   - 再次点击（同一 session）：若 block 已存在且是独立 block → 调 inlineMinimizeBlock 转成 Tab 组（"再次点击默认为 Tab 化"）。
   - Ctrl/Cmd + 点击：强制 createBlock 到新 block（不做 Tab 化、不 split 复用），即"单开一个 Block"。
   ```
2. **block meta 约定**（复用现有 key，不新增）：
   - `view: "aisessions"`、`aisessions:sessionid: <id>`、`aisessions:sessionlistcollapsed: true`
   - 新增 `aisessions:detached: true` 标记"纯详情 block"，`AiSessionsViewModel` 读到后**跳过列表加载**（现在只是把列表折叠，仍在跑 `loadSessions`/`loadTags`/自动刷新，是性能浪费）。
3. **ViewModel 改造**
   - `aisessions.tsx` 里 `loadSessions` 在 `detached` 模式下直接 return，只保留 `loadDetailById`。
   - 自动刷新在 detached 模式只刷 detail delta，不刷列表。
4. **交互细节**
   - 列表行 hover 显示"在右侧打开"图标按钮（明确可发现性），Ctrl+点击时 tooltip 提示"Open in new block"。
   - 详情 block 头部保留 `onExpandSessionList`（已有），点击可恢复成"列表+详情"合体视图。

**风险**
- `inlineMinimizeBlock` 对"已经是 inline tab group"的情况有前置条件（`canInlineMinimizeBlock`），需要先判断再调用，否则无反应。
- 同一 session 可能同时存在"合体 block"和"独立 detail block"，选中态/高亮需要按 `sessionid` 匹配而非 `selectedKeyAtom` 全局单例。这是本次改动**最容易引入状态串味**的地方，建议把 `selectedKeyAtom` 从 ViewModel 单例降级为"当前 block 自己的选中项"。

**验收**
- 列表点击 → 右侧出现详情 block；再点同一会话 → 变成 Tab 组而不是新增第二个 block。
- Ctrl+点击 → 必定新增独立 block（即使已存在）。
- 两个独立详情 block 同时打开，各自滚动/搜索/输入互不影响。
- 独立详情 block 不触发 `List`/`Tags` RPC（可在后端日志确认）。

---

## T9 · [P2] txt 文件在 Snorkeling 内部无法预览

**现状（已核实）**
- `frontend/app/view/preview/preview-open.ts` `canPreviewFileInfo`：`mimeType.startsWith("text/")` 已包含 `text/plain`，理论上 **.txt 应可预览**。
- `preview-model.tsx` `getSpecializedView`：`isTextFile(mimeType)` → `specializedView: "codeedit"`。
- 所以问题更可能是：**打开入口走了 `shouldOpenWithDefaultApp`**（`!canPreviewFileInfo` 才用系统默认应用），或 **mimetype 探测失败返回空串/未知类型**（Windows 下 `mime.TypeByExtension(".txt")` 一般正常，但空文件、无扩展名、或远程连接会不同）。

**排查步骤（先诊断再改）**
1. 用 CDP 打开一个 .txt，读 `fileMimeType` 的值；若为 `""` 或 `application/octet-stream`，说明是 mimetype 探测问题。
2. 检查 `openPreviewEntry` 是否走了 `getApi().openNativePath`（有则说明 `canPreviewFileInfo` 返回 false）。
3. 检查 `pkg/` 侧 stat/mime 接口（`FileInfo.mimetype` 来源）。

**修复方向**
- 若 mimetype 为空：在 `canPreviewFileInfo` 里对**已知文本扩展名白名单**（`.txt .log .ini .conf .env .gitignore .csv .md`）兜底返回 true。
- 若 mimetype 为 `application/octet-stream`：同样走扩展名白名单。
- 修完补 `preview-open.test.ts` 用例（已有该测试文件，加 `.txt` / `.log` / `.env` 三个 case）。

**验收**
- 双击 `.txt` → 在 Snorkeling 的 codeedit 里打开，不走系统记事本。

---

## T10 · [P1] HTML 文件三种打开模式（源码 / 内部渲染 / 默认应用）

**现状（已核实）**
- `preview-model.tsx` `getSpecializedView`：`text/html` 命中 `isTextFile` → `codeedit`（**只能看源码**）。
- 内部渲染 HTML 的能力已存在但没接：`frontend/app/view/webview/webview.tsx`（Electron `<webview>`），`openWebviewBlock` 走 `view: "webview"`。也可用 iframe（沙箱风险更高，不推荐加载本地文件）。
- 系统默认应用：`getApi().openNativePath(path)`（已在 `preview-open.ts` 用过）。

**方案：入口统一为"三选一"菜单 + 记住偏好**

1. **主入口**：preview 头部加一个 `Open As` 按钮（`menubutton`，复用 `compact-open-target-menubutton` 样式），仅当 `mimeType === "text/html"`（或扩展名 `.html/.htm`）时出现，三个菜单项：
   - `Source` → 当前 block 切 `codeedit`（即现状）
   - `Rendered` → 当前 block 切 `webview`，`meta.url = "file:///<abs path>"`
   - `Default App` → `openNativePath`
2. **默认行为**：`.html` 单击仍然**默认源码**（保持向后兼容，不惊吓用户），但记住上次选择到 `localStorage`（`preview.htmlOpenMode`），下次单击直接用上次模式。
3. **交互区分（回答用户"用什么交互区分三种"）**
   - 单击 = 上次记忆的模式（首次为 Source）
   - 右键菜单 = 三个显式选项（右键是最符合直觉的"选打开方式"入口）
   - 头部 `Open As` 按钮 = 可发现性兜底
   - `Ctrl+点击` = 直接用 Default App（可选，P2）
4. **安全**：`webview` 加载 `file://` 需确认 `webpreferences` 未开启 `nodeIntegration`；渲染本地 HTML 时禁用远程导航（`will-navigate` 拦截）。

**验收**
- 三种模式都能从右键菜单进入。
- 记忆生效：选过 Rendered 后，下次单击直接渲染。
- 渲染模式里点链接不会把主窗口导航走。

---

## T11 · [P1] WidgetsBar 悬浮 Agent widget 弹窗"慢一拍"

**现状（已核实）**
- `frontend/app/workspace/widgets.tsx:112` `WidgetHoverOpenDelayMs = 500`，`handleWidgetHover` 用 `setTimeout(500)` 开弹窗。
- `handleWidgetHoverEnd` 会清 timer，所以不是"必现延迟"，而是**固定 500ms 等待 + 弹窗首次挂载开销**叠加，体感"慢一拍"。
- 弹窗首次打开时 `AgentTargetPopup` 里有 cc-switch vendors 懒加载（`refreshCcSwitchVendors`，`widgets.tsx:1932`）和 `agentProfileOptions` 计算，首次会额外卡。

**方案**
1. 把 `WidgetHoverOpenDelayMs` 从 500 降到 **120–180ms**（Tooltip 的 `openDelay=300` 是另一个组件，不冲突）。业界 hover-intent 常用 100–200ms。
2. **预加载**：`AgentTargetPopup` 在组件挂载时（而非打开时）就完成 `cc-switch vendors` 拉取与 `agentProfileOptions` 计算；或用 `useEffect` 在 WidgetsBar 挂载后 idle 时预热。
3. 弹窗用 `FloatingPortal` 已就绪；确认没有在 open 时同步做重计算（把 `moveDefaultTargetFirst` 等放进 `useMemo`，已有则检查依赖是否稳定）。
4. 保留"离开即取消"逻辑不变。

**验收**
- 悬浮 150ms 内出现弹窗；连续快速划过 3 个 widget 不会误开。
- 首次打开与第二次打开的延迟差 < 50ms（说明预加载生效）。

---

## T12 · [P1] Tab 组右上角 "+" 悬浮 Agent 项，二级弹窗也慢一拍

**现状（已核实）**
- `frontend/app/block/inlinetab-addmenu.tsx:20` `ItemHoverOpenDelayMs = 500`，与 WidgetsBar 同款问题（注释里也写了"与右侧 WidgetsBar 一致"）。
- 二级弹窗走 `requestLaunchPopup`（`launch-popup-bus.ts`）→ `widgets.tsx` 的 `subscribeLaunchPopup` → `openAgentTargetsAt`，多一层事件总线 + 跨组件 state 更新，比直接调用多一帧。
- 还有 `makeFrozenAnchor` 的定位快照逻辑，打开瞬间会有一次布局测量。

**方案**
1. `ItemHoverOpenDelayMs` 同样降到 120–180ms（两处常量可抽到共享模块，避免再次不一致）。
2. **消除总线往返的一帧**：`requestLaunchPopup` 目前是 `useEffect` 订阅后 setState；改为在 bus 里**同步**记录 pending request，`widgets.tsx` 用一个 `useSyncExternalStore` 或直接在 `requestLaunchPopup` 里同步调用注册的回调（注册表模式），避免 effect 延迟。
3. 二级弹窗内容预计算：`getLaunchCreatableTargets(...)` + `moveDefaultTargetFirst` 在 hover 开始时（而非 timer 触发后）先算好，timer 只负责 setState。
4. `makeFrozenAnchor` 的 rect 在 hover 开始时测一次即可（当前是打开时测）。

**验收**
- "+" 菜单悬浮 Agent 项，二级弹窗 150ms 内出现。
- 快速划过多项不误开、不残留。

---

## 待用户确认

| ID | 问题 | 影响任务 | 建议默认 |
|---|---|---|---|
| U1 | "报错的脚本工具执行"指的是 **Scheduled Tasks 运行历史**，还是 **AI 会话里的 tool call 失败项**？ | T2 | 先按 Scheduled Tasks 历史做（可删除/可撤回）；tool call 只做 UI 隐藏，不物理删除 |
| U2 | T1 `Load all` 是否需要"记住偏好"（下次自动全量）？ | T1 | 默认不记住 |
| U3 | T8 中"再次点击变 Tab 化"是否只对**同一 tab 内已存在的详情 block**生效？跨 tab 时是否也应该 Tab 化？ | T8 | 仅同 tab 内生效，跨 tab 一律新开 |
| U4 | T10 `.html` 首次默认打开方式是源码还是渲染？ | T10 | 源码（向后兼容） |
| U5 | T4 自动刷新是否要在 UI 上提供"关闭"入口（现在只能通过右键菜单 submenu 设 Off）？ | T4 | 提供，放在刷新按钮的右键菜单里，不改默认值 |

---

## 执行顺序建议（夜间）

1. **P0**：T6（性能/超时）——影响面最大，先做；T6 的 P0-b/P0-c 可独立先合。
2. **P1 并行批**：T1、T5、T11、T12（四个不同目录，可并行）。
3. **P1 串行**：T4 → T8（同文件，T4 改动小先做）。
4. **P1**：T10（preview 目录，与 T9 冲突，串行）。
5. **P2**：T9、T2（等 U1 确认）。
6. 每完成一批跑一次 `npm run build:dev` + 相关 `vitest` + `go test ./pkg/aisessions ./pkg/service/aisessionsservice ./pkg/scheduler`。