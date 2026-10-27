# AISessions 节点悬浮卡修复：Close 失效与边界截断

## Goal

修复 AI 会话详情左侧批注时间线（AnnotationRail）里「Node 悬浮卡」（AnnotationCard）的两个缺陷，让卡片能正常关闭、且不再被容器边界裁剪。

## 背景 / 现状

- 悬浮卡由 `frontend/app/view/aisessions/annotation-rail.tsx` 渲染，`AnnotationCard`（`annotation-card.tsx`）展示锚点节点原文 + 该节点全部批注。
- 点击 rail 圆点会「钉住」卡片（`pinnedIndex`），鼠标 hover 也会打开（`openIndex`）。
- 实测两个问题：
  1. **点 Close 不关闭**：钉住后点卡片上的 ✕，卡片不消失，且 ✕ 自己消失。
  2. **边界处被截断**：卡片向外/向下伸出 rail 时被裁剪，视觉上被聊天列/滚动区切掉一截。

## Requirements

- **R1 关闭语义**：点卡片 `Close`（✕）后卡片必须立即、彻底关闭（三个打开态全部复位），且不应残留「半开」状态。
- **R2 边界不被裁剪**：卡片无论对准 rail 顶部、中部还是底部的节点，都必须完整可见，不被 `overflow` 容器裁切、不被聊天列盖住、不超出视口/详情区。
- **R3 定位合理**：卡片出现在节点右侧；节点靠下时卡片应向上翻转/夹取，避免长出底部。
- **R4 不回归既有交互**：钉住后移开鼠标不关闭；再次点击同一圆点仍能收起；Accept/Discard/编辑 Node 文本仍可用；rail 折叠/空态/批量草稿条/底部 inset 行为不变。
- **R5 不引入新依赖**，仅用 React + 现有工具类。

## Non-Goals

- 不改批注数据模型、RPC、AI 生成链路。
- 不改 rail 的视觉规范（圆点、竖轴、44px 宽度）。
- 不做全局弹层系统重构。

## Acceptance Criteria

- [ ] AC1：钉住卡片后点 ✕，卡片立即消失，且 `openIndex/pinnedIndex/hoverIndex` 均为空（可由 DOM 断言：卡片内 Accept 按钮消失）。
- [ ] AC2：把卡片对应节点定位在 rail 底部时，卡片仍完整可见（不被 `bodyRef` 的 `overflow-y:auto` 裁切）。
- [ ] AC3：卡片渲染在不再处于 `transform` 层叠上下文/滚动裁切容器内，`z` 序高于聊天列（结构断言或 DOM 层级断言）。
- [ ] AC4：现有 `annotation-rail.dom.test.tsx` 全部通过，并新增「点 Close 关闭」「卡片不在滚动容器内」回归用例。
- [ ] AC5：`npm run` 前端类型检查/lint 通过（按仓库脚本）。

## Notes

- 允许 PRD-only 之外的 design.md / implement.md——本任务涉及渲染结构调整，按 complex 处理。
