> **Confirmed: 2026-11-23 @nita**

# Overview 看板 Agent 卡跨 Tab 拖拽（拖到目标 Tab 组 = 移动块）

## Goal

Overview 看板卡片是 block 投影。把卡片拖到另一个 Tab 组（含折叠组头）松手，等价于把该 block 移到目标 Tab。
复用既有 layout 原语，不新增后端 RPC。

## Requirements

### 做什么

1. **拖起**：卡片主体可拖（内部 button/a/input/textarea/select/[contenteditable]/`[data-card-interactive]` 不启动拖拽）；
   拖起态视觉：半透明 + 目标高亮（沿用 token 色，不引入硬编码色值）。
2. **drop 热区**：
   - 每个 Tab 组头/列可作为 drop 目标，DOM 带 `data-drop-target` 与 tab id；
   - 折叠组的组头也必须是可命中热区（drop 后组计数 +1）。
3. **落点判定**：
   - 目标 tab ≠ 当前所处 tab → 调既有 layout 移动（`moveBlockBetweenInlineTabNodes` / layoutModel 现有 pendingDrop 流程 / 等价 store action）；
   - 目标 = 当前 tab 或空白处 → **0 次变更**（不发 RPC、不改任何 state）。
4. **点击保护**：拖拽位移超过阈值（建议 6px）后，松手不得触发卡片打开弹窗 / 内部按钮动作。
5. **单测** `frontend/app/session-overview/overview-board-drag.test.ts`（≥12 断言）：
   - A→B：`tab(B).blockids` 含该 block 且 +1、`tab(A).blockids` -1，块数守恒；
   - 拖到当前 Tab / 空白：0 次移动调用；
   - 折叠组头 drop 热区可命中（`data-drop-target` 存在 + 拖放后组计数 +1）；
   - 位移阈值：<6px 视为点击，≥6px 才进入拖拽。

### 不做什么

- 不新增后端 layout RPC，不改 `pkg/`。
- 不做跨 workspace / 跨窗口拖拽。
- 不改卡片信息架构（标题/头像/note/属性/度量）、不改弹窗打开逻辑本身。
- 不改 `overview-timeline` / 列表视图（只做看板卡 variant=card）。

## Acceptance Criteria

- [ ] `npx vitest run frontend/app/session-overview` → 全绿（`passed`，0 failed）
- [ ] `npx vitest run frontend/app/session-overview/overview-board-drag.test.ts` → 全绿，断言 ≥12
- [ ] `npx vitest run frontend/layout/lib` → 全绿（既有行为不回归）
- [ ] 红证：先写测试对现状必红，红输出存 `loop/red/N-1123-overview-drag.txt`，再实现转绿
- [ ] 越界文件 0 处（仅 touch 白名单内）

## Notes

- 判据「命令 → 期望输出」，期望是数字/字面量。
- 不提交、不记台账、不动看板（主 agent 收口）。
