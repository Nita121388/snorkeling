# Implement — Agent 卡片 Done 随 seen 状态联动（父任务）

父任务只负责需求集、任务地图与最终整合验收，实现落在 3 个子任务里。

## Checklist

- [x] 1. 子任务 `11-05-agent-status-view-core`：`agent-status-view.ts` 纯函数 + 单测（零 UI 变更）。
- [x] 2. 子任务 `11-05-agent-card-seen-surfaces`：E/F/G 三面接入 view.read + `.is-seen` 样式 + pill ack。
- [x] 3. 子任务 `11-05-agent-ack-seen-writers`：`ackAgentStatus` / `markAgentSeen` 收口 + 打开会话写 seenAt。
- [x] 4. 整合验收：7 个面同 read；AC1–AC6 全绿（`agent-status-cross-surface-read.test.ts` 7 条契约用例）。
- [ ] 5. 真机 CDP 复核（本次未做：检查时 9222 无运行实例，需用户开 `npm run dev:cdp` 后复验视觉）。

## 验证命令

```bash
cd frontend && npx vitest run app/agent-status app/block app/tab app/view/term
npx tsc --noEmit -p frontend/tsconfig.json
```

## Review gates

- gate 1（子任务 1 后）：`deriveAgentStatusView` 判定表单测全绿，且 `agent-status-derive.test.ts` 未改动仍全绿。
- gate 2（子任务 2 后）：CDP 实测 `node scripts/inspect-electron-ui.mjs` 抓 hover 卡的 pill class，确认 ack 前后 `.is-seen` ↔ `is-done-unread` 互斥切换。
- gate 3（子任务 3 后）：`detect_changes` 确认只影响预期符号。

## Rollback points

- 子任务 1 完成：新增文件独立，revert 无副作用。
- 子任务 2 完成：3 个组件渲染分支 + 1 个样式类。
- 子任务 3 完成：收口函数与调用点等量替换。
