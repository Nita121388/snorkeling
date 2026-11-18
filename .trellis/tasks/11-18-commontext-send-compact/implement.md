# Implement — CommonText 发送目标弹层紧凑化

## 顺序（每步可独立验证）

### 1. 纯逻辑：`commontext-send-target.ts`

- [ ] 新增 `FolderCwdSource`、`resolveFolderScopeTabId`、`collectFolderCandidatesForTab`
- [ ] `previewSendTarget` 增加可选 `folderDefault`（保持现有调用兼容）
- [ ] `commontext-send-target.test.ts` 补用例：
  - `resolveFolderScopeTabId`：current / existing / new / 空 tabId
  - `collectFolderCandidatesForTab`：去重、顺序、new Tab 只有工作区+home、空 cwd 忽略
  - `previewSendTarget`：`folderDefault` 生效且被 `config.folder` 覆盖

验证：`npx vitest run frontend/app/commontext/commontext-send-target.test.ts`

### 2. 数据源：`commontext-send-button.tsx`

- [ ] 新增 `sendFolderCandidatesAtom`（按 `config.tab` 解析目标 Tab → `collectAgentLaunchTargetsInTab`）
- [ ] `SendTargetPanel` 用 atom 取代 `collectTabAgentBlocks()`，删除该本地函数
- [ ] Tab 三个入口（下拉项 / 新建 Tab 项 / `+` 按钮）统一 `folder: null`

验证：`npx vitest run frontend/app/commontext` + `npx tsc --noEmit`

### 3. UI 重排：`SendTargetPanel`

- [ ] 目标卡（logo / 落点 / `Tab · 目录` / 状态徽标）+ chip 行
- [ ] 三行常显：Agent / Tab / 目录（行首 32px 标签；行尾 10px 状态文本）
- [ ] footer：switch + 取消 + 主按钮（文案随 `preview.kind`）
- [ ] 删除：段头 hint、目标摘要行、确认行摘要、后台行右侧说明、`notAgentBlock` 提示
- [ ] 保留并补齐 `data-*`：`data-commontext-send-target-card`、`[data-commontext-agent-row]`、
      `[data-commontext-tab-row]`、`[data-commontext-dir-row]`、`[data-commontext-dir-note]`

验证：真机台（步骤 6）

### 4. i18n：`zh/en commontext.json`

- [ ] 新增：`rowAgent` / `rowTab` / `rowFolder` / `badgeExisting` / `badgeCreate` / `dirFollowTab` /
      `dirAuto` / `dirPicked` / `sendTo` / `createAndSend` / `noteTabAgent` / `noteTabFiles` /
      `noteTabTerminal` / `noteTarget`（目标 Tab 显示名兜底）
- [ ] 停止使用（保留键）：`either` / `typeDefaultHint` / `folderDefaultHint` / `targetEquals` /
      `targetExisting` / `targetNew` / `backgroundOn` / `backgroundOff` / `summaryExisting` /
      `summaryCreate` / `notAgentBlock` / `focusedBlockTitle` / `createNewTitle`

验证：`npm run i18n:check`

### 5. 测试

- [ ] `commontext-send-target.test.ts`（步骤 1）
- [ ] 若 `commontext-compose-modal.dom.test.tsx` 依赖面板文案，按新结构更新断言

验证：`npx vitest run frontend/app/commontext`

### 6. 真机验证台

- [ ] `scripts/verify/commontext-send-agent-block/verify.mjs` 补断言：
  - `panel-three-rows`：聚焦块模式下 Agent / Tab / 目录三行同时可见
  - `folder-follows-tab`：切到另一 Tab 后目录候选集合变化，且行尾状态回到「自动」
  - `panel-height`：`[data-split-button-menu]` 高度 ≤ 320px（基线 379px）
- [ ] 更新 `docs/project/verify-ledger.md` 一行结论

验证：`node scripts/verify/commontext-send-agent-block/verify.mjs`

### 7. 收尾（已完成 2026-11-18）

- [x] `npm run i18n:check`（parity 0 diff）、`npx vitest run frontend/app/commontext`（169 passed）、`npx tsc --noEmit`（commontext 0 错）
- [x] 原型 README 状态 ▲ → ◐（部分落地），更新 `design/prototypes/__INDEX__.md`
- [ ] 提交：`feat(commontext): 发送目标弹层紧凑化 + 目录候选随 Tab`

## 回滚点

1. 步骤 1 后：新函数为纯增量，直接 revert 文件即可。
2. 步骤 3 后：UI 单文件回滚（`git checkout frontend/app/commontext/commontext-send-button.tsx`），数据源改动随文件一起回滚。
3. 全程无 schema / 后端改动，无需数据回滚。

## 判据汇总

| 门 | 命令 | 期望 |
|---|---|---|
| 单测 | `npx vitest run frontend/app/commontext` | all pass |
| 类型 | `npx tsc --noEmit` | 无新增错误 |
| i18n | `npm run i18n:check` | exit 0 |
| 真机 | `node scripts/verify/commontext-send-agent-block/verify.mjs` | exit 0，新增 3 条断言 PASS |
