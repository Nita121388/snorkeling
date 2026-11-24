> **Confirmed: 2026-11-24 @nita**

# 目录装饰协议 v2：词表泛化 + 自定义状态 + 脚本全树上下文

## Goal

把「文件夹索引徽标」从「只能打四态徽标」升级为**目录装饰协议**：agent 按用户需求写 `index.md` / `.index/badges.js`
（改数据不改代码）即可定制 folder 展示——徽标、图标、文件名颜色、隐藏、排序，并支持**自定义状态**（不锁死四态）。
渲染位点只挂既有扩展口（`TreeNodeData.icon/iconColor/badge` + label 颜色），不新增交互面。

## Requirements

### 做什么

1. **装饰词表泛化**：`BadgeDeco` 增加可选 `icon`（fa 图标名）、`iconColor`、`labelColor`（文件名颜色）、`hidden`（不显示）、`order`（排序权重）。
   新纯函数 `applyDecorationToNode(node, deco)`：落 `badge{emoji,title,color}` + `icon` + `iconColor` + `labelColor`；
   `hidden` / `order` 由 explorer 的 `fetchDir` 消费（过滤 + 稳定排序）。
2. **自定义状态注册表**：`index.md` 支持第二个表 `| 状态 | 徽标 | 颜色 | 说明 |` 声明自定义状态；
   解析时与内置四态合成注册表（同名覆盖需显式）；`parseIndexDoc(text, registry)` / `normalizeDeco(raw, registry, source)` 增加可选 registry 参数，
   缺省 = 内置四态（向后兼容，v1 表格与脚本零改动照常工作）。
3. **脚本上下文加厚**：hook 的 `listEntries` 改 BFS 全树（深度 ≤3 层、目录 ≤50 个、总项 ≤1500，超限静默截断），`entry` 增加 `size`。
4. **treeview 渲染**：`TreeNodeData.labelColor?: string`，label span 内联 color（不传 = 零变化）。
5. **单测**：自定义状态表解析 / `applyDecorationToNode` 逐字段 / 合并策略保持（脚本>表格）/ registry 参数缺省兼容。

### 不做什么

- 不做分组（group）、不改树交互、不加 MCP 工具（后续）。
- 不做内容级 entry（读文件内容给脚本）——上下文止于 `name/path/relPath/isDir/modtime/size`。
- 不改 `wsh block refresh` / agent guide（B 包已交付）。
- `hidden` 只作用于文件行；目录行不隐藏（避免树结构歧义）。

## 验收判据

1. `npx vitest run frontend/app/view/preview/folder-index/folder-index.test.ts && echo IDX_UNIT_OK` → `IDX_UNIT_OK`
2. `npx vitest run frontend/app/view/preview/folder-index/refresh.test.ts && echo REFRESH_OK` → `REFRESH_OK`
3. `npx vitest run frontend/app/treeview/treeview-badge.test.tsx && echo BADGE_RENDER_OK` → `BADGE_RENDER_OK`
4. `npx eslint frontend/app/view/preview/folder-index/ frontend/app/view/preview/preview-explorer.tsx frontend/app/treeview/treeview.tsx && echo LINT_OK` → `LINT_OK`

红证：`loop/red/N-1124-idxbadges-decoration-protocol.txt`（新契约未实现时新测试全红）。

## G1 签字

2026-11-24 @nita：确认（会话「ok go on」，含 B 后 A 的顺序）。
