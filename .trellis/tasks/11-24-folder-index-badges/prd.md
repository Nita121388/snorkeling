> **Confirmed: 2026-11-24 @nita**

# 文件夹索引徽标（实验插件）：index.md 状态表 + badges.js 脚本源 + Agent 定向刷新 Block

> 来源：nita 2026-11-23 布置（HANDOFF「文件夹索引徽标」条目）+ 2026-11-24 会话拍板 D1-D5 采纳推荐。
> 原型：`design/prototypes/files-preview/folder-index-badges/`（玩法/差异/判据蓝本，25 断言已过）。
> 解释页：`docs/answers/folder-index-icon-badges-20261123.html`。

## Goal

Files 树的文件按目录内 `index.md` 状态表与 `.index/badges.js` 用户脚本显示状态徽标（🔄 会改版 / 🧊 冻结 / 🔒 只读 / 🗄 归档），
不用打开索引文档即可分辨类型；block meta 开关缺省关闭（关 = 树零变化零额外 IO）；agent 通过 `wsh setmeta` 触发该 block 的定向刷新。
实验特性按插件式落位：**纯前端实现，零 Go 改动**。

## Requirements

### 做什么

1. **数据源 1（index.md 状态表）**：block meta `preview:idxbadges` 启用时，插件读根目录 `index.md`，
   解析 `| 文件 | 状态 | 备注 |` 表格（相对路径或文件名匹配，未知状态行跳过不抛错），产出 per-path 徽标。
2. **数据源 2（用户脚本）**：读 `.index/badges.js`，在 Web Worker 中执行导出的 `decorate(entry)`；
   `entry = { name, path, relPath, isDir, modtime }`；返回 `{ status }` 用内置注册表，返回 `{ emoji, label, color, title, note }` 完全自定义。
   合并策略：**脚本 > 表格 > 无徽标**。
3. **状态注册表**：会改版 🔄 `#e0a83a` / 冻结 🧊 `#5cb8d6` / 只读 🔒（行文本弱化）/ 归档 🗄 `#a78bfa`。
4. **树渲染**：`TreeNodeData` 加可选 `badge` 字段；`treeview.tsx` 行内图标后渲染 `<span class="st-badge">`（导出 `TreeNodeBadge` 组件）。
5. **Agent 定向刷新**：agent 执行 `wsh setmeta -b <blockid> preview:idxrefresh=<ms>`；block 监听自身 meta 变化 → 装饰缓存失效并重算，只影响该 block。
6. **开关与降级**：`preview:idxbadges` 缺省 = 关（不读 index.md、不起 worker、树 DOM 零徽标）；Files block 菜单提供开关项；
   索引缺失 / 表格非法 / 脚本坏语法 / 单条抛错一律静默降级（空 Map / 跳过该条），不弹错不阻塞树渲染。
7. **单测**：解析 / 归一化 / 合并 / meta 开关 / 刷新 revision / 树行渲染（红证三文件转绿）。

### 不做什么

- 不改 `FileInfo` 字段与后端 listdirectory RPC 语义（徽标是纯前端渲染层概念）。
- 不写 Go：不加新 wsh 命令、不加新事件类型、不动 `pkg/**`（刷新复用 setmeta 既有事件链）。
- 不动树既有交互（搜索 / 右键 / 重命名 / 拖拽 / 展开持久化原样）。
- 不做文件 watch 自动刷新、多级索引继承、frontmatter 形态、`.index/` 多文件目录（后续版本）。

## 验收判据

loop 工作项 `N-1124-folder-index-badges-2` 的 4 条机器判据（单测×3 转绿 + 新文件 tsc 0 错）+ G7 真机验收
（示例目录徽标可见 / 开关关 = 零徽标 / `setmeta` 刷新 2s 内生效）。

红证：`loop/red/N-1124-folder-index-badges-2.txt`（特性未实现时三测试文件全红）。

## G1 签字

2026-11-24 @nita：确认（会话「ok go」）。D1 index.md 表格 / D2 前缀 emoji / D3 只读用 🔒 / D4 独立 badges.js + worker / D5 复用 setmeta 事件链（v1 不加新 RPC）。
