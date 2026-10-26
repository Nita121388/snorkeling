# Implement — Tab 栏「更多」下拉

## 步骤

- [ ] 1. `frontend/app/tab/tab-more-model.ts`：`isTabHiddenFromBar` / `buildTabMoreRows` / `countHiddenRows` / `filterTabMoreRows`
- [ ] 2. `frontend/app/tab/tab-more-model.test.ts`：隐藏判定、顺序保持、计数、搜索过滤
- [ ] 3. `frontend/app/tab/tab-more-menu.tsx`：`TabMoreMenuTrigger` + `TabMoreMenuPanel`（floating-ui + FloatingPortal + useDismiss）、行组件、搜索框、操作区
- [ ] 4. `frontend/app/tab/tab-more-menu.dom.test.tsx`：点行激活、Esc/dismiss 关闭、搜索过滤、空态、关闭按钮
- [ ] 5. `vtabbar.tsx`：底栏拆双区；`forcedHover` state 并入 `isHidden` 链
- [ ] 6. `tabbar.tsx`：`+` 左侧插入触发器；`nonTabElementsWidth` 计入其宽度；`isMoreMenuOpen` 并入 `visibleTabIds`
- [ ] 7. preview：`vtabbar.preview.tsx` / `tabbar.preview.tsx` 增加 12+ Tab 溢出示例
- [ ] 8. 校验：`npx vitest run frontend/app/tab` + `npx tsc --noEmit -p tsconfig.json`（仅前端）

## 校验命令

```powershell
npx prettier --write frontend/app/tab/tab-more-model.ts frontend/app/tab/tab-more-menu.tsx
npx vitest run frontend/app/tab
npx tsc --noEmit -p tsconfig.json
```

## 回滚点

- 每个步骤一个可独立 revert 的最小单元；1–4 为纯新增，5–6 才触碰宿主，出问题时 revert 5/6 即可退回原行为。

## 验收

见 `prd.md` Acceptance Criteria。
