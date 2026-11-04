# 执行清单 — 图片预览翻页

## 实现

- [x] `image-pager-model.ts`：白名单 / 噪音目录 / 排序比较器（逐位复刻 TanStack）/ 序列构造 /
      站点 DFS 先序 / resolvePager（本层=当前目录）/ 模块级 toast store
- [x] `image-pager-index.ts`：渐进索引（本层优先）+ 并发 3 DFS + 三重上限（图片 5000 / 深度 8 /
      目录 500）+ 逐层截断 + 缓存 TTL 60s（stale-while-revalidate）+ 代际令牌取消 + 缓存条目上限 24
- [x] `image-pager.tsx`：‹/› 计数、「下一站/上一站」条目、↻ 与 Shift+R 重建、边界提示、toast、
      键盘 ←→ / Shift+←→ / Alt+←→ / Home/End（用当前本层）
- [x] `preview-model.tsx`：`imageScale` atom、`openPathInNewTab`、`setBlockMetaValue`
- [x] `preview-streaming.tsx`：挂载 ImagePager，`onTransformed` 同步 scale（程序化缩放也触发）
- [x] 粘性锚点（block meta `preview:image-pager-anchor`）+ 有效性校验（不在锚点树下则忽略）

## 验证

- [x] 纯逻辑单测 18/18（含 21×21 与 TanStack alphanumeric 全对撞）
- [x] 索引层单测 8/8（含 B1 截断死锁回归、B2 单站上限回归、目录数上限、失败跳过、缓存/失效）
- [x] tsc 69 基线（新增代码 0 错误）
- [x] 真机 CDP 验证 `scripts/verify/image-pager/verify.mjs`：27 项 × 连续 3 轮全绿
- [x] 审核（trellis-check）：4 阻断（截断死锁 / 上限未执行 / Home/End 错层 / Shift+R 缺失）全部修复

## 发版

- [x] commit + push（53ebc8d3 / e2263ac8）
- [x] 发版 0.0.116（tag 已推，workflow 起跑）
