# Markdown 预览 UX 改进方案

## 当前状态概览

核心文件：
- `frontend/app/element/markdown.tsx` — Markdown 渲染 + 内联编辑主组件（5300+ 行）
- `frontend/app/element/markdown.scss` — 所有样式（1585 行）
- `frontend/app/element/block-editor/components/slash-palette.tsx` — 斜杠命令面板
- `frontend/app/element/block-editor/components/emoji-picker.tsx` — Emoji 选择器
- `frontend/app/element/markdown-transform/emoji.ts` — Emoji 目录 + 搜索
- `frontend/app/element/markdown-transform/code-block.ts` — 代码块语言设置
- `frontend/app/element/markdown-util.ts` — 图片语法解析（alt/title/src）

---

## 改动 1：斜杠命令选择后无反应

### 问题分析

`SlashPalette` 的 `onPick` 会调用 `handleSlashPick`（markdown.tsx:3717），该函数调用 `execSlashCommand` 执行命令。可能的根因：

1. `execSlashCommand` 返回 `null`（命令不匹配当前 block kind）
2. `result.type === "open-picker"` 分支中 `handleSlashPickerOpen` 没有正确打开 picker
3. 普通命令的 `handleInlineEditCommit` 调用后 `inlineEdit.dismiss()` 关闭了编辑会话但新内容没有正确提交
4. `refocusCommittedBlock` 在 commit 后尝试重新聚焦但 `detectBlockKind` 返回 null

### 排查方案

- 在 `handleSlashPick` 中添加关键路径 console.log，确认 result 是否为 null
- 确认 `execSlashCommand` 的 `ctx` 参数（text/line/endLine/kind）是否正确
- 确认 `filterSlashCommands` 过滤后的命令是否与当前 block kind 兼容

### 修改点

| 文件 | 改动 |
|------|------|
| `markdown.tsx` `handleSlashPick` | 添加 debug 日志确认 result 和 picker 分支走向 |
| `block-editor/exec.ts` `execSlashCommand` | 确认 text 替换逻辑对当前 session.kind 的处理 |

> **注意**：此项需要先复现问题才能精确定位。我建议先加日志排查，确认根因后再改代码。

---

## 改动 2：Emoji 选择弹窗支持分类展示

### 当前实现

`buildEmojiPickerItems`（emoji.ts:201）已经按 `EMOJI_GROUP_LABELS`（9 个分类）生成带 header 的扁平列表。渲染时 `.markdown-emoji-group` 显示分类标题，但用户需要滚动才能看到不同分类。

### 改进方案

在 EmojiPicker 顶部增加**分类标签栏**（横向可滚动），点击标签快速跳转到对应分类。

### 修改点

| 文件 | 改动 |
|------|------|
| `emoji-picker.tsx` | 新增 `activeCategory` state；顶部渲染分类标签栏（Smileys / People / ... / Flags）；点击标签 scrollIntoView 对应 header |
| `emoji.ts` | 新增 `getEmojiGroupStartIndex(items)` 辅助函数，返回每个 group 在 items 数组中的起始索引 |
| `markdown.scss` | 新增 `.markdown-emoji-categories` 标签栏样式（横向滚动、pill 标签、active 高亮） |

### ASCII 设计图

```
┌─────────────────────────────────┐
│ [😀][👤][🐾][🍔][✈️][⚽][💻][🔔][🏁]  ← 分类标签栏
├─────────────────────────────────┤
│ SMILEYS                         │
│ 😀 😃 😄 😁 😆 😅 🤣 😂 ...     │
│ ...                             │
│ PEOPLE                          │
│ 👋 🤚 🖐️ ✋ ...                  │
└─────────────────────────────────┘
```

---

## 改动 3：代码块语言标签移到左上角 + 增加内边距 + 圆角

### 当前实现

- 语言标签（`.codeblock-lang-badge`）在 `.codeblock-actions` 中，定位在 `top:0; right:0`
- 代码框 `pre.codeblock` 已有 `border-radius: 4px`、`padding: 0.4em 0.7em`
- 用户要求：语言标签移到左上角、增加更多内边距、增加一点圆角

### 修改点

| 文件 | 改动 |
|------|------|
| `markdown.scss` `.codeblock-actions` | 从 `right:0` 改为 `left:0`（语言标签移到左上角） |
| `markdown.scss` `.codeblock` | `padding` 从 `0.4em 0.7em` 增加到 `0.6em 1em`；`border-radius` 从 `4px` 增加到 `6px` |
| `markdown.tsx` `CodeBlock` 组件 | 调整 actions div 的渲染顺序：lang badge 在前，copy/execute 按钮在后（保持右上角） |

### ASCII 设计图（改动后）

```
┌──────────────────────────────────┐
│ [python]              [📋] [▶]  │  ← 语言标签左上，操作按钮右上
│                                  │
│  def hello():                    │  ← 更多内边距
│      print("Hello, World!")      │
│                                  │
└──────────────────────────────────┘
     ↑ 6px 圆角
```

---

## 改动 4：代码块鼠标悬浮 → 右上角折叠按钮 + 代码说明编辑

### 当前实现

- 代码块已有 `.codeblock-actions`（hover 时显示 copy/execute 按钮）
- 没有代码折叠功能
- 没有代码说明（caption）编辑功能

### 改进方案

#### 4a. 代码折叠

在代码块右上角（actions 区域）添加折叠/展开按钮。折叠后只显示语言标签 + "...N lines" 提示，点击展开。

#### 4b. 代码说明编辑

Markdown 的 fenced code block 支持在 ``` 行之后、代码之前添加注释行（如 `// This function handles...`），但更常见的做法是利用 HTML `<figcaption>` 或自定义语法。

**方案**：在代码块下方添加一个可编辑的 "caption" 区域。如果 md 源码中代码块后面紧跟 `<!-- caption: ... -->` 或 `> code description`，则自动显示；否则 hover 时显示 "+ Add description" 按钮。

### 修改点

| 文件 | 改动 |
|------|------|
| `markdown.tsx` `CodeBlock` 组件 | 新增 `collapsed` state + toggle 按钮；折叠时只渲染 header（语言 + 行数 + 展开按钮） |
| `markdown.scss` `.codeblock` | 新增 `.codeblock-collapsed` 样式（高度限制、transition）；新增 `.codeblock-caption` 样式 |
| `markdown-util.ts` | 新增 `extractCodeBlockCaption(text, line)` / `setCodeBlockCaption(text, line, caption)` 纯函数 |

### ASCII 设计图

```
正常状态：
┌──────────────────────────────────┐
│ [python]              [📋] [▶] [∨] │  ← 新增折叠按钮 [∨]
│                                  │
│  def hello():                    │
│      print("Hello, World!")      │
│                                  │
│  ～ This function greets world ～ │  ← 可编辑 caption（hover 显示编辑图标）
└──────────────────────────────────┘

折叠状态：
┌──────────────────────────────────┐
│ [python]  ··· 3 lines     [>⟩] │  ← 展开按钮
└──────────────────────────────────┘
```

---

## 改动 5：图片鼠标悬浮 → 编辑图片说明（alt text）

### 当前实现

- `MarkdownImg` 已有丰富的 hover 交互（resize handle、size badge、右键菜单）
- 右键菜单有 "Edit path" / "Delete image"
- 但没有 hover 时编辑 alt text 的功能

### 改进方案

鼠标悬浮在图片上时，在图片下方显示一个小的 inline 输入框，显示当前 alt text，点击可编辑。编辑后更新 `![new alt](src)` 语法。

### 修改点

| 文件 | 改动 |
|------|------|
| `markdown.tsx` `MarkdownImg` | 新增 `alt editing` state；hover 时在图片下方渲染 inline input（显示 `props.alt`）；blur/Enter 提交修改 |
| `markdown-util.ts` | 新增 `updateImageAltInLine(lineText, src, newAlt)` 纯函数 |
| `markdown.scss` | 新增 `.markdown-img-alt-editor` 样式（small input, centered below image） |

### ASCII 设计图

```
      ┌─────────────────┐
      │                 │
      │    🖼️ 图片      │  ← hover 时显示 resize handle
      │                 │
      └─────────────────┘
       [ 编辑图片说明... ]   ← hover 时显示 alt editor（当前 alt 文本）
```

---

## 改动 6：Markdown 预览演示模式

### 当前实现

- 没有演示模式
- 有 `fontSizeOverride` 和 `fixedFontSizeOverride` 用于字体大小调整
- 有 OverlayScrollbars 用于滚动

### 改进方案

#### 6a. 进入/退出演示模式

- 新增工具栏按钮或快捷键（如 `F11` 或 `⌘+Shift+P`）进入演示模式
- 演示模式：全屏（Electron fullscreen API）+ 内容居中放大 + 隐藏侧边栏/编辑器

#### 6b. Ctrl+滚轮缩放

- 演示模式下监听 `wheel` 事件 + `ctrlKey` 检测
- 调整 `--markdown-font-size` CSS 变量实现缩放
- 缩放范围：60% ~ 300%，步进 10%
- 显示缩放比例指示器（短暂显示后自动消失）

### 修改点

| 文件 | 改动 |
|------|------|
| `preview.tsx` | 新增 `presentationMode` state；进入时调用 `document.documentElement.requestFullscreen()` |
| `preview-markdown.tsx` | 透传 `presentationMode` prop 到 Markdown 组件 |
| `markdown.tsx` | 新增 `presentationZoom` state；wheel+ctrl handler 调整 zoom；渲染 zoom indicator overlay |
| `markdown.scss` | 新增 `.markdown-presentation` 样式（居中、max-width、阴影）；新增 `.markdown-zoom-indicator` |
| `preview.tsx` toolbar | 新增演示模式按钮（全屏图标） |

### ASCII 设计图

```
演示模式：
┌──────────────────────────────────────────────┐
│  ┌──────────────────────────────────────┐    │
│  │                                      │    │
│  │         Markdown 内容（放大）          │    │  ← 居中 + 放大
│  │         max-width: 900px             │    │
│  │         font-size: 120%              │    │
│  │                                      │    │
│  └──────────────────────────────────────┘    │
│                                              │
│                    [120%]                    │  ← 缩放指示器（Ctrl+滚轮时显示）
└──────────────────────────────────────────────┘
```

---

## 实施优先级建议

| 优先级 | 改动 | 理由 |
|--------|------|------|
| P0 | 改动 1（斜杠命令排查） | 功能性 bug，影响基本可用性 |
| P1 | 改动 3（代码块 UI 调整） | 纯 CSS/小改动，用户明确要求 |
| P1 | 改动 6 圆角补充 | 已在改动 3 中包含 |
| P2 | 改动 2（Emoji 分类） | 体验优化 |
| P2 | 改动 4（代码折叠 + caption） | 新功能，中等工作量 |
| P2 | 改动 5（图片 alt 编辑） | 新功能，中等工作量 |
| P3 | 改动 6（演示模式） | 新功能，工作量较大 |

---

## 风险评估

| 改动 | 风险 | 缓解措施 |
|------|------|----------|
| 斜杠命令排查 | 低 — 只加日志 | 确认根因后再改逻辑 |
| Emoji 分类 | 低 — 纯 UI 增强 | 复用现有 `EMOJI_GROUP_LABELS` |
| 代码块 UI | 低 — CSS 调整 | 视觉回归测试 |
| 代码折叠 | 中 — 需要状态管理 | 保持折叠状态在 remount 间持久化 |
| 图片 alt 编辑 | 低 — 扩展现有 hover 交互 | 复用 `editImageSyntaxInFullText` |
| 演示模式 | 中 — 全屏 API + 缩放 | Electron 全屏 API 稳定；缩放用 CSS 变量 |

---

## 确认事项

1. 改动 1（斜杠命令）：是否需要我先加日志排查，还是你已经有更多线索？
2. 改动 4（代码说明）：你期望的"代码说明"语法是什么？`<!-- caption: ... -->` 还是其他？
3. 改动 6（演示模式）：快捷键偏好？全屏时是否需要隐藏所有 UI（只保留内容）？
4. 所有改动是否需要我先出更详细的设计图再开始？
