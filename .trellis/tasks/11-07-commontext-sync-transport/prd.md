# R0/R2 同步传输层：SyncTransport 接口 + folder/git/server 三实现 + waveconfig Sync 条目

> 父任务：11-07-commontext-cloud-sync；依赖：11-07-commontext-sync-metadata（rev/deletedat 先落地）
> 原型依据：`design/prototypes/commontext-cloud-sync-notion/`（状态面板 / 切换确认 / waveconfig Sync 条目 / README D1–D6）
> 用户确认（2026-11-07）：**server transport 要真实现**，不是 planned 占位。

## Goal

同步传输层立起来：接口 + 编译期注册表 + 单活跃约束；folder / git / server 三个实现全部可用；设置 UI 进 waveconfig。

## Requirements

### R0.1 接口与注册表（Go）

```go
type SyncTransport interface {
    Id() string
    Capabilities() Caps   // requiresCredential / realtime / atomicWrite
    Pull(ctx context.Context, sinceRev float64) (Snapshot, error)
    Push(ctx context.Context, snap Snapshot) error
}
```

- 注册表 = 编译期 map（`folder` / `git` / `server` 三键），不做动态加载
- 设置项 `commontext:sync:transport` = `none | folder | git | server`，非法值回落 `none`
- **单活跃**：同一时刻只有一个 transport 在跑；切换 = 全量重同步 + 基线选择（`local` / `remote`）
- 冲突策略 `commontext:sync:conflictpolicy` = `row-merge | newest | manual`（默认 row-merge）

### R0.2 folder 实现（最小，先做）

- payload：云盘目录下单文件 `commontext.json`（全量快照 + 每条 `rev` + `deletedat` 墓碑）
- 写 = 临时文件 + 原子 rename；读容忍半文件（rename 原子性保证）
- fsnotify 监听外部变更（`filewatcher.go` 已有 fsnotify 先例）
- 设备名写入 payload 头部，供对端显示来源

### R0.3 git 实现

- 私有 repo，定时（默认 15m，可配）+ 手动 Sync now：pull --rebase → merge 冲突按策略处理 → commit → push
- token 存 OS keyring（Windows Credential / macOS Keychain / libsecret），settings 只写 `commontext:sync:git:hastoken: true`
- 推送失败不阻塞本机使用；失败原因进状态面板

### R0.4 server 实现（自部署，真后端）

- **服务端**（新目录 `cmd/snorkeling-sync/`，单二进制 Go 服务）：
  - REST：`GET /v1/snapshot?sinceRev=N`（增量）、`PUT /v1/snapshot`（带 baseRev，服务端判冲突）
  - token 鉴权（`Authorization: Bearer`；首次启动生成并打印；支持多 token = 多设备）
  - 数据落 SQLite，**直接复用 `commontextstore` 的 schema 与迁移**
  - 可选 WS 实时推送（realtime），不可用回落轮询
- **客户端**：URL + token 前置校验（缺一不可选，判据与原型 `transportBlockedBy` 一致）；`allowinsecure` 开关控 http://（默认禁）

### R0.5 冲突处理

- row-merge（默认）：字段级 updatedat 新者胜；同字段双改才标冲突条目
- newest：整条 updatedat 新者胜，静默覆盖
- manual：冲突条目挂起，同步停住直到处理
- 墓碑胜过复活：`deletedat` 非空且远端 rev ≤ 本地 → 保持删除

### R0.6 设置 UI（waveconfig Sync 条目）

- `waveconfig-model.ts` 的 `makeConfigFiles()` 新增 `ConfigFile{ name:"Sync", path:"commontextsync", hasJsonView:true, visualComponent: SyncSettingsContent }`
- `SyncSettingsContent` 表单分组（每组可折叠，折叠态存 localStorage 不进 settings）：Transport / 后端配置（随选中项切换）/ This computer / Conflicts / Scope / Maintenance
- 前置不满足 → 行置灰 + 原因写进描述（与状态面板同一判据函数，不许分叉）
- Save 走 `SetConfigCommand`；transport 变更 → 弹全量重同步确认（基线选择）
- 状态面板（compose modal 里的 sync pill 面板）：transport 单选 + 状态 kv + 设备列表 + 冲突提示 + 切换内联确认（原型已定稿）

### R0.7 设备身份

- 首次启动生成 `deviceId`（UUID 短哈希）写盘，`deviceName` 默认 hostname 可改；两者解耦
- 所有写入条目带当前 `origin` 快照

## Acceptance（可机器判定）

- [ ] `go test ./pkg/sync/...`（新包）：三 transport 各自的 Pull/Push 往返、冲突三策略、墓碑不复活、单活跃互斥（并发起两个 transport 报错）
- [ ] folder：真目录双实例对账测试（A 写 → B 拉到，含删除墓碑）
- [ ] server：`go test ./cmd/snorkeling-sync/`（httptest）：token 401、增量 sinceRev、冲突 409、多 token
- [ ] git：跳过真远端（用本地 bare repo fixture 跑通 pull/commit/push 循环）
- [ ] 前端：设置块分组折叠 / 前置置灰 + 解锁 / Save 落键 / Raw JSON 反映草稿（原型 20 条断言迁移进验证台）
- [ ] 切换 transport：全量重同步跑通 + 基线选择生效（local wins → 远端多出条目保留，本机覆盖；remote wins 反之）
- [ ] 真机验证：双实例（本机起 server + 两个客户端实例）同步往返，`verify-ledger.md` 落结论
