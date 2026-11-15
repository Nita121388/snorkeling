# VCS History 泳道提交图

## 背景

- 用户提供了两张参考截图（Git 客户端深色提交图风格），要求 VCS Block 的 History tab
  实现同款样式。
- 已按方案产出交互原型 `design/prototypes/vcs/vcs-history-graph/`（泳道布局算法 +
  三态截图 + 算法自测全绿），用户看过原型后拍板：**按原型落地实现**。
- 数据层现状：`VcsCommitInfo` 只有 hash/author/date/subject，无 parents/refs/email，
  画不了图。

## 需求

| # | 需求 | 说明 |
|---|---|---|
| R1 | 数据层扩展 | `VcsCommitInfo` 增加 `parents`（%P）、`refs`（%D）、`authoremail`（%ae）；git log 解析与两个调用点（Remote 区 incoming/outgoing + History 分页）共用 |
| R2 | 泳道布局算法 | 原型 `graph.js` 移植为 `frontend/app/view/vcs/graph-layout.ts`（纯函数，带单测） |
| R3 | History tab 重构 | 左侧泳道列（SVG 节点+贝塞尔连线，HEAD 节点光环）+ ref 徽章（HEAD→branch / origin / tag / branch，分支色与泳道一致）+ 作者头像（首字母色块）+ hash chip + hover 行尾动作 |
| R4 | 展开文件 | 保留点击展开；文件行加 ±行数统计（numstat）与状态色；展开块左缘泳道连线延续 |
| R5 | 保留现有能力 | keyword/since/until 过滤、分页、右键菜单（Copy Hash / Open on Remote）、remote 跳转按钮 |
| R6 | 降级 | SVN 无 parents/refs → 不渲染泳道列，退回纯列表；分页只按当前页切片计算泳道（翻页断线为已接受取舍） |

## 约束

- 不动 RPC 协议结构，只加可选字段（旧客户端/旧后端混布不炸）。
- 文案沿用 vcs 现行硬编码英文；i18n 迁移归 `11-14-i18n-rollout` P2 批次（main 尚无 i18n 基建，本任务不引入）。
- 样式走 Tailwind 工具类 + 现有 theme token，泳道色以内联 style 注入（分支绑定色）。

## 验收判据（可机器判定）

1. Go：`go test ./pkg/wshrpc/wshremote`（含新增 parseGitCommits 扩字段用例、commit files numstat 合并用例）→ exit 0
2. 前端：`npx vitest run frontend/app/view/vcs/graph-layout.test.ts` → exit 0（泳道唯一性/可达性/汇合保色/分页健壮）
3. `npm run check-types`（或项目等价 tsc 闸门）不抬高基线
4. 真机 Electron：`node scripts/verify/index.mjs` 对应 vcs area 跑通，截图入 verify-runs，结论入 `docs/project/verify-ledger.md`
5. 原型对照：泳道连线、HEAD 光环、ref 徽章、头像、展开统计与 `design/prototypes/vcs/vcs-history-graph/screenshots/` 一致
