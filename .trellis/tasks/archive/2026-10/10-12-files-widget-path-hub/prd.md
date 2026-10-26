# Files 悬浮窗升级为路径中枢（真实最近/常用路径）

## Goal

右侧 WidgetsBar 的 Files 悬浮窗（`NewFilesFloatingWindow`）目前只有两块内容：需要去别处右键才能产生的 Pinned，以及**只在自身面板里点过才记录的 Recent**（不持久化，重启即丢）。它在设计上无法反映用户真实使用路径，因此没有价值。

本任务把该悬浮窗升级为**真实路径中枢**：

1. 记录用户在 preview 中**真实打开/导航**过的路径（当前为死代码，见下）
2. 由使用频率 + 最近程度**自动学习"常用路径"**
3. 面板内可直接 Pin/Unpin，无需绕到目录右键菜单
4. 提供搜索过滤，路径多也能用
5. 会话间**持久化**（重启不丢）

## Background

- 现有面板：`frontend/app/view/preview/preview-new-files.tsx`
- 现有接线：`frontend/app/workspace/widgets.tsx`
  - `handleWidgetHover` 对 `defwidget@files` 延迟 500ms 打开面板
  - `handleWidgetSelect` **未**对 files 特殊处理 → 点击直接建一个 `file: "~"` 的 preview block
  - `filesRecentDirs` 是组件内 `useState`，仅在面板内选择时写入，不持久化
  - `filesPinnedDirs` 读 `settings["preview:pinned-directories"]`
- `PreviewModel.trackRecentDir()` / `clearRecentDir()` / `recentDirs` atom **已定义但全项目无调用点**（死代码），真实导航从未被记录
- Pinned 只能通过目录右键菜单产生（`preview-directory-utils.tsx` 的 `model.togglePinnedDir`）
- 路由关键点：preview 中所有打开/导航（含目录跳转）都汇聚到 `PreviewModel.goHistory()` → `UpdateObjectMeta` 更新 `block.meta.file`

## Requirements

### R1 记录真实路径使用
- 用户在 preview 中打开文件或导航到目录时，记录该路径。
- 记录需覆盖：打开文件、打开目录、在目录视图内跳转、从面板选择路径。
- **记录必须覆盖 Files Block 目录树/列表右键菜单里的「Open in This Block」与「Open in New Block / Open Preview in New Block」**（用户明确提出的来源）。
  - 「Open in This Block」走 `PreviewModel.goHistory()` 改同一 block 的 `meta.file` → 由 `metaFilePath` 订阅记录。
  - 「Open in New Block」经 `openPathInNewBlockSmart()` 新建 preview block（`createPreviewBlockForOpen` / `openPathInPreviewBlockAsTab` 在创建时就写入 `meta.file`）→ 由新 block 的 `PreviewModel` 构造函数首记 + 订阅记录。
- 记录字段：路径、连接（本地/远程）、类型（dir/file）、累计次数、最后使用时间。
- 类型判定优先级：stat 成功 → `finfo.isdir`；stat 失败（`statFile` 内部已 catch，返回 `undefined`）→ 回退到 block meta 的 `preview:pathisdir`（`createPreviewBlockForOpen` / `applyDirectoryNavigationMeta` 对目录会写 `true`），避免目录被误记为 file。
- 记录不得因 stat 失败而整体丢失（`statFile` 失败时仍须用已知路径落一条记录）。
- **构造时的初始记录必须按 block 幂等**：`BlockInner` 以 active inline tab 为 key，切换 tab 会 dispose 并重建 `PreviewModel`；初始记录需按 blockId 去重（每会话每 block 至多一次），否则单纯切换 inline tab 会虚增该路径的 `count`。真实导航（`metaFilePath` 订阅）保持无门槛，仍然记录。

### R2 常用路径自动学习
- 按 `次数 × 时间衰减` 排序，产出"常用路径"列表。
- 一次性访问不进入常用（次数阈值）。
- 路径数量有上限，超出按分数淘汰。

### R3 最近路径修复 + 持久化
- Recent 必须来自真实使用，而非"只用面板才有记录"。
- Recent 跨会话（重启）保留。
- Recent 与 Pinned/常用去重，避免同一条路径在面板里出现三次。

### R4 面板内管理
- 面板内可直接 Pin / Unpin。
- 可从 Recent 中移除单条。
- 已有 `preview:pinned-directories` 数据与语义保持不变，Pinned 区仍置顶。

### R5 搜索过滤
- 面板顶部有搜索框，按路径/末段名做大小写不敏感的子串过滤。
- 键盘可用：输入过滤、↑/↓ 移动、Enter 打开、Esc 关闭。

### R6 交互（已确认）
- 点击 Files widget **打开面板**（不再直接建 `~` block），Home 作为面板内一项保留。
- hover 打开面板的行为保留。

### R7 路径与噪音规则
- 路径归一化：`~` 展开、去尾斜杠、统一分隔符。
- 本地/远程按 connection 独立统计（同一路径不同 connection 视为不同条目）。
- 过滤明显噪音路径（如 `/tmp`、`node_modules`、`.git` 内部等）。

## Non-Goals (P0)

- 不改后端协议（不新增 RPC 命令、不新增 SQLite 存储）。
- 不做"当前 tab / 终端 cwd 上下文"分区（P1）。
- 不做系统快捷位置（Desktop/Downloads/Documents）（P1）。
- 不做终端 cwd 埋点（P1/P2，噪音风险）。
- 不做跨设备同步（依赖配置文件的既有同步能力）。

## Acceptance Criteria

- [ ] AC1：在 preview 里打开一个文件、再打开一个目录后，打开 Files 面板，"Recent" 出现这两条（此前为空）。
- [ ] AC2：重启应用后，"Recent" 仍包含上述路径（持久化生效）。
- [ ] AC3：同一路径被访问 3 次以上时出现在"Frequent"，一次性访问的路径不出现在"Frequent"。
- [ ] AC4：Frequent 中较久未用、次数相近的路径排在更近期使用过的路径之后（时间衰减生效）。
- [ ] AC5：同一路径不会同时出现在 Frequent 与 Recent 两处（去重生效）。
- [ ] AC6：面板内点击 Pin/Unpin 立即变化，且写入 `preview:pinned-directories`；已有的右键 Pin 仍然工作。
- [ ] AC7：搜索框输入关键字后，只剩路径或末段名匹配的条目；Esc 关闭面板。
- [ ] AC8：点击 Files widget 打开面板，而不是新建一个 home preview block。
- [ ] AC9：本地与远程同名路径互不混淆（connection 隔离）。
- [ ] AC10：`/tmp`、`node_modules` 下的路径不进入面板列表。
- [ ] AC11：新增纯逻辑单测通过（归一化/噪音/记录/衰减排序/去重/上限淘汰/移除）。
- [ ] AC12：`npm run test` 与 `npm run check:ts`（或等价 tsc 检查）通过。
- [ ] AC13：在 Files Block 中对一个**目录**执行「Open in New Block」，该目录以 `kind="dir"` 进入 Recent；对一个**文件**（列表右键「Open Preview in New Block」或双击）执行后以 `kind="file"` 进入 Recent。
- [ ] AC14：stat 失败（例如不可访问路径）时，路径仍被记录，不会整条丢失。
- [ ] AC15：在 inline-tab 组内来回切换 tab（不重新打开路径）不会让该路径的 `count` 虚增；而真实导航（双击进入子目录 / Open in This Block）仍会记录。

## Constraints

- 遵循仓库既有前端约定（jotai `globalStore` + `getSettingsKeyAtom`，`@floating-ui/react` 浮窗，Tailwind 类名与现有面板视觉语言一致）。
- 持久化必须走既有配置链路：`RpcApi.SetConfigCommand` / `env.rpc.SetConfigCommand`，且新配置键必须在 Go 侧 `pkg/wconfig` 注册（否则 `SetBaseConfigValue` 报 `invalid config key`），并重新生成 TS 绑定。
- 不破坏 `preview:pinned-directories` 的既有格式与右键 Pin 流程。
- 写配置需节流，避免每次导航都落盘。
