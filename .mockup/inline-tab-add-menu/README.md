# Inline Tab Add Menu — Blocks 组右上角「＋」新建菜单原型

> 同步状态：◉ 真实代码已落地（与本文原型存在两处行为差异，见末尾「与原型差异」）
> 镜像源：frontend/app/block/block.tsx, frontend/app/block/block.scss, frontend/app/block/inlinetab-addmenu.tsx, frontend/app/workspace/widgets.tsx, frontend/app/workspace/launch-popup-bus.ts, pkg/wconfig/defaultconfig/widgets.json, frontend/app/theme.scss
> 最后同步：2026-08-26（行为二次迭代：点击而非悬浮；右栏不再被带出）
> 对应方案：暂无 Obsidian 方案笔记，设计决策记录于本 README

## 一句话

Blocks 组（Inline Tab 化 Block，`blockIds.length > 1` 的节点）tab 行右上角新增固定区「＋」按钮；点击弹出 **widget 注册表驱动** 的新建菜单 —— Terminal / Agent / Files 继承激活 tab 的 `connection`/`cmd:cwd`，其余 widget 用自身 `blockdef` 直通创建，全部「创建即加入本组并激活」。

## 设计决策（已与用户对齐）

| 决策点 | 结论 |
|---|---|
| 按钮位置 | **方案 A**：tab 行拆为 `[tabs 滚动区 flex:1][固定区 flex:none]`，「＋」物理钉死在组右上角。tabs 横向溢出滚动时「＋」不动、永远不挨着最后一个 tab（用户明确否掉「跟在 tabs 后面」的浏览器式排布） |
| 显示条件 | 仅真正的组（`blockIds.length > 1`）；preview / ephemeral 不显示。单 block 节点本期不做（留 ponytail 注释说明扩展点） |
| 菜单数据源 | 复用 `fullConfig.widgets`（与右侧 WidgetsBar 同一份注册表）：workspace 过滤 + `display:order` 排序 → 用户自定义 widget 自动出现 |
| 特判范围 | 仅 Terminal / Agent / Files 三项做上下文继承（复用 `extractTerminalContextMeta` 读激活 tab）；其余直通 `widget.blockdef` |
| action 型 widget | commontext 等无 blockdef 的 action 型本期跳过（不产 block，塞进"加 tab"语义不符） |
| magnified 时 | 「＋」照常可用（往组里加 tab 无害） |
| 创建落点 | `ObjectService.CreateBlock(blockDef)` → 现成 `layoutModel.addBlockToInlineTab(nodeId, blockId)`（追加组尾+激活聚焦），零新布局代码 |
| Files 语义 | "..." = 就地打开该目录文件树（`view:"preview"` + `"preview:pathisdir":true`），无路径输入弹窗 |
| Agent 启动 | v1 用默认 profile 直启（`settings["agent:defaultprofile"] ?? codex`）；不开完整 launcher 浮窗 |

## 原型怎么打开

浏览器直接开 `index.html`（无构建、无依赖，仅 Font Awesome CDN）：

```
file:///E:/code/snorkeling/.mockup/inline-tab-add-menu/index.html
```

## 可交互验证的点

1. **场景 1（3 tabs）**：点右上角「＋」→ 菜单弹出在按钮下方右对齐 → 选 Terminal/Agent/Files/… → 新 tab 追加到组尾并激活，日志面板打印对应真实调用链。
2. **场景 2（9 tabs 溢出）**：横向拖动 tabs 滚动，「＋」钉死右上角不动（固定 cell 实现，非 sticky hack）。
3. 菜单项右侧灰色 hint 显示继承目标（`local · ~/code/snorkeling`）—— 即新 Terminal/Agent 将落的位置。
4. commontext（Text）为禁用态 + 「action 型 · 本期跳过」badge —— 展示该决策。
5. tab 点击切换 / hover 出 × 关闭 / 同名 tab 自动编号（镜像真实 `getDuplicateIndexes`）/ agent working 蓝点呼吸 —— 全部为既有行为，验证菜单加入的新 tab 与它们兼容。
6. 关到最后一个 tab 会拦截（真实实现走 `uxCloseBlock` 关整个 Block，单 block 无 tab 条、「＋」随之消失——本期范围外）。

## 结构镜像对照（原型 ↔ 真实代码）

| 原型元素 | 真实类名/位置 | 说明 |
|---|---|---|
| `.inline-tab-block-tabsrow` | **新增**（block.tsx InlineTabBlock 内包一层） | 接管原 `.inline-tab-block-tabs` 的 border-bottom + 背景 |
| `.inline-tab-block-tabs` | block.scss `.inline-tab-block-tabs` | 原 flex-start/gap2/overflow-x:auto 不变，改挂 flex:1 + min-width:0 |
| `.inline-tab-block-addzone` / `.inline-tab-block-addbtn` | **新增** | 18×20 按钮，hover accent；固定区带 inset 分隔线 |
| `.inline-tab-block-group-handle` / `-tab` / `-tab-main-*` / `-close` / statusdot | block.scss 直译 | 视觉逐字段对齐（26px 行高、22px tab、radius 6px 6px 0 0 等） |
| `.block-frame-default-header`（激活块自带 header） | blockframe-header.tsx BlockFrame_Header | 组内激活 block 本就渲染自己的 header，原型保留以证明两行结构并存 |
| 菜单数据 `WIDGETS[]` | widgets.json（8 个 defwidget@*） | id/order/icon/label/actionOnly 逐字段对应 |
| `.ctxmenu` | modal 视觉语言（modal-bg/border/radius/shadow token） | waveEnv.showContextMenu 渲染风格示意 |

## 落地实现参考点（评审通过后）

| 文件 | 改动 |
|---|---|
| `frontend/app/block/inlinetab-addmenu.ts`（新，~60 行） | 纯函数 `pickBlockDefForGroupAdd(widget, activeBlock, settings)`：terminal/agent/files 特判 + 其他直通；配 assert 自检测试（terminal 继承 cwd / agent 默认 profile / files 目录 meta 三条断言） |
| `frontend/app/block/block.tsx` | InlineTabBlock tab 行加 wrapper + addzone/addbtn + `waveEnv.showContextMenu` 菜单渲染（读 `fullConfig.widgets`） |
| `frontend/app/block/block.scss` | `.inline-tab-block-tabsrow/-addzone/-addbtn` 样式；`.inline-tab-block-tabs` 改 flex:1 并把 border-bottom 上移到 wrapper |
| `frontend/app/workspace/widgets.tsx` | 导出 `sortByDisplayOrder` 供复用（或移到共享模块） |

复用清单（零新造轮子）：`extractTerminalContextMeta` / `createTerminalBlockDef` / `createDefaultAgentBlockDef`（agent-launch.ts）、`addBlockToInlineTab`（layoutModel.ts）、`shouldIncludeWidgetForWorkspace`（widgetfilter.ts）、`sortByDisplayOrder`（widgets.tsx）、`waveEnv.showContextMenu`。

## 边界情况

- 激活块拿不到 cwd/connection（preview/note 等）→ Terminal/Agent 落本地 home（与 Workspace Home 目标一致）；Files 用 `~`
- 新 tab 一律追加组尾并激活（`addBlockToInlineTab` 自带）
- tabs 溢出滚动时「＋」因在滚动区外，天然不动（无需 sticky）

## 本期不做

- ❌ New Agent 打开完整 launcher 浮窗选 profile/env/vendor
- ❌ 单 block 节点显示「＋」
- ❌ Files 路径选择弹窗
- ❌ action 型 widget 进菜单

## 与原型差异（真实代码已二次迭代）

1. **菜单条目交互：点击而非悬浮。** 原型 `script.js` 里 Terminal/Agent 条目用 500ms 悬浮计时器自动弹出目标选择浮窗；真实代码改为 **仅点击** 打开（`onClick` 调 `requestLaunchPopup`），悬浮只做 CSS 高亮。原因：下拉菜单里悬浮自动触发会误关菜单、且鼠标划过其它条目时易误触。右栏 WidgetsBar 自己的 hover 行为不变。
2. **右栏不再被连带带出。** 真实代码复用了 WidgetsBar 同一个 `TerminalTargetFloatingWindow`/`AgentTargetFloatingWindow`；原来一打开浮窗 `anyFloatingOpen` 为真会让右栏 `expanded` 滑出，造成“右侧 widget 也展示”的连锁。已在 `widgets.tsx` 让 `anyFloatingOpen` 排除 group-sink 浮窗（`groupSinkNodeId != null` 时不计入），从「＋」菜单打开时右栏保持收起。

> 注： prototype `index.html` / `script.js` 仍保留 500ms hover 演示，仅作交互参考；与真实代码以本段为准。
