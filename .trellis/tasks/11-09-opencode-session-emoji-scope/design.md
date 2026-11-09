# 技术设计：opencode session emoji 串扰

## 受影响面盘点（emoji picker 的 4 个入口）

| 入口 | 文件 | blockId | sessionId |
|---|---|---|---|
| Block 头部图标 | `frontend/app/view/term/term-model.ts:209` | 有 | `commandResolution.sessionId \|\| agentStatus?.sessionId \|\| ""` |
| Inline tab 右键菜单 | `frontend/app/block/block.tsx:512` | 有 | meta → binding → status 兜底 |
| Agent 悬浮卡头像 | `frontend/app/view/term/agent-hover-card.tsx:215` | 有 | `sessionId \|\| agentStatus?.sessionId \|\| ""` |
| 历史列表行 | `frontend/app/view/aisessions/session-row.tsx:389` | **null** | 总有（`session.id`） |

共同出口：`openAgentEmojiPicker(blockId, provider, rect, initialScope, sessionId)` → `AgentEmojiPickerHost` → `AgentEmojiPicker`。
所有写操作收敛在 `agent-emoji-picker.tsx` 的 `applyEmoji`，写目标由 `persona-scope.ts` 的纯函数决定。

## 设计决策

### D1 新增 `"block"` scope（前端止血）

- `AgentEmojiScope = "session" | "block" | "provider"`。
- 折叠规则（`resolveAgentEmojiScope(scope, sessionId, blockId?)`）：
  - `provider` → `provider`（永不改写）
  - `session` → 有 sid 则 `session`；否则有 blockId 则 `block`；否则 `provider`
  - `block` → 有 blockId 则 `block`；否则有 sid 则 `session`；否则 `provider`
- 写目标（`resolveAgentEmojiWriteTarget(scope, sessionId, provider, blockId?)`）：
  - `session` → `setSessionEmoji`
  - `block` → `agent:emoji` block meta（`SetMetaCommand`），清空时置 `null`
  - `provider` → `setAgentPersona`
- 为什么用 `agent:emoji` block meta 而不是新 store：`getAgentIcon` 解析链已经是 L2 session → L2 block meta → L1 provider（`agent-logo.tsx:110-135`），零改动即可生效，且 block meta 天然按 block 隔离、随 block 持久化。

### D2 picker 默认 scope 与文案

- `picker-host.ts`：`sessionId` 为空时，若 `blockId` 非空 → `initialScope = "block"`，否则 `"provider"`。
- `AgentEmojiPicker` 增加 `blockId` / `blockEmoji` 两个 props（host 已有 block atom，直接传）。
- Footer：「仅此标签页」radio（默认选中）取代原来的「只能应用到所有 X 会话」强制结论；provider 级 radio 仍可选，但需要用户主动点。
- 「恢复默认 Logo」的 enabled 判定按当前 effective scope 取对应存储值（session / block meta / provider persona）。

### D3 后端 hook sessionId 回写（根修，provider 无关）

新增 `blockcontroller.PersistAgentSessionIdFromHook(blockId, sessionId string)`：

1. 入参空 → 直接返回。
2. 进程内 `sync.Map`（blockId → 已写 sid）去重，热路径零 DB 读。
3. `wstore.DBGet[*waveobj.Block]` 读当前 meta；`agent:sessionid` **非空则不覆盖**（保护 claude/pi 预铸 id、OSC 写入的 id）。
4. 复用现有 `persistAgentSessionId`（带 `ContextWithUpdates` + `SendUpdateEvents`，前端 block atom 会收到更新）。

调用点（两处上报入口，都是 hook 必经）：

- `pkg/service/blockservice/blockservice.go` `ReportAgentStatus`
- `pkg/wshrpc/wshserver/wshserver.go` `reportAgentStatus`（agent.status/recv-report）

判定抽成纯函数 `shouldPersistAgentSessionId(existing, sessionId string) bool` 以便单测。

### D4 不做的事

- 不预铸 opencode session id（opencode 自行生成，无法预注入）。
- 不做 opencode.db 磁盘回捕（成本高、多 block 同目录竞争，留作后续）。
- 不改进 opencode 钩子安装（`10-30-opencode-hook-verify`）。
- 不改 `isAgentTerminalMeta` / `getAgentIcon` 解析链。

## 兼容性 / 回滚

- 前端：`resolveAgentEmojiScope` 第 3 参可选，旧调用签名不变 → 现有单测全部继续通过（新增断言另加）。
- 后端：回写是幂等 best-effort，失败只打日志。回滚只需去掉两处调用。
