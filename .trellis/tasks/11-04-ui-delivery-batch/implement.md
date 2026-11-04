# 执行与进度板（每完成一步就地更新此文件）

> 规则：每完成一步，把对应行的 `[ ]` 改成 `[x]` 并在末尾追加一行日期+证据。
> 每个功能 5 步：实现 → 真实验证 → 审核 → push → 发版。全绿才进下一个功能。

## 功能 1 · 预览编辑验证台收尾（11-04-preview-edit-verify-harness）

- [x] 1.1 现场恢复：读 notes.md，确认 4eae261f 之后还剩什么（复跑验证 / Esc 判 overlay / 关重复块）
- [x] 1.2 真实验证：`run.mjs --attach --expect=fixed` 5/5 绿 ×3 轮；`--legacy-css --expect=broken` 4/5 红（paragraph 不受旧样式影响）
- [x] 1.3 子代理审核：trellis-check 复核；1 阻断 + 6 建议全部处理（新增 inline-style-parity 规则、clip 保真校验、clean-exit null 判定、degradedTrace 消费、marker border-left、raw png 清理）
- [ ] 1.4 commit + push origin main
- [ ] 1.5 发版 0.0.115：bump → tag → push tag → workflow in_progress 确认

## 功能 2 · 图片预览翻页（11-04-preview-image-paging）

- [ ] 2.1 PRD + design 落盘（已确认交互见父 PRD；补代码级设计：锚点、全序构建、缓存键）
- [ ] 2.2 实现（worktree 或主线）
- [ ] 2.3 真实验证：单测 + tsc + CDP 真机翻页/下一站/边界反馈截图
- [ ] 2.4 子代理审核 + 意见处理
- [ ] 2.5 commit + push
- [ ] 2.6 发版 0.0.116

## 功能 3 · Overview 看板（11-04-overview-board-kanban）

- [ ] 3.1 需求设计：现状痛点 + Linear/Jira 式看板信息架构 + 原型对比，写入任务 design.md
- [ ] 3.2 实现
- [ ] 3.3 真实验证（含截图）
- [ ] 3.4 子代理审核 + 意见处理
- [ ] 3.5 commit + push
- [ ] 3.6 发版 0.0.117

## 功能 4 · Files 目录树 VCS 标记（11-04-files-vcs-tree-status）

- [ ] 4.1 design 落盘（基于 design/prototypes/files-vcs-tree-status 的 D 方案与性能预算）
- [ ] 4.2 实现
- [ ] 4.3 真实验证：真实仓库目录（本项目自身）M/U/D 与文件夹计数正确性 + 截图
- [ ] 4.4 子代理审核 + 意见处理
- [ ] 4.5 commit + push
- [ ] 4.6 发版 0.0.118

## 进度日志

- 2026-11-04: 批任务骨架建立，4 个子任务挂入，进度板落盘。开始功能 1。
- 2026-11-04/05 功能 1 收尾：修 7 个验证台 bug（viewportSize 从未定义 / clip 产物二次裁成 1x1 / DPR 归一化 / Esc 空按 / marker 定位旧模式硬编码 / 1px 退化解 / 截图失败无诊断）+ 1 个产品崩溃（DOMRect 展开丢 top/height，含回归单测）+ 1 个截图污染（选区快捷按钮）。
  规则 09 改为结构化墨迹比较（旧逐像素比例在正常态与坏样本区间重叠，无法设阈值）；新增规则 10 词级内联样式 DOM 签名（已用合成样本证明可抓丢粗体/丢等宽/颜色变/标记被吞）。
  spec 落盘：`.trellis/spec/snorkeling-docs/frontend/preview-edit-harness.md`（含规则语义、盲区、标定记录、产品坑）。
