# Snorkeling 性能整改接手背景与实施指南（Wave 2–3 + W1 进阶项）

> 用途：直接把本文路径或文末「给接手 Agent 的启动 Prompt」交给下一个 Agent，即可接续实施 **Wave 2（前端启动/看板/虚拟化/WPS 合批）** 与 **Wave 3（后端降 CPU / AI Sessions 索引 P1-P2 / 冷切队列解耦）**。
> 更新时间：2026-11-26（HEAD `fabf4c76d`）。

---

## 一、背景与已落地成果（不要重复做）

Snorkeling（WaveTerm fork，仓库 `E:\code\snorkeling`）在 2026-11-26 完成了全仓只读性能排查（遥测 + 生产日志 + Electron/Frontend/Go 四层审计，详见 [snorkeling-full-perf-plan-20261126.md](file:///E:/code/snorkeling/design/plans/snorkeling-full-perf-plan-20261126.md) 与 [snorkeling-full-perf-roadmap-20261126.html](file:///E:/code/snorkeling/docs/answers/snorkeling-full-perf-roadmap-20261126.html)），并已按 `loop/` 门链完成 **Wave 0（3 包）+ Wave 1（2 包）** 共 5 笔代码提交并推送 `origin/main`：

| 包号 | Commit | 已落地内容 | 状态 |
|---|---|---|---|
| **W0-1** | `bf36afc2f` | `TermWrap.dispose()` 清理 5s `setTimeout`/`requestIdleCallback` 泄漏；`emain/emain-tabview.ts` 修 LRU 比较器（跳过 `isActiveTab` 按 `lastUsedTs` 淘汰）；`positionTabOffScreen` 坐标相等短路 | G2+prove 全绿，G7 待真机 |
| **W0-2** | `7049212b1` | `pkg/web/ws.go` `WriteLoop` 每次写前刷新 `SetWriteDeadline` + `outputCh <-` 防断连死锁；`WshRpcProxy.Close()` 防并发 `send on closed channel` panic；`WshRouter` `UnregisterLink` 清理 `rpcMap`/backlog + TTL 回收 + `MaxLinkBacklogSize=1024` | G2+prove+`-race` 全绿 |
| **W0-3** | `715b4475a` | `HOVER_TAB_PRELOAD_ENABLED=false` 关闭 hover 幽灵隐藏 Tab 预加载（保留 CommonText `pendingMountTabIds`）；Windows `.cmd`/`.ps1` hook 日志加 5MB 自动轮转（`hookInstallVersion=23`） | G2+prove 全绿 |
| **W1-1** | `c339698f2` | 三大 SQLite 库启用 `_synchronous=NORMAL`、`_temp_store=MEMORY`、`_cache_size`（16MB/64MB）；`index-v2.sqlite` 加 `sqliteInitCache` 快路径跳过重复 DDL/迁移；`filestore.FlushCache` 单项失败不中止整批 + `atomic.Bool` 修 `getDirtyCacheKeys` 竞争；`filewatcher` 150ms 防抖且锁外读配置/广播；`jobcontroller` 缓存 `AttachedBlockId` | G2+prove 2/2 全绿 |
| **W1-2** | `fabf4c76d` | AI Sessions P0-A/B：`HttpWriteTimeout=65s` + 每请求动态读取 `web:servicetimeoutms`；`JsonlRpcProcess.SendContext` + `GetState(ctx)` 响应 deadline；`Summary(false)` join 活跃 flight 上限 1.5s；`Summary(refresh=true)` 统一走 `refreshAllSummaries`；`LiveSessionState` 1.5s/10s 有界；`DetailDelta`/`LoadDelta`/`saveSummaryTx` 修复 `loadAll` `mtime/size=0` 清零与重写 | G2+7 项+回归全绿 + `go vet` 通过 |

### W1 预留给后续波次的进阶项（保守拆分、尚未实施）
1. `waveterm.db` / `filestore.db` **读写连接池分离**（目前仍 `SetMaxOpenConns(1)`；拆成 `mode=ro` 读池 `SetMaxOpenConns(4)` + 单写连接可进一步消除读等写）。
2. `filestore.FlushCache` **单事务合并多条目 + 刷后保留活跃热尾块**（目前仍逐条开事务、刷完调 `entry.clear()`）。

---

## 二、待实施清单（Wave 2 & Wave 3，共 5 个包）

> 严格执行 `loop/` 门链：建包（`node E:/primary/projects/loop/bin/loop.mjs queue add --json ... --root E:/code/snorkeling`）→ 写红测落 `red-proof.txt` → `queue gate --gate g2` → `queue run --emit-pick` → 最小实现 → `queue prove` → `ledger add --action verify --to green` → 独立 commit。

### Wave 2：前端启动、内存与渲染流畅度（建议优先执行）

#### 包 1：`W2-1` — Monaco 与重型视图懒加载 + 启动去重（预期砍半每 Tab Renderer 内存，缓解 6 个 Renderer 占 1.5GB 与冷切 1s 卡顿）
- **实证根因锚点**：
  - `frontend/wave.ts:14-15, 54, 92-96, 274`：静态导入 `monaco-env.ts` 与 `registerBuiltinViews()`，且在首帧渲染前**同步阻塞 `await loadMonaco()`**（实际 `loadMonaco()` 为同步函数，内部配置 Monaco/YAML/6 个 worker 与主题）。
  - `frontend/app/monaco/monaco-env.ts:4-20, 49-96`：顶层静态导入 `monaco-editor`、5 种语言 contribution、`monaco-yaml` 和 6 个 `?worker`。
  - `frontend/app/block/builtinviews.ts:4-60`：静态导入全部 24 个 ViewModel，把 `AiSessions`（→ `frontend/app/element/streamdown.tsx:14` 的 `shiki/bundle/web`）、`Sysinfo`（`@observablehq/plot`）、`Preview`（6,261 行 `markdown.tsx` + `@tanstack/react-table`）全部灌入每个普通终端 Tab。
  - `emain/emain.ts:463`、`emain/emain-window.ts:1402`、`emain/emain-tabview.ts:312`、`frontend/wave.ts:275`、`emain/updater.ts:867`：启动期发 **5 次** `GetFullConfigCommand`；`emain/updater.ts:131,369` 的 `await configureAutoUpdater()` 阻塞 `setGlobalIsStarting(false)` 与全局快捷键注册。
- **修改设计**：
  1. `monaco-env.ts` 拆成轻量 theme 同步桩 + 按需 `async ensureMonacoLoaded()`（动态 `import()` 真正的 Monaco 配置模块）；`wave.ts:274` 移除阻塞式 `loadMonaco()`，仅在 Monaco 已加载时同步主题，未加载时记住目标主题待首次打开编辑器再应用。
  2. `builtinviews.ts` / `blockregistry`：保持 `"term"`（及轻量 `"launcher"`/`"tips"`/`"web"`）同步可用，将重型视图的 `viewComponent` 或 ViewModel 按需 `React.lazy` / 动态加载；`streamdown.tsx` 的 `shiki/bundle/web` 改按需动态导入 + 有界 LRU 缓存 `codeToHtml` 结果。
  3. `emain/` 启动缓存一次 `fullConfig` 传给 `relaunchBrowserWindows()` / `getOrCreateWebViewForTab()`（带过期或监听更新），`configureAutoUpdater()` 改为非阻塞后台执行（不阻塞 `setGlobalIsStarting(false)`）。
- **验收方向**：
  - 单测验证：纯终端启动路径不调用 `loadMonaco()` / `monaco-env` 初始化，`setMonacoTheme` 在未加载时安全延迟应用；
  - `vite build` / chunk 检查确认 `monaco`、`shiki` 不进入口主 chunk 同步依赖图；
  - `npx vitest run` 相关测试 + `node scripts/check-tsc-baseline.mjs` 0 新增错误。

#### 包 2：`W2-2` — Overview 看板回流与 15s 强刷风暴治理（兼收 `11-20` 遗留债）
- **实证根因锚点**：
  - `frontend/app/session-overview/overview-board.tsx:698-701, 821-840, 842-922, 926-939, 1022, 1032`：
    1. `columns = groupOverviewCards(...)` 未 `useMemo` → 每次渲染换数组引用；
    2. `columnKeys` 依赖 `[columns]`、`rebaseline` 依赖 `[columnKeys]` → **`useLayoutEffect` 和 `ResizeObserver` 重建在每次渲染都跑**，每点一次卡片（`markBlockViewed`）或 30s tick 就对全板所有卡调 `getBoundingClientRect()` + `getAnimations()` + 重复 `querySelectorAll`（line 850）；
    3. `group="tab"` 时 `onDragStartCard={handleCardDragStart(card)}` 每次渲染新建函数，击穿 `BoardCard = memo(BoardCardImpl)`（line 646）。
  - `frontend/app/session-overview/session-overview.tsx:477, 904-979, 2521, 2874-2988, 3114` & `session-overview-session-cache.ts:261-291, 349-366`：
    1. 每 15s（`SESSION_SUMMARY_POLL_MS`）对全部 `sessionIds` 调 `loadSummary(id, true)` 强刷；
    2. `storeSummaryResult` 从未调用已定义的 `isSameSessionSummary`（line 261），无条件 `markChannelDirty("summary")`；`loadSummary` 还在 `cachedSummary != null` 时先 `setSummaries` 一次、resolve 再 `setSummaries` 一次（20 会话 ≈ 40 次整板重渲）；
    3. `CardSendContext.Provider` 携带 `draftByBlock` 包裹全板，每个卡内的 `SendStatusChip`（`send-status-chip.tsx:43`）消费它，打字输入击穿全部卡 memo；
    4. 非当前 `viewMode` 的 `boardCards`/`timelineRows`/`miniTimelines` 仍无条件重算。
  - `frontend/app/agent-status/agent-status-tab-aggregate.ts:122-153, 458-478`：`getWorkspaceBlockIdsAtom` 未用 `isAgentTerminalMeta` 过滤，对普通终端/Preview/Webview 也发 `GetAgentStatus` RPC。
- **修改设计**：
  1. `overview-board.tsx`：`useMemo` 缓存 `columns`；用稳定字符串签名 `columnKeysSig` 代替数组引用触发 `rebaseline`/observer；去掉 line 850 重复 `querySelectorAll`；`BoardCard` 接稳定 `onDragStartCard(card, event)` 回调。
  2. `session-overview-session-cache.ts`：`storeSummaryResult` 内对比 `isSameSessionSummary(canonicalEntry.value, summary)`，实质无变化时只刷新 `loadedAt` 不调 `markChannelDirty("summary")`。
  3. `session-overview.tsx`：只在必要时更新 `summaries` state；按 `viewMode` 惰性计算视图数据；把 `draftByBlock` 拆出 `CardSendContext`（或按 blockId 独立原子/订阅）。
  4. `agent-status-tab-aggregate.ts`：`getWorkspaceBlockIdsAtom` 过滤 `isAgentTerminalMeta(block?.meta)`。
- **验收方向**：
  - DOM/JSDOM 单测断言：同卡片集合点击触发重渲时 `getBoundingClientRect` 采样次数 = **0**、`ResizeObserver` 重建次数 = **0**；
  - `storeSummaryResult` 传入等价 `SessionSummary` 时 `summary` channel revision **不变**；
  - 输入草稿不触发未选中卡片的 `SendStatusChip` 重渲；
  - `frontend/app/session-overview/` 全套 Vitest 全绿。

#### 包 3：`W2-3` — `DirectoryTable` 虚拟化 + 终端热更新缩窄 + WPS 合批 + 隐藏定时器休眠
- **实证根因锚点**：
  - `frontend/app/view/preview/preview-directory.tsx:349-356, 674-687, 721-734`：注释写虚拟滚动但实际 `otherRows.map` 全量渲染；`onScroll` 2ms 防抖 `setScrollHeight` 触发整表重渲；每行 `useDrag` 传新 `dragItem` 对象每帧重绑拖拽。
  - `frontend/app/view/term/term.tsx:347-348, 582`：创建 `TermWrap` 的 `useEffect` 依赖整个 `termSettings` 对象，改 `term:bellsound` 等可热更新设置会销毁重建所有终端。
  - `frontend/app/store/wps.ts:46-65, 84, 107`：每次 `waveEventSubscribeSingle` / `waveEventUnsubscribe` 立即发 `EventSubCommand`，无 `scopes` 去重、无 microtask 合批（N 块同时挂载产生 O(N²) scope 传输）。
  - 隐藏页面定时器未休眠：`agent-status-done-tick.ts:30,49`、`processviewer.tsx:218`、`aiaudit-view.tsx:100`、`aisessions.tsx:2302`（`refreshTimeNow` 挂顶层 30s 触发整页 + 未虚拟化 `GroupedSessionList` 重渲）。
- **修改设计**：
  1. 删除 `preview-directory.tsx` 的 `scrollHeight` state/防抖（如样式需要则直接写 `el.dataset.scrollHeight`）；修复 `TableRow` memo 与 `useDrag` 原始依赖；用 `@tanstack/react-virtual`（仓库已有依赖）虚拟化 `TableBody`。
  2. `term.tsx:582` 改为仅依赖 `init-only` 字段（如 `blockId`, `termScrollback`, `disableWebgl`, `termFontSize`, `connFontFamily`）。
  3. `wps.ts`：用 `Set` 去重 `scopes`，`updateWaveEventSub` 按 `eventType` 走 `queueMicrotask` 合批。
  4. 为未门控定时器补 `document.hidden` 检查，把 `aisessions.tsx` `refreshTimeNow` 下沉到叶子时间组件，并给 `GroupedSessionList` 的 `flatTree` 加 `useMemo`。
- **验收方向**：
  - `wps.ts` 单测：连续 20 次同 `eventType` 订阅只发 **1** 次 `EventSubCommand` 且 scopes 无重复；
  - `DirectoryTable` 单测：1,000 条文件挂载 DOM 行数 ≤ 50，滚动不触发行组件重渲；
  - 改 `term:bellsound` 不销毁重建 `TermWrap`。

---

### Wave 3：后端降 CPU & AI Sessions 索引演进 + 冷切队列解耦

#### 包 4：`W3-1` — 后端降 CPU（SysInfo / PTY / Codex / VCS / RPC 反射）+ W1 连接池进阶
- **实证根因锚点**：
  - `pkg/wshrpc/wshremote/sysinfo.go:49-72`、`cmd/server/main-server.go:417`、`cmd/wsh/cmd/wshcmd-connserver.go:296,411,435`：本机与所有远端每 1s 无条件采集 CPU/Mem 并全链路序列化推送，即使 0 个订阅者。
  - `pkg/blockcontroller/shellcontroller.go:791-799`：4KB PTY read 直接 base64 + `HandleAppendBlockFile` 广播；`shellcontroller.go:99-122,1563-1716` Codex 会话捕捉最长轮询 29 分钟（400ms×30 + 2s×870）且每次重读解析全部 `rollout-*.jsonl`。
  - `pkg/wshrpc/wshremote/vcs.go:1735-1823, 2347-2405, 484-504`：单仓库 5–8 次串行 `git` 进程（最多 64 仓），`.git` 内仍试探 `svn info`，`svn status -u` 带网络请求。
  - `pkg/wshutil/wshadapter.go:21-31,125`、`pkg/wshutil/wshrpc.go:305,410`、`pkg/web/ws.go:106-126,191`：每次 WS RPC 线性反射扫描百余方法 + 5 次 Unmarshal / 4 次 Marshal；`pkg/wstore/wstore_rtinfo.go:86-127` 每次持全局锁重建反射 map。
  - `pkg/wstore/wstore_dbsetup.go` / `pkg/filestore/blockstore.go`：W1 遗留的读池分离与 `filestore` 批刷保热尾块。
- **修改设计**：按子模块逐项解耦（每项加独立测试与 `-race` 验证）。

#### 包 5：`W3-2` — AI Sessions 索引 P1/P2 + 冷切 Tab 队列解耦
- **AI Sessions 索引 P1-A / P1-B / P2-A / P2-B**：完整设计与基准数字见 [design.md](file:///E:/code/snorkeling/.trellis/tasks/11-25-aisessions-index-perf-plan/design.md) §3 和 [aisessions-index-perf-plan-20261126.html](file:///E:/code/snorkeling/docs/answers/aisessions-index-perf-plan-20261126.html)（**切记不要直接拆 equijoin 正文表——实测 70.7× 回退；搜索不得用 SQLite ASCII `lower()` 替换 Go Unicode**）：
  - **P1-A**：删重复 `idx_ai_session_messages_session`（-295.86 MB）+ `idx_ai_session_messages_user` 改 `WHERE role='user'` 部分索引（278.55→14.36 MB）+ 维护窗口 VACUUM（总体积 3.42→2.83 GB）；
  - **P1-B**：additive 整数 `session_fk` 窄元数据 sidecar（44.88 MB，最大会话 turn 30.3→9.2 ms，宽表保持 authoritative + feature flag）；
  - **P2-A**：搜索先上 `rows.Next()` 流式（高命中 4.79→3.06s、峰值堆 -39%、总分配 -55.5%），后续另行评估 FTS5 trigram 预筛；
  - **P2-B**：`SaveMessages` canonical prefix diff 增量写入。
- **冷切 Tab 队列解耦（历史任务 `11-19-tab-switch-queue-decouple`）**：先读 `.trellis/tasks/11-19-tab-switch-queue-decouple/prd.md`，锁定 6 项竞态单测后再开启解耦开关。

---

## 三、环境约束与注意事项（必读）

1. **本机内存警戒**：当前 Windows 物理 RAM 14.82 GB、Commit 上限约 25 GB（空闲常在 2–4 GB 波动）。
   - Go 编译/测试务必串行 `-p 1`：`powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go test -p 1 ..."`；
   - 完整链接 `cmd/server` 时若遇 `VirtualAlloc errno=1455`（DWARF 符号过大），请用 `go vet` 或 `go build -ldflags="-s -w" -p 1` 验证。
2. **存量已知红灯（勿当新回归）**：
   - `frontend/app/commontext/commontext-compose-modal.test.ts:233`（`flushes pending search`）在 HEAD 即红；
   - `node scripts/check-tsc-baseline.mjs` 当前基线为 `58`，确保改动文件 **0 新增 TS 错误**。
3. **工作区隔离**：仓库可能有并行任务未提交改动，提交时务必显式 `git add -- <本包 touch 列表>`。
4. **真机验收提醒**：Wave 0–1 已全部过单元/竞态测试，但 G7 真机验收（重启新构建 `wavesrv` + `Snorkeling` 观察实际内存、切 Tab、AI Sessions 503 与 hook 日志轮转）需在所有代码包收敛后统一构建验证。

---

## 四、给接手 Agent 的启动 Prompt（可直接复制使用）

````text
请接手 Snorkeling 仓库（E:\code\snorkeling）的性能整改实施，继续执行 Wave 2（W2-1 / W2-2 / W2-3）和 Wave 3（W3-1 / W3-2）。

先按序阅读：
1. design/plans/snorkeling-perf-wave2-3-handoff-20261126.md —— 已完成边界（W0-1..3 + W1-1..2 已推 origin/main）、各包精确代码锚点、改造方案、验收门与本机内存红线。
2. design/plans/snorkeling-full-perf-plan-20261126.md —— 全项目排查背景。
3. 如做到 W3-2，再读 .trellis/tasks/11-25-aisessions-index-perf-plan/design.md 与 .trellis/tasks/11-19-tab-switch-queue-decouple/prd.md。

执行硬纪律：
- 严格走 loop 门链（统一入口：node E:/primary/projects/loop/bin/loop.mjs ... --root E:/code/snorkeling）：建包(createTask:true) → 先写红测取 red-proof.txt → queue gate --gate g2 → queue run --emit-pick → 最小实现 → queue prove → ledger add --action verify --to green → 仅 git add 本包文件独立 commit → 推送 origin main。
- 零功能回退：不截断正文/thinking，不改搜索 Unicode 语义，高风险项带开关可回滚。
- Windows 本机 Commit 内存紧张：Go 测试务必加 -p 1；不要并行起多个 vitest/go 进程；若链接 cmd/server 需用 -ldflags="-s -w" 或 go vet。
- 工作区如有其他并行任务改动，严禁误提交。

建议从 Wave 2 的 W2-2（Overview 看板回流与 15s 强刷治理）或 W2-1（Monaco 与重型视图懒加载）开始逐包推进，每完成一个包向用户同步一次实测结果与 commit hash。
````
