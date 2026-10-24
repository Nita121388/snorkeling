# Implement — Files Block VCS 入口的放置策略统一

## 0. 前置

- [x] 现状核查：图标入口 `preview-model.tsx:845`、`openVersionControlBlock`(`:1942`)、
      右键菜单 `preview-directory-utils.tsx:496-730`、`IconButtonDecl.click` 签名、`addBlockToInlineTab`
- [x] GitNexus 影响面：`PreviewModel.openVersionControlBlock` = **LOW**（1 个直接调用方）
- [x] 用户确认范围：图标默认 Tab 化 + Ctrl/Cmd 单开 + 右键菜单 VCS 系列统一 + 去重

## 1. 实现（顺序即依赖顺序）

- [x] 1.1 `frontend/app/view/preview/preview-model.tsx` 新增 `openBlockDefAsInlineTab(blockDef, dedupeMetaKeys?)`
  - [x] 取宿主 node，无 node 返回 false
  - [x] 去重：同 view + 指定 meta 键全等 → `setActiveInlineTabBlock` 并返回 true
  - [x] `ObjectService.CreateBlock` → `addBlockToInlineTab` → `focusBlockById`
  - [x] 失败分支 `DeleteBlock` 清孤儿块并返回 false
- [x] 1.2 `openVersionControlBlock(options?: { forceNewBlock?: boolean })`
  - [x] `forceNewBlock` 时跳过 inline-tab 分支
  - [x] 否则尝试 `openBlockDefAsInlineTab(blockDef, ["vcs:path"])`
  - [x] 失败回退 `createBlock`
- [x] 1.3 图标接线：`click: (e) => ... openVersionControlBlock({ forceNewBlock: e.ctrlKey || e.metaKey })`
  - [x] `title` 改为 `Version Control (Ctrl/Cmd+Click: new block)`
- [x] 1.4 `frontend/app/view/preview/preview-directory-utils.tsx`
  - [x] `openVcsBlock` / `openMultiVcsBlock` / `openHistoryBlock` / `openDiffBlock` / `openCommitsBlock` 增加 `model` 参数
  - [x] 各自走 `model.openBlockDefAsInlineTab(blockDef, 去重键)`，失败回退 `createBlock`
  - [x] `makeDirectoryVcsMenuItems` 内全部调用点透传 `model`

## 2. 验证

- [x] 2.1 `npx tsc --noEmit -p tsconfig.json` 无新增错误（72 条既有错误，与基线逐条一致）
- [x] 2.2 `npx eslint` 改动文件 0 error
      （1 条既有 warning：`preview-model.tsx` 的 `directorySearchActive` 未使用）
- [x] 2.3 `npx vitest run frontend/app/view/preview` → 315 passed / 18 failed，
      失败集与基线完全一致（`html-export` / `obsidian-properties-card` / `preview-directory-utils` 的 `isPinned` 类旧失败）；
      新增 `preview-inline-tab.test.ts` 8 例全绿 + `preview-directory-utils.test.ts` 新增 1 例全绿
- [ ] 2.4 手动 / CDP（用户确认项，本轮未启动 app）
  - [ ] 裸点图标 → VCS 以 Tab 出现在 Files 旁边，布局未再拆分
  - [ ] Ctrl/Cmd+点图标 → 新开独立 Block
  - [ ] 重复裸点 → 聚焦已有 VCS Tab
  - [ ] 右键 `Open VCS Block` / `View Diff` → 并入当前 group 的 Tab

## 3. 收尾

- [x] 3.1 更新 `.trellis/spec/snorkeling-docs/frontend/quality-guidelines.md`
      （「旁支视图入口的放置策略：默认入 Tab，Ctrl 才单开」）
- [x] 3.2 提交 `feat(preview): open VCS blocks as inline tabs by default`

## 实现记录

- 去重规则抽成纯函数 `findInlineTabDedupeMatch`（`preview-inline-tab.ts`）+ 8 例单测，
  不把它烤进 `PreviewModel`（该类依赖 mock env，难单测）。
- 归一化除分隔符/重复斜杠外还去掉尾斜杠：`/repo` 与 `/repo/` 是同一个仓库根（单测发现的真实差异）。
- `vcs:selectedfile` **不**参与去重：VCS 视图是“按仓库”的视图，同仓库换文件不应堆 Tab；
  代价是聚焦已有块时其选中高亮可能仍是之前那个文件（可接受，不为此增加 meta 回写）。

## 回滚点

- 1.1 是唯一新增设施，1.2/1.3/1.4 都是它的调用方；任一步出问题可单独 revert 对应文件。
- 不涉及后端、协议与布局数据格式。
