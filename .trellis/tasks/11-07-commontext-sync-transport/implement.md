# Implement — 同步传输层

> 顺序：接口+folder 先立骨架 → server（真后端）→ git（最重）→ 设置 UI → 状态面板接线。
> 每步先过 loop 门链准入（`node loop/queue.mjs prove --id X`）再动手。

## Checklist

### 阶段 A：接口 + folder（最小闭环）

- [ ] A1 `pkg/sync/sync.go`：SyncTransport / Caps / Snapshot / 注册表接口
- [ ] A2 `pkg/sync/engine.go`：单活跃 loop + 设置键监听 + 全量重同步 + 三冲突策略
- [ ] A3 `transport_folder.go`：commontext.json 读写（原子写）+ fsnotify + 自触发回环过滤
- [ ] A4 单测：Pull/Push 往返、冲突三策略、墓碑不复活、双 transport 互斥
- [ ] A5 验证命令：`go test ./pkg/sync/`；双实例 folder 对账用例

### 阶段 B：server（自部署真后端）

- [ ] B1 `cmd/snorkeling-sync/main.go`：首启生成 token 打印 + flag
- [ ] B2 `api.go`：GET/PUT /v1/snapshot（sinceRev 增量、baseRev 冲突 409、Bearer 鉴权、多 token）
- [ ] B3 服务端存储复用 `commontextstore`（同一 SQLite schema + 迁移）
- [ ] B4 客户端 `transport_server.go`：URL+token 前置、allowinsecure 开关、WS 实时→轮询降级
- [ ] B5 httptest 用例：401 / 增量 / 409 / 多 token / 墓碑

### 阶段 C：git

- [ ] C1 `transport_git.go`：bare repo fixture 循环（pull --rebase / commit / push）
- [ ] C2 keyring token 读写 + settings hastoken 位
- [ ] C3 定时器（15m 默认可配）+ 手动 Sync now 通道
- [ ] C4 失败不阻塞本机：push 错误进状态面板，不中断 engine

### 阶段 D：设置 UI（waveconfig Sync 条目）

- [ ] D1 `waveconfig-model.ts` 注册 ConfigFile（name Sync / path commontextsync / visualComponent）
- [ ] D2 `syncsettings.tsx`：六分组表单（折叠 + 前置置灰判据与后端同一来源）+ Raw JSON 页签
- [ ] D3 分组折叠态存 localStorage；Save 走 SetConfigCommand
- [ ] D4 transport 变更 → 全量重同步确认弹层（基线选择 local/remote）

### 阶段 E：状态面板 + 收尾

- [ ] E1 compose modal 状态面板拆出为 `commontext-sync-panel.tsx`（pill → 面板 → 切换内联确认）
- [ ] E2 前端单测：判据函数、面板渲染、切换流程
- [ ] E3 验证台 area 登记 + 真机双实例往返（server 模式）→ `verify-ledger.md`
- [ ] E4 原型 README 状态 `▲ → ●`
- [ ] E5 spec 沉淀：`quality-guidelines.md` 加「同步判据单一来源」约束

## 验证命令

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go test ./pkg/sync/... ./cmd/snorkeling-sync/..."
node scripts/run-task.mjs frontend:test -- --testPathPattern commontext
node scripts/verify/index.mjs   # area: commontext-sync
```

## 回滚点

- 每阶段一个 commit；阶段 A 完成即可设 transport:folder 试用（不影响旧数据）
- B/C 任一失败不阻塞 A 的 folder 上线（注册表按能力开关）
