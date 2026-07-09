# 终端嵌入与灵活切换：herdr 分析与 snorkeling 可借鉴点

> 分析日期：2026-07-08
> 对比对象：`~/Primary/projects/herdr`（Rust 终端多路复用器） vs 本仓库 snorkeling（Wave Terminal fork，Electron）
> 范围：澄清"嵌入其他终端"的真实含义，并评估 snorkeling 在"灵活切换终端程序 / 跑 TUI 应用"上的现状与可改进点。

---

## 1. 先纠正"嵌入其他终端"的概念

herdr 与 snorkeling 解决的问题层级不同，"嵌入"在两者语境里指的不是同一件事：

| 项目 | 运行形态 | "嵌入其他终端"所指 |
| --- | --- | --- |
| **herdr** | 终端 TUI（Rust + ratatui，无 GUI） | 在自己内部 pane 里运行任意 shell/agent 子进程（PTY） |
| **snorkeling** | Electron 桌面应用 | 在 block 里嵌入 xterm.js 渲染的终端 |

herdr 的存在哲学恰恰是反 Electron 的（见 herdr `README.md:18`）：

> no gui app, no electron, no mac-only native wrapper. **you see the agent's own terminal, not someone's interpretation of it.**

所以 herdr 的"嵌入"**不是嵌入外部已存在的终端窗口**，而是"自建终端模拟器来承载任意子进程"。两条技术路线平行，不存在谁抄谁的"嵌入"实现。

---

## 2. herdr 的核心机制

herdr 把终端仿真栈每一层都自实现了一遍：

```
PTY 子进程 (portable-pty)
   ↓ 原始字节流
libghostty-vt (vendored Ghostty 的 VT 引擎, Zig 编译为 C ABI)
   ↓ 网格/单元格状态
ratatui 自渲染 (ratatui frame, 而不是 GPU/HTML)
   ↓ ANSI 字节
真实终端 stdout
```

### 关键文件

- **VT 引擎**：`vendor/libghostty-vt/`（vendored 自 ghostty-org），通过 `src/ghostty/bindings.rs`（rust-bindgen 自动生成的 FFI）+ `src/ghostty/mod.rs` 封装出 `Terminal` / `RenderState` / `KeyEncoder` / `MouseEncoder` 等 API。
  - `ghostty/mod.rs:578` `Terminal::write`
  - `ghostty/mod.rs:585` `Terminal::resize`
  - render state dirty 区域查询等
- **PTY 层**：`src/pty/`
  - Unix 用原生 PTY，Windows 用 `portable-pty`
  - `src/pty/actor.rs` 的 `PtyIoActor` 用 tokio mpsc 把读/写/resize 编排为独立线程，`on_read` 回调把字节喂给 ghostty `Terminal::write`
- **Pane 终端**：`src/pane/terminal.rs` 的 `GhosttyPaneTerminal` 持有 `Terminal` + `RenderState` + `KeyEncoder`，处理 OSC、kitty keyboard、kitty graphics、cursor settle 等
- **attach/detach**：server/client 架构 `src/server/` + `src/client/`
  - `herdr` 命令是 client，attach 到后台 server
  - `src/server/handoff.rs` 能在升级时把**活动 PTY 的 fd** 通过 Unix socket 在新旧 server 进程间迁移（`MAX_FDS_PER_HANDOFF = 64`），让前台进程（如 dev server）不中断地在二进制之间搬
  - 这才是 herdr 真正硬核的"嵌入"——用 fd 传递迁移 PTY，比"重启后从 scrollback 重建"强得多
- **agent 检测**：`src/detect/` 读 scrollback 快照识别 blocked/working/done，严格区分"detection buffer"与"user viewport"（用户会滚动）

---

## 3. snorkeling 的现状

Wave 是另一条技术线，是**已完成的"在 Electron 里嵌入终端"**实现：

- `package.json:82-87`：`@xterm/xterm v6` + addon fit/search/serialize/web-links/webgl
- `frontend/app/view/term/`：`termwrap.ts`（xterm 封装 + OSC handler + shell integration）、`term.tsx`、`term-wsh.tsx`、`termtheme.ts`
- `pkg/shellexec/` + `pkg/blockcontroller/shellcontroller.go`：Go 后端的 shell/PTY 管理
- IPC 走 `wshrpc`（自定义 websocket RPC），FE → Go → PTY

也就是说 snorkeling 已经用 xterm.js 把"嵌入终端"做完了，不需要再参考 herdr 的"嵌入"。

---

## 4. "灵活切换终端程序"的现状

用户真实诉求：在 snorkeling 内部运行的不是固定一个 shell，而是能在多个终端程序之间灵活切换（Fish/Nushell/Zsh/PowerShell，甚至带 TUI 的卡牌游戏等终端工具）。

### 4.1 概念区分

| 用户说的"终端" | 实际是什么 | snorkeling 能否直接跑 |
| --- | --- | --- |
| Fish / Nushell / PowerShell / Zsh | **Shell 程序**（命令解释器，无自己窗口） | ✅ 可以，**已支持** |
| "能打牌的终端" 之类 | **带 TUI 的全屏程序**（如 `cards`、`solitaire` TUI、`btop`、`lazygit`） | ✅ 可以，**直接当命令跑**即可 |
| 某个独立 GUI 终端窗口（iTerm2、Wezterm、Ghostty app） | **另一个应用的窗口** | ❌ 不能"嵌入"，那是 OS 窗口 |

snorkeling 是一个 Electron 应用，里面那个 block 是一个 PTY + 一个 xterm.js。它不关心 PTY 里跑的是 shell 还是 TUI 卡牌游戏——只要那个程序接管屏幕（alternate screen、ANSI 光标）xterm.js 就会正确渲染。所以"灵活切换"在 Wave 这里的本质是：**让用户能指定 block 里 spawn 的可执行文件路径**。

### 4.2 既有能力（无需改架构）

**全局默认 shell**（`schema/settings.json:203`）：

```jsonc
"term:localshellpath": "/usr/bin/fish",      // 想换成哪个就填哪个
"term:localshellopts": ["--login", "--interactive"]
```

对应 Go 端 `shellexec.CommandOptsType.ShellPath / ShellOpts`，并通过 `GetShellTypeFromShellPath` 自动识别成 bash/zsh/fish/pwsh/cmd，分别注入对应的 rc 文件、prompt marker、token-swap 逻辑（`pkg/util/shellutil/shellutil.go:70-74` 的常量）。

**每个 block 也能单独指定**（`pkg/waveobj/wtypemeta.go:123-124`）：

```go
TermLocalShellPath string   `json:"term:localshellpath,omitempty"`
TermLocalShellOpts []string `json:"term:localshellopts,omitempty"`
```

架构上已经允许"左 block 跑 zsh、右 block 跑 fish"，只是缺一个 UI 让用户选。

**默认 fallback**只有 `/bin/bash`，并按 `$SHELL` / 平台规则推断（`pkg/util/shellutil/shellutil.go:67`）。

### 4.3 现在能做什么、不能做什么

**已经能做（改 settings，零代码）**

在 `~/.waveterm/config.json`（或 Wave 设置 UI）里把 `term:localshellpath` 设成 `/opt/homebrew/bin/nu`、`/usr/bin/fish`、`pwsh`，新开的 term block 就用那个。也可给单个 block 写 meta `term:localshellpath = <path>`。

**想要"像选下拉那样切换"——需要补的 UI（小工作量）**

前端目前没有让用户在 term block header 上选 shell 的入口。要补的就是这一层皮：

1. 在 `frontend/app/view/term/term-model.ts` 的 `TermBlockModel` 里读 block meta 的 `term:localshellpath`（字段已存在）。
2. 在 block header / 新建 block 菜单加一个 "Shell: [zsh ▾]" 下拉，候选来自一份"已安装 shell 列表"（可调 `which zsh fish nu pwsh` 探测）。
3. 选中后写 block meta `term:localshellpath = <path>`，触发 block 重建（Wave 已有 block-recreate 机制，跟改 `term:theme` 同路径）。

对应 SKILL：`.kilocode/skills/create-view/SKILL.md`（沿用现成 term model）；settings schema 字段已存在，无需 `add-config`。

**想跑"卡牌 TUI"或任何全屏程序——完全不用改 Wave**

直接在已开的 term block 里敲：

```bash
npx cards-tui      # 或 pip install solitaire-tui 之类
```

它会进 alternate screen，xterm.js 自动渲染，退出回 shell。没有任何"嵌入第三方终端"的工作量——TUI 程序对 xterm 来说就是一连串 ANSI 字节，跟跑 `htop` 没区别。

**如果"切换"指的是切换终端模拟器本身（xterm → 别的渲染核）**

这才需要重活：xterm.js 目前是 Wave 唯一的渲染器（`termwrap.ts` 硬编码 `Terminal from "@xterm/xterm"`，配合 webgl/fit/serialize addons）。若要支持"渲染核可插拔"，得抽象一层 `ITermRenderer`、把 term-model 与渲染器解耦、再实现第二个渲染核——这是大重构，且收益不明确：xterm.js 已经能正确渲染几乎所有现存 TUI 程序，切渲染核多半是为了更好的图像协议（kitty graphics、sixel）或字体形变。Wave 的 term block 已经有 `SupportsImageInput = true` 和 OSC 图像路径。

---

## 5. herdr 真正值得 snorkeling 借鉴的三块

直接搬 `libghostty-vt` 到 Wave 不现实——它输出 ANSI / 网格，要再灌回 xterm.js 反而是倒退。但有三块思路值得借鉴：

### A. attach/detach + server/client 分离（最有价值）

herdr 把运行时和渲染分离：`AppState` 是纯数据、`PaneState` / `PaneRuntime` 分开、`compute_view()` 纯渲染，server 持有 PTY、client 只 attach。Wave 目前 block 和 view 绑在 Electron 主进程，**关窗即杀 PTY**。若想让"agent 持续后台运行 + 多窗口 attach 同一终端"，可参考 herdr 的 server 进程化思路，把 PTY 生命周期从 Electron renderer 解耦。

### B. handoff：fd 迁移 PTY

`src/server/handoff.rs` 通过 `SCM_RIGHTS` 在 Unix socket 传递 PTY master fd，升级进程而不杀子进程。Wave 升级或重载时若有"保留前台 dev server"的需求，这是唯一干净的办法。Go 侧实现 `PassFD`（`golang.org/x/sys/unix`）即可，比 JS 侧模拟靠谱。

### C. agent 状态检测

herdr 的 `src/detect/manifests/*.toml` 以显式 AND/OR 门匹配底部 scrollback 文本来识别 Claude/Codex 等的 blocked/working/done，且严格区分 detection buffer 与 user viewport（用户会滚动）。Wave 的 `frontend/app/view/term/osc-handlers.ts` 走的是子进程主动 OSC 上报路线（要求被嵌入方配合）。两者互补：对不上报的 agent（任意 CLI），herdr 那套被动 scrollback 检测可作为兜底。

---

## 6. 结论

- **换 shell / 跑 TUI 程序**：snorkeling 现在就支持。换 shell 改 `term:localshellpath`（可全局可按 block），跑 TUI 程序直接敲命令即可。
- **缺的只是"在 UI 上选 shell 的下拉"**——基础设施全有，补一层皮（约半天工作量，按 `create-view` skill 走）。
- **换底层渲染器（xterm → ghostty/别家）**是大重构、不划算，且与 herdr 的路线无关：herdr 是因为没有 GUI 才自建 VT，Wave 用 xterm.js 已经是更优解。
- herdr 真正值得借鉴的是 **server/client 进程分离、PTY fd 迁移、被动 agent 检测** 三块运行时与检测语义，**不是终端仿真层**。

---

## 附：关键代码定位

### snorkeling

| 用途 | 路径 |
| --- | --- |
| 全局 shell 设置 schema | `schema/settings.json:203` (`term:localshellpath`, `term:localshellopts`) |
| 设置常量 | `pkg/wconfig/metaconsts.go:53-54` |
| 设置结构体 | `pkg/wconfig/settingsconfig.go:125-126` |
| **每 block meta 字段** | `pkg/waveobj/wtypemeta.go:123-124` |
| 命令选项 | `pkg/shellexec/shellexec.go` `CommandOptsType.ShellPath / ShellOpts` |
| Shell 类型识别 | `pkg/util/shellutil/shellutil.go:70-74`, `:473-487` (`GetShellTypeFromShellPath`) |
| 默认 shell fallback | `pkg/util/shellutil/shellutil.go:67` (`DefaultShellPath = "/bin/bash"`) |
| Shell 进程管理 | `pkg/blockcontroller/shellcontroller.go` |
| xterm.js 封装 | `frontend/app/view/term/termwrap.ts` |
| Term block model | `frontend/app/view/term/term-model.ts` |
| OSC 上报 agent 状态 | `frontend/app/view/term/osc-handlers.ts` |

### herdr（参考）

| 用途 | 路径 |
| --- | --- |
| Vendored VT 引擎 | `vendor/libghostty-vt/` |
| VT FFI 绑定 | `src/ghostty/bindings.rs` |
| VT Rust 封装 | `src/ghostty/mod.rs` |
| PTY actor | `src/pty/actor.rs` |
| Pane 终端 | `src/pane/terminal.rs` |
| Server / attach | `src/server/` |
| **PTY fd 迁移** | `src/server/handoff.rs` |
| Agent 检测 manifests | `src/detect/manifests/*.toml` |
