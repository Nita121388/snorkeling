# SSH Config 快速编辑入口 — 连接下拉框新条目

> 同步状态：▲ 设计活跃（未实现）
> 镜像源：frontend/app/modals/conntypeahead.tsx, frontend/app/modals/typeaheadmodal.tsx, frontend/app/block/connectionbutton.tsx, frontend/app/view/preview/preview.tsx, pkg/wavebase/wavebase.go, pkg/remote/conncontroller/conncontroller.go
> 最后同步：2026-08-14
> 对应方案：`design-plans/ssh-config-edit-entry.md`

## 需求

终端 block 的连接下拉框（`ChangeConnectionBlockModal`）底部新增 **Edit SSH Config** 条目，点击后在应用内打开 `~/.ssh/config` 进行编辑，无需用户记住 `wsh editor ~/.ssh/config` 命令。当前块连接为远程时，打开并编辑的是远端 `~/.ssh/config`。

## 结构镜像对照

| 原型元素 | 镜像真实源 | 说明 |
|---|---|---|
| `.block-frame-default-header` | `frontend/app/block/blockframe-header.tsx` ~L580 | 含 ViewIcon + ConnectionButton + HeaderTextElems |
| `.conn-button > .conn-icon-stack + .conn-name` | `frontend/app/block/connectionbutton.tsx` | `fa-stack`（laptop/arrow-right-arrow-left + fa-slash opacity）+ ellipsis connName |
| `.type-ahead-modal.has-suggestions` | `frontend/app/modals/typeaheadmodal.tsx` + `typeaheadmodal.tsx` | InputGroup > Input + magnifying-glass；suggestions-wrapper > suggestions |
| `.suggestion-header`（Local / Remote） | `conntypeahead.tsx` `getLocalSuggestions` / `getRemoteSuggestions` | headerText 分组 |
| `.suggestion-item` | `createRemoteSuggestionItems` / `createFilteredLocalSuggestionItem` | icon + ellipsis label + check（current） |
| **新增** `.suggestion-item.action-item[data-action="edit-ssh"]` | `getConnectionsEditItem` 同级新增 `getSshConfigEditItem` | gear icon + "Edit SSH Config"；`createBlock({ view: "preview", file: "~/.ssh/config", edit: true, connection })` |
| `.preview-editor` | `frontend/app/view/preview/preview.tsx` + `preview-edit.tsx` | breadcrumb 路径 + 编辑器主体 + statusbar；真实用 Monaco editor，原型用 `<pre>` 简化 |
| `.preview-badge.local/remote` | 原型新增，表示当前文件来源 | 本地 → `~/.ssh/config`；远程 → `~/.ssh/config (ssh://myhost)` |

## 交互

1. 左栏展示连接下拉框（TypeAheadModal）结构，含新增的 Edit SSH Config 条目（绿色左边框高亮）。
2. 点击 Edit SSH Config → 右侧 Tab <b>新增一个 block</b>（preview 视图 + `edit: true`）打开 `~/.ssh/config`，可连续点击新增多个；每个 block 带 header（view icon + 连接按钮 + 关闭按钮）+ 编辑器 + 状态栏。
3. 顶部切换「本地 / ssh myhost」场景后再次点击 → 新 block 的 header 连接图标 / badge / 状态栏路径展示文件来源差异。
4. 每个新增 block 可点 ✕ 关闭（对应真实 block 关闭）。

## 平台路径兼容性（所有平台用同一个路径）

前端统一传 `~/.ssh/config`，后端 `ExpandHomeDirSafe`（`pkg/wavebase/wavebase.go:181`，`os.UserHomeDir()`）展开，无需前端做平台分支：

| 平台 | 展开结果 | 说明 |
|---|---|---|
| macOS | `/Users/<user>/.ssh/config` | 与 OpenSSH 默认一致 |
| Linux | `/home/<user>/.ssh/config` | 与 OpenSSH 默认一致 |
| Windows | `C:\\Users\\<user>\\.ssh\\config` | `~/` 前缀无条件匹配，`filepath.Clean` 规范 `/` → `\\` |
| 远程 POSIX / Windows | 远端 wsh 同样逻辑，`~` 展开为远端用户 home | 远端需安装 wsh |

> 镜像源已含后端逻辑：`pkg/wavebase/wavebase.go`（`ExpandHomeDirSafe` / `GetHomeDir`）、`pkg/remote/conncontroller/conncontroller.go`（`GetConnectionsFromConfig` 用 `filepath.Join(home, ".ssh", "config")`）。

## 两种场景说明

| 场景 | 下拉框 | Edit SSH Config 打开文件 |
|---|---|---|
| 本地块 | connName = "nita-MacBook"，icon = laptop | `~/.ssh/config`（本地文件） |
| 远程连接块 | connName = "myhost"，icon = arrow-right-arrow-left | `wsh://myhost/~/.ssh/config`（后端 `ExpandHomeDirSafe` 按连接解析 `~`） |

## 落地路线（只改一个文件）

`frontend/app/modals/conntypeahead.tsx`：

1. 新增 `getSshConfigEditItem(changeConnModalAtom, connSelected, connection)`，与 `getConnectionsEditItem` 同构：
   - `connSelected != ""` 时返回 null
   - `icon: "gear"`，`label: "Edit SSH Config"`，`status: "disconnected"`
   - `onSelect`：`globalStore.set(changeConnModalAtom, false)` + `createBlock({ meta: { view: "preview", file: "~/.ssh/config", edit: true, ...(connection ? { connection } : {}) } }, false, true)`
2. 在 `ChangeConnectionBlockModal` 内调用，把 `blockData?.meta?.connection` 传入；新条目加入 `suggestions` 数组，排在 `Edit Connections` 之后。
3. 无需后端改动（FileRead/FileWrite 已支持 `~` 展开 + 远端透传）。
4. 完成后更新 `docs/docs/connections.mdx` 补充入口说明。

## 目录文件

| 文件 | 作用 |
|---|---|
| `index.html` | 单页原型：左侧连接下拉框 + 右侧 preview 编辑器，支持本地/远程场景切换 |
| `style.css` | 真实 dark 主题 token（theme.scss `:root`）+ typeaheadmodal.scss 视觉语言 + preview editor token |
| `script.js` | 交互：场景切换、Edit SSH Config 点击高亮、键盘导航 |
| `README.md` | 本说明（设计意图 + 结构镜像对照 + 落地路线） |

## 怎么打开

```bash
open .mockup/ssh-config-edit/index.html
# 或在仓库目录：
python3 -m http.server -d .mockup/ssh-config-edit 9123
# 浏览器打开 http://localhost:9123
```
