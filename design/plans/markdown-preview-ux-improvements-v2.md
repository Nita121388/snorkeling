# Markdown 预览 UX 改进 — 修订方案 + 委派 Prompt

## 修订说明

根据反馈：
1. 斜杠命令问题 → 用 CDP 实际排查
2. 代码说明语法 → 需要调研 markdown 标准中的 code caption/description 语法
3. 演示模式 → 加在现有 Preview 下拉菜单（eye icon）中
4. 提供委派 prompt 给其他 agent 并行处理

---

## 改动清单（修订版）

### 改动 A：斜杠命令选择后无反应（CDP 排查）

**现状**：`SlashPalette` 的 `onPick` → `handleSlashPick` → `execSlashCommand`。需要确认哪一步丢失了响应。

**CDP 排查步骤**：
1. 打开一个 markdown 文件进入编辑模式
2. 在行首输入 `/` 触发斜杠面板
3. 选择一个命令（如 "Heading 1"）
4. 用 CDP `Runtime.evaluate` 注入 console 监听，观察 `handleSlashPick` 的 result 是否为 null
5. 检查 `execSlashCommand` 的 ctx 参数是否正确

**可能根因**：
- `execSlashCommand` 返回 null（命令与当前 block kind 不匹配）
- `filterSlashCommands` 过滤掉了匹配的命令
- `handleSlashPick` 中 `session == null` 导致提前 return

---

### 改动 B：代码说明（Caption）语法调研

**问题**：Markdown 标准中没有统一的 code block caption 语法。需要调研以下方案：

1. **HTML `<figcaption>`**：`<figure><pre><code>...</code></pre><figcaption>Description</figcaption></figure>`
2. **Markdown 扩展**：有些解析器支持 ` ```language caption="..." ` 
3. **注释约定**：代码块后紧跟 `> description` 或 `<!-- caption: ... -->`
4. **Obsidian 风格**：使用 callout 语法 `> [!note] Code description`

**调研任务**：
- 检查 react-markdown + rehype-highlight 是否支持任何 caption 语法
- 检查 Obsidian 的 code block caption 实现
- 检查 MDX 的 code block 扩展
- 给出推荐方案

---

### 改动 C：演示模式（Preview 下拉菜单）

**现状**：Preview 按钮（eye icon）当前有两个菜单项：
- "Preview Here" — 切换到预览模式
- "Open Live Preview Block" — 打开实时预览块

**新增**：在下拉菜单中添加 "Presentation Mode" 选项。

**实现方案**：
1. `preview-model.tsx` 的 `previewMenuItems` 数组中添加新项
2. 点击后设置 `presentationMode` atom 为 true
3. Markdown 组件检测该 atom，进入全屏 + 放大模式
4. 退出：按 Esc 或再次点击菜单项

**修改点**：
- `preview-model.tsx`：添加菜单项
- `preview.tsx`：透传 presentationMode prop
- `markdown.tsx`：新增 presentationMode + zoom 逻辑
- `markdown.scss`：新增演示模式样式

---

### 改动 D：代码块 UI 调整（纯 CSS）

**修改点**：
- `markdown.scss` `.codeblock-actions`：从 `right:0` 改为语言标签在 `left:0`
- `markdown.scss` `.codeblock`：增加 padding（0.4em 0.7em → 0.6em 1em）
- `markdown.scss` `.codeblock`：增加 border-radius（4px → 6px）

---

### 改动 E：Emoji 选择器分类标签

**修改点**：
- `emoji-picker.tsx`：顶部添加分类标签栏
- `emoji.ts`：新增 `getEmojiGroupStartIndex()` 辅助函数
- `markdown.scss`：新增 `.markdown-emoji-categories` 样式

---

### 改动 F：图片 Alt Text 编辑

**修改点**：
- `markdown.tsx` `MarkdownImg`：hover 时显示 alt editor
- `markdown-util.ts`：新增 `updateImageAltInLine()` 函数
- `markdown.scss`：新增 `.markdown-img-alt-editor` 样式

---

## 委派 Prompt 模板

### Prompt 1：斜杠命令 CDP 排查

```
你是 Snorkeling 项目的调试专家。任务：排查 Markdown 预览中斜杠命令选择后无反应的问题。

项目路径：/Users/nita/Primary/projects/snorkeling
核心文件：
- frontend/app/element/markdown.tsx（5300+ 行，主组件）
- frontend/app/element/block-editor/exec.ts（execSlashCommand 函数）
- frontend/app/element/block-editor/registry.ts（filterSlashCommands 函数）

排查步骤：
1. 用 CDP 连接运行中的 Snorkeling app（http://127.0.0.1:9222）
2. 打开一个 markdown 文件，进入编辑模式（双击段落）
3. 在行首输入 "/" 触发斜杠面板
4. 用 Runtime.evaluate 注入以下监控代码：
   ```javascript
   // 监控 handleSlashPick 的执行
   const origExecSlashCommand = window.execSlashCommand;
   window.execSlashCommand = function(...args) {
       console.log('execSlashCommand called', args);
       const result = origExecSlashCommand.apply(this, args);
       console.log('execSlashCommand result', result);
       return result;
   };
   ```
5. 选择一个命令（如 "Heading 1"），观察 console 输出
6. 如果 result 为 null，检查 ctx 参数（text/line/endLine/kind）
7. 如果 result 有值但 UI 无响应，检查 handleInlineEditCommit 是否被调用

输出要求：
- 给出根因分析
- 给出修复方案（代码改动）
- 如果需要加日志，给出具体的 console.log 位置
```

### Prompt 2：代码说明语法调研

```
你是 Markdown 技术专家。任务：调研 Markdown 代码块说明（caption/description）的标准语法。

需要调研的内容：
1. CommonMark 规范中是否有 code block caption 的标准？
2. GitHub Flavored Markdown (GFM) 是否支持？
3. Obsidian 的 code block caption 实现方式？
4. react-markdown + rehype-highlight 是否支持任何 caption 扩展？
5. MDX 的 code block 扩展语法？
6. 其他流行的 Markdown 编辑器（Typora、Mark Text、Zettlr）如何实现 code caption？

调研方法：
- 搜索 "markdown code block caption" / "markdown code block description"
- 查看 rehype-highlight 文档
- 查看 Obsidian 代码块插件文档
- 搜索 "markdown figure code block" 语法

输出要求：
- 列出所有找到的语法方案
- 给出推荐方案（兼容性最好、最符合用户直觉）
- 给出 Snorkeling 中的实现建议（如何集成到现有的 rehype 管道）
```

### Prompt 3：演示模式实现

```
你是 Snorkeling 项目的前端开发专家。任务：在 Markdown 预览的 Preview 下拉菜单中添加"演示模式"。

项目路径：/Users/nita/Primary/projects/snorkeling
核心文件：
- frontend/app/view/preview/preview-model.tsx（Preview 菜单定义，约 740 行）
- frontend/app/view/preview/preview.tsx（预览组件）
- frontend/app/element/markdown.tsx（Markdown 组件）
- frontend/app/element/markdown.scss（样式）

现有菜单结构（preview-model.tsx:735-755）：
```typescript
const previewMenuItems: MenuItem[] = [
    { label: "Preview Here", onClick: () => ... },
    { label: "Open Live Preview Block", onClick: () => ... },
];
```

需要实现的功能：
1. 在 previewMenuItems 中添加 "Presentation Mode" 菜单项
2. 点击后进入演示模式：全屏 + 内容居中放大
3. 演示模式下支持 Ctrl+滚轮缩放（60% ~ 300%）
4. 按 Esc 退出演示模式
5. 显示缩放比例指示器（短暂显示后自动消失）

实现步骤：
1. preview-model.tsx：添加 presentationMode atom 和菜单项
2. preview.tsx：透传 presentationMode 到 Markdown 组件
3. markdown.tsx：新增 presentationMode prop + zoom state + wheel handler
4. markdown.scss：新增演示模式样式（.markdown-presentation）

注意事项：
- 使用 Electron 的 fullscreen API（document.documentElement.requestFullscreen()）
- 缩放通过 CSS 变量 --markdown-font-size 实现
- 保持现有预览功能不受影响
```

### Prompt 4：代码块 UI 调整

```
你是 Snorkeling 项目的 CSS 专家。任务：调整代码块的 UI 样式。

项目路径：/Users/nita/Primary/projects/snorkeling
核心文件：frontend/app/element/markdown.scss

需要修改的样式：

1. 语言标签位置（约 390 行）：
   当前：.codeblock-actions { position: absolute; top: 0; right: 0; }
   改为：语言标签在左上角，操作按钮（copy/execute）保持右上角
   
2. 代码块内边距（约 374 行）：
   当前：pre.codeblock { padding: 0.4em 0.7em; }
   改为：padding: 0.6em 1em;（增加更多内边距）

3. 代码块圆角（约 374 行）：
   当前：pre.codeblock { border-radius: 4px; }
   改为：border-radius: 6px;（一点点圆角）

修改要求：
- 使用 edit 工具精确替换
- 不要改动其他样式
- 修改后验证视觉效果
```

### Prompt 5：Emoji 分类标签

```
你是 Snorkeling 项目的 UI 开发专家。任务：为 Emoji 选择器添加分类标签栏。

项目路径：/Users/nita/Primary/projects/snorkeling
核心文件：
- frontend/app/element/block-editor/components/emoji-picker.tsx
- frontend/app/element/markdown-transform/emoji.ts（EMOJI_GROUP_LABELS 定义）
- frontend/app/element/markdown.scss

现有结构：
- EmojiPicker 组件渲染一个 8 列网格，顶部有搜索框（document 模式）
- 分组标题（.markdown-emoji-group）已经存在，但需要滚动才能看到

需要实现：
1. 在搜索框下方添加分类标签栏（横向滚动）
2. 标签显示 emoji 图标（😀 👤 🐾 🍔 ✈️ ⚽ 💻 🔔 🏁）
3. 点击标签滚动到对应分类
4. 当前分类高亮显示

实现步骤：
1. emoji.ts：新增 getEmojiGroupStartIndex(items) 函数
2. emoji-picker.tsx：新增 activeCategory state + 标签栏渲染
3. markdown.scss：新增 .markdown-emoji-categories 样式

注意事项：
- 标签栏使用 flex 布局，overflow-x: auto
- 每个标签是一个 pill 按钮
- 滚动时自动更新 activeCategory（IntersectionObserver 或 scroll 事件）
```

### Prompt 6：图片 Alt Text 编辑

```
你是 Snorkeling 项目的 React 专家。任务：为 Markdown 图片添加 hover 时编辑 alt text 的功能。

项目路径：/Users/nita/Primary/projects/snorkeling
核心文件：
- frontend/app/element/markdown.tsx（MarkdownImg 组件，约 1350-1600 行）
- frontend/app/element/markdown-util.ts（图片语法解析函数）
- frontend/app/element/markdown.scss

现有实现：
- MarkdownImg 已有 hover 交互（resize handle、size badge）
- 右键菜单有 "Edit path" / "Delete image"
- 图片语法：![alt](src "title" =WxH)

需要实现：
1. hover 时在图片下方显示 alt text 编辑输入框
2. 显示当前 alt text（如果有的话）
3. 点击输入框进入编辑模式
4. blur/Enter 提交修改，更新 ![new alt](src) 语法
5. Esc 取消编辑

实现步骤：
1. markdown.tsx：MarkdownImg 新增 altEditing state + alt editor 渲染
2. markdown-util.ts：新增 updateImageAltInLine(lineText, src, newAlt) 函数
3. markdown.scss：新增 .markdown-img-alt-editor 样式

注意事项：
- 复用现有的 editImageSyntaxInFullText 函数
- alt editor 使用 inline input，样式与现有 UI 一致
- 只在 canEdit（有 onInlineEditCommit）时显示
```

---

## 实施顺序建议

| 阶段 | 任务 | 依赖 |
|------|------|------|
| 1 | Prompt 1（斜杠排查）+ Prompt 2（语法调研） | 无，可并行 |
| 2 | Prompt 4（代码块 UI）+ Prompt 6（图片 alt） | 无，可并行 |
| 3 | Prompt 5（Emoji 分类） | 无 |
| 4 | Prompt 3（演示模式） | 依赖 Prompt 2 的调研结果（caption 语法） |

---

## 确认事项

1. 斜杠命令排查：是否需要我先用 CDP 实际操作复现，还是直接给 prompt？
2. 代码说明：调研结果出来后，是否需要我先出设计图再实现？
3. 演示模式：快捷键偏好？全屏时是否隐藏所有 UI？
4. 以上 prompt 是否需要调整？
