# P1 design：origin 抽象层后端

## 数据模型

```go
// pkg/aisessions/types.go 或 paths.go
type ExternalOriginConfig struct {
    Label    string `json:"label"`
    Path     string `json:"path"`
    Source   string `json:"source,omitempty"`   // 缺省 "pi"
    ReadOnly bool   `json:"readOnly,omitempty"`  // 缺省 true
}
```

- 稳定 id：`originID(path)` = 路径绝对 + 规范化后的短哈希（如 sha1 前 12 位），或 path 派生 slug。local 固定 id `"local"`。
- safe 文件名：`safeID(id)` = Replacer 把 `/ \ :` 换成 `_`。

## 配置读取

> 依赖方向已确认：`pkg/aisessions` 已 import `pkg/wconfig`（titleautogen/promptregistry 使用），
> 因此外部根配置类型**必须定义在 wconfig**，若放 aisessions 再让 wconfig 引用会成环。

- wconfig 新增（settingsconfig.go）：
  ```go
  type AiSessionExternalOriginType struct {
      Label    string `json:"label"`
      Path     string `json:"path"`
      Source   string `json:"source,omitempty"`
      ReadOnly *bool  `json:"readonly,omitempty"` // 缺省 true，指针以区分 unset
  }
  ```
  挂到 `SettingsType`：`AiSessionExternalOrigins []AiSessionExternalOriginType `json:"ai:sessions:externalorigins,omitempty"``
- 读取方式（沿用现有惯例）：
  ```go
  cfg := wconfig.GetWatcher().GetFullConfig()
  origins := cfg.Settings.AiSessionExternalOrigins
  ```
  在 `pkg/aisessions` 内做 `~` 展开、路径校验、转成内部 `ExternalOrigin` 结构。
- env `WAVETERM_AI_SESSIONS_EXTRA_ROOTS`：`:` 分隔路径，label=path basename，source=pi，readOnly=true。
- 路径展开 `~`：`os.UserHomeDir()` 替换前缀。

## manager 工厂

在 `aisessions` 包新增（不依赖 wconfig，直接吃已解析的 config 列表）：

```go
func OriginProviders(origins []ExternalOriginConfig) ([]Provider, map[string]OriginMeta)
func NewOriginManager(origin ExternalOriginConfig) *Manager  // 独立 SQLitePath/MetaPath
func LocalManagerOptions() ManagerOptions                     // 现有 newLocalManager 等价
```

- 每个外部 origin 的 manager：
  ```go
  aisessions.NewManagerWithOptions(ManagerOptions{
      Providers:      []Provider{NewPiProvider(absPath)},
      SQLitePath:     originSQLitePath(id),
      MetaPath:       originMetaPath(id),
      OnScanProgress: ..., OnTitleUpdated: ..., OnGenerationStatus: ...,
  })
  ```
- 失败（路径不存在/非目录/无 jsonl）→ 不入列。

## service 路由

```go
func (svc *AISessionsService) managerForOrigin(ctx, originID string) (*Manager, OriginMeta, error) {
    if originID == "" || originID == "local" {
        return newLocalManagerWithMeta(), localMeta, nil
    }
    // 从缓存/配置取外部 origin
    meta, ok := svc.lookupOrigin(originID)  // 找不到 → error
    if !ok { return nil, ..., fmt.Errorf("unknown origin %q", originID) }
    if meta.ReadOnly {
        // 返回只读 manager（Providers 不含可写后端；写操作时拦截）
    }
    return NewOriginManager(meta.Config), meta, nil
}
```

- `List`/`Detail`/`Summary`/`Stat` 等入口把 `request.Origin` 传进 `managerForOrigin`。
- 只读拦截：在写操作（Delete/Mark/Note/NoteAndTags/RenameTag/AutoGenerate/RestoreContext/Annotation*）开头检查 origin 的 ReadOnly → 返回 `fmt.Errorf("origin %q is read-only", originID)`。

## Origins RPC

```go
type AISessionsOrigin struct {
    ID, Label, Path, Kind, Source string
    ReadOnly bool
    Count    int
}
func (svc) Origins(ctx, req) (*AISessionsOriginsResponse{Origins:[]AISessionsOrigin}, error)
```

- Count：对每个 origin 做一个轻量 `List(ctx)`（受 scan 契约约束，预算到期部分返回）；失败返回 0，不阻塞整个响应。
- 排序：local 第一，其余按 label。

## 白名单

`isKnownAISessionFilePath` 改为接收一组已知根（从配置 + 本机默认根算），而非硬编码 codex/claude。新增 helper：

```go
func knownSessionRoots() []string  // codex + claude + pi + 外部根
```

保持"必须在已知根内"语义。

## 测试

- `TestDefaultProviders_ExternalRootsRegistered`：env 设 `WAVETERM_AI_SESSIONS_EXTRA_ROOTS`，断言 Pi provider 数量匹配 + origin meta 正确。
- `TestManagerForOrigin_UnknownReturnsError`：未知 id 报错。
- `TestIsKnownAISessionFilePath_IncludesExternalRoot`：外部根内文件放行、根外拒绝。
- `TestReadOnlyOrigin_WriteRejected`：对 dump origin 调 Delete 返回错误。
- 端到端（手动）：配置指向 `~/Primary/MyData/pi`，`List({origin})` 返回会话。

## 风险

- wconfig 引入到 service 层需要确认 `GetSettings` 调用点；service 已是命令层，无环依赖风险。
- 外部根文件数（1398 jsonl）扫描需受 scan 契约预算约束（已实现，独立 scanKey）。
- 只读语义边界：P1 只在写 RPC 拦截；更细的"reveal/terminal"禁用由前端 P2 处理。
