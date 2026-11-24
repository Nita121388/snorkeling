> **Confirmed: 2026-11-24 @nita**

# 终端/AI 面板 agent 路径链接：OSC8 激活 + 脏路径修复 + Search In Files 兜底

> 来源对话：nita 2026-11-24
> 台账包：`F-1124-agent-path-links`（`loop/items/F-1124-agent-path-links.md`）

## Goal

agent（Claude Code / Codex 等）在终端里输出的文件路径经常是**蓝字 + 下划线**，看起来像链接，
但 Ctrl+点击毫无反应；AI 面板里 markdown 链接也会偶尔点不动。用户希望：

1. **看着像链接的，点得动**（要么真的能打开，要么明确告诉用户找不到，不能装死）。
2. agent 的路径写法五花八门（`file///x`、`D:/x/x.html`、`(E://xxxx)`、相对路径、反引号包裹），
   识别链要能兜住这些脏写法。
3. 实在自动识别不出来的，**复用已有的「Search In Files」解析 + stat 验证管线**兜底，
   而不是再写一套猜路径的规则。

## 现状与根因（已核查，非猜测）

| 事实 | 位置 |
|---|---|
| 终端只装了 `WebLinksAddon`，靠正则匹配**明文 URL**（`https?://`、`file://`） | `frontend/app/view/term/termwrap.ts:198` |
| `Terminal.options.linkHandler` **全仓库从未设置**（只有 xterm 的类型声明） | 全仓 grep `linkHandler` |
| xterm 收到 OSC 8 后给单元格打 `urlId`，渲染时 `underlineStyle` 强制返回 5 | `@xterm/xterm` `ExtendedAttrs.underlineStyle` |
| 无 `linkHandler` 时，`OscLinkProvider` 把**非 http(s)** 链接整个丢弃（`allowNonHttpProtocols` 判空） | `@xterm/xterm/lib/xterm.js` `OscLinkProvider` |
| 因此 OSC 8 的 `file://` 链接：样式在、点击/hover/右键全无 | 由上面两条推出 |
| 上一期明确把 OSC-8 推迟 | `docs/answers/terminal-file-url-ctrl-click-20261022-151126.html` §G |

两条已有管线**互补但互不相通**：

- 链接管线（`terminalFilePath` / `normalizeLinkedFilePath`）：认 `file://` URL 与绝对路径，**不识别裸文本**。
- 选区解析器（`parseFileReference`）：认裸盘符路径、相对路径、`:12` 行号、反引号/括号包裹，**不认 `file://` URL**。

实测（真跑 `parseFileReference`）：

| 写法 | 结果 |
|---|---|
| `E:/primary/.../x.html` | ✅ |
| `D:/xxx/xxxx` | ✅（无扩展名→按目录） |
| `(E://xxxx)` | ✅（括号剥掉，双斜杠保留） |
| `src/foo.ts:12` / `docs/a.html` | ✅ |
| `` `E:/.../markdown.tsx` `` | ✅ |
| `E://primary/a.html` | ❌ 盘符后双斜杠 |
| `file:///E:/a.html` | ❌ 选区解析器不认 URL |
| `file///xxxx` | ❌ 两套都不认 |

## Requirements

### R1 终端 OSC 8 链接可激活（P0）

- R1.1 终端注册 `linkHandler`（`allowNonHttpProtocols: true`），OSC 8 链接可 Ctrl/⌘+点击打开。
- R1.2 分流：`file://` → `openNativePath`（`.html` 走浏览器，解析失败退 `openExternal`）；
  `http(s)` → 既有 `openTerminalLink`；`vscode://file/...` → 剥前缀后按本地文件打开；
  其余 scheme（`javascript:` 等）**拒绝**，不打开。
- R1.3 无修饰键点击不打开（与 `WebLinksAddon` 现有约定一致）。
- R1.4 hover / leave 复用现有 `hoveredLinkUri` + `onLinkHover`，使 tooltip 与右键菜单
  （"Open File in Default App" / "Show in Folder"）对 OSC 8 链接同步生效。

### R2 脏路径修复层（P1）

- R2.1 新增纯函数 `repairAgentPathText(raw)`：剥包裹符（`()` `[]` `{}` `<>` 反引号 引号 中文括号/书名号）、
  去尾部标点、`file:?//+` → `file:///`、盘符后 `//` → `/`、`\` → `/`、`vscode://file/` → 本地路径、安全百分号解码。
- R2.2 新增 `parseAgentPathRef(raw)`：修复后判定 kind（`file` / `http` / `other`），
  `file` 分支给出 native 路径（复用 `term-file-url.ts` 的 `terminalFilePath` 语义）；
  解析不出 scheme 时把修复后的文本交给 `parseFileReference` 补行号。
- R2.3 纯函数、无 Electron 依赖，可单测；不得复制 `terminalFilePath` 的路径规则（同一套规则只能有一份）。

### R3 打开失败兜底到 Search In Files 管线（P1.5）

- R3.1 新增 `openAgentPathRef(raw, opts)`：① 链接管线（`normalizeLinkedFilePath` → preview）→
  ② `parseFileReference` + `searchSelectionInFiles`（跨 Tab Files 树 + stat 验证）→ ③ 返回 `none` 交调用方。
- R3.2 接入点：AI 面板 markdown 链接（`element/markdown.tsx` 的 `Link`、`element/streamdown.tsx` 的 `Link`）
  在预览打开失败后先走兜底，再退 `openLink`；终端 `linkHandler.activate` 在 `file://` 打不开时同样走兜底。
- R3.3 反馈：`searchSelectionInFiles` 已有 `onFeedback`；终端场景传轻提示通道，
  **禁止** `window.alert`，找不到就静默（不阻塞输入）。
- R3.4 不重写 `selection-reference-parser.ts`；只在它前面加修复层。

### 不做什么

- **不做裸路径自动上色**（原 P2）：误判面大（`1.5/2`、`and/or`），本期只在用户点击/选区时识别。
- 不改 xterm 渲染，不去掉 urlId 强加的下划线（拦截 OSC 8 才能关，收益低风险高）。
- 不改 `selection-search-in-files.ts` 的查找/打分算法（除非只加导出）。
- 不做真机 CDP 验证（用户 2026-11-24 明确：本机性能差，以后有空再验），真机项记入 `docs/project/verify-ledger.md` 的待办而不是门禁。
- 不做发版（releaseCandidate: false）。

## Acceptance Criteria（机器可判，`queue prove` 逐条采数）

- [ ] `cmd /c "npx vitest run frontend/app/view/term/term-link-handler.test.ts >nul 2>&1 && echo TLH_OK"` → `TLH_OK`
- [ ] `cmd /c "npx vitest run frontend/app/element/agent-path-ref.test.ts frontend/app/element/agent-path-open.test.ts >nul 2>&1 && echo PATH_REF_OK"` → `PATH_REF_OK`
- [ ] `cmd /c "npx vitest run frontend/app/view/term >nul 2>&1 && echo TERM_SUITE_OK"` → `TERM_SUITE_OK`（终端既有用例不回归）
- [ ] `cmd /c "npx eslint frontend/app/view/term frontend/app/element frontend/app/view/preview >nul 2>&1 && echo ESLINT_OK"` → `ESLINT_OK`
- [ ] 红证：`loop/red/F-1124-agent-path-links.txt`（对现状必红的测试输出）
- [ ] 越界文件 0 处（只改 `touch` 白名单内的路径）

## Notes

- 白名单见台账包 `touch`；`frontend/app/element/selection-search-in-files.ts` **不在**白名单内
  （本期只调用它，不改它；确需改动先 park 说明）。
- 真机验证（真窗口 Ctrl+点击、右键菜单、tooltip）留待后续：本机性能不足，
  验收以单测 + 类型/静态检查为准，人工抽查由 nita 自行决定时机。
