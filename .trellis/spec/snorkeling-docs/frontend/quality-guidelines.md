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

## Terminal Block 轻量操作约定 (2026-10-15, task 10-15)

- Header 右上角默认按钮应承载**轻量、高频、无害**操作（如 `Redraw TUI`），不要直接暴露会中断进程的重操作。
- 会中断进程/会话的操作（如 `Restart Shell/Agent`）移入“⋯”菜单，并先经确认弹窗（`RestartConfirmModal`）。
- 新增后端 RPC 时需要同步三处：`pkg/wshrpc/wshrpctypes.go`（接口方法，反射自动注册）、`pkg/wshrpc/wshclient/wshclient.go`（Go client）、`frontend/app/store/wshclientapi.ts`（前端 RpcApi，含 mock 分支）。
- 终端重绘不动进程：前端 `terminal.refresh(0, rows-1)` + 后端对进程组发 SIGWINCH（`unixutil.SignalGroupByName`）；绝不调用 `ControllerDestroyCommand`/`ControllerResyncCommand(forcerestart)`。
- 信号工具优先放 `pkg/util/unixutil`（unix/windows 双实现），不要在业务层直接 `syscall.Kill`。

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
- 只把 `view === "preview" && edit !== true && displayMode === tree` 的块当查找根，root 推导：`preview:explorer-root` → `meta.file`（stat 为目录才认）。
- 远端 connection 的 stat 必须加超时（1.5s）+ 并发限流（4）+ 单次查找内缓存，超时/异常一律当未命中。

---

## Code Review Checklist

<!-- What reviewers should check -->

(To be filled by the team)
