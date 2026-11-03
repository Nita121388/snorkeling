# 执行清单：Agent 状态跨面一致性

> 前置：`task.py start` 之后才动代码。每个 Step 结束跑一次验证命令，失败即停并回滚该 Step。

## Step 0 — 基线（只读确认）

- [ ] 0.1 确认当前 store/derive 与 PRD 引用行号一致：
      `rg -n "presentedAtom|acquire\(|peekPresentedStatusAtom" frontend/app/agent-status/agent-status-store.ts`
      `rg -n "useCanonicalAgentStatuses|useBlockControllerStatuses|presentAgentStatus" frontend/app/session-overview/session-overview.tsx`
- [ ] 0.2 记录基线测试结果（只跑受影响目录）：
      `./node_modules/.bin/vitest run frontend/app/agent-status frontend/app/session-overview frontend/app/block frontend/app/view/term`

## Step 1 — derive：新增 `presentCanonicalAgentStatus`

- [ ] 1.1 在 `frontend/app/agent-status/agent-status-derive.ts` 增加纯函数（见 design 3.1）。
- [ ] 1.2 单测：idle+prevState→done；idle 无 prevState→idle；working 超阈值→stale；null→null。
- 验证：`./node_modules/.bin/vitest run frontend/app/agent-status/agent-status-derive.test.ts`
- 回滚：删除新增导出与测试。

## Step 2 — store：presented atom 走统一派生

- [ ] 2.1 `agent-status-store.ts` 的 `presentedAtom` 改为 `presentCanonicalAgentStatus(raw, Date.now())`，保留 working 时 `get(nowMinuteTickAtom)`。
- [ ] 2.2 确认 `acquire` / `peekPresentedStatusAtom` 行为不变（返回 presented）。
- 验证：`./node_modules/.bin/vitest run frontend/app/agent-status`
- 回滚：还原 presented atom 的 `applyStaleness` 单行。

## Step 3 — Overview 改读 store（删重复订阅）

- [ ] 3.1 新增 `useOverviewPresentedStatuses(blockIds, active)`：`acquire/release` 配对 + cached outer atom（参考 `frontend/app/agent-status/agent-status-tab-aggregate.ts:80-115` 的缓存写法）。
- [ ] 3.2 删除 `useBlockControllerStatuses`、`useCanonicalAgentStatuses`、`runOverviewRequests`、`OVERVIEW_STATUS_REQUEST_CONCURRENCY`（确认无其它引用）。
- [ ] 3.3 `agentStatuses` memo（2144-2175）改为从新 hook 的结果直接取值；保留 `shouldShowAgentStatusChip` 等过滤。
- [ ] 3.4 移除不再使用的 import（`presentAgentStatus`、`BlockServiceType` 若仅此处用；`normalizeCanonicalAgentStatus` 若仅此处用）。
- [ ] 3.5 确认 `useBlockControllerStatuses` 删除后 controller 相关信息不再被 debug effect 引用（2180-2240 的 `agentStatusLog` 段要一起清理）。
- 验证：`./node_modules/.bin/vitest run frontend/app/session-overview` + `npx tsc --noEmit -p tsconfig.json`（或项目既有 typecheck 命令）
- 回滚：恢复三个 hook（git checkout 单文件）。

## Step 4 — ack 语义统一

- [ ] 4.1 `ackAgentStatus`（2244）改为同时 `markAgentStatusAcked` + `agentStatusDoneAckStore.markDoneAcked`。
- [ ] 4.2 chip unread 计算（1787 附近）改为 `isAgentStatusUnread(...) || isAgentDoneUnread(...)`，与头部一致。
- [ ] 4.3 头部点击 ack（term-model 672-690）保持现状（已同时写 R+D）。
- [ ] 4.4 确认 aggregate chip 的 ack（`ackTabAgentStatuses`）也写 D。
- 验证：手动 + 新增测试（Step 6）。
- 回滚：还原 ack 回调。

## Step 5 — 文案/视觉回归

- [ ] 5.1 头部：presented=done 时 label 为 "Done"（`agentStatusPresentation` 已支持），确认 `is-done` scss 生效。
- [ ] 5.2 inline tab 点：done 态渲染正常，ack 后灰化；`is-done` scss 存在。
- [ ] 5.3 Tab 圆点聚合：`stateRank.done=2` 不遮蔽 working/blocked/stale（已满足，回归即可）。
- [ ] 5.4 若发现 "Done" 永久驻留观感问题，记录到 PRD Q1，不在本任务扩展。
- 验证：`node scripts/inspect-electron-ui.mjs state` （需 app 以 `--remote-debugging-port=9222` 运行）逐个面截图核对。

## Step 6 — 测试

- [ ] 6.1 新增 `frontend/app/agent-status/agent-status-cross-surface.test.ts`（design 第 6 节 4 条）。
- [ ] 6.2 把 PRD Background 的三条实测场景固化为断言（A: fingerprint 一致；B: 无 15min 悬崖；C: canonical null 两侧 nil）。
- [ ] 6.3 更新受影响的既有测试（`session-row.test.tsx`、`inlinetab-agent-status.test.ts`、`agent-status-derive.test.ts`）。
- 验证：`./node_modules/.bin/vitest run frontend/app/agent-status frontend/app/session-overview frontend/app/block frontend/app/view/term`

## Step 7 — 收尾

- [ ] 7.1 `detect_changes()` / `git diff --stat` 确认只动了 design 列出的文件。
- [ ] 7.2 更新 spec：`.trellis/spec/snorkeling-docs/frontend/state-management.md` 增加"派生状态必须单一呈现源，ack 指纹必须由同一 status 计算"条目。
- [ ] 7.3 删除所有临时 DIAG 代码（`window.__diagAgentStatusStore` 等，若本任务新增）。
- [ ] 7.4 提交（独立 commit，信息含 `fix(agent-status): unify overview chip and block header status`）。

## 明确不做

- 不改 `pkg/agentstatus`。
- 不做 viewedAt 全局化（S5）与无 hook provider 的 session 派生（S5），等用户答复 Q2/Q3 后另开子任务。
