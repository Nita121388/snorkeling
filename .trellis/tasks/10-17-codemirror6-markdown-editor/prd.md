# PRD：CodeMirror 6 Markdown Live Preview 编辑内核

> 状态：规划中
> 任务：`10-17-codemirror6-markdown-editor`
> 分支：`feat/wysiwyg-block-editor`

## Goal

用 CodeMirror 6 建立长期 Markdown 编辑内核，替代当前手写 `contenteditable` 作为主要编辑交互，解决：

- 点击位置与光标位置不一致、光标跳到块末尾；
- 编辑态多余边框、hover/selection 背景残留；
- 编辑时滚动受 focus/overlay/scroll 补偿逻辑限制；
- 中文输入法、选区、Undo/Redo、块级键盘行为持续需要宿主补丁；
- Markdown 编辑能力无法在 Snorkeling、journal 卡片和未来插件之间自然复用。

最终用户价值：卡片和 Markdown 页面拥有可靠的 Markdown Live Preview 编辑体验，同时保持 Markdown 文件/字段文本为事实源，不因编辑重写无关内容。

## Confirmed facts

- 当前 Markdown 编辑体验基于手写 `contenteditable` / overlay / React 状态；已实测存在光标、focus、背景和滚动体验问题。
- `EditableBlock` 挂载后会在 `requestAnimationFrame` 中调用无 offset 的 `focus()`；当前实现会将光标折叠到块末尾，点击 Range 没有被可靠传递进编辑会话。
- 当前项目已有 Monaco/代码编辑能力；CodeMirror 6 不替换 Monaco，只服务 Markdown / 卡片文本编辑。
- CodeMirror 6 是 MIT 开源，可用于商业项目、插件和 Electron 应用。
- journal 是纯 ESM、零框架、无打包器的 Chrome 扩展；卡片 `content` 当前由普通 textarea 读取和保存。
- 当前 `md-core` / `md-dom` 已有 Markdown 解析、块定位、逐字节往返保护、陈旧检测和提交安全链；这些能力应保留并接到新编辑内核。
- 当前工作区仍有上一阶段未提交的框架无关渲染实验变更；本任务开始实现前必须先完成基线提交/推送或明确回滚，不能把实验状态混入 CodeMirror 迁移。

## Requirements

### R1：编辑基础能力由 CodeMirror 6 管理

新编辑内核必须使用 CodeMirror 6 管理：

- 文本状态；
- 光标和选区；
- 滚动容器；
- 中文输入法/组合文本；
- Undo/Redo；
- 键盘事件和事务；
- 编辑器销毁与重新挂载。

不得继续通过自定义 `contenteditable`、手工 caret offset 或 focus/scroll 补偿作为主要实现。

### R2：支持 Markdown Live Preview 模式

编辑器至少支持三种模式，其中 **`live-preview` 是默认、主路径**：

- `preview`：只读 Markdown 预览，用于卡片列表、详情只读展示和导出预览；
- `source`：显示并编辑原始 Markdown，用于高级用户查看/修改源码；
- `live-preview`：**可编辑的预览面**。CodeMirror 文本仍保存完整 Markdown，decorations/widgets 隐藏或美化语法标记，用户直接在接近渲染结果的界面中编辑，行为参考 Obsidian Live Preview。

MVP 先覆盖段落、标题、强调、列表、引用、链接、图片、脚注的安全显示；复杂块可分阶段接入。journal 卡片打开编辑时默认进入 `live-preview`，不是先进入 source 模式。

### R3：保持文件/字段优先

- CodeMirror 文本必须是 Markdown 源文本或卡片 `content` 字段文本；
- 提交只能产生明确的文本 change / block op；
- 不得把一个独立富文本树作为长期事实源；
- 未编辑的 Markdown 片段必须逐字节保留；
- 外部文本变化必须能触发陈旧检测或显式刷新，不得静默覆盖。

### R4：框架无关与可复用

核心编辑器必须可被：

- Snorkeling React 宿主；
- journal 零框架 Chrome 扩展；
- 未来插件或其他页面工具；

复用。React 只能作为薄生命周期绑定，不得把光标、滚动、事务、Markdown Live Preview 逻辑重新写进 React 组件。

### R5：特殊 UI 可扩展

编辑器必须提供可组合扩展点：

- Markdown 语法装饰与隐藏；
- checkbox、wiki link、脚注、图片等 inline widget；
- block handle、块菜单、slash 菜单；
- 浮动工具栏；
- 图片、表格、代码块等复杂业务 UI 通过事件/command 与宿主通信；
- 不把 Monaco 代码编辑器和 Markdown 编辑器混为一个内核。

### R6：产品性能

- 输入延迟不能因每次击键全量 Markdown 序列化而明显增加；
- 编辑一个卡片/块时只更新相关文本和装饰；
- 不因重新渲染导致光标、选区或滚动跳动；
- 大文档建立可测基准：初始化、输入、滚动、提交、销毁；
- 需要明确增量更新策略，而不是全量 `innerHTML` 替换。

### R7：对外 API

目标 API 形态：

```ts
createMarkdownEditor({
  parent,
  value,
  mode: "live-preview" | "source" | "preview",
  host,
  extensions,
  onChange,
  onSelectionChange,
});
```

实例至少提供：`focus`、`getValue`、`setValue`、`dispatch`/command、`destroy`、`view` 或等价受控访问方式。

## Scope

### In scope

1. 新增 CodeMirror 6 依赖与框架无关编辑包/模块边界；
2. 建立 Markdown 编辑器核心实例；
3. 实现 source / live-preview / preview 模式的最小完整闭环；
4. 实现可靠光标、选区、滚动、IME、Undo/Redo；
5. 接入现有 Markdown 往返、块定位、提交和陈旧检测；
6. 用真实卡片内容完成 journal 风格的最小验收；
7. 用 Snorkeling 的独立原型验证 React 薄绑定；
8. 增加性能、交互和往返回归测试；
9. 明确 Monaco 与 CodeMirror 的职责边界。

### Out of scope for MVP

- 替换 Monaco；
- 一次性迁移 Snorkeling 全部 24 类 renderer；
- 一次性实现所有表格、拖拽、多选、图片 resize 和复杂菜单；
- 用 CodeMirror 的内部文档树替代 Markdown 文件事实源；
- 把所有 React UI 立即改成纯 DOM；
- 重新实现 ProseMirror 式富文本 schema/transaction 内核。

## Acceptance criteria

### AC1：光标与点击

- 点击普通文本中间，光标落在点击位置附近，而不是块末尾；
- 点击粗体、链接、代码等 inline 内容，光标位置稳定；
- 光标跨行、跨块、重新渲染后不随机跳动。

### AC2：滚动与 focus

- 编辑时可正常滚动编辑器和外部页面；
- focus 不锁死外部滚动；
- 光标移动不会触发无限 scroll/reposition 循环；
- 编辑器重新挂载后不强制滚动到不相关位置。

### AC3：输入体验

- 中文 IME 组合输入正常；
- Backspace、Enter、Shift+Enter、Tab、Undo/Redo 稳定；
- 编辑过程中无多余边框、残留 hover/selection 背景或布局跳动；
- 编辑器不依赖浏览器原生 `contenteditable` 的默认 caret 行为。

### AC4：Markdown 往返

- 未修改的 wiki link、脚注、图片、尺寸和普通 Markdown 逐字节保留；
- 编辑普通文字不会改写其他 Markdown 结构；
- 陈旧文本不会被静默覆盖；
- 既有 `md-core` / `md-dom` 往返测试继续通过。

### AC5：卡片闭环

- journal 风格的卡片 `content` 可以进入 source 或 live-preview 编辑；
- 保存后卡片 content 仍是 Markdown 文本；
- 重新打开卡片，预览和编辑结果一致；
- 没有 React、Monaco 或打包器依赖的消费者可以运行最小核心。

### AC6：扩展能力

至少提供一个自定义 Markdown decoration/widget 示例和一个宿主 command 示例；
新增扩展不需要修改 CodeMirror 核心或复制一套编辑器。

### AC7：性能

建立基准并记录结果：

- 小卡片首次初始化；
- 中等 Markdown 文档初始化；
- 连续输入 100 次；
- 选区和滚动；
- 提交和销毁。

不得出现明显输入延迟、光标跳动或滚动卡死。

## Confirmed product decisions

1. **MVP 第一真实消费者：journal 卡片 `content`**。它是独立字段、风险隔离，直接对应卡片 Markdown 目标，并能验证纯 ESM、零框架、无打包器复用；Snorkeling Markdown 页面作为第二个消费者。
2. **Live Preview MVP 语法范围**：段落、标题、强调、列表、引用、普通链接、wiki link、脚注、图片安全显示；表格、代码块、复杂 callout、拖拽、多选作为后续扩展。未支持语法保持 source 可见，不能静默丢失。
3. **Live Preview 是默认编辑模式**：编辑器实例支持 `preview` / `source` / `live-preview` 切换，但三种模式共用一个 CodeMirror 文本状态，不维护两个文本源。卡片打开编辑默认 `live-preview`。
4. **Monaco 职责不变**：CodeMirror 6 只服务 Markdown / 卡片内容编辑，不替换代码编辑器。

## Risks / deferred items

- CodeMirror 6 解决基础编辑体验，但 Markdown Live Preview decoration 仍需我们实现；它不是自动完成的功能。
- 真实 journal 使用还需要可分发的 ESM 产物和 host adapter 默认实现。
- 当前手写 `contenteditable` 不应在本任务中继续增加功能；迁移期可以保留回退，但必须有明确退役条件。
- 需要先提交/推送上一阶段未提交变更，再开始安装 CodeMirror 或修改产品代码。
