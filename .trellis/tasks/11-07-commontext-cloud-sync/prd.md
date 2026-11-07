# Common Text 云同步：元数据 + 创建者筛选 + 同步传输

> 状态：planning（父任务 = 需求总集 + 跨子任务验收，不直接实现）
> 原型（已定稿）：`design/prototypes/commontext-cloud-sync-notion/`（README 含全部设计决策 D1–D6）
> 用户确认：2026-11-07「ok go」；追加两条——①自部署服务（server transport）要真实现，不是 planned；②设置界面分组要支持折叠（原型已更新并验证）。

## 需求总集

### R1 条目级元数据（子任务 11-07-commontext-sync-metadata）

Common Text 条目需要回答「这条是谁、在哪台机器上、什么时候创建的」：

| 字段 | 类型 | 说明 |
|---|---|---|
| `createdBy.kind` | `human \| agent` | 人创建 / agent 创建 |
| `createdBy.name` | string | 人 → 本机用户名；agent → `pi` / `claude` / `codex` |
| `origin.deviceId` | string | 稳定设备 ID（首次生成后写盘，换机不重号） |
| `origin.deviceName` | string | 展示名（默认 hostname，可改） |
| `origin.platform` | string | `win32` / `darwin` / `linux` |
| `rev` | number | 条目级版本号，冲突判定用 |
| `deletedat` | number? | 墓碑（删除也要同步，否则另一端复活） |

**旧数据兼容**：所有新字段可缺省；缺失时 `createdBy={kind:"human",name:""}`、`origin={deviceId:"local",deviceName:"This machine"}`、`rev=0`，不触发迁移写盘。

### R2 创建者/设备筛选（子任务 11-07-commontext-ui-filters-notion）

- 列表行显示来源徽标（agent 名 / 人名 + 电脑）
- 筛选 chips：All / Humans / Agents + 电脑下拉（Any computer / 各设备 + 计数）
- 右栏 Notion 式页面：page icon（emoji picker）+ 大标题 + 属性网格（Created by / Computer / Created / Updated / Used）+ Preview/Edit

### R0/R2 同步传输（子任务 11-07-commontext-sync-transport）

- `SyncTransport` 接口：`Id()` / `Capabilities()` / `Pull(ctx)` / `Push(ctx, Snapshot)`
- **编译期枚举 + 单活跃**（不做插件化，判据见原型 README D5）
- 三个实现全部真做：`folder`（云盘目录 + fsnotify + 原子写）、`git`（私有 repo 定时 commit/pull）、`server`（自部署 Go 服务，token 鉴权，REST snapshot 增量）
- 冲突策略三选一：row-merge（推荐）/ newest / manual
- 切换 transport = 全量重同步 + 显式基线选择（This device wins / Remote wins）
- 设置 UI = `waveconfig` 左栏新增 Sync 条目（`visualComponent` 表单 + 分组折叠 + Visual/Raw JSON 页签）
- token 一律存 OS keyring，settings.json 只写 `hastoken: true`

## 跨子任务验收

- [ ] 三个子任务各自验收通过（见各自 prd）
- [ ] 跨面一致性：同一台机器，列表徽标 / 详情属性 / 状态面板 / 设置块四处显示的设备名与创建者一致
- [ ] 真机验证台跑通（`scripts/verify/index.mjs`），结论进 `docs/project/verify-ledger.md`
- [ ] 原型改状态 `▲ → ●`，镜像源保留
- [ ] schema/settings.json 与 Go 结构体重生成一致

## 非目标

- 不做账号体系 / 登录 UI（server transport 用 token，不做多用户）
- 不做真正的插件加载器（D5 判据未满足）
- 不同步 Common Text 以外的域（Scope 锁定）
- 不做端到端加密（后续需求）
