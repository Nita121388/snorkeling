# Files Block 版本管理图标默认 Tab 化打开（Ctrl 单开）

## Goal

Files（Preview）Block 头部 `code-branch` 图标默认把 Version Control Block **并入当前块所在的 inline tab group**，
只有 Ctrl/Cmd+点击才新开独立 Block；顺带把目录右键菜单里的 VCS 系列入口统一到同一放置策略。

## Background（已核查的事实）

- 图标入口：`frontend/app/view/preview/preview-model.tsx:845`（`endIconButtons` 里的 `vcsButton`）
  → `click: () => fireAndForget(() => this.openVersionControlBlock())`。
- 现状实现：`preview-model.tsx:1942 openVersionControlBlock()` 直接 `await createBlock(blockDef)`，
  **总是新开独立 Block**，没有并入 tab、没有去重。
- 仓库既有约定（本次要对齐的目标语义）：
  - `preview-model.tsx:2010 openPathWithTarget` — 默认入 tab（`openPathInPreviewBlockAsTab`），`forceNewBlock` 才单开。
  - `preview-directory.tsx:618` / `preview-explorer.tsx:1114` — 双击入 tab；`e.ctrlKey || e.metaKey` → `forceNewBlock`。
  - `aisessions.tsx:1572` + `session-detail-block.ts:planSessionDetailOpen` — 默认"聚焦已有 / 并入 tab"，只有 Ctrl 才刻意单开。
- `IconButtonDecl.click` 签名是 `(e: React.MouseEvent<any>) => void`（`frontend/types/custom.d.ts:250`），
  图标点击可以拿到修饰键。
- `layoutModel.addBlockToInlineTab(nodeId, blockId)`（`frontend/layout/lib/layoutModel.ts:1625`）会把单 Block 节点
  自动升级为 inline tab group，并把新块设为 active。
- 目录右键菜单的 VCS 系列：`preview-directory-utils.tsx` 的 `openVcsBlock` / `openMultiVcsBlock` /
  `openHistoryBlock` / `openDiffBlock` / `openCommitsBlock` 同样都是裸 `createBlock`。
- GitNexus 影响面：`PreviewModel.openVersionControlBlock` = **LOW**（1 个直接调用方，即图标 click 的 process）。

## Requirements

### R1 图标点击默认行为

- 裸点击 `code-branch` 图标：Version Control Block 以 **Tab 形式**并入 Files Block 所在的 group。
- 若该节点还是单 Block（非 group），按 `addBlockToInlineTab` 的既有语义升级为 group。
- 打开后焦点切到新 Tab。

### R2 Ctrl/Cmd+点击

- Windows/Linux 用 Ctrl，macOS 用 Cmd（`e.ctrlKey || e.metaKey`）。
- 修饰键按下时保持当前行为：新开独立 Block（走原有 `createBlock`），用于并排对比。
- macOS 上 `Ctrl+click` 是右键语义，不得被当成"新开块"。

### R3 去重与聚焦

- 同一 group 内已存在"同 view + 同关键 meta"的 Block 时，裸点击聚焦它，不重复堆 Tab。
- 去重键按视图区分：`vcs` → `vcs:path`；`vcshistory` / `vcsdiff` → `repopath + filepath`；`vcscommits` → `repopath`。
- 修饰键点击不受去重影响（明确要求单开）。

### R4 失败回退

- `addBlockToInlineTab` 返回 false（目标节点已被关/不在布局里）、或 group 节点取不到时，
  不得丢失用户操作：删除刚创建的孤儿 Block 并回退到原 `createBlock` 路径。

### R5 可发现性

- 图标 `title` 体现快捷键，例如 `Version Control (Ctrl/Cmd+Click: new block)`。

### R6 右键菜单一致性

- 目录/文件右键菜单的 `Open VCS Block`、`Open All Repos`、`View History`、`View Diff`、
  `View Repository Log` 使用与 R1 相同的"默认入当前 group 的 tab"放置策略。
- 菜单项没有修饰键概念，因此菜单这一侧不做"Ctrl 单开"分支。

### R7 不改变的东西

- 不修改 VCS / VCS History / VCS Diff / VCS Commits 视图本身的实现与 block meta 契约。
- 不修改 `createBlock` / `createBlockSplit*` 的公共语义（`global.ts` 不动）。
- 不改后端、不改 RPC。

## Acceptance Criteria

- [ ] 在 Files Block 头部裸点击版本管理图标：VCS Block 作为新 Tab 出现在 Files Block 旁边，布局没有被再拆分。
- [ ] 在同一个 Files Block 上按 Ctrl（mac 为 Cmd）+点击同一图标：新开一个独立 VCS Block，布局被拆分。
- [ ] 重复裸点击同一目录的图标：聚焦已存在的 VCS Tab，不新增重复 Tab。
- [ ] 右键目录 → `Version Control` → `Open VCS Block`：VCS Block 以 Tab 形式并入当前 group。
- [ ] 右键文件 → `View Diff` / `View History`：同样并入当前 group 的 Tab，而不是新拆一个 Block。
- [ ] 图标 title 包含 `Ctrl/Cmd+Click` 提示。
- [ ] 目标 group 节点消失等异常情况下不残留空 Block，且仍能通过回退路径打开 VCS Block。
- [ ] `npx tsc --noEmit -p tsconfig.json` 无新增错误；改动文件 eslint 0 error。
- [ ] 相关既有单测（`frontend/app/view/preview`、`frontend/app/view/aisessions`）保持通过。

## Notes

- 用户已确认（"ok go"）：范围 = 图标默认 Tab 化 + Ctrl 单开；右键菜单 VCS 系列一并统一；去重作为必做项（成本很低）。
- 影响面：`PreviewModel` 类新增一个私有放置方法 + `openVersionControlBlock` 改签名（可选参数，向后兼容）；
  `preview-directory-utils.tsx` 的 4 个 open* 辅助函数改为接受 `model` 参数（同文件内调用点）。
- 详细技术方案见 `design.md`，执行清单见 `implement.md`。
