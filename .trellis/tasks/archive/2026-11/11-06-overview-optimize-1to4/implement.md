# Overview 优化 1-4 · 执行计划

> 依赖 `prd.md` + `design.md`。四个阶段顺序执行，每阶段一个独立 commit + 一次真机验证。

## 阶段 0 · 原型（先于任何代码）

- [ ] `design/prototypes/overview-card-click/index.html`
  - 三级栈演示：board 卡片 → 整卡（AgentHoverCard frameless）→ 会话详情；弹窗层叠与逐层关闭。
  - 演示「点卡片本体 vs 点卡内按钮」的 `stopPropagation` 行为。
- [ ] `design/prototypes/overview-group-views/index.html`
  - 目录视图列布局（含「无项目」尾列）；标签视图列布局（含多标签卡跨列 + 「无标签」尾列 + 跨列说明）。
- [ ] `design/prototypes/overview-board-v2/timeline-gantt.html` 加 G2.1
  - 真实分段（unknown / working / idle / done 相邻段留 1px 缝，段 3px、整条 4px 圆角）
  - `completedAt` 竖刻度 + hover `HH:MM 完成`
  - 顶部加一个「圆角 9px ⇄ 3px」切换，方便对比
- [ ] `design/prototypes/__REVIEW_GUIDE__.md` 登记三个原型

**验收**：三个 HTML 浏览器直开无报错；`__REVIEW_GUIDE__` 有对应条目。

## 阶段 1 · 点击语义

- [ ] 读 `session-note-section.tsx` 的 `variant` 分支，确认 §2.3 结论（已确认：死代码）
- [ ] `overview-board.tsx`：prop `onOpenSession` → `onOpenCard`（语义更准）
- [ ] `session-overview.tsx`：`onOpenSession` 拆成 `onOpenCard`（agent → AgentCardModal；非 agent → 跳 block）+ 保留 `onOpenDetail`
- [ ] `agentcardmodal.tsx`：加「打开会话详情」按钮（`data-agent-card-detail`，无 sessionId 时 disabled）→ `pushModal("AISessionDetailModal", { sessionId })`
- [ ] `agent-hover-card.tsx:308`：删死三元
- [ ] `scripts/verify/overview-board/verify.mjs` 新增 3 条断言（见 design §2.4）
- [ ] 跑验证 → `node scripts/verify/overview-board/verify.mjs`

**验证命令 → 期望**

```
npx vitest run frontend/app/session-overview      → passed
npx vitest run frontend/app/view/term             → passed
node scripts/verify/overview-board/verify.mjs     → 退出码 0，且 card-click-opens-agent-dialog / agent-dialog-has-detail-button / agent-dialog-detail-opens-session 三绿
```

**回滚点**：单 commit revert。

## 阶段 2 · 目录 / 标签分组

- [ ] `overview-board-model.ts`：
  - `OverviewBoardGroups` 加 `"project"` / `"tags"`
  - `OverviewBoardCardRef` 加可选 `projectName?: string` / `tags?: readonly string[]`
  - `groupOverviewCardsByProject` / `groupOverviewCardsByTags` + 分发器 `groupOverviewCards` 加两个分支
- [ ] `overview-board.tsx`：`group` prop 类型自动放宽（走 `OverviewBoardGroup`）
- [ ] `session-overview.tsx`：`<select>` 加两个 option；`boardCards` 补 `tags`
- [ ] `overview-board.test.ts` 新增分组用例（project 尾列 / tags 跨列 / untagged 尾列 / isOverviewBoardGroup）
- [ ] 真机 `overview-board`：加断言「切 project → 列头含项目名」「切 tags → 列数 = 唯一标签数 + (有 untagged ? 1 : 0)」
- [ ] **改既有断言**：`tags` 分组下列计数之和 ≥ 卡片数（多标签跨列），注明原因

**验证命令 → 期望**

```
npx vitest run frontend/app/session-overview                        → passed
node scripts/verify/overview-board/verify.mjs                       → 退出码 0，含 group-project / group-tags 断言
```

**回滚点**：单 commit revert；已存 `project` 的用户回滚后由 `persisted-enum` 自动回落 `status`。

## 阶段 3 · 卡片标签 + 迷你时间线

- [ ] `overview-board-model.ts`：新增纯函数 `resolveBoardTagChips(tags, max = 3)` → `{visible, hiddenCount}`
- [ ] `overview-timeline-model.ts`：新增 `buildTimelineSegments(row, history, opts)`（history 为 `undefined` 时退化为单段）
- [ ] `overview-board.tsx`：meta 行渲染 tags chip（`is-tag`）+ `+n`；卡片底部迷你条（`buildTimelineSegments` → 最近 12 段）
- [ ] `session-overview.scss`：`.session-overview-board-chip.is-tag`（令牌抄 `property-chip`）、`.session-overview-board-card-mini`（3px 高、2px 圆角、flex + gap 1px）
- [ ] 单测：`resolveBoardTagChips` 0/1/3/5；`buildTimelineSegments` 无历史/裁剪/缺口补 unknown
- [ ] 新验证台 `scripts/verify/agent-card-tags/`（照 `_template`）+ 登记 `scripts/verify/README.md`

**验证命令 → 期望**

```
npx vitest run frontend/app/session-overview                        → passed
node scripts/verify/agent-card-tags/verify.mjs                      → 退出码 0，chip 数 = min(tags,3)，+n 正确，卡高 ±2px
```

**回滚点**：单 commit revert（`tags` 是可选字段，`buildTimelineSegments` 纯新增）。

## 阶段 4 · 甘特重修

- [ ] `overview-timeline-model.ts`：`buildTimelineBar` 改返回 `{leftPct, widthPct, segments, completedPct}`；`tailPct` 标 `@deprecated` 保留一个版本
- [ ] `overview-timeline.tsx`：段渲染（`.bar-seg` + 段间缝）、完成点刻度（`.bar-completed`，`data-*` 供断言）、图例四项、tooltip 补 `HH:MM 完成`
- [ ] `session-overview.scss`：`.bar` `border-radius: 4px`、`.bar-seg` `3px`、`gap: 1px`、idle 中性灰实心、完成点竖线
- [ ] `overview-timeline-model.test.ts`：idle 末段宽 = `now − completedAt`（±0.5%）；working 段起点 = `activeSince`；`completedPct` 超窗 `null`
- [ ] 真机 `overview-timeline`：加断言 `segments >= 1`、`border-radius <= 4px`、`completed` 刻度存在
- [ ] `design/plans/overview-board-timeline.md` 更新：G2 记为「后端 ring buffer，另开任务」，A 方案残留局限写清

**验证命令 → 期望**

```
npx vitest run frontend/app/session-overview                        → passed
node scripts/verify/overview-timeline/verify.mjs                    → 退出码 0，含 bar-radius / bar-segments / bar-completed 断言
npx tsc --noEmit -p tsconfig.json | grep -c "error TS"              → <= 47
```

**回滚点**：单 commit revert（`tailPct` 还在，回滚渲染即回胶囊）。

## 收尾（阶段 4 之后一次）

- [ ] `docs/project/verify-ledger.md` 三行结论（overview-board / overview-timeline / agent-card-tags）
- [ ] `.trellis/spec/snorkeling-docs/frontend/quality-guidelines.md` 追加：
  - 「多值分组（tags）会跨列，列计数断言必须写 `>=`」
  - 「状态历史必须后端记，前端挂事件会漏段（`sameStatus` 排除 `ActiveSince`）」
- [ ] 阶段 3/4 踩到的新坑回写 `docs/project/ui-verify-playbook.md`
- [ ] 更新 `loop/items/` 与看板（若这批走 loop 门链）

## 风险闸门

| 关卡 | 触发条件 | 动作 |
|---|---|---|
| 阶段 1 真机断言被弹窗污染 | `.agent-dialog` 在 body 层，overview 断言 scope 到 block | 断言前后都 scope；测完先 `popModal` 再跑后续断言 |
| 阶段 2 既有断言失败 | `tags` 跨列打破「列计数 = 卡片数」 | 按计划显式改断言为 `>=` 并注明 |
| 阶段 4 圆角断言 | `border-radius` 是 computed style 百分比/px 差异 | 断言 `parseFloat <= 4`，不要字符串比对 |
| 任阶段 `tsc` 超基线 | 新增类型错误 | 立即停下修，不要「后面一起修」 |
