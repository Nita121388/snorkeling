# TUI 输入框「点击定位」接入调研：pi / codex / Snorkeling 宿主

> 调研日期：2026-08-15
> 主题：给开源 CLI agent（pi / codex）补上 Grok Build 式「点哪里编辑哪里」，供宿主任意终端（含 Snorkeling）直接受益。
> 结论：**两家的自研输入框组件都已具备 90% 素材，缺口是「鼠标事件接入 + 坐标映射」两个小段代码。pi 增量最小（协议已开），codex 需先决策「应用鼠标启用后的拖选复制策略」。**

## 0. 实现模式（从 Grok Build 提炼的四个必备件）

| # | 必备件 | 说明 |
|---|---|---|
| 1 | 应用层启用鼠标协议 | 发送 DECSET 1000/1002/1003/1006 → 终端把点击/拖动/滚动转成 SGR 序列发给程序 |
| 2 | 事件路由 | 应用事件循环增加 Mouse 分支 → 命中测试输入框区域 |
| 3 | 坐标映射 | 屏幕坐标 → 输入框 buffer 位置（区域偏移、wrap 行、滚动偏移、宽字符/emoji 显示宽度↔字符索引） |
| 4 | 交互细化 | 单击定位 / 双击选词 / 拖选 + **处理「应用鼠标接管后终端原生选择复制失效」**（程序自实现拖选 + OSC 52 复制） |

## 1. 三家现状（本机二进制 + 源码核查，2026-08-15）

### Grok Build（xai-org/grok-build，已开源）
- ✅ 四件套全齐：`xai-ratatui-textarea` 的 `buffer_pos_at_screen()`（屏幕→buffer）、`click_tracker`（双击/三击）、拖选自动滚动、滚动条拖动。
- 参考价值：实现范式本身（其 crate Apache-2.0，可直接被其他 ratatui 生态借用）。

### Pi（@earendil-works/pi-tui，本机 0.84）
- ✅ **协议已开**：`tui-alt-screen.js` `ENABLE_BUTTON_MOTION_MOUSE = "\x1b[?1000h\x1b[?1002h\x1b[?1004h\x1b[?1006h"`；已实现滚轮滚动、拖选复制（OSC 52）、右键粘贴、滚动条。
- ✅ **布局系统有 box**：`layout.js layoutComponent()` 计算每个组件屏幕 rect（box.parent/clip），组件坐标不缺失。
- ✅ **Editor 有布局行**：`components/editor.js` `Editor.layoutText()` 产出 layoutLines（text/hasCursor/cursorPos），含 word-wrap 分块、`scrollOffset` 内部滚动、`visibleWidth/segment/grapheme` 工具、`CURSOR_MARKER` 定位硬件光标（IME）。
- ❌ **输入框组件无鼠标处理**：`components/editor.js` 无 mouse；`tui-alt-screen.js` 鼠标分发只做右键粘贴/滚动条/拖选，**无组件级点击路由**。
- 接入增量：① `tui-alt-screen` 鼠标 down 先路由给 focused editor（~15-25 行）；② `Editor` 加 `handleMouse(col,row,box)`：box 相对行 → 命中 layoutLine（含 scrollOffset）→ 按 visibleWidth 找 grapheme → `cursorLine/cursorCol`（~40-60 行）；③ autocomplete 列表命中后可后补。**合计 ~60-90 行 + 测试，风险低**（不触碰已工作的滚轮/拖选）。

### Codex CLI（codex-rs，本机 0.147.0）
- ❌ **协议未开、事件模型无 Mouse**：`tui.rs` `TuiEvent` 仅 Key/Paste/Resize/Draw/Resume；二进制约无 mouse 字符串。
- ✅ **TextArea 已有反向映射核心**：`bottom_pane/textarea.rs`：
  - `cursor_pos_with_state()`（buffer→屏幕，正向）
  - `wrapped_lines(width)` + `effective_scroll()`（wrap 行 + 内部滚动）
  - **`move_to_display_col_on_line(line_start, line_end, target_col)`** —— 目标显示列 → buffer 位置（按 `display_width`/`grapheme_indices` 换算，还带 `clamp_pos_to_nearest_boundary` 元素边界吸附）= 点击定位的主干逻辑已存在
  - vim 模式（`textarea/vim.rs`）同样走该光标模型
- 接入增量：① `tui.rs`/`app.rs` 事件模型加 Mouse + `enable_mouse_capture()`（~20 行）；② `TextArea::handle_mouse(area,col,row)` 复用上述逻辑（~40-60 行）；③ **需决策全局策略**：应用鼠标接管后「拖选复制」怎么办（自实现，参考 pi/Grok；或仅输入框聚焦时启用）——这是 codex 改动里唯一需要产品决策的点。**合计 ~80-120 行 + 测试，中等**（涉输入事件全局回归：粘贴/vi 模式/IME 原则上无碍）。

## 2. 难点共性

1. **应用鼠标接管 vs 终端原生选择复制**：DECSET 一旦启用，整个终端视图的拖选都不再走浏览器/终端原生路径，必须程序自实现选区 + OSC 52 复制。pi 已趟过这条路（拖选已工作），codex 要照做或按区域启用。
2. **坐标→buffer 正确性**：word-wrap 分块、emoji/中文字符宽度（`display_width`/`visibleWidth`）、粘贴折叠块（pi 的 `[paste #N]` marker 需 `segmentWithMarkers` 对齐）——两家工具链已具备，属"细心实现"不是"从零发明"。
3. **IME**：鼠标事件与 IME 组合互不干扰（pi 已有 `CURSOR_MARKER` 给硬件光标定位，输入框聚焦时 IME 候选窗位置由硬件光标给出）。

## 3. 对 Snorkeling 的意义与路线建议

- **Snorkeling 宿主零改动**：xterm.js 完整支持应用鼠标协议（`term.tsx` 已用 `terminal.modes.mouseTrackingMode`），agent 一侧开了鼠标，点击/滚动自动生效。
- **可立即做（宿主侧 0 成本）**：用 CDP/终端实测 grok CLI（若有 xAI 账号）与 pi 在 Snorkeling 的滚轮/拖选/（grok 的）点击定位表现，形成验收基线。
- **落地优先级**：
  1. **给 pi 提 PR**（增量最小、协议已开、社区活跃，收益是 pi 在任意终端都能点哪里编辑哪里）；
  2. **codex 提 PR 或本地 patch**（先决策拖选复制策略）；
  3. Claude Code：闭源，等待上游（当前 2.1.226 无鼠标）。
- **pid 到长期观察**：所有自研 TUI 的 agent（grok-build / pi / codex）都在朝「全鼠标交互」演进，Snorkeling 的 xterm 层应保持鼠标协议透传不被样式层拦截。

## 4. 材料
- Grok Build：`crates/codegen/xai-ratatui-textarea/src/textarea.rs`（handle_mouse / buffer_pos_at_screen / click_tracker）
- Pi：`@earendil-works/pi-tui@0.84.0` `dist/tui-alt-screen.js`、`dist/components/editor.js`、`dist/layout.js`；pi-coding-agent `dist/modes/interactive/components/custom-editor.js`（composer=CustomEditor）
- Codex：`openai/codex` `codex-rs/crates/codex-tui`（`tui/src/bottom_pane/textarea.rs`、`chat_composer.rs`、`tui.rs` TuiEvent）