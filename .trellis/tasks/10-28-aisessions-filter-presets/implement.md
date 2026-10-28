# Implement：AISessions 保存筛选方案

## 1. 纯函数与存储

- [x] 新建 `frontend/app/view/aisessions/filter-presets.ts`
  - 类型、键、上限常量
  - `sanitizeFilterPreset` / `sanitizeFilterPresetList`
  - `readFilterPresets` / `writeFilterPresets`
  - `filterPresetFilterEqual` / `filterPresetViewEqual` / `filterPresetIsDirty`
- [x] 新建 `filter-presets.test.ts` 覆盖上述函数

## 2. ViewModel

- [x] `aisessions.tsx`：`filterPresetsAtom`、`activePresetIdAtom`
- [x] `captureCurrentFilter` / `captureCurrentView`
- [x] `applyFilterPreset` / `saveFilterPreset` / `deleteFilterPreset` / `renameFilterPreset`

## 3. UI

- [x] 新建 `filter-preset-menu.tsx`（触发按钮 + 下拉 + 命名 popover + 每项菜单）
- [x] `aisessions.tsx` 工具栏挂载（Filters 后），计算 dirty / canSave
- [x] 样式与现有按钮一致；outside-click 关闭

## 4. 验证

```bash
cd frontend && npx tsc --noEmit
cd .. && node scripts/run-task.mjs test-frontend-unit   # 或局部 jest filter-presets
```

- [ ] 手动：保存/应用/覆盖/重命名/删除/刷新持久化/dirty 指示（待用户在运行中的 app 验证）
