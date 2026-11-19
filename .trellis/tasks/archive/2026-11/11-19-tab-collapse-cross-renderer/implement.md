# Implement：collapsed 集合跨 renderer 同步

## 1. emain 真源 + 广播

- [x] `emain/emain-window.ts`：`collapsedTabIds` Set + `getCollapsedTabIds()`、
      `collapseTabIdsMain()`、`expandCollapsedTabIdMain()`、`clearCollapsedTabIdsMain()`、
      `broadcastCollapsedTabIds()`（结构对齐 `broadcastOpenedThisLaunchTabIds`）。
- [x] `markTabOpenedThisLaunch` 内追加移除 collapsed + 广播。
- [x] IPC 4 条：`get/collapse/expand/clear-collapsed-tab-ids`。
- [x] `setTabViewIntoWindow` 复用 tab 分支补发 `collapsed-tab-ids-change`。

## 2. preload + 类型 + mock

- [x] `emain/preload.ts`：5 个方法。
- [x] `frontend/types/custom.d.ts`：ElectronApi 补 5 个方法（带 IPC 名注释）。
- [x] `frontend/preview/mock/preview-electron-api.ts`：5 个空实现。

## 3. renderer 模块改造

- [x] `frontend/app/tab/tab-collapse-state.ts`：atom 初值同步读；新增 `initCollapsedTabIdsSync()`；
      三个写函数改「本地乐观写 + IPC 写穿」；导出签名保持不变。
- [x] `frontend/wave.ts`：`initOpenedThisLaunchTabIdsSync()` 旁调用 `initCollapsedTabIdsSync()`。

## 4. 验证

- [x] 单测新增 `frontend/app/tab/tab-collapse-state.test.ts`：mock `window.api`，
      断言 collapse/expand/clear 各触发对应 IPC，广播回调写回 atom（集合相等短路）。
- [x] `npx vitest run frontend/app/tab/`（含既有 tabcontextmenu / tab-more-model）全绿。
- [x] typecheck（frontend tsc --noEmit）+ lint 通过。
- [x] 真机台建立：`scripts/verify/tab-collapse-cross-renderer/verify.mjs`（7 条判据）；
      按用户指示跳过真机执行，已在 README area 表登记为「未跑」。

## 5. 回滚点

- 单 commit 内可整体 revert（emain + preload + 类型 + mock + renderer 六处同批）。
- 无配置/数据迁移，无持久化格式变更。
