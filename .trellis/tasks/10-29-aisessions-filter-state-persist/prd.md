# PRD：AISessions 筛选状态持久化（Tab 切换 / 重开不丢）

## 背景

AI Sessions 的筛选条件全部存在 `AiSessionsViewModel` 实例的 jotai atom 上，除
`attachMode` / `sortChain` / `groupMode` 外都不落盘。

Tab 化 Block 组（`InlineTabBlock`）只挂载当前激活的子 block：
`frontend/app/block/block.tsx:1061` 用 `<SingleBlock key={activeBlockId}>` 渲染，
切走时旧块卸载 → `unregisterBlockComponentModel` + `viewModel?.dispose?.()`（`block.tsx:1324`），
切回来重新 `makeViewModel` 得到全新 VM，筛选 atom 回到默认值。

结果：用户配置好筛选（含已绑定的筛选方案）后切 tab 再切回，筛选被清空、方案绑定丢失；
关闭/重开 App 同理。已保存的方案本身在 localStorage 里，但需要手动重新套用。

## 目标

1. 每个 AI Sessions block 记住自己的筛选条件：切 tab、切页签、重开 App 后恢复。
2. 恢复"当前绑定的方案 id"，工具栏方案状态不再凭空变回「未绑定」。
3. 与筛选方案（presets）共用同一份快照口径与 sanitize 逻辑，避免两套字段。

## 非目标

- 不持久化瞬时状态：`query`（搜索词）、`pathFilter`（目录浏览位置）、`filtersOpen`、
  选中行/详情、多选集合、展开/折叠等 UI 临时态（与 presets 的口径保持一致）。
- 不改后端、不改 `InlineTabBlock` 的挂载策略（不为了保状态把所有 tab 常挂）。
- 不做跨 block 共享筛选（那是 presets 的职责）。

## 需求

### R1 存储位置

写入 block meta，键 `aisessions:filterstate:v1`，值为 JSON 字符串：

```json
{ "activePresetId": "<id|>", "filter": { source, markedFilter, dateRange, attachMode,
  tagPresence, tagFilters, excludeTags, pathSelections, pathExcludes } }
```

理由：block meta 随布局持久化，block 关闭即随之清理，不需要额外的 localStorage 垃圾回收。

### R2 恢复时机

`AiSessionsViewModel` 构造时（`restoreFilterState()`）先读 meta 并 set 各筛选 atom，
必须早于 view 里 `useEffect(() => model.loadSessions(), [model])` 的首次加载。

meta 缺失 / JSON 坏 / 字段非法 → 全量降级默认，绝不抛错。

### R3 写入时机

订阅 9 个筛选 atom + `activePresetIdAtom`，变更后 debounce（约 400ms）写回 meta；
内容与上次写入一致则跳过 RPC。`dispose()` 时清 timer、退订并 flush 一次。

`applyFilterPreset` / 「应用方案」经由同一套 atom 写入 → 自动落盘，无需额外调用。

### R4 兼容

无 meta 的老 block 行为不变（默认筛选），不写 meta 直到用户真正改筛选。

## 验收标准

1. 设置筛选（来源/标签/日期/目录/排除/星标）→ tab 化 → 切到别的 tab → 切回：筛选原样保留，
   列表结果一致。
2. 应用一个筛选方案后切 tab 再切回：`activePresetId` 仍在（工具栏显示该方案、dirty 判定正常）。
3. 重启 App 后该 block 的筛选仍保留。
4. 无 meta 的新 block 打开即默认筛选，且不产生 meta 写入。
5. 单测：`parseFilterStateMeta` 对 null / 坏 JSON / 混入非法枚举 / 非法数组的降级行为；
   快照 roundtrip 后 `filterPresetFilterEqual` 为真。
6. `npx tsc --noEmit`（前端）与 vitest 相关用例通过。
