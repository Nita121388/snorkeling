---
description: 前端质量硬约束——可机器判定的验证判据、跨面一致性、重构收口的契约钩子、常见踩坑
paths:
  - frontend/**
  - scripts/verify/**
  - docs/project/**
---

# Quality Guidelines

> Code quality standards for frontend development.

---

## Overview

<!--
Document your project's quality standards here.

Questions to answer:
- What patterns are forbidden?
- What linting rules do you enforce?
- What are your testing requirements?
- What code review standards apply?
-->

(To be filled by the team)

---

## 单轴滚动容器必须显式声明另一轴 (2026-11-10, task 11-10-agent-rail-sessions-realtime)

- CSS 规则：一旦一个轴不是 `visible`，另一个轴会被从 `visible` 强制计算成 `auto`。所以「只要纵向滚动」的容器必须写全两个轴：Tailwind `overflow-y-auto` ⇒ 同时 `overflow-x-hidden`，并把固定宽度的子项收敛到内容盒（`w-full` + `maxWidth`）。
- 否则一旦竖滚动条出现（全局滚动条 4px），内容区宽度减小，固定宽度子项横向溢出 → 底部长出水平滚动轴（agent TUI 右侧会话轨实例：36px 刻度在 32px 内容区）。
- 注意：`overflow-x: hidden` 只是不显示水平轴，`scrollWidth` 仍可能 > `clientWidth`（内容照常溢出只是被裁掉）；断言「无水平轴」看 computed `overflowX === "hidden"`，断言「无溢出」看 `scrollWidth <= clientWidth`。两者都要过。
- 验证台样板：`scripts/verify/agent-session-rail/`（用 >37 条用户消息的真实会话播种 TUI 轨，逼出竖滚动条状态）。

---

## Terminal Block 轻量操作约定 (2026-10-15, task 10-15)

- Header 右上角默认按钮应承载**轻量、高频、无害**操作（如 `Redraw TUI`），不要直接暴露会中断进程的重操作。
- 会中断进程/会话的操作（如 `Restart Shell/Agent`）移入“⋯”菜单，并先经确认弹窗（`RestartConfirmModal`）。
- 新增后端 RPC 时需要同步三处：`pkg/wshrpc/wshrpctypes.go`（接口方法，反射自动注册）、`pkg/wshrpc/wshclient/wshclient.go`（Go client）、`frontend/app/store/wshclientapi.ts`（前端 RpcApi，含 mock 分支）。
- 终端重绘不动进程：前端 `terminal.refresh(0, rows-1)` + 后端对进程组发 SIGWINCH（`unixutil.SignalGroupByName`）；绝不调用 `ControllerDestroyCommand`/`ControllerResyncCommand(forcerestart)`。
- 信号工具优先放 `pkg/util/unixutil`（unix/windows 双实现），不要在业务层直接 `syscall.Kill`。

---

## Overview 看板卡片：钩子与结构约束 (2026-11-05, task 11-05-overview-board-v2)

- **容器不能是 `<button>`**：卡片里嵌状态 chip（内部也是 button），嵌套按钮是非法 HTML 且点击会串。
  卡片用 `div role="button" tabIndex={0}` + `Enter`/`Space` 处理键盘。
- **身份解析只走 `getAgentIcon(provider, { meta, sessionId, personas, sessionEmojis })`**（会话 → provider → logo），
  状态词/颜色/读未读只走 `AgentStatusChip` + `useAgentReadContext`。看板不得新增第三份映射。
- **标题不得回退成视图名**：agent 卡片走 `resolveBoardCardTitle`（sessionTitle → note → 项目名 → `Provider · tab`），
  `blockTitle()` 末尾用 `basename(meta["cmd:cwd"])` 兜底，禁止让卡片显示裸 `Terminal`。
- **看板永远单行多列**：`grid-auto-flow: column` + `minmax(220px,1fr)` + `scroll-snap-type: x`，
  空列 `includeEmpty: true` 常显。按面板宽度退回纵向堆叠 = 又变回列表（用户已经提过一次）。

### 卡片点击 = 热区白名单，不是 `target === currentTarget`

卡片根用 `div role="button"` 时，**不要**写 `if (event.target !== event.currentTarget) return`
来挡内部控件：卡片内容全是子 span（标题/预览/Note/tags/属性/度量），这条卫语句会把
**整张卡片**变成死区，只剩裸内边距能点（11-20 jsdom 复现：点标题 `onOpenCard` 0 次）。

正确形态（`overview-board.tsx` 的 `isCardHotzone` + `handleCardClick`）：

- 卡片根**唯一**一个 click handler；从 `event.target` 向上 `closest()` 找白名单
  `button / a[href] / input / textarea / select / [contenteditable="true"] / [data-card-interactive]`，
  命中且在卡片内 → return（交给热区自己的 handler），否则 `stopPropagation()` + 开卡。
- 卡片内要“自己点开”的东西必须显式声明热区：原生控件自然命中；非控件容器（如 emoji 头像做成
  `<button>`）要同时挂 `data-card-interactive="true"`，方便未来把 chip 升级成可点而不改判定。
- 根 `onKeyDown` 同样要 `event.target !== event.currentTarget` 守卫，否则在热区按钮上按 Enter
  会冒泡到根**同时**开卡（键盘双触发）。
- 拖选文本后松手那一下不算点击：`window.getSelection()?.isCollapsed === false` 直接 return。
- 热区升级（展示 span → `<button>`）**必须保留探针契约**：`.session-overview-board-card-avatar` 与
  `data-avatar-kind` 是 verify 台 `agent-card-emoji-avatar` 的锚点，新按钮要把它们一起挂上；
  不能用 `aria-hidden` + disabled 的“死按钮”代替展示态，不满足条件时仍渲染纯 span（点它走整卡）。

---

## 列表/看板型渲染：卡片必须 memo + 回调必须稳定引用 (2026-11-10, task 11-10-overview-board-click-perf)

- **每张卡片 = 一个 `React.memo` 组件**（`BoardCard` 内部名 `BoardCardImpl` + `export const BoardCard = memo(...)`）。
  不 memo 的卡片墙在面板任何一次重渲（状态 atom tick、`markBlockViewed` 换 map 引用、选中态）都会全量重跑，
  上百张卡就是几十 ms 级 long task。
- **父级传给卡片的每个回调必须 `React.useCallback`**。内联箭头函数（`onOpenCard={(card) => ...}`）
  每次渲染换引用，memo 全部失效——这是「加了 memo 还是卡」的常见原因。
- **重文件里的大组件回调定义提到组件顶部集中**（本仓 `SessionOverviewPanel`），JSX 只写 `onOpenCard={handleOpenBoardCard}`。
- **点击开浮层的路径要 `event.stopPropagation()`**：卡片 click 会冒泡到 block frame 的 `setBlockClickedTrue`，
  后者跑 `setFocusTarget()` + `focusNode()`（layout model 持久化 IPC）——这一轮会叠加进弹窗入场动画的首帧里。
  拦截只挡 bubble 阶段；capture 阶段的 document 监听（hover 卡消失 / composer 退出）不受影响。
- 判别方法：新增单测锁结构（`(BoardCard).$$typeof === Symbol.for("react.memo")`）+ 点击语义
  （开弹窗时 wrapper 不收到 click；点子元素不开）。

---

## SCSS / 断言两条硬约束 (2026-11-05, 夜间自主开发)

- **改 SCSS 前先确认锚点唯一**：`@container` 里的选择器列表（`.a,\n.b,\n.c {`）和独立规则长得很像，
  `oldText` 命中列表会把整段声明块插进选择器位置，静默破坏后面的 `min-width` / `overflow`。
  实测代价：时间线在 221px 面板里轨道仍 540px 宽（溢出）。改完必须跑对应真机 area。
- **几何类断言要带数字**：`trackVisible` 这种布尔断言失败时看不出原因。统一输出
  `{panelW, trackW, dl, dr}` 这类矩形差，下一次不用重新加打印。

---

## 列表型下拉菜单：删除不得顺手关菜单（2026-11-09, task 11-09-inlinetab-dropdown-keep-open）

- 下拉/浮层里如果每行都有「删除 / 关闭」动作，**默认删除后菜单保持打开**：用户清理多个条目时
  不该被迫「打开 → 删一条 → 再打开」。实测修复点：`block/inlinetab-dropdown.tsx` 的 × 与
  Delete/Backspace 曾显式 `onOpenChange(false)`，导致无法连续删除。
- 允许自动关闭的只有两种：锚点（触发按钮/药丸）本身被隐藏，或列表被上层整体卸载。
  其他「删完就关」要靠注释写清理由，否则下一个人会当成 bug 或当成规范。
- 键盘删除必须**恢复焦点**：被删行从 DOM 移除后焦点会掉到 body，Delete 连发直接失效。
  做法：先记录 `{被删行索引, blockId}`，等 `tabs` 实际收缩后按索引聚焦（越界取最后一条），
  行删空则聚焦菜单容器（容器需 `tabIndex={-1}`）；若行还在（脏数据确认被取消）只清引用不动焦点。
- 单测要覆盖三件事：删除后 `onOpenChange` 未被调用、删除落地后焦点索引、取消删除时焦点不动。

---

## Forbidden Patterns

<!-- Patterns that should never be used and why -->

(To be filled by the team)

---

## Agent 块拆分 = 新会话（2026-10-22, task 10-22-agent-split-new-session）

- 拆分（水平/垂直）一个 Agent 块时，新块起**全新会话**，不 resume 源块会话。改写落点唯一：
  `frontend/app/store/global.ts` 的 `createBlockSplitHorizontally` / `createBlockSplitVertically`
  套 `buildSplitBlockDef`（`frontend/app/workspace/agent-split.ts`）。
- 任何"拿已有 block meta 去开新块"的路径都要先问一句：**这份 meta 是不是带 agent 身份**
  （`agent:autoresume` / `agent:provider` / `agent:sessionid`）。带 → 剥会话身份再开新块。
  整份复制 meta 会把 `agent:sessionid` 一起带走，后端据此给新块拼 resume → 两个块共用一个会话。
- 剥会话身份 = 删 `agent:sessionid` + 剥 `cmd:args` 里的 resume 参数；**其余 meta 全留**
  （provider / 模型 / vendor / cwd / connection / `agent:autoresume`），新块才是"同配置的新会话"。
- **不要动** `createBlock` / `replaceBlock`：`restoreMetaForSession` 等「用户主动打开某个会话」的
  路径走 `createBlock`，必须保留 resume 语义。
- 完整跨层契约见 [Agent 会话 resume 契约](../backend/agent-session-resume-contract.md)。

---

## 设置面板：unset ≠ false，默认值在 TS 层 (2026-10-22, task 10-22-agent-os-notify-denoise)

- Go `SettingsType` 的开关字段是 `*bool` / `*int64`，**“未设置”与“false/0”是两个意思**：
  未设置 → 用默认值；显式存了 `false`/`0` → 必须用 `false`/`0`。
  读设置一律用 `??` 回落默认值，**禁止用 `||`**（`||` 会把显式 `false` 覆盖成默认 `true`）。
- 默认值集中在 `frontend/util/sharedconst.ts`，主进程（`emain/` 通过 `@/util/...` 引用）与
  设置面板同源。**Go 侧不要给这些字段填默认值**——那会把 `false` 和“未设置”合并成一个意思。
- 写 `settings.json` 走 `RpcApi.SetConfigCommand`：Go 侧 `SetBaseConfigValue` 是**合并**写入，
  只替换传入的键，其余键原样保留；未知键会被 `getConfigKeyType` 拒绝并报错。
  因此新增设置键时，键名必须与 Go 的 json tag 完全一致（见 backend 契约文档的必测项）。
- 完整契约见 [Agent OS 通知抑制契约](../backend/agent-os-notify-contract.md)。

---

## 设置面板排版：组卡 + 行不留发丝线 (2026-11-12, task 11-12-settings-density-sync)

`waveconfig` 的设置面板原来用 `divide-y` 发丝线把行连成一列，读起来像表格。排版原语的唯一真身是
`frontend/app/element/setting-card.tsx`：
`SettingGroup` / `SettingCard` / `SettingRow` / `RadioCard(Group)` / `RadioRow(Group)` /
`AdvancedSection` / `SaveBar` / `SignalBars` / `SettingInput` / `SettingValue` / `SettingButton` /
`SettingSegmented`。新面板**不要**自己写 `divide-y` 行容器或裸 `<input type="radio">`。

- 组 = 标题在组卡**外**上方（12px/500 secondary）+ 组卡（`bg-surface` + 1px `border-border` + radius 10）；
  行 `min-h-[58px]`，**组内不用发丝线**，靠行高与 32px 组间距分隔；标题 14/500，描述 12.5/1.5、距标题 3px。
- **草稿型面板只有一个保存位置**（`SaveBar`，底部）。不要同时留 header Save + 面板内 Save。
- 二选一/多选一用 `SettingSegmented` 或 `RadioCard`，不要再用裸文本输入框表达枚举
  （`commontext:sync:server:pushmode` 曾是需要记字符串的坑）。
- 「前置未配置」不能写成不可点的 radio：那等于让用户永远看不到该后端的字段（死锁）。
  用 `RadioCard` 的 `warn` 行说明原因，卡保持可点；能不能真正生效由字段是否填全决定。
- 验证台依赖的 `data-*` 必须透传到宿主 DOM —— 原语用 `attrs` 参数（行级 `data-sync-row`、卡级
  `data-sync-transport`）。改结构前后各跑一次 `grep -o 'data-sync-[a-z-]*' | sort -u` 做差集，
  丢属性就是丢断言。
- 颜色只用主题 token（`surface` / `border` / `actionsoft*` / `accent` / `success|warning|error`）。
  **`--border-soft-color` 不存在**，引用它等于静默失效。

---

## Required Patterns

<!-- Patterns that must always be used -->

(To be filled by the team)

---

## Testing Requirements

<!-- What level of testing is expected -->

(To be filled by the team)

---

## 终端链接与浮层提示（2026-10-22, task 10-22-terminal-file-url-ctrl-click）

- 终端里的链接识别由 `WebLinksAddon` 的 `urlRegex` 决定，默认正则只认 `https?://`。
  新增协议（如 `file://`）时改 `frontend/app/view/term/term-file-url.ts` 的 `TerminalLinkRegex`，
  **不要在该正则上带 `g` flag**——addon 内部会拼成 `new RegExp(source, flags + "g")`，成了 `gg` 会直接抛 `SyntaxError`。
- `file://` → 原生路径只保留一份实现（`fileUrlToNativePath` / `filePathFromFileUrl`），
  终端链接打开与 OSC 7 的 cwd 上报共用；Windows 盘符、百分号编码、UNC 的规则只在这里改。
- OSC 7 语义下 host 是本机名，解析时忽略；只有用户主动点击的 `file://` 链接才把 host 当 UNC 共享
  （走 `terminalFilePath`，内部按 `isWindows()` 决策）。
- 用默认程序打开走既有 `getApi().openNativePath(path)` → `open-native-path` → `electron.shell.openPath`；
  **不要**用 `openExternal("file://…")` 代替，它在 Windows 上不能保证交给默认程序。
- 终端悬浮提示（`term-tooltip.tsx`）的皮肤必须用主题变量，禁止写死 `bg-zinc-800/*` 这类深色类：
  浅色主题下 `text-secondary` 是深棕（`#675033`），写死深底就是深底深字。
  用 `bg-[var(--overlay-bg-color)]` / `text-[var(--main-text-color)]` /
  `border-[var(--border-color)]` / `shadow-[0_8px_24px_var(--modal-shadow-color)]`，
  这四个变量在 dark / light / monochrome 三套主题都有定义。
- 右键菜单按协议分流：`file:` 给「Open File in Default App」+「Show in Folder」，
  其它协议保持原有「Open URL / Open URL in External Browser」，不要把 `file://` 塞进 web block。

---

## 旁支视图入口的放置策略：默认入 Tab，Ctrl 才单开（2026-10-24, task 10-24-files-vcs-icon-tab-open）

- Block 头部图标打开"旁支视图"（VCS / History / Diff / Commits 这类看完就回的视图）时，
  默认放置是**并入当前 Block 所在的 inline tab group**（`layoutModel.addBlockToInlineTab`，单块节点会自动升级为 group），
  而不是再拆一个新块。要新开独立块用 **Ctrl/Cmd+点击**。
- 修饰键一律判 `e.ctrlKey || e.metaKey`：macOS 上 Ctrl+click 是右键语义，Cmd 才是"新开"。
  这条与 `preview-directory.tsx` / `preview-explorer.tsx` 的双击 forceNewBlock 约定一致，不要反向设计。
- 图标 `title` 必须把快捷键写出来（`Version Control (Ctrl/Cmd+Click: new block)`），否则快捷键等于不存在。
- 去重与聚焦：同一 group 内已有"同 view + 同目标"的块时聚焦它，不要重复堆 Tab。
  匹配规则只用一份实现：`frontend/app/view/preview/preview-inline-tab.ts` 的 `findInlineTabDedupeMatch`；
  去重键里值为空/undefined 的键不参与相等判断（避免把"还没选文件"的块误判为同一目标）。
- 放置失败必须回退：`addBlockToInlineTab` 返回 false（宿主节点已被关）时，
  先 `ObjectService.DeleteBlock` 清掉刚建的孤儿块，再走原来的 `createBlock`，不能把用户操作吞掉。

---

## 跨 Tab 打开文件的契约（2026-10-24, task 10-24-selection-search-cross-tab）

### 渲染模型（决定了一切写法）

- **每个 Tab 是一个独立 renderer**（`emain/emain-window.ts:418/430`），`setActiveTab` 只切主进程显示的 BrowserView。
- `atoms.staticTabId = atom(initOpts.tabId)` **在本 renderer 内不可变**（`global-atoms.ts:100`）。
  → 任何「先 `setActiveTab` 再等 `staticTabId` 变化」的写法**必然超时**，不要写 `waitForActiveTab` 这类轮询。
- `createBlock`（`global.ts:416`）内部用 `getLayoutModelForStaticTab()`，**永远落在调用方 Tab**，先切 Tab 也没用。

### 在指定 Tab 建 block

唯一正确路径是让服务端插进目标 Tab 的 layout：

```ts
await ObjectService.CreateBlockInTab(targetTabId, blockDef, DefaultCreateBlockRuntimeOpts, false, magnified);
getApi().setActiveTab(targetTabId);   // 只负责把用户视线切过去
```

先例：`workspace/widgets.tsx:2084` 的 `createBlockInExistingTab`。顺序是**先建块 → 再写 reveal meta → 最后 setActiveTab**。

### 枚举非活跃 Tab 的 block

- `getAllBlockComponentModels()` ≡ **当前 Tab**（block 只在挂载时注册，`block.tsx:1274`；`app.tsx:57` 只渲染 staticTabId）。
  → 需要全 workspace 枚举时，走 `atoms.workspace.tabids` → `WOS.makeORef("tab", id)` → `tab.blockids` → `WOS.makeORef("block", id)`。
- **陷阱**：`globalStore.get(WOS.getWaveObjectAtom(...))` 在首次访问的同一 tick 返回 `null`。必须 `await WOS.loadAndPinWaveObject(oref)`。

### 聚焦

- `refocusNode` 内部写死 `getLayoutModelForStaticTab()`（`global.ts:646`），**跨 Tab 分支禁止调用**，否则聚焦打到自己身上。
- 跨 Tab 只做 `setActiveTab`，聚焦交给目标 Tab 的 renderer；确需本渲染器内操作时用 `getLayoutModelForTabById(tabId)` / `restoreMinimizedBlockToLayout(tabId, blockId)`（这两个已按 tabId 工作）。

### `openPathInPreview` 的参数化约束

- 它是 **HIGH 影响面共享函数**（调用方：`searchSelectionInFiles`、`openFileLinkInPreview`、`openSearchPath`，间接覆盖 markdown 链接 / Files 树双击 / `preview-edit` action）。
- `tabId` 缺省必须**逐字节等价旧行为**：不调 `setActiveTab`、不调 `CreateBlockInTab`、只对 `tabId === staticTabId` 才 `refocusNode`。
- 改它之前先跑 `impact({target: "openPathInPreview", direction: "upstream"})` 并在 `file-link-navigation.test.ts` 补「不传 tabId」的回归用例。

### 查找范围

- 跨 Tab 查找必须按**发起方 connection** 过滤（从 focused block 的 `meta.connection` 取，取不到回落 `local`），local 与远端 / 不同 ssh 目标不混查。
- 选区引用既可能是文件也可能是**目录**：
  - `selection-reference-parser.ts` 的 `FilePathPattern` 强制结尾带扩展名，所以**目录必须走独立分支** `parseAbsoluteDirectoryReference`（低分 28，低于 `parsePathOnlyReference` 的 32，保证带扩展名匹配恒优先）。
  - 该分支**只认绝对路径**（`~/`、`A:/`、UNC、POSIX `/`）且段数 ≥ 2；**相对路径（`src/components`）永不成候选** —— 否则 `ls`/`tree` 输出会满屏误命中。
  - `ParsedFileReference.isDirectory` 是唯一开关：未设置时 `resolvePreviewTarget` 必须继续跳过 `fileInfo.isdir`（逐字节等价旧行为）。
  - 目录命中跳过行号与 `textHint` 定位，打开复用 `openPathInPreview`（已覆盖「reveal 既有树」/「新建 tree block」两条路径）。
- 只把 `view === "preview" && edit !== true && displayMode === tree` 的块当查找根，root 推导：`preview:explorer-root` → `meta.file`（stat 为目录才认）。
- 远端 connection 的 stat 必须加超时（1.5s）+ 并发限流（4）+ 单次查找内缓存，超时/异常一律当未命中。

---

## Tab 栏 UI 状态必须跨 renderer 共享：真源在 emain + IPC 广播 (2026-11-19, task 11-19-tab-collapse-cross-renderer)

每个 Tab 是独立 `WebContentsView` / renderer 进程，**Tab 栏在每个 renderer 里各渲染一份**。任何影响
Tab 栏可见性的状态（收起集合、openedThisLaunch、unread 集合等）如果只放 renderer 本地 jotai atom，
就会出现「在当前 Tab 里改了，切到别的 Tab 又回到旧状态」的撕裂 —— `collapsedTabIdsAtom` 实踩此坑。

- 硬规则：**跨 Tab 栏共享的状态真源必须在 emain 主进程**（内存 Set 即可，重启失效是可接受语义），
  变更后遍历 `waveWindowMap → allLoadedTabViews → webContents.send("<name>-change", ...)` 广播，
  结构对齐 `broadcastOpenedThisLaunchTabIds`。先例：`openedThisLaunchTabIds` / `collapsedTabIds`
  （emain/emain-window.ts）。
- renderer 侧模块保持「atom 初值同步读（sendSync）+ `init<X>Sync()` 订阅广播回写」+ 写函数
  「本地乐观更新 → IPC 写穿」；无实际变更不发 IPC（幂等短路）。先例：`tab-open-state.ts` /
  `tab-collapse-state.ts`。
- 「真正打开 Tab」的联动语义（如打开即解除收起）收口在 main 侧 `markTabOpenedThisLaunch`，
  不要只写在 renderer —— 广播自然把所有视图同步。
- 新增这类状态时同步补四处：`emain/emain-window.ts`（真源+广播+IPC）、`emain/preload.ts`、
  `frontend/types/custom.d.ts`、`frontend/preview/mock/preview-electron-api.ts`。
- 验证台：`scripts/verify/tab-collapse-cross-renderer/verify.mjs`（遍历所有 renderer 断言一致；
  注意 Electron 右键菜单是原生 menu-popup 不在 DOM，CDP 只能走 `window.api.*` 同 IPC 驱动）。

---

## 跨 Tab 的数据面必须自愈：WOS 缓存不跨 renderer，冷读面打开即重对账 (2026-11-24, task 11-23-overview-refresh-1123)

每个 Tab 是独立 renderer（`emain/emain-tabview.ts` 的 `WaveTabView`），**每个 renderer 有自己的一份
WOS 缓存**（`frontend/app/store/wos.ts` 的 `waveObjectValueCache`）。缓存靠 `waveobj:update` 广播续命：
广播漏一条（连接竞态 / 重连窗口 / 迟到回包覆盖）后，那个 renderer 对**别的 Tab** 的 `tab.blockids` /
block meta 就长期停在旧快照。实踩（2026-11-24）：Tab b 新建 agent → 从 Tab c 悬浮 Tab b 有 agent，
切回 Tab a 再悬浮就没了（a 的 renderer 缓存是旧的）。

- 硬规则 1：**响应式订阅只解决“事件到了以后”，不解决“事件没到这个 renderer”**。任何依赖别的 Tab
  数据的冷读面（Tab 悬浮卡、「更多」菜单、Overview 等），打开时都必须做一次重对账
  （`frontend/app/tab/tab-card-reconcile.ts` 是范式：reload tab → 按最新 blockids `primeWaveObjects({force:true})`）。
  对账要限流（同 tab 2s 一次）+ 吞错；放在 `useEffect` 里，**不要**放进派生 atom 的 `get`（会打 RPC）。
- 硬规则 2：WOS 读路径三条不可回退的 guard（缺一条就出现“永久旧数据”）——
  ① 迟到 `GetObject` 回包**不得抹掉已有值**（`null` 回包同理）；
  ② 请求失败必须解除 `loading`（只保留值），否则骨架/空态永久收不掉且无法重试；
  ③ `reloadWaveObject` 与 `createWaveValueObject` 共用同一条 version guard，旧快照不得回退版本。
- 判据（可机验）：`npx vitest run frontend/app/store/wos-guards.test.ts frontend/app/tab/tab-card-reconcile.test.ts frontend/app/tab/tab-info-card.dom.test.tsx`
  全绿；把 `wos.ts` / `tab-info-card.tsx` 还原到旧版应至少 5 条红（红证）。

---

## Code Review Checklist

<!-- What reviewers should check -->

(To be filled by the team)

---

## Emoji 字符比较必须双向归一化（2026-11-03, task 11-02-emoji-alias-picker-search）

emojibase 里很多符号的 `entry.emoji` **带 VS16（U+FE0F）**：`white_check_mark` 的
`entry.char` 是 `"✅️"`（U+2705 + U+FE0F），而代码里手写的字面量往往是裸 `"✅"`（U+2705）。
直接 `===` 比较或单方向 `replace(/\uFE0F/g, "")` 都会漏掉另一半。

正确做法：用一个候选展开函数（`markdown-transform/emoji-aliases.ts` 的 `emojiBaseCandidates`）
同时生成 **去 VS16 / 加 VS16 / 去皮肤变体** 三种形态，索引和查表两边都走它：

```ts
const byChar = new Map<string, EmojiEntry>();
for (const e of catalog.entries) {
    for (const candidate of emojiBaseCandidates(e.char)) {
        if (!byChar.has(candidate)) byChar.set(candidate, e);
    }
    byChar.set(e.char, e); // 精确拼写永远最后写，优先级最高
}
```

**测例提示**：断言不要写 `expect(r[0].char).toBe("✅")`，改用 `shortcode` 断言
（`expect(r[0].shortcode).toBe("white_check_mark")`），否则会因为不可见的 VS16 假失败。

---

## 候选/多选编辑器：显示过滤（子串）与创建门（精确）必须分离（2026-11-17, task 11-17-tag-editor-create-row）

共享浮层 `element/property-editor/tag-editor.tsx`（agent 卡 / md 预览 / CommonText 三面共用）
的「创建行」曾同时被两个判据控制：

- 显示过滤用**子串包含**（`filterOptions`：输入「设计中」命中「原型设计中」）；
- 创建行渲染条件却要求 `filtered.length === 0`（零匹配闸）。

于是精确值不存在、但存在子串命中项时，创建行永不出现，精确值无法新增。

硬规则：**「能不能创建」只由 `canCreateOption` 决定（精确匹配，忽略大小写），
绝不与显示过滤结果长度挂钩**。创建行在精确值不存在时始终渲染（排在过滤结果之后），
空态提示才依赖「零匹配」。回车语义同理：默认=创建精确值（不存在时）/第一行，
方向键或悬停主动挑选后回车=选中高亮行（用 `activeTouched` 标志分流，两种流都不误伤）。

---

## Agent 状态类"跨面视觉"问题：必须用真机验证台收尾（2026-11-05, task 11-05-agent-card-done-seen）

「Done 不跟随 seen」这类 bug 的判据是**用户看到的那一眼**，单测只能覆盖 read 判定表，
覆盖不到"悬浮卡真的换色了吗"。所以每次改 agent 状态呈现层，都要跑一次真机台子：

```bash
node scripts/verify/agent-card-seen/verify.mjs              # 起干净实例 → 全流程 → 自动关
node scripts/verify/agent-card-seen/verify.mjs --attach     # 复用已起实例（迭代 <1min）
```

它会真的新建一个 Pi agent block（跑 `~/.pi/agent/settings.json` 的默认 provider/model）、
发 prompt 等 `working → Done`、断言三个面（头部徽章 / 悬浮卡 / Tab 悬浮卡）的
`read` 与文案、真点徽章 ack、再断言同帧变 seen，最后把 `report.json` + 7 张截图写进
`verify-runs/<ts>-agent-card-seen/`。

### 六个必踩的坑（都已写进脚本，别退回去）

1. **首次启动的引导向导**（`Welcome to Snorkeling` → `Next` → `Get Started`）会盖住 WidgetsBar。
   它只有 ~560px，比 `dismissOverlays()` 的"浮窗 > 50% 视口"阈值小，因此**不会被自动关掉**：
   要按按钮文案（Continue/Next/Skip/Get Started）循环点，最多 8 轮。
2. **WidgetsBar 收起时图标落在视口外**：根节点是 `relative w-0`，覆盖层被 `translate(48px)` 推出去，
   图标 `getBoundingClientRect().x` 会 > `innerWidth`。点击前先点
   `[aria-label="Expand widgets bar"]`，并在探针里过滤 `cx < innerWidth - 2`。
3. **多 Tab renderer**：每个 Tab 一个 BrowserView（窗口标题 `Wave Terminal - <tab>`），
   非激活的可能 `innerWidth === 0`。选 renderer 要按「有 `.block` 且宽高 > 0」挑，不能取第一个。
4. **block 头部文本带 LRM**：`.agent-status-header` 的 `textContent` 前面有 `\u200e`，
   `^Done` 直接匹配会失败。断言前统一 `replace(/[\u200b-\u200f\ufeff]/g, "")`。
5. **elapsed 文案是两段词**：`formatDoneElapsed()` 在 <30s 返回 `"Just now"`，
   所以"未读 Done 带 elapsed"的判据是 `/^Done\s+\S/`（且 != `"Done"`），不是 `/^Done\s+\S+$/`。
6. **悬浮卡有 hover 延迟**：一次 `mouseMoved` 不一定弹出来，要"移到锚点 → 等 600ms → 读 DOM"
   循环到出现为止（最多 ~8s）；读的是 `.agent-card-status-chip[data-agent-read]`，
   **不要读颜色** —— 颜色随主题变，`read`/`is-seen`/`is-done-unread` 才是契约。

### 收尾纪律（用户窗口别乱开）

验证实例是**真的 Electron 窗口**（深色）。默认 `ensureInstance({resetProfile:true})` + 结束时
`cleanup()`（端口 → PID 关闭，`windowsHide:true` 避免 PowerShell 闪窗）；
只有显式 `--keep-open` 才留着。**不要**在没打招呼的时候批量起实例。

方法论层面（台的骨架、六条设计原则、环境纪律）见
[真机 UI 验证台 Playbook](../../../docs/project/ui-verify-playbook.md)。
其中最贵的两条教训：

- **确定性优先**：每轮 reset profile；"我刚创建的对象"用 before/after 差集取 id，
  不要用"第一个匹配 selector 的元素"（会读到上一轮留下的同类对象 → 假绿）。
- **等跃迁不等终态**：先等 `working` 系文案、再等 `Done`；只看终态会在"上一轮已经 Done"
  时立刻返回，断言的是旧状态。

---

## Tailwind 类名必须先确认真身 (2026-11-05, task 11-05-vcs-panel-icon-buttons)

`frontend/tailwindsetup.css` 的 `@theme inline` 是**唯一**的 token 来源。写之前先 grep：

- 存在：`foreground / secondary / muted / accent / error / success / warning / action /
  actiontext / actionhover / hoverbg / surface / block / panel / overlay / border`。
- **不存在**（曾误用于 VCS 面板，全部是死样式）：`ink / ink-muted / ink-faint / detail /
  danger / ok`。要红用 `text-error`、要绿用 `text-success`。
- **`.iconbutton` 这个 class 从未被定义过**。全仓 60 处 `className="iconbutton …"` 只靠同行
  的尺寸 utility 生效，hover/focus/disabled 态一律缺失。要么用 `<IconButton decl>` /
  新的 `<VcsIconButton>`，要么自己把 hover 态写全；不要以为写了 `iconbutton` 就有样式。

### icon-only 按钮的硬约束

- `title` 与 `aria-label` **同时**写（读屏只认 aria-label，鼠标只认 title）。
- hover 才浮现的行内动作必须带 `focus-visible:opacity-100`，否则键盘用户永远看不到它。
- hover 着色一律用 `enabled:hover:*`，避免 disabled 状态被 hover 破功。
- 有文字的按钮是**主 CTA / 导航 / 段头折展**的特权；`Diff / History / Reset / Prev / Next`
  这类重复动作一律图标化（VCS 面板 17 处已收口，见
  `frontend/app/view/vcs/vcs-panel-buttons.test.ts` 的源码级守卫）。
- `VcsIconButton` 的 `reveal="hover"` 依赖祖先行带 `group` class（组件内部只写
  `group-hover:opacity-100`）；宿主容器忘了加 `group`，按钮就永远透明。外部链接图标同理
  （2026-11-10 vcs-remote-jump：提交行 hover ↗ 必须把行容器写成 `group …`）。

---

## 重构"多份重复实现 → 单一组件"时的三条硬约束 (2026-11-06, task 11-06-agent-card-chip-title)

把 4 份状态 chip 收口成 1 份时，**功能测试全绿但真机台红 4 条**。红的三条都不是功能缺失，
而是"重构时把契约钩子弄丢了"。所以收同类包时按这三条自检：

### 1. 探针依赖的 class / data-* 是契约，不是实现细节

旧实现里的类名与属性，哪怕新实现不再用它们做样式，也要继续挂上：

- `.agent-card-status-chip` / `.agent-status-header` / `.session-overview-agent-status` /
  `.session-overview-agent-aggregate` —— verify 探针按这些选择器找元素；
- `.agent-card-status-dot` 及 `is-working` / `is-thinking` / `is-done-unread` / `is-seen`
  —— 脉冲断言读它们；
- `data-agent-read` —— 跨面 read 一致性的唯一机器可读信号。

做法：新实现把"新类名"与"兼容别名"**同时**放进 class 列表，兼容别名只作选择器锚点，
样式全由新类驱动。单测里显式断言兼容类存在（写进 chip-view 的 className 用例）。

### 2. `data-*` 必须出现在**所有**渲染分支上

`data-agent-read` 只写在 `<button>` 分支上，非交互分支（`onAck == null` 时渲染 `<span>`）
没写 → ack 之后卡片面读到 `null`，断言 `hover-card-seen` 红，而肉眼完全看不出差异。

规则：把 `{...dataAttrs}` 提到所有 return 分支上，或用同一个 `<Tag>` 变量承载；
不要在每个分支里手写一遍。

### 3. 真机台失败先分清"功能坏"还是"钩子丢"

本次 4 条红里：

- 3 条是钩子丢失（上面的 1、2）→ 改组件；
- 1 条是**既有产品 bug 被新断言抓到**：悬浮卡的放大按钮在真实指针下被 xterm 的
  link-layer canvas 盖住（`elementFromPoint` 命中 `CANVAS.xterm-link-layer`，
  JS `click()` 却正常）→ 属 `info-card` 层级/命中问题，不该在本包"顺手改掉"，
  应登记为独立问题并在文档里写清"已知红灯"。

判定方法：在实例里对按钮 rect 中心做 `elementsFromPoint()`，看命中元素是否在按钮内部。
命中别层 = 层级/遮挡问题（产品）；命中自己但状态没变 = 逻辑问题（代码）。

---

## 多值分组会跨列：计数断言必须写 `>=` (2026-11-06, task 11-06-overview-optimize-1to4)

- `groupOverviewCardsByTags` 把**一张多标签卡放进多列**，所以「各列卡片数之和 = 卡片总数」这条
  在标签视图下不成立。任何跨分组的计数断言都要按口径分开写：单值口径（status / tab / provider / project）
  用 `===`，`tags` 用 `>=` 并在 detail 里写明原因。
- 兜底列（`非 Agent` / `无项目` / `无标签`）的排序优先级**高于卡片数**：哪怕它有 10 张、别的列只有 1 张，
  它也必须排最后。写断言时别用「按数量降序」去反推兜底列位置。

## 状态历史必须后端记，前端挂事件会漏段 (2026-11-06, task 11-06-overview-optimize-1to4)

- `pkg/agentstatus` 的 `sameStatus()` **故意把 `UpdatedAt` / `ActiveSince` 排除在比较之外**
  （`agentstatus.go:539` 有注释说明原因）。后果：同一 state 只改了 `ActiveSince` 时 `willEmit=false`，
  前端收不到 `agentstatus` 事件。
- 因此「per-block 状态转移历史」**只能在 `statusManager.report()` 内部记**（那里拿得到 prev/next），
  不能在前端订阅事件自行累积 —— 前端累积会静默漏掉这些不 emit 的转移。
- 甘特图当前的 G2.1 是**退化实现**：只用 `activeSince` / `completedAt` 两个真实字段切「unknown 历史段 + 当前态段」，
  画不出多次交替。`overview-timeline.tsx` 的图例 tooltip 已写明这一点；要画多次交替需后端环形历史（另开任务）。

## 甘特条视觉：段 3px / 整条 4px / 段间 1px 缝 (2026-11-06, task 11-06-overview-optimize-1to4)

- 9px 圆角 + 18px 高的条会被读成「胶囊」，而甘特要表达的是**分段区间**。定稿：
  `.session-overview-timeline-bar { border-radius: 4px; gap: 1px }`，段 `.bar-seg { border-radius: 3px }`。
- `idle` 段必须是**中性灰实心**，不能并进 `unknown` 的斜纹：斜纹语义是「当时在干什么不知道」，
  把已知的 idle 画成斜纹等于谎报「不知道」。
- 真机断言用 `parseFloat(borderTopLeftRadius) <= 4`，不要做字符串比对（不同浏览器会输出 `4px` / `4.000px`）。

---

## Block header 悬停分区：必须锁存，`pointermove` 不参与 (2026-11-07, task 11-07-files-header-hover-latch)

`blockframe-header.tsx` 是**全 block 共用** header。给它加「悬停左半揭示左组 / 悬停右半揭示右组 + 左侧让位」时，
分区方向**只能在 `pointerenter` 判定一次，整个 hover 会话内不可变**。

### 为什么不能按鼠标位置实时算

右锁会让左侧（chevron + 路径）收起，腾出的宽度给右组 → 右组向左伸展、越过 header 中线。
若分区靠 `pointermove` 重算：鼠标去点那个已经伸过中线的 icon → x 落在中线左侧 → 分区翻成 left →
右组消失 → 点不到 → 鼠标退回 → 又翻回 right → **无限闪烁**。实测 240px 块宽下，中线版在右组第 0 个
icon（`goto` @x=35，mid=119）就翻区。

### 硬约束

1. **状态机是纯函数，且事件类型里没有 MOVE**（`header-hover-latch.ts` 的 `reduceHoverLatch`）。
   事件只有 `ENTER(x)` / `LEAVE()` / `RESET()` / `FREEZE()` / `UNFREEZE()`。类型层就没有误用的可能。
2. **锁存状态独立于 `isHovered`**。`isHovered` 管 reveal 显隐 + `claimInfoCard` + 悬浮卡 300ms 收起，
   **一行都不要改**；锁存另开 `hoverLatch`（`use-header-hover-latch.ts`）。
3. **离开 header 后启动宽限定时器**（默认 400ms，`block:headerhovergrace`，钳制 0–1200）。
   宽限内 `pointerenter` → 取消定时器并**沿用原方向**；到期才回 NEUTRAL。
   换方向必须「离开 → 等过宽限 → 从另一侧进入」，这是有意接受的代价（可预测 > 灵活）。
4. **宽度预算必须是纯函数**（`header-icon-plan.ts` 的 `planHeaderIcons`），不变量：
   `shown.length + hidden.length === total`，`w ∈ [40..900] step 2` × `zone ∈ {left,right}` 全跑单测。
   绝不允许出现「被 `overflow:hidden` 硬切、既不在菜单也不在浮层」的 icon —— 那是功能真丢。
5. **逃生入口按 `neverOverflow` 语义取，不硬编码 key**。各视图的溢出 icon key 不同
   （Files 是 `more`，原型里叫 `dots`）；硬编码会让窄块下 `shown` 变空、整条通道消失。
6. **让位由 `plan.yieldLeft` 单一真相源驱动**：子组件把它写成 `data-header-yield`，
   CSS 用 `:has()` 读。tier 0 且右组本就放得下时**不让位**（省掉无意义的路径收起）。

### 附属层（溢出菜单）的 `pointerleave` 顺序陷阱

实测（Playwright + Edge，菜单 portal 到 body 与 header 互为兄弟）：

```
hdr:pointerenter
hdr:pointerleave related=DIV      ← 先到（与直觉相反）
menu:pointerenter related=hdr     ← 后到
```

所以**不能指望菜单自己先 FREEZE**，宽限定时器已经在 `LEAVE` 时启动。两层防护都要：
① `onPointerLeave` 里先查 `relatedTarget` 是否落在附属层内（主路径，`header-attached-layer.ts`）；
② `FREEZE` 取消已启动的定时器（兜底）。
`graceMs === 0` 时第 ② 层失效，只有 ① 能保护 —— 单测必须覆盖这个边界。

### 验证

- 单测（不需要 GUI）：`npx vitest run frontend/app/block/header-{hover-latch,icon-plan,attached-layer}.test.ts`
- 真机台：`scripts/verify/header-hover-latch/verify.mjs`（A3–A7；本包由用户手动验证，台子留作回归用）

---

## 指标类信息：先证明数据可得，再设计图形 (2026-11-09, task 11-09-overview-card-metrics)

- **"累计 / 求和的指标"落地前必须 grep 数据源的真实调用方**。本次「Σ working 净运行时长」在原型里画得很好看，
  实现前核对发现 `buildTimelineSegments()` 的 `history` 参数**没有任何调用方**（注释写着"留给后端 ring buffer"），
  每个会话只有 `[unknown, 当前态]` 两段 —— 于是 Σworking 在 live 卡上等于状态 chip 的跑时（纯重复），
  在 done/idle 卡上恒为 0（整格永不渲染）。判据：**如果指标在两个常见状态上分别是"重复"和"缺失"，它就不是指标。**
- **同屏多个"时长"必须语义可分**。Overview 卡上一度同时出现 `1d`（最后活动）、`Working 12m`（当前轮跑时）、`3m`（跨度/累计）：
  前两个单位都是 `m`，用户当场就问"这两个有什么区别"。约定：**派生指标一律带符号前缀**（`↔3d` = 跨度、`Σ3m` = 累计），
  符号单独成 `<span>` 以便降一级样式；符号与数值分开返回（纯函数返回 `{mark, text}`），别把符号混进数字文本。
- **裸的时间/年龄标签必须有 `title` + `aria-label`**。卡头 `age` 只是 `1d`，没有 tooltip、没有无障碍名，
  用户无法自解释。完整写法：`最后活动：YYYY-MM-DD HH:mm:ss · 1d 前`（`now` → 「刚刚」）。判定函数放纯模型层（可单测）。
- **度量轨只有一个渲染入口**：`session-metrics.tsx`（组件）+ `session-metrics-view.ts`（纯 view model，可单测），
  看板卡与列表行靠 `surface="board" | "row"` 分视觉差异。阈值一律 `import` aisessions 的
  `heatLevel` / `MessageHeatThresholds` / `SizeHeatThresholds` —— 复制一份数组必然漂移（chip 上已经吃过 4 份实现的亏）。
- **同组件文件不能同名 `.ts` + `.tsx`**：`session-metrics.ts` 与 `session-metrics.tsx` 并存时，TS 解析 `./session-metrics`
  **优先 `.ts`**，于是 `import { SessionMetrics } from "./session-metrics"` 报"没有导出成员"。命名按本仓既有约定：
  纯逻辑 `*-view.ts` / 组件 `.tsx`。

### 真机验证：真实数据播种（比手搭 DOM 诚实）

干净 profile 里没有 agent 块 = 没有 `SessionSummary` = 度量轨无从渲染，直接断言只会全 `skipped`。可复用的套路
（`scripts/verify/overview-board/verify.mjs` 阶段 4）：

1. `AISessionsService.List({ limit: 40 })` 从**真实索引**里挑一条 `messageCount>0 && size>0 && createdAt>0` 的会话；
2. `createBlock({ meta: { view: "term", "agent:provider": src, "agent:sessionid": id } })` 把它的 id 挂到一个块上；
3. Overview 走正常路径加载 summary（轮询等 `.session-metrics` 出现，不要固定 sleep）；
4. 断言值来自播种数据（如 `msgText === formatMessageCount(messageCount)`），而不是"看起来像数字"；
5. 结束 `ObjectService.DeleteBlock` 清场。

配套断言：`data-metrics-count === 单元格数`、`scrollWidth - clientWidth <= 1`（220px 窄列不换行）、
`无 cells 的空轨道数 === 0`（缺数据必须整条不渲染，不留空分割线）。

### 卡片 meta 行：没有内容就不要渲染带样式的空节点

`session-overview-board-card-view-label` 带 `border / padding / border-radius`，即使文本是空串也会
画成一个空胶囊（2026-11-09 真机：无 AgentStatus 的 pi agent 卡）。硬约束：

- 显示判定收口成纯函数（`resolveBoardMetaLabel`），返回 `""` 时组件必须 `cond ? <span/> : null`，
  **不允许**把可能为空的值直接塞进带样式的节点；与 `formatBoardAge` / `truncateBoardPreview`
  的「空串隐藏」是同一口径。
- 状态 chip 与兜底标签各按自己的条件渲染，别用 `if/else` 把「没 chip」等价于「一定要画标签」。
- 回归两级：DOM 单测（jsdom + createRoot 渲染真实卡片）断言空节点数 = 0；真机台同名断言
  `board-no-empty-view-label`（用户自验时也要跑）。
- 同一 meta 行的 chip 家族共用 `.session-overview-board-chip` 基类，变体（`is-tag` / `is-tag-more`）
  只做继承层覆盖；调字号 / 内距必须同步调 `line-height`，保证 chip 总高不漂
  （2026-11-09 A 方案：9px/1.4 → 10px/1.25，实测 `54.1×16.6` → `62.6×16.5` px）。

---

## 窄侧栏（VCS 面板）里的行式列表：禁止固定列宽，时间用相对 (2026-11-09, task 11-09-vcs-remote-sync-widget)

VCS 面板典型宽度 400–560px。`RemoteCommitRow` 原来给 hash/author/date 各挂
`min-w-[78px] / min-w-[120px] / min-w-[110px]`，加 3 个 `gap-2` 共 332px，
扣掉 padding 后**标题只剩 ~72px**，中文标题必然截断成 6~7 个字。

- **元信息一律下移成第二行**（两行式），标题吃满整宽：`truncate` + `title` 全量；
  行高从 28px → ~40px 是更划算的交换。
- **时间不用 ISO 串**：`formatRelativeTime`（`frontend/app/view/vcs/vcs-time.ts`）
  `just now / Nm ago / Nh ago / Nd ago / MM-DD`，绝对时间进 `title`；
  解析失败原样返回，不能让脏数据把整行渲染打空。
- **方向语义色沿用既有语汇**：ahead/Outgoing 用 `text-success`/`bg-success`，
  behind/Incoming 用 `text-error`/`bg-error`（与 `vcs-branches-tab.tsx` 的 ↑/↓ 一致）；
  值为 0 时降到 `opacity-55` 保留可见（用户要确认「我没落后」），不要整块隐藏。
- **分组标题 = 标签 + 计数 chip + 发丝线**，不要裸一行小字；chip 走 `bg-surface-soft`，
  别用 `border-border` 描边胶囊（与「去描边胶囊化」口径一致）。
- 纯函数放独立 `*.ts` 并配 vitest（`vcs-time.test.ts` 11 条），组件里不写时间格式化分支。

### 两行式提交行只有一份实现 (2026-11-10, task 11-10-vcs-history-commit-row-style)

- vcshistory 块的提交列表与 Changes 页 Remote 区共用 `frontend/app/view/vcs/vcs-commit-row.tsx`
  的 `CommitRow` / `CommitGroup`：同一观感（轨 / 两行 / hover / 分隔线 / 圆角容器）只允许这一份，
  不要在别的 VCS 面板再手写第三份。
- **expandable 行与纯展示行必须同一分支骨架**：非 expandable 时 subject 行是纯 `div.truncate.text-xs`
  （与 Remote 区逐字节一致）；expandable 才换 flex + `▾/▸`。禁止为「可展开」另写一套行容器。
- **语义轨不得跨场景复用方向色**：Outgoing 绿 / Incoming 红只属于 remote 同步方向；
  history 等无方向语义的场景用 `bg-accent` 中性轨。真机断言锁死 history 轨不出现
  `bg-success` / `bg-error`。
- verify 台的 `--dry` 分支必须 `finish({ ledger: false })`：模板默认 `ledger: true`，
  dry-run 只跑「依赖解析」也会往 `docs/project/verify-ledger.md` 写一行 ✅ 假绿（2026-11-10 实踩）。
  新 area 从模板复制后第一件事就是改 dry 分支，并删掉模板遗留的任何假绿行。

---

## 行内「悬浮淡出」的元信息：不能靠 tooltip 承载必要读数 (2026-11-09, task 11-09-commontext-freshness-square)

CommonText 列表行右槽（`w-[58px] h-7`）挂 `group-hover:opacity-0`，hover 时换成插入按钮。
第一次把更新时间做成 12×12 热力方块、精确时间只放 `title` —— 结果**那个 tooltip 永远悬停不到**：
行的任意位置一 hover，方块就淡出，且插入按钮（`absolute right-0 w-7`）正好盖在方块上。

- **判据**：任何「必须读到」的信息，在 `group-hover` 生效的位置都不能只存在于 `title` / `aria-label`。
  要么常显（文字或可量化的图形），要么挪到不需要 hover 的出口（详情面板）。
- **双出口是正解**：图形管「扫一眼比大小」，紧跟的**紧凑数字**（`now/45s/12m/3h/45d`）管精确读数，
  不额外占用行高（`12px 方块 + 4px gap + ≤4 字符 ≈ 39px ≤ 58px`）。
  数字标签 `aria-hidden="true"`，读屏只读方块 `aria-label`，避免重复播报。
- **紧凑时间不另写阈值**：从 `formatSessionRelativeTime()` 改写（去 ` ago`、`just now → now`），
  与 aisessions 同一套口径；`ago` 在整列同构的行里是纯背景噪声。
- **图标语义必须对得上计数语义**：`fa-repeat` 读作「重来/循环」，放在「被用过多少次」旁边是错配。
  纯数字列（tabular-nums）里就留纯数字，不要把语义可疑的图标当装饰。
  但**多列并排的详情元信息行（创建/更新/最近使用/次数）例外**：图标是区分列义的唯一线索，不能删。

---

## 「复制给 agent」的 payload 只能经 buildAgentPayload 组装 (2026-11-10, task 11-10-cfa-core)

- 任何把**上下文拼成 prompt 文本**复制到剪贴板的新入口（冲突合并、同步诊断、终端失败输出、
  VCS 冲突、设置 JSON 校验失败…），一律走 `frontend/app/element/copy-for-agent.tsx` 的
  `<CopyForAgent>` + `frontend/app/element/agent-payload.ts` 的 `buildAgentPayload()`；
  纯复制标识符（blockId / 命令 / 路径）的按钮不在此列。
- payload 固定三段：`### Context`（调用方拼装，键值行）→ `### Task`（一句祈使句）→
  `### Output contract`（选预设常量 `MERGED_CONTENT_ONLY` / `FIX_COMMAND_ONLY` /
  `DIAGNOSIS_BRIEF`；自定义必须给理由注释）。**缺 Task 或 Output contract 会被构建器直接 throw**：
  没有输出契约，agent 默认回一篇分析；没有 Task，用户还得自己解释——这正是「复制给 agent」
  要消灭的摩擦，不是可选项。
- 三段小节结构与 Go 端 `pkg/syncconflict/render.go` 的 `RenderMarkdown` 对齐。新增/修改任何一侧
  投资节标题，必须两侧同步改，否则同一个用户名下两处复制出来的格式会漂。
- 入口语义与摆放：文案统一 `Copy for agent`，`title` 必填并带 payload 概要（如
  `Copy all 3 conflicts for an AI to merge`）；按钮紧贴被解释的对象（冲突行右、错误行右），
  不做全局「导出诊断」。**只进剪贴板**，不绑定任何单一 provider。
- 成功反馈复用 `CopyButton`（2s 勾，Promise 形态只在 resolve 后报成功，失败静默保持原图标）；
  懒取 RPC 数据用 `text: () => Promise<string>` 函数形态，pending 期间按钮转圈禁点。

---

## 恢复路径不得把「绑定已失效」的内部错误甩给用户 (2026-11-10, task 11-10-aisessions-restore-notfound-graceful)

- **背景**：Agent GUI 块发首条消息时 `bindNewSession()` 立刻把 `aisessions:sessionid` 写进 block meta，
  但 pi 的 JSONL 要等第一条 assistant 消息完成才落盘。此间重启 → 恢复时 `Detail` 必然
  `session not found: <id>`，旧行为把这行内部错误当横幅展示。
- **硬约束**：任何在**恢复/挂载路径**读取持久化会话 id 的地方（`agent.tsx` 的 `restoreBoundSession`、
  `aisessions.tsx` 的列表恢复 fallback），失败后必须先用
  `isSessionNotFoundError(error, sessionId)`（`frontend/app/view/aisessions/utils.ts`）判定：
  - 是 → 清 block meta 绑定（`aisessions:sessionid` / `agent:sessionid` → null）+ 清 `errorAtom`，
    回落 New Chat / 既有 fallback；**不展示内部错误**。
  - 否（连接/网络/瞬时）→ 保持既有报错行为，**不清绑**（避免把有效会话误清）。
- 判定必须带确切 id 匹配（`session not found: <id>`），只匹配文本前缀会把别的会话的 not-found 误判成当前绑定失效。
- 用户主动点击会话行的 not-found 不在降级范围（应正常报错）。

---

## 状态面板的「可行动证据」不能被刷新路径清空 (2026-11-10, task 11-10-cfa-sync-diagnostics)

真机验证台抓到的两个真 bug，都是「面板看起来正常，但用户需要的失败证据不见了」：

- **run 错误与 build/配置错误必须分两个变量。** `syncmanager` 曾把两者存在同一个 `lastError` 里，
  而 `GetStatus()`（面板每次打开/刷新都调）会先 `reload()`；`reload()` 重建 transport 成功就
  `lastError = ""` —— run 失败的错误（journal 里明明记着 ERROR）在用户打开面板的瞬间被抹掉。
  修法：`lastRunError`（run 失败，成功 run 才清）与 `lastError`（build/配置，reload 自己管），
  状态返回 `firstNonEmpty(lastRunError, lastError)`。
- **失败 RPC reject 之后要主动补拉状态。** 后端失败时返回 `(status, err)`，RPC 会 reject，
  前端 `catch` 拿到不到返回体里的 lastError；`catch` 里必须 `refreshSyncStatus()`，否则依赖
  lastError 的 Copy-for-agent 入口永远不出现。
- 判据形式：造一个必失败的 run（folder 指向 `/etc/hosts/...` 之类必失败路径、并先播种 ≥1 条
  item —— 空 item 集的 run 会静默成功，失败态永远出不来），断言 payload 含 `last error:` 与
  journal 事件行。`scripts/verify/sync-diagnostics-copy` 已实现。

---

## pending input 注入：按「事件」验证，不要按 TUI 输入框文本验证 (2026-11-10, task 11-10-commontext-send-agent-block)

CommonText「新建 agent block 并发送」靠 pending-input 队列把文本在 TUI 就绪后 `terminal.paste` 注入，
验证时踩到的三个坑（`scripts/verify/commontext-send-agent-block/` 已固化）：

- **不要依赖 `cmd:initialinput`**：全仓零消费点（见 `docs/project/agent-session-plan.md`），靠它注入必然静默失败。
  注入时机只走 `computeInjectDecision`（首输出 + 静默窗口，TTL 兜底），消费端在 `term.tsx`。
- **TUI 首启提示会吞掉注入按键**：claude 的「目录信任」选择菜单、codex 的「Update available」提示都会先于 composer 出现，
  此时 paste 的字符不进输入框。所以**不要断言 buffer 里出现发送文本**——改为断言
  `snorkeling:pending-input-injected` 自定义事件（`term.tsx` 注入成功时派发，与 fallback 事件对称）。
- **`window.term` 只能代表「最后一次创建的 TermWrap」，不是「你要看的那个块」**：新建 Tab 会先建默认终端，
  多块/多 tab 时读它必串块。要断言某块的终端内容，用带 blockId 的事件或显式选择器，别用 `window.term`。
- **多 agent 并行跑 verify 必须错开端口**：`VERIFY_PROFILE=verify-x VERIFY_VITE_PORT=51871 VERIFY_CDP_PORT=9237`。
  共用默认端口时两台验证台会互相读对方的块（实测注入断言读到了另一台的 `term-failure-copy` 块）。

---

## 浮层三条硬约束：不要自建遮罩 / 弹层对齐 New Agent / px 前先确认 token 存在 (2026-11-11, task 11-11-commontext-send-splitbutton)

- **禁止自建 `<div class="fixed inset-0">` 全屏遮罩当「点击关闭」层。** `position:fixed` + `z-index:auto`
  自成层叠上下文，会把内部弹层的 `z-index:1000` 困死；而 `.modal-wrapper` 是
  `position:fixed; z-index:500`（`--zindex-modal-wrapper`），在 body 层叠上下文里直接压过遮罩
  → 弹层「渲染了但完全看不见、不可点」，而 DOM 断言全绿（假绿）。
  正解：`@floating-ui/react` 的 `FloatingPortal`（往 body 追加的是**无定位样式**的普通 div，不是层叠上下文，
  floating 子元素 zIndex 1000 直接参与 body 层叠）+ `useDismiss`（外点/Escape）判关闭。
  现成控件：`frontend/app/element/splitbutton.tsx`（split button + 浮层，可直接复用）。
- **弹层/弹窗的视觉面层以 New Agent 浮窗为基准**（`workspace/widgets.tsx` AgentTargetFloatingWindow）：
  `bg-modalbg/80 backdrop-blur-2xl border border-border/70 rounded-xl shadow-2xl`，
  分区用 `border-b border-border/60` + 标题 `text-xxs text-muted`；选中行用
  `bg-accent/12` + 左侧 `w-[2px] bg-accent` 强调条 + `getAgentIcon` 图标 + 默认项勾。
  新弹层不另起一套配色，否则深色/单色主题下会突然出现刺眼的分割线。
- **写 Tailwind 颜色工具类前先确认 token 真的存在**（`frontend/tailwindsetup.css` 的 `@theme inline`）：
  `border-border-soft` 是**不存在**的 token（只有 `--color-border`），写了不会报错，而是退回 preflight 的
  `border-color: currentColor` —— 深色主题下变成浅色分割线，看起来"莫名其妙很突兀"。
  项目内合法写法：`border-border`、`border-border/60`、`border-border/70`。
- **agent profile 列表必须带探测**：`getAgentProfileOptions(settings)` 不传 availableCommands 时会退化成
  「全部 profile 都算检测到」，把用户没装的 agent（gemini 等）也列出来。用
  `useDetectedAgentProfileOptions(settings)`（`workspace/use-agent-profile-options.ts`）。

---

## 「发送」类注入 = paste + 回车提交，缺一不可 (2026-11-11, task 11-11-commontext-send-submit-and-style)

- `terminal.paste(text)` 只把文本放进 TUI 输入框，**不会提交**——用户看到文字粘进去但 agent 永远收不到
  （CommonText Send 双路径实测 bug：聚焦块 `sendTextToFocusedTerm` + 新建块 pending-input 注入都只 paste）。
- 正解：paste 后延迟 ~150ms（`SubmitAfterPasteDelayMs`，给 TUI 吃进 bracketed paste 的时间）经
  `RpcApi.ControllerInputCommand` 发 `"\r"`（`frontend/app/commontext/commontext-insert.ts` 的
  `submitTermInput`，与 termsticker/term-model 的 `sendDataToController` 同一 PTY 按键通道）。
  太早发会把回车当粘贴内容的一部分。
- 单测锁结构事实（`commontext-insert.test.ts`）：走 ControllerInputCommand 且载荷是 `stringToBase64("\r")`。
- **共享文件不要顺手跑全文件 prettier --write**：term.tsx 当时带着另一路未提交改动，全文件格式化会把
  别人的在建工作卷进自己的 diff（45+/50-）。对共享文件只做最小编辑，格式化留给文件的主人。

---

## 新 UI 文案必须走 t()，禁新增硬编码（2026-11-15, task 11-14-i18n-rollout）

**硬约束**：前端与主进程的**用户可见文案**（JSX 文本、`title`/`label`/`aria-label`/`placeholder` 等属性、对象属性里的 label）必须来自 i18n 资源（`frontend/i18n/locales/{en,zh}/<ns>.json`，en 唯一真源、zh 镜像），代码里用 `t("ns:key")`（全限定 key）或主进程 `tmew(key)`。**硬编码中文与硬编码英文同等禁止**（中英混杂治理）。CLI 命令名/配置键名/品牌名等不可翻译项进 `scripts/i18n/allowlist.json` 并带 reason，不得静默省略。

- 闸门：`npm run i18n:check`（全仓扫描 + en/zh 键 parity，已接入 CI `snorkeling-ci.yml`），本地增量 `--dir <module>`。扫描器用 TS AST，三类发现：`jsx-text` / `attr(+attr-expr)` / `cjk(+cjk-jsx)`。
- 陷阱（已真机踩过）：① `require()` 在 ESM 主进程 bundle 直接崩——用静态/动态 `import()`；② 模块加载期就求值的常量表会**冻结 locale**——存 key（`labelKey`/`as const`）渲染期 `t()`，视图模型显示名用 `localeTextAtom`；③ hook 的 `t()` 不接受 `{values}`——插值走 `i18n.t("ns:key", values)`；④ jsdom 的 `navigator.language` 跟宿主——"auto" 相关测试必须 pin；⑤ 主进程只加载 `common` 命名空间（大 JSON 内联全量会触发 commonjs shim 把主 chunk 字符串劈断的 bundler bug）。
- 手册（唯一真源，Pattern A–J + 全部坑）：`docs/docs/i18n.mdx`。

---

## 批注时间线 v2：分页 / gutter / 前端分页渲染的三条硬契约（2026-11-17, task 11-16-v2-gutter）

B1（`design/plans/aisessions-annotation-timeline-v2.md`）落地时确立的契约，改相关代码前先读：

### 1. `Annotations` 的分页**必须发生在重锚定之后**（视图层），不要在 SQL 层加 LIMIT

- `AISessionsService.Annotations` 的 anchors 流程会调 `ResolveAnnotationAnchors`，它**改写 seq**（AI 生成行落库时 seq=0，重锚定后填真实行号）。在改写前用 `seq < ?` 做 SQL 游标，等于在过期排序键空间上算页边界 → 会漏条、会把不该进这一页的条目算进来。
- 所以游标裁剪在 Go 视图层（`aisessions.PageAnnotationViews`）：DB 仍全量读行，响应截断到 ≤limit 条并带 `hasMore/nextCursor`。这是**有意取舍**，不是漏做：真正 SQL 级游标（`ListAnnotationsPaged`）要等 B2 引入 `author/idempotency_key`、重锚定不再全量依赖时再接。
- 旧调用（不带 cursor/limit）必须保持 v1 全量等价——那是回滚出口。
- limit 夹取 `[20, 500]`、默认 100，常量在 `pkg/aisessions/types.go`，不要散写数字。

### 2. 「分页只是渲染层」：all 模式必须**返回同一引用**，不是「过滤后内容相等」

`annotation-flow-rows.ts` 的 `filterTimelineItemsToPage(items, page, mode)` 在 `mode === "all"` 时**直接 `return items`**（同一引用）。理由：

- 引用相同 → 下游 `useMemo` 链全部短路，all 模式性能与分页前逐字节一致；
- 内容相等但新数组 → 每次渲染都让 `rows`/`seqToIndex`/virtualizer 重建，短会话也会抖。

任何新的「按页收窄」逻辑都照这个口径写，并在单测里断言 `toBe`（同一引用），不是 `toEqual`。

### 3. gutter 标记坐标：只用行偏移，不读 DOM rect（虚拟化路径）

```
y = rowTop - scrollTop - railBodyTop + anchorOffset(14)
rowTop(虚拟化) = virtualItems[].start + paddingTop        // getOffsetForIndex，不读 rect
rowTop(非虚拟化) = nodeRect.top - paddingBoxTop + scrollTop
```

- rail 本体 `overflow: hidden`，**永不出滚动条**；视口外标记先裁（`y < -24 || y > height + 24`）；
- 相邻标记 `MarkerMinGap = 16px` 向下推开，同行多条合簇；
- 滚动路径必须 rAF 合并 + **内容 diff 后才 setState**（`gutterMarkersEqual`）——每帧 setState 会让 60fps 直接崩掉；
- 前插锚定：`scrollTop += (scrollHeight_after - scrollHeight_before)` 必须**同帧**（`useLayoutEffect`），且 `delta === 0` 时**故意不回写** scrollTop（快照值是几帧前的，回写会抹掉用户滚动）。

### 4. 大文件（`session-detail.tsx` 2400+ 行）分派子代理：拆成互不重叠的小步

实测：把「状态 + UI + 接线 + 测试」一次性喂给一个子代理，会在读文件阶段就断（两次）；拆成
`7a 分页状态/翻页条` → `7b-1 markers/窗口/锚定` → `7b-2 页内渲染/分段头` 三个 tight-scope 批次后全部一次通过。
喂 prompt 时必须给**精确落点**（变量名/行号/已有 hooks 名/接口清单），并明确「只做这一块，别碰 X」。

---

## 后台链路依赖「隐藏挂载」时的三条硬约束 (2026-11-17, task 11-17-commontext-send-background)

CommonText Send 改成后台异步（不跳 Tab、不抢焦点）时，注入必须发生在**未激活的 Tab** 里。
实现是「pending Tab 临时并入 workspace 预挂载列表（visibility:hidden，真实尺寸）」。踩到的坑：

### 1. 「块属于哪个 Tab」不能用 `tabModel.tabId`

`app.tsx` 给整棵 renderer 树只提供一个 `TabModelContext.Provider`，value 是**本 renderer 所属 Tab**
（`getTabModelByTabId(atoms.staticTabId)`）。workspace 预挂载别的 Tab 的 `TabContent` 时，
里面的块拿到的 `tabModel.tabId` 仍然是 `staticTabId` → 用 `tabModel.tabId === staticTabId` 判断
"是不是本 Tab 的块"对隐藏挂载的别的块**恒为真**，守卫失效（实测：hidden agent 块覆盖了
`window.term`、还可能抢焦点）。

正确判据：`globalStore.get(tabModel.tabAtom)?.blockids.includes(blockId)`（tab.blockids 是权威列表）。

### 2. pending 隐藏挂载队列：不参与 cap 切片 + 硬过期兜底 + 绝不落盘

- 预挂载列表本身有 `PreloadTabCap=3` 切片；pending Tab 若并进同一个 slice，连续几次发送就会被
  挤出列表 → `TermContent` 卸载 → 注入 tick 停止 → **TTL 回退永不触发、entry 悬死**。
  pending 必须"加在 slice 之后"（`frontend/app/workspace/preload-tabs.ts` 的
  `computeRenderPreloadTabIds`），且自身有上限（当前 2）。
- 块在等待期间被删 / 组件再也不会挂载时，注入链路跑不到，所以队列条目必须带
  `expiresAt = registeredAt + ttl + 5s` 硬过期兜底（`pruneExpiredPendingInputTabs`），
  由 workspace 的 2s 定时器兜住，否则会永久留一个隐藏 TabContent（xterm/WebGL 上下文）。
- 队列与 registry 都是模块级内存：**禁止持久化**（历史 block-jump 黑屏死锁就是
  localStorage 残留 + 模块求值期读取 → renderer 报废）。

### 3. 注入 effect 必须订阅 registry 变更（晚注册重触发）

后台路径下块可能在 `registerPendingInput` 之前就被预挂载（执行顺序：建块 await → 注册），
effect 首次运行 `peek == null` 直接 return，之后**不会再有第二次机会** → 静默不注入。
做法：registry 提供 `subscribePendingInput(cb)`（注册/消费/队列变化都广播），term 的注入 effect
把订阅得到的 tick 放进依赖，晚注册时重新起轮询。

### 4. 真机台点击坐标必须"点击前重取"，不能复用

编辑器失焦 600ms 后会自动折叠，工具栏/按钮整体位移（实测 ~27px）。复用早前算好的坐标点击会
落到别的元素上，`waitForProbe` 超时后脚本**不检查返回值**继续跑 → 后续断言全红且看不出根因。
规则：`caretPoint` 这类坐标每次点击前 `evaluate` 重算；`waitForProbe` 的返回值必须断言，
不要"调用即认为成功"。

## 测试误红排查：先确认被收集的测试文件真的是仓库代码（L-0007）

vitest 按目录跑时会把项目里所有匹配 glob 的文件当测试收集，**包括 gitignored 的本地缓存副本**
（实测：`.cache/tmp/wt-head/` 是 10 月的旧 worktree 快照，整棵 frontend/ 被重复收集，
旧代码上的 pre-existing 失败把新改动"染红"）。症状：同一测试文件跑了两遍、其中一份红，
且失败文件路径不在 `frontend/` 前缀下。

规则：

- 目录级 vitest 出现莫名红，先看失败文件的**完整路径**；不是 `frontend/` 前缀的先删缓存副本再复跑。
- 判"我这单是不是引入的"，用 `git stash push -- <触达文件>` 跑同一条命令取基线，不要凭直觉。
- 重模块图的单测（如 `blockregistry.test.ts` 拉整个 view registry，冷启动 2–3s）在整目录并行时
  会超默认 5s 阈值误红：给该用例显式放宽 timeout，而不是删测试。

## Hero / Persona 类"身份"显示：显示层用身份字段，绝不显示据点目录名

据点目录名是**磁盘不变量**（`pkg/hero` `ValidateID`：目录名 == id；中文名 id 必然
`hero-<hash8>`）。任何 UI 面显示身份时读启动时写入的块 meta（`hero:name` = emoji + name，
`display:name` 同值供标题回退链），**不要** `basename(cmd:cwd)`（会显示哈希目录名）；
完整路径只降级到 tooltip / 点击复制（复制用原值，`displayPath()` 仅展示用、且远端块禁用）。
参照实现：`buildHeroLaunchBlockDef`（写入）→ `heroHeaderName`（读取）→
`block.tsx defaultTitle` / `buildCmdCwdHeaderElem`（接线）。

---

## 详情块绑定解析失败不得回落「列表第一行」(2026-11-20, task 11-20-aisessions-detail-binding-mismatch)

绑定会话（block meta `aisessions:sessionid` 非空）的详情块，挂载解析失败（meta 未就绪 /
`limit:200` 窗口外 / Detail 请求瞬时报错）时**只能保留绑定 + 报错等重试**，绝不静默改绑列表任何一行。
修前 `loadSessions` 收尾的回落分支漏了 else：绑定解析成功的结果也会被 `列表第一行` 覆盖，
且因 `selectedKey` 落在列表内，后续刷新永不自愈 → 详情块粘死在错误会话上（列表双击与
Agent TUI 右键 Open Session Detail 两条入口共用该逻辑，都中招）。

- 三条判定收口在 `frontend/app/view/aisessions/detail-binding.ts`（纯函数）：
  `detailFallbackDecision`（绑定块恒 `keep`，永不 `first-session`）、
  `shouldCommitDetailLoad`（seq 最新且仍选中才提交，`loadDetailById` 与 `loadDetail` 共用）、
  `detailBelongsToSelection`（归属不符时面板收 `null` 走骨架，旧正文不得冒充当前选中）。
- 孤儿绑定 id（session not found）清绑后要记 `boundDetailLost`：清绑让 meta 变回「未绑定块」，
  下一次刷新会当成普通列表块自动选最新一行 —— 错位换个马甲回来。
- 「自动选最新一行 / 自动起新会话」只属于**未绑定**块；给任何回落分支加代码时先问
  「这个块是不是绑定详情块」。
- 机器验证钩子：详情面板根节点 `data-detail-session-key`（= 正在渲染的会话 key），
  验证台 `scripts/verify/aisessions-detail-binding/`（真实指针双击 → 断言面板 key 逐字
  等于被点行、不等于列表第一行）。真机 skipped：本机性能不够（2026-11-20），判据由
  `detail-binding.test.ts` 的 14 条用例（含修前规则红证对照）锁定。

---

## 浮层/下拉的关闭语义：只认 Esc / 真外部 / 提交，禁止 blur 关门（2026-11-20, task 11-20-property-status-to-select）

Windows/Electron 下「焦点逃逸（blur）」不是可靠的关闭信号：

- **原生 `<select>` 不能承载浮层内编辑**：展开是独立原生弹窗，会夺走 web 焦点 → `onBlur` →
  组件被卸载 = 「点一下就关，根本选不了」。属性改类型控件因此从原生 select 改成
  `PropertyValuePopover` 点击式菜单（不依赖任何 focus/blur 保活）。
- **浮层容器 `onBlur` 关门同样不可靠**：点浮层自身空白（`.ptag-list` padding、行间隙）就会把焦点
  归 body → 误关。共享 `PropertyTagEditor` 已删掉容器 onBlur；关闭只认三条：Esc /
  `PropertyValuePopover` 的 outsidePress / 单选点选提交。列表区空白 `mousedown` 一律
  `preventDefault`，保住输入焦点（用户点空后还能继续打字）。
- **`outsidePress` 只豁免「浮动元素内部」，不豁免锚点**：锚点附近误点仍会关。窄卡里浮层要保证
  可点面积；不要给列表做「点击后重排」（已选值在前），重排会让连点第二下踩空。
- 回归判据（DOM）：打开后派发 `blur`/`focusout` 浮层仍挂载；点浮层空白 `onClose` 0 次且
  `mousedown.defaultPrevented === true`；Esc 仍关。真机台（性能允许时）：
  `scripts/verify/property-editor/verify.mjs` 的 `agent-retype-menu-*` —— 1200ms 后仍在 + 指针移入不收。

---

## localStorage 是跨窗口共享通道：启动逻辑不得删共享 key（2026-11-20, task 11-20-aisessions-emoji-bootstrap）

所有 Electron 窗口同 origin，共享同一份 localStorage，且 `storage` 事件会把**别的窗口**的删除同步
成本窗口的内存清空。这带来一条硬约束：

- **任何窗口的启动（mount）逻辑都不得删除共享 localStorage key**。例：session emoji 的旧迁移
  「抄到后端后删 key」实际效果 = 每开一个新窗口，所有窗口的本地层同时被清，正在看的 agent Block
  头像当场掉回默认 logo（不重启也丢）。
- 「后端为唯一真相」的正确落地：**后端值在合并时优先**（`{...local, ...backend}`），本地层留作
  兜底；要删本地层必须先让**每个窗口**都拿到后端全量（见 `bootstrapSessionEmojis()`：
  启动时 push-only 迁移 + 全量 RPC 灌入，两步都非破坏）。
- 后端层的**唯一生产者**曾是带筛选的 AI Sessions 列表响应（`limit: 200` + 项目/日期过滤）——
  「列表响应顺带喂 store」只能算增量来源，任何需要全量语义的层必须有独立的全量读 RPC
  （`sessionemojipropslist`）。
- 空串陷阱：`opts.x ?? fallback` 在 `x === ""` 时不回落（`""` 非 nullish）。调用方习惯传
  `a || b || ""` 时，可选链合并会让 meta 兜底静默失效（`getAgentIcon` 的 `agent:sessionid`
  回归）。写「带兜底」的函数先想空串。
- 回归判据（单测）：`session-persona-store.test.ts`（迁移后 key 仍在 + bootstrap 全量灌入 +
  RPC 失败保层）与 `agent-logo.test.ts`（`sessionId: ""` 回落 meta）。

## 渲染期读 WaveObj 必须订阅 atom：`getObjectValue` 是一次性快照（2026-11-20, task 11-20-tab-info-card-freshness）

`WOS.getObjectValue(oref)` 只做一次 `globalStore.get`，**不建立任何订阅**。渲染周期内会持续
存在的组件（悬浮卡、列表行、面板）用它读数据，等于把「打开那一刻的快照」当成数据源：

- 首次访问该 oref 时 atom 值常是 `null`（fetch 才刚发出）→ 该块被分类成 `other`/`terminal`，
  数据毫秒后到位但没人触发重渲染 —— 用户必须关掉重开才看到正确信息（Tab 悬浮卡
  「非激活 Tab agent 信息不准确」事故的根因，design/plans/tab-info-card-stale-20261120.md）。
- 打开期间的 `waveobj:update`（meta 变化、块增删）同样被忽略。

硬约束：

- **渲染期组件读 tab/block/workspace 一律走订阅**：`env.wos.useWaveObjectValue(oref)`，或
  「按 key 缓存的派生 atom + `useAtomValue`」（块数量可变时必须用后者，逐块 hook 会破坏
  hooks 稳定性；缓存见 `getTabCardDataAtom`/`getTabMoreMetaAtom`/`TabAgentStatusDotAtomCache`
  的同型实现，**缓存 key 必须稳定**，否则 useAtomValue dep 抖动 → 重渲染风暴）。
- `getObjectValue` 只许用于一次性场景（事件 handler、非渲染的即时判断、jotai atom 内部
  的同步读）。
- 「一个 Tab 有哪些 block」= `tab.blockids` + 各块 `subblockids`，用共享纯函数
  `frontend/app/tab/tab-block-collect.ts#expandBlockIdsWithSubblocks`，不要在任何消费面
  自写展开（顶部状态点 / 「更多」菜单 / Tab 悬浮卡三面曾各写一套，漂移成「状态点亮着、
  悬浮卡说没有 agent」）。

### dom 测试 mock 单例时的坑（本次新增两条）

- mock `getInstance()` 类单例**必须返回稳定引用**（模块级常量对象）。每次调用返回新对象，
  会让组件里 `useEffect([store, blockId])` 的 dep 每渲染都变 → effect 重跑 → setState →
  再渲染，形成**同步死循环**（vitest 无输出直接 hang，连 timeout 都触发不了 —— 事件循环
  被占死）。症状记法：`RUN` 后无任何输出、`--testTimeout` 无效。
- `vi.mock` 工厂会被提升到模块顶部，**不能引用模块级变量**（`fakeT`、`fakeStatusStore`
  都要在工厂内部定义，或放到 `vi.hoisted`）。

## React 里的「状态翻转 → 过渡动画」别用 effect 后挂类名；要常驻手感的地方用 WAAPI 一次性动画（2026-11-20, task 11-20-commontext-compose-polish）

「点编辑器缓慢展开」这类**由 React 状态翻转驱动**的高度过渡，CSS transition 挂在 effect 里
是跑不起来的：React 先把状态提交进 DOM（高度已经变成目标值），effect 才去挂
`transition` 类名 —— 那时**已无值可插值**。反过来把 transition 常驻在元素上，又会把用户
手动拖拽（textarea `resize-y`）的每一帧缓动掉，变成「跟不上手」的糊跟随。

正解（`commontext-compose-modal.tsx` 的 `setEditorExpandedAnimated` / `animateEditorHeight`）：

- 在**事件处理器里**先实测 `el.offsetHeight` 存下 `fromPx`，再 setState；
- 下一帧（React 已提交）实测 `toPx`，用 `el.animate?.([{height: fromPx}, {height: toPx}], {duration, easing})`
  播一次；动画结束自动释放，不污染后续拖拽/布局。
- 两个兜底必带：`prefers-reduced-motion: reduce` 直接跳过；`el.animate?.` 可选链
  （jsdom / 老运行时没有 WAAPI，降级为直切而不是报错）。

## app 根级全屏 fixed 层的 z-index 会压过弹窗壳：新弹窗打开前要收口（2026-11-20, task 11-20-commontext-compose-polish）

`.modal-wrapper` 的 `--zindex-modal-wrapper` 只有 **500**，而 `.markdown-emoji-backdrop`
（`position:fixed; inset:0; z-index:10019`）这类全屏点击拦截层高于它。agent emoji picker 的
全局单例状态放在 `agent-persona/picker-host.ts` 的模块级 `pickerSnapshot`，能活过打开它的
表面；残留时整个弹窗「看得见、点不动」，用户只能切 Tab 重挂树才恢复。

- 任何「打开新弹窗」的入口，都要先关掉可能残留的 app 根级全屏层
  （`handleOpen` 里 `closeAgentEmojiPicker()` 即此模式）。
- 新写全屏 backdrop 时自问一句：它的 z-index 是否高于 modal 壳、有没有不依赖外点 dismiss
  的兜底关闭（表面 unmount / 打开其他弹窗时）。

## Overview 看板卡：属性行的「隐藏名字」判定只能在模型层（2026-11-22, task 11-22-overview-agent-card-hierarchy）

看板卡与列表行各有一份属性行渲染（`overview-board.tsx` 的 `card-props` 与 `session-overview.tsx` 的
`RowMetaChips`），但**"哪些属性不值得显示名字"只允许在 `resolveBoardPropRows` 里判定一次**，写进
`BoardPropRow.hideName`：

- `select / status / person / relation / multi_select`：值本身自解释（色胶囊 / chips）→ `hideName: true`；
- `text / number / url / date / checkbox`：去掉名字就读不懂 → `hideName: false`；
- 名字不丢：两处渲染都保留 `title="名字: 值"`。

第二份判定（各面自己 `if (type === "select")`）会立刻让卡片与列表行两副口径，改规则时只改模型层。

同一任务里另一条同源规则：**卡面已经表达的属性不再占属性行** —— `BoardBuiltinPropKeys` 现已包含 `emoji`
（卡面左上头像就是同一个 emoji），会话属性面板仍可见可编辑。新增"卡面已有同源展示"的属性时，
优先考虑塞进这个集合而不是在渲染层逐个 `if`。

meta 行形状词汇（同一任务）：状态 = 唯一彩色胶囊；agent 类型 = 品牌标（`getAgentLogoByProvider`，品牌色只上图标）
+ 名称；项目 = folder 图标 + 名称；标签 = 迷你方片（radius 4、无色描边）。四类信息不得共用同一种胶囊几何。

---

## 弹窗 = 全仓唯一外壳 + modalOpen 仲裁（2026-11-23, task 11-23-commontext-modal-focus）

「焦点丢了、打不进字、切 Tab 再切回来才好」这类问题，先分清**三层**，不要再去改输入框内部：

1. **DOM 层**——焦点掉到 `body`。`atoms.modalOpen` 是 `keymodel.shouldDispatchToBlock` 与
   `block.tsx focusFromPointerEnter` 的唯一开关；它以前只由 `ModalsRenderer` 写，导致
   直接渲染 `<Modal>` 的弹窗（CommonText compose、AgentCardModal…）打开时它仍是 `false`：
   焦点一掉到 body，按键就被派发给背后的聚焦块（终端会把字符写进 shell）。
   **契约**：任何弹窗都经 `modal-open-registry`（`useModalOpenSource` / `setModalOpenSource`）
   登记，atom 只由 `app.tsx` 的 `bindModalOpenSink` 写；直接 `globalStore.set(atoms.modalOpen, …)`
   视为违规（多来源会互相覆盖）。新增 `<Modal>` 用法无需额外接线，外壳已登记。
2. **外壳层**——`.modal-wrapper` 是铺满视口（含顶部 36px tab 栏）的固定层。它默认 `pointer-events:auto`，
   会把 tab 栏与一切「弹窗外」区域吞掉：命中元素是 wrapper、既不切 Tab 也把输入框焦点 blur 到 body。
   **契约**：wrapper `pointer-events:none`，`.modal` 与 `.modal-backdrop` 显式 `auto`；
   不要再加全屏吃点击的遮罩层（见 SplitButton 注释里的层叠陷阱）。
   即使外壳修好，弹窗内仍有非可聚焦死区（页脚空白、属性行、内边距）→ 需要「失焦回收」：
   `onFocusCapture` 记最后可编辑元素，`onBlurCapture` 只在 `event.relatedTarget == null`
   且 `document.activeElement === body` 时 rAF 回焦。焦点在弹窗内控件间移动不得干预。
3. **窗口层**——每个 Tab 是独立 `WebContentsView`，它会在切换/回焦时莫名丢 webContents 焦点：
   DOM 的 `activeElement` 仍是输入框、但键入收不到、点击也不出光标。**只有** `webContents.focus()`
   能修，所以「切 Tab 再切回来」才是有效绕行。emain 里补 focus 的唯一出口是
   `refocusActiveTabWebContents()`（0/10/30ms 三拍），`setActiveTab` 与 `on("focus")` 共用；
   判定走纯函数 `shouldRefocusActiveView`（已聚焦/relaunching/无视图时不补，避免抢 DevTools 焦点）。

判别法（10 秒）：出问题时先点输入框——**有光标 = DOM 层；无光标且切 Tab 才恢复 = 窗口层**。
合成期（IME）另有一条：受控 textarea 在合成中被 effect 改写 `value` 会打断合成、光标丢，
所以「联动 effect 重置详情字段」必须用 `compositionstart/end`（end 走 rAF）门控。

## Agent 文本注入：只有一条合法路径（2026-11-23）

向 agent 块注入文本**必须**走 `AgentSendCommand`（后端：就绪门 → bracketed paste → 回车 →
`confirmSubmit` 补回车确认 → 三段回执）。

- **禁止**前端「`terminal.paste` + 固定延迟 `submitTermInput`」再用到 agent 块：agent TUI 冷启动
  （pi `npm view`、codex `npm install -g`）会吞回车，文字留在输入框且**没有任何失败信号**
  （2026-11-23 CommonText create 路径实测丢消息）。
- `commontext/pending-input.ts` 仅保留给**远端**块（后端 agentsend 拒绝远端）；本地 create/existing
  两条路径都必须走 `AgentSendCommand`，`wait:true, waitms:120000`（冷启动 40s+）。
- 发送结果必须按 `submitconfirmed` 判定成败；不要只看 RPC 是否返回、更不能只看回执 `state=confirmed`。
