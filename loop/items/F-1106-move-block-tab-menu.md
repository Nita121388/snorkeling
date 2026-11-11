---
id: F-1106-move-block-tab-menu
title: "Move Block to Tab：菜单 4→1 条 + 弹窗内新建 / 每行双图标动作"
type: feature
priority: P1
status: released
origin: self
source: "2026-11-06T12:44:52Z"
task: 11-06-move-block-tab-menu
order: 40
touch: [frontend/app/tab/tab-target-modal.tsx, frontend/app/tab/tab-target-modal.test.tsx, frontend/app/tab/tab.scss, frontend/app/block/blockframe-header.tsx, frontend/app/block/blockframe-header.menu.test.ts, frontend/app/block/blockframe.tsx, frontend/app/view/preview/preview-model.tsx, frontend/app/view/aisessions/aisessions.tsx, scripts/verify/move-block-tab/**, scripts/verify/README.md, docs/project/verify-ledger.md, design/prototypes/move-block-modal-v3/README.md, design/prototypes/__REVIEW_GUIDE__.md]
rollback: "纯前端两次独立提交（modal 结构 / 菜单+覆盖）各自 git revert；无 feature flag，删新 prop 即回旧行为"
budget: {minutes: 150, retries: 2}
releaseCandidate: false
score: {value: 5, by: nita, at: "2026-11-08T13:16:07Z", note: null}
createdAt: "2026-11-06T12:44:52Z"
---

# Move Block to Tab：菜单 4→1 条 + 弹窗内新建 / 每行双图标动作

## 背景

block 菜单里「把 block 送到别的 tab」被拆成 4 条（Move/Copy × New/Existing）：两条「新建」立刻执行、tab 名字不可见，
两条「选择」才开弹窗而弹窗自己不能新建。同时这个入口只在接过 `appendBlockMoveMenuItems` 的五个视图里存在，
markdown 预览 / aisessions 等视图右键看不到，看起来像「只有 agent 块支持」。

## 来源

- self：nita 2026-11-06 会话 —— 「Move Block to Tab 这个功能我觉得不需要那么多菜单，用户选择 Move 后，
  支持选择和新建就行，而且现在只支持 agent Block 我觉得不合理」→ 「Move 和 Copy 可以直接改为两个 icon 按钮，
  不用 Tab 切换吧」
- 原型：`design/prototypes/move-block-modal-v3/`（▲ 设计活跃，自检 26/26）

## 验收判据

- [ ] `npx vitest run frontend/app/tab/tab-target-modal.test.tsx` → `11 passed`
- [ ] `npx vitest run frontend/app/block/blockframe-header.menu.test.ts` → `2 passed`
- [ ] `npx vitest run frontend/app/tab/ frontend/app/block/` → `238 passed`
- [ ] `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json | grep -c 'error TS'` → `47`
- [ ] `node scripts/verify/move-block-tab/verify.mjs` → `10/10`
- [ ] `node design/prototypes/move-block-modal-v3/selfcheck.mjs` → `26/26`

## 记录

_（待补）_
