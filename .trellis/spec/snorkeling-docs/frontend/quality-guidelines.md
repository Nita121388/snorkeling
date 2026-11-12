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
