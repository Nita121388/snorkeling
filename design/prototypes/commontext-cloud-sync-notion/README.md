> 同步状态：▲ 设计活跃（未实现）
> 镜像源：frontend/app/commontext/commontext-compose-modal.tsx, frontend/app/commontext/commontext-model.ts, pkg/wconfig/settingsconfig.go, pkg/commontextstore/commontext_store.go, frontend/app/view/waveconfig/waveconfig.tsx, frontend/app/view/waveconfig/waveconfig-model.ts, frontend/app/view/waveconfig/agentnotifysettings.tsx, frontend/app/element/toggle.scss
> 最后同步：2026-11-06

# Common Text · 云同步元数据 + 创建者筛选 + Notion/Obsidian 式详情

浏览器直接打开 `index.html`，无构建、无依赖（emoji 用系统字体，图标走 CDN，离线可用）。

## 与真实组件的结构对齐

原型不是「一个想法的画布」，是 `commontext-compose-modal.tsx` 的结构镜像。上到下逐段对齐：

| 真实结构 | 原型 | 说明 |
|---|---|---|
| Header「Common Text」+ 一行说明 | 一致 | 文案照抄 |
| **Compose editor**（单行 36px，聚焦展开，`Compose here…` 占位） | 一致 | 聚焦展开到 120px；失焦后 600ms 按「有无换行」收回；editor 有内容时参与过滤左栏列表 |
| **Action row**（filter / eraser / ＋ / copy / Send） | 一致 | filter 按钮三态（禁用 / 关 / 开）；Insert 真的把正文落到 composer |
| 双栏 Master-Detail（左列表 + 右详情） | 一致 | 900×620 兜底尺寸放大到 1080×720 便于看清属性区 |
| 左栏：Search + untagged + tag chips | 一致 | 新增点插在 Search 与 tag chips 之间 |
| 左栏：排序图标组 | 一致 | 上一版原型已落地，本版不改 |
| 左栏：列表行（pin + 标题 + 摘要 + meta 列） | 一致 | 只在标题后加来源徽标，行高不变 |
| 右栏：标题 input + Pin + textarea + tags + Send/Copy/Insert/Delete | **改造** | 标题放大为页面标题，正文改为 Preview/Edit，属性区为新增点 |

## 这版原型要拍板的三件事

### R0 同步方式怎么选：编译期枚举 + 单活跃（**不是插件化**）

原型里的同步面板实现了这条路线，这是本轮讨论的结论：

```
Transport (single active)
├── ● Local folder (cloud drive)   [ready, recommended]   commontext.json 放进云盘目录
├── ○ Git repository               [ready, needs token]   私有 repo 定时 commit
├── ○ Self-hosted service          [planned, 置灰]        尚未实现（D1 方案 C）
└── ○ Off · local only             [ready]                不启用传输
```

三条硬规则，都能在原型里点到：

1. **只允许一个 active** —— 防止同一份数据被两条链路各写一遍导致分叉。
   面板右上角 `single active` 就是这条的显式提示。
2. **前置条件不满足就置灰 + 给配置入口**，不是"安装"：
   - Git 未配 token → 整行置灰，描述改成「需要先配置访问令牌（token 存 keyring，不写 settings）」，行内有 `Configure token…`
   - 配好 token 后同一行立刻变成可点，描述回到常规说明
   - `Self-hosted service` 是 `status: planned`，置灰并写明「尚未实现」
3. **切换 = 全量重同步 + 显式选边**：确认区**内联**在面板里（不另起浮层），
   先选 `This device wins` / `Remote wins` 作为基线，再 `Switch & re-sync`；
   取消则回到原 transport。从 `Off` 首次启用时不需要确认（没有历史数据要调和）。

> 为什么不做"安装插件"：本仓库没有运行期加载能力（`preview-plugin-registry.ts` 头注释自认
> 「内部插件 = 代码随主应用编译」；`go.mod` 无 `plugin` 包；前端无外部代码入口）。
> 而同步的真实复杂度在**不变量层**（`rev` / `deletedat` / 冲突判定 / 凭据 / 时钟偏移），
> 跟后端数量无关，只付一次；传输适配层每个 ~200 行。插件加载器反而 1000+ 行且横切全应用。
> 判定依据见文末 D1 表与「什么时候才真值得插件化」三条判据。

### R0b 同步设置界面 = `waveconfig` 设置块里的 **Sync 条目**

> 2026-11-06 修订：初版把同步设置画成了独立弹窗（modal.tsx 壳），用户指出**应该并入现有设置界面**。
> 核对真实代码后确认：本仓库的设置界面是 `waveconfig` block
> （`frontend/app/view/waveconfig/waveconfig.tsx`），左栏 `ConfigSidebar` 列条目，
> 条目分两类 —— Monaco 编辑 JSON（General/Connections…）或自定义表单组件
> （App Theme → `ThemePickerContent`、Agent Notifications → `AgentNotifySettingsContent`）。
> 同步设置按后者做：新增一个 `visualComponent` 条目，不新造弹窗壳。

**镜像关系**（逐字段对齐 `waveconfig.tsx` + `agentnotifysettings.tsx`）：

| 原型 | 真实组件 |
|---|---|
| 左栏条目 `Sync / Common Text cloud sync` | `makeConfigFiles()` 里新增一个 `ConfigFile`（`path: "commontextsync"`，`visualComponent: SyncSettingsContent`，`hasJsonView: true`） |
| 标题栏 name + docs 图标 + `settings.json` path + Save | `WaveConfigView` 的 `.wc-head`，Save 走 `model.saveFile()` / `SetConfigCommand` |
| Visual / Raw JSON 两个页签 | `selectedFile.hasJsonView && visualComponent` 时的 visual/json 切换 |
| 表单行「左标题+说明、右控件、`divide-y` 分隔」 | `agentnotifysettings.tsx` 的 `SectionRow` |
| Toggle 开关 32×20、slider 16px、translateX(11px) | `frontend/app/element/toggle.scss` 同款几何 |
| 输入框 `h-8 rounded border-border bg-panel text-xs` | `agentnotifysettings.tsx` 的 `NumberField` 同款 |
| Raw JSON 页签 | 真实组件是 Monaco 编辑同一份 settings；原型用只读 `<pre>` 展示，键名 `commontext:sync:*` |

**分组顺序**（先选后端 → 再配后端 → 再配这台机器 → 再配策略）：

| 组 | 内容 | 说明 |
|---|---|---|
| Transport | 与状态面板同一份 `TRANSPORTS`、同一判据 `transportBlockedBy()`；置灰行**直接写出原因** | 可用性判据只有一处，面板和设置块不许分叉 |
| 后端配置 | `folder` → File path + Choose folder + Watch external；`git` → Remote + Token + Interval；`none` → 整组隐藏 | 只渲染当前选中 transport 的字段 |
| This computer | Name（可改）+ Device ID（只读 + 复制）+ Platform（只读） | 对应 R1 的 `origin.*` |
| Conflicts | `Merge per row`(推荐) / `Newest wins` / `Always ask` | 各自下方写清代价 |
| Scope | Common Text（开且锁定）+ Sync deletions (tombstones) | 关掉墓碑会发生什么写进说明 |
| Maintenance | Full re-sync / Sync file（Reveal + Copy path）/ Reset sync state | Reset 只清游标与 rev 缓存 |

三条交互规则（都可点验）：

1. **草稿态 + Unsaved changes**：改任何字段只写 `wcDraft` 并点亮标题栏 `Unsaved changes` + Save；
   真实组件里切文件/关块走 `confirmDiscardChanges()`。Save 才落 `state`（真实 = `SetConfigCommand`）。
2. **token 例外**：token 存 OS keyring 而非 settings，`Save token` **立刻生效**（`state.gitToken = true`），不等 Save。
3. **Save 后 transport 变了** → 关设置块、回状态面板弹「全量重同步 + 选边」内联确认；没变则只 toast。

**入口**：主界面底部原型导航 `Settings → Sync`，或 hash `#settings`；真实组件里即「Settings 菜单 → waveconfig block → 左栏 Sync」。

### R1 云同步 + 元数据（来源 / 电脑 / 创建时间）

条目上新增一组**来源元数据**（不只是同步字段）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `createdBy.kind` | `human` \| `agent` | 人创建 / agent 创建 |
| `createdBy.name` | string | 人 → 本机用户名；agent → `pi` / `claude` / `codex` |
| `origin.deviceId` | string | 稳定设备 ID（首次生成后写盘，换机不重号） |
| `origin.deviceName` | string | 展示名（默认 hostname，可在设置里改名） |
| `origin.platform` | string | `win32` / `darwin` / `linux` |
| `createdat` / `updatedat` | number | 已存在，沿用 |
| `rev` | number | 条目级版本号，同步冲突判定用 |
| `deletedat` | number? | 墓碑（删除也要同步，否则另一台设备会复活） |

**本原型没有画的部分**（属同步引擎，不是 UI）：传输协议、账号、冲突自动合并策略。见 README 末尾「必须由你拍板的四项」。

同步状态在 UI 上只有三态 + 一个悬浮面板：`已同步 / 同步中 / 有冲突`。

### R2 按创建者筛选

左栏搜索框下方新增一行**创建者筛选 chip**：`All / 👤 Humans / 🤖 Agents`（带条数），
右侧一个**电脑**下拉（`Any computer` / 具体设备名，带设备图标与条数）。

- 与已有的 `untagged` / tag chip 是**叠加关系**（AND），不是替换。
- 计数随其它筛选条件实时重算（不是全量静态计数），避免「点了后变成 0 条」的困惑。
- agent 条目在列表行带一个 `🤖 name` 徽标，人条目带 `👤`，扫一眼能分清来源。

### R3 Notion / Obsidian 式详情

右栏从「标题 input + textarea + tag 列表」升级为**页面式布局**：

```
[emoji]  ← 点击开 emoji picker（复用 markdown `:` 选择器同一份组件 / recents）
Title                         ← 大号标题，可直接改
────────────────────────────
👤 Created by    Nita
💻 Computer      Home PC · Windows
🕒 Created       Nov 6, 2026 09:12
🕓 Updated       5h ago
🏷  Tags          #sql #report  +
⌨  Shortcut      rpt
🔥 Used          24×
────────────────────────────
正文（Markdown 渲染 / 可编辑切换）
```

- 属性行严格按 Notion 的 `name 值` 两列网格排；键名走 secondary，值走 primary。
- 「Icon 不是属性」：emoji 独立在标题左侧，作为 page icon。
- 正文区支持 `Preview / Edit` 切换——预览用真实 markdown 渲染，编辑是等宽 textarea。
  （真实组件里已有 markdown 渲染管线，落地时直接复用预览块，不新写一套。）
- 底部保留原有的 `Send / Copy / Insert / Delete` 动作行。

## 交互一览

| 操作 | 结果 |
|---|---|
| 在顶部 composer 打字 | 左栏列表按内容过滤（与真实弹窗一致）；点漏斗图标可停止过滤 |
| composer 聚焦 / 失焦 | 展开到 120px / 600ms 后按有无换行收回 36px |
| 点右栏 Insert | 正文落到 composer，并把该条 `usagecount+1`、`lastusedat` 刷新 |
| 点左栏行 | 右栏切换到该条 |
| 点左栏 `👤 / 🤖` chip | 只显示对应来源（再点 All 复位） |
| 选电脑下拉 | 只显示该设备创建的条目 |
| 点右栏大 emoji | 开 emoji picker（搜索 / 分类 / 最近使用） |
| 选 emoji | 立刻写入并进「最近使用」 |
| 点 `Preview / Edit` | 正文切换渲染 / 编辑 |
| 点右上同步状态 pill | 展开同步面板：Transport 单选 + 状态 + 设备列表 + 冲突条数 |
| 点未激活的 transport 行 | 弹**内联**确认（选基线 → Switch & re-sync）；点已激活行无反应 |
| 点已置灰的 transport 行 | 无反应，原因在描述行与 tooltip 里 |
| 点 `Configure token…` | Git 前置满足，该行立刻可点（模拟 keyring 已写入） |
| 点面板 footer 的 gear | 关闭面板，打开 waveconfig 设置块的 Sync 条目 |
| 设置块改字段 | 标题栏出现 `Unsaved changes`，Save 点亮（草稿态，真实组件同款） |
| 设置块 Save | 落库；若 transport 变了会自动回到面板走切换确认 |
| 设置块点 `Save token` | 立刻生效（不等 Save），Git 行当场变可点 |
| 设置块切 Visual / Raw JSON | JSON 页签实时反映草稿值（真实组件是 Monaco） |
| 面板里「模拟另一台设备新建」 | 列表顶部插入一条 `Work PC` 的条目，状态 pill 变 `同步中 → 已同步` |
| 面板里「模拟 Agent 改这条」 | 当前条目出现 `⚡ 冲突` 徽标 + 面板计数 +1 |

## 原型刻意没做的事

- **不画左栏其它条目的内容**：General / App Theme 等点了只 toast（不在本原型范围），真实组件里它们本来就有实现。
- **Raw JSON 不可编辑**：真实组件是 Monaco 双向编辑，原型只读展示键名约定。
- **不做账号 / 登录 UI**：只做 transport 选择；账号体系是 D1 方案 C 的前置，未定前不画。
- **不做真正的 keyring 读写**：`Configure token…` / `Save token` 只是把 `gitToken` 置 true，真实实现要存 OS keyring。
- **不画原生目录选择器**：`Choose folder` 只出提示，真实实现是 `dialog.showOpenDialog({properties:["openDirectory"]})`。
- **不做 Reset 的真实清理**：只置 `resetPending` + 提示，不真的删游标文件。
- **不做冲突解决对话框**：先只暴露「有冲突」这个状态，解决策略（逐字段选边 / 整体选边 / 自动合并）需要你拍板后再画。
- **不改列表行的图标语义**：上一版原型（`commontext-list-meta-sort`）定的 `fa-repeat / fa-clock` 时间与次数列保持原样，本版只加来源徽标。

## 必须由你拍板的四项（原型里按推荐值实现）

### D1 同步后端（**已按「编译期枚举 + 单活跃」实现于原型**，下表是选哪个先做）

| 方案 | 成本 | 优点 | 缺点 |
|---|---|---|---|
| **A. 云盘目录**（OneDrive / iCloud / Dropbox 里放 `commontext.json`） | 极低，纯前端 | 零服务器、零账号；用户已有 | 并发写易冲突；移动端/多端体验取决于云盘；无实时 |
| **B. Git 仓库 / Gist**（私有 repo + 定时 commit） | 低 | 免费、天然版本历史与回滚；冲突可见可解 | 需 token；实时性差；大文本会撑仓库 |
| **C. 自建轻量服务**（Go 服务 / Supabase / CF Workers + D1） | 中高 | 真·实时、可做账号与权限、可扩展其它域 | 要服务器与运维；要做鉴权 |
| **D. 复用未来账号体系** | 取决于排期 | 一次做对 | 若账号体系未定，会阻塞本次功能 |

推荐 **先 A 后 C**：A 用一个 `commontext.json`（带 `rev` / `deletedat`）先跑通「多机同步 + 来源元数据」，
文件层用「改名 + 原子替换 + 后写者按 rev 判冲突」，等账号体系统一后再换传输层。
好处：数据格式（R1 的字段）现在就能定稿，换后端不用改 UI 和存储模型。

**原型里已实现的接口形状**（落地时照此抽 transport）：

```go
type SyncTransport interface {
    Id() string
    Capabilities() Caps   // requiresCredential / realtime / atomicWrite
    Pull(ctx context.Context) (Snapshot, error)
    Push(ctx context.Context, Snapshot) error
}
// 设置项 commontext:sync:transport = none | folder | git | server（枚举，非法值回落 none）
```

### D5 什么时候才真值得做成可安装插件

三条判据，全中才动：① 需要独立发版（不发主程序也能更新适配器）；② 出现第三方适配器
（用户自己写 S3 / WebDAV）；③ 同步从 Common Text 扩到 N 个域且各域传输需求不同。
在此之前，「编译期枚举 + capabilities 门控」够用，不会把沙箱与权限模型提前背进来。

### D2 agent 身份怎么来（`createdBy.kind=agent` 时）

- **A1**：由 agent 调用 `wsh` 命令写条目时显式传 `--created-by pi`（推荐：显式、可审计）
- **A2**：由后端按当前 block 的 agent 类型推断（自动，但存在「其实是用户让 agent 代写」的模糊）
- **A3**：不区分，全部记 human（放弃需求 1 的一半价值）

推荐 **A1 + A2 兜底**：命令带参数优先，没带则按调用上下文推断。

### D3 设备展示名

- 默认 `hostname`；允许用户在设置里改成 `Home PC / Work Mac`（推荐：名字要好认）
- `deviceId` 一旦生成不再变（与设备名解耦），换名不产生重复设备

### D4 冲突粒度

- **每字段 LWW**（`updatedat` 大者胜，平局按 `deviceId` 字典序）——简单、无 UI
- **每条整体选边**——需要冲突 UI，但用户能看懂
- **自动合并 + 冲突标记**（推荐）：正文/标签按行级合并，合并不了才标冲突

## 落地影响面（给实现阶段的提示）

| 层 | 要改的东西 |
|---|---|
| `pkg/wconfig/settingsconfig.go` | `CommonTextItemType` 加 `createdby` / `origin` / `rev` / `deletedat` |
| `pkg/commontextstore/commontext_store.go` | DB 列 + 迁移 + `List` 的 `CreatorFilter` / `DeviceFilter` |
| `schema/settings.json` | 同步上述字段（jsonschema 是生成的，改 Go 后重跑） |
| `frontend/app/commontext/commontext-model.ts` | `CommonTextItem` 类型 + normalize 兜底（旧数据无字段时按 `human/local` 填） |
| `frontend/app/commontext/commontext-compose-modal.tsx` | 列表来源徽标、创建者/设备筛选、右栏页面式重构 |
| 新文件 | `commontext-emoji.ts`（emoji 存取 + recents 复用）、`commontext-sync/`（传输层） |

**旧数据兼容**：所有新字段可缺省；缺失时 `createdBy = {kind:"human", name:""}`、
`origin = {deviceId:"local", deviceName:"This machine"}`、`rev = 0`，不触发迁移写盘。
