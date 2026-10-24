# Design — Selection Search In Files 跨 Tab

## 1. 分层与接缝

```
识别/解析层（不动）                     打开层（本次改造）
──────────────────                     ───────────────────────────────────────
parseFileReference(selection)   ──→    searchSelectionInFiles(reference)
                                          │
                                          ├─ collectPreviewTargets()      ← 改造点 A
                                          │    ├─ 当前 Tab 已挂载 block（现路径，保留）
                                          │    └─ 全 workspace 对象存储枚举（新增）
                                          ├─ resolvePreviewTarget()        ← 打分加当前 Tab 权重
                                          └─ openPathInPreview({tabId})    ← 改造点 B
```

本次只改「目标收集」和「打开路由」，解析器与 textHint 行定位逻辑完全不动。

## 2. 改造点 A：跨 Tab 目标收集

### 2.1 为什么不能继续用 `getAllBlockComponentModels()`

block 组件模型只在挂载时注册（`block/block.tsx:1274`），非活跃 Tab 不挂载（`app.tsx:57` 只渲染 `staticTabId`）。所以 BCM 集合 ≡ 当前 Tab。

**结论**：保留 BCM 路径作为「当前 Tab 已挂载模型」的来源（它能直接拿到 `PreviewModel`，`statFile`/`formatRemoteUri` 现成），另建一条「元数据 + RPC」路径覆盖其它 Tab。两条路的输出统一成同一个 `PreviewOpenTarget` 结构。

### 2.2 元数据路径

```
atoms.workspace（globalStore.get）→ tabids（当前 staticTabId 排最前）
  for tabId of tabids:
    tab = globalStore.get(WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", tabId)))
    for blockId of tab.blockids:
      block = globalStore.get(WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", blockId)))
      block.meta.view === "preview"
      normalizeConnection(block.meta.connection) === 目标 connection
      resolvePreviewDirectoryDisplayMode(block.meta["preview:display"], settingsDefault, "tree") === "tree"
      rootPath = block.meta["preview:explorer-root"] || (isDir(block.meta.file) ? block.meta.file : null)
```

`meta.file` 是否为目录必须 stat 确认（现有 `findTreeFilesBlock` 也是这么做的），用 `RpcApi.FileInfoCommand` + `formatRemoteUri(path, connection)`。

### 2.3 目标结构统一

现有 `PreviewOpenTarget` 依赖 `model: PreviewModel`（用于 `statFile` / `formatRemoteUri` / 读取当前路径）。改造为：

```ts
type PreviewTarget = {
    tabId: string;
    blockId: string | null;      // 非挂载 Tab 可能拿不到 block 时可为 null
    connection: string | null;
    rootPath: string;
    currentPath: string;
    stat: (path: string) => Promise<FileInfo | null>;   // 注入式，BCM 走 model，元数据走 RPC
    isCurrentTab: boolean;
};
```

注入 `stat` 函数是本次最关键的解耦：让 BCM 路径和元数据路径共用下游的 `resolvePreviewTarget` / 打分 / 行定位逻辑，避免两套实现漂移。

### 2.4 限流与缓存

```ts
withConcurrency(4, tasks)          // 简单信号量
statWithTimeout(path, 1500)        // Promise.race，超时 → null
Map<`${conn}|${path}`, FileInfo>   // 单次查找内的缓存
```

## 3. 改造点 B：`openPathInPreview({tabId})`

### 3.1 参数化范围

```ts
type FileLinkOpenOptions = { ..., tabId?: string | null }
const tabId = options?.tabId ?? globalStore.get(atoms.staticTabId);
```

需要被 `tabId` 影响的位置（逐个替换内部的 `atoms.staticTabId`）：

| 函数 | 现状 | 改造 |
|---|---|---|
| `findTreeFilesBlock` | 读 `atoms.staticTabId` | 接受 `tabId` 参数 |
| `findExistingNonEditPreviewBlock` | 同上 | 同上 |
| `focusTreeBlock` | `restoreMinimizedBlockToLayout(tabId, blockId)` | 用传入 tabId |
| `createPreviewBlock` | `createBlock`（落到当前活动 Tab） | 见 3.2 |
| `applySearchLineToBlock` | 与 Tab 无关 | 不变 |

### 3.2 在非当前 Tab 建 block：顺序与机制（**已实测修正**）

> 原 design 写的「方案 1：先 `setActiveTab` 等生效再 `createBlock`」被实测否定了，原因见下。

实测结论：
- `atoms.staticTabId = atom(initOpts.tabId)` 在**单个 renderer 内不可变**（`global-atoms.ts:100`）；
- 每个 Tab 是**独立 renderer/BrowserView**，`set-active-tab` 只是切主进程的活动 BrowserView（`emain-window.ts:418/430`）；
- 因此 `waitForActiveTab` 轮询 `atoms.staticTabId` **必然超时**，`createBlock`（`global.ts:416` 用 `getLayoutModelForStaticTab()`）**永远落在调用方 Tab**，先切 Tab 也不会变。

**采用方案 2**：让服务端把 block 直接插进目标 Tab 的 layout。

```ts
await ObjectService.CreateBlockInTab(
    targetTabId,
    blockDef,
    DefaultCreateBlockRuntimeOpts,
    false,          // activateTargetTab
    magnified
);
// 服务端已把 block 插入目标 Tab 的 layout（pkg/service/objectservice）
getApi().setActiveTab(targetTabId);   // 只负责把用户视线切过去
```

现成先例：`frontend/app/workspace/widgets.tsx:2084` 的 `createBlockInExistingTab` 就是这个模式（`CreateBlockInTab` → `setActiveTab`）。

配套约束：
- **跨 Tab 不要调 `refocusNode`**（`global.ts:646` 内部写死 `getLayoutModelForStaticTab()`，跨 Tab 无效）。目标 Tab 的 renderer 自行处理聚焦。
- reveal 仍走 `ObjectService.UpdateObjectMeta` 写 `preview:revealpath` / `preview:revealseq`，这是服务端 meta 变更，跨 Tab 天然有效；目标 Tab 挂载后自行响应。
- 目标 block 最小化 → `restoreMinimizedBlockToLayout(targetTabId, blockId)`（已按 tabId 走 `getLayoutModelForTabById`，跨 Tab 可用）。
- `waitForActiveTab` **不再需要**，从 design 删除。

顺序因此变为：**建 block（服务端落目标 Tab）→ 写 reveal meta → `setActiveTab`**，正好与 PRD R3.4 一致。

### 3.3 向后兼容

`tabId` 缺省回落 `atoms.staticTabId`，且缺省时不触发任何 `setActiveTab` / `waitForActiveTab`。调用方（markdown 链接、Files 树双击、`preview-edit.tsx` action）不传参即保持现状。

## 4. 歧义处理与反馈

### 4.1 歧义

`resolvePreviewTarget` 现有逻辑：按分数排序，最高分并列多个 → `ambiguous`。

改造：
- 并列候选**去重后跨 Tab** 才视为歧义（同一 Tab 内同路径重复 block 不应打扰用户，取第一个）。
- `ambiguous` 时弹出候选选择 UI，展示 `Tab 名 + 该 Tab 下的相对路径`。

**已实测：`TabTargetModal` 不适用**（见 §7.1）。它依赖 `useWaveEnv` 上下文、自带 `setModalOpen(true)`、只过滤当前 Tab、且没有「Tab 名 + 相对路径」插槽。采用退化方案：`ContextMenuModel` 弹出候选列表（与 `selection-copy-overlay` 已有的菜单机制一致，实现成本最低）。

### 4.2 反馈

- 跨 Tab 打开成功 → 复用 `selection-copy-overlay.tsx` 已有的 feedback 气泡（`onCommonTextFeedback(msg, kind)` 形态），文案 `Opened in Tab "<name>"`，`kind = "success"`。
- 未命中 → `kind = "warn"`，文案 `Not found in N tabs`。
- 需要把该回调从 `SelectionCopyOverlay` 透传到 `searchSelectionInFiles`（当前 `searchSelectionInFiles` 是纯函数，无 UI 依赖）。做法：给 `searchSelectionInFiles` 增加可选的 `onFeedback?: (msg: string, kind: string) => void` 参数，缺省时退化为 `window.alert`（保持 `preview-edit.tsx` 现有调用点行为）。

## 5. 风险与对策

| 风险 | 等级 | 对策 |
|---|---|---|
| `openPathInPreview` 是高复用函数，参数化失误导致 markdown / Files 树 / 编辑器三处回归 | **高** | `tabId` 缺省完全等价旧行为；先补 `file-link-navigation.test.ts` 的默认路径用例再改 |
| `createBlock` 的 Tab 归属依赖活动 Tab，时序不稳 | 中 | `waitForActiveTab` + 超时降级，只在跨 Tab 时启用 |
| 远端 connection stat 慢，拖住整个查找 | 中 | 并发 4 + 单次 1.5s 超时 |
| `TabTargetModal` 契约不匹配 | 低 | 退化到 ContextMenu，记录偏差 |
| 未挂载 Tab 拿不到 Block 对象（WOS 未订阅） | 低 | 枚举时 `globalStore.get` 为空则跳过该 Tab；不阻塞 |

## 6. 不做的事

- 不动 `selection-reference-parser.ts`。
- 不动终端 LinkProvider。
- 不引入全局 toast 系统（只为一次提示引入基础设施不划算）。

## 7. 待实现阶段确认

> 2026-10-24 前置核对完成（静态核查；运行期项已标注）。Step 0/1/2 已落地，Step 3 因下方第 4 项冲突暂停待确认。

### 7.1 `TabTargetModal` 能否脱离 workspace modal 流程单独调用 — 部分可以，但不满足「纯选择回调」

- **是普通 React memo 组件，不走 `modalsModel.pushModal` 队列**：两个现存调用点都是「在组件里条件渲染」——
  `frontend/app/workspace/widgets.tsx:2835`、`frontend/app/block/blockframe-header.tsx:452`。
- 但依赖两个隐式上下文，**不能从模块级函数直接调用**：
  1. `useWaveEnv<TabTargetModalEnv>()` → 必须渲染在 `WaveEnvContext.Provider` 内；
  2. 挂载时 `setModalOpen(true)`（workspace 级 modal 标志，影响快捷键/焦点），卸载时复位。
- props：`workspace`、`currentTabId`、`title`、`subtitle`、`actionLabel`、`workingLabel`、`emptyLabel?`、`onClose`、`onSelect(tabId)`；
  内部 `tabIds = workspace.tabids.filter(id => id !== currentTabId)`。
- **对 R4.1 的偏差**：它只能展示「除当前 Tab 之外的全部 Tab」，不能只展示歧义候选，也没有「按 Tab 展示该 Tab 下相对路径」的插槽。
- **结论**：`selection-search-in-files.ts` 是纯函数模块，要用它必须新增一个渲染宿主；且需给组件加 `tabIds?: string[]`（或 `rows` 渲染插槽）才能只列候选。
  → 实现阶段按 design 4.1 的退化方案执行：**用 `ContextMenuModel` 弹候选列表**（`selection-copy-overlay` 已有该机制，且可在纯函数路径上直接构造）。
  若后续仍想用 modal，则需把「收集候选 → 弹 modal」上移到 overlay 的 React 层，而不是在 `searchSelectionInFiles` 内部。

### 7.2 `atoms.workspace.tabids` 是否含非活跃 Tab 的完整列表 — ✅ 含全部

- 后端：`pkg/wcore/workspace.go:359` `createTabObj` 每次建 Tab 都 `ws.TabIds = append(ws.TabIds, tab.OID)`；关闭 Tab 时 `:377-381` 从切片里删。
- 前端：`frontend/app/store/global-atoms.ts:47` `workspaceAtom` 直接从 WOS 读 `workspace` 对象，`tabids` 即后端 `TabIds`（`frontend/types/gotypes.d.ts:3357`）。
- 与 Tab 是否挂载无关 —— 挂载只影响 `getLayoutModelForTabById` 的订阅行为（`layoutModelHooks.ts:27` 只给 staticTabId 注册后端更新订阅），不影响 `tabids` 本身。

### 7.3 非活跃 Tab 的 `Block` 对象是否已在 WOS 中可读 — 可读，但首次读取可能是 null，必须 await

- `WOS.getWaveObjectAtom(oref)` → `getWaveObjectValue(oref)` 会**惰性创建并立即发起 `GetObject` HTTP 拉取**（`wos.ts:183` `createWaveValueObject(oref, true)`），
  所以任意 Tab 的 block **都可拉到**，不需要该 Tab 挂载。
- **陷阱**：`globalStore.get(atom)` 在首次访问的同一个同步 tick 里返回 `null`（`dataAtom` 初值 `{value:null, loading:true}`，HTTP 回来才填）。
  → Step 4 枚举时必须走 `await WOS.loadAndPinWaveObject(oref)`（`wos.ts:226`，返回 pendingPromise 或已解析值），不能纯同步 `globalStore.get`。
- 增量新鲜度：`global.ts:60-66` 注册了**无 scope 的** `waveobj:update` 订阅，`wps.ts:125` 对空 scope 的 handler 一律投递 → 所有对象更新都会进 WOS 缓存。
- 仍待**运行期验证**：从未在本 renderer 挂载过的 Tab，其 block 对象能否稳定拉到（HTTP 通）以及首拉延迟量级。
  验证方式：Tab A 打开后 `await WOS.loadAndPinWaveObject(WOS.makeORef("block", <Tab B 的 blockId>))`，看是否返回非空 Block。

### 7.4 ⚠️ 与 design 3.2 冲突：`staticTabId` 在本 renderer 内不可变，`waitForActiveTab` 永远等不到

- `frontend/app/store/global-atoms.ts:100`：`staticTabIdAtom = atom(initOpts.tabId)`，**初始化后从不改变**（注释写明 “should never change”）。
- `setActiveTab` → IPC `set-active-tab` → `emain/emain-window.ts:418` `setActiveTab` 只切主进程要显示的 **BrowserView**；
  每个 Tab 是独立 renderer（`emain-window.ts:430-448` 每个 tabView 各自 `wave-init` 带自己的 tabId）。
- 后果（影响 Step 3，本次未实现）：
  1. `waitForActiveTab(tabId)` 轮询 `globalStore.get(atoms.staticTabId) === tabId` **必然超时**（目标 Tab 的 staticTabId 在另一个 renderer 里）；
  2. `createBlock` 用 `ObjectService.CreateBlock` + `getLayoutModelForStaticTab()`，**永远落在调用方自己的 Tab**，`setActiveTab` 之后再建也一样；
  3. `refocusNode(blockId)` 内部也写死 `getLayoutModelForStaticTab()`（`global.ts:646`），跨 Tab 聚焦拿不到目标 Tab 的 node。
- **建议改走 design 3.2 的方案 2（已静态核实可行）**：
  - 建块：`ObjectService.CreateBlockInTab(targetTabId, blockDef, DefaultCreateBlockRuntimeOpts, false, magnified)`
    （`frontend/app/store/services.ts:375`；后端 `pkg/service/objectservice/objectservice.go:126` → `wcore.CreateBlockInTab` 已在服务端把块插进目标 Tab 的 layout，返回 updates；
    现成用例：`frontend/app/workspace/widgets.tsx:2084` 的 `createBlockInExistingTab`）。
  - 复用已有块：`restoreMinimizedBlockToLayout(tabId, blockId)` / `getLayoutModelForTabById(tabId)` 已按 tabId 工作（`block-minimize.ts:203`、`layout/index.ts:17`）。
  - 聚焦：目标 Tab 未挂载时不要调 `refocusNode`；改为 `focusNode` 到目标 LayoutModel + `setActiveTab`，或切 Tab 后由目标 renderer 自行恢复焦点。
- 已落地的 Step 2 不受该冲突影响（只做参数化，缺省路径零行为变化）。
