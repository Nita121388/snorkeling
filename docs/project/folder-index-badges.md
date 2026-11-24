# 文件夹索引徽标（实验插件）

> 状态：已实现（2026-11-24，包 `N-1124-folder-index-badges-3`），实验特性 + 默认关闭。
> 方案/原型：`design/prototypes/files-preview/folder-index-badges/`（▲→可更新为 ●）、`docs/answers/folder-index-icon-badges-20261123.html`。

## 它做什么

Files 树里每个文件可以按目录内的索引文档显示**状态徽标**，不用打开文档就能区分：

| 状态 | 徽标 | 含义 |
|---|---|---|
| 会改版 | 🔄 | 还会改动，别当定稿引用 |
| 冻结 | 🧊 | 已定稿，改动需走流程 |
| 只读 | 🔒 | 不允许修改（行文本同时弱化） |
| 归档 | 🗄 | 历史资料，仅查阅 |

两个数据源，脚本优先：

1. **数据源 1：`index.md` 状态表**——目录内放 `index.md`，写表格：

   ```markdown
   | 文件 | 状态 | 备注 |
   |---|---|---|
   | 需求规格 v3.md | 会改版 | Q4 还要改三处 |
   | 评审记录/2024-年报.md | 归档 | 历史资料 |
   ```

   key 可写相对路径或文件名；未知状态的行跳过，不报错。

2. **数据源 2：`.index/badges.js` 用户脚本**——导出 `decorate(entry)`，每个文件调用一次：

   ```js
   function decorate(entry) {
       // entry: { name, path, relPath, isDir, modtime }
       if (entry.name.includes("草案")) return { status: "会改版", note: "文件名含「草案」" };
       if (entry.modtime < Date.now() - 365 * 86400e3) {
           return { emoji: "⏳", label: "陈旧", color: "#e0a83a", title: "超过一年未修改" };
       }
       return null; // 不加徽标
   }
   ```

   返回 `{ status }` 用内置四态；返回 `{ emoji, label, color, title }` 完全自定义。
   脚本在 Web Worker 里执行（5s 超时、单条 try/catch）；worker 起不来时降级主线程执行。
   合并策略：**脚本 > 表格 > 无徽标**。

## 怎么开

- **界面**：Files block 树空白处右键 → 「开启索引徽标（实验）」。
- **命令行**：`wsh setmeta -b <blockid> preview:idxbadges=on`。
- 默认关闭（meta 缺省即关）。关闭时不读索引、不起 worker、树 DOM 零徽标。

## Agent 定向刷新

Agent 改完索引/脚本后，让用户的树立刻生效：

```bash
wsh setmeta -b <blockid> preview:idxrefresh=$(date +%s%3N)
```

block meta 变化 → 装饰缓存失效 → 重新读两个源 → 树重取（仅该 block；展开状态保留）。

## 实现锚点（改这块先读）

| 文件 | 作用 |
|---|---|
| `frontend/app/view/preview/folder-index/folder-index-model.ts` | 纯逻辑：`STATUS_DEF` / `parseIndexDoc` / `normalizeDeco` / `mergeDecorations` / `toRelPath` / `lookupDecoration` |
| `frontend/app/view/preview/folder-index/folder-index-meta.ts` | meta 契约：`preview:idxbadges` / `preview:idxrefresh` |
| `frontend/app/view/preview/folder-index/folder-index-worker.ts` | 脚本沙箱：`executeDecorate` / `normalizeScriptRun` / worker 桥（5s 超时） |
| `frontend/app/view/preview/folder-index/folder-index-hook.ts` | 目录级 hook：读两源 + 缓存 + revision（对齐 `vcs-tree-status-hook.ts`） |
| `frontend/app/view/preview/preview-explorer.tsx` | 接线：meta 开关、徽标注入 `TreeNodeData.badge`、右键菜单开关、`treeRefreshKey` 带 revision |
| `frontend/app/treeview/treeview.tsx` | `TreeNodeBadge` 组件 + `TreeNodeData.badge` 字段（行内图标后） |

## 降级语义（不要"改进"成报错）

| 情况 | 行为 |
|---|---|
| 没有 `index.md` | 表格源空 map，树照常 |
| 表格里有未知状态 | 跳过该行 |
| 没有 `badges.js` / 坏语法 / 未定义 `decorate` | 脚本源空 map，表格源不受影响 |
| 脚本某条抛错 | 只跳过该条，其余照常出徽标 |
| 脚本超时（>5s） | 整段脚本源降级为空 |
| 开关关闭 | 不发任何读取 RPC |

## 已知边界（v1 不做）

- 文件 watch 自动刷新（目前只有 meta 触发 / 手点开关 / 树刷新）。
- 多级索引继承、frontmatter 形态、`.index/` 多文件目录。
- 脚本只能看到**根目录一层**的 entry 列表（索引表可写嵌套相对路径）。

## 验收

- 判据（`queue prove --id N-1124-folder-index-badges-3`）：4/4 绿
  （`folder-index.test.ts` 15 断言 / `refresh.test.ts` 6 断言 / `treeview-badge.test.tsx` 3 断言 / eslint 0 error）。
- 红证：`loop/red/N-1124-folder-index-badges-2.txt`（实现前三个测试文件全红）。
- tsc：全局 58 错误 = 基线不变，新增文件 0 错误。
- G7 真机验收步骤见 HANDOFF「文件夹索引徽标」条目。
