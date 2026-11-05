# 执行与进度板（每完成一步就地更新此文件）

> 规则：每完成一步，把对应行的 `[ ]` 改成 `[x]` 并在末尾追加一行日期+证据。
> 每个功能 5 步：实现 → 真实验证 → 审核 → push → 发版。全绿才进下一个功能。

## 功能 1 · 预览编辑验证台收尾（11-04-preview-edit-verify-harness）

- [x] 1.1 现场恢复：读 notes.md，确认 4eae261f 之后还剩什么（复跑验证 / Esc 判 overlay / 关重复块）
- [x] 1.2 真实验证：`run.mjs --attach --expect=fixed` 5/5 绿 ×3 轮；`--legacy-css --expect=broken` 4/5 红（paragraph 不受旧样式影响）
- [x] 1.3 子代理审核：trellis-check 复核；1 阻断 + 6 建议全部处理（新增 inline-style-parity 规则、clip 保真校验、clean-exit null 判定、degradedTrace 消费、marker border-left、raw png 清理）
- [x] 1.4 commit + push origin main（ec1e8189 / 373df140）
- [x] 1.5 发版 0.0.115：tag 已推，workflow run 41873041085 in_progress

## 功能 2 · 图片预览翻页（11-04-preview-image-paging）

- [x] 2.1 PRD + design 落盘（锚点解析/全序构建/缓存键/回滚开关）
- [x] 2.2 实现：image-pager-model.ts（纯逻辑）/ image-pager-index.ts（渐进索引）/ image-pager.tsx（UI）+ preview-model/preview-streaming 接线
- [x] 2.3 真实验证：单测 18/18、tsc 69 基线、真机 27/27 × 连续 3 轮（scripts/verify/image-pager/verify.mjs）
- [x] 2.4 子代理审核：4 阻断全修（截断死锁 / 5000 上限 / Home/End 错层 / Shift+R）+ 7 项建议
- [x] 2.5 commit + push（53ebc8d3）
- [x] 2.6 发版 0.0.116（tag 已推）

## 功能 3 · Overview 看板（11-04-overview-board-kanban）

- [x] 3.1 需求设计：按 agent 状态分列卡片墙（design.md 已定稿，含产品决策与回滚开关）
- [x] 3.2 实现：overview-board-model.ts / overview-board.tsx / 最小接线 / SCSS
- [x] 3.3 真实验证：真机 CDP 18 项 ×2 轮全绿（scripts/verify/overview-board/verify.mjs）
- [x] 3.4 子代理审核：无阻断；6 条建议全部处理
- [x] 3.5 commit + push（a314ca4d）
- [x] 3.6 发版 0.0.117（tag 已推）

## 功能 4 · Files 目录树 VCS 标记（11-04-files-vcs-tree-status）

- [x] 4.1 design 落盘（D 方案契约 + 性能预算逐条对齐）
- [x] 4.2 实现：纯函数层 + hook + 树/表双视图接入 + 全局 VCS 样式
- [x] 4.3 真实验证：真实 git 仓库 fixture，树/表 31/31 全绿（scripts/verify/vcs-tree-status/verify.mjs）
- [ ] 4.4 子代理审核 + 意见处理：无阻断；11 条建议已修 6 条，剩 3 条中等项（见任务 implement.md 交接文档）
- [x] 4.5 commit + push
- [ ] 4.6 发版 0.0.118（待接手，步骤在任务 implement.md）

## 进度日志

- 2026-11-04: 批任务骨架建立，4 个子任务挂入，进度板落盘。开始功能 1。
- 2026-11-04/05 功能 1 收尾：修 7 个验证台 bug（viewportSize 从未定义 / clip 产物二次裁成 1x1 / DPR 归一化 / Esc 空按 / marker 定位旧模式硬编码 / 1px 退化解 / 截图失败无诊断）+ 1 个产品崩溃（DOMRect 展开丢 top/height，含回归单测）+ 1 个截图污染（选区快捷按钮）。
  规则 09 改为结构化墨迹比较（旧逐像素比例在正常态与坏样本区间重叠，无法设阈值）；新增规则 10 词级内联样式 DOM 签名（已用合成样本证明可抓丢粗体/丢等宽/颜色变/标记被吞）。
  spec 落盘：`.trellis/spec/snorkeling-docs/frontend/preview-edit-harness.md`（含规则语义、盲区、标定记录、产品坑）。
- 2026-11-05 功能 2 完成：真机验证 27/27 ×3 轮。真机逼出并修复 5 个真问题：站点顺序按异步完成顺序（改确定性 DFS 先序）/ toast 因预览视图重挂丢失（改模块级 store）/ 跨站后本层误用锚点层（每站自带 images，本层=当前目录）/ 缩放守卫失效（onZoom 对程序化缩放不触发 → onTransformed）/ 跨站锚点塌缩（block meta 粘性锚点）。新增可复用真机验证脚本 scripts/verify/image-pager/verify.mjs。
- 2026-11-05 功能 2 交付：真机 30/30 ×2 轮；索引层 8 单测（含死锁回归）；审核 4 阻断修复。
- 2026-11-05 功能 3 交付：看板 85 单测 + 真机 18 项 ×2 轮；审核 6 建议全修（含多列断点从 720 改 1160、error 归入待我处理、普通 block 不生成空卡片）。
- 2026-11-05 功能 4 状态：实现完成、真机 31/31，未发版。交接文档落在任务目录 implement.md，另一台机器可直接接手。
