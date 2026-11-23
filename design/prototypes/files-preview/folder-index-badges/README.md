# 文件夹索引徽标（folder-index badges）

> 同步状态：▲ 设计活跃（未实现）
> 镜像源：frontend/app/view/preview/preview-explorer.tsx, frontend/app/treeview/treeview.tsx
> 最后同步：2026-11-23

方案说明：`docs/answers/folder-index-icon-badges-20261123.html`（解释页：现状依据 / 目标效果 / 索引约定 / 数据流 / 插件架构 / 隔离设计 / 待拍板决策）

## 三个功能点

1. **索引状态表**（数据源 1）：目录内 `index.md` 写明每个文件状态（会改版 / 冻结 / 只读 / 归档），树图标长徽标，不用打开文档。
2. **用户自定义脚本**（数据源 2）：`.index/badges.js` 导出 `decorate(entry)`，每个文件项调用一次，返回 `{ status }`（用内置状态表）或 `{ emoji, label, color, title }`（完全自定义）。合并策略：**脚本 > 表格 > 无徽标**。
3. **Agent 定向刷新 Block**：Agent 改完索引/脚本后调用 `refreshBlock(tab, block)`，装饰缓存失效并重算，用户立刻看到效果。watch 自动刷新为可选增强。

三个能力共享一套插件扩展点（目录装饰提供者），总开关默认关。

## 原型怎么玩

打开 `index.html`，右侧控制面板（原型专属，不属于真实 UI）：

1. **索引徽标开关**（默认关）—— 打开后树才长徽标；关掉立刻恢复原样，即"零影响"证据。
2. **启用自定义脚本** —— 打开后 `badges.js` 参与计算：`旧版方案/` 两个「草案」文件被脚本补上 🔄（表格里没有）；`实验笔记.md` 被「一年未修改」规则覆盖表格结论，换成自定义 ⏳ 陈旧徽标（tooltip 可见来源与覆盖说明）。
3. **模拟索引缺失** —— index.md 读不出来时表格源静默降级，脚本源不受影响，树照常显示。
4. **绘制方式** —— 前缀 emoji / 角标叠加 / 只改颜色即时对比；「只读」徽标 🔒 vs 📁 对比。
5. **Agent 触发刷新** —— 先点「模拟 Agent 改写 index.md」：文件已写盘，但 Block 缓存不失效，树不变（toast 提示）；再点「Agent 调用 Block 刷新」：rev+1，README.md 的 🗄 归档徽标出现。开着 watch 开关时写盘即自动刷新。左下 toast 显示刷新路由：`refreshBlock(tab-2, files-7)`。
6. **两个编辑器** —— index.md / badges.js 可直接改，300ms 防抖后走刷新链路重算；脚本单条抛错只跳过该条（状态行显示首条错误），完全坏语法则脚本源整体降级。
7. **插件面板** —— FolderIndexBadges / UserScriptBadges 的状态（active / degraded / disabled）与产出条数，GitBadges 为未来同接口占位。

## 已按真实代码对齐的部分

| 原型 | 真实来源 |
|---|---|
| 文件树行结构：chevron → 图标 → 徽标 → 文件名 | `treeview.tsx:1223-1265`（`<i class="fa-sharp fa-solid">` + `label` span） |
| 节点数据结构 `label / isDir / children / readonly` | `preview-explorer.tsx:103` `toTreeNode()`（`TreeNodeData`） |
| 徽标插入位点 | 现有 VCS 状态扩展口 `getLabelClassName` / `getLabelTitle` / `renderRowSuffix`（`preview-explorer.tsx:1229-1231`） |
| 只读文件弱化颜色 | `treeview.tsx` `row.node.isReadonly && "text-muted"` |
| 定向刷新的通道候选 | `pkg/wshrpc/wshrpctypes.go:60-61` `ControllerResyncCommand` / `ControllerRedrawCommand`（已有按 blockId 定向的命令；新增 `refreshBlock` 或复用待拍板） |
| 图标 | 原型用内联 SVG 替身；真实组件用 FontAwesome `fa-sharp fa-solid` |

## 与真实实现的差异（原型故意简化）

- 图标不是 FontAwesome，避免离线打开时缺字体。
- 脚本用 `new Function` 直接执行，**仅作演示**；真实实现必须在 sandbox / worker 中执行：无 IO、无网络、限时。
- 状态表解析为最小实现：只认 `| 文件 | 状态 | 备注 |`，按相对路径或文件名匹配；真实实现要处理表格转义、frontmatter 形态、多级索引继承与大小写。
- `refreshBlock` 原型只重算装饰缓存；真实实现还要重拉 `FileInfo` 子项列表并处理多 Tab 同目录多 Block 的失效路由。
- 无键盘导航、虚拟滚动、右键菜单：既有能力，不在本次新增点里。
- 原型初始加载时即使总开关关闭也会算一次装饰（为了让状态行有内容）；真实实现关闭时必须连读文件的 IO 都不发。

## 待拍板（原型右侧可直接对比）

| 编号 | 决策 | 选项 | 我的推荐 |
|---|---|---|---|
| D1 | 索引物形态 | `index.md` 单文档表格 / `.index/` 文件夹多文件 | `index.md` 表格（一处编辑，人和插件都能读） |
| D2 | 徽标画法 | 前缀 emoji / 角标叠加 / 只改颜色 | 前缀 emoji（实现最轻，和现有行结构兼容） |
| D3 | 「只读」徽标 | 🔒 / 📁 | 🔒（📁 与文件夹图标撞形） |
| D4 | 自定义脚本形态与执行 | `.index/badges.js` + sandbox worker / index.md 内嵌代码块 | 独立脚本文件 + worker（隔离、可单独 watch） |
| D5 | Agent 刷新通道 | 新增 `refreshBlock(tab, block)` RPC / 复用 `ControllerResync/Redraw` | 新增语义化 RPC，内部可委托给既有命令 |

## 落地时的隔离与判据（给夜间开发）

隔离四道：开关（`preview.folderIndexBadges` 默认关，关闭时零 IO）、降级（任一数据源失败返回空 Map，无徽标不报错）、边界（纯前端读文件，不改 `FileInfo` 与后端 RPC）、沙箱（脚本 worker 限时执行，单条失败只跳过该条）。

判据（命令 → 期望输出，均为可机验数字）：

1. 总开关关：Files 树 DOM 与现状 **0 差异**（像素回归基线不变，`data-badge` 节点数 = 0）。
2. 开 + 示例索引 6 条：`data-badge` 节点数 = **6**，tooltip 文案逐条命中状态注册表。
3. 删除 index.md / 写坏表格：报错 = **0**（无弹窗、无 console error），徽标数 = **0**，树照常渲染。
4. 开 + 脚本源（示例脚本）：草案 2 项 🔄、陈旧 3 项 ⏳；脚本单条抛错时其余徽标数**不减**。
5. Agent 改索引后 `refreshBlock`：**2s 内**徽标数与新索引一致（rev+1，toast 一次）。
6. 单元测试：`parseIndexDoc` / `runUserScript` / 合并策略 ≥ **25 断言**全绿（原型 `tmp/proto-test.mjs` 已给出用例蓝本，落地时移入正式测试）。

## 检查清单（新建原型时）

- [x] 镜像源路径真实存在
- [x] DOM 结构、文案对齐真实组件
- [x] 只新增设计点（徽标、刷新面板、插件面板、开关），不重构既有交互
- [x] README 顶部三行状态标记齐全
- [x] `__INDEX__.md` 总表已更新
