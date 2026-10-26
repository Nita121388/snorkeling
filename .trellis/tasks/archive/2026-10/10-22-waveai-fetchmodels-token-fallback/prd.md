# Wave AI Fetch models / Test connection 支持 apiToken 直传，并对密钥缺失给出可读提示

## Background

用户在 Wave AI Modes 可视化编辑器里配置了一个 OpenAI 兼容端点 `https://api.inferaiapi.com/v1`，
点击 "Fetch models" 失败，界面上只显示一条裸的 `HTTP 401: {"code":"API_KEY_REQUIRED", ...}`，
无法判断是「密钥没配」还是「密钥错了」还是「URL 错了」。

实测该端点的行为（curl）：

```
GET /v1/models 无 Authorization -> 401 {"code":"API_KEY_REQUIRED","message":"API key is required in Authorization header (Bearer scheme), x-api-key header, or x-goog-api-key header"}
GET /v1/models 带无效 Bearer   -> 401 {"code":"INVALID_API_KEY","message":"Invalid API key"}
```

即端点本身和 URL 拼装（`aiutil.ResolveModelsEndpoint` -> `https://api.inferaiapi.com/v1/models`）都是对的，
问题出在**请求没有带上密钥**。

当前代码路径（`pkg/service/aitestservice/`）：

| 环节 | 现状 | 问题 |
|---|---|---|
| 前端 `handleFetchModels` | 只传 `endpoint` + `secretName` | 从不传 `apiToken`，mode 里的 `ai:apitoken` 直传值被忽略 |
| 后端 `FetchModels` | `token := request.APIToken`；为空则按 `secretName` 查密钥库 | 查不到时**不报错**，直接发出无鉴权请求 -> 服务端裸 401 |
| 后端 `TestConnection` | 同样不传 `apiToken`；查不到密钥时提前返回 `API key is missing; save it in the Secrets tab or fill it here` | 提示是通用的，没有点名「哪个 secret 没找到」 |
| 聊天链路 `pkg/aiusechat/usechat.go:89` | `apiToken := config.APIToken`，为空才回退到 secret | **聊天链路本来就优先用 `ai:apitoken`**，与两个按钮的优先级不一致 |

由此产生两个真实缺陷：

1. **不一致**：同一份 mode 配置，聊天能用 `ai:apitoken` 直传密钥，两个探测按钮却只看密钥库。
   手改 JSON 或某些导入路径写进 `ai:apitoken` 的密钥，聊天正常、按钮必然失败。
2. **不可诊断**：`FetchModels` 在密钥缺失时静默发出无鉴权请求，用户只看到服务端的裸 401，
   完全不知道是「本地没有这个 secret」。本次故障就是这个形态。

## Goals

- "Fetch models" 与 "Test connection" 与聊天链路采用**同一套密钥优先级**：`ai:apitoken` 直传优先，其次密钥库。
- 密钥解析不出可用 token 时，给出**可执行的中文/英文可读提示**，明确指出是哪个 secret 没找到，
  而不是让用户去猜服务端的 401 报文。
- 不破坏现有可用路径：匿名端点（Ollama 等不校验密钥的本地端点）在 "Fetch models" 下仍然可用。

## Requirements

- R1（前端）：`handleFetchModels` 与 `handleTest` 都要把 mode 配置里的 `ai:apitoken` 作为 `apiToken` 传给后端服务。
- R2（后端）：抽出统一的密钥解析函数，供 `FetchModels` 与 `TestConnection` 共用，优先级与 `pkg/aiusechat/usechat.go` 一致（直传 > 密钥库）。
- R3（后端）：`FetchModels` 收到 401/403 时，如果本次请求**没有带上任何 token**，错误信息里必须包含「没有发送 API key」以及缺失的 secret 名；不能只回传服务端原始报文。
- R4（后端）：`TestConnection` 在密钥缺失时，提示要区分「配了 secret 名但密钥库里没有」与「压根没配 secret」两种情况，前者必须点名 secret。
- R5（兼容）：不改变已有 Go 结构体的字段与 JSON tag（`apiToken` / `secretName` 已存在），因此不需要重新生成 TS 绑定。
- R6（兼容）：不引入明文密钥 UI 输入框。本仓库对 `ai:apitoken` 的定位是「不推荐、优先用密钥库」（见 `docs/docs/waveai-modes.mdx`），本次只打通已存在字段的传递链路。
- R7（回归）：已有的 `TestFetchModels_Non200ReturnsError`（断言错误含 `401`）必须继续通过。

## Acceptance Criteria

- [ ] AC1：`ai:apitoken` 有值时，"Fetch models" 与 "Test connection" 发出的请求都带 `Authorization: Bearer <token>`。
- [ ] AC2：`ai:apitokensecretname` 指向一个密钥库里不存在的名字、且端点返回 401 时，"Fetch models" 的错误信息里同时出现 `401`、该 secret 名、以及「没有发送 API key」的说明。
- [ ] AC3：`TestConnection` 在 secret 缺失时，错误信息里出现该 secret 名。
- [ ] AC4：端点无需密钥（匿名）时，"Fetch models" 仍然能取到模型列表（不因新增的密钥检查而回归）。
- [ ] AC5：Go 单测覆盖上述 2/3/4 与 Authorization 头传递；前端契约测试覆盖 `apiToken` 传参。
- [ ] AC6：`go test ./pkg/service/aitestservice/... ./pkg/aiusechat/...` 通过；前端 vitest 通过；改动文件无新增 ESLint/TS 报错。

## Out of Scope

- 不新增明文密钥输入框（R6）。
- 不改动密钥库本身（`pkg/secretstore`）的存储与加密机制。
- 不改写聊天链路的**行为**：`pkg/aiusechat/usechat.go` 的取密钥逻辑只做等价重构（同一份优先级、同一批错误文案），
  以达成 Goal 里的「优先级只有一处定义」。该符号 impact 评级为 **HIGH**（`getWaveAISettings`：4 impacted /
  1 个流程受影响），属于"聊天主链路"的固有风险，等价性核对见 design.md 3.2，
  新逻辑本身有单测覆盖（`pkg/aiusechat/apitoken_test.go`）。
- 不处理「用户没在当前 profile 的密钥库里添加 secret」这一环境问题本身（属于使用步骤，不是代码缺陷）。

## Notes

- 复现环境：dev profile `cdp`（`node scripts/dev-isolated.mjs --profile cdp --vite-port 51742 --cdp-port 9222`），
  配置目录 `E:\code\snorkeling\.runcfg\cdp\config`，其中 `waveai.json` 的 `custom@openai-chat` 指向
  `https://api.inferaiapi.com/v1` + `ai:apitokensecretname: OPENAI_KEY`，但该配置目录下**没有** `secrets.enc`
  -> 密钥库为空 -> 请求无鉴权 -> 裸 401。
- 正式版 Snorkeling 的配置目录是 `~/.config/snorkeling`（`secrets.enc` 在那里），与 dev profile 相互隔离。
