# Design：CodeMirror 6 Markdown Live Preview 编辑内核

## 1. 目标架构

```text
md-core       Markdown 解析、块模型、源码坐标、往返与提交契约
    ↓
md-codemirror CodeMirror 6 编辑内核：文本状态、Selection、滚动、IME、History、Live Preview
    ↓
md-react      React 生命周期薄绑定（Snorkeling 第二阶段）

host adapter  每个消费者的图片、链接、保存、主题能力；全部有默认实现
Monaco        独立服务代码块，不进入 Markdown 编辑内核
```

journal 第一阶段直接使用 `md-codemirror` 的框架无关 API；Snorkeling 继续保留当前 React/Monaco 代码路径，待卡片 MVP 与内核门禁通过后再接入。

## 2. 核心边界

### 2.1 Markdown 文本仍是事实源

CodeMirror 的 `EditorState.doc` 保存 Markdown 文本。Live Preview 是 decorations/widgets 的视图层，不创建长期独立富文本事实源。提交使用现有 `md-core` 文本变更、块定位、陈旧检测和逐字节往返安全链。

### 2.2 CodeMirror 负责通用编辑基础能力

CodeMirror 6 负责：

- 文本状态与 transaction；
- 光标/选区；
- 滚动容器；
- IME 组合输入；
- Undo/Redo；
- 键盘事件；
- 重新挂载与销毁。

业务扩展负责：

- Markdown syntax hiding；
- wiki/footnote/image decorations；
- checkbox 和 inline widget；
- block command、slash menu、toolbar 事件；
- 与 md-core 的提交适配。

### 2.3 不替换 Monaco

Monaco 继续负责代码块、脚本和语言服务。CodeMirror 6 只负责 Markdown 文本和卡片 content。

## 3. 公共 API

```ts
export type MarkdownEditorMode = "preview" | "source" | "live-preview";

export type MarkdownEditorOptions = {
  parent: HTMLElement;
  value: string;
  mode?: MarkdownEditorMode;
  host?: MarkdownEditorHost;
  extensions?: Extension[];
  onChange?: (value: string, change: MarkdownChange) => void;
  onSelectionChange?: (range: { from: number; to: number } | null) => void;
};

export type MarkdownEditor = {
  view: EditorView;
  focus(): void;
  getValue(): string;
  setValue(value: string): void;
  setMode(mode: MarkdownEditorMode): void;
  dispatch(transaction: Transaction): void;
  runCommand(command: MarkdownCommand): boolean;
  destroy(): void;
};
```

`setValue` 是外部同步入口，不触发用户 `onChange`；用户输入只通过 CodeMirror transaction 进入 `onChange`。所有 command 必须产生明确的文本 change 或结构化 op，不能直接修改 DOM。`live-preview` 中的视觉变化只来自 decorations/widgets，不能复制一份独立富文本事实源。

## 4. Live Preview 实现

### 4.1 MVP 装饰

第一阶段实现：

- headings：隐藏 `# ` 前缀；
- emphasis/strong/strike/code：隐藏语法标记并保留样式；
- lists/task lists：隐藏 marker，checkbox 使用 widget；
- blockquote：隐藏 `> `；
- normal links/wiki links：显示可读 label，保留 source range；
- footnote：显示引用编号，保留 source range；
- images：显示安全 image widget，加载失败时保留 source 可编辑路径。

使用 CodeMirror `Decoration.mark`, `Decoration.replace`, `WidgetType`, `ViewPlugin` 和 `StateField`。装饰必须由文档状态和 syntax tree 推导，不从 DOM 反向推断 Markdown。

### 4.2 事件与复杂 UI

编辑器只发出语义事件：`onBlockCommand`, `onLinkActivate`, `onImageAction`, `onSlashRequest`。复杂业务 UI 由宿主显示，完成后通过 `dispatch`/command 写回文本。避免把 React 或 journal DOM 绑定进核心。

## 5. 性能策略

- CodeMirror incremental parsing 和 transaction 更新；
- decorations 按 changed ranges 更新；
- 不在每次击键时运行全量 DOM→Markdown 序列化；
- 提交时才调用 md-core 的文本/块提交链；
- 卡片编辑器先优化中等文本；大文档基准在第二阶段加入；
- 不使用 `innerHTML` 全量重建编辑面；
- 记录初始化、100 次输入、滚动、提交、销毁的耗时和输入延迟。

## 6. 兼容与迁移

### journal MVP

`extension/features/card-editor.js` 当前将 `card.content` 绑定到 textarea。第一阶段替换为 CodeMirror 6 实例：

```text
card.content → createMarkdownEditor({ parent, value, mode })
用户 transaction → onChange(nextMarkdown) → 现有卡片保存
重新打开 → value 回填 EditorState
```

先实现 `live-preview` 默认编辑体验，同时提供 source/preview 切换；三种模式共用同一个 CodeMirror 文本状态。卡片的 title/type/status 等字段保持现有 DOM 表单，不交给 CodeMirror。

### Snorkeling

第二阶段新增 React 薄绑定并在独立 prototype 中接入，不立即删除当前 Markdown 编辑路径。通过同一组 Markdown fixtures 对比往返、焦点、滚动和性能后，再按块类型迁移。Monaco 代码编辑不变。

## 7. 回滚

- CodeMirror MVP 使用独立包和独立 card-editor adapter；失败时恢复 journal 原 textarea 分支。
- Snorkeling 在独立 feature flag 下接入，不改变默认 Markdown 编辑路径，直到 AC1–AC7 全部通过。
- 不删除现有 `WysiwygEditor` / overlay 代码，直到 CodeMirror 消费者完成真实验收并记录迁移决定。

## 8. 关键风险

- Live Preview syntax hiding 的语法覆盖范围可能超过 MVP；未知语法必须保持 source 可见，不静默丢失。
- CodeMirror DOM widget 与 Markdown 提交范围必须保持同步；每个 widget 需要 source-range 测试。
- journal 无打包器需要 ESM dist 和直接导入路径；构建产物是 MVP 验收的一部分。
