# Design — Overview 看板会话卡体验四项

## 涉及面（touch 白名单）

```
frontend/app/session-overview/overview-board.tsx          # R1: BoardCard 内 DOM 顺序
frontend/app/session-overview/session-overview.tsx         # R2: MessageDialog 删 onDeleteBlock
frontend/app/session-overview/session-overview.scss        # R4: props 行间距 + 字号
frontend/app/modals/agentcardmodal.tsx                    # R3: 详情卡补内容
frontend/app/modals/__tests__/（或既有测试文件）             # R3 测试
frontend/app/session-overview/*.test.tsx                  # 各项对应测试更新
scripts/verify/overview-board/verify.mjs                  # R1/R2/R4 真机断言
docs/project/verify-ledger.md                              # 台账（收尾一行）
```

## R1 方块条下移

`overview-board.tsx` `BoardCard` render：把 `card-squares` 的条件块（现在 meta 行之前，约 L451-462）整块剪切到 `card-preview`（约 L595）之后、`card-note` 之前。

- 条件与 `stopCardEvent` 包装不动；`SessionMessageSquares` 的 props 不变。
- 注释同步改（「会话方块条…」的层级描述）。
- 测试：`overview-board-message-squares.test.tsx` 现只断存在性/行为，补一条「preview 在 squares 之前」的 DOM 顺序断言（`compareDocumentPosition` 或父 children 索引）。

风险：`overview-board-hotzones.test.tsx` / verify 台的 `fusion` 探针只查存在与 closest 归属，不查顺序 —— 低风险。样式 `.session-overview-board-card-squares` 若有针对位置的 margin 需顺带核对（现状无，纯 flex 子项）。

## R2 详情弹窗去删除

`session-overview.tsx`：

1. `MessageDialog` props 类型删 `onDeleteBlock`；
2. render 里删 Tooltip+button 块（`session-overview-block-x-button`）；
3. 调用点（约 L3541-3556）删 `onDeleteBlock={...}` 整段；
4. `closeOverviewBlock` 若因此无其他引用则连 import 一起清（先 rg 确认）。

i18n：`session-overview:dialog.deleteBlock` / `deleteBlockAria` 若仅此处使用则从 locale 删除；有其他消费则保留（先 rg）。

测试：现有针对弹窗的测试 grep 确认没有锁 delete 按钮；新增断言「弹窗内 x 按钮只有右上角一个」。verify 台补一条 `message-dialog-no-delete`（点开一条消息后查 `.session-overview-message-dialog` 内 `.session-overview-block-x-button` 数为 0）—— 若 verify 台场景不易点开消息，退化为单测覆盖并在台账 skipped 说明。

## R3 详情卡补内容

`agentcardmodal.tsx`：在 `AgentHoverCard` 之上（Modal children 内、卡片之前或之后）补两个区块，均为薄封装：

1. **会话方块条**：新 hook `useSessionRecentMessages(sessionId, connection)`：
   - 初始 `getCachedSessionDetail(sessionId)`；miss 时 `loadCachedSessionDetail(new AISessionsServiceType(), sessionId, { tail: 100 })`，成功写回 React state（cache 本身由 loadCachedSessionDetail 管理）；
   - 产出 `items`（`readableMessages(detail)` → `slice(-BoardMessageSquareLimit)` → `seq/role/preview/label`，label 用同一 i18n key）与 `overflow`；
   - `BoardMessageSquareLimit`、`readableMessages`、`messagePreview` 目前在 `session-overview.tsx` 内部 —— 抽到可共享位置（`session-overview/` 下纯函数文件）而不是复制实现；导出后看板侧改 import，行为不变。
2. **度量轨**：`summary`（`useSessionNoteState` 已有）直喂 `SessionMetrics`：`surface` 需扩 `"modal"`（视觉复用 board 档），`now` 用 `Date.now()`。

布局：`SessionMessageSquares` 与 `SessionMetrics` 放在 `AgentHoverCard` 之后、Modal footer 之前，用独立容器 class（如 `.agent-card-modal-squares` / `.agent-card-modal-metrics`，样式进 `session-overview.scss` 或就近既有样式文件，遵守间距 token）。

点击语义：`onOpen` → `modalsModel.pushModal("AISessionDetailModal", { sessionId, connection })`（与 footer 按钮同一动作）。

数据可用性：`sessionId === ""` 或无消息 → 两区块整块不渲染（不留空行）；`SessionMetrics` 数据全空时组件自身返回 null。

测试：单测 mock `loadCachedSessionDetail` → 断言 items/overflow/不渲染空态；点击 push AISessionDetailModal。

风险：modal 内嵌套弹窗层级（AISessionDetailModal 之上再 push）已有先例（AgentCardModal 自己就是被 push 的）。`surface` 联合类型扩展需同步 `SessionMessageSquares`（`data-board-message-square` 只在 `surface === "board"` 时挂，modal 不挂，探针不受污染）。

## R4 属性行间距与字号

`session-overview.scss`：

```scss
.session-overview-board-card-props { margin-bottom: 8px; }   // 新增（对齐 preview 的 6px / meta 的 9px 档）
.session-overview-board-card-prop { font-size: 10px → 11px; }
.session-overview-board-card-prop .property-chip { font-size: 9px → 10px; height: 16px → 18px; line-height 同步; }
.session-overview-board-card-prop-more { font-size: 9px → 10px; }
```

字号提升会让单行属性更易触发溢出 → 现有 `max-width` + `+n` 裁断已覆盖，不改裁断规则；verify 台断言改后跑一遍确认卡高不跳。

## 验证策略

- 单测：目标文件 `npx vitest run <files>`（>60s 走 async 子代理）。
- 真机：`node scripts/verify/overview-board/verify.mjs`（改前先跑一次确认基线 81/81，改后补断言再跑）。
- 台账：`docs/project/verify-ledger.md` 追加一行。

## 回滚

四项相互独立、每个 commit 单独可 revert；样式与 DOM 顺序项回滚零数据风险；R3 的共享函数抽取若出问题，独立 revert 不影响 R1/R2/R4。
