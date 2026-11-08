# Files Block — New Files Floating Window

> 同步状态：▲ 设计活跃（未实现）
> 镜像源：frontend/app/view/preview/preview-model.tsx, frontend/app/view/preview/preview-directory-utils.tsx, frontend/app/view/preview/preview.tsx
> 最后同步：2026-09-07

## Overview

Files Block（Preview 视图）的 folder icon 由 `longClick`（硬编码 5 个 BOOKMARKS）改为 **click → 居中弹出 New Files 浮窗**，弹窗风格对齐 `AgentTargetFloatingWindow`（New Agent / New Terminal）。浮窗管三件事：

1. **置顶目录 Pinned**——用户主动固定、快捷跳转的常用目录
2. **最近访问 Recent**——session 内自动追踪
3. **当前 Tab 默认路径**——经行内 ✓ 勾选，对齐 New Agent 交互（全局默认在 Settings 配置，不放在本浮窗内）

### Problem

当前长点击 folder icon 只弹出 5 个硬编码的 BOOKMARKS（Home / Desktop / Downloads / Documents / Root），用户无法自定义常用路径，也无法为当前 Tab 设定默认打开根。

### Solution

1. **Pinned 浮窗区**：用户主动 Pin 常用目录，点一下快捷跳转
2. **Recent 自动区**：前端 session 内追踪 `goHistory()` 访问历史
3. **默认路径（per-tab）**：在任意 Pinned / Recent 行上 hover 点 ✓，设为当前 Tab 的默认路径；全局默认走 Settings → Files → Default root

### Prototype Scenarios

| Scenario | Description |
|---|---|
| A — New Files Window | 居中弹窗：Pinned 3 条 + Recent 5 条，行内 ✓ 勾选设当前 Tab 默认 |
| B — Right-Click "Pin" / "Set Default" | 右键未置顶目录 → "Pin" + "Set as Tab Default" |
| C — Empty State | 无置顶 + 无历史 → 空态文案；全局默认在 Settings 配置 |
| D — "Unpin" | 右键已置顶目录 → "Unpin"（移除不影响默认） |

### Floating Window 结构 (对齐 AgentTargetFloatingWindow)

| 区域 | Tailwind class | 内容 |
|------|----------------|------|
| Container | `bg-modalbg/80 backdrop-blur-2xl border border-border/70 rounded-xl shadow-2xl` | 毛玻璃居中浮窗 |
| Header | `px-3 py-2 text-sm font-medium border-b border-border/60` | ◈ New Files |
| §1 Pinned | scrollable, `px-1 pb-1` | 用户主动置顶的常用目录；行内 ✓ = 「设为当前 Tab 默认」 |
| §2 Recent | | session 内自动追踪的最近目录；行内同样支持 ✓ 设默认 |
| Row | `py-2 pl-3 pr-2 rounded-md hover:bg-hoverbg` + selected `bg-accent/12` + left 2px bar | icon + label/path + ✓ default(row) + hover × remove |
| Footer | `border-t border-border/60 px-3 py-2` | ⚙ \| path \| +Current \| +New \| Existing… |

### 默认路径 — 行内 ✓ 勾选（per-tab）

默认**不在独立区设置**，而在任意 Pinned / Recent 行上通过 `DefaultCheckButton`（✓）勾选（对齐 New Agent）。

| 级别 | 语义 | 存储 | 对齐 |
|------|------|------|------|
| **Tab 级**（本浮窗 ✓ 勾选） | 当前 Tab 的 Files 打开根 | `UpdateObjectMeta(tab, { "preview:explorer-root": pathKey })` | `AgentDefaultLaunchTargetMetaKey` |
| **全局级**（Settings 页面） | 未手动设默认的 Tab 打开于此 | settings.json `preview:default-root` | `PreviewDefaultOpenTargetSettingKey` |

解耦规则：设默认**不要求**先置顶；置顶**不等于**默认；移除置顶**不会**动 Tab 默认。解析顺序：Tab meta → 全局 `preview:default-root` → 系统兜底。

### Data Model

```jsonc
// settings.json
"preview:pinned-directories": [
  { "path": "~/Projects/snorkeling", "label": "Snorkeling", "addedAt": 1725400000 }
]
```

- Tab 级默认走 per-tab meta：`UpdateObjectMeta(tab, { "preview:explorer-root": pathKey })`，复用既有 `PreviewExplorerRootMetaKey`
- 持久化走现有 `SetConfigCommand` / `GetConfigCommand` / `UpdateObjectMeta`，无后端改动
- Recent dirs 仅前端内存（`Map<string, number>`），不跨 session

### Files Changed

| File | Change |
|------|--------|
| `preview-model.tsx` | folder icon click → `newFilesWindowOpen` atom; add `recentDirs` tracking + CRUD; tab default via `UpdateObjectMeta`(`preview:explorer-root`) |
| `preview-directory-utils.tsx` | Add "Pin / Unpin" + "Set as Tab Default" in context menus |
| `preview.tsx` | Render `NewFilesFloatingWindow` when open |
| New: `preview-new-files.tsx` | NewFilesFloatingWindow (FloatingPortal + useFloating centered) |
| `schema/settings.json` | Add `"preview:pinned-directories"` |

### Notes

- 名称统一为 **New Files**（对齐 New Agent / New Terminal 命名模式）
- Folder icon `click` 替换 `longClick`（breaking UX change）
- Empty state：Pinned/Recent 显示空态；全局默认在 Settings 页面配置
- Footer "Current" 设当前目录为 Tab 默认；"New" 在新 Files 块打开；"Existing…" 弹选目标 Tab
- Right-click menu：Pin / Unpin / Set as Tab Default
