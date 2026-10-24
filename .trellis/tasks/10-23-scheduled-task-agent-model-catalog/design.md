# Design: Agent Catalog（agent + 模型目录）基础能力

## 1. 现状事实

| 位置 | 事实 | 问题 |
|---|---|---|
| `frontend/app/view/scheduledtasks/scheduledtasks-view.tsx:10-24` | `AgentProfiles` / `PiModels` 硬编码 | 与用户配置脱节；非 pi 无法选模型 |
| `frontend/app/view/scheduledtasks/scheduledtasks-model.ts:31` | 默认草稿写死 `model: "deepseek-v4-pro"` | 与所选 agent 无关 |
| `pkg/scheduler/runner.go:135-158` | `resolveAgentProfile` 自行读 `agent:profiles` | 事实来源 #2 |
| `pkg/wconfig/settingsconfig.go:59` | `AgentProfileConfigType{Cmd,Args,Model,ModelFlag,CmdEnv}` | 没有模型列表字段 |
| `frontend/app/workspace/agent-launch.ts:57-75,286` | `BuiltinAgentProfiles` + `getAgentProfileOptions` | 事实来源 #3；且按「命令是否被检测到」过滤 |
| `pkg/agentcap/agentcap.go` | agent 能力指南（`wsh data guide`） | agent 无法发现「能开哪些 agent / 用什么模型」 |

结论：同一个概念有 3 套来源。本期合并为一个后端目录，前端与执行侧都消费它，并为
「agent 创建 agent Block」预留契约。

## 2. 数据模型

### 2.1 Go 类型（`pkg/wconfig/settingsconfig.go`）

```go
type AgentModelConfigType struct {
    Id       string `json:"id"`
    Label    string `json:"label,omitempty"`
    Provider string `json:"provider,omitempty"`
    Default  bool   `json:"default,omitempty"`
}

type AgentProfileConfigType struct {
    Label     string                 `json:"label,omitempty"`     // 新增：UI 显示名
    Cmd       string                 `json:"cmd,omitempty"`
    Args      []string               `json:"args,omitempty"`
    Model     string                 `json:"model,omitempty"`      // 默认模型（保持兼容）
    Models    []AgentModelConfigType `json:"models,omitempty"`     // 新增：可选模型列表
    ModelFlag string                 `json:"modelflag,omitempty"`
    CmdEnv    map[string]string      `json:"env,omitempty"`
}
```

`models` 与 `model` 同时存在时：`model` 仍是默认项，`models` 是候选集合（`model` 会自动补入集合，
避免「默认模型不在下拉里」）。

配置示例：

```jsonc
{
  "agent:profiles": {
    "pi": {
      "cmd": "pi",
      "modelflag": "--model",
      "model": "deepseek-v4-pro",
      "models": [
        { "id": "deepseek-v4-pro", "label": "DeepSeek V4 Pro", "provider": "deepseek", "default": true },
        { "id": "gpt-5", "label": "GPT-5", "provider": "openai" }
      ]
    }
  }
}
```

`schema/settings.json` 由 `cmd/generateschema` 重新生成，不手写。

### 2.2 目录输出类型（`pkg/agentcatalog`）

```go
type ModelInfo struct {
    Id       string `json:"id"`
    Label    string `json:"label"`
    Provider string `json:"provider,omitempty"`
    Default  bool   `json:"default,omitempty"`
    Source   string `json:"source"` // config | builtin | profile-model
}

type ProfileInfo struct {
    Name         string      `json:"name"`
    Label        string      `json:"label"`
    Cmd          string      `json:"cmd"`
    ModelFlag    string      `json:"modelflag,omitempty"`
    DefaultModel string      `json:"defaultModel,omitempty"`
    Models       []ModelInfo `json:"models"`
    Source       string      `json:"source"` // builtin | config
}
```

`ProfileInfo` 就是 RPC / `wsh agent list --json` / 未来 Block 创建共用的结构。

## 3. 目录解析规则（`pkg/agentcatalog/catalog.go`）

```
List() []ProfileInfo:
  profiles = builtin map (pi, codex, claude, gemini, opencode)
  for name, cfg in config["agent:profiles"]:
      profiles[name] = merge(builtin[name], cfg)   // cfg 覆盖，models 取并集
  sort: 用户默认 profile 优先？→ 按 name 排序，前端再把 agent:defaultprofile 置顶

merge:
  cmd      = cfg.cmd      || builtin.cmd
  modelflag= cfg.modelflag|| builtin.modelflag
  label    = cfg.label    || builtin.label || name
  models   = dedupeById(cfg.models) → 若空，用本地 discovery
           → 若仍空且 cfg.model 非空，用 [{id: cfg.model, source: profile-model}]
  defaultModel = 第一个 config default:true
               || cfg.model
               || discovery default:true
               || models[0].id
  // cfg.model 若不在 models 中，前置插入一条 source=profile-model 的项
```

模型来源改为 **各 agent 自己的本地配置**（不再内置静态表）：

| agent | 来源 | 默认模型 |
|---|---|---|
| `pi` | `$PI_CODING_AGENT_DIR/models.json` → `providers.<p>.models[]` | `settings.json` `defaultProvider`+`defaultModel` |
| `codex` | `$CODEX_HOME/models_cache.json`（`visibility=list`）+ `config.toml` 顶层 `model` | 顶层 `model` |
| `claude` | `$CLAUDE_CONFIG_DIR/settings.json` env `ANTHROPIC_MODEL` / `ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU}_MODEL` | `ANTHROPIC_MODEL` |
| `opencode` | `$OPENCODE_HOME/opencode.json[c]` 的 `provider.*.models` | 顶层 `model` |
| `gemini` | `$GEMINI_CONFIG_DIR/settings.json` 的 `model` / `selectedModel` | 同左 |

discovery 只读文件、不跑子进程、不写用户数据；`pi --list-models`（约 11s）与 `opencode models`（约 6s）
不进同步 RPC，只留作后续 resolver。详见 `research/agent-model-sources.md`。

**扩展点**：`type ModelResolver func(name string, cfg AgentProfileConfigType) []AgentModelConfigType`。
后续接 cc-switch vendor 模型或 `agent --list-models` 探测时，只加 resolver，不改 RPC 结构。

## 4. RPC

`pkg/wshrpc/wshrpctypes.go`：

```go
AgentProfileListCommand(ctx context.Context) ([]agentcatalog.ProfileInfo, error)
```

- 常量：`Command_AgentProfileList = "agentprofilelist"`（`wshrpctypes_const.go`）
- 实现：`pkg/wshrpc/wshserver/agentprofile.go`（新文件，薄封装 `agentcatalog.List()`）
- 生成：`go run cmd/generatets/main-generatets.go` 更新 `frontend/types/gotypes.d.ts`
  与 `frontend/app/store/wshclientapi.ts`；`go run cmd/generateschema/main-generateschema.go` 更新 schema。

不在 RPC 层缓存：目录计算是内存 map 合并，成本可忽略；配置广播后天然得到新值。

## 5. 执行侧（`pkg/scheduler/runner.go`）

- 删除 `resolveAgentProfile` 中的重复内置表，改为：

```go
profile := agentcatalog.Resolve(task.AgentProfile)
if task.Model == "" { task.Model = profile.DefaultModel }  // 用目录默认
if task.Model != "" && profile.ModelFlag != "" { argv = append(argv, profile.ModelFlag, task.Model) }
```

- 「model 不在列表」只 `log.Printf` 告警，**不阻断**（用户可能正在用新模型）。
- `task.AgentCmd` 覆盖逻辑保留（显式路径优先）。

## 6. 前端

### 6.1 目录加载（`frontend/app/workspace/agent-catalog.ts` 新文件）

参照 `ccswitch-vendors.ts` 的缓存模式，但数据来自 RPC：

```ts
export type AgentModelInfo = { id: string; label: string; provider?: string; default?: boolean; source?: string };
export type AgentProfileInfo = {
    name: string; label: string; cmd: string; modelflag?: string;
    defaultModel?: string; models: AgentModelInfo[]; source?: string;
};

export async function loadAgentCatalog(force?: boolean): Promise<AgentProfileInfo[]>
export function invalidateAgentCatalog(): void          // 配置更新事件时调用
export function pickDefaultModel(profile: AgentProfileInfo | null): string
export function modelOptionsFor(profile, currentModel): AgentModelInfo[] // 补入当前值
```

- 模块级 `Promise` 缓存 + 60s TTL，与 `ccswitch-vendors.ts` 一致。
- `fullConfigAtom` 变化时失效（在 `scheduledtasks-model` 里订阅即可，或全局监听 config 广播）。

### 6.2 ScheduledTasks model（`scheduledtasks-model.ts`）

新增 atom：

```ts
agentCatalogAtom: PrimitiveAtom<AgentProfileInfo[]>
catalogLoadingAtom: PrimitiveAtom<boolean>
```

- `refreshCatalog()` 调 `env.rpc.AgentProfileListCommand`，失败时退回 `[]` 并保留旧值。
- `openCreate()` 不再写死 `agentProfile: "pi" / model: "deepseek-v4-pro"`：
  取目录里 `agent:defaultprofile` 或第一个 profile，model 取其 `defaultModel`。
- `openEdit()` 若任务 model 为空，补 profile 默认模型用于显示（不改持久化值，除非用户保存）。
- `save()` 前不强制校验 model 是否在列表（老数据允许）。

`ScheduledTasksEnv` 增加该 RPC 类型。

### 6.3 View（`scheduledtasks-view.tsx`）

- 删除 `AgentProfiles`、`PiModels`。
- `EditorOverlay`：

```tsx
const profiles = jotai.useAtomValue(model.agentCatalogAtom);
const profile = profiles.find(p => p.name === form.agentProfile) ?? null;

<select value={form.agentProfile} onChange={e => {
    const next = profiles.find(p => p.name === e.target.value);
    setForm(f => ({ ...f, agentProfile: e.target.value, model: next?.defaultModel ?? "" }));
}}>
  {profiles.map(p => <option key={p.name} value={p.name}>{p.label}</option>)}
</select>

{models.length > 0 ? (
  <select value={form.model ?? ""} onChange={...}>
     {models.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
  </select>
) : (
  <input value={form.model ?? ""} onChange={...} placeholder="Default (agent chooses)" />
)}
```

- 模型 option 文本：有 provider 时 `label (provider)`，否则 `label`。
- 空目录（RPC 失败）时保留一个降级：agent 用 `<input>` 自由填写，不让编辑器不可用。
- 表格的 Agent/Model 列改为显示 profile 的 `label`（找不到时退回原名）。

## 7. agent 侧基础能力

### 7.1 CLI（`cmd/wsh/cmd/wshcmd-agent.go` 新文件）

```
wsh agent list            # 表格：NAME LABEL DEFAULT-MODEL MODELS
wsh agent list --json     # 原样输出 []ProfileInfo
```

只读，鉴权走现有 wsh RPC 通道（`AgentProfileListCommand`）。

### 7.2 `pkg/agentcap`

指南加一段：

```
Agent Catalog
- wsh agent list --json  → 可用 agent（profile）、cmd、modelflag、默认模型与模型列表
- 该结构与定时计划 UI 同源；创建 agent Block 时应使用同一 profile/model 解析规则
```

## 8. 未来扩展：agent 创建 agent Block（本期只定契约）

固定命令形状，不实现：

```go
type CommandAgentBlockCreateData struct {
    TabId      string  `json:"tabid"`
    Profile    string  `json:"profile"`             // AgentProfileList 里的 name
    Model      string  `json:"model,omitempty"`     // 空 = profile.defaultModel
    Prompt     string  `json:"prompt,omitempty"`    // 首条输入
    Workdir    string  `json:"workdir,omitempty"`
    Connection string  `json:"connection,omitempty"`
    Magnified  bool    `json:"magnified,omitempty"`
    Focused    bool    `json:"focused,omitempty"`
}
AgentBlockCreateCommand(ctx, data) (*waveobj.ORef, error)
```

实现要点（后续任务）：后端复用 `agentcatalog.Resolve` 得到 `cmd/args/modelflag`，
构造 `BlockDef{meta:{view:"term",controller:"cmd",cmd,cmd:args,agent:*}}` 后走现有
`CreateBlockCommand`，从而保证「UI 创建的 agent Block」与「agent 自己创建的 agent Block」一致。
因此本期目录结构必须包含 `cmd / modelflag / defaultModel / models`，不再有第二来源。

## 9. 兼容与回滚

- `AgentProfileConfigType` 只加字段，老配置自动可用；`models` 缺省时行为等同现状。
- 前端若 RPC 失败，回落为「agent 自由输入 + model 自由输入」，编辑器不废。
- 回滚点：目录包 + RPC 是可独立删除的增量；UI 侧保留旧硬编码可作为单 commit 回滚。
- 风险：用户 `models` 里写了非法 id → 只影响自己，runner 仍按原值执行。

## 10. 测试

- Go：`pkg/agentcatalog/catalog_test.go`
  - 无配置 → 内置 5 profile
  - 配置覆盖 cmd/modelflag/label
  - `models` 合并 + 去重 + default 解析
  - `model` 不在 `models` → 自动补入且为默认
  - 无 models → profile-model 单项；再为空 → 空列表
- Go：`pkg/scheduler/runner_test.go` 增补「未指定 model 用默认」「profile 覆盖」。
- 前端：`scheduledtasks-model.test.ts`（纯函数 `pickDefaultModel` / `modelOptionsFor`）。
- 手工：`wsh agent list --json` 与 UI 下拉一致性核对。