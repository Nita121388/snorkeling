# 批注时间线 UI（左 rail + 编辑器 + 跳转）

> 父任务：`10-25-aisessions-annotation-timeline`。阶段拆解见父任务 `implement.md` 子任务 2。

## Goal

在会话详情左侧给出批注时间线，让「回看一个 AI 处理过程」时能一眼看到自己标过哪些节点，并能立刻跳回去。本子任务**只做前端，不修改 `pkg/`**。

## Requirements

### 左 rail（2026-10-26 视觉重构，见 design.md）

- 折叠 16px（视觉 12）/ 展开 44px，点击空白 toggle，偏好 localStorage。
- **只画有批注的节点**；节点是**圆点**（非横向药丸），三态：accepted 实心圆 / draft 空心环 / orphan 警告色。
- 2px 竖轴贯穿全高；少节点按 seq 等比铺满，多节点固定 28px 间距 + 内部滚动。
- **不再复用** `session-outline-rail` 的横向药丸语言（要与信息条视觉区分）；dock 放大改为圆点缩放。
- 空态：rail 淡竖线 + 展开时显示「✨ 生成时间线」入口。
- 点击圆点 = 跳转 + 钉住悬浮卡（沿用 `74430cbb` 的 pinned 行为）。

### 弹窗不透明

- 悬浮卡与批注编辑器背景必须是实色，不得出现 `/20` `/30` / `backdrop-blur` 等透明修饰。

### 悬浮卡

- hover 150ms 出卡，宽 320，右缘对齐 rail。
- 内容：节点原文前 120 字（尾部渐隐）+ 该节点全部批注（标题/正文/标签/来源徽标）。
- `max-height: 60vh`，内部滚动。

### 跳转

- 点击刻度 → `seqToIndex(seq)` → 既有虚拟滚动 `scrollToIndex` → 目标行 1200ms flash。
- 目标在折叠区（subagent / details）先展开再跳。
- 目标 DOM 不存在时用 `initialOffset` 兜底 + 下一帧校正，与 `10-21-aisessions-detail-virtual-scroll` 的实现一致，不另造。

### 编辑器

- 入口：消息卡 hover 出 `🏷 N ▾`；右键菜单「添加备注…」。
- 字段：类型 chips（note/milestone/decision/question）、标题、正文（复用 `wysiwyg-editor.tsx`）、标签 chips（复用 `session-tag-chips.tsx`）。
- 保存 / 取消 / 删除；一条消息可多条批注。
- **Modal 必须处理焦点冒泡**：参照 `10-24-aisessions-note-dialog` 的结论，block 内 modal 不能把点击冒泡到 block frame 抢焦点。

### 单向耦合

rail → 消息流单向。不做滚动反向高亮 rail。唯一允许的反向信号是「视口上方还有 N 条批注」。

## Acceptance Criteria

- [ ] 任意消息可加批注，保存后 rail 出现刻度
- [ ] 点击 rail 刻度跳转准确，目标高亮 1200ms 后消失
- [ ] >2000 消息的会话：rail 滚动、hover、跳转均无卡顿（FPS 不掉）
- [ ] 折叠区目标能自动展开后跳到位
- [ ] 编辑器输入正常，不会因冒泡失焦；保存后角标与 rail 同步更新
- [ ] 关闭详情页再打开，批注按原节点显示
- [ ] orphan 条目显示黄条 + 「重新指定 / 删除」，不静默消失
- [ ] `npx vitest run frontend/app/view/aisessions` 全绿
- [ ] `git status` 只出现 `frontend/` 下的改动

## 明确不做

- AI 生成（属 `aisessions-annotation-ai`）
- 跨会话 Block 与导出（属 `aisessions-annotation-export`）
- 字符区间级批注（属 `10-19-aisessions-annotate`）
- 修改 `pkg/` 或任何 provider 会话文件
