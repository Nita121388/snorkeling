# Grok Build「点哪里编辑哪里」调研与 Snorkeling 实现方案

> 调研日期：2026-08-15
> 调研对象：SpaceXAI「Grok Build」（`xai-org/grok-build`，`grok` CLI/TUI，Apache-2.0，25k+ stars）
> 结论：输入框层面的「点哪里编辑哪里」在 Snorkeling（Electron + React 原生 textarea）里**已天然具备，零开发**；真正有增值空间的是「双击历史消息原地编辑并重提交」，Snorkeling 目前没有，可低成本实现。

---

## 一、Grok Build 是什么

- SpaceXAI（xAI）的 **terminal-based AI coding agent**，99.6% Rust，2026-07-14 开源（Apache-2.0）。
- 运行形态：全屏 TUI（`xai-grok-pager`），也可 headless（脚本/CI）或经 ACP 嵌入编辑器。
- 与 Claude Code / Codex CLI 同类；卖点之一是 **Fullscreen, mouse interactive**。
- 默认模型 grok-4.5，可配置任意 OpenAI 兼容模型。

## 二、传言中的「点哪里编辑哪里」实际指什么

源码实证（`crates/codegen/`）拆出两个不同能力：

### 能力 A：Prompt 输入框的鼠标完整编辑（TUI 层）
用户听到的「输入框点哪里编辑哪里」主要就是它——在**纯终端 TUI 里**用鼠标完成文本编辑：

| 交互 | 实现 |
|---|---|
| 单击定位光标 | `xai-ratatui-textarea/src/textarea.rs` — `buffer_pos_at_screen()` 屏幕坐标→缓冲区位置，处理 wrap 换行、Unicode 宽度、滚动偏移 |
| 双击选词 / 三击选行 | `click_tracker.register(col,row)` 双击/三击识别 |
| 拖选多行 | `Drag(Left)` 拖动 + `drag_beyond_edge` 自动滚动 |
| 长输入滚动 | `effective_scroll()`；滚动条可拖动（`handle_scrollbar_click`） |
| 内容元素点击 | 粘贴大段内容折叠为 chip/元素，点击语义由 host 决定 |

为什么是亮点：**终端 TUI 默认不支持鼠标点选文本**（终端是字符流，点击只是屏幕坐标，程序需自己映射回 buffer）。Grok Build 用自研 ratatui-textarea 做到了。这在 TUI 里稀缺，但在 Web 里是浏览器原生能力。

### 能力 B：双击 scrollback 历史用户消息 → 原地编辑 + 重提交
`crates/codegen/xai-grok-pager/src/app/inline_edit.rs`：
- 双击之前的用户 prompt（或 Enter），在**该消息位置**打开编辑框，改完 Enter = **rewind 会话到该 prompt + 重新提交**；Esc / 无改动退出。
- 配套 `queue_edit.rs`（待运行队列的编辑）。
- ⚠️ **当前被开关关闭**：`inline_edit.rs` 中 `INLINE_EDIT_ENABLED: bool = false`，原因是存在 scroll-jump bug 未解决（见 `x/agottumukkala/inline-edit-scroll-jank.md`）。入口已接线、测试齐备，开关一翻即启用。

## 三、对 Snorkeling 的评估

Snorkeling 是 **Electron + React + Tailwind v4**，AI 输入框是原生 `<textarea>`（`frontend/app/aipanel/aipanelinput.tsx`），会话用 AI SDK `useChat`（`aipanel.tsx`：`messages / sendMessage / setMessages / status`）。

### 1. 输入框「点哪里编辑哪里」（能力 A）→ 已具备，无需开发
原生 `<textarea>` 在 Chromium 里免费提供全部对应交互：
- 单击定位光标、wrap 行点击（含多行输入），双击选词、三击选行、拖选、滚动、IME 中文输入。
- Snorkeling 现有实现已有 `resizeTextarea`（撑高）、composition 处理（中文输入法）、`scrollToBottom` → 体验完整。
- 结论：**需求已被满足**。若想让体验向 Grok「任何字符位置点击即定位」对齐，textarea 已 100% 覆盖该语义，不需要自研编辑器。

> 说明：真正需要实现「点击定位」的只有自绘文本的场景（如 titlebar、自绘标签），Snorkeling 编辑器侧用的是 Monaco，本身点击定位是内建的。

### 2. 历史消息原地编辑重提交（能力 B）→ Snorkeling 目前没有，是真正的增值项
现状：`aimessage.tsx` 的用户消息无编辑/重发入口。
价值：用户在长会话中「改之前的一句话重跑」是最常见诉求；而且 AI SDK `useChat` 已提供 `setMessages`（可截断历史）+ `sendMessage(message, { messageId })`（重发指定 id），**结构性成本低**。

## 四、实现方案（能力 B）

### 交互
- 入口：用户消息 hover 显示「编辑」按钮（比双击更可发现、与 iOS/微信习惯一致）；可选叠加「双击进入编辑」。
- 编辑态：复用 `AIPanelInput` 的 textarea 样式与高度逻辑，在该消息位置就地渲染。
- 提交：
  - **P0（最简）**：编辑后原样追加一条新用户消息发送（不动历史），旧消息保留。零语义风险。
  - **P1（对齐 Grok rewind）**：用 `setMessages(m => m.slice(0, idx+1))` 截断到该消息 → 替换其内容 → `sendMessage(newContent, { messageId })` 重新提交。需确认后端（Go `pkg/aiusechat`）对截断后重发的 chatid/turn 语义无冲突——这是**唯一需要后端验证的点**。

### 文件改动面（估）
| 文件 | 改动 |
|---|---|
| `frontend/app/aipanel/aimessage.tsx` | user 消息 hover 编辑按钮 + 就地编辑态渲染 |
| `frontend/app/aipanel/aipanelinput.tsx` 或新小组件 | 复用 textarea 样式做编辑框（Enter 提交 / Esc 取消 / Cmd+Enter） |
| `frontend/app/aipanel/aipanel.tsx` | 暴露 `setMessages` + `sendMessage(messageId)` 给编辑流程；P1 时做截断逻辑 |
| `frontend/app/aipanel/aimessage.tsx` 附件 | 编辑已带附件消息时处理 file parts（可 P0 禁止改附件，仅改文本） |

### 风险/注意
- IME 中文输入法在就地编辑框的 composition 处理（沿用现有 `isComposingRef` 模式）。
- P1 rewind 需先验证后端 turn 语义（避免出现「截断后重发但后端仍收到全部历史」）。
- 消息 id 稳定（AI SDK `message.id`）是 P1 替换正确性的前提，需在实现时确认 Wave 生成的 id 在会话内不变。

## 五、建议路线

1. **不动输入框**（能力 A 已具备）。
2. **做 P0**：历史消息 hover「编辑」→ 就地改 → 追加重发。工作量约 1 个会话内可完成的小改动（单组件 + 少量状态）。
3. **评估 P1**：先读 `pkg/aiusechat` 的 turn/chatid 语义，能对齐再上 rewind。
4. 可选加分：用户消息 hover「复制」；编辑态一键「重新生成此条」自动在下方补一条。

## 附：调研材料
- GitHub `xai-org/grok-build`（main 分支）源码：`crates/codegen/xai-grok-pager/src/app/inline_edit.rs`、`crates/codegen/xai-grok-pager/src/views/prompt_widget/mod.rs`、`crates/codegen/xai-ratatui-textarea/src/textarea.rs`
- 官方文档 `crates/codegen/xai-grok-pager/docs/user-guide/03-keyboard-shortcuts.md`（鼠标支持一节）
- 中文社区：掘金《2 万 Star！Grok Build 开源了》（2026-07-23）