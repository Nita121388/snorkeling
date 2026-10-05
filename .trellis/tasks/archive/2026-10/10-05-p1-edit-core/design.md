# P1 Design: 编辑内核（统一 undo 栈 + AST 块模型 MVP + 双轨灰度）

## 现状边界（影响设计的关键事实）

- **单一提交通道**：所有编辑最终都进入 `handleInlineEditCommit(newText)` → `onInlineEditCommit(nextText)`
  → `globalStore.set(model.newFileContent, nextText)`。这是 undo 栈天然的挂接点。
- **每次提交都有完整新文本**：块级/行级编辑都是"给定 `text` 与锚点行，算出一个 `nextText`"，
  所以 undo 记录只需要保存 `{ before, after }` 即可，无需 diff 重建。
- **draft/saved 双态**：`newFileContent` 是 draft atom，`savedContent` 是磁盘版；undo 只作用于
  draft 层（未落盘），与 Cmd+S 落盘正交。
- **纯函数变换已就绪**：`markdown-transform` 的块操作（block-type / code-block / table / inline-style）
  都是"源码文本 → 源码文本"纯函数，天然可作为 AST 编辑的操作层前身。

## 设计决策

### 决策 1：undo 栈粒度 = 单次提交通道调用（推荐）

**问题**：每个块操作应成"一步"可撤销，还是按字符级细分？

**推荐**：**按单次 commit 为一步**。理由：
- 所有编辑已收敛到 `handleInlineEditCommit`，一个 commit = 一个完整块操作（改一个代码块语言、
  翻转 checkbox、重编号一个列表、改一句行内文字），天然是用户心智的"一步"。
- 实现最简、无 diff 重建、无性能问题。
- 与现有 `revision`、`handleFileSave` 语义一致。

**取舍代价**：一次 ⌘Enter 落盘的行内编辑若是多字符，undo 会一步回退整句（而非逐字）。
这在块编辑器里是符合预期的（对标思源/我来的块级 undo）。

### 决策 2：undo 栈宿主 = markdown.tsx 层的可复用 Hook（推荐）

**问题**：栈放 preview-model（跨 Markdown/monaco 全局）还是 markdown.tsx 内？

**推荐**：新建**可复用 Hook `useEditorHistory`**，放在 `frontend/app/element/` 下，markdown.tsx 内使用。
理由：
- undo 本质是"对草稿文本的序列化快照"，属于编辑器语义，不依赖具体 file 模型；放通用 Hook 便于
  Monaco `/` WYSIWYG 复用。
- markdown.tsx 是当前所有 DOM 编辑的宿主，栈生命周期跟随编辑会话（resetKey 重置）自然合理。
- 不侵入 preview-model 的保存/回退逻辑，风险 lowest。

**折中**：Hook 接受 `{text, onCommit}`，内部持有 ref 栈；`undo()`/`redo()` 把历史 `before/after`
文本回填到 `onCommit`。preview-model 层的 `handleFileRevert`（回退磁盘版）保留不动，两者互不干扰。

### 决策 3：AST 块模型范围 = 只读块模型 + 稳定坐标 MVP（推荐）

**问题**：P1 就让编辑改 AST，还是先只建"只读块模型 + 坐标"？

**推荐**：**P1 只建只读块模型 MVP（M1）**。理由：
- `markdown-transform` 已经是"源码文本"级变换，直接把它提升为 AST 编辑会把现有纯函数逻辑全重写，
  风险高，违背渐进迁移。
- M1 先打通 `Markdown 原文 → parse → Block[]（带稳定行坐标）→ renderer` 最小闭环，作为后续
  P2 编辑路径收敛的地基。
- 编辑操作 P1 仍走现有文本变换（行为零变化），只在"语义视图"上提供 Block[] 供后续阶段消费。

**Block 类型（M1 MVP）**：
```ts
export type BlockKind =
  | "heading" | "paragraph" | "bullet-list" | "ordered-list" | "todo-list"
  | "quote" | "code" | "table" | "callout" | "image" | "hr";

export interface Block {
  id: string;            // 稳定：hash(source 行范围) 或 index+kind
  kind: BlockKind;
  startLine: number;     // 0-based
  endLine: number;       // 0-based, inclusive
  depth: number;         // 列表嵌套层级
  text: string;          // 该块源码文本（不含 */fence 标记前导）
  children: Block[];     // 嵌套（列表项子块/引用内块）
  // 可选：对应 mdast node 引用（M2 再深化）
}
```
入口函数（放 `markdown-transform/tree.ts` 或新 `block-model/`）：
```ts
export function buildBlockTree(lines: string[]): Block[];
```
纯函数，无 DOM/React 依赖，可单测。

### 决策 4：双轨灰度 = AST 路径默认关闭，仅测试/开关启用（推荐）

**问题**：AST 路径是否默认参与渲染？

**推荐**：**默认关闭**，提供一个常量/flag `ENABLE_BLOCK_MODEL_RENDER`（默认 false）或仅由
`buildBlockTree` 单测消费。渲染仍走现有 `markdown-render` + remark 管线，零行为差异。
P2 再逐个块类型切换。

## 统一 undo 栈接口（核心交付）

```ts
// frontend/app/element/use-editor-history.ts
export interface EditorHistoryHandle {
  undo: () => boolean;      // 有可撤销则回填并返回 true
  redo: () => boolean;
  canUndo: boolean;
  canRedo: boolean;
  clear: () => void;        // 文件切换/重载时清空
}

export interface UseEditorHistoryArgs {
  /** 当前草稿文本（commit 前） */
  text: string;
  /** 应用的提交函数（即 onInlineEditCommit 路径）；undo/redo 也走它回填 */
  onCommit: (newText: string) => void;
  /** 重置信号：change 时清空历史 */
  resetKey?: unknown;
}

export function useEditorHistory(args: UseEditorHistoryArgs): EditorHistoryHandle;
```

**记录时机**：包装 markdown.tsx 的 `handleInlineEditCommit`——调用前把 `text`（用 ref 持最新值）
与 `after=newFullText` 组成 `{before, after}` 入栈；`before !== after` 才压栈（no-op 不入）。
单栈容量上限（如 200 步）防内存膨胀。

**undo/redo 回填**：undo 取出栈顶，把 `before` 经 `onCommit` 回填 → atom 更新 → 渲染刷新 → 光标
后续 P2 再用块坐标精修。同时当前 `after` 入 redo 栈。

**快捷键**：在 markdown.tsx 已有 keydown 链路里加 `Cmd/Ctrl+Z` → `undo()`；
`Cmd/Ctrl+Shift+Z` / `Cmd+Y` → `redo()`。仅在编辑生效（`onInlineEditCommit != null`）。
需与 Monaco 源码编辑器的原生 undo 区分（那是由 monaco 自己管，不冲突，因两者不同时活跃）。

## 目录与文件

```
frontend/app/element/
├── use-editor-history.ts     # 统一 undo/redo Hook（核心交付）
├── use-editor-history.test.ts
└── markdown-transform/
    ├── tree.ts               # buildBlockTree（M1 只读块模型）
    └── tree.test.ts
```
（可选，若 eval 需要连渲染）`block-model/` 下放一个 `BlockTree` 渲染适配器，但 P1 默认不接渲染。

## 兼容与风险

- 风险 MEDIUM（P1 核心）。主要风险点：
  1. **memo 命中语义**：undo/redo 走 `onCommit` 会触发 `text` 变化，需确认不破坏现有依赖数组。
  2. **与 autosave 交互**：undo 后 `scheduleInlineEditAutosave` 仍会触发草稿落盘——undo 应落到
     draft 层即算完成，不要误触发"保存"；需设计 undo/redo 走 onCommit 但跳过 autosave 的路径
     （或拆分"提交但非落盘"与"提交并落盘"）。
  3. **Monaco 共存**：源码编辑模式下 undo 是 monaco 原生，Hook 只在 DOM 编辑会话激活。
- 负向：不做 P2 收敛，不接渲染，不改 remark，不加 data-block-path 强制迁移。

## 不做

- 不做"编辑改 AST"（P2）、不做 P3 交互、不强制迁移 DOM 路径。
- 不重写 markdown-transform 现有纯函数。