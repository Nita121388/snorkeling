# Overview 看板：无状态 agent 卡不显示空状态标签

## Goal

Overview 看板卡片里，当会话没有 `AgentStatus`（或调用方没传 `onAckStatus`）时，
不应出现一个「有边框、有圆角、但没有文字」的 `.session-overview-board-card-view-label` 空胶囊。
没有状态 = 不显示；有视图类型（终端/文件等非 agent-like 卡）时仍要显示对应标签。

## 背景（真机现象）

nita 2026-11-09 报：pi agent 卡片上出现 `<span class="session-overview-board-card-view-label"></span>`，
看起来像坏掉的状态徽章。

根因链：

1. `frontend/app/session-overview/session-overview.tsx` 的 `boardCards` 把 agent-like 卡的
   `kindLabel` 设为 `""`（约定由状态 chip 接管显示）。
2. `frontend/app/session-overview/overview-board.tsx` 的 `BoardCard` 在
   `status != null && onAckStatus != null` 为假时，**无条件**渲染兜底
   `<span className="session-overview-board-card-view-label">{card.kindLabel}</span>`。
3. `.session-overview-board-card-view-label`（`session-overview.scss`）带 `border / padding / border-radius`，
   空字符串也画出一个小空框。
4. 对照组：列表视图 `session-overview.tsx` 的 `BlockRow` 已写成
   `agentStatus ? <AgentStatusChip/> : null`，没状态就不渲染；看板漏了同一收口。

## 做什么

1. 在 `overview-board-model.ts` 新增纯函数 `resolveBoardMetaLabel({hasStatusChip, kindLabel})`：
   返回该渲染的标签文本，`""` 表示不渲染（与 `formatBoardAge` / `truncateBoardPreview` 的
   「空串隐藏」口径一致）。判定表：

   | hasStatusChip | kindLabel | 返回 |
   |---|---|---|
   | false | `""` | `""`（本 bug） |
   | false | `"Terminal"` | `"Terminal"`（保留） |
   | true | 任意 | `""`（chip 接管，行为不变） |

2. `overview-board.tsx` 的 `BoardCard`：把 `if/else` 拆成两段独立条件渲染，
   状态 chip 与标签都按各自条件渲染；标签用 `resolveBoardMetaLabel` 的结果判空。
3. `overview-board.test.ts` 加 4 个用例覆盖上表；另建 `overview-board-empty-label.test.tsx`
   （jsdom + createRoot 渲染真实 `BoardCard`）加 4 个 DOM 用例：无状态 agent 卡、无状态非 agent 卡、
   有状态 chip 卡、有状态但无 ack 回调卡，锁住「空胶囊数量 = 0」与「视图名标签不消失」。
4. `scripts/verify/overview-board/verify.mjs` 的 `COUNTS` 增加空标签计数，
   加 `board-no-empty-view-label` 与 `board-view-labels-preserved` 两条断言。
   **本会话不跑真机**（nita 2026-11-09 明示「我自己验证」），断言留给用户在自己环境跑；
   台账按既有约定记 `skipped`，不静默省略。

## 验收标准（命令 → 数字）

1. `npx vitest run frontend/app/session-overview/overview-board.test.ts frontend/app/session-overview/overview-board-empty-label.test.tsx --reporter=dot`
   → `exit 0`，`0 failed`，新增纯函数 4 例 + DOM 4 例全绿（红证先于修复产出）。
2. `npx vitest run frontend/app/session-overview --reporter=dot` → `exit 0`，`0 failed`（不破坏既有 192 用例）。
3. `npx tsc --noEmit` 的 `error TS` 计数 → `<= 47`（既有基线，不得变大）。
4. 【用户自验，本会话 skipped】CDP 断言 `board-no-empty-view-label`（空标签数 = 0）与
   `board-view-labels-preserved`（`nonAgentCards === 0 || viewLabels >= 1`）：看板视图下
   `[...document.querySelectorAll(".session-overview-board-card-view-label")].filter(e => e.textContent.trim() === "").length === 0`；
   同时非 agent-like 卡的标签数量不减少。
   本会话**不启动 Electron/CDP**，不写「已跑」结论。
5. `docs/project/verify-ledger.md` 追加 1 行结论（area = overview board），真机面明确写 `skipped（用户自验）`。

## 不做

- 不改 agent-status 上报链路 / 状态判定（无状态是合法状态，不是数据错误）。
- 不改 `AgentStatusChip` 的语义与几何。
- 不改非 agent-like 卡的视图名标签内容与位置。
- 不动 `11-09-overview-card-metrics` 的度量轨逻辑（工作区已有未提交改动，本包只碰 meta 行）。

## touch 白名单

`frontend/app/session-overview/overview-board-model.ts` ·
`frontend/app/session-overview/overview-board.tsx` ·
`frontend/app/session-overview/overview-board.test.ts` ·
`frontend/app/session-overview/overview-board-empty-label.test.tsx` ·
`scripts/verify/overview-board/verify.mjs` ·
`docs/project/verify-ledger.md` ·
`.trellis/tasks/11-09-overview-board-empty-status-label/**` ·
`.trellis/spec/**` · `loop/items/N-1109-overview-board-empty-status-label.md` ·
`loop/red/N-1109-overview-board-empty-status-label.txt` · `loop/gates.json`（引擎写）

## 回滚

`git revert` 本包单提交即可；无数据 / 接口 / 存储格式变更。
