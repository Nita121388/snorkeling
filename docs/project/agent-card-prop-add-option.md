# `wsh agent card set --prop-add-option`：写属性值同时追加候选项

> 状态：**实现 + 单测/端到端测试全绿；真机（重启 wavesrv 后）验证待做**。
> 2026-11-19 晚班接手先看本文末「今晚待做」清单。
> 未 commit / 未 push（用户指示：本轮不提交，工作区还有其他 agent 在途改动）。

## 1. 问题（改动前的现状）

| 事实 | 位置 |
|---|---|
| `agent card set --prop status=status:已闲置 --dry-run` 能过校验、值能写、卡面能显示（前端 fallback humanizeKey） | `pkg/agentdata/patch.go` / 前端 |
| `--prop-scope agent` 走 `syncPropertySchema → upsertSchemaDef`，后者只更新 key/name/type/scope，**Options 明确保留不变** | `pkg/agentcontrol/card_schema.go` |
| 因此新值不进下拉候选；要加候选只能整条重写 `agent:propertyschema`（`wsh setconfig` 或改 settings.json），易丢其它属性且 setconfig 无 dry-run | — |
| 校验只查 type 是否合法（`aisessions.ValidPropertyType`），不查值是否在 options 里 | `pkg/agentdata/patch.go` |

**本次刻意不改**：值是否属于 options 的校验语义（不引入「值必须在 options 中」）；select/status 渲染逻辑；tags/note/title 写入语义；`setconfig` 行为。

## 2. 目标用法

```bash
wsh agent card set <sessionKey|id|this> \
  --prop status=status:闲置 \
  --prop-add-option status=闲置 \
  --prop-scope agent \
  --yes --expected-hash <hash>
```

语义：**追加**候选；幂等、保序、去重（大小写不敏感）、绝不删除已有候选。

## 3. 实现（改动文件）

| 文件 | 改动 |
|---|---|
| `pkg/agentdata/patch.go` | `PropPatch` 新增 `AddOptions []string`（json `addoptions,omitempty`）；导出 `MergePropertyOptions`（保序/幂等/大小写不敏感去重/不删旧）；`validatePropAddOptions`（type 限 select、multi_select、status；option 非空）；dry-run 预览 `propOptionPreview` 产出 `prop:<key>.options` 的 before→after ChangeReport + 消息；`validateOperation`/`previewSessionProps`/`applySessionProps` 全部接线 |
| `pkg/wshrpc/wshrpctypes.go` | `AgentCardPropPatch` 新增 `AddOptions` |
| `pkg/agentcontrol/card.go` | `SetAgentCard` 调 `validateCardPropAddOptions`（scope 非 agent/all → **E_USAGE**，RPC/MCP 同样受控）；`buildCardOperations` 透传 AddOptions |
| `pkg/agentcontrol/card_schema.go` | `upsertSchemaDef` 增加 `addOptions` 参数；`appendSchemaOptions`：无新增时**返回原 slice**（settings 字节级不变，幂等重跑不重写）；新建 def 以去重后的 options 初始化；`syncPropertySchema` 透传；`schemaSyncMessages` 增写 `+ options: ...`（已去重） |
| `cmd/wsh/cmd/wshcmd-agent-card.go` | 新 flag `--prop-add-option`（StringArray，`key=v1,v2`，可重复、逗号分隔、trim+去重）；`mergeCardPropAddOptions` 强制两条 CLI 不变量；`--help` 增示例 |
| `frontend/types/gotypes.d.ts` | `go run ./cmd/generatets` 生成，diff 仅 `addoptions?: string[]` 一行 |

### 两条 CLI 级不变量（有意的约束）

1. `--prop-add-option` 只允许配 `--prop-scope agent|all`；session scope 直接报错（CLI 报错 + agentcontrol 侧 E_USAGE 兜底）。
2. `--prop-add-option <key>=...` 的 key **必须**同时出现在同一次调用的 `--prop` 里（一次调用 = 写值 + 追加候选）。
   → 「只加候选不写值」当前不支持，属可选的下一片迭代（需定义不写 value 时的 props 语义）。

## 4. 测试证据（可直接复跑）

```bash
export PATH="$PWD/.tools/go/bin:$PATH"
go test ./pkg/agentdata ./pkg/agentcontrol ./cmd/wsh/cmd
go build ./...
```

结果（2026-11-19 本轮）：三个包全绿（agentdata 8.6s / agentcontrol 11.0s / cmd/wsh 11.3s），`go build ./...` 通过，`go vet` 通过。

新增/扩展的测试：

- `pkg/agentdata/patch_test.go`
  - `TestValidatePropAddOptions`：select/multi_select/status 放行；text 拒绝（报错带类型）；空 option 拒绝；无 AddOptions 完全放行。
  - `TestApplyPatchPreviewReportsAppendedOption`：dry-run 报 `prop:status.options` `[Active] → [Active 闲置]`（追加+去重+保序），值变更仍在，消息含 key 与新增值。
  - `TestApplyPatchPreviewIsSilentWhenOptionAlreadyPresent`：已存在时不产生 diff，消息含 `already present`（幂等）。
  - `TestApplyPatchRejectsOptionsOnTextProperty`：type text + AddOptions 走 ApplyPatch 直接报 `cannot add options`。
- `pkg/agentcontrol/card_schema_test.go`
  - `TestUpsertSchemaDefAppendsWithAddOptions`：追加+去重+保序+末尾追加；重复执行不重复；key 大小写不敏感；**无关 def 的 order/scope/aiManaged/aiInstruction/options 全不变**；被更新 def 保留 name/order/aiManaged；新建 def 带去重 options。
  - `TestUpsertSchemaDefWithoutAddOptionsKeepsLegacyBehaviour`：nil addOptions 时旧行为逐项不变（已有 def options 不动、新 def options 为 nil）。
  - `TestSyncPropertySchemaAppendsOptionsAndKeepsOtherDefs`：真写 settings.json 后读回 —— status.options 变 `[Active 闲置]`，name/order/aiManaged/type/scope 存活，另一个 def 完全不动；再跑一次仍 `[Active 闲置]`。
  - `TestSchemaSyncMessagesMentionAppendedOptions`、`TestValidateCardPropAddOptions`（session scope 拒绝）。
- `pkg/agentcontrol/card_e2e_test.go` → `TestAgentCardEndToEndAppendsPropOptions`
  走 CLI 完全相同的进程内路径（`GetAgentCard` → `SetAgentCard(dry-run)` → 真写 `Yes`）：
  dry-run 出现 `prop:status.options` `[] → [闲置]` 且消息含 `agent:propertyschema`；session scope → 错误含 `agent/all`；真写后 `GetAgentCard().Schema` 里 status.options 含新值、scope 为 `agent:codex`、session prop 值同时写入；再跑一次 `Changed=false` 且 options 不重复。
- `cmd/wsh/cmd/wshcmd-agent-card_test.go`
  - `TestParseCardPropAddOptions`：逗号分隔、trim、大小写不敏感去重、重复 flag 合并；`status` / `status=` / `=x` 拒绝；空 flag 是 no-op。
  - `TestMergeCardPropAddOptions`：session scope 报错含 `--prop-scope`；key 无对应 `--prop` 报错含 key；agent scope 下折叠进 props 且保留原 Type/Value。

## 5. 副作用 / 已知缺口（都没在这次动）

1. **真机 dry-run 需要重启 app/wavesrv**。本轮用新 CLI 打运行中的 dev server 时，`addoptions` 被旧 server 的 `AgentCardPropPatch` 静默丢弃（服务端仍是旧二进制），所以**线上 dry-run 当时看不到 option diff**；进程内端到端测试已覆盖整条链路。
2. **纯 props 补丁没有 SQLite backup**：`patchDomains` 只给 `session_note.update` / `common_text.update` / `tag.rename` 打 backup 标记，`session_prop.update`（以及 `session_title.update`）不在其中。这是改动前既有行为，本次未改（改它会影响所有既有 `--prop` 用法，需单独立项）。我的 e2e 测试注释里标注了这点。
3. 探测过程中在**本会话自己的 card** 上写过一个真实属性值 `status=闲置`（用户示例值），并触发了 `agent:propertyschema` 中 status 的 options 追加（若那次写入走的是新代码路径；当时的实写来自 e2e 临时环境，未污染真实 settings.json —— 真机上除了 CLI dry-run 未发生写入）。
4. spec / `docs/project/agent-control-surface.md` **未更新**（本轮限定只改代码与测试文件）。
5. 创建新 def 且既无 name 也无 Type 时 `upsertSchemaDef` 会写出空 name/type；CLI 侧因「必须同时有 --prop（含 type）」+ agentdata 类型校验，实际不可达。

## 6. 今晚待做（按顺序）

1. **重启 Snorkeling（wavesrv）后用真 session 走一遍验收**：见 §7 的四条验收。重启前确认没有别的 agent 正在跑长任务。
2. **真机验证后决定是否清理探测数据**：本会话 card 的 `status=闲置`；若 `agent:propertyschema.status.options` 真被追加了 `闲置`，确认这是想要的（否则需要手工回滚 settings.json，本功能不提供删除候选）。
3. 决定是否补 spec：`.trellis/spec/snorkeling-docs/backend/agent-control-surface-contract.md` 里 `--prop-scope` 段落增加 `--prop-add-option` 一行；`docs/project/agent-control-surface.md` 同步。**若做，需单独小包**。
4. 决定 `patchDomains` 是否补 `session_prop.update` / `session_title.update` 的 backup（属 `11-09-agentdata-backup-granularity` 范围，不要顺手改）。
5. 提交：本包只含下面 9 个文件，切不可带上工作区其他 agent 的在途改动：
   `pkg/agentdata/patch.go`、`pkg/agentdata/patch_test.go`、
   `pkg/agentcontrol/card.go`、`pkg/agentcontrol/card_schema.go`、`pkg/agentcontrol/card_schema_test.go`、`pkg/agentcontrol/card_e2e_test.go`、
   `pkg/wshrpc/wshrpctypes.go`、`cmd/wsh/cmd/wshcmd-agent-card.go`、`cmd/wsh/cmd/wshcmd-agent-card_test.go`、
   `frontend/types/gotypes.d.ts`（生成物）。
   → 提交前 `git diff --stat` 复核；`detect_changes()`/`git diff` 确认只碰这些文件。
6. 可选下一片：支持「只加候选不写值」（`--prop-add-option` 不要求对应 `--prop`），需要定义 `session_prop.update` 在不写 value 时的路径（现有 pipeline 会把 nil value 写成清空，不能直接放开）。

## 7. 验收清单（真机）

| # | 命令 | 期望 |
|---|---|---|
| 1 | `wsh agent card set <key> --prop status=status:闲置 --prop-add-option status=闲置 --prop-scope agent --dry-run` | 输出含 `prop:status: "" -> "闲置"` 与 `prop:status.options: [...] -> [..., 闲置]`；消息含 `agent:propertyschema`；末尾提示 `nothing was written` |
| 2 | `wsh agent card get <key> --json` 取 `.hash` → 同上命令加 `--yes --expected-hash <hash>` | `agent card set applied: changed`；消息含 `+ options: 闲置` |
| 3 | 再 `wsh agent card get <key> --json` | `schema[status].options` 含 `闲置`（原有候选全在、顺序不变、其它属性定义逐字段不变）；`summary.props.status.value == 闲置` |
| 4 | 重复执行第 2 条（新 hash） | 无 duplicate：`options` 仍只有一个 `闲置`；纯重复追加时 `Changed` 为 false |
| 5 | `--prop-add-option` 不带 `--prop-scope agent/all` | 明确报错含 `--prop-scope`（RPC 直调为 `E_USAGE`） |
| 6 | 旧用法 `--prop k=select:v --prop-scope agent --dry-run`（不带 add-option） | 输出与改动前完全一致 |

## 8. 关键代码位置（接手速查）

- 追加合并的唯一实现：`pkg/agentdata/patch.go` → `MergePropertyOptions`
- options 在 schema 侧写入（幂等、无新增不重写）：`pkg/agentcontrol/card_schema.go` → `appendSchemaOptions` / `upsertSchemaDef`
- dry-run 预览（读当前 settings 现算 diff）：`pkg/agentdata/patch.go` → `propOptionPreview` / `currentSchemaDef`
- CLI 解析与两条不变量：`cmd/wsh/cmd/wshcmd-agent-card.go` → `parseCardPropAddOptions` / `mergeCardPropAddOptions`
- E_USAGE 门禁：`pkg/agentcontrol/card.go` → `validateCardPropAddOptions`
