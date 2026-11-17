# Implement — Overview agent 卡面三件套

执行序（每步可独立验证；失败回退到上一步的 git stash）：

## Step 1 — 纯函数 + 单测（`overview-board-model.ts` / `.test.ts`）

- [ ] `BoardPropRow` 类型 + `resolveBoardPropRows()`（内置 key 过滤/空值过滤/order 排序/着色/上限）
- [ ] 单测：空 props / null props / 内置 key 排除 / status 单值着色 / 多值 / checkbox true|false / order 排序 / 超 3 条截断 / schema options 着色 fallback
- [ ] 验证：`npx vitest run frontend/app/session-overview/overview-board-model.test.ts` → passed

## Step 2 — 看板卡渲染（`overview-board.tsx`）

- [ ] `OverviewBoardCard` 加 `propRows` 字段（类型 `{ visible: BoardPropRow[]; hiddenCount: number }`）
- [ ] 卡片新增 `session-overview-board-card-props` 行（preview 之前）
- [ ] `import "@/app/view/aisessions/property/property-list.scss"`（property-chip 9 色）
- [ ] 验证：`npx vitest run frontend/app/session-overview/overview-board-memo.test.tsx` → passed

## Step 3 — 面板组卡 + 列表行（`session-overview.tsx`）

- [ ] boardCards useMemo 里 `propRows: resolveBoardPropRows(summary?.props ?? detailSummary?.props, schema)`
- [ ] 面板调 `usePropertySchema()`（传给 BoardCard 的组卡 memo 与 BlockRow）
- [ ] `BlockRow` 补 tags + props 紧凑区（`data-overview-row-meta` / `data-overview-row-tag` / `data-overview-row-prop`）
- [ ] 验证：`npx vitest run frontend/app/session-overview --reporter=basic` → passed

## Step 4 — SCSS（`session-overview.scss`）

- [ ] `.session-overview-board-card-props` 行样式（flex / nowrap / gap / min-height 防跳动）
- [ ] `.session-overview-board-card-prop-name` / `-text` / `-more` 紧凑样式
- [ ] `.session-overview-block-row-meta` 列表行紧凑 chips 区
- [ ] `.agent-card-title-block.is-loading` 占位样式

## Step 5 — 悬浮卡空态（`session-note-section.tsx`）

- [ ] `summary == null && variant === "hover"` → 渲染 loading 占位（detail 分支 return null 不变）
- [ ] 验证：`npx vitest run frontend/app/element/info-card --reporter=basic` → passed

## Step 6 — i18n

- [ ] `session-overview.json`（zh/en）：`board.moreProps`
- [ ] `element.json`（zh/en）：`sessionNote.loading`（若已有则复用）
- [ ] 验证：`npm run i18n:check` → ok

## Step 7 — 真机验证台（`scripts/verify/overview-board/`）

- [ ] 已有台子补一条断言：有 props 的会话卡渲染 `data-board-prop`（真机数据不可用 → skip 规则，不静默）
- [ ] `node --check scripts/verify/overview-board/verify.mjs` → 0
- [ ] 真机实跑（环境恢复后）：`node scripts/verify/overview-board/verify.mjs --attach`（记录到 verify-ledger）

## Step 8 — 收尾

- [ ] 全量回归：`npx vitest run frontend/app/session-overview frontend/app/element/info-card --reporter=basic` → passed
- [ ] tsc 基线：`node scripts/check-tsc-baseline.mjs` → ≤47（不增）
- [ ] spec 更新（若沉淀出规则）
- [ ] verify-ledger 补一行
- [ ] commit（单 commit 收口）
- [ ] loop 台账记 prove 数字

## 回滚点

- Step 1 失败 → stash 纯函数，重写
- Step 2-6 任一失败 → `git checkout -- <file>` 回退该文件
- Step 7 真机红 → 不阻塞（skip 规则），记录到台账待环境恢复