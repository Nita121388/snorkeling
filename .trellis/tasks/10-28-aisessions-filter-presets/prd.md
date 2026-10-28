# PRD：AISessions 保存筛选方案（Filter Presets）

## 背景

AI Sessions 的筛选条件目前全部是 ViewModel 内的 jotai atom，除 `attachMode` 外不落盘，
用户配置好一组筛选（来源 + 星标 + 时间 + 标签 + 目录）后无法复用，每次刷新/重开都要重配。
本任务新增"筛选方案"：把当前一组筛选条件保存为具名方案，一键应用/切换/覆盖/删除/重命名。

## 目标

1. 能把当前筛选条件保存为具名方案（含可选排序链 + 分组模式）。
2. 工具栏一键应用方案，筛选 + 排序 + 分组一次性还原。
3. 支持覆盖、重命名、删除；方案被修改时有 dirty 指示。
4. 持久化到 localStorage，跨 block / 跨会话可见。

## 非目标（v1）

- 不做方案导出/导入、跨视图（AI Audit）方案。
- 不做方案排序拖拽 / 分组归类。
- 不改后端：方案纯前端快照，应用后走既有 `loadSessions` 链路。

## 需求

### R1 快照范围

纳入快照字段：
`source`、`markedFilter`、`dateRange`（含 custom from/to）、`attachMode`、
`tagFilters`、`excludeTags`、`tagPresence`、`pathSelections`、`pathExcludes`；
可选 `view`：`sortChain`、`groupMode`。

不纳入：`pathFilter`（浏览位置，不参与过滤）、`query`（瞬时搜索词）。

### R2 数据结构与存储

- `FilterPreset { id, name, createdAt, updatedAt, filter, view? }`。
- localStorage 键 `aisessions.filterPresets.v1`，存 JSON 数组。
- 读时逐字段 sanitize（复用 `sanitizeSortChain` / `normalizeSessionTags` / `normalizePathPrefix`），
  坏 JSON / 非法项 → 丢弃或降级默认，绝不抛错。
- 上限 `MaxFilterPresets = 30`，超出拒绝保存并提示。

### R3 ViewModel

- `filterPresetsAtom`、`activePresetIdAtom`。
- `captureCurrentFilter()`、`applyFilterPreset(preset)`、`saveFilterPreset(name, opts)`、
  `deleteFilterPreset(id)`、`renameFilterPreset(id, name)`。
- 应用方案 = 一次性 set 全部筛选 atom + 可选排序/分组 + `loadSessions()`，并写入 activePresetId。
- 沿用现有互斥约束（tag include/exclude、path include/exclude、untagged vs tagFilters）。

### R4 UI

- 工具栏 `Filters` 右侧新增 `fa-bookmark` 按钮 + 下拉面板：
  - 顶部"保存当前为方案…"（内联 popover 命名，Enter 保存，Esc 取消，空名拒绝；无激活筛选时禁用）。
  - 方案列表：点击应用；active 高亮圆点；dirty 时显示小圆环。
  - 每项 `⋯`：重命名 / 覆盖为当前 / 删除。
- Filters 徽标数字随方案应用同步。

### R5 边界

- 方案引用已不存在的 tag/路径仍可应用（后端返回空即可），不报错。
- 各 block 共用 localStorage，方案全局可见。
- 应用时面板关闭也生效。

## 验收标准

- [ ] 配好筛选 → 保存命名 → 清空筛选 → 应用方案，筛选/排序/分组全部还原。
- [ ] 修改筛选后对应方案显示 dirty；"覆盖为当前"后 dirty 消失。
- [ ] 重命名、删除生效并持久化；刷新页面（新 VM）方案仍在。
- [ ] 损坏 localStorage 时不崩溃，列表为空。
- [ ] 单测覆盖 sanitize / capture / apply / equal。
- [ ] `npx tsc --noEmit` 与相关测试通过。
