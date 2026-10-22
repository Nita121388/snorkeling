# Design: Wave AI 探测按钮的密钥解析与可诊断错误

## 1. 问题定位（已用 curl 与代码核实）

- `aiutil.ResolveModelsEndpoint("https://api.inferaiapi.com/v1")` -> `https://api.inferaiapi.com/v1/models`（已有单测覆盖），**URL 拼装正确**。
- 该端点强制要求密钥：无 Authorization -> 401 `API_KEY_REQUIRED`；带无效 Bearer -> 401 `INVALID_API_KEY`。
- 故障链：`ai:apitokensecretname: "OPENAI_KEY"` -> `secretstore.GetSecret("OPENAI_KEY")` 查不到（当前 profile 的配置目录里根本没有 `secrets.enc`）
  -> `FetchModels` **不报错**、静默发出无鉴权请求 -> 界面只显示服务端裸 401。

## 2. 设计目标

1. 三条链路（聊天 / Test connection / Fetch models）用**同一个**密钥解析函数，优先级只有一处定义。
2. 密钥解析失败时给出**可执行**的提示：点名缺失的 secret，并指向 Settings > Secrets。
3. 不引入新的失败模式：匿名端点（Ollama 等）在 Fetch models 下继续可用。

## 3. 方案

### 3.1 新增共享解析器 `pkg/aiusechat/apitoken.go`

放在 `pkg/aiusechat` 根包，理由：

- `pkg/aiusechat` 已经依赖 `pkg/secretstore`（`usechat.go` 现在就在调 `secretstore.GetSecret`），
  `pkg/service/aitestservice` 也已经依赖 `pkg/aiusechat`（`RunCompletion`）。
  因此**不新增任何依赖边**，也没有 `aiutil -> secretstore` 那种把 wshclient 拖进 chat 后端的循环风险。

```go
// APITokenResult 描述一次密钥解析的结果。
type APITokenResult struct {
    Token       string // 解析到的密钥，空表示没有可用密钥
    SecretName  string // 被查询的 secret 名，空表示没有配 secret
    SecretFound bool   // 密钥库里是否存在该 secret
}

// ResolveAPIToken 解析 AI 端点使用的密钥。
//
// 优先级全仓库唯一：显式传入的密钥优先，否则按名字读本机密钥库。
// 聊天链路与设置编辑器的两个探测按钮都走这里，避免"聊天能用、按钮不能"的漂移。
func ResolveAPIToken(apiToken string, secretName string) (APITokenResult, error)
```

- 显式密钥非空 -> 直接返回，**不碰密钥库**（与现有聊天链路一致）。
- 否则 `secretName` 为空 -> 返回空结果（不报错，由调用方决定如何提示）。
- 否则查密钥库：读失败 -> 返回 error（保留聊天链路现有的 `failed to retrieve secret %s: %w` 包装）；
  不存在 -> `SecretFound=false`；存在但值为空 -> `SecretFound=true` 且 `Token==""`。

配套方法：

```go
// MissingReason 在没有解析到密钥时给出人话原因；解析成功时返回空串。
func (r APITokenResult) MissingReason() string
```

文案（ASCII，界面上英文显示）：

| 情形 | MissingReason |
|---|---|
| secret 配了但密钥库里没有 | `secret "OPENAI_KEY" is not in the Settings > Secrets store` |
| secret 存在但值是空 | `secret "OPENAI_KEY" is empty in the Settings > Secrets store` |
| 什么都没配 | `no API key configured` |

### 3.2 聊天链路改用共享解析器 `pkg/aiusechat/usechat.go`

现有内联逻辑替换为 `ResolveAPIToken`，**对外行为与报错文案保持不变**：

```go
tokenResult, err := ResolveAPIToken(config.APIToken, config.APITokenSecretName)
if err != nil {
    return nil, fmt.Errorf("failed to retrieve secret %s: %w", config.APITokenSecretName, err)
}
if tokenResult.Token == "" && tokenResult.SecretName != "" {
    return nil, fmt.Errorf("secret %s not found or empty", tokenResult.SecretName)
}
apiToken := tokenResult.Token
```

语义等价性核对：

- 原逻辑只在 `APIToken == "" && APITokenSecretName != ""` 时查库；新逻辑一致（显式密钥非空时直接短路）。
- 原逻辑在 secret 不存在或为空时报 `secret %s not found or empty`；新逻辑用 `SecretFound` + `Token==""` 复现同一条件。
- 原逻辑在读库出错时包装 `failed to retrieve secret %s: %w`；新逻辑由 helper 返回 error，调用方原样包装。

### 3.3 `FetchModels`：不拦请求，但 401/403 要说人话 `pkg/service/aitestservice/fetchmodels.go`

**不做前置拦截**：Fetch models 是一个无副作用的 GET，匿名端点（Ollama）今天就能用，
前置拦截会造成回归（AC4）。

改动只有一处语义增强：拿到非 200 时，如果**本次没有带任何密钥**，把 `MissingReason()` 追加到错误里。

```
HTTP 401: {"code":"API_KEY_REQUIRED","message":"API key is required in Authorization header (Bearer scheme), ..."} (no API key was sent: secret "OPENAI_KEY" is not in the Settings > Secrets store)
```

- 带了密钥仍然 401 -> 不追加提示（此时服务端的拒绝本身就是答案：密钥无效）。
- 只在 401/403 追加；其它状态码（404/500 等）保持原样，避免噪音。
- 保留 `HTTP %d:` 前缀 -> 既有单测 `TestFetchModels_Non200ReturnsError` 断言含 `401` 依然成立。

### 3.4 `TestConnection`：保留前置检查，但点名缺失的 secret `pkg/service/aitestservice/aitestservice.go`

Test connection 会真的跑一次 completion（有副作用、要花钱），所以**保留前置检查**（没有密钥就别发请求），
只是把原来那句通用的 `API key is missing; save it in the Secrets tab or fill it here`
换成 `MissingReason()` 派生出的具体文案：

- `secret "OPENAI_KEY" is not in the Settings > Secrets store`
- `secret "OPENAI_KEY" is empty in the Settings > Secrets store`
- `no API key configured; save one in Settings > Secrets or set ai:apitoken in the mode config`

### 3.5 前端把 `ai:apitoken` 透传给两个按钮 `frontend/app/view/waveconfig/waveaivisual.tsx`

`handleTest` 与 `handleFetchModels` 各加一个字段：

```ts
apiToken: form["ai:apitoken"],
```

- Go 侧 `apiToken` 字段本来就在（`AITestConnectionRequest.APIToken` / `AIFetchModelsRequest.APIToken`，json tag `apiToken`），
  **不需要重新生成 TS 绑定**（R5）。
- 不新增明文密钥输入框（R6）：`ai:apitoken` 只能来自手改配置或导入路径，本次只打通既有字段的传递。
- 优先级由后端统一处理（显式 > 密钥库），前端不做取舍。

## 4. 影响面（GitNexus impact，索引重建后实测）

| 符号 | impacted | risk | 说明 |
|---|---|---|---|
| `AITestService.FetchModels`（`pkg/service/aitestservice/fetchmodels.go`） | 0 | LOW | tsgen 暴露，仓库内只有前端包装与按钮 handler |
| `AITestService.TestConnection`（`pkg/service/aitestservice/aitestservice.go`） | 0 | LOW | 同上 |
| `handleFetchModels`（`frontend/app/view/waveconfig/waveaivisual.tsx`） | 1 | LOW | 只影响 WaveAIVisualContent 渲染分支 |
| `getWaveAISettings`（`pkg/aiusechat/usechat.go`） | 4（direct 2） | **HIGH** | 聊天主链路；受影响流程 `WaveAIPostMessageHandler`，模块 `Aisessions` / `Waveappstore` |

**HIGH 风险处置**：`getWaveAISettings` 的改动只是把内联的取密钥逻辑换成 `ResolveAPIToken`，
逐条等价性核对见 3.2（唯一的差异是显式密钥现在也会 `TrimSpace`，属于修掉一个隐性不一致）。
真正的风险是"改了聊天主链路"，因此：① 改动前先跑 impact 并把 HIGH 结论记录在案；
② 新逻辑抽成可单测的 `ResolveAPIToken`（`pkg/aiusechat/apitoken_test.go` 覆盖四种取值）；
③ 回归验证跑 `go test ./pkg/aiusechat/...`。

> 索引说明：本机 LadybugDB 的 FTS 扩展缺失，`gitnexus analyze` 需 `--force` 全量重建才成功；
> 查询要带 `--branch main`（默认查的是注册表里 7 月的旧索引，会查不到新符号）。

## 5. 文件影响面

| 文件 | 改动性质 | 风险 |
|---|---|---|
| `pkg/aiusechat/apitoken.go` | 新增 | 无（纯新增） |
| `pkg/aiusechat/usechat.go` | 重构取密钥逻辑，行为等价 | 中：聊天主链路，但语义逐条对齐，错误文案不变 |
| `pkg/service/aitestservice/fetchmodels.go` | 401/403 追加提示 | 低 |
| `pkg/service/aitestservice/aitestservice.go` | 提示文案细化 | 低 |
| `frontend/app/view/waveconfig/waveaivisual.tsx` | 多传一个字段 | 低 |

`FetchModels` / `TestConnection` 是 tsgen 暴露的后端服务方法，调用方只有
`frontend/app/store/services.ts` 生成的 `AITestServiceType`，以及两个按钮的 handler；仓库内没有其它调用点。

## 6. 验证

- Go：`go test ./pkg/service/aitestservice/... ./pkg/aiusechat/...`
- 前端：`npx vitest run frontend/app/view/waveconfig/waveaivisual.test.ts`
- 静态检查：改动文件 ESLint；`go build ./pkg/...`
- 提交前：`gitnexus detect-changes`（若索引可用；当前机器 LadybugDB 的 FTS 扩展缺失导致 `gitnexus analyze` 失败，
  符号级 impact 不可用，改用 grep 调用点分析兜底，见 implement.md 的记录）

## 7. 已知取舍

- Fetch models 允许匿名、Test connection 不允许：前者是无副作用 GET，后者会真的发一次 completion。
  两者都保留现有行为，只是把"为什么失败"讲清楚。
- 密钥缺失时前端仍然发请求再由后端解释（而不是前端预检），因为前端拿不到密钥库的真实状态
  （密钥是否存在只有后端知道）。
