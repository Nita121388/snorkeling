> **Confirmed: 2026-11-17 @nita**

# Overview agent 卡面显示 Note/Tags/自定义属性（含状态）

## Goal

Overview 列表行与看板卡补齐 Note/Tags/自定义属性三件套显示：看板卡接 props 渲染（status 彩色胶囊），列表行补 tags+属性，悬浮卡 summary 空态不再整段消失。

## 背景（现状）

- 数据层完整：后端 `Summary` RPC 返回完整 `SessionSummary`（含 `note` / `tags` / `props`），props 写入走 `SetProps` + `dispatchAISessionNoteUpdated` 广播，Overview 面板 summary 频道订阅可拿到最新值。**数据没断，渲染层没接。**
- 用户新增的"状态"属性 = `summary.props` 里的自定义属性（类型如 `status`/`select`），看板卡/列表行完全不读取。

| 面 | Note | Tags | 自定义属性 |
|---|---|---|---|
| 看板卡 `BoardCard` | ✅ ✎ 行 | ✅ ≤3 chip + `+n` | ❌ 无（`OverviewBoardCard` 无 props 字段） |
| 列表行 `BlockRow` | ⚠️ 仅一行（非空才显示） | ❌ | ❌ |
| 整卡/悬浮卡 `SessionNoteSection` | ✅ | ✅ | ✅（≤5 条） |
| 时间线行 | ❌（设计如此，只显状态条） | ❌ | ❌ |

## Requirements

1. **看板卡**：显示自定义属性（有值才显示），`status`/`select` 用彩色胶囊，多值类型 chips，其余 `名称: 值` 文本行；上限 3 条 + `+n` 溢出，防卡高跳动。
2. **列表行**：补齐 tags chips + 有值自定义属性（紧凑），与看板卡同解析函数同口径。
3. **悬浮卡空态**：`summary == null` 时渲染加载占位，不再整段消失（标题/骨架仍在）。
4. **不加新 RPC**：全部复用现有 summary 缓存与事件广播。
5. **纯函数可单测**：属性归一/上限/排序逻辑放 `overview-board-model.ts`，不反向依赖 aisessions view 层。

## Acceptance Criteria

- [ ] 看板卡 `data-agent-like=true` 时，有 props 的会话渲染 `data-board-prop` 元素，`status` 类型带彩色 class（`property-chip--<color>` 或等价）
- [ ] 数量上限生效：>3 条时只渲染 3 条 + `+n` 溢出标记
- [ ] 列表行 agent 行渲染 tags chips 与属性行
- [ ] `summary == null` 时空态不整体消失（悬浮卡显示占位）
- [ ] `npx vitest run frontend/app/session-overview/overview-board-model.test.ts` → passed（新增用例）
- [ ] `npm run i18n:check` → ok（新增 key 双语齐全）
- [ ] 老数据（无 props）不渲染属性行、不报错；`OVERVIEW_BOARD_ENABLED` 开关兜底不变

## Constraints

- touch 白名单限 `frontend/app/session-overview/**`、`frontend/app/element/info-card/session-note-section.tsx`、对应 i18n、验证台、文档：
  `frontend/app/session-overview/overview-board-model.ts|.test.ts`、`overview-board.tsx`、`overview-board-memo.test.tsx`、`session-overview.tsx`、`session-overview.scss`、`frontend/app/element/info-card/session-note-section.tsx`、`frontend/i18n/locales/{zh,en}/session-overview.json`、`{zh,en}/element.json`、`scripts/verify/overview-board/**`、`scripts/verify/README.md`、`docs/project/verify-ledger.md`、`.trellis/**`、`loop/**`
- 不改后端、不改属性写入链路（property-store/SetProps 已有闭环）
- 不调用 React hook 于纯函数模块；属性 type/name/order 从 `PropertyCell` 自描述读取（不依赖全局 schema，老数据零迁移）

## Notes

- 悬浮卡 `SessionNoteSection` 空态改动需保证 detail 变体（详情卡）行为不变——只对 `variant="hover"` 加占位。
- i18n 走 Pattern F（读时翻译），新 key 加在 `session-overview:board.*` 与 `element:sessionNote.*`。