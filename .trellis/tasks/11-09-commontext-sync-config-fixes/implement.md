# 执行计划

## 顺序

B1 → B2 → B3 → B4 → V（验证）→ D（文档）→ 收尾

### B1 wsh CLI 接线（Go）

- `cmd/wsh/cmd/wshcmd-commontext-sync.go`：`commonTextSyncCmd` 加 `PersistentPreRunE: preRunSetupRpcClient`。
- 判据：`./wsh.exe commontext-sync show` 有输出（当前是 `nil wshrpc`）。
- 回归用例（Go，`cmd/wsh/cmd` 包内新增 `wshcmd-commontext-sync_test.go`）：
  `commonTextSyncCmd.PersistentPreRunE != nil`，且每个子命令都被父命令覆盖。

### B2 面板 token 录入（TS）

- `syncsettings.tsx`：
  - 新增 `export function syncSecretName(kind: "server" | "git"): string`（值同 Go 常量）。
  - 新增 `TokenEditor` 组件（受控，密码型 input + Save/Cancel + 可选 Remove），server / git 两行共用。
  - 保存走 `RpcApi.SetSecretsCommand(TabRpcClient, { [name]: value })`；删除传 `null`（`Record<string, string | null>` 一次 cast）。
  - 成功后 `patch({ serverHasToken: true })`（或 git 对应字段），状态文案写清「已存进系统钥匙串，不在 settings.json」。
  - 失败把错误原文写进 panel status，不静默。
- 判据：`npm test -- syncsettings` 通过 + 新增 2 条（secret 名一致、patch 无 token 明文）。

### B3 服务端 token 热加载（Go）

- `cmd/snorkeling-sync/tokens.go`：`Tokens` 记 `mtime/size`；`reloadIfChanged()` 在 `Valid()` 里先调用；
  解析失败保留旧 map 并 `log.Printf` 一次。
- 判据（`server_test.go` 新增）：起 httptest server → `LoadTokens` 后 `Generate()` 落盘另一实例 →
  `Valid(newTok)` 立刻为 true；`Revoke` 后立刻 false。

### B4 文档

- `docs/project/commontext-sync-server.md`（新建），内容按 R4。

## 验证命令

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go test ./cmd/snorkeling-sync/... ./cmd/wsh/..."
npm test -- syncsettings
```

真机：
```bash
# 重新部署服务端后
ssh tencent 'sudo -n systemctl restart snorkeling-sync'
./wsh.exe commontext-sync doctor --json     # 期望 ready: true
./wsh.exe commontext-sync sync              # 期望 pushed/pulled 无 error
```

## 回滚点

- B2 只动一个 tsx 文件 + 一个 test 文件；B1/B3 各动一个 Go 文件 + 对应 test。
- 服务端二进制替换前保留旧版：`/opt/snorkeling-sync/snorkeling-sync.prev`。
