# 设计：文件夹索引徽标（实验插件）

## 边界与外框

- **只动前端**：`frontend/app/view/preview/folder-index/**`（新模块）+ `preview-explorer.tsx`（接 provider）+ `treeview.tsx`（徽标渲染位点）。
- **不改**：`FileInfo`、后端 RPC、Go 包。刷新走既有 `SetMetaCommand` → `SendWaveObjUpdate` 事件链。
- **开关**：block meta `preview:idxbadges`（缺省关）。写 meta 用现有 `SetMetaCommand`；
  代码里 meta 键走常量（`folder-index-meta.ts`），真实渲染不读未知键以外的状态。

## 模块切分（每个都能单测）

| 文件 | 职责 | 纯函数/副作用 |
|---|---|---|
| `folder-index-model.ts` | `STATUS_DEF`、`parseIndexDoc`、`normalizeDeco`、`mergeDecorations`、`BadgeDeco` 类型 | 纯 |
| `folder-index-meta.ts` | meta 键常量、`isIdxBadgesEnabled`、`refreshRevisionFromMeta` | 纯 |
| `folder-index-worker.ts` | 脚本沙箱：接收 code + entries，Blob URL → Worker（5s 超时），逐条 try/catch | 副作用（隔离在此） |
| `folder-index-provider.ts` | 组合两源 + 合并 + 缓存（blockId/revision）+ 读文件 RPC 调用 | 副作用（IO 集中在此） |
| `folder-index-settings.tsx`（可选） | Files block 菜单开关项 | UI |
| `treeview.tsx` | 导出 `TreeNodeBadge`；`TreeNodeData.badge?: { emoji; title?; color? }` | 纯渲染 |

## 数据流

```
Files block mount（meta 开）
  → provider.refresh(blockId): 读 <root>/index.md（ReadFile RPC，失败即空）
  → 读 <root>/.index/badges.js（失败即空）
  → worker 批量跑 decorate(entry)（失败/超时=脚本源空）
  → merge(index, script) → decorations: Map<relPath, BadgeDeco>
  → explorer 把 decoration 写进 TreeNodeData.badge（仅文件行）
  → TreeView 行渲染 <TreeNodeBadge>

meta preview:idxrefresh 变化 → revision 变 → provider 重算（缓存 key 带 revision）
```

## 关键取舍

1. **为什么 worker**：用户脚本是任意 JS，主线程执行会卡 UI 且无隔离；worker + 5s 超时 + 单条 try/catch 是实验级最低保障。
2. **为什么 setmeta 而不是新 RPC**：`wsh setmeta` 已存在、已触发对象更新事件；新增 RPC 要改 Go 与契约，属于 v2。
3. **为什么 meta 开关而不是 Go 设置项**：实验特性默认关、per-block 粒度、零后端改动；转正式时再上设置页。
4. **解析 lenient**：未知状态行跳过（不整体抛错），比"一条坏毁全表"更符合"实验特性不添乱"。

## 兼容与回滚

- 全部行为受 meta 开关约束；关掉即回到现状（无徽标、无 IO）。
- 回滚 = 删新目录 + 还原两处 diff（`preview-explorer.tsx` / `treeview.tsx`），无数据迁移、无后端状态。
