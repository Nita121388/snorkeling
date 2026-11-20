---
id: N-1120-aisessions-detail-binding-mismatch
title: "AI 会话详情块绑定错位：打开的详情常常不是列表里点的那一行"
type: bug
priority: P1
severity: S2
solution: fixed
status: open
origin: self
source: "nita 2026-11-20：列表块双击第 N 行打开的详情块常显示别的会话；Agent TUI Block 右键 Open Session Detail 同样。上一轮修了后端精确 id 匹配与 origin 传递，本轮定位在前端详情块挂载解析"
task: 11-20-aisessions-detail-binding-mismatch
order: 100
touch: [frontend/app/view/aisessions/**, scripts/verify/aisessions-detail-binding/**, .trellis/tasks/11-20-aisessions-detail-binding-mismatch/**, docs/project/verify-ledger.md, scripts/verify/README.md, loop/**]
rollback: "git revert 单提交；三处改动（回落分流 / seq 守卫 / 渲染归属）彼此独立可单独 revert"
budget: {minutes: 90, retries: 2}
releaseCandidate: false
createdAt: "2026-11-20T03:30:00Z"
---

# AI 会话详情块绑定错位：打开的详情常常不是列表里点的那一行

## 背景

详情块（带 `aisessions:sessionid` 的 aisessions 块）挂载后，`loadSessions` 的收尾
回落分支**没有 else**：绑定会话即使解析成功，也会被 `列表第一行` 覆盖；解析失败时
同样静默改绑到第一行。因为 `selectedKey` 从此落在列表内，后续 60s 自动刷新永不
自愈 → 粘死在错误会话上。列表双击与 Agent TUI 右键两条入口共用该逻辑，所以都中。

另有两个同源洞：`loadDetailById` 无 seq/选中守卫（慢响应覆盖用户刚点的行）；
切换期间旧正文照常渲染（`loading` 只在 detail==null 时显示）。

## 来源

- self：nita 2026-11-20 反馈，两条入口（列表双击 / Agent TUI 右键）复现

## 修法

- `detail-binding.ts`（新增纯函数）：`detailFallbackDecision`（绑定块永不回落第一行）、
  `shouldCommitDetailLoad`（最新响应才提交）、`detailBelongsToSelection`（归属判定）。
- `aisessions.tsx`：回落分支按绑定分流；`loadDetailById` 补 seq 守卫；面板 detail
  prop 归属不符传 null（骨架）；绑定块孤儿 id 清绑后记 `boundDetailLost`，后续刷新
  也不回落。
- `session-detail.tsx`：面板根加 `data-detail-session-key` 机器验证钩子。
- 验证台：`scripts/verify/aisessions-detail-binding/`（真实指针双击 → 断言面板 key
  逐字等于被点行、不等于列表第一行）。

## 验收判据

- [x] `npx vitest run frontend/app/view/aisessions/detail-binding.test.ts` → passed（修前规则红证对照锁死）
- [x] `npx vitest run frontend/app/view/aisessions` → 818/818 passed
- [x] `npx tsc --noEmit -p tsconfig.json` → 61 既有错误，本包三文件 0 新增
- [~] 真机验证台 `node scripts/verify/aisessions-detail-binding/verify.mjs` → **skipped**（用户 2026-11-20 明确本机性能不够，暂不做真机；脚本已备待跑）

## 记录

- 2026-11-20：根因三洞确认（缺 else 的回落 / 无守卫的 loadDetailById / 旧正文渲染）；
  纯函数红证 14 条全绿；全量 aisessions 回归 818/818；tsc 0 新增。
- 2026-11-20：真机验证台已写好并登记（`scripts/verify/aisessions-detail-binding/`），
  但**用户明确暂不做真机**（本机性能不够）；判据由单测 + 红证对照锁定，台子留待以后跑。
