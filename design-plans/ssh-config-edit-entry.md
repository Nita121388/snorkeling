# 连接下拉框支持「编辑 SSH Config」快速入口

Written against: 8bef3e66

## 需求

终端 block 的连接下拉框（ChangeConnectionBlockModal）提供「编辑 SSH 配置」入口，一键在应用内打开并编辑 SSH host config 文件（默认 `~/.ssh/config`），无需用户记住 `wsh editor ~/.ssh/config` 命令。当前块的连接为远程时，打开并编辑的是**远程**的 `~/.ssh/config`。

## Evidence chain

- 连接下拉框已有管理类入口：`getConnectionsEditItem`（`frontend/app/modals/conntypeahead.tsx`）在无输入时显示 `Edit Connections`，点击后 `createBlock` 打开 waveconfig 视图编辑 `connections.json`。
- 应用内已有通用文件编辑能力：`wsh editor <绝对路径>`（`cmd/wsh/cmd/wshcmd-editor.go`）通过 `CreateBlockCommand` 创建 preview 视图 block（`view: "preview"`, `edit: true`），支持 `-m` 放大模式；preview 视图对任意存在的文本文件可读可写（`frontend/app/view/preview/preview-edit.tsx`）。
- 后端 FileRead/FileWrite 支持 `~` 展开与远程连接解析：`pkg/wshrpc/wshremote/wshremote_file.go` 中所有路径先过 `wavebase.ExpandHomeDirSafe`，且 RPC 走当前 block 的 connection；preview 的 `formatRemoteUri` 把 `~/.ssh/config` 拼成 `wsh://<conn>/~/.ssh/config`（`frontend/util/waveutil.ts`），远端与本地行为一致。
- SSH config 目前只读使用：`pkg/remote/conncontroller/conncontroller.go` 的 `GetConnectionsFromConfig` 解析 `~/.ssh/config` 与 `/etc/ssh/ssh_config` 生成连接列表；没有写回 ssh config 的路径，也没有 UI 入口。
- `wsh editconfig <name>` 不能用于 ssh config：它走 waveconfig 视图（`cmd/wsh/cmd/wshcmd-editconfig.go`），路径相对 Snorkeling config 目录拼接，只认 settings.json / connections.json / presets.json 等内部文件。
- Windows 下 OpenSSH 默认配置同样位于 `%USERPROFILE%\.ssh\config`，`~` 展开路径一致，无需平台分支。

### 平台路径兼容性（所有平台用同一个路径）

`GetConnectionsFromConfig`（`pkg/remote/conncontroller/conncontroller.go`）已用 `filepath.Join(home, ".ssh", "config")` 读取用户级 SSH config，`home` 来自 `wavebase.GetHomeDir()`（`os.UserHomeDir()`），所有平台均覆盖。

本方案前端统一传 `~/.ssh/config`，后端 `ExpandHomeDirSafe`（`pkg/wavebase/wavebase.go:181`）展开，无需前端做平台分支：

| 平台 | `os.UserHomeDir()` → `ExpandHomeDirSafe("~/.ssh/config")` | 说明 |
|---|---|---|
| macOS | `/Users/<user>/.ssh/config` | 与 OpenSSH 默认一致 |
| Linux | `/home/<user>/.ssh/config` | 与 OpenSSH 默认一致 |
| Windows | `C:\\Users\\<user>\\.ssh\\config` | `~/` 前缀在 Windows 无条件匹配；`filepath.Clean` 把 `/` 规范化为 `\\` |
| 远程 POSIX | 远端 wsh 同样逻辑，`~` 展开为远端用户 home | 远端需安装 wsh |
| 远程 Windows | 远端 wsh 同样逻辑 | 远端需安装 wsh |

`kevinburke/ssh_config` 库的 `DefaultUserSettings` 在各平台读取的默认路径与 OpenSSH 一致：POSIX `~/.ssh/config` + `/etc/ssh/ssh_config`；Windows `%USERPROFILE%\\.ssh\\config` + `C:\\ProgramData\\ssh\\ssh_config`。

**结论**：前端只传 `~/.ssh/config`，不做平台判断；平台差异完全由 `wavebase.ExpandHomeDirSafe` + 远端 wsh 透传处理。

## Design decision

在连接下拉框底部新增一个与 `Edit Connections` 并排的管理条目 **Edit SSH Config**，点击后关闭下拉框并创建 preview 视图 block：

```
meta: {
  view: "preview",
  file: "~/.ssh/config",
  edit: true,
  connection: <当前 block 的 connection，若有>
}
```

- 显示条件与 `Edit Connections` 一致：`connSelected == ""`（下拉框无输入时）才显示，避免和用户正在输入的新连接名混淆。
- 当前块已连接远程时，`connection` meta 透传给 preview 视图，后端按该连接解析并读写远端 `~/.ssh/config`；本地块则读写本地文件。此行为与现有 preview 文件编辑完全一致，零新增逻辑。
- 文件不存在时沿用 preview 视图现有的错误展示（`File Read Failed`），提示用户先创建文件；不做自动创建，避免越权写 `.ssh` 目录。`ponytail:` 若后续需要"一键新建 ssh config"，可在 preview 的错误态增加引导，不在此次范围。
- 不修改 SSH config 解析逻辑，不写回 ssh config，不新增后端命令；全部复用现有 preview 编辑链路。

## Reuse

- `frontend/app/modals/conntypeahead.tsx`：`getConnectionsEditItem` 的条目样式（icon `gear`、`status: "disconnected"`、灰色 iconColor、onSelect 内 `globalStore.set(changeConnModalAtom, false)` + `createBlock`）与建议列表组装逻辑。
- `frontend/app/store/global.ts` 的 `createBlock(blockDef, magnified, focused)`。
- preview 视图：`view: "preview"` + `edit: true`（`MetaKey_Edit`）的编辑模式，`wsh editor` 已验证可用。
- `~` 展开：后端 `wavebase.ExpandHomeDirSafe`；前端 `formatRemoteUri`。

## Changes

1. `frontend/app/modals/conntypeahead.tsx`
   - Add: `getSshConfigEditItem(changeConnModalAtom: jotai.PrimitiveAtom<boolean>, connSelected: string, connection: string | null)`，与 `getConnectionsEditItem` 同构；`connSelected != ""` 时返回 null。
   - Change: 在 `ChangeConnectionBlockModal` 组件内调用，并把 `blockData?.meta?.connection` 传入；新条目加入 `suggestions` 数组，排在 `Edit Connections` 之后。
   - 条目定义：`icon: "gear"`（或 `"file-lines"`，按现有 icon 集可用性选择）、`iconColor: "var(--grey-text-color)"`、`value: "Edit SSH Config"`、`label: "Edit SSH Config"`、`status: "disconnected"`。
   - onSelect 实现：
     ```
     globalStore.set(changeConnModalAtom, false);
     const blockDef: BlockDef = {
       meta: {
         view: "preview",
         file: "~/.ssh/config",
         edit: true,
         ...(connection ? { connection } : {}),
       },
     };
     await createBlock(blockDef, false, true);
     ```
   - Preserve: `Edit Connections`、Reconnect/Disconnect、New Connection、Local/Remote/WSL 分组、键盘导航、筛选逻辑均不变。

## Scope

- Inherit: 本地连接与所有远程连接的 preview 编辑链路；light/dark/monochrome 主题下的 TypeAheadModal 渲染。
- Verify: 本地打开 `~/.ssh/config` 可编辑可保存；远程连接块打开远端文件；无输入时条目出现、有输入时隐藏；`~/.ssh/config` 不存在时的错误展示；键盘上下键可选中该条目并回车触发。
- Exclude: SSH config 解析/写回逻辑（conncontroller、sshclient）、`wsh editor` 命令本身、waveconfig 视图、连接创建/删除、WSL 连接、其他弹窗。

## Validation

- Product: 打开连接下拉框，选中 `Edit SSH Config`，确认打开可编辑 preview 视图；修改并保存后 `cat ~/.ssh/config` 内容更新；远程连接块重复操作，确认编辑的是远端文件。
- Interface: 使用 `node scripts/inspect-electron-ui.mjs` 检查条目在无输入/有输入时的显示与隐藏、键盘高亮、点击行为；截图记录下拉框与打开的 preview 视图。
- System: `rg -n "Edit SSH Config" frontend/app/modals/conntypeahead.tsx` 命中且仅有预期条目；无新增后端命令或配置项。
- Repository: `npm test -- --run frontend/app/modals/conntypeahead.test.ts`（若有）通过；`npm run build:prod` 成功。
- Repository: GitNexus `impact({target: "ChangeConnectionBlockModal", direction: "upstream"})` 记录 direct callers 与风险等级；HIGH/CRITICAL 先向用户预警。`detect_changes({scope: "compare", base_ref: "main"})` 只包含 conntypeahead 的预期变更。

## Stop conditions

- Stop if GitNexus impact 返回 HIGH/CRITICAL，直到用户确认风险。
- Stop if `createBlock` 创建的 preview 视图无法以 `edit: true` 打开 `~/.ssh/config`（如 `~` 未展开或远程连接未透传），退回 `wsh editor ~/.ssh/config` 方案并单独评估。
- Stop if 需要新增后端命令、修改 ssh config 解析/写回、或改动共享 TypeAheadModal 组件；超出已批准范围，必须单独设计。

## Design documentation

- After acceptance and validation: 更新 `docs/docs/connections.mdx` 的「Add a New Connection to the Dropdown」章节，补充「Edit SSH Config」入口说明；无需改动 `docs/design-system.md`。
