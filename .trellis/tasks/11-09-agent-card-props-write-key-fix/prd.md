# Agent 卡片属性写入必失败：缓存 key 用裸 id 建档、写路径用完整 key 查档

## Goal

修复 agent 卡片（悬浮卡 / 卡片弹窗 / 会话详情卡）上**任何属性写入都失败**的 bug：标签增删、自定义属性新增/删除、重命名、换类型、排序、Note Undo —— 全部报「保存失败」。

## 根因（已定位，非猜测）

两套 id 形态混用，缓存查不中：

| 环节 | 使用的 id | 形态 |
|---|---|---|
| `useSessionNoteState(sessionId, connection)` 的 block 侧调用方 | `resolveBlockSessionId(meta)` ← `agent:sessionid` | **裸 id** `0e0b108c-3149-408c-805b-3493af6b2cdc` |
| note-cache 建档 key | `cacheKey(sessionId, connection)` = `connection\|sessionId` | 裸 id |
| `session-note-section.tsx` 的属性写路径 | `summary?.key` | **完整 stable key** `pi:<id>:/Users/.../x.jsonl` |

`saveSessionNote` / `saveSessionProps` 用**传入 id** 查 `getEntry()` 取乐观更新基线 `before`；传完整 key 时命中一个新建的空 entry（`summary == null`）→ 立即返回 `"session summary not loaded"` → 卡片显示 `保存失败：session summary not loaded`，随后的乐观更新回滚（用户看到「删了又回来」）。

note 正文编辑不受影响，因为 hook 自己的 `saveNote` 用的是 `sessionId`（裸 id）——所以症状表现为「只有删标签/属性失败，写 note 正常」。

实测确认（同一台真机、同一后端）：
- 后端链路正常：`wsh agent card set <key> --tags-remove ...` 真删成功；
- 直接复现前端请求：`POST /wave/service?service=aisessions&method=NoteAndTags`，删最后一个标签（`tags: []`）与删其中一个标签均返回 `success:true`。
- 因此故障点在前端缓存 key，而非后端。

## Requirements

- **R1** 缓存型写路径（`setSessionProperty` / `patchSessionProperty` / `saveSessionProps` / `useNoteUndo`）统一使用 `state.sessionId`（hook 建档同一个 id）。
- **R2** 直接走 RPC 的路径不动：`GenActionButton`、`AISessionNoteModal`、`AIPropertiesButton` 的 `service.SetProps({id: summary.key})` 本来就用完整 key，合法。
- **R3** 不改变 `saveSessionNote` 内部用 `before.key` 发 RPC 的行为（删除标签时后端仍收到完整 key）。
- **R4** 在源码处留下注释说明两种 id 形态与不变量，避免后续回退。

## Non-goals

- 不重构 note-cache 的 key 设计（不改 `cacheKey` / 不加 key 归一化）—— 留待属性体系改造任务。
- 不改后端、不改 RPC 契约。

## Acceptance Criteria（机器可判定）

1. 新增 `frontend/app/element/info-card/session-note-section.test.tsx` 3 条用例：
   - `useNoteUndo` 收到裸 `sessionId`；
   - `PropertyList onChange`（删标签）→ `setSessionProperty` 收到裸 `sessionId`；
   - `onRenameProperty` → `patchSessionProperty` 收到裸 `sessionId`。
2. 临时还原源码后上述 3 条**必须全红**（证明是真回归锁），恢复后全绿。
3. `npx vitest run frontend/app/element/info-card/ frontend/app/view/aisessions/property/ frontend/app/store/session-note-cache.test.ts` → 11 files / 122 tests 全绿。
4. `npx tsc --noEmit` 对 `session-note-section.tsx` 与新增测试 **0 error**。
5. 真机上打开 agent 悬浮卡删标签 → 不再出现「保存失败」，标签删除后保持删除（不被回滚）。

## Notes

- 复现证据（2026-11-09 本机）：后端 `NoteAndTags` 直连 HTTP 返回 `success:true`；`wsh agent card set --tags-remove` 真删成功 → 排除后端。
- 同源风险：`useNoteUndo.undo()` 也调 `saveSessionNote`，若只改属性路径会留下 Undo 失败，已一并覆盖。
