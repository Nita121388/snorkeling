# Common Text 同步：修 wsh CLI 未接 RPC、设置面板 token 空壳、token 热加载

> 父任务：11-07-commontext-cloud-sync
> 起因：2026-11-09 真机自部署（腾讯云 49.51.243.178 + `https://break.ccwu.cc/sync`）时，
> 按文档「每个失败都带 fix」的设计本该一条命令搞定的配置路径，实际一个都走不通。

## Background（真机证据）

1. `wsh commontext-sync show|doctor|sync|set-server …` 全部返回
   `Error: reading settings: nil wshrpc passed to wshclient`。
   原因：`commonTextSyncCmd` 没有 `PersistentPreRunE: preRunSetupRpcClient`，
   而 `setconfig` / `secret` 都有。CLI 的「agent 面向入口」是死的。
2. 设置面板 Server 分组里的「Configure token…」`onClick={() => patch({ serverHasToken: true })}`
   —— 没有输入框、没有 `SetSecretsCommand`。照 UI 配完，`hastoken: true` 但 keyring 里没有 token，
   同步运行时 401（`server rejected the token (401)` / `no server token configured`）。
3. `snorkeling-sync token --add / --revoke` 只改磁盘 `tokens.json`，服务进程启动时载入内存后不再读盘，
   必须 `systemctl restart` 才生效。真机上表现为「刚生成的新 token 立刻 401」。

## Goal

让「自部署 server 同步」从零到跑通只靠官方入口：CLI 能用、UI 能录 token、服务端 token 即时生效，并把
这套自部署流程写成仓库文档（目前仓库里完全没有）。

## Requirements

### R1 wsh CLI 接线

- `commontext-sync` 命令组接上 `preRunSetupRpcClient`（与 `setconfig` / `secret` 一致）。
- 所有子命令（`show` / `doctor` / `log` / `sync` / `conflicts` / `resolve` / `set-*` / `off` / `set`）在应用运行时可用。
- 无凭据时给出 `preRunSetupRpcClient` 既有的可行动报错（`wsh auth grant --name … --out <file>`），不许 panic。

### R2 设置面板 token 真实录入

- 「Configure token…」/「Replace token…」展开内联密码输入 + Save/Cancel；已有 token 时提供 Remove。
- 保存 = `SetSecretsCommand(TabRpcClient, { <secretName>: value })`，删除 = 传 `null`。
- secret 名与 Go 侧常量同源：`commontext_sync_server_token` / `commontext_sync_git_token`。
- **token 绝不进 settings.json**：`draftToSettingsPatch()` 仍然只写 `hastoken: true/false`。
- server 与 git 两处共用同一个录入组件（不许两份实现）。

### R3 服务端 token 热加载

- `Tokens.Valid()` 在判定前检查 `tokens.json` 的 mtime/大小，变了就重载；
  同一进程内 `token --add` / `--revoke` 立即生效，无需重启。
- 文件损坏/半写（rename 之外）不能让服务端鉴权直接放行或崩溃：解析失败保留旧快照并记日志。

### R4 自部署文档

- 新增 `docs/project/commontext-sync-server.md`：交叉编译 → systemd → 反向代理（含「已有站点挂路径」与
  独立子域两种）→ token 管理 → 客户端配置 → 排障表（401 / protocol mismatch / 增量不对）。

## 约束

- 不改同步协议（`syncproto.ProtocolVersion` 保持 1），不改 settings key 名。
- 不复用 `allow-insecure` 当默认；文档里 https 是推荐路径。
- 面板改动不破坏 `syncsettings.test.ts` 既有 8 条断言（`blockedReasonFor` 单一判据不许分叉）。

## Acceptance Criteria

- [ ] `wsh commontext-sync show` 输出 `transport: server` 等字段（无 `nil wshrpc`）；
      `wsh commontext-sync doctor --json` 输出 `checks[]` 且 `ready: true`。
- [ ] `go test ./cmd/snorkeling-sync/...` 通过，且新增用例：`--add` 写入后不重启即 200、revoke 后立即 401。
- [ ] `npm test -- syncsettings` 通过，且新增用例：`syncSecretName()` 与服务端常量一致；
      `draftToSettingsPatch()` 结果里不存在 token 明文（任何键）。
- [ ] 面板点「Configure token…」→ 输入 → Save 后 `wsh secret get commontext_sync_server_token` 能读回。
- [ ] 真机：删掉 secret 后 `doctor` 报 token 缺失；重新录入后 `doctor` 全绿并跑通一次 `sync`。
