# 设计：pi/codex 会话模型解析

## 边界

改动只在 `pkg/aisessions`（两个 provider 的解析器）+ 单元测试。前端、RPC、
`pkg/service/aisessionsservice` 一律不动。

数据流（现状，已存在）：

```
会话文件 ──provider.Load──▶ []Message{Model}
        ──manager.Load───▶ detail.Messages
        ──chatcontrol.LiveSessionState 磁盘兜底：倒序找最后一个 Model != "" ──▶ ModelID/ModelName
        ──agent-runtime-metadata-store(source="session") ──▶ AgentHoverCard 副标题
```

缺的只是第一格的 `Model` 填充。

## pi（`provider_pi.go`）

pi v3 每条 assistant message 自带字段：

```json
{"type":"message","message":{"role":"assistant","provider":"deepseek","model":"deepseek-v4.1-flash",...}}
```

实现：

1. `piEntryMessages()` 从 `piMsgMap(value)["model"]` 读 `model`，写进它产出的每条 `Message.Model`。
   （该函数同时被全量解析与 `parsePiMessageDeltaLine` 复用，delta 顺带也有模型。）
2. `parsePiMessages()` 线性扫描时记 `type=="model_change"` 的 `modelId`，对
   `Model == ""` 的 assistant 消息做一次兜底填充。理由：`model_change` 在会话开张即写入，
   老版本 pi 或裁剪过的会话可能缺 per-message model。

不改树结构walk、不改 `annotatePiEntryMessages`。

## codex（`provider_codex.go`）

codex rollout 的模型挂在**每轮**的 `turn_context` 上：

```json
{"type":"turn_context","payload":{"turn_id":"...","model":"gpt-5.4",...}}
{"type":"response_item","payload":{"type":"message","role":"assistant",...}}
```

所以需要跨行状态。新增：

```go
type codexMessageParser struct{ model string }
func (p *codexMessageParser) parse(line []byte, seq int) ([]Message, bool) // turn_context 更新 p.model，response_item 产消息并打 Model
```

- `parseCodexMessages()` 用 `&codexMessageParser{}` 的 `parse` 方法（`parseJSONLFromReader` 接受
  `func([]byte,int)([]Message,bool)`，方法值可直接传）。
- 保留包级 `parseCodexMessageLine`（无状态）：`LoadMessageDelta` 与
  `remote_provider.go` 的远端 delta 仍用它。**已知取舍**：delta 路径没有 turn_context
  状态，尾部流式追加的消息可能缺 Model；首次全量 `Load` 已带，卡片走全量。

## 兼容性

- `Message.Model` 字段本就存在（`types.go:118`），只是这两个 provider 从没填。
- 老会话文件缺 model 字段 → 仍为空 → 卡片继续显示「未指定」，不回退成错误值。
- 不改变消息数量、Seq、ItemKey、树 walk 结果 → 详情页布局零影响。

## 回滚

单 commit，`git revert` 即回滚；无数据迁移、无配置项。
