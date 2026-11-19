# Design：collapsed 集合主进程化（对齐 openedThisLaunchTabIds 模式）

## 现状与问题

- 每个 Tab = 独立 `WaveTabView extends WebContentsView`（emain/emain-tabview.ts），
  各有完整 renderer 进程，Tab 栏在各 renderer 各渲染一份。
- `collapsedTabIdsAtom`（frontend/app/tab/tab-collapse-state.ts）是 renderer 本地 jotai 状态
  （注释明示「纯 renderer 侧状态」），收起动作只写进当前 renderer → 切 Tab 后其他 renderer
  的集合为空，被折叠 Tab 复现。
- 读/写已全部收敛到该模块的 4 个导出（tabbar / vtabbar / tab-more-menu / tabcontextmenu /
  tab-open-state 调用点不直接触 IPC）。

## 方案

真源搬到 emain；renderer 侧保留同名导出，改为「本地乐观写 + IPC 广播同步」。

### emain（emain/emain-window.ts，紧挨 openedThisLaunchTabIds 同款写法）

- `const collapsedTabIds = new Set<string>()` + `getCollapsedTabIds(): string[]`
- `collapseTabIdsMain(tabIds)` / `expandCollapsedTabIdMain(tabId)` / `clearCollapsedTabIdsMain()`：
  变更后 `broadcastCollapsedTabIds()`（遍历 waveWindowMap → allLoadedTabViews →
  `webContents.send("collapsed-tab-ids-change", ...)`，与 `broadcastOpenedThisLaunchTabIds` 同构）。
- `markTabOpenedThisLaunch` 内追加：从 collapsed 集合移除并广播（打开即解除收起，语义收口在 main）。
- IPC：
  - `ipcMain.on("get-collapsed-tab-ids")` → sendSync 返回初值
  - `ipcMain.on("collapse-tab-ids", (_e, tabIds: string[]))`
  - `ipcMain.on("expand-collapsed-tab-id", (_e, tabId: string))`
  - `ipcMain.on("clear-collapsed-tab-ids")`
- `setTabViewIntoWindow` 复用已有 tab 分支（发 opened-this-launch 的地方）同步补发
  collapsed 集合，覆盖 wave-init 重初始化路径。

### preload（emain/preload.ts）

- `getCollapsedTabIds: () => ipcRenderer.sendSync("get-collapsed-tab-ids")`
- `collapseTabIds / expandCollapsedTabId / clearCollapsedTabIds` → `ipcRenderer.send(...)`
- `onCollapsedTabIdsChange(cb)` → `ipcRenderer.on("collapsed-tab-ids-change", ...)`

### renderer（frontend/app/tab/tab-collapse-state.ts，导出签名不变）

- atom 初值改同步读 `api.getCollapsedTabIds()`（模块加载即读，新 renderer 天然拿到当前集合）。
- 新增 `initCollapsedTabIdsSync()`：重读初值 + 订阅 `onCollapsedTabIdsChange` 写回 atom，
  在 frontend/wave.ts 的 `initOpenedThisLaunchTabIdsSync()` 旁调用。
- 三个写函数：先 `globalStore.set` 本地乐观更新（即时视觉反馈），再 `api?.xxx?.()` 写穿到 main；
  main 广播回来后与乐观值天然幂等（Set 相等即 no-op）。

### 类型与 mock

- `frontend/types/custom.d.ts` ElectronApi 补 5 个方法。
- `frontend/preview/mock/preview-electron-api.ts` 补同款空实现。

## 关键取舍

- 不持久化：重启清空，沿用现状语义（PRD Out of Scope）。
- 不按 workspace 隔离：tabId 全局唯一，main 侧单集合即可，与 openedThisLaunch 一致。
- renderer 保留乐观写：收起动作视觉零延迟；广播回写做集合相等短路，避免多余 render。

## 风险

- sendSync 初值读取：与 openedThisLaunch 相同模式，启动期开销可接受。
- 多窗口并发写：main 串行处理 IPC，天然一致；广播覆盖所有窗口所有已加载 tabView。
