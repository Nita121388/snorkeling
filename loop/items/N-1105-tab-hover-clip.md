---
id: N-1105-tab-hover-clip
title: "Tab 条悬停弹窗被截断（卡片贴视口边缘不做钳位）"
type: bug
priority: P1
status: open
origin: self
source: "nita 2026-11-05 截图"
task: 11-06-tab-hover-clip
order: 100
touch: [frontend/app/element/info-card/**, frontend/app/tab/tab.tsx]
rollback: null
budget: {minutes: 50, retries: 2}
releaseCandidate: false
createdAt: "2026-11-06T00:21:39Z"
---

# Tab 条悬停弹窗被截断（卡片贴视口边缘不做钳位）

## 背景

悬浮 workspace Tab 弹出的 info card 定位是 fixed top=rect.bottom+2 / left=rect.left，只做相对目标偏移，没有视口钳位与翻转：靠右/靠下的 Tab 把卡片顶出窗口被裁。

## 来源

- self：nita 2026-11-05 截图

## 验收判据

- [ ] `npx vitest run frontend/app/element/info-card/info-card-pos.test.ts` → `10 passed`
- [ ] `npx vitest run frontend/app/element/info-card/` → `33 passed`
- [ ] `npx vitest run frontend/app/tab/` → `65 passed`

判据核心：`isFullyInside(pos, card, viewport)` 对全部夹具恒真（靠右 Tab / 靠下目标 / right 贴右墙 / 窄窗口 / 卡片比视口还宽）。
校准三例：`legacyCardPos`（历史无钳位公式）在同一夹具上必须 `isFullyInside = false`，否则判据是瞎的。

## 记录

- 2026-11-05 定位根因：`useInfoCardHover.refreshCardPos` 只做相对偏移（bottom: top=rect.bottom+2/left=rect.left；right: left=rect.right+8），无视口钳位、无翻转。四个面共用该 hook：workspace Tab（tab.tsx）、block 内 tab（block.tsx）、block 侧栏（block-sidebar.tsx）、Tab 更多菜单行（tab-more-menu.tsx）。
- 修复：抽出 `info-card-pos.ts` 纯函数 `computeCardPos`（首选位 → 放不下翻对侧 → 仍不行夹进视口），hook 改为「挂载后实测尺寸 → layout effect 在 paint 前纠正坐标」。
