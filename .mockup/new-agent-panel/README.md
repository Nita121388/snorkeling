# New-Agent 浮窗信息展示 + 继承项开关 — UI 原型

> 目的：在 New-Agent 浮窗里同时显示 vendor 列表 + 选中 vendor 的详情信息 + 用户可控的"继承项"开关。
> 本文件先给三个布局变体的 ASCII mockup，挑一个再细化。
> 真实落地走 snorkeling 私有"叠加层"路线（不动 cc-switch）：backend 新增 per-vendor inherit 选项存储 + RPC，前端这一块浮窗消费。本文档先于实施。

---

## 解决的问题

1. **用户看不到隔离做了什么**：选中一个 vendor 后，用户不知道这个 vendor 的隔离目录在哪、env 是什么、hooks 会不会触发 agent-status。
2. **继承项硬编码**：今天物化函数硬编码只带 `env`（刚修复后改成 `env + hooks`），用户没有"我这个供应商要继承 permissions"的入口。
3. **没有诊断视图**：vendor 是否装好了 hooks、settings.json 长什么样、状态图是否打通，都是黑箱。

---

## 数据事实（从这次实测摸到）

可继承的顶层键（claude settings.json spec）：

| 键 | 含义 | 默认策略 | 备注 |
|---|---|---|---|
| `env` | 环境变量 | 永远继承（vendor 自带） | 已实现，不动 |
| `hooks` | 钩子（agent-status 依赖） | 默认继承全局 | 刚修复：仍默认 on |
| `permissions` | allow/deny 工具权限 | 默认不继承 | DB 里实测 0 个 vendor 配 |
| `outputStyle` | 输出风格 | 默认不继承 | DB 里实测 0 个 vendor 配 |
| `enabledPlugins` | 启用插件 | 默认不继承 | DB 里实测 0 个 vendor 配 |

冷冰冰的事实：在你 cc-switch 用户库里，permissions / outputStyle / enabledPlugins **没人配**，所以"完整继承 UI"用户实际价值不高——但留出开关位置，将来 cc-switch 端有人配了就能开。

---

## 三个布局变体（ASCII）

### 变体 A — 详情抽屉（"右侧 drawer"，浮窗 = 主面板 + 抽屉）

```
┌─ New Agent ────────────────────────────────────────────────────┐
│  App:    [Claude  v]                  Target:  [Current Tab v] │
│  Vendor: [GLM  v]  ⓘ                                       [×] │
│ ╒═════════════════════════════════════════════════════════════╕ │
│ │ Vendor: GLM (id 4b2ac9d2-026e-45a4-ae6b-86a09b17f4fa)         │ │
│ │ ───────────────────────────────────────────────────────────  │ │
│ │ 隔离目录: %WAVEDATA%\claude-vendors\4b2ac9d2-026e-...        │ │
│ │          物化文件: settings.json (2 keys, hooks=6)          │ │
│ │ ───────────────────────────────────────────────────────────  │ │
│ │ 继承项（on = 此 vendor 隔离 settings.json 会带这些键）       │ │
│ │                                                              │ │
│ │   [✓] hooks                  ← 来自全局 ~/.claude/...       │ │
│ │       当前 6 个事件 PreToolUse(3) PostToolUse(2) Stop(1)     │ │
│ │                                                              │ │
│ │   [ ] permissions            ← 全局 has: 否 → 继承后无内容  │ │
│ │   [ ] outputStyle            ← 全局 has: 否 → 继承后无内容  │ │
│ │   [ ] enabledPlugins         ← 全局 has: 否 → 继承后无内容  │ │
│ │                                                              │ │
│ │ ───────────────────────────────────────────────────────────  │ │
│ │ ENV (来自 cc-switch DB, 共 3 项)                             │ │
│ │   ANTHROPIC_BASE_URL  = https://api.supxh.xin/api           │ │
│ │   ANTHROPIC_AUTH_TOKEN= sk-xxxxx (截断)                     │ │
│ │   ANTHROPIC_MODEL     = claude-sonnet-5-20250929            │ │
│ │                                                              │ │
│ │ ───────────────────────────────────────────────────────────  │ │
│ │ 物化预览（claude-vendors/4b2ac9d2-.../settings.json）        │ │
│ │ ┌──────────────────────────────────────────────────────────┐ │ │
│ │ │ {                                                        │ │ │
│ │ │   "env": { "ANTHROPIC_BASE_URL": "...", ... },           │ │ │
│ │ │   "hooks": { "PreToolUse": [...], ... }                 │ │ │
│ │ │ }                                                        │ │ │
│ │ └──────────────────────────────────────────────────────────┘ │ │
│ │                                                              │ │
│ │ [打开隔离目录] [重新安装 hooks] [复制 JSON]                  │ │
│ ╘═════════════════════════════════════════════════════════════╛ │
│                                                                │
│  [Continue]                              [Cancel]              │
└────────────────────────────────────────────────────────────────┘
```

- 优点：信息密度高、但只在用户主动展开"ⓘ"时弹出来；浮窗主面不受影响；继承项开关和诊断视图放在一起。
- 缺点：drawer 占空间，浮窗窄时可能盖住主面板；vendor 切换时 drawer 内容要重新加载。

### 变体 B — 内联折叠（"展开下面板，不弹 drawer"）

```
┌─ New Agent ────────────────────────┐
│ App:   [Claude v]   Target: [Cur v]│
│ Vendor:[GLM v]  ⓘ 详情 + 继承项 ▾  │
├────────────────────────────────────┤
│ ▾ Vendor 详情                      │
│   隔离目录             %WAVEDATA%\ │
│                        claude-vendors\4b2ac9d2-...            │
│   物化文件             settings.json (2 keys, hooks=6)        │
│                                    │
│   继承项                            │
│   [✓] hooks  ←全局 6 事件           │
│   [ ] permissions                   │
│   [ ] outputStyle                   │
│   [ ] enabledPlugins                │
│                                    │
│   ENV (3 项)                        │
│     ANTHROPIC_BASE_URL  = https://...│
│     ANTHROPIC_AUTH_TOKEN= sk-xxx    │
│     ANTHROPIC_MODEL     = claude-...│
│                                    │
│   [打开隔离目录] [复制 JSON]        │
│ ▴                                  │
├────────────────────────────────────┤
│ [Continue]            [Cancel]     │
└────────────────────────────────────┘
```

- 优点：单层结构，无 drawer；用户展开后看到一切；浮窗高度自适应。
- 缺点：浮窗变长（向下撑开），窄屏要滚动；继承项开关和详情挤在一个区块；vendor 切换时面板要重建内容。

### 变体 C — Tab 切换（浮窗内三个 Tab：基础 / 详情 / 继承项）

```
┌─ New Agent ────────────────────────┐
│ App:   [Claude v]  Target: [Cur v] │
│ Vendor:[GLM v]            [×]      │
├────────────────────────────────────┤
│ [ 基础 ][ 详情 ][ 继承项 ]          │
├────────────────────────────────────┤
│ Tab: 继承项                        │
│                                    │
│ 此 vendor 隔离 settings.json 带：  │
│                                    │
│   [✓] hooks                全局 ✓  │
│       6 个事件 PreToolUse(3)...    │
│                                    │
│   [ ] permissions          全局 ✗  │
│       继承后无内容                  │
│                                    │
│   [ ] outputStyle          全局 ✗  │
│                                    │
│   [ ] enabledPlugins       全局 ✗  │
│                                    │
│ ⓘ 改动后下次 listVendors 重新物化  │
│   当前 vendor 已启动的 block 需  │
│   重启才生效                       │
│                                    │
├────────────────────────────────────┤
│ [Continue]              [Cancel]   │
└────────────────────────────────────┘
```

- 优点：每个 tab 信息隔离、单页不挤；继承项独立 tab 凸显它是个动作区。
- 缺点：tab 切换是导航，多一步；继承项和详情拆开，"改开关 → 看物化效果"需要切回详情 tab。

---

## 设计稿元素清单（不论选哪个变体都要包含）

### 信息展示（read-only）

1. vendor 名称 + id + app_type
2. 隔离目录绝对路径（`%WAVEDATA%/claude-vendors/<id>/`）
3. 物化文件名 = settings.json（claude）和 auth.json + config.toml + hooks.json + catalog.json（codex）
4. 当前物化文件 top-level 键清单 + 计数（hooks 有几个事件、env 有几项）
5. ENV 表格（截断敏感值，比如 ANTHROPIC_AUTH_TOKEN）
6. 物化文件 JSON 预览（可折叠 + 可复制）
7. **诊断徽章**：hooks 继承状态
   - ✓ inherited from global（6 events）
   - ✓ inherited from vendor DB（4 events）— 当前方案"只继承全局"，不出现
   - ✗ not inherited（toggle off）
   - ✗ global hooks missing（需 InstallClaudeHooks）

### 继承项开关（per-vendor）

```
[ ] hooks            ← 来自全局 ~/.claude/settings.json 的 hooks 块
[ ] permissions      ← 同上，全局 permissions 块
[ ] outputStyle      ← 同上，全局 outputStyle 字符串
[ ] enabledPlugins   ← 同上，全局 enabledPlugins 数组
```

每个开关下面有"全局是否有内容"快速指示，避免用户开关了一项全局根本没配的，等于空动作。

### 操作按钮

- [打开隔离目录]（os.openExternal）
- [重新安装全局 hooks]（调用 InstallClaudeHooks 后刷新）— 仅 hooks 有问题时有意义
- [复制 JSON]（复制物化文件内容到剪贴板）

### 状态契约提示

当用户改了继承项开关时，提示：
- "改动后下次切换 vendor 或重新打开浮窗时重新物化。"
- "已在线的 vendor block 需要重启才能生效（claude 启动时读一次 settings.json）。"

---

## 落地路线（B3 叠加层，与上面 UI 同步）

阶段 1（最小可上线）：UI 信息展示部分无配置
- backend 加 RPC：`ccswitchgetvendorinheritstatus` 返回选中 vendor 当前物化内容、全局继承源、各键的存在与否
- frontend 加详情区域（变体 B 或 C 的"详情"部分）
- 不动 materialize 函数

阶段 2（引入继承开关）：
- backend 加私有叠加层存储（snorkeling 自己的 SQLite 表或 json 文件，键 vendorId+appType）
- materialize 时读叠加层决定带哪些键
- frontend 加继承项开关 UI（变体 B 或 C 的"继承项"部分）
- RPC 加 `ccswitchsetvendorinherit` / `ccswitchgetvendorinherit`

阶段 3（诊断动作）：
- "重新安装全局 hooks" 按钮 → 调 InstallClaudeHooks 后清缓存强制重新物化
- "打开隔离目录"按钮
- 物化状态徽章

阶段 1 是最小可立刻上的，阶段 2、3 依赖叠加层 schema 决策。

---

## 待决问题

1. 三个变体挑哪个？A 抽屉 / B 内联折叠 / C Tab 切换
2. ENV 里的敏感值（ANTHROPIC_AUTH_TOKEN 等）要不要默认掩码，hover/点击才显示？
3. 物化 JSON 预览是只读还是要支持手动编辑（编辑会保存到隔离目录）？建议只读——手动编辑会被下次重物化覆盖。
4. 继承项开关的状态：默认全 on 还是只 hooks 默认 on 其余默认 off？本次修复那条就是 "默认只 hooks on"。建议 UI 反映默认值，让用户手动开其它。
