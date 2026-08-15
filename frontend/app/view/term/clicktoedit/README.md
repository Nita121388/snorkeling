# Term Click-to-Edit（宿主层点击合成，实验分支）

> 分支：feat/term-click-to-edit（独立实现，不碰 term.tsx 主体，仅预留挂载点）
> 目标：让不支持鼠标的 CLI agent（codex / pi / opencode 等）的 TUI 输入框获得
> 「点击定位光标」能力——宿主（Snorkeling）层把点击坐标换算成按键序列注入 PTY。

## 为什么做（背景）
- claude fullscreen 自带鼠标输入框（Snorkeling 零改动，xterm 透传即可）
- codex/pi/opencode 无鼠标支持，无法照 claude 路子"提示引导"
- 改第三方上游（PR）是终局，但宿主合成可立即覆盖所有 agent

## 方案（宿主合成）
1. 点击坐标 → xterm 屏幕 buffer（宿主有完全访问权）
2. 目标行/列 vs agent 光标当前位置 → 合成 `Home + Right×N`（或 Up/Down）
3. 注入 PTY → agent 光标移动 → 直接键入即在该处编辑

## 交互（对齐原生 TUI 鼠标直觉）
- **直接单击** agent 输入框/消息区任意位置 = 定位光标到该 cell（无需修饰键）
- **按住拖动** = 保持默认文本选择/复制（松开时有位移则视为拖选，不定位）
- **Cmd/Ctrl+点击** = 同上（保留兼容）
- 仅对 agent 会话生效（claude/anthropic 除外，其 fullscreen 原生支持；非 agent 块不介入）

## 精度预期（待实验量化）
- 单行纯 ASCII：~95%；含宽字符（中/emoji）：~80-85%；多行/vi 模式：~60-75%
- 实验见 `clicktoedit/exp/`（pty + SGR + 光标位置读回）

## 模块边界（不污染 main）
- `clicktoedit/` 本目录：全部新代码 + 实验脚本
- 挂载点：term.tsx 仅加一行组件挂载（合成层不碰现有鼠标/选区逻辑）
