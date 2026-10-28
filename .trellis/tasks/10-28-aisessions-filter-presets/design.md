# Design：AISessions 保存筛选方案（Filter Presets）

## 边界

全部为**前端纯增量**，不改后端、不改现有过滤逻辑。唯一"侵入"点：
- 工具栏新增一个按钮 + 挂载新组件；
- ViewModel 新增 atom + 方法（应用方案时复用同一批 setter）；
- 新增一个纯函数模块 `filter-presets.ts`（含存储与快照工具），便于单测。

## 数据模型（`filter-presets.ts`）

```ts
export type FilterPresetFilter = {
    source: SourceFilter;
    markedFilter: MarkedFilter;
    dateRange: DateRangeFilter;
    attachMode: AttachMode;
    tagFilters: string[];
    excludeTags: string[];
    tagPresence: TagPresenceFilter;
    pathSelections: string[];
    pathExcludes: string[];
};

export type FilterPresetView = {
    sortChain: SessionSortChain;
    groupMode: SessionGroupMode;
};

export type FilterPreset = {
    id: string;
    name: string;
    createdAt: number;
    updatedAt: number;
    filter: FilterPresetFilter;
    view?: FilterPresetView;
};

export const FilterPresetsStorageKey = "aisessions.filterPresets.v1";
export const MaxFilterPresets = 30;
export const MaxFilterPresetNameLength = 40;
```

纯函数：
- `sanitizeFilterPreset(raw: unknown): FilterPreset | null`
- `sanitizeFilterPresetList(raw: unknown): FilterPreset[]`（去重 id、截断上限）
- `readFilterPresets(): FilterPreset[]`
- `writeFilterPresets(list: FilterPreset[]): void`
- `captureFilterPresetFilter(...)` 由 VM 直接构造（依赖 atom 读取，放在 VM 里）
- `filterPresetFilterEqual(a, b): boolean`（集合排序无关比较，复用 tagsEqual/pathSelectionsEqual 语义）
- `filterPresetViewEqual(a?, b?): boolean`
- `filterPresetIsDirty(preset, currentFilter, currentView): boolean`

存储容错：`readFilterPresets` try/catch → `[]`；写入超上限由调用方（VM）拦截。

## ViewModel（aisessions.tsx）

atom：
- `filterPresetsAtom = jotai.atom<FilterPreset[]>(readFilterPresets())`
- `activePresetIdAtom = jotai.atom<string>("")`

方法：
- `captureCurrentFilter(): FilterPresetFilter` — 从 atom 读当前值。
- `captureCurrentView(): FilterPresetView` — sortChain + groupMode。
- `applyFilterPreset(preset)`：
  - `globalStore.set(loadingAtom, true)`；
  - 按互斥规则 set：先 tag 三件套、path 两件套、其余单值；再 view（有则 set sortChain/groupMode）；
  - set `activePresetIdAtom`；`void this.loadSessions(false, ...)`。
- `saveFilterPreset(name, { overwriteId? })`：trim + 校验名与上限；overwrite 则替换并刷新 updatedAt；否则 push 新项（id = crypto.randomUUID 兜底）；写盘。
- `deleteFilterPreset(id)`：过滤后写盘；若删的是 active 则清空 active。
- `renameFilterPreset(id, name)`：改名 + updatedAt + 写盘。
- `clearAllFilters()` 已存在，应用后不改它。

## UI（`filter-preset-menu.tsx`）

Props：`presets`、`activePresetId`、`dirty(activeId)`、`canSave`（当前 hasActive）、
`onApply`、`onSaveNew`、`onOverwrite`、`onRename`、`onDelete`。

- 触发按钮：`fa-bookmark`，与现有按钮同款样式；有方案时角标（active 命中显示实心，否则显示数量）。
- 下拉面板：`absolute` 定位、`z-index` 足够；点击外部关闭（复用项目内既有 dropdown 模式或简单 outside-click）。
- 保存 popover：内联 input + Save/Cancel。
- 每行：名称（点击应用）+ 右侧 `⋯` 菜单（重命名/覆盖为当前/删除）。
- 空列表占位文案 + 只有"保存"入口。

接入位置：`aisessions.tsx` 工具栏 `Filters` 按钮后、`SortMenu` 前。

## 测试

`filter-presets.test.ts`：
- sanitize：合法/缺字段/非法类型/id 去重/超上限截断/坏 JSON。
- equal：集合顺序无关；dateRange custom from/to；view 缺省等价。
- dirty：filter 或 view 变化即 dirty；一致则 not dirty。

## 回滚

纯新增文件 + 工具栏一行挂载；回滚 = 移除挂载 + 删除新文件，无数据迁移风险。
