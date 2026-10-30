# P1 implement：origin 抽象层后端

## 改动文件

1. `pkg/aisessions/paths.go`：`ExternalOriginConfig` 类型、`ExternalProviders()`、`OriginProviders()`、`NewOriginManager()`、`originID()`、`knownSessionRoots()`、env 解析 `WAVETERM_AI_SESSIONS_EXTRA_ROOTS`。
2. `pkg/wconfig/settingsconfig.go`：`SettingsType` 加 `AiSessionExternalOrigins []aisessions.ExternalOriginConfig` 字段。
3. `pkg/wconfig/metaconsts.go`：`ConfigKey_nAiSessionExternalOrigins = "ai:sessions:externalorigins"`（如命名模式允许）。
4. `pkg/service/aisessionsservice/aisessionsservice.go`：
   - `AISessionsOrigin` / `AISessionsOriginsRequest/Response` 类型。
   - `AISessionsListRequest` / Detail / Stat 请求加 `Origin string`。
   - `managerForOrigin()` + 只读拦截。
   - `Origins()` RPC 方法。
   - `isKnownAISessionFilePath()` 改用 `knownSessionRoots()`。
5. `frontend/app/store/services.ts`：暴露 `Origins`。
6. 测试文件：`pkg/aisessions/paths_test.go`、`pkg/aisessions/origin_test.go`（新建）、`pkg/service/aisessionsservice/aisessionsservice_test.go`。

## 步骤

1. `paths.go`：加类型 + provider 工厂 + id 派生 + env 解析（先写测试再实现？TDD：先加测试）。
2. `settingsconfig.go` + `metaconsts.go`：配置字段。
3. `aisessionsservice.go`：类型 + `Origins` RPC + `managerForOrigin` + 白名单 + 只读拦截 + 请求字段。
4. `services.ts`：暴露 `Origins`。
5. 测试补全。

## 验证命令

- `go test ./pkg/aisessions/...` 
- `go test ./pkg/service/aisessionsservice/...`
- `go build ./...`
- 手动：`WAVETERM_AI_SESSIONS_EXTRA_ROOTS=~/Primary/MyData/pi` 启动，检查 `Origins` 返回 + `List({origin})`。

## 回滚点

- 每步一个 commit，回退即 `git revert` 到上一 commit。
- 先落"paths 配置层 + 测试"（纯函数，低风险），再落 service 路由（涉及 RPC），最后白名单。

## 风险与缓解

- `wconfig` 包类型引用 `aisessions.ExternalOriginConfig`：确认无 import 环（aisessions 不 import wconfig）。
- `Origins` 的 Count 可能触发扫描 → 必须走 `ScanAllSummaries`/`ScanListResult`，且带 budget。
- 只读拦截点要覆盖全写操作，否则可能绕过；用集中 helper 收口。
