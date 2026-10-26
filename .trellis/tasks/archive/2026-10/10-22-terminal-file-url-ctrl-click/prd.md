# 终端 file:// 链接支持 Ctrl+点击用默认程序打开

## Goal

agent TUI 打印的 `file://` URL 要像 http(s) 链接一样被识别、hover 出引导提示，Ctrl/⌘+点击后用系统默认程序打开该文件；同时修掉终端链接提示气泡在浅色主题下不可读的问题。

## Background（已核查的事实）

- `frontend/app/view/term/termwrap.ts:197` 只装载 `WebLinksAddon`，其默认正则只匹配 `https?://`，所以终端里打印的 `file://` 文本根本不是链接，Ctrl+点击无反应。
- 现有"引导打开"通道已存在：hover → `TermLinkTooltip`（`frontend/app/view/term/term-tooltip.tsx:93`）显示 `Ctrl-click to open link`；Ctrl/⌘+点击 → `openTerminalLink`（`frontend/app/store/global.ts:597`）→ 内部 web block 或外部浏览器。
- "用默认程序打开"的通道也已存在：`getApi().openNativePath(path)`（`frontend/types/custom.d.ts:151`）→ `open-native-path` → `electron.shell.openPath`（`emain/emain-ipc.ts:634`）。
- `file://` → 原生路径的解析规则已存在于 OSC 7 处理（`frontend/app/view/term/osc-handlers.ts:309`），可复用。
- 浅色主题病根：`frontend/app/view/term/term-tooltip.tsx:58` 写死 `bg-zinc-800/70` 与 `text-secondary`（浅色主题下 = `#675033` 深棕），深底深字几乎不可读。

## Requirements

### R1 链接识别

- 终端输出中的 `file://` 绝对路径 URL 必须被识别为链接，含中文与百分号编码。
- `profile://` 这类同后缀文本不得被识别为链接。
- 链接末尾的标点不并入链接。
- http(s) 链接的识别与打开行为保持不变。

### R2 打开行为

- Ctrl/⌘+点击 `file://` 链接时，用系统默认程序打开该文件（`.html` → 浏览器）。
- macOS 用 ⌘+点击，Windows/Linux 用 Ctrl+点击；无修饰键的普通点击不打开。
- 解析失败时不得抛出未捕获异常，退化为用系统浏览器打开该 URL。
- 目标文件不存在时不得弹窗打断用户。

### R3 引导提示

- hover `file://` 链接时出现提示气泡，文案表达"用默认程序打开"。
- hover http(s) 链接的文案保持"Ctrl-click to open link"语义。
- 提示气泡在浅色、深色、单色三种主题下均可读：背景、文字、边框、阴影跟随主题变量。

### R4 右键菜单

- 右键 `file://` 链接时提供"用默认程序打开"与"在文件夹中显示"。
- 右键 http(s) 链接的菜单项保持不变。

### R5 复用与边界

- `file://` → 原生路径的解析只保留一份实现，OSC 7 与链接打开共用。
- 本期不识别纯 Windows 路径（`E:\code\...`），不处理 AI 面板 markdown 链接，不处理 OSC-8 显式超链接。

## Acceptance Criteria

- [ ] 终端打印 `file:///E:/code/snorkeling/docs/answers/vcs-中文路径乱码-20261022-145411.html` 后，该文本是链接，hover 出现提示气泡。
- [ ] Ctrl+点击该链接后，系统默认浏览器打开该 html。
- [ ] `profile://example.com/x` 不被识别为链接。
- [ ] 链接末尾的 `.`、`,` 不并入链接。
- [ ] http(s) 链接的 hover 提示与 Ctrl+点击行为与改动前一致。
- [ ] 浅色主题下提示气泡为浅底深字，深色主题下为深底浅字。
- [ ] 右键 `file://` 链接出现"用默认程序打开"和"在文件夹中显示"。
- [ ] OSC 7 的 cwd 上报行为不变。
- [ ] `frontend/app/view/term/term-file-url.test.ts` 通过；`npx vitest run frontend/app/view/term` 全绿。
- [ ] `npx tsc --noEmit -p tsconfig.json` 与 eslint 无新增错误。

## Notes

- 决策（用户已确认"go on"）：本期只做 `file://` URL；右键菜单同时加"在文件夹中显示"。
- 影响面分析（GitNexus）：`TermWrap` 类为 CRITICAL（25 个直接依赖方），改动集中在构造函数内新增正则与协议分支，不改公开 API；`TermLinkTooltip` / `handleOsc7Command` / `getContextMenuItems` 均为 LOW。
- 详细技术方案见 `design.md`，执行清单见 `implement.md`。
