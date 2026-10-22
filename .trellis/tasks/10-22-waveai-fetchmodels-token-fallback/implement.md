# Implementation Plan

Task: `.trellis/tasks/10-22-waveai-fetchmodels-token-fallback`
Design: `design.md`（方案已定稿，本清单只列执行顺序与验证口径）

## 0. 前置核对（已完成）

- [x] 用 curl 核实端点行为：`/v1/models` 无 key -> 401 `API_KEY_REQUIRED`；带假 key -> 401 `INVALID_API_KEY`；`/models`（少 `/v1`）-> 404。
- [x] 确认 URL 拼装正确：`aiutil.ResolveModelsEndpoint` 有单测覆盖 `https://api.inferaiapi.com/v1` -> `.../v1/models`。
- [x] 定位根因：dev profile `cdp` 的配置目录 `E:\code\snorkeling\.runcfg\cdp\config` 下**没有** `secrets.enc`
      -> `secretstore.GetSecret("OPENAI_KEY")` 返回不存在 -> `FetchModels` 静默发无鉴权请求。
- [x] 确认与聊天链路的优先级漂移：`pkg/aiusechat/usechat.go:89` 优先用 `config.APIToken`，
      两个按钮既不传 `apiToken` 也不做提示。
- [x] 调用点普查（grep 兜底）：`FetchModels` / `TestConnection` 在仓库内只有
      `frontend/app/store/services.ts` 的 tsgen 包装 + `waveaivisual.tsx` 两个 handler，无其它调用方。
- [x] GitNexus 索引不可用：本机 LadybugDB 缺 FTS 扩展，`gitnexus analyze` 直接失败
      （`FTS extension unavailable - cannot create FTS index File.file_fts`），
      且现有索引内容落后（缺 `pkg/service/aitestservice`、`pkg/service/ccswitchservice`），
      `impact`/`context` 对 Go 符号全部返回 not found。**降级为 grep 调用点分析**，并把索引修复记录在下方"遗留项"。

## 1. 后端：共享密钥解析器

- [x] M1 新增 `pkg/aiusechat/apitoken.go`
  - `APITokenResult{Token, SecretName, SecretFound}`
  - `ResolveAPIToken(apiToken, secretName) (APITokenResult, error)`
  - `(APITokenResult).MissingReason() string`
  - 显式密钥非空 -> 短路，不读密钥库；secret 名为空 -> 空结果不报错；读库失败 -> 返回 error。
- [x] M2 `pkg/aiusechat/usechat.go`：内联取密钥逻辑替换为 `ResolveAPIToken`，
      保持 `failed to retrieve secret %s: %w` / `secret %s not found or empty` 两个文案不变（见 design.md 3.2 的等价性核对）。
      > 该符号 impact 评级 **HIGH**（4 impacted / 2 direct / 1 流程 `WaveAIPostMessageHandler`），
      > 处置方式见 design.md 第 4 节（等价性逐条核对 + 新逻辑单测 + `go test ./pkg/aiusechat/...` 回归）。

## 2. 后端：两个探测按钮

- [x] M3 `pkg/service/aitestservice/fetchmodels.go`
  - 用 `aiusechat.ResolveAPIToken` 取代内联的 `request.APIToken` / `secretstore.GetSecret` 逻辑，
    删除该文件对 `secretstore` 的直接依赖。
  - 非 200 分支：401/403 且本次未带密钥 -> 错误串追加 `(no API key was sent: <MissingReason>)`。
  - 保留 `HTTP %d:` 前缀（既有单测依赖）。
- [x] M4 `pkg/service/aitestservice/aitestservice.go`
  - 用同一个 resolver；`token == ""` 的前置检查改为返回 `MissingReason()` 派生的具体文案。
  - 删除该文件对 `secretstore` 的直接依赖。

## 3. 前端

- [x] M5 `frontend/app/view/waveconfig/waveaivisual.tsx`
  - `handleTest` 的 `TestConnection` 请求加 `apiToken: form["ai:apitoken"]`。
  - `handleFetchModels` 的 `FetchModels` 请求加 `apiToken: form["ai:apitoken"]`。
  - 不新增明文密钥输入框。

## 4. 测试

- [x] M6 Go 单测 `pkg/service/aitestservice/aitestservice_test.go`
  - `TestFetchModels_SendsAPITokenHeader`：传 `APIToken` 时服务端收到 `Authorization: Bearer <token>`。
  - `TestFetchModels_MissingSecretExplains401`：secret 名不存在 + 端点 401 -> 错误含 `401`、含 secret 名、含 "no API key"。
  - `TestFetchModels_AnonymousEndpointStillWorks`：不配任何密钥 + 端点 200 -> 仍返回模型列表（AC4 防回归）。
  - `TestTestConnection_MissingSecretNamesSecret`：`TestConnection` 的文案点名缺失的 secret。
  - 保留并复跑既有用例（`TestFetchModels_Non200ReturnsError` 等）。
- [x] M7 Go 单测 `pkg/aiusechat`（新增 `apitoken_test.go`）
  - 显式密钥优先于 secret 名；secret 不存在 -> `SecretFound=false` 且 `MissingReason()` 点名；
    secret 为空 -> `MissingReason()` 表述为 empty；什么都没配 -> `no API key configured`。
- [x] M8 前端契约测试 `frontend/app/view/waveconfig/waveaivisual.test.ts`
  - 断言 `apiToken: form["ai:apitoken"]` 在两个 handler 里都出现（>= 2 处）。

## 5. 验证命令（Windows，按 AGENTS.md 用子进程加载本地环境）

> 实测结果（trellis-check 超时后由主会话重跑）：1-5 全部 PASS，6 只有既有基线报错。

| # | 命令 | 结果 |
|---|---|---|
| 1 | `go build ./pkg/...` | PASS |
| 2 | `go vet ./pkg/aiusechat/... ./pkg/service/aitestservice/...` | PASS |
| 3 | `go test ./pkg/service/aitestservice/... ./pkg/aiusechat/...` | PASS（aitestservice 9/9；aiusechat 18 个，含新增 8 个） |
| 4 | `npx vitest run frontend/app/view/waveconfig/waveaivisual.test.ts frontend/app/view/waveconfig/waveai-templates.test.ts` | PASS（2 files / 10 tests） |
| 5 | `npx eslint frontend/app/view/waveconfig/waveaivisual.tsx frontend/app/view/waveconfig/waveaivisual.test.ts` | PASS（无输出） |
| 6 | `npx tsc --noEmit -p tsconfig.json` | 71 处报错，**全部为既有基线**（`waveconfig-model.ts` / `frontend/preview/*` / 其它脏文件），改动文件 0 报错 |
| 7 | 非 ASCII 扫描（改动 diff + 新文件） | PASS（diff 引入 0 个非 ASCII；新文件全 ASCII） |

另外在**运行中的 dev 应用**里做了端到端实测（CDP 调应用自己的 `aitest.FetchModels`）：

- 传 `apiToken` 直传 + 一个**不存在**的 secret 名 -> 仍返回 7 个模型
  => `apiToken` 字段名端到端正确，且直传优先于密钥库。
- 传 `secretName: OPENAI_KEY`（已写入加密密钥库）-> 返回同样 7 个模型
  => 用户当前的 401 问题在运行中的应用里已实际解除。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go test ./pkg/service/aitestservice/... ./pkg/aiusechat/..."
powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go build ./pkg/..."
npx vitest run frontend/app/view/waveconfig/waveaivisual.test.ts frontend/app/view/waveconfig/waveai-templates.test.ts
npx eslint frontend/app/view/waveconfig/waveaivisual.tsx frontend/app/view/waveconfig/waveaivisual.test.ts
```

> 注：Go / vitest / eslint 可能超过 60 秒，按 AGENTS.md 交给 async 子代理执行。
> PowerShell 子进程里赋临时环境变量要转义 `$env:`（写成 `` `$env:FOO='bar' ``）。

## 6. Review gate

- [ ] G1 后端改动自查：`FetchModels` 不再做前置拦截（匿名端点不回归），`TestConnection` 仍前置拦截（有副作用的 completion）。
- [ ] G2 文案自查：全部 ASCII，无乱码；提示里点名 secret 并指向 Settings > Secrets。
- [ ] G3 `gitnexus detect-changes`（索引修复则执行；不可用时以 `git diff --stat` + 人工复核替代）。
- [ ] G4 确认没有夹带其它任务的改动：工作区本来就有 block-info-card / session-note 的未提交改动，
      本任务只提交 `pkg/aiusechat/apitoken.go`、`pkg/aiusechat/usechat.go`、
      `pkg/service/aitestservice/*.go`、`frontend/app/view/waveconfig/waveaivisual.tsx`、
      `frontend/app/view/waveconfig/waveaivisual.test.ts`、`.trellis/tasks/10-22-waveai-fetchmodels-token-fallback/`。

## 7. 回滚点

- 每个 M 步骤都是独立可回滚的小改动；出问题时按文件 `git checkout -- <file>` 即可，
  不涉及数据结构/迁移/协议变更，无数据回滚需求。
- 前端与后端必须一起回滚（前端多传一个字段，后端忽略也不报错，属于向后兼容）。

## 8. 遗留项（不在本任务范围）

- 本机 GitNexus 索引不可用：LadybugDB FTS 扩展缺失导致 `gitnexus analyze` 失败。修复方向：
  `gitnexus doctor` 里 "Ext install: load-only (offline; load only, no network install)" 说明扩展未预装，
  需要在有网络的机器上预装扩展或换用支持 FTS 的环境；恢复后补跑 `gitnexus analyze --force` 与
  `gitnexus detect-changes`。本任务已用 grep 调用点分析兜底。
- 用户侧仍需在**当前 profile 的密钥库**里添加对应 secret（dev profile 是
  `E:\code\snorkeling\.runcfg\cdp\config`，正式版是 `~/.config\snorkeling`，两者隔离）。
