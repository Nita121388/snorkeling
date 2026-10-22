# Design — 终端 file:// 链接识别与默认程序打开

## 1. 边界

- 只改前端 terminal 层：链接识别、提示气泡、右键菜单。
- 不改 Electron 主进程：`open-native-path`（`emain/emain-ipc.ts:634` → `electron.shell.openPath`）已提供"用默认程序打开"。
- 不改 Go 后端，不改 IPC 协议。

## 2. 新增模块 `frontend/app/view/term/term-file-url.ts`

单一职责：终端链接的协议判定与 `file://` → 原生路径解析。

导出：

| 导出 | 用途 |
| --- | --- |
| `TerminalLinkRegex` | 传给 `WebLinksAddon` 的 `urlRegex`（不含 `g` flag） |
| `isFileUrl(uri)` | 协议判定 |
| `fileUrlToNativePath(uri)` | `file://` → 原生路径，失败返回 `null` |
| `terminalLinkHint(uri, modKey)` | 提示气泡文案（纯函数，可单测） |

### 2.1 `fileUrlToNativePath` 规则

基于 `new URL()` 实测结果：

| 输入 | hostname | pathname | 输出 |
| --- | --- | --- | --- |
| `file:///E:/code/x` | `""` | `/E:/code/x` | `E:/code/x` |
| `file:///C:/dir%20name/f.txt` | `""` | `/C:/dir%20name/f.txt` | `C:/dir name/f.txt` |
| `file:///home/me/a.txt` | `""` | `/home/me/a.txt` | `/home/me/a.txt` |
| `file://server/share/x.txt` | `server` | `/share/x.txt` | `\\server\share\x.txt` |
| `https://example.com` | — | — | `null` |

规则：

1. `new URL(uri)` 抛错 → `null`。
2. `protocol !== "file:"` → `null`。
3. `decodeURIComponent(pathname)`；`+` 不解码（符合 file URL 语义）。
4. hostname 非空且不是 `localhost` → UNC：`\\` + hostname + pathname（正斜杠转反斜杠）。
5. pathname 匹配 `^/[A-Za-z]:` → 去掉首斜杠，反斜杠转正斜杠（Windows 盘符）。
6. 其余 → POSIX 路径原样返回。

## 3. 链接识别正则

`WebLinksAddon` 的 `urlRegex` 由我们提供（`node_modules/@xterm/addon-web-links` 内置正则只认 `https?://`）。

- http(s) 分支：沿用内置语义 `https?|HTTPS?` + `://`。
- 新增 file 分支：`file:[/]{2,3}`。
- 两分支共用 body 与尾字符类（与内置正则一致）：
  - body = `[^\s"'!*(){}|\\^<>`]*`
  - tail = `[^\s"':,.!?{}|\\^~\[\]`()<>]`（末尾标点不并入链接）
- 前置否定回顾 `(?<![A-Za-z0-9+.-])`，避免 `profile://`、`my-file://` 命中。
- **不带 `g` flag**：addon 内部执行 `new RegExp(source, flags + "g")`，带 `g` 会变成 `gg` 并抛 `SyntaxError`。
- 回顾断言需要 Chromium ≥ 62 / V8 ≥ 6.2，Electron 与 Node 均满足。

## 4. 激活分流（`termwrap.ts`）

```
activate(e, uri):
  mod = mac ? e.metaKey : e.ctrlKey
  if (!mod) return
  if isFileUrl(uri):
      p = fileUrlToNativePath(uri)
      p ? openNativePath(p) : openExternal(uri)
  else:
      openTerminalLink(uri)
```

- macOS 的 ⌘+点击与其它平台的 Ctrl+点击保持现状。
- 无修饰键的普通点击不打开（现状如此）。

## 5. 提示气泡（`term-tooltip.tsx`）

- `TermLinkTooltip` 增加 hovered URI 状态，文案由 `terminalLinkHint(uri, modKey)` 决定：
  - http(s) → `Ctrl-click to open link`（保持现状文案）
  - file → `Ctrl-click to open in default app`
- 皮肤改为主题变量（tailwind 任意值写法，代码库已有先例）：
  - 背景 `bg-[var(--overlay-bg-color)]`
  - 文字 `text-[var(--main-text-color)]`
  - 边框 `border border-[var(--border-color)]`
  - 阴影 `shadow-[0_8px_24px_var(--modal-shadow-color)]`
- 四个变量在 dark / light / monochrome 三套主题中都有定义（`frontend/app/theme.scss`）。

## 6. 右键菜单（`term-model.ts` `getContextMenuItems`）

hoveredLinkUri 为 `file:` 时，菜单项替换为：

| 菜单项 | 行为 |
| --- | --- |
| Open file in default app | `getApi().openNativePath(nativePath)` |
| Show in Folder | `getApi().revealNativePath(nativePath)` |

http(s) 分支保留现有"Open URL"与"Open URL in External Browser"两项。

## 7. OSC 7 复用

`handleOsc7Command` 改为调用 `fileUrlToNativePath(data)`，输出约定保持不变：Windows 盘符路径用正斜杠，UNC 保留反斜杠。现有 `osc-handlers.test.ts` 覆盖该行为。

## 8. 兼容性与回滚

- 纯前端改动，不涉及协议与后端。
- 回滚 = revert `term-file-url.ts`、`term-file-url.test.ts`、`termwrap.ts`、`term-tooltip.tsx`、`term-model.ts`、`osc-handlers.ts`。
- 唯一共享面是 `WebLinksAddon` 实例的正则：http(s) 分支语义保持不变，file 分支为新增，误命中面被协议边界与修饰键限制。

## 9. 取舍

| 备选 | 结论 | 原因 |
| --- | --- | --- |
| 自建 xterm `ILinkProvider` | 不采用 | 需自己处理换行缓冲与 CJK 宽度，复用 addon 更稳 |
| 识别纯 Windows 路径 | 本期不做 | 普通输出里 `E:\...` 误判概率高，另开任务 |
| `shell.openExternal(file://...)` | 不采用 | 不能保证走系统默认程序，Windows 上行为不稳 |
| 新增 Electron IPC | 不采用 | `open-native-path` 已满足"默认程序打开" |
