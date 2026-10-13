# A3：在位编辑引擎（文字级排版零差异的根治）

## 决策背景（用户拍板）
用户在反复追「编辑态 vs 预览态样式不一致」后，明确要求**从根上解决，不再逐项对齐**：
目标 = 一进来（Wolai）/ 思源 / Milkdown 同构的成熟做法 —— **编辑面就是渲染面，只有一套样式**，
差异 by construction 不存在；同时保留我们的差异化：**文件优先（markdown 文件仍是事实源，Obsidian 兼容）**。

## 现状的根本问题（为什么总是追不完）
当前编辑 = 「克隆块到 createPortal overlay + JS typography 快照 + overlay 镜像 CSS」—— 两套样式世界。
任何漂移（背景被窗口基色盖住 / 字重被快照污染 / overflow-wrap 缺口 / …）都是「第二套样式永远无法等于第一套」的必然结果。
之前 parity-harness 已把 scss 镜像清零（54→27 台账），但文字级排版走的是另一条路（快照/底色），仍在追。

## A3 目标形态（切片 1：prose 先行）
- 点击块 → **该渲染器输出元素本身**（或其 React 等价体）成为 contenteditable，**不克隆、不快照、不 overlay**
- 一套样式（.markdown .content 下的渲染器样式）→ 零差异
- 提交仍走既有链路：DOM 序列化 → prepareInlineEditCommit（重定位/陈旧检测/空壳守卫）→ 写盘 + undo 记账
- 复用（已就绪的资产）：种子上净逻辑（captureWysiwygInfo/calloutSeedHtml）、WysiwygEditor 键盘语义（Enter/Tab/IME…）、块身份/守卫/undo
- **双轨**：新路径受 feature flag（`wysiwyg-inplace` 默认关）控制；验证通过前 overlay 路径保留

## Requirements
- R1 新增 `EditableBlock`（或类似）React 组件：对**活跃会话块**渲染 contenteditable 编辑体，
  复用块自身 className/结构（=预览样式），不引入第二套样式
- R2 编辑期冻结 React 对活跃块的重渲染（会话开始到提交之间，该块子树不被 textAtom 更新冲掉）
- R3 键盘/IME 语义与 overlay 路径同源（共享 WysiwygEditor 的语义实现）
- R4 提交与取消：blur/Esc 走既有 prepareInlineEditCommit + undo（行为与 overlay 路径一致）
- R5 flag 双轨：`wysiwyg-inplace` 默认关；沙箱全块型检验通过后由用户/主线决定开启

## Acceptance Criteria（切片 1 = p / h1-h6 / quote / callout）
- [ ] 沙箱（quickdev+9333+草稿）：开启 inplace 后点 p/h/quote/callout，编辑态与预览态 computed style
      33 属性逐项一致（含 color/fontWeight/backgroundColor）—— **不再需要 parity-check 穷追，应为 0 或仅定位豁免**
- [ ] 用户可见症状消除：背景不变、无整体加粗
- [ ] 编辑→失焦往返与 overlay 路径逐字节一致（使用既有 round-trip 测试集）
- [ ] 全量：58 文件 / 851+ 用例全绿；既有门禁全过（overlay 契约 / token / 种子同构）
- [ ] undo/redo、Enter 拆分、IME 合成在 inplace 路径可用（与 overlay 同测试集）

## 不做（本任务）
- 切片 2：code / table 的在位化（各自有专用编辑器，另行任务）
- 切片 3：拆除 overlay/snapshot/镜像 CSS 与台账（flag 开启并验证后另做减法）
- 不动主题色；不开源码编辑入口
