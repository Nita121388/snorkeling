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
- [x] 沙箱（quickdev+9333+草稿）：开启 inplace 后点 p/h/quote/callout，编辑态与预览态 computed style
      33 属性逐项一致（含 color/fontWeight/backgroundColor）—— **实测 0 差异，无需任何定位豁免**
      （切片 2a 的 ul/ol 同验；code 走 overlay 回落、table 走单元格内联编辑器）
- [x] 用户可见症状消除：背景不变、无整体加粗（根因是内联 typography 快照 → 在位根已禁用）
- [x] 编辑→失焦往返与 overlay 路径逐字节一致（p 的 `**加粗**`/`*斜体*`、list 多行不丢项、
      callout 前缀与结构保持；另修掉 callout 凭空插入空引用行的数据安全 bug）
- [x] 全量：用例全绿基线不变（既有 17 个失败与本任务无关，失败集合未变大）；既有门禁全过
      （overlay 契约 / token / 种子同构 / md-core 边界），并新增 4 条 A3 门禁
- [x] undo/redo、Enter 拆分、IME 合成在 inplace 路径可用（与 overlay 同测试集）

## 切片 4（flag 转正）
- [x] `wysiwyg-inplace` 默认开；显式 off 仍是回滚阀；新增块型仍可走双轨

## 切片 3（门禁盲区）
- [x] 扫描面从 `.inline-edit-overlay`（690-853）扩到顶层 `.wysiwyg-editor*`（865-956），
      此前不可见的 52 条镜像入台账（`parity-2`）
- [ ] 删掉那 52 条（需先决定是否保留 flag 关闭时的 overlay 回退路径）

## 抽离（D2）—— 前置证据已就绪
- [x] 编辑链路**零 React** 可跑（`host-free-editor-pipeline.test.ts`：源码切片 → 种子 →
      就地编辑 → 序列化 → 重定位/陈旧检测 → 写盘拼接，覆盖 p/list/callout）
- [x] 产出「可搬进 `md-dom` 的符号清单」（见 PROGRESS.md）
- [ ] 建 `packages/md-dom` 并搬迁；`md-schema`；`md-react`；playground
- [ ] **journal 真跑通**（唯一诚实的「可复用」验收）

## 不做（本任务）
- 切片 2b：code / table 的在位化（各自有专用编辑器，另行任务）
- 切片 3 的减法执行：拆除 overlay/snapshot/镜像 CSS 与台账（需先决定回退路径是否保留）
- 不动主题色；不开源码编辑入口
