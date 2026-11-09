# opencode agent block 会话级 emoji 串扰修复

## Goal

opencode 新会话 block 拿不到 session id，emoji picker 退回 provider 级写入，导致「改一个 block 的 emoji = 全部 opencode 会话一起变」。
本包做两件事：

1. **前端止血**：session id 未知但 picker 由具体 block 打开时，提供 block 级（`agent:emoji` meta）写入，把 provider 级写入降级为需要用户显式选择；不再静默覆盖整个 provider。
2. **后端根修**：`ReportAgentStatus` 收到 hook 上报的 `sessionId` 后回写 block meta `agent:sessionid`，让会话级 emoji / Note / Outline 等依赖持久化 session id 的能力对所有 provider 生效（尤其 opencode，后端没有预铸也没有磁盘回捕）。

## 背景（已排查确认）

- `resolveAgentSessionId`（`frontend/app/view/term/agent-session.ts`）只从 `agent:sessionid` / 启动命令解析；新开 opencode 命令无 `--session` → 空。
- 后端 `pkg/blockcontroller/shellcontroller.go` 只有 claude/pi 预铸 session id、codex 磁盘回捕，**opencode 没有任何 capture**；OSC 绑定把 `agent:sessionid` 显式置 null（`frontend/app/view/term/osc-handlers.ts`）。
- opencode 唯一的 live 来源是 agent-status 插件上报的 `event.properties.sessionID`（`pkg/agentstatus/hookinstall.go`），但本机插件未安装，且 bend 后上报值只存在内存 status 里、不落 block meta。
- picker 在 `sessionKey === ""` 时折叠成 provider scope（`frontend/app/agent-persona/persona-scope.ts`、`frontend/app/view/term/agent-emoji-picker.tsx`），写入 `setAgentPersona(provider)` → 所有同 provider 会话共享。

## Requirements

### R1 前端：block 级 emoji scope

- `AgentEmojiScope` 增加 `"block"`；`resolveAgentEmojiScope` 在「请求 session 但无 sessionId」时，若存在 blockId 则折叠到 `block`，否则维持 `provider`。
- `AgentEmojiWriteTarget` 增加 `{ kind: "block"; blockId: string }`；picker 应用时写 block meta `agent:emoji`（`AgentEmojiMetaKey`），清空时把该 meta 置 null。
- picker 从 `picker-host` 接收 `blockId`；无 blockId 的面（历史列表行）行为不变。
- 无 sessionId 时 UI 文案改为「未识别到当前会话 ID」，并提供「仅此标签页」radio 作为默认；provider 级仍可主动选择，但必须点击。
- `getAgentIcon` 已支持 block meta `agent:emoji`，不改解析链。

### R2 后端：hook sessionId 回写 block meta

- `pkg/service/blockservice/blockservice.go` 的 `ReportAgentStatus`：Report 成功后若 `status.SessionId != ""`，异步检查 block meta；当 `agent:sessionid` 为空时 SetMeta 回写（幂等、失败仅记录日志、不阻塞状态上报）。
- 同一逻辑在 `pkg/wshrpc/wshserver/wshserver.go` 的 HTTP/wsh 侧上报入口保持一致（若两处都调用 agentstatus.Report）。
- 不得覆盖已存在的 `agent:sessionid`（避免与 claude/pi 预铸 id 打架）。

### R3 测试

- `persona-scope` 纯函数单测：有无 sessionId / blockId 的四象限折叠与写目标。
- picker host / picker 组件测试补充 block 级写入路径（或在现有 `agent-emoji-picker-host.test.tsx` 扩展）。
- Go 单测：sessionId 回写 meta 的判定纯函数（无 sid / 已有 sid / 空 meta 三种）。

## Constraints

- 不改 `isAgentTerminalMeta` 语义（多调用方高风险）。
- 不触碰 opencode 钩子安装流程（属于 `10-30-opencode-hook-verify`）。
- 不引入新依赖；不写第二个 emoji 存储（复用 block meta + 现有 store）。
- 不把 provider 级写入完全删除：用户明确选择时仍需可用。

## Acceptance Criteria

- [ ] `node --test`（或仓内前端测试脚本）中 `persona-scope` 新单测通过：无 sessionId + 有 blockId → scope `block`、写目标 `{kind:"block"}`。
- [ ] `go test ./pkg/service/blockservice/...`（或对应包）通过，新增回写判定单测通过。
- [ ] 手动/静态验证：两个 opencode block 并存，给 A 设 emoji，`localStorage ["snorkeling:agent-session-emojis"]` 与 provider persona 均未变化，B 的图标不变。
- [ ] picker 无 sessionId 时首屏即显示「仅此标签页」选中项，且不再出现「只能应用到所有 X 会话」这类强制结论。
- [ ] 有 sessionId 的路径（历史列表行、resume 会话）行为与改动前完全一致。

## Notes

- 真机像素/交互回归留给后续（`opencode agent-status 钩子真机验证` 任务）。
