# Selection Search In Files 跨 Tab 查找与打开

## Goal

💡 选区快捷菜单的 `Search In Files` 目前只能命中**当前 Tab** 里已打开的 Files 面板：非活跃 Tab 的 block 未挂载，`getAllBlockComponentModels()` 看不到它们，所以找不到时只能弹 `"No Files block is open in this tab."`。

改为**单入口递进查找**：当前 Tab 优先 → 全 workspace 其它 Tab 的 Files 树。命中在别的 Tab 时，切到那个 Tab、在它的 Files 树里 reveal 该路径并打开（或复用）preview block。

同时给 `openPathInPreview` 加 `tabId` 参数 —— 这是本任务与后续「终端路径链接」任务共用的接缝。

## Background（已核查的事实）

- `frontend/app/element/selection-copy-overlay.tsx:120` 构造快捷菜单，`Search In Files` → `searchSelectionInFilesText()` → `parseFileReference()` → `searchSelectionInFiles()`。
- `frontend/app/element/selection-reference-parser.ts` 已能解析大量路径形态：`a.ts:12`、`a.ts:12:5`、`#L12`、`Python trace`、`GitHub blob`、缩进多行路径、`textHint` 文本提示、包裹标点剥离。**本任务不重写解析器。**
- `frontend/app/element/selection-search-in-files.ts:114` 的目标枚举依赖 `getAllBlockComponentModels()`，而 block 只在挂载时注册（`frontend/app/block/block.tsx:1274`）。
- `frontend/app/app.tsx:57` 只给 `atoms.staticTabId` 提供 `TabModelContext`，非活跃 Tab 的 block 不挂载 —— 这是「只能看到当前 Tab」的根因。
- `frontend/app/view/preview/file-link-navigation.ts` 的 `openPathInPreview` 内部同样只用 `atoms.staticTabId`（`findTreeFilesBlock` / `findExistingNonEditPreviewBlock` / `focusTreeBlock` / `createPreviewBlock`）。
- `frontend/app/tab/tab-target-modal.tsx:76` 已有通用的 Tab 选择器组件（`TabTargetModal`），可直接复用于歧义场景。
- `frontend/app/block/block-minimize.ts:203` `restoreMinimizedBlockToLayout(tabId, blockId)` 已按 tabId 工作，可拉回最小化 block。
- `frontend/app/view/preview/preview-navigation.ts` 定义 reveal 通道：`preview:revealpath` / `preview:revealseq` / `preview:explorer-root` / `preview:pathisdir`。
- 仓库里没有通用 toast 组件；选区 overlay 自带 feedback 气泡通道（`onCommonTextFeedback` 的 `msg`/`kind`）。

## Requirements

### R1 查找范围

- R1.1 当前 Tab 的 Files 面板仍是第一优先级，命中即打开，不跨 Tab（行为与改动前一致）。
- R1.2 当前 Tab 未命中时，继续在 workspace 其它 Tab 的 Files 树里查找。
- R1.3 目标枚举**不得依赖 block 挂载**：必须从对象存储读 Tab/Block 元数据，并用 RPC stat 校验，不得实例化 `PreviewModel`。
- R1.4 只在**同 connection** 的 Tab 之间查找（local 与远端、不同 ssh 目标不混查）。
- R1.5 只把「树形展示」的 preview block 当查找根：`displayMode === tree`，且排除 `meta.edit === true` 的单文件 preview block。
- R1.6 查找根路径推导顺序：`preview:explorer-root` → `meta.file`（且该路径是目录）。
- R1.7 打分沿用现有 `scoreTarget`，追加「当前 Tab +20」权重，保证同分时当前 Tab 胜出。

### R2 打开行为

- R2.1 命中在当前 Tab → reveal 路径 + 打开/复用 preview block（现状）。
- R2.2 命中在其它 Tab 的 Files 树 → 在**目标 Tab** 建或复用 preview block、写入 reveal 请求、然后 `setActiveTab(目标 Tab)` 并聚焦。
- R2.3 目标 Tab 已有同路径的非 edit preview block → 复用它，不新建。
- R2.4 目标 block 处于最小化状态 → 恢复到布局。
- R2.5 找到文件但 workspace 里没有任何 Files 树覆盖它 → 在**当前 Tab** 新建 preview block（不为了打开文件而切 Tab）。
- R2.6 行号定位：沿用 `preview:searchline`；`textHint` 模糊修正行号的现有逻辑保持不变。
- R2.7 markdown 命中仍进 edit 模式（沿用现有 `editMode` 判定）。

### R3 `openPathInPreview` 参数化（共享接缝）

- R3.1 新增可选参数 `tabId?: string`；缺省时回落 `atoms.staticTabId`。
- R3.2 模块内所有依赖当前 Tab 的环节（`findTreeFilesBlock`、`findExistingNonEditPreviewBlock`、`focusTreeBlock`、`createPreviewBlock`、`applySearchLineToBlock`）必须按传入的 `tabId` 工作。
- R3.3 **向后兼容硬约束**：`openPathInPreview` 是共享函数，调用方至少包括 markdown 链接（`preview-markdown` / 元素层 markdown）、Files 树双击（`preview-open.ts` / `preview-directory.tsx`）、`preview-edit.tsx` 的编辑器 action。不传 `tabId` 时行为必须与改动前逐字节一致。
- R3.4 打开顺序：**先在目标 Tab 建/激活 block，再 `setActiveTab`**。实现走 `ObjectService.CreateBlockInTab(targetTabId, ...)`（服务端把 block 插进目标 Tab 的 layout），**不得**依赖「先切 Tab 再 `createBlock`」——同一 renderer 内 `staticTabId` 不可变，`createBlock` 永远落在调用方 Tab。

### R4 歧义与用户反馈

- R4.1 多个 Tab 命中且评分并列 → 弹出候选选择列表（`ContextMenuModel`，每条展示 Tab 名 + 相对路径），不使用 `window.alert` 拼字符串列表。
  （原计划的 `TabTargetModal` 经实测不适用：依赖 `useWaveEnv`、只列「除当前 Tab 外全部 Tab」、无「Tab 名 + 相对路径」插槽，见 design §7.1。）
- R4.2 唯一候选 → 直接打开，不打扰用户。
- R4.3 跨 Tab 打开后给一次性轻量提示（如 `Opened in Tab "<name>"`），复用选区 overlay 的 feedback 气泡通道，不阻塞交互。
- R4.4 完全未命中 → 文案改为「已尝试 N 个 Tab 未找到」这类可诊断信息，替换现在误导性的 `"No Files block is open in this tab."`。
- R4.5 非文件引用选区（解析器返回 null）→ 保持现有 `"No file reference found in the selected text."` 行为。

### R5 性能与健壮性

- R5.1 stat 并发限流（≤4）。
- R5.2 单次 stat 超时（约 1.5s）降级为「未命中」，保护远端慢连接。
- R5.3 单次查找内维护 `path → FileInfo` 缓存，避免重复 stat。
- R5.4 RPC 异常不得冒泡到 UI，一律按未命中处理。
- R5.5 查找耗时应与 Tab 数量近似线性，不得出现对所有 Tab 全量串行 stat 的阻塞式等待。

### R6 测试

- R6.1 单测覆盖：跨 Tab 目标收集（mock 对象存储）、当前 Tab 优先打分、歧义判定、connection 隔离。
- R6.2 单测覆盖：`openPathInPreview` 传 `tabId` 的路由，以及不传时的默认回退。
- R6.3 既有 `selection-search-in-files.test.ts` 全部保持通过。

## Acceptance Criteria

- [ ] Tab A 打开 `E:/code/snorkeling` 的 Files 树，Tab B 打开 `E:/code/snorkeling/docs` 的 Files 树；在 Tab B 的终端选中 `pkg/remote/client.go:42` 后点 Search In Files，自动切到 Tab A，在其 Files 树中定位该文件并打开预览块，定位到第 42 行。
- [ ] 在 Tab A 内选中当前树已覆盖的路径 → 不发生 Tab 切换（R1.1）。
- [ ] 只打开一个 Files 树且路径不在其 root 下、但文件确实存在于某个已打开 Tab 的树内 → 打开到那个 Tab 的树里。
- [ ] workspace 内没有任何 Files 树覆盖该文件 → 在当前 Tab 新建 preview block，不切 Tab（R2.5）。
- [ ] 两个 Tab 的树都能命中同一相对路径且评分相同 → 弹 `TabTargetModal`，选择后在该 Tab 打开（R4.1）。
- [ ] local Tab 与远端 Tab 同时存在时，不会把本地路径解析成远端路径或反之（R1.4）。
- [ ] 从终端 markdown 链接、Files 树双击、`preview-edit.tsx` 编辑器 action 三处打开文件，行为与改动前一致（R3.3）。
- [ ] 未打开任何 Files 的 workspace 里点 Search In Files → 提示信息可诊断（R4.4），无未捕获异常。
- [ ] 目标 preview block 处于最小化时能被恢复并聚焦（R2.4）。
- [ ] `npx vitest run frontend/app/element` 与 `npx vitest run frontend/app/view/preview` 全绿；`npx tsc --noEmit`、eslint 无新增错误。

## Non-Goals

- 不新增 `Search In All Tabs` 菜单项；入口保持单一（用户点按钮的意图是「帮我找到并打开」，查找范围是实现细节）。
- 不实现终端 agent TUI 的路径链接识别（LinkProvider / cwd 推测 / 装饰剥离）—— 留给后续独立任务，本任务的 `openPathInPreview({tabId})` 就是给它的接缝。
- 不做磁盘级文件搜索（不 grep 全项目，只沿已打开的 Files 树查找）。
- 不做跨 connection 的混合查找。
- 不改 `selection-reference-parser.ts` 的解析能力（除非发现的缺陷直接阻塞本任务）。

## Follow-ups（本任务不实现，仅登记）

- **基于大模型的路径推测**：当前 Tab 与其它 Tab 的 Files 树都没有覆盖目标路径时，靠文本上下文（agent TUI 的对话流、命令输出、报错栈）让模型推测真实路径。核心难点是**速度**——模型推理耗时与「点一下就要打开」的交互预期冲突，可能的手段：预取/流式、只对未命中场景触发、本地小模型或规则+模型混合、结果异步回填。
  该能力的输入层（`ParsedFileReference` + `textHint`）与打开层（`openPathInPreview({tabId})`）本任务都已备好，届时只需新增「推测源」并接到既有打分流程。
- **终端 agent TUI 路径链接识别**（LinkProvider / cwd 推测链 / 装饰剥离），同样复用本任务的 `openPathInPreview({tabId})` 接缝。

## Notes

- `file-link-navigation.ts` 是高复用共享模块，改动必须配完整回归，见 R3.3。
- 提交前用 GitNexus `impact({target: "openPathInPreview", direction: "upstream"})` 核对影响面并记录到 PR/commit 说明。
