# 实施计划

## 步骤（按序，每步可独立验证）

### S1 纯逻辑层（无 UI）
1. `frontend/app/commontext/commontext-send-target.ts`
   - `extractAgentBlockInfo(block)`
   - `resolveSendTarget(selection, focusedAgent, settings?)`
   - `collectFolderCandidates({focusedAgent, tabBlockIds, getBlock, workspaceCwd, homeDir})`
   - `normalizeCwd` / `cwdEqual`
2. `frontend/app/commontext/pending-input.ts`
   - `registerPendingInput` / `takePendingInput` / `peekPendingInput` / `pendingInputCount` / `isExpired`
   - `computeInjectDecision`（输出静默窗口判定）
3. 单测：`commontext-send-target.test.ts`、`pending-input.test.ts`

验证：`npx vitest run frontend/app/commontext/commontext-send-target.test.ts frontend/app/commontext/pending-input.test.ts`

### S2 pending input 消费端
4. `frontend/app/view/term/term.tsx`：TermWrap 挂载后启动轮询注入（复用 S1 判定），TTL 回退剪贴板 + console.warn。
5. 失败回退提示通过 `window.dispatchEvent(new CustomEvent("snorkeling:pending-input-fallback", {detail:{blockId}}))`（弹窗可监听）—— 若实现成本高，降级为仅剪贴板 + console.warn。

### S3 Send 组件 UI
6. `frontend/app/commontext/commontext-send-button.tsx`
   - `CommontextSendButton`（split button + popover）
   - `AgentMiniCard`（复用 `AgentStatusChip` 与现有头像解析，不新增映射）
   - `SendTargetPopover`（三段选择 + 确认行）
7. 组件样式：新增 `commontext-send-button.scss` 或复用全局 token 的 inline class（优先与 modal.scss 既有风格一致）。

### S4 弹窗接线
8. `commontext-compose-modal.tsx`
   - 新增 `commontextSendConfigAtom`（module-level jotai atom）
   - 聚焦 agent block atom：`focusedAgentBlockAtom`（focusedTermBlockIdAtom + extractAgentBlockInfo）
   - 三个 Send 点位：
     - 编辑器 footer → `CommontextSendButton`（popover 宿主）
     - 详情 footer → `CommontextSendButton`（popover 宿主）
     - 列表行 → 直接执行（复用组件导出的 `sendWithConfig()`）
   - 移除旧的 `handleSendToTerm` / `handleListItemSend` 中的 sendTextToFocusedTerm 直连（is existing 时）

### S5 清理与回归
9. `rg "cmd:initialinput" frontend/app` 确认无新增依赖。
10. `npx tsc --noEmit`、`npx eslint frontend/app/commontext --max-warnings 0`。
11. `npx vitest run frontend/app/commontext`。
12. 真机 CDP 验证（`npm run dev:cdp` + `scripts/inspect-electron-ui.mjs`）：existing 注入、create 注入、普通终端禁用态。
13. `docs/project/verify-ledger.md` 追加一行结论。

## 验证命令

```bash
npx vitest run frontend/app/commontext
npx tsc --noEmit
npx eslint frontend/app/commontext --max-warnings 0
rg "cmd:initialinput" frontend/app
```

## 回退点

- S2 出问题（term 注入不稳定）：保留 S1 队列 API，UI 侧新建路径降级为「建块 + 复制到剪贴板」并在 status 提示（PRD R8 允许可见失败）。
- S4 出问题：先只接通编辑器 footer 的 Send（详情/列表回退旧逻辑），确保主路径可用。

## 风险

| 风险 | 缓解 |
|---|---|
| TUI 冷启动 > 60s | TTL 到 → 剪贴板回退 + 提示；窗口可调 |
| TUI 启动期输出噪声导致静默窗口提前触发 | quiet 窗口 600ms + 首次输出后再等；实测 claude/codex/pi 校准 |
| `ObjectService.CreateBlockInTab` 签名（activateTargetTab）导致焦点跳动 | 传 `activateTargetTab=true` + `electron.setActiveTab`，与新 tab 行为一致 |
| tab 列表包含 session overview 虚拟 tab | 复用 `filterSessionOverviewTabIds` |
