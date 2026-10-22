# 技术设计：会话详情块单 Header 化

## 1. 现状解剖

详情块当前的垂直结构（自上而下）：

| 层 | 高度 | 来源 | 内容 |
|---|---|---|---|
| ① WaveTerm 块框头 | 30px | `frontend/app/block/blockframe-header.tsx` | 左：`comments` 图标（无文字）。中：空（`viewText` 未提供）。右：刷新（pinned）+ 放大/合并/⋯（hover）+ 关闭（pinned）。`border-bottom` |
| ② 详情面板头 | 46px | `frontend/app/view/aisessions/session-detail.tsx:1163` | 展开列表按钮、会话标题（双击改名）、来源 chip、模型 chip、搜索/星标/会话菜单。`border-b border-border` |
| ③ 消息区 | 剩余 | — | 时间线 + 大纲轨 + 聊天输入框 |

两条横条相邻 + 两条下边框 = 观感上的「两个 Header」。

关键约束（决定了方案可行性）：

- 块框头中区由 `viewModel.viewText`（`HeaderElem[]`）驱动，`frontend/app/block/blockframe-header.tsx:203`。
- 块框头右区由 `viewModel.endIconButtons`（`IconButtonDecl[]`）驱动，`zone: "pinned"` 常显、`zone: "reveal"` 仅 hover。
- `HeaderElem` 支持 `text` / `input` / `iconbutton` / `menubutton` / `div(children)`，见 `frontend/types/custom.d.ts:216-315`。
- **陷阱**：`frontend/app/block/block.scss:479` — `viewText` 里的 `iconbutton` / `menubutton` **默认隐藏，hover 才显示**。所以常显按钮必须走 `endIconButtons` 的 pinned 区，不能塞进 `viewText`。
- `HeaderText` 只有 `onClick`，没有 `onDoubleClick`。双击语义可用 `e.detail >= 2` 模拟。
- `viewModel.noHeader` 可整条关掉块框头（`frontend/app/block/blockframe.tsx:239`）。

## 2. 方案对比

| 方案 | 机制 | Header 数 | 改动面 | 主要代价 |
|---|---|---|---|---|
| A 合并进块框头 | 会话身份走 `viewText` + `endIconButtons`；面板头整行不渲染 | 1 | 中 | 会话菜单要从自定义下拉换成原生 context menu（或另找落位） |
| B 隐藏块框头 | `noHeader` 置真；面板头升级并补块级按钮 | 1 | 中高 | 要在 aisessions 里重做放大/合并/关闭/块右键菜单，并放弃拖拽手柄 |
| C 双层弱化 | 纯 CSS：块框头压到 26px 去下边框，面板头去下边框 | 2 | 小 | 两条横条还在，只是对比度降低 |

**推荐 A**。理由：唯一能同时满足「一条 Header」「保留 WaveTerm 原生块交互」「不新造块级按钮组件」三条约束的方案。B 要复制一份块级按钮逻辑，C 不解决根因。

## 3. 方案 A 详细设计

### 3.1 数据流

```
detailAtom (SessionDetail)
   └─> AiSessionsViewModel.viewText  (jotai.atom, 读 detailAtom)
          └─> HeaderTextElems  -> 块框头中区
                 ├─ text   : 会话标题（双击改名）
                 ├─ input  : 改名输入框（renaming=true 时替换 text）
                 └─ div    : 来源 chip + 模型 chip（children）

detailAtom / summary
   └─> AiSessionsViewModel.endIconButtons (jotai.atom)
          ├─ 搜索（pinned）
          ├─ 星标（pinned）
          ├─ 会话菜单（pinned）
          └─ 刷新（pinned，已有）

sessionListCollapsedAtom
   └─> AiSessionsView 决定是否渲染 ② 面板头
```

### 3.2 状态搬家（必须做，否则 viewText 拿不到）

现在这些状态住在 `SessionDetailPane` / `AiSessionsView` 的 React `useState` 里，合并后要由 view model 的 atom 驱动：

| 状态 | 现在在哪 | 搬到哪 | 原因 |
|---|---|---|---|
| `renaming` / `titleDraft` | `session-detail.tsx` 组件态 | `AiSessionsViewModel` 的 atom | `viewText` 在 view model 里算，改名输入框要由 `HeaderElem` 渲染 |
| `sessionListCollapsed` | `aisessions.tsx` 组件态 | `AiSessionsViewModel` 的 atom | 「展开列表」按钮要进 `endIconButtons` |
| `detailSearchQuery` / `searchExpanded` | `session-detail.tsx` 组件态 | 视情况留在组件内 | 搜索浮层仍由面板渲染，只需把开关按钮交给 view model |

改名提交流程保持原语义：Enter 提交、Esc 取消、失焦提交，提交成功后 `replaceSession` 同步列表。

### 3.3 块框头内容排布

```
[comments 图标] [会话标题 13px/600 · 双击改名] [● pi] [MiniMax-M2.1]  ······  [🔍][★][⋯会话] [⟳][⤢][⋯块][✕]
                ↑ viewText 区（常显）                                        ↑ endIconButtons 区
```

- 标题与 chip 属 `viewText`（`text` / `div`）。
- 搜索、星标、会话菜单属 `endIconButtons` 的 pinned 区（常显）。
- 放大、合并、块右键菜单、关闭继续由 `HeaderEndIcons` 渲染，位置与行为完全不动。

### 3.4 样式

- 新增 `.block-frame-session-title`：13px / 600 / 主文字色，覆盖 `.block-frame-text` 的 `var(--fixed-font)` + `opacity .7`。
- 新增 `.block-frame-session-chip`：22px 高、`rounded-full`、`border`、`11px`、次级文字色，复用现有 chip 观感。
- 高度：推荐保持 `--header-height` 30px（与其他块一致）；若 13px 标题显得挤，局部把该块的 `--header-height` 提到 36px（`.block-frame-default` 下用类名覆写，不用 `:has()`）。
- 分隔线：块框头原有的 `border-bottom` 保留；② 面板头不再渲染，所以只留一条线。

### 3.5 开口点（实现前必须定）

- **D1 会话菜单落位**：当前 `SessionMoreMenu` 是自定义下拉（React 组件）。进块框头有三条路：
  1. 转成 `IconButtonDecl`，`click(e)` 调 `this.env.showContextMenu(items, e)`（`WaveEnv.showContextMenu` 已存在）→ 换成原生右键菜单，样式变但功能齐。**推荐**。
  2. 改造成 `HeaderElem` 的 `menubutton` → 但 `block.scss:479` 让它默认隐藏，只能 hover 才出现，与「常显」目标冲突。
  3. 保留 React 下拉，用事件把触发器搬到块框头 → 需要额外的事件桥和定位逻辑，复杂度最高。
- **D2 列表并排态怎么办**：列表展开时右侧详情面板仍需要自己的头（左侧是搜索/筛选行）。此时块框头显示什么？
  1. 列表展开时块框头不显示会话身份（保持现状的空中区），只有列表收起/详情块时才显示。**推荐**，改动最小。
  2. 列表展开时也显示会话标题 → 块框头语义随布局变化，容易让人困惑。
- **D3 纯列表块**：没有绑定会话时不显示会话身份，块框头维持「图标 + 刷新」。

### 3.6 兼容性与影响面

- 只改 `frontend/app/view/aisessions/`（`aisessions.tsx`、`session-detail.tsx`、可能新增 `session-detail-header.ts`）+ `frontend/app/block/block.scss`（新增样式类）。
- **不改** `blockframe-header.tsx` 的块级交互逻辑，只用已有扩展点。
- `view/aisessions/agent.tsx`（Agent 视图）不共用 `AiSessionsViewModel`，不受影响。
- `session-overview/` 下的会话总览视图是独立组件，不受影响。
- `endIconButtons` 已有自动刷新按钮带 "Auto" 徽标、自适应宽度（`block.scss:632`），新增按钮不能挤掉关闭按钮。

### 3.7 回滚

- 加一个 view model 级开关（如 `aisessions:singleheader` meta 或 `viewModel` 常量），关掉即回到双 Header。
- 开关默认开新方案，回滚不需要 revert 提交。

### 3.8 原型评审发现的两个硬约束（必须先解决）

- **end icons 分组被 CSS 写死**：`frontend/app/block/block.scss:614-621` 给 reveal 区写死 `order: 0`、pinned 区写死 `order: 2`。方案 A 想排成「会话按钮 │ 分隔线 │ 块按钮」，需要新增一个 zone 或 per-button `order` 逃生口，不能只靠 `zone` 字段。
- **`--header-height` 不能全局改**：它被 `.block-frame-default-header` 的 `min-height/max-height` 卡住（`block.scss:194-195`），还被 `block.scss:683`（悬浮卡定位）和 `block.scss:821-823`（高度计算）引用。36px 只能按块局部覆写（类名或 CSS 变量作用域），不能动全局 token。


## 4. 方案 B / C 备选机制（若拍板改选）

- **B**：`viewModel.noHeader = jotai.atom(仅详情块为真)`；面板头补放大/合并/关闭/块右键菜单；块右键菜单用 `this.env.showContextMenu` 复刻 `showBlockContextMenu` 的条目；拖拽手柄放弃（`dragHandleRef` 在块框头上，隐藏后失效）。
- **C**：只在 `block.scss` 改 `.block-frame-default-header`（高度 26px、去 `border-bottom`、图标 opacity .55）+ `session-overview.scss` 改面板头（去 `border-b`、标题改主文字色）。

## 5. 验证策略

- 单测：`viewText` 产出的 `HeaderElem[]` 结构（标题文本、chip 数量、改名态切换 input）；`sessionListCollapsedAtom` 读写；开关开/关时面板头是否渲染。
- 视觉：CDP 截图对比（`node scripts/inspect-electron-ui.mjs screenshot`），明暗主题各一张。
- 回归：`frontend/app/view/aisessions/` 全部 vitest；`tsc` + `eslint` 改动文件。
- 原型对照：`design/prototypes/session-detail-block-header/index.html`。
