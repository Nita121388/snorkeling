# Snorkeling 全项目性能排查报告与分波次整改总方案

> **状态**：只读排查与方案规划（**本轮零生产代码改动、零数据库改动**）。  
> **日期**：2026-11-26 · **基线版本**：`0.0.139`（HEAD `8aa56c252`）  
> **证据分级**：`[已实测]` 本机实时遥测/日志/离线基准数字 · `[代码证实]` 源码 `file:line` 调用链 · `[推断]` 基于前两项的因果归因。

---

## 1. 本机实测全景画像（2026-11-26 运行中实例）

| 观测维度 | 实测数字 | 直接指向的根因 |
|---|---|---|
| **整机内存 / Commit** | 物理 14.82 GB（剩 4.02 GB）；Commit 上限 24.45 GB，**已用 85.2%**（仅剩 3.62 GB） | `[已实测]` 内存接近压力线 |
| **Snorkeling 总占用** | **~1.90 GB Private** / 累计 **2,365 s CPU**（6 个 Renderer 合计 **1,495.3 MB** + GPU 205.4 MB + Main 104.9 MB + `wavesrv` 75.4 MB / **727 s CPU**） | `[代码证实]` 每 Tab 同步加载 Monaco+24 视图 + LRU 淘汰失效 + 幽灵隐藏 Tab 预加载 + `TermWrap` 泄漏 |
| **系统 `git fsmonitor--daemon`** | **18 个常驻进程合计 ~803 MB Private**（`D:/SoftWare/Git/etc/gitconfig` 仍开 `core.fsmonitor=true`） | `[代码证实]` Snorkeling 内 `vcs.go`/`transport_git.go`/`hero/sync.go` 已全部注入 `-c core.fsmonitor=false`，当前 18 个来自宿主机其他终端/工具 |
| **实时日志异常（`waveapp.log`）** | 近 5,000 行：`filestore` 617 次、`agentstatus` 860 次、`503` 22 次、4 个 Tab 反复 `WritePump error: i/o timeout`、多次 `error appending to blockfile: context deadline exceeded` | `[代码证实]` `ws.go:198` 漏刷写 deadline；`filestore.db`（137.87 MB）单连接 `synchronous=FULL` + 刷盘清热缓存 |
| **历史日志爆炸（`waveapp.72.log`）** | 单份日志高达 **69.64 MB**；采样 4,000 行含 **88 次 `[wavesrv] [panic] in WshRpcProxy.SendRpcMessage:eventrecv: send on closed channel`**，goroutine ID 达 **4,900,831** | `[代码证实]` WS 假断连重连 + `ws.go:277` 关闭 `ToRemoteCh` 与 `wshproxy.go:55` 并发发送竞争 |
| **切 Tab 慢日志（`waveapp.72.log`）** | `cache=hit` 下 `backend` 达 **6,647 ms / 17,646 ms**；`cache=miss` 下 `setview` 达 **968 ms** | `[代码证实]` `waveterm.db` 单连接锁争用 + 冷切串行等 `waveReadyPromise`（被 `await loadMonaco()` 阻塞） |
| **磁盘膨胀** | `~/.snorkeling/ai-sessions/` **7.25 GB**（live 库 3.42 GB + 备份 3.05 GB）；`filestore.db` **137.87 MB**；`%LOCALAPPDATA%\snorkeling-agentstatus-hook.log` **246.30 MB**（持续增长无轮转） | `[已实测]` 索引重复存储 + hook 日志无上限 |

---

## 2. 跨层根因总表（按模块与严重度）

### 2.1 Electron 主进程（`emain/`）

| 级别 | 问题 | 代码锚点 | 机制与影响 |
|---|---|---|---|
| **P0** | **Tab 缓存 LRU 淘汰失效** | `emain/emain-tabview.ts:281-296` | `checkAndEvictCache` 排序比较器把 `isActiveTab` 排在索引 `0`（且非对称破坏严格弱序），淘汰循环从 `i=0` 尝试驱逐却被 `tryEvictEntry` 跳过活跃 Tab → 每次 `size === MaxCacheSize + 1` 时实际淘汰 **0** 个；且无空闲 TTL 驱逐，隐藏 `WebContentsView` 常驻 RAM 无限累积。 |
| **P1** | **每秒无条件离屏 `setBounds` 风暴** | `emain/emain-window.ts:391-400,687-699`、`emain/emain-tabview.ts:216-223` | 每窗 1s `setInterval` 调 `finalizePositioning()`；`positionTabOnScreen` 有坐标相等短路，但 `positionTabOffScreen` **没有**，每秒对所有隐藏 Tab 无条件调原生 `setBounds({x:-15000,y:-15000})`。 |
| **P1** | **启动关键路径串行冗余** | `emain/emain.ts:438-493`、`emain/emain-window.ts:1402-1436`、`emain/updater.ts:131,369` | 启动期发 **5 次** `GetFullConfigCommand`；多窗串行等全部 `waveReadyPromise` 后才 `win.show()`；`await configureAutoUpdater()` 串行阻塞 `setGlobalIsStarting(false)` 与全局快捷键注册。 |
| **P1** | **冷切 Tab 队列阻塞（历史未实施债）** | `emain/emain-window.ts:581-611,720-837` | `11-19-tab-switch-queue-decouple` 仍 0% 实施；冷切在 2 槽串行队列内死等 `initPromise + waveReadyPromise`（实测 `setview=968ms`）。 |
| **P2** | **主线程同步 IO / 17 个 `sendSync` / 崩溃重连惊群** | `emain/emain-ipc.ts:510-553,610-636`、`emain/tab-collapse-store.ts:77-89`、`emain/emain-wavesrv.ts:308-319` | `update-window-controls-overlay` 在主线程同步 `PNG.sync.read()`；折叠状态同步 `writeFileSync`；`wavesrv` 异常重启时 `reloadAllWaveWindows` 同时重载全部 10+ 缓存 Tab。 |

### 2.2 前端（`frontend/`）

| 级别 | 问题 | 代码锚点 | 机制与影响 |
|---|---|---|---|
| **P0** | **`TermWrap` 销毁后永久定时器与全量内存泄漏** | `frontend/app/view/term/termwrap.ts:529-556,787-794` | `runProcessIdleTimeout` 无限递归 `setTimeout(5000) → requestIdleCallback → serializeAddon.serialize()`，句柄从未保存、`dispose()` 未取消、无 `disposed` 标志 → 每次关块/切内联 Tab/改终端设置都永久泄漏整棵 xterm + scrollback + 离屏 DOM。 |
| **P0** | **幽灵隐藏 Tab 预加载** | `frontend/app/workspace/workspace.tsx:77-113,230-246`、`frontend/app/tab/vtabbar.tsx:482-484,573`、`global-atoms.ts:100` | 每 Tab 已是独立 `WebContentsView`、`staticTabId` 永不变，但 hover Tab 仍会在**当前 Renderer 内**挂载最多 2 棵 `visibility: hidden` 的完整 `<TabContent>`（重复起 xterm/WebGL/PTY resync/Monaco/Overview 15s 轮询，且永远无法在该 Renderer 显示）。 |
| **P0** | **每 Tab 启动同步拉起 Monaco + 全部 24 个视图** | `frontend/wave.ts:15,54,274`、`monaco-env.ts:4-20,49-96`、`builtinviews.ts:4-60`、`streamdown.tsx:14` | `await loadMonaco()` 阻塞每个 Tab 首帧；`registerBuiltinViews()` 静态导入 24 视图，把 `shiki/bundle/web`、`@observablehq/plot`、6,261 行 `markdown.tsx`、`@tanstack/react-table` 全部灌入每个普通终端 Tab，直接推高 6 个 Renderer 内存至 1.50 GB。 |
| **P0** | **`OverviewBoard` 每次渲染强制同步回流 + `ResizeObserver` 重建** | `frontend/app/session-overview/overview-board.tsx:698-701,826-939,1032` | `columns` 未 `useMemo` → `columnKeys`/`rebaseline` 每次渲染换引用 → `useLayoutEffect` 每次渲染跑 `captureBoardSnapshot()`（全卡 `getAnimations` + `getBoundingClientRect`）+ 重复 `querySelectorAll` + `ResizeObserver` 销毁重建；`group="tab"` 时 `onDragStartCard={handleCardDragStart(card)}` 击穿 `BoardCard` memo。 |
| **P0** | **`SessionOverviewPanel` 15s 强刷风暴** | `frontend/app/session-overview/session-overview.tsx:477,904-979`、`session-overview-session-cache.ts:261-291,349-366` | 每 15s 对全部会话发 `Summary({refresh:true})`，且 `storeSummaryResult` 漏调已写好的 `isSameSessionSummary` 无条件 `markChannelDirty`；20 个会话 = 每 15s 20 次强刷 RPC + ~40 次错峰整板重渲。 |
| **P1** | **每 Tab 常驻 `SessionOverviewButton` + 全工作区非 Agent 块状态订阅** | `session-overview.tsx:1090-1162`、`agent-status-tab-aggregate.ts:122-153,458-478` | `getWorkspaceBlockIdsAtom` 未按 `isAgentTerminalMeta` 过滤，对普通终端/Preview/Webview 也发 `GetAgentStatus` RPC + WPS 订阅；`SessionOverviewButton` 在每个 Tab 内常驻 30s `useNow`。 |
| **P1** | **WPS `EventSubCommand` O(N²) 订阅风暴** | `frontend/app/store/wps.ts:46-65,84,107` | 逐条订阅无 microtask 合批、无 `scopes` 去重，N 个块同时挂载发 N 次 RPC、携带 O(N²) scopes。 |
| **P1** | **`Overview` 次级重渲级联** | `session-overview.tsx:451,2521,2874-2988,3114`、`send-status-chip.tsx:43` | `useOverviewPresentedStatuses` 依赖未稳数组 `blockIds` 反复 release/acquire；列表态仍算 `boardCards`/`timelineRows`/`miniTimelines`；草稿输入放 `CardSendContext` 击穿所有卡的 `SendStatusChip`。 |
| **P1** | **`DirectoryTable` 无虚拟化 + 2ms 滚动 `setState` 风暴** | `frontend/app/view/preview/preview-directory.tsx:349-356,674-734` | 千行目录全量渲染 DOM；滚动每 2ms `setScrollHeight` 整表重渲；每行 `useDrag` 传新对象导致每帧重绑拖拽。 |
| **P1** | **改任意 `term:*` 设置重建所有 `TermWrap`** | `frontend/app/view/term/term.tsx:347-348,582` | 依赖整个 `termSettings` 前缀对象，改光标/响铃等热更新项会销毁重建全部 xterm（并叠加 P0 泄漏）。 |
| **P1** | **模块级缓存无驱逐** | `wos.ts:171`、`agent-status-tab-aggregate.ts:80,96`、`preview-model.tsx:118-207` | 已删块/Tab 不清理；`tabIds.join(" ")` 作为 Map key 每次增删拖拽 Tab 永久泄漏衍生 atom。 |
| **P2** | **隐藏 Tab 定时器未休眠 + AI Sessions 列表细节 + FLIP 布局抖动** | `agent-status-done-tick.ts:30`、`processviewer.tsx:218`、`aiaudit-view.tsx:100`、`aisessions.tsx:2302`、`session-group.tsx:205`、`session-detail.tsx:2136`、`vtabbar.tsx:462-476` | 多处定时器缺 `document.hidden` 门控；`refreshTimeNow` 挂顶层 30s 触发整页重渲；`contextTextBySeq` 急切格式化全部虚拟化外消息；`AnimatedExpand` 收起时仍挂载子 Markdown 与 `ResizeObserver`。 |

### 2.3 Go 后端（`pkg/`, `cmd/`）

| 级别 | 问题 | 代码锚点 | 机制与影响 |
|---|---|---|---|
| **P0** | **三大 SQLite 库缺 WAL 调优 + `SetMaxOpenConns(1)` 读写串行** | `pkg/wstore/wstore_dbsetup.go:55-59`、`pkg/filestore/blockstore_dbsetup.go:67-72`、`pkg/aisessions/sqlite_index.go:62-66` | 全部默认 `synchronous=FULL`（NTFS 每次提交双 fsync）、无 `_cache_size`/`_temp_store=MEMORY`；单连接把所有读阻塞在写后，直接导致实测 `SetActiveTab` 达 6.6–17.6s 与 `blockfile context deadline exceeded`。 |
| **P0** | **`index-v2.sqlite` 每次请求 + 每 5s 反复开关与全套 DDL/全表扫描** | `pkg/aisessions/manager.go:129-134,418-423,576-582`、`sqlite_index.go:114-323,414,699-725` | 每次调用（含单次 `List` 内 2 次、每 5s watch 1 次）均重新 Open → 23 条 DDL + 9 条 `pragma_table_info` + 无索引全表扫 `ai_sessions` + 读并 SHA-256 `meta.json` → Close 丢弃全部 page cache。 |
| **P0** | **WebSocket 漏刷写 deadline + 断连死锁 + `WshRpcProxy` panic 风暴** | `pkg/web/ws.go:171,198,277-312`、`pkg/wshutil/wshproxy.go:46-60` | `WriteLoop` 普通消息不刷新 `SetWriteDeadline`（继承 ping 的 10s deadline → 假断连）；`outputCh <-` 无 `<-closeCh` 断连易死锁；关闭 `ToRemoteCh` 与路由并发发送竞争引发 69.64 MB panic 堆栈洪水。 |
| **P0** | **`WshRouter` `rpcMap` 与 `linkMsgBacklog` 无上限泄漏** | `pkg/wshutil/wshrouter.go:95,105,316-336,389,715-730` | 超时/断连不清理 `rpcMap`；慢连接 `linkMsgBacklog` 无内存上限，可积压终端流直至 OOM。 |
| **P0** | **HTTP `WriteTimeout=21s` 硬编码 + AI Sessions 超时/`loadAll` 污染** | `pkg/web/web.go:60,548-581` + [aisessions-index-perf-plan-20261126.html](file:///E:/code/snorkeling/docs/answers/aisessions-index-perf-plan-20261126.html) | `WriteTimeout=21s` 截断最高 60s 的 `web:servicetimeoutms` 且仅启动读取一次；叠加 AI Sessions `Summary` join 60s/120s flight、`GetState` 30s 忽略 ctx、`loadAll` Frame 1 重写并清零 `mtime/size`。 |
| **P1** | **`filestore` 5s 刷盘逐条 fsync + 刷完即清热缓存 + 数据竞争** | `pkg/filestore/blockstore.go:39,228-238,266-277,410-422,477-487`、`blockstore_cache.go:348` | 每个脏块独立事务 `FULL` fsync；刷完调 `entry.clear()` 立刻驱逐活跃终端热尾块，下次 4KB 写入被迫 2 次 SELECT 重载；首个错误中止整批；`getDirtyCacheKeys` 未持 `entry.Lock` 存在数据竞争。 |
| **P1** | **`jobcontroller` 每 4KB 输出查 `waveterm.db` + PTY 无合批广播** | `pkg/jobcontroller/jobcontroller.go:794-835`、`pkg/blockcontroller/shellcontroller.go:791-799` | 高输出构建/测试每秒产生千次 4KB 写与 `waveterm.db` 点查 + base64 `Event_BlockFile` 广播风暴。 |
| **P1** | **无条件 1s `RunSysInfoLoop` + 29 分钟 Codex 重复扫盘 + `vcs.go` 进程倍增** | `sysinfo.go:49-72`、`shellcontroller.go:99-122,1563-1716`、`vcs.go:1735-1823,2347-2405` | 无订阅者仍每秒采 CPU/Mem 走完整 RPC 链路；Codex 捕捉每 2s 重读解析全部 `rollout-*.jsonl` 持续 29 分钟；`vcs.go` 单仓 5–8 次串行 `git` 进程、`.git` 内仍试探 `svn info`。 |
| **P1** | **热路径 5×Unmarshal/4×Marshal + O(N) 反射 + 持锁做 IO** | `wshadapter.go:21-31`、`wshrpc.go:305,410`、`wconfig/filewatcher.go:145-186`、`wstore_rtinfo.go:86-127` | 每次 WS RPC 线性扫百余反射方法并多层 JSON 编解码；`filewatcher` 无防抖且持全局 `w.mutex` 读盘/查库/发 WPS。 |
| **P1** | **无界大包内存读取** | `wshfs.go:82,89`、`vcs.go:2306-2345`、`web.go:142,549` | `wshfs.Read`、`RemoteVcsFileDiffCommand`、`/wave/service` 请求体与响应双缓冲缺上限保护。 |
| **P2** | **外围存储与日志债务** | `provider_opencode.go:68-69,545`、`shellcontroller.go:2063`、`commontext_store.go:476`、`wps.go:207`、`snorkeling-agentstatus-hook.log` | `modernc` DSN `_busy_timeout` 语法失效；拖拽 resize 每次同步写 DB；`commontextstore.Get` 全表扫；hook 日志 246.3 MB 无轮转。 |

---

## 3. 分波次整改路线图（10 个独立 `loop/` 包，按 ROI 排序）

> **执行原则**：每包独立 commit、带 `loop/` 数字判据、带回滚开关、严格遵循零功能回退。

### Wave 0 — 止血与高确定性 Bug（预计降 30–50% 内存/连接抖动，风险最低）

| 包号 | 范围 | 核心改动 | 硬验收判据 |
|---|---|---|---|
| **W0-1** | 终端与主进程内存泄漏止血 | ① `termwrap.ts` 保存并清理 5s `setTimeout`/`requestIdleCallback` + `disposed` 卫语句；② `emain-tabview.ts:285` 修 LRU 比较器（过滤 `!isActiveTab` 后按 `lastUsedTs` 淘汰）；③ `positionTabOffScreen` 加坐标相等短路 | 单测锁 `dispose()` 后 0 次 idle 回调；`wcvCache` 超 `MaxCacheSize` 精准驱逐最旧非活跃 Tab；离屏 Tab 连续 `finalizePositioning` 仅调 1 次 `setBounds` |
| **W0-2** | WebSocket / Proxy / Router 稳定性止血 | ① `ws.go:198` 每次写前刷新 `SetWriteDeadline`，所有 `outputCh <-` 加 `<-closeCh` select；② `wshproxy.go` 安全关闭替换粗暴 `close(ToRemoteCh)`；③ `wshrouter.go` 断连清理 `rpcMap` + TTL 回收 + `linkMsgBacklog` 上限 | 模拟 20s 间隔写入 0 次 `WritePump i/o timeout`；并发关闭+广播 10,000 次 **0 panic**；断连后 `rpcMap` 残留为 0 |
| **W0-3** | 幽灵隐藏 Tab 预加载清理 + Hook 日志轮转 | ① `workspace.tsx` 移除 hover 触发的 `preloadTabIds`（仅留 `pendingMountTabIds` 且用完即卸载）；② `snorkeling-agentstatus-hook.log` 加 10 MB 轮转截断 | hover 任意 Tab 时当前 Renderer DOM 中 `TabContent` 数恒为 **1**；hook 日志超限自动轮转不无限增长 |

### Wave 1 — 后端 SQLite 锁争用 & AI Sessions P0（消除 17.6s 切 Tab 卡顿、503、blockfile 超时）

| 包号 | 范围 | 核心改动 | 硬验收判据 |
|---|---|---|---|
| **W1-1** | SQLite WAL 调优 + `filestore` 批刷 + 长连接 | ① 三大 DB 加 `_synchronous=NORMAL&_temp_store=MEMORY&_cache_size`；`waveterm.db`/`filestore.db` 拆只读连接池 + 单写连接；② `index-v2.sqlite` 改进程级缓存连接 + `sync.Once` 初始化；③ `filestore` 5s 合并单事务刷盘、刷后保热尾块、修 `getDirtyCacheKeys` 竞争；④ `jobcontroller` 缓存 `AttachedBlockId`、`filewatcher` 防抖+锁外 IO | `go test -race ./pkg/filestore/... ./pkg/wstore/... ./pkg/wconfig/...` 全绿；10 活跃终端刷盘 tx 数从 N 降为 **1**；连续 10 次 `List` 只执行 **1** 次 schema init；`SetActiveTab` P95 ≤ 50ms |
| **W1-2** | AI Sessions P0-A/B + HTTP 超时收口 | 落地 [aisessions-index-perf-plan-20261126.html](file:///E:/code/snorkeling/docs/answers/aisessions-index-perf-plan-20261126.html) 中 **P0-A**（`WriteTimeout` 动态对齐、`GetState` 1.5s 响应 ctx、`Summary` 不 join 60s/120s flight、统一 refresh/List 单飞）与 **P0-B**（`loadAll` 续帧携带真实 `mtime/size` + `saveSummaryTx` 禁写 0） | `Summary`/`LiveSessionState` 503 与空响应为 **0**；`GetState` 100ms deadline 下 100ms 级返回；8 帧 `loadAll` 首帧后新增 `SaveMessages` = **0** 且 `mtime/size` 非零 |

### Wave 2 — 前端启动、内存与渲染流畅度（砍半每 Tab Renderer 内存 + 消 UI 卡顿）

| 包号 | 范围 | 核心改动 | 硬验收判据 |
|---|---|---|---|
| **W2-1** | Monaco 与重型视图懒加载 + 启动去重 | ① 移除 `wave.ts:274` 阻塞式 `await loadMonaco()`，按需加载 Monaco / `shiki` / `@observablehq/plot` / 15+ 非终端视图；② 去重启动 5× `GetFullConfigCommand`；③ `configureAutoUpdater()` 移出启动关键路径 | 纯终端 Tab 首屏不加载 Monaco/Shiki chunk；冷启动 `GetFullConfigCommand` ≤ **2** 次；冷切 `setview` P50 显著下降 |
| **W2-2** | Overview 看板与 15s 轮询风暴治理 | ① `overview-board.tsx` memoize `columns`、稳住 `columnKeys`/`rebaseline` 与 `onDragStartCard`；② `storeSummaryResult` 启用 `isSameSessionSummary` 去重；③ 按 `viewMode` 惰性派生、拆分 `draftByBlock` 出 `CardSendContext`；④ `getWorkspaceBlockIdsAtom` 仅过滤 agent 块 | 单次点击卡片触发 `captureBoardSnapshot` 与 `ResizeObserver` 重建次数 = **0**；无变更 15s 轮询整板重渲 = **0**；输入草稿不重渲其他卡片 |
| **W2-3** | 列表虚拟化 + 终端热更新 + 隐藏定时器休眠 + WPS 合批 | ① `DirectoryTable` 删 2ms `scrollHeight` state、修 `useDrag`、接 `@tanstack/react-virtual`；② `term.tsx:582` 缩窄 `TermWrap` 依赖；③ `wps.ts` microtask 合批 + scope 去重；④ 隐藏页定时器加 `document.hidden` 暂停与 `refreshTimeNow` 叶子隔离 | 改 `term:bellsound` 等设置 `TermWrap` 重建次数 = **0**；20 块同挂 `EventSubCommand` RPC 次数 = **1**；1,000 文件目录挂载 DOM 行数 ≤ 50 |

### Wave 3 — 后端降 CPU & AI Sessions 索引结构演进

| 包号 | 范围 | 核心改动 | 硬验收判据 |
|---|---|---|---|
| **W3-1** | 后端降 CPU（SysInfo / PTY / Codex / VCS / RPC） | ① `RunSysInfoLoop` 按订阅者启停；② PTY 32KB 缓冲 + 4–8ms 合批；③ Codex 捕捉加退出取消与 mtime 缓存；④ `vcs.go` 合并 `porcelain=2 --branch` + 4 并发池 + `.git` 跳过 `svn`；⑤ `wshadapter` 缓存反射表 + `json.RawMessage` | 无 sysinfo 订阅时采样频率 = **0 Hz**；单仓库 VCS 状态 `git` 进程数从 5–8 降为 **1–2**；`wshadapter` 反射查表 benchmark 耗时降 ≥ 80% |
| **W3-2** | AI Sessions P1/P2 + 冷切 Tab 队列解耦 | ① AI Sessions **P1-A**（删重复索引 + 部分索引 + 维护窗口 VACUUM → -595 MB）、**P1-B**（整数 fk 窄元数据 → turn 30ms→9.2ms）、**P2-A**（`rows.Next` 流式 + 独立 FTS5 trigram 探索）、**P2-B**（增量 `SaveMessages`）；② `11-19-tab-switch-queue-decouple`（先锁 6 项竞态测试再开 flag） | 索引体积 3.42 → **2.83 GB**；最大会话 turn ≤ **10 ms**；高命中搜索 P50 ≤ **3.2 s**、峰值堆 -39%；冷切连点不阻塞队列 |

### 宿主机侧建议（非代码项，由用户确认执行）

- `D:/SoftWare/Git/etc/gitconfig` 开启了系统级 `core.fsmonitor=true`，导致非 Snorkeling 终端/工具在每次 git 操作时拉起永不退出的 `git fsmonitor--daemon`（本机当前 18 个占用 ~803 MB Commit）。建议评估系统级关闭 `core.fsmonitor` 或清理闲置 daemon。
- 清理已存在的 `~/.snorkeling/ai-sessions/index-v2.sqlite.backup-before-prop-status-*`（3.05 GB，确认不再需要后）及历史 `waveapp.*.log`（~130 MB）。

---

## 4. 风险与回滚边界

- **零功能回退红线**：不截断 AI Sessions 正文/thinking、不改搜索 Unicode 语义、不破坏终端 scrollback/批注/轮次分页、不在 RPC 路径做 VACUUM。
- **高风险隔离**：
  - `W1-1`（SQLite 读写分离 + `filestore` 批刷）必须带 `go test -race` 回归，且对 `filestore` 热缓存保留加容量上限避免反向涨内存。
  - `W2-1`（Monaco/视图懒加载）必须逐视图验证首次打开加载态与主题同步，不留白屏。
  - `W3-2`（窄元数据 sidecar & 冷切队列解耦）均配独立 feature flag，关闭即秒回旧路径。
- **已知前置清理**：`frontend/app/commontext/commontext-compose-modal.test.ts:233` 存在 1 条既有契约红测（非本轮引入），实施前端包时勿误判回归。
