# 执行计划：文件夹索引徽标（N-1124-folder-index-badges-2）

## 前置

- G1（人签 PRD）+ G2（红证，已登记）清 → 才能 `queue run --emit-pick`。
- 红证：`loop/red/N-1124-folder-index-badges-2.txt`（三测试文件全红）。

## 步骤（每步有可跑判据）

1. **模型层**：实现 `folder-index-model.ts`（STATUS_DEF / parseIndexDoc / normalizeDeco / mergeDecorations / BadgeDeco）。
   验证：`npx vitest run frontend/app/view/preview/folder-index/folder-index.test.ts` 全绿。
2. **meta 层**：实现 `folder-index-meta.ts`。
   验证：`npx vitest run frontend/app/view/preview/folder-index/refresh.test.ts` 全绿。
3. **树渲染**：`treeview.tsx` 加 `TreeNodeData.badge?` + 导出 `TreeNodeBadge` + 行内插入位点。
   验证：`npx vitest run frontend/app/treeview/treeview-badge.test.tsx` 全绿。
4. **脚本沙箱**：`folder-index-worker.ts`（Blob → Worker，5s 超时，单条 try/catch，坏语法=脚本源空）。
   验证：模型测试补一条坏脚本用例（在 1 的测试文件内）。
5. **provider 接线**：`folder-index-provider.ts` + `preview-explorer.tsx`：meta 开才读两源、装饰写进节点、revision 缓存、
   meta `preview:idxrefresh` 变化触发重算。
   验证：刷新用例（refresh.test.ts 的 revision 契约）+ 现有 preview 测试不回归。
6. **开关入口**：Files block 菜单加「索引徽标」开关（写 meta）；缺省关。
   验证：手动 `wsh setmeta -b <id> preview:idxbadges=on` 与菜单两条路径等效（真机）。
7. **整体判据**：`node loop/... queue prove --id N-1124-folder-index-badges-2` 4 条全绿。
8. **真机验收（G7，人）**：示例目录 6 徽标 / 开关关 0 徽标 / setmeta 刷新 2s 生效。

## 校验命令

```bash
npx vitest run frontend/app/view/preview/folder-index/ frontend/app/treeview/treeview-badge.test.tsx
npx tsc --noEmit 2>&1 | grep -E "folder-index|treeview-badge" | wc -l   # → 0
node E:/primary/projects/loop/bin/loop.mjs queue prove --id N-1124-folder-index-badges-2 --root .
```

## 回滚点

- 每步是独立文件，逐步提交；回滚 = 删新目录 + 还原 `preview-explorer.tsx` / `treeview.tsx`。
- 开关关 = 运行时也可回滚（无代码回滚需求）。
