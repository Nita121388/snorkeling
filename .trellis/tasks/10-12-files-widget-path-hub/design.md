# Design — Files 悬浮窗升级为路径中枢

## 1. Change Boundary (before-dev step 7)

**Smallest behavior gap**

- 现状：Files 面板的 Recent 只在"用面板自己选过路径"时增长、不持久化；Pinned 只能从目录右键菜单产生；preview 里的真实导航完全不记录；点击 widget 只会开一个 `~` block。
- 目标：preview 里真实打开/导航的路径被记录并持久化；面板能展示常用/最近并提供搜索与面板内 Pin；点击 widget 打开面板。

**Where the behavior actually lives**

- 真实导航的唯一汇聚点：`PreviewModel.goHistory()` → `UpdateObjectMeta` 改 `block.meta.file`（`preview-model.tsx:1491`）。因此记录点应挂在 **`PreviewModel.metaFilePath` 的变化**上（而不是目录右键菜单或某个 UI 组件）。
- 面板展示逻辑属于 `preview-new-files.tsx`；数据接线属于 `widgets.tsx`。
- 持久化属于既有配置链路（`pkg/wconfig` 键注册 + `SetConfigCommand`）。

**Files expected to change**

| 文件 | 为什么必须改 |
|---|---|
| `pkg/wconfig/settingsconfig.go` | 新增 `PathUsageEntryType` 与 `preview:path-usage` 配置字段；不注册则 `SetBaseConfigValue` 报 `invalid config key`，无法持久化 |
| `pkg/wconfig/metaconsts.go` | 按既有约定登记配置键常量 |
| `frontend/types/gotypes.d.ts` | 由 `task generate` 生成，暴露新配置键类型 |
| `frontend/app/view/preview/path-usage.ts` (新) | 纯逻辑：归一化、噪音过滤、记录归约、衰减排序、去重、上限淘汰 |
| `frontend/app/view/preview/path-usage.test.ts` (新) | 纯逻辑单测 |
| `frontend/app/view/preview/path-usage-store.ts` (新) | jotai 派生 atom + 记录/移除 API + 节流持久化 |
| `frontend/app/view/preview/path-panel-model.ts` (新) | 纯逻辑：面板分区与过滤的 view model |
| `frontend/app/view/preview/path-panel-model.test.ts` (新) | 面板 view model 单测 |
| `frontend/app/view/preview/preview-new-files.tsx` | 面板重写（分区/搜索/键盘/行内操作/connection 透传） |
| `frontend/app/view/preview/preview-model.tsx` | 删除死代码 `recentDirs`/`trackRecentDir`/`clearRecentDir`；新增 `metaFilePath` 订阅 → 记录 |
| `frontend/app/workspace/widgets.tsx` | 数据接线（usage atom）、点击打开面板、面板内 Pin/Unpin、connection 透传 |

**Explicitly NOT doing (P0)**

- 不新增后端 RPC、不新增 SQLite 存储
- 不做 Context（当前 tab 终端 cwd）、系统快捷位置、终端 cwd 埋点
- 不改 `preview:pinned-directories` 的数据格式与右键 Pin 流程
- 不做跨设备同步（依赖配置文件既有能力）

**Local refactor safety**

- 删除的 `recentDirs` / `trackRecentDir` / `clearRecentDir` 已确认**全项目零调用点**（`grep -rn "trackRecentDir" frontend/` 仅命中定义处）。删除不改变现有行为 → 可用"删前后 `npm run test` 结果一致"证明无行为变化。
- `widgets.tsx` 的 `filesRecentDirs` 从 `useState` 换成 store 读取，属于同文件内替换，其唯一消费方是 `NewFilesFloatingWindow` 的 props。

## 2. Data Model

### 2.1 持久化格式（Go → TS）

```go
// pkg/wconfig/settingsconfig.go
type PathUsageEntryType struct {
	Path       string `json:"path"`
	Connection string `json:"connection,omitempty"` // "" = local
	Kind       string `json:"kind"`                 // "dir" | "file"
	Count      int    `json:"count"`
	LastAt     int64  `json:"lastAt"`               // unix ms
}
```

```go
// SettingsType 新增字段
PreviewPathUsage []PathUsageEntryType `json:"preview:path-usage,omitempty"`
```

```go
// metaconsts.go
ConfigKey_PreviewPathUsage = "preview:path-usage"
```

TS 侧得到 `SettingsType["preview:path-usage"]?: PathUsageEntryType[]`。

### 2.2 身份键（entry key）

`usageEntryKey(path, connection) = `${connection ?? ""}|${normalizedPath}``

- 同一路径 + 不同 connection = 两条独立记录（本地与远程隔离）。
- 归一化：去首尾空白、`~` 保持不变（保留用户语义）、统一 `\` → `/`、去掉尾随 `/`（根路径除外）。

### 2.3 噪音过滤

`isNoiseUsagePath(path)` 命中即不记录：

- 空串 / `~` 之外的纯符号
- `/tmp`、`/var/tmp`、`/private/var`、`/var/folders`
- 路径任一段为 `node_modules`、`.git`、`__pycache__`、`dist`、`.next`、`.cache`
- Windows 盘符根（`C:\`）与 `~` 允许

> 只做"明显噪音"，不做激进过滤，避免误杀用户真实目录。

### 2.4 记录归约（纯函数）

```ts
recordPathUsageEntry(entries, { path, kind, connection, now }) => PathUsageEntryType[]
```

- key 已存在：`count + 1`、`lastAt = now`、`kind` 以最新为准。
- 不存在：新增 `{count: 1, lastAt: now}`。
- 结果超过 `PathUsageMaxEntries (200)` 时按 `pathUsageScore` 淘汰最低分。
- 无变化（噪音/空）时返回原引用，调用方可据此跳过写入。

### 2.5 打分与选择

```ts
PathUsageHalfLifeMs = 14d
pathUsageScore(entry, now) = entry.count * 0.5 ** ((now - entry.lastAt) / PathUsageHalfLifeMs)
selectFrequentPaths(entries, limit=8, now) // 满足 count >= 2，按 score desc，取 limit
selectRecentPaths(entries, excludeKeys, limit=12) // 按 lastAt desc，剔除 excludeKeys
```

- Frequent 与 Recent **互斥去重**：Recent 排除 Pinned 与 Frequent 已展示的 key。
- Frequent 不足 3 条时不降级（避免"一次性访问"污染常用；宁缺毋滥）。

## 3. Frontend Modules

### 3.1 `path-usage.ts`（纯逻辑，无 jotai / 无 env / 无 react）

导出：

- 类型：`PathUsageKind`、`PathUsageEntryType`
- 常量：`PathUsageHalfLifeMs`、`PathUsageMaxEntries`、`PathUsageRecentLimit`、`PathUsageFrequentLimit`、`PathUsageMinFrequentCount`
- `normalizeUsagePath(path)`、`usageEntryKey(path, connection)`
- `isNoiseUsagePath(path)`
- `recordPathUsageEntry(entries, change)`
- `removePathUsageEntry(entries, path, connection)`
- `pathUsageScore(entry, now)`
- `selectFrequentPaths(entries, limit, now)`
- `selectRecentPaths(entries, excludeKeys, limit)`

纯函数 → 直接单测，不依赖 jsdom / electron。

### 3.2 `path-usage-store.ts`（状态与持久化）

```ts
import { atom } from "jotai";
import { getSettingsKeyAtom, globalStore } from "@/store/global";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";

// 单一事实源 = 配置；面板读取它，写入走 SetConfigCommand，配置回声驱动 UI 更新。
export const pathUsageAtom = atom<PathUsageEntryType[]>(
  (get) => get(getSettingsKeyAtom("preview:path-usage")) ?? []
);

export function recordPathUsage(path, kind, connection?): void
export function removePathUsage(selection): void
export function flushPathUsageWrites(): void   // 测试/卸载时立即落盘
```

- **写入节流**：模块级 `pendingEntries` + `timer`（`PathUsagePersistDebounceMs = 600`）。连续导航合并为一次 `SetConfigCommand`。
- **累加缓冲**：读当前值优先取 `pendingEntries ?? globalStore.get(pathUsageAtom)`，避免节流窗口内的多次记录互相覆盖。
- **回声收敛**：配置更新事件回来后 `pathUsageAtom` 与 `pendingEntries` 深度相等 → 清空 `pendingEntries`，避免抖动。
- 非 Tauri/预览窗口（`getSettingsKeyAtom` 返回 NullAtom）下记录为 no-op，不影响启动。

> 已知取舍（写入 PRD Non-Goals）：配置是 JSON 文件、每次落盘是整文件重写。P0 用 600ms 节流 + 200 条上限控制频率与体积；若后续路径量级增大，再迁移到 `pkg/filestore` 式的 SQLite store（P2）。

### 3.3 `path-panel-model.ts`（面板 view model，纯逻辑）

```ts
export type PathSelection = { path: string; connection?: string };
export type PathPanelRow = {
  key: string; path: string; connection?: string;
  kind: PathUsageKind; label: string; displayPath: string;
  count?: number; pinned: boolean;
};
export type PathPanelSection = {
  id: "search" | "pinned" | "frequent" | "recent";
  title: string; icon: string; rows: PathPanelRow[]; emptyHint?: string;
};

export function buildPathPanelSections(input: {
  pinnedDirs: PinnedDirectoryType[];
  usage: PathUsageEntryType[];
  query: string;
  now: number;
}): PathPanelSection[]
```

行为：

- `query` 非空 → 单块 `search`，把 pinned ∪ usage 去重后按 `path` 或 basename 做大小写不敏感子串匹配，按相关度（前缀 > 包含）排序，不做分区限流。
- `query` 为空 → `pinned` / `frequent` / `recent` 三块；各自 empty hint：
  - frequent: "Paths you use often will show up here."
  - recent: "Directories and files you open will show up here."
- `displayPath` 复用现有 `formatPath` 的中段省略策略（提取为纯函数放入本模块，`preview-new-files.tsx` 引用它，避免重复实现）。
- 键盘导航需要一个扁平行序列，故额外导出 `flattenPanelRows(sections): PathPanelRow[]`。

### 3.4 `preview-new-files.tsx`（面板重写）

Props 变化：

```ts
type NewFilesFloatingWindowProps = {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (selection: PathSelection) => void;
  referenceElement: HTMLElement | null;
  pinnedDirs: PinnedDirectory[];
  usageEntries: PathUsageEntryType[];
  onTogglePin: (selection: PathSelection, label?: string) => void;
  onRemoveUsage: (selection: PathSelection) => void;
};
```

渲染：

```
┌ Files ───────────────────────────┐
│ 🔍 search input                  │
│ ⭐ Pinned (n)                     │  行: label / path ; hover → Unpin
│ 🔥 Frequent (n)                   │  行: label / path / ×count ; hover → Pin, Copy path
│ 🕘 Recent (n)                     │  行: label / path ; hover → Pin, Remove
│ 🏠 Home                           │
└──────────────────────────────────┘
```

- 局部状态：`query`、`activeRowKey`。
- 键盘：input `onKeyDown` 处理 `ArrowDown/ArrowUp`（在 `flattenPanelRows` 上移动）、`Enter`（`onSelect` 当前行）、`Escape`（关闭；`useDismiss` 已处理，input 内需显式处理避免冒泡问题）。
- 行内按钮：`Pin/Unpin`、`Remove`、`Copy path`（`navigator.clipboard.writeText`），全部 `stopPropagation`。
- 视觉语言保持现有 Tailwind token（`modalbg/80`、`border-border/70`、`hover:bg-hoverbg`、`text-muted` 等），不引入新配色。

### 3.5 `preview-model.tsx`（记录埋点）

- **删除**：`recentDirs` atom、`trackRecentDir()`、`clearRecentDir()`（死代码）。
- **新增**：

```ts
private _pathUsageUnsub: (() => void) | null = null;

private recordCurrentPathUsage(): void {
    const rawFile = globalStore.get(this.blockAtom)?.meta?.file;
    if (isBlank(rawFile)) return;              // 只记录显式设置的路径，忽略 "~" 兜底
    const connection = globalStore.get(this.connectionImmediate) ?? undefined;
    fireAndForget(async () => {
        const finfo = await globalStore.get(this.statFile);
        const path = finfo?.path ?? rawFile;
        if (isNoiseUsagePath(path)) return;
        recordPathUsage(path, finfo?.isdir ? "dir" : "file", connection);
    });
}
```

- 构造函数尾部：先 `recordCurrentPathUsage()`（覆盖"新 block 打开文件"这一最常见路径），再
  `this._pathUsageUnsub = globalStore.sub(this.metaFilePath, () => this.recordCurrentPathUsage())`（覆盖后续导航）。
- `dispose()` 里 `this._pathUsageUnsub?.()`。
- 用 `statFile` 的 resolved path/isdir 决定 kind，避免依赖 `preview:pathisdir` 是否被写入（新建 block 打开目录时该 meta 不存在）。
- 只在 `metaFilePath` 变化时触发，`refreshVersion` 重刷不会重复计数。

覆盖性说明：`goHistory`（目录跳转）、`openPathInCurrentBlock`、`openPathInNewBlock`、`openPathInPreviewBlock` 都最终改 `block.meta.file` → 全部被覆盖。纯 tree 展开（不改 meta）不记录，符合预期。

### 3.6 `widgets.tsx`（接线）

- 删除 `filesRecentDirs` `useState`。
- `const filesUsageEntries = useAtomValue(pathUsageAtom);`
- `onSelect(sel)` → `env.createBlock({ meta: { view: "preview", file: sel.path, connection: sel.connection ?? "local" } }, false, true)`。
- `onTogglePin(sel, label?)` → 读 `filesPinnedDirs`，存在则移除、否则追加 `{ path, label: label ?? basename, addedAt: Date.now() }`，`env.rpc.SetConfigCommand(TabRpcClient, { "preview:pinned-directories": next })`。
- `onRemoveUsage(sel)` → `removePathUsage(sel)`。
- `handleWidgetSelect` 新增 `DefaultFilesWidgetId` 分支：`setFilesReferenceElement(e.currentTarget); setIsFilesWindowOpen(true);`（与 hover 打开一致），不再走通用 blockdef 创建。
- hover 逻辑保持不变。
- 现有 `onRemovePinned` 保留（面板 Unpin 走 `onTogglePin`，两者最终都写同一配置键 → 单一事实源）。

## 4. Cross-Layer Data Flow

```
preview 导航/打开
  → PreviewModel.recordCurrentPathUsage()            [frontend, ts]
  → recordPathUsage()  (path-usage-store.ts)          [纯逻辑归约 path-usage.ts]
  → pendingEntries + 600ms debounce
  → RpcApi.SetConfigCommand(TabRpcClient, { "preview:path-usage": entries })
  → 后端 SetBaseConfigValue → 校验 getConfigKeyType("preview:path-usage")  [pkg/wconfig]
  → 写入 settings.json → BroadcastConfigUpdate
  → fullConfigAtom 更新 → getSettingsKeyAtom("preview:path-usage") 变化
  → pathUsageAtom 重算 → widgets.tsx 重渲染 → 面板分区更新
```

跨层风险点：

1. Go 侧键必须注册，否则 `invalid config key` 且前端静默失败 → AC 用"重启后仍在"验证。
2. `convertConfigValue` 对 `[]PathUsageEntryType` 的转换：与既有 `[]PinnedDirectoryType` 同构，复用同一套反射路径，无需额外处理。
3. 多窗口：配置回声天然同步两个窗口的 `pathUsageAtom`（派生自同一 settings atom）。
4. 前端读的 `lastAt` 是 unix ms（int64），JS 秒级无精度问题。

## 5. Risks / Tradeoffs

| 风险 | 处理 |
|---|---|
| 每次导航写配置文件（整文件重写） | 600ms 节流 + 200 条上限；写不成功仅日志，不影响导航 |
| 死代码删除影响未知调用方 | 已 grep 确认零调用点；删前后跑全量测试对比 |
| kind 判定不准（目录被当文件） | 用 `statFile` 的真实 `isdir`，不用 meta 猜测 |
| `~` 兜底路径污染统计 | 只记录 `block.meta.file` 显式非空的值 |
| 面板行数过多 | Frequent/Recent 有 limit；搜索态不限但由子串过滤收敛 |
| 远程路径被当本地打开 | usage entry 携带 `connection`，`onSelect` 透传到 blockDef |

## 6. Validation Plan

- 单测：`path-usage.test.ts`（归一化/噪音/归约/衰减/上限/移除/去重）、`path-panel-model.test.ts`（分区/过滤/互斥去重/empty hint/键盘扁平化）。
- 类型：`npx tsc --noEmit`（等价 `task check:ts`）。
- 生成物一致性：`node scripts/run-task.mjs generate` 后 `git diff --stat` 只应出现预期生成文件。
- 全量：`npm run test`。
- 手工（仅当有 CDP Electron 环境）：hover/click 打开面板、Pin/Unpin、搜索、Esc；或按 AC1–AC10 走一遍。

## 7. Rollout / Rollback

- Rollout：纯前端 + 一个新配置键，无迁移。首次运行 `preview:path-usage` 缺失 → atom 返回 `[]` → 面板显示空状态提示。
- Rollback：`git revert` 该提交即可；残留的 `preview:path-usage` 配置键会被忽略（不影响任何既有功能）。
