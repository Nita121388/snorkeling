# Implement — 执行清单

> 顺序执行；每步的验证命令必须实际跑出结果（不接受"看了一下没问题"）。
> >60s 的命令（vitest 全量 / verify 台 / tsc）走 async 子代理。

## Step 0 基线

- [ ] `git status` 干净（或记录在案的既有脏文件清单）
- [ ] `node scripts/verify/overview-board/verify.mjs` 基线全绿（81/81；如环境跑不动记录 blocker）

## Step 1 R1 方块条下移（overview-board.tsx）

- [ ] 把 `card-squares` 条件块移到 `card-preview` 之后、`card-note` 之前；注释同步
- [ ] `overview-board-message-squares.test.tsx` 补 DOM 顺序断言（preview index < squares index）
- [ ] `npx vitest run frontend/app/session-overview/overview-board-message-squares.test.tsx frontend/app/session-overview/overview-board.test.ts frontend/app/session-overview/overview-board-hotzones.test.tsx`

## Step 2 R2 详情弹窗去删除（session-overview.tsx）

- [ ] 删 `MessageDialog` 的 `onDeleteBlock`：类型、Tooltip+button 块、调用点整段
- [ ] `rg -n "onDeleteBlock" frontend/` → 0 命中
- [ ] rg `dialog.deleteBlock` 其余消费点，无则清 locale key（en + zh 等全部语言文件同步）
- [ ] 单测：新增/更新断言弹窗内只有一个关闭 x；`npx vitest run frontend/app/session-overview`

## Step 3 R3 详情卡补内容（agentcardmodal.tsx + 共享抽取）

- [ ] 抽 `BoardMessageSquareLimit` / `readableMessages` / `messagePreview`（含最近消息 → square items 的纯函数 `buildRecentMessageSquares(detail, t)`）到共享位置；看板侧改 import
- [ ] `agentcardmodal.tsx`：新 `useSessionRecentMessages` hook + 渲染 `SessionMessageSquares`（surface 扩 `"modal"`）+ `SessionMetrics`（surface 扩 `"modal"`，数据 `noteState.summary`）
- [ ] 方块 `onOpen` → `pushModal("AISessionDetailModal", { sessionId, connection })`
- [ ] 空态：无 sessionId / 无消息 → 两区块整块不渲染
- [ ] 样式：modal 内两区块容器（间距按 token 8px）
- [ ] 单测：hook 数据裁剪 / overflow / 空态不渲染 / 点击 push modal；`npx vitest run frontend/app/modals frontend/app/session-overview`
- [ ] `npx vitest run frontend/app/session-overview/overview-board.test.ts`（确认 import 改动无回归）

## Step 4 R4 属性行间距与字号（session-overview.scss）

- [ ] `.session-overview-board-card-props` 加 `margin-bottom: 8px`
- [ ] prop 文本 10→11px；`property-chip` 9→10px、16→18px 高；`prop-more` 9→10px
- [ ] 目测/verify：属性行与 preview 之间有 8px 间隙；卡高不跳

## Step 5 真机验证 + 收尾

- [ ] `scripts/verify/overview-board/verify.mjs` 补三条断言：
  1. `board-card-prop-preview-gap`：props 容器 `margin-bottom === 8px`
  2. `board-card-prop-chip-size`：`.property-chip` fontSize ≥ 10px
  3. `board-card-squares-below-preview`：agent 卡内 squares 的 offsetTop > preview 的 offsetTop
  4. `message-dialog-no-delete`（若场景可达；不可达则 skipped + 单测锁）
- [ ] `node scripts/verify/overview-board/verify.mjs` 全绿
- [ ] `npx tsc --noEmit`（或仓库 typecheck 命令）
- [ ] 台账追加 `docs/project/verify-ledger.md` 一行
- [ ] spec 回写（如有新坑）：`.trellis/spec/snorkeling-docs/frontend/quality-guidelines.md`
- [ ] 分项 commit（R1/R2/R3/R4 各一个，便于独立 revert）

## 回滚点

- Step 1-4 每步一个 commit；任一步真机验证不过 → revert 该步 commit，不牵连其余。

---

## 执行记录（2026-11-25）

- Step 1-4 由 trellis-implement 子代理完成；Step 5 真机台**被用户豁免**（"本机性能比较差，不需要真机验证"），
  verify.mjs 的 4 条断言已写好，仅 `node --check` 通过，未起 Electron 实例、未写 verify-ledger。
- 单测：`npx vitest run frontend/app/session-overview frontend/app/modals` → 44 files / 454 tests 全绿；
  trellis-check 复核 PASS；`npx tsc --noEmit` 58 条 = HEAD 基线，零新增。
- 检查期 P1（空度量轨容器留 8px 空壳）已当场修复：`.agent-card-modal-sections` 改为
  `sessionId !== "" && (有方块 || summary != null)` 才渲染；agentcardmodal.dom.test.tsx 8 例绿。
- 偏离：`implement.md` 原计划 R1/R2/R3/R4 分四个 commit，但 `session-overview.tsx` 同时承载 R2（删
  onDeleteBlock）与 R3（共享函数抽取 import），按文件拆分无法干净分离 → 合并为一个 commit，
  commit message 逐项列明，回滚需整包 revert。
- `dialog.deleteBlock` / `deleteBlockAria` 两个 i18n key **保留**：列表行删除按钮仍在消费（设计前置条件不成立）。
