# 执行计划

## 前置

- 原型已评审：`design/prototypes/overview-dashboard/agent-card-metrics/`（变体 A 定稿，实测卡高 129.0 → 150.0）
- 口径三条已确认：消息数 = `messageCount`；总运行时间 = Σ working 段；落点 = 看板卡 + 列表行

## 步骤

### 1. 数据层（无 UI）

- [x] `overview-board-model.ts`：`OverviewBoardCard` 增 `messageCount?` / `size?` / `createdAt?`。
- [x] `session-overview.tsx` 的 `boardCards` useMemo：从 `summary` 填三项（`summary?.messageCount` / `summary?.size` / `summary?.createdAt`）。
- 注意：**不读 segments、不传 runMs**（口径已改为活跃跨度，见 prd 的修正说明）；活跃跨度在组件里由 `createdAt/updatedAt/live/now` 派生。
- 验证：`grep -n "runMs" frontend/app/session-overview/` 无输出。

### 2. 纯逻辑 + 单测（先红后绿）

- [ ] 新建 `frontend/app/session-overview/session-metrics.ts`：
  - `buildSessionMetrics(data): SessionMetricsView`（纯函数，无 React）
  - 处理：阈值档位、`≥10000` 缩写、`formatFileSize` 去空格、占比 `max(2, round(density*100))`、日期跨年
- [ ] 新建 `session-metrics.test.ts`，覆盖 prd 验收标准第 1 条的五组用例。
- 验证：`node scripts/run-task.mjs test-frontend -- session-metrics`（或仓库既有 vitest 命令）全绿。

### 3. 组件

- [x] `session-metrics.tsx`：`<SessionMetrics surface=… />`，全缺返回 `null`，每格带 `data-metric` / `title` / `aria-label`。
- [x] `overview-board.tsx` `BoardCard`：在 `card.note` 之后、mini timeline 之前插入；包一层 `.session-overview-board-card-data`；
      props 传 `messageCount={card.messageCount} size={card.size} createdAt={card.createdAt} updatedAt={card.updatedAt} live={card.live} now={now}`。
- [x] `overview-board.tsx` `.session-overview-board-card-age`（实际落在 `overview-board-model.ts` 的 `formatBoardAgeTitle`）：补 `title` + `aria-label`（`最后活动：… · 1天前` / `刚刚`）。
- [x] `session-overview.tsx` `BlockRow`：右侧接入 `surface="row"`（数据来自本地已有的 `summary`）。
- [x] `OverviewBoardCard` 还需带 `live`（`summary?.live === true`）：live 卡的跨度要走到 `now`，否则会停在最后一条消息时刻。

### 4. 样式

- [x] `session-overview.scss`：`.session-metrics` / `.session-metric*` 一套（board / row 两个修饰符）；
      暗色 / 亮色 / **monochrome 主题**三套 token 都要看一眼（`11-06-monochrome-degloom` 教训：语义色在单色主题下要压深提彩）。
- [x] 检查 `rgb(from var(--main-text-color) r g b / …)` 相对色写法与既有卡样式一致。

### 5. 验证

> **2026-11-09 决定：真机验证由用户自己跑**（本会话环境起不来实例：Vite 冷启动 3 分钟 + 并发 agent 同时改
> frontend 导致 renderer 空壳，见 `docs/project/ui-verify-playbook.md` 的 2026-11-08 踩坑记录）。
> 断言脚本已写好并 `node --check` 通过，但**本轮未跑通**，需要用户跑一次。

- [ ] `scripts/verify`：在 overview area 断言
  - 220px 列宽 `.session-metrics` `scrollWidth === clientWidth`
  - `.session-overview-board-card-age[title]` 匹配 `/最后活动：\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/`
  - 有数据卡与无数据卡的 `.session-metrics` 数量差 = `data-metrics-count`（无数据时不残留空壳）
  - `data-metric="span"` 的文案匹配 `/↔/`
- [ ] `docs/project/verify-ledger.md` 追加一行结论；明细留 `verify-runs/`。

### 6. 收尾

- [ ] 原型 README 状态改 `◐ 部分落地` → 全绿后改 `● 已落地`，同步 `design/prototypes/__INDEX__.md`。
- [ ] 提交（主 agent 唯一写手；子 agent 不提交）。

## 执行记录（2026-11-09）

- 纯逻辑文件命名修正：`session-metrics.ts` → `session-metrics-view.ts`。
  原因：同名 `.ts` + `.tsx` 并存时 TS 解析 `./session-metrics` 优先 `.ts`，`import { SessionMetrics }` 直接报"没有导出成员"。
  命名按本仓既有约定：纯逻辑 `*-view.ts` / 组件 `.tsx`。
- 单测：`npx vitest run frontend/app/session-overview/session-metrics-view.test.ts` → 25 passed；
  整个 `frontend/app/session-overview/` → 192 passed。
- `npx tsc --noEmit`：本包文件 0 error（仓库既有 30+ 处历史 error 与本包无关）。
- Prettier：新增文件已格式化；`overview-board-model.ts` / `session-overview.tsx` / `verify.mjs` 在 HEAD 就未格式化，
  为不制造无关 diff，未整文件重排。

## 已知未完成（交用户）

- 真机验证未跑：`node scripts/verify/overview-board/verify.mjs`（起隔离实例，3-6 min）或
  `--attach`（复用已起实例）。新增断言 id：`metrics-rail-renders` / `metrics-count-matches-cells` /
  `metrics-message-text` / `metrics-size-text` / `metrics-span-mark` / `metrics-span-title` /
  `metrics-created-format` / `metrics-no-wrap` / `metrics-no-empty-rail` /
  `metrics-age-self-explaining` / `metrics-row-surface`。
- `docs/project/verify-ledger.md` 本包**未入账**（由 verify 跑完自动追加）。
- 未提交（等用户验证后再 commit，避免把半成品锁进 main）。

## 回滚点

- 步骤 3 之后任意失败：删除两处 `<SessionMetrics>` 调用即可回到当前行为（组件文件与单测留着无害）。
- 步骤 4 的样式改动独立成块，可单独 revert 不影响逻辑。

## 不做

B/C 变体、卡片密度设置开关、聚合卡、后端字段。
