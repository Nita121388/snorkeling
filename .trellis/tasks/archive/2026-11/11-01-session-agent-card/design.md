# 技术设计：会话 agent card 读写

## 1. 原则

**不新增写路径。** `agent card set` 只是把 CLI 参数翻译成 `agentdata.Patch`，
由现有 `agentdata.Apply` 完成校验、dry-run、备份、失败回滚与审计。

```
wsh agent card set
  ├─ resolve session (key/id/this) ──► aisessions.Manager.Summary
  ├─ 组装 agentdata.Patch{version:1, operations:[...]}
  ├─ --dry-run ──► agentdata.Apply{DryRun:true} ──► 字段级 diff
  └─ --yes     ──► agentdata.Apply{Yes:true}     ──► 备份 + 写 + 审计
```

## 2. 新增 patch operation

### 2.1 `session_title.update`

```json
{ "type": "session_title.update", "sessionKey": "...", "title": "...", "force": false,
  "expectedHash": "..." }
```

字段白名单：`type/sessionKey/title/force/expectedHash/expectedUpdatedAt`。

实现：

```go
// pkg/aisessions/manager.go
// SetAITitle 写入 AI 来源标题；titleSource=="user" 且 !force 时返回 ErrTitleProtected。
func (m *Manager) SetAITitle(ctx context.Context, identifier, title string, force bool) (SessionSummary, error)
```

- 内部复用 `setAutoTitle` 的存储逻辑（sqlite `SetAutoTitle` + meta `SetAutoTitle`），
  避免与 `SetTitle`（user 通道）冲突；遵守 title contract §3 的 `setMetaTx` 合并规则
  （写 ai-title 不得动 note/tags/marked）。
- 返回哨兵错误 `ErrTitleProtected`，由 `agentdata` 映射为 `E_CONFLICT`。

### 2.2 `session_prop.update`

```json
{ "type": "session_prop.update", "sessionKey": "...", "force": false,
  "props": { "优先级": { "type": "select", "value": "P1" } },
  "expectedHash": "..." }
```

字段白名单：`type/sessionKey/props/force/expectedHash/expectedUpdatedAt`。

实现：把 `props` 转成 `[]aisessions.PropertySuggestion`，直接调用现有
`Manager.ApplyAIProperties(ctx, identifier, suggestions, force)`：
- 内置键拒绝（已有）；
- `ValidPropertyType` + `ValidatePropertyValue`（已有）；
- `source=user` 跳过 / `force` 覆盖（已有）；
- 返回 `skipped[]` 原样进 `OperationReport.Messages`。

**不新增 props 写逻辑**，只在 agentdata 里加一层适配。

## 3. `agentdata` 改动点

| 位置 | 改动 |
|---|---|
| `allowedFieldsForOperation` | 增加两个 op 的字段集合 |
| `validateOperation` | 增加必填校验（title 非空、props 非空、真实 apply 需 hash） |
| `previewOperation` | 增加 before/after（title、props 逐键） |
| `applyOperation` | 调用 `SetAITitle` / `ApplyAIProperties` |
| `PATCH_SCHEMA`（`pkg/agentcap`） | 增加两个 op 的 schema 与示例 |
| `docs/project/agent-data-patch.md` | 增加两个 op 的文档 |

## 4. CLI 解析

```go
// cmd/wsh/cmd/wshcmd-agent-card.go
type cardSetFlags struct {
    Title string; Note string; TagsSet, TagsAdd, TagsRemove []string
    Props map[string]aisessions.PropertyCell; Force, DryRun, Yes bool
}
```

- `--note @file` 读取文件（大小上限 256KB）。
- `--prop k=v` 类型推断：`bool`（true/false）→ `number`（json.Number）→ `string`。
  schema 里定义为 `select`/`multi_select` 的键，若用户只给值，按 `select` 处理（由 `ValidatePropertyValue` 判定）。
- `--prop-json` 允许显式 `{key: {type,value}}`。
- 一次调用生成一个 patch，operations 顺序：note/tags → title → props。
  `expectedHash` 来自 `card get`（同一次调用内若用户未提供，则 CLI 先自行 `card get` 一次）。

## 5. 错误映射

| 内部错误 | CLI code |
|---|---|
| `aisessions.ErrTitleProtected` | `E_CONFLICT`（附 `hint:"--force to override user title"`） |
| `agentdata` precondition mismatch | `E_CONFLICT` |
| op 字段/类型非法 | `E_USAGE` |
| session 不存在 | `E_NOT_FOUND` |

## 6. 测试

- `pkg/aisessions`：`SetAITitle`（user 保护 / force / 不影响 note/tags）、`ApplyAIProperties` 既有测试覆盖。
- `pkg/agentdata`：两个新 op 的 dry-run diff、前置条件、字段白名单、失败回滚。
- CLI：flag 组合、`--note @file`、`--prop` 类型推断、`--dry-run` 默认行为。
- 回归：现有 `session_note.update` 行为不变（golden 报告）。
