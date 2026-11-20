# Overview 看板卡片点击：整卡可点 + emoji/动作按钮独立热区

## 背景

11-08 b35075532 为挡动作按钮冒泡，把卡片 onClick 换成 `openCardFromTarget`（`event.target !== event.currentTarget` 即 return）。副作用：卡片内部所有内容（标题、头像、预览、Note、标签、属性、度量轨）全是子 span，点它们 target ≠ currentTarget，两层 onClick 全部丢弃 → 只有卡片裸内边距能开弹窗。实测复现（jsdom）：点标题 / 预览 / 头像，onOpenCard 0 次调用。诊断页：`docs/answers/overview-board-card-click-diagnosis-20261120.html`。

## 需求

R1 **默认整卡可点开弹窗**：卡片内容区（标题 / 预览 / Note / tags / 属性 / 度量 / 年龄 / chips）点击一律触发 `onOpenCard`；键盘 Enter/Space 行为不变。

R2 **独立热区不受整卡点击影响**，各走各的行为：

| 热区 | 行为 |
|---|---|
| emoji 头像 | 打开 AgentEmojiPicker（`openAgentEmojiPicker`，scope "session"），同 icon 再点一次关闭 |
| 动作按钮（定位 / 删除 / 关闭） | 各自既有回调 |
| 状态 chip（ack） | 既有 ack 行为 |

R3 判定方式：卡片根一个 click 处理器 + 热区白名单（button / a[href] / input / textarea / select / [contenteditable="true"] / [data-card-interactive]）。target 在热区内（不含卡片根本身）→ return；否则 `stopPropagation()` 后 `onOpenCard(card)`。删除 head 上的重复 onClick。动作区外层 span 的 `stopCardEvent`（含 mousedown）保留。

R4 emoji 头像独立交互的接入条件：`card.isAgentLike && provider !== ""`。为此 `OverviewBoardCard` 增加 `provider`（raw provider key，从 `OverviewBlock.agentProvider` 取，构建处在 session-overview.tsx `boardCards` useMemo）；不满足条件时仍渲染纯展示 span（点它走整卡开弹窗，不渲染死按钮）。

R5 **键盘双触发修复**：卡片根 `onKeyDown` 增加 `event.target !== event.currentTarget` 守卫 —— 现状在 emoji/动作按钮上按 Enter 会冒泡到根同时开弹窗。

R6 **选区保护**：`window.getSelection()?.isCollapsed === false` 时点击不开弹窗（拖选文本后松开的那一下不算点击）。

## 范围外

- 看板性能项（columns/columnKeys 不稳定导致每次渲染全量几何采样、15s/30s 周期性全板重渲）→ 另拆包。
- chips（tags/属性）将来若要独立点开（如筛选），届时再加 `data-card-interactive`，本包不动。
- 不改 block frame 冒泡链、不动弹窗本体与动画。

## 验收判据

- [x] 新增 DOM 回归用例（`overview-board-hotzones.test.tsx`，14 例，照 overview-board-jump.test.tsx 骨架）覆盖交互矩阵：
  - 点标题 / 预览 / 头像（无 provider 的卡）：onOpenCard 各 1 次；
  - 点 emoji button（有 provider 的卡）：picker 触发 1 次、onOpenCard 0 次；
  - 点动作按钮 / 状态 chip：各自回调 1 次、onOpenCard 0 次（既有用例不回归）;
  - 根节点 Enter：onOpenCard 1 次；emoji button 上 Enter：onOpenCard 0 次。
- [x] `npx vitest run frontend/app/session-overview --reporter=dot` 全绿（17 文件 / 244 例）。
- [x] `npx tsc --noEmit` 错误数不高于当前基线（58 < 69，本包 0 新增）。
- [ ] ~~真机验证：点卡片标题能开整卡弹窗；点 emoji 出 picker；动作按钮不误触（verify 台跑 overview 相关 area，台账入库）。~~
  **真机 skipped（2026-11-20，用户明确「本机性能不够，不需要真机验证」）**：`scripts/verify/overview-board/verify.mjs`
  已扩阶段 1a 五条判据（真实指针点标题开弹窗 / 点 emoji 头像开 picker 且不开弹窗 / avatar-btn 计数），
  待有环境时直接跑；台账已记 skipped 行。
