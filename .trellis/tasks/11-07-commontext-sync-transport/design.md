# Design — 同步传输层

> 关键决策已在原型阶段定稿（`design/prototypes/commontext-cloud-sync-notion/README.md` D1–D6），此处只记实现级设计。

## 边界

```
pkg/sync/                    ← 新包：接口 + 注册表 + engine（单活跃 + 冲突）
  sync.go                    SyncTransport / Caps / Snapshot
  registry.go                编译期 map + 按设置实例化
  engine.go                  单活跃 loop、全量重同步、基线选择、冲突策略
  transport_folder.go
  transport_git.go
  transport_server.go
cmd/snorkeling-sync/         ← 自部署服务端单二进制
  main.go                    flag/首启 token 生成
  api.go                     REST /v1/snapshot
pkg/commontextstore/         ← 复用（服务端直接 import）
frontend/app/view/waveconfig/
  syncsettings.tsx           ← 新 Sync 条目 visualComponent
frontend/app/commontext/
  commontext-sync-panel.tsx  ← compose modal 里的状态面板（从 modal 拆出）
```

## 关键契约

### Snapshot

```go
type Snapshot struct {
    DeviceId   string
    DeviceName string
    Rev        float64            // 快照内最大 rev
    Items      []wconfig.CommonTextItemType
}
```

增量语义：`Pull(ctx, sinceRev)` 返回 `rev > sinceRev` 的条目（含墓碑）。folder/git 实现可全量返回（引擎侧按 sinceRev 过滤），server 实现走 SQL 增量。

### 单活跃（engine）

- 全局一个 engine goroutine；transport 实例化由设置键驱动，设置变更 → 停旧起新
- 切换流程：pause → 全量 Pull → 与本地按基线合并（local wins: 本机条目原样推；remote wins: 远端条目追加为本机新条目）→ Push → resume
- 并发保护：engine 持有 mutex；transport 层无共享状态

### 冲突（engine 内，不在 transport）

- row-merge：按 id 配对，字段级比较 `updatedat`；title/text/shortcut/tags 各自新者胜；全字段同 id 双改 → 冲突条目（本地副本保留，远端内容挂 `conflictOf` 引用，UI 面板列出）
- newest：整条 updatedat 比较
- manual：冲突条目进挂起队列，engine 停止自动 Push
- 墓碑优先：任一方 deletedat 非空且对方 rev ≤ 墓碑 rev → 删除胜

### 凭据

| transport | 凭据 | 存储 |
|---|---|---|
| folder | 无 | — |
| git | PAT/SSH | OS keyring（`keyring` 库或既有 secrets 机制） |
| server | srv_ token | OS keyring |

settings.json 只允许出现 `*hastoken: true`；前端展示走 hastoken 位。

## 兼容与回滚

- 新设置键全部 omitempty，旧 settings.json 零影响
- folder payload 首版即最终格式（rev + deletedat 内嵌），后续加字段走 omitempty
- 回滚 = 设 transport: none；同步文件/远端数据不动

## 风险

- git 在 Windows 凭据弹窗（credman）——首版只支持 PAT + keyring，不支持交互式 SSH passphrase
- server WS 与轮询双路径——WS 失败 3 次自动降轮询，状态面板显示当前模式
- 双实例同机测试（folder 云盘目录共享）会触发 fsnotify 自触发回环——engine 写后 2s 内忽略自身事件（按 payload 头 deviceId 过滤）
