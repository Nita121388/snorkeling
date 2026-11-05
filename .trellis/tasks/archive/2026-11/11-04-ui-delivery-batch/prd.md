# UI 交付批：预览验证台 / 图片翻页 / Overview 看板 / Files VCS 标记

## Goal

按固定顺序交付四项功能。每项独立走完「实现 → 完整验证 → 子代理审核 → commit+push → 单独发版」，互不阻塞下一项的启动。

## 交付清单（按执行顺序）

| # | 任务 | 状态 | 发版号 |
|---|---|---|---|
| 1 | `11-04-preview-edit-verify-harness` 预览编辑验证台收尾 | 待收尾 | 0.0.115 |
| 2 | `11-04-preview-image-paging` 图片预览翻页 | 待开发 | 0.0.116 |
| 3 | `11-04-overview-board-kanban` Overview 看板化 | 待设计+开发 | 0.0.117 |
| 4 | `11-04-files-vcs-tree-status` Files 目录树 VCS 标记 | 待开发 | 0.0.118 |

## 每项的验收（共同门槛，缺一不算完成）

1. **实现完整**：功能按子任务 PRD 全量落地，不留「下版本补」的口子
2. **真实验证**：单测全绿 + tsc 0 错 + 真机 CDP 验证（`scripts/inspect-electron-ui.mjs` / `scripts/verify/preview-edit/run.mjs`，涉及 UI 的必须截图留证）
3. **子代理审核**：`trellis-check` 独立复核（不复用实现上下文），审核意见全部处理或说明
4. **提交推送**：commit → push origin main
5. **发版**：按 snorkeling-release skill 流程 bump + tag + push tag，确认 workflow 起跑、产物挂上

## 用户已确认的设计决策

- 图片翻页：默认**只翻本层**；顺序**跟随目录预览当前排序**（所见即所得）
- 「下一站」= 目录树全序中下一个含图片的文件夹；**单击进入**（不用双击/Ctrl，双击已被缩放占用、Ctrl 已被「新块打开」占用）
- 键盘：`←/→` 本层翻页，`Shift+←/→` 跨站，`Home/End` 首尾
- Files VCS：D 方案（文件名着色 + 行尾 M/U/D；文件夹行尾数量；干净静默）
- Overview 看板：PRD 原为 TBD，设计先行，产出原型对比后落地

## 非目标

- 不动 45 个旧任务的归档/清理（那是另一条线，等用户批复）
- 不做图片翻页的设置项（循环/按时间排序，后续再说）
- 不做 VCS 状态的逐行懒加载 RPC（必须一次 RPC 拿全）
