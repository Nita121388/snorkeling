# 实施计划：chip 收口 + 运行时长 + 标题编辑

> 基线（2026-11-06 实测，命令与输出见 PRD「验收判据」）：
> `session-overview` 140 · `agent-status` 224 · `element/info-card` 36 · `view/term` 186 · `modals` 39 · `store` 86
> · `tsc --noEmit` = **47**

## 执行顺序（每步结束都可停下）

### Step 1 · 判据先行（红）

新增四个测试文件，全部**先写断言、不写实现**，跑出红证明：

1. `frontend/app/agent-status/agent-status-chip-view.test.ts`（16 条）
   - 同一 `status` 在 4 个 variant 下 `label` / `title` 完全一致（chip 收口的锁）
   - `card` variant 的 `className` 含 `agent-card-status-chip`；`header` 含 `agent-status-header`
   - `list`/`board` 含 `session-overview-agent-status`；`aggregate` 含 `session-overview-agent-aggregate`
   - `aggregate` variant `runtime === ""`
   - `idle` / `unknown` → `buildAgentStatusChipView` 返回 `null`
   - `read="unread"` 与 `"seen"` 的 `className` 差异（`is-unread`/`is-seen`、`is-acked`/`is-done-unread`）
   - `inferred` 状态带 `is-inferred`
2. `frontend/app/agent-status/agent-status-runtime.test.ts`（6 条）
   - `formatAgentChipRuntime(0, …) === ""`；`start > now` → `""`
   - `7_000 → "7s"`、`59_000 → "59s"`、`201_000 → "3min21s"`、`3_600_000 → "1h0min"`、`90_000_000 → "1d1h"`
3. `frontend/app/element/info-card/editable-title.test.tsx`（12 条）
   - 展示态渲染 `title` 全文 + `TitleSourceBadge`
   - 单击/双击进入编辑（两种 `enterToEdit`）
   - `Enter` 提交，`Escape` 放弃且 `stopPropagation` 被调用（`preventDefault` 也断言）
   - 空串/未变化 → 不调 `onCommit`
   - `onCommit` 返回 `null` → 保持编辑态并显示错误
4. `frontend/app/store/session-note-hook-title.test.tsx`（6 条）
   - `renameTitle(" New ")` → `service.Title` 收到 `"New"`
   - 成功 → `dispatchAISessionNoteUpdated` 被调用一次，返回值非 null
   - 空串 / 与现值相同 → `service.Title` 不被调用且返回 `null`
   - 失败 → 返回 `null` 且 `error` 有值

命令 → 期望（必须红）：

```bash
npx vitest run frontend/app/agent-status/agent-status-chip-view.test.ts   # 文件不存在 → fail
```

空壳文件先建（导出函数直接 `throw new Error("not implemented")`），让红是**断言红**而不是**找不到文件**。

### Step 2 · 纯函数转绿

- `frontend/app/agent-status/agent-status-runtime.ts`：`formatAgentChipRuntime` + `needsAgentChipRuntime`
- `frontend/app/agent-status/agent-status-chip-view.ts`：`buildAgentStatusChipView`

命令 → 期望：

```bash
npx vitest run frontend/app/agent-status/agent-status-chip-view.test.ts frontend/app/agent-status/agent-status-runtime.test.ts
# → 22 passed
```

### Step 3 · second tick + React 组件重写

- `frontend/app/agent-status/agent-status-second-tick.ts`（新）：`agentStatusSecondTickAtom` / `resetAgentSecondTick()` / `document.hidden` 跳过
- 重写 `frontend/app/session-overview/agent-status-chip.tsx`：`variant` 维度 + `React.memo` + `useAgentSecondTick`
- 新增 `frontend/app/agent-status/agent-status-chip.scss`（base + 5 个 variant），`agent-status-chip.tsx` 里 import
- 4 个调用点替换：`session-overview.tsx`（列表行 1699 / 聚合 946）、`overview-board.tsx:145`、`agent-hover-card.tsx:235`
- `term-model.ts:637` `getAgentStatusHeaderElem` 改为消费 `buildAgentStatusChipView({variant:"header"})` + 按需 `get(agentStatusSecondTickAtom)`

命令 → 期望：

```bash
npx vitest run frontend/app/session-overview/ frontend/app/agent-status/   # → 161 + 240 passed
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json | grep -c "error TS"   # → 47
```

### Step 4 · 样式收口（旧规则迁移，不一刀删）

- `session-overview.scss:753-897` 的 chip 段落：几何迁到 `agent-status-chip.scss`，
  只留 `.session-overview-agent-status` 作为 variant 别名的最小覆盖
- `info-card.scss:322-386` 的 `.agent-card-status-chip` 段落：同样迁走，保留别名类
- **垂直居中修正**：base 里 label 用 `line-height: 1` + `align-self: center`，
  若实测仍偏下则加 `transform: translateY(-0.5px)`；**不允许**用 `padding-top` 猜值（见 Step 6 判据）

命令 → 期望：样式无逻辑可测，靠 Step 6 真机判据。

### Step 5 · 标题编辑接线

- `frontend/app/element/info-card/editable-title.tsx`（新）
- `frontend/app/view/aisessions/title-edit.ts`（新，导出 `RenameTitleInputClass`，`session-detail.tsx` 改为 import）
- `frontend/app/store/session-note-hook.ts`：新增 `renameTitle`，并入返回值
- `frontend/app/agent-status/agent-status-ack.ts`：`AgentAckSource` 追加 `"title-edit"`
- `frontend/app/element/info-card/session-note-section.tsx`：新增 `onRenameTitle?`，`hover` 与 `detail` 两分支都换成 `EditableTitle`
- `frontend/app/view/term/agent-hover-card.tsx`：传 `onRenameTitle`（成功后 `ackAgentStatus(blockId, status, "title-edit")`）
- `frontend/app/modals/agentcardmodal.tsx`：`Modal title` 换成 `EditableTitle`，同样在成功后 ack

命令 → 期望：

```bash
npx vitest run frontend/app/element/info-card/ frontend/app/store/ frontend/app/view/term/ frontend/app/modals/
# → 48 + 92 + 198 + 43 passed
```

### Step 6 · 真机验证（真跑一次，不喊人）

扩展 `scripts/verify/agent-card-seen/verify.mjs` 的 `surfacesProbe`，新增 4 条断言：

| 断言 | 判据 |
|---|---|
| `hover-card-chip-centered` | `|chipLabelRect.centerY − chipRect.centerY| <= 1` |
| `hover-card-runtime-visible` | `working` 态 chip 文本匹配 `/^(Working\|Thinking\|Tool.*)\s+\d\d:\d\d$/` |
| `chip-same-label-across-surfaces` | `.agent-status-header` 与 `.agent-card-status-chip` 的 label 文本一致 |
| `title-edit-in-dialog` | 弹窗内双击标题 → `input` 出现 → 输入 → Enter → 标题文本更新且 `titleSource` 徽标变「用户」 |

命令 → 期望：

```bash
node scripts/verify/agent-card-seen/verify.mjs     # 退出码 0，报告 N/N（N = 21 + 4）
node scripts/verify/overview-board/verify.mjs      # 退出码 0，38/38（回归）
node scripts/verify/index.mjs                      # 两个 area 全绿
```

台账：`docs/project/verify-ledger.md` 追加一行结论。

### Step 7 · 收尾

- `HANDOFF.md` 的「最近做完」补一行
- 更新 `docs/project/agent-card-layout.md`（chip 段落：4 份实现 → 1 份 + variant 表）
- 三次独立 commit：
  1. `refactor(agent-status): chip 收口为单一组件（5 variant，兼容类别名保留）`
  2. `feat(agent-status): chip 显示运行时长（秒级 leaf tick，面板 tick 不变）`
  3. `feat(agent-card): 标题可编辑（悬浮卡 + 放大弹窗，含 Done 误点亮回归锁）`
- 提交前 `detect_changes()` 确认只影响预期符号

## 验证命令汇总

```bash
npx vitest run frontend/app/session-overview/      # 161
npx vitest run frontend/app/agent-status/          # 240
npx vitest run frontend/app/element/info-card/     # 48
npx vitest run frontend/app/view/term/             # 198
npx vitest run frontend/app/modals/                # 43
npx vitest run frontend/app/store/                 # 92
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json | grep -c "error TS"   # 47
node scripts/verify/agent-card-seen/verify.mjs     # 25/25
node scripts/verify/overview-board/verify.mjs      # 38/38
```

## 回滚点

| 步骤 | 回滚方式 |
|---|---|
| Step 2–3（chip 收口 + 跑时） | revert commit 1–2；`agent-status-chip-view.ts` / `agent-status-runtime.ts` / `agent-status-second-tick.ts` 均为纯新增，删掉即回到旧行为 |
| Step 4（样式） | 与 Step 2–3 同一 commit 族，`scss` 段落可单独 revert |
| Step 5（标题编辑） | revert commit 3；`renameTitle` 是 hook 上的纯新增字段，旧调用点不读它 |
