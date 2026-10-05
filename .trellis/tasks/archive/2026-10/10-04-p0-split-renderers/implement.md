# P0 Implement Plan

## 状态：实施完成 ✓（2026-10-05）

## 前置
- 工具链：node_modules 已就绪（从 main 硬链接复制）。
- 基线：`markdown` 相关 4 个测试文件 / 141 个测试已全绿。
- 影响分析：已完成（源码级），风险 LOW，外部仅依赖 `Markdown` + `computeListInsertAnchor`。

## 执行记录
- 新建 `markdown-render/`（11 个文件）：shared.ts / heading.tsx / list.tsx / table.tsx /
  mermaid.tsx / code-block.tsx / image.tsx / link.tsx / waveblock.tsx / renderer-registry.tsx / index.ts
- markdown.tsx 从 6131 行降到 4590 行（-1589 行），对外导出不变（Markdown + computeListInsertAnchor +
  重导出 splitOrderedListItemChildren / shouldOpenMarkdownLinkInNewBlock）。
- `markdownComponents` useMemo 改为调用 `buildMarkdownComponents(ctx)`，依赖数组逐项保留。
- 测试验证：35 个 element 测试文件 / 469 测试全绿；tsc 对比 HEAD 无新增错误。


## 执行顺序

### Step 1 新建 shared.ts
把以下符号从 markdown.tsx 模块级(167-1784)原样搬入 `frontend/app/element/markdown-render/shared.ts`：
- `getSourceLine` / `getSourceLineEnd` / `sourceLineAttrs` / `srcLineAttrs`
- `getTextContent` / `isLineBreakNode` / `isBlankTextNode` / `trimBlankTextNodes` / `cloneWithChildren` / `splitChildrenAtFirstBreak` / `splitOrderedListItemChildren` / `getOrderedListItemId`
- `OrderedListContext`
- mermaid 单例：`initializeMermaid` / `mermaidInstance`
补 import：clsx、react(Children/cloneElement/isValidElement/createContext/useContext)、mermaid。
`splitOrderedListItemChildren` 在 shared.ts 导出，并从 markdown.tsx re-export。

### Step 2 逐个拆块组件文件
每个文件原样搬移组件 + 相关常量子模块：
- heading.tsx: `CollapsibleHeading` + `HeadingProps`
- list.tsx: `MarkdownOrderedList`/`MarkdownUnorderedList`/`CollapsibleOrderedListItem`/`MarkdownListItem`/`MarkdownTaskCheckbox`（含 toggleTaskCheckboxAtLine 依赖）
- table.tsx: `CollapsibleTable`
- mermaid.tsx: `Mermaid` + inline `Code`(mermaid 分支)
- code-block.tsx: `CodeBlock` + `ShellLikeLangs`/`isShellLike`/`CodeBlockCollapseLineThreshold`（含 setCodeBlockLanguage 依赖）
- image.tsx: `MarkdownImg` + `MarkdownSource`（含 markdown-util 图片编辑依赖、ImageLightbox、ContextMenuModel）
- link.tsx: `Link` + `MarkdownLinkTooltip` + `MarkdownLinkEditor` + `shouldOpenMarkdownLinkInNewBlock`
- waveblock.tsx: `WaveBlock` + `WaveBlockProps`

### Step 3 写 registry.ts + index.ts
- 定义 `MarkdownRenderContext`（见 design.md）
- `registerMarkdownRenderer`/`getMarkdownRenderer`/`listMarkdownRenderers`/`buildMarkdownComponents(ctx)`
- 各块文件调用 `registerMarkdownRenderer` 注册
- index.ts 统一 re-export

### Step 4 改 markdown.tsx
- 删除已拆出的模块级符号（167-1784 中对应部分）
- 保留/重导出：`Markdown`、`computeListInsertAnchor`、`splitOrderedListItemChildren`、`shouldOpenMarkdownLinkInNewBlock`
- `markdownComponents` useMemo 改为 `buildMarkdownComponents(ctx)`，**依赖数组逐项保留原引用**
- 主组件保留 p/hr/span/button/emoji 等简单映射（或一并交 registry，以保持 memo 语义为准）

### Step 5 验证
1. `npx vitest run` markdown 相关 4 文件 → 141 全绿
2. 全量 `frontend/app/element` 测试跑一遍确认无回归
3. `npx tsc --noEmit`（frontend 范围）无新增错误
4. `git diff` 人工核对：markdown.tsx 仅删符号/改 components 组装，无行为改动
5. GitNexus `detect_changes` 对比：受影响符号仅限预期块组件

### Step 6 提交
- pwd && git branch 二次确认
- 单 commit，关联 P0

## 校验门
- [ ] markdown 4 文件 141 测试全绿
- [ ] 相关 element 测试无回归
- [ ] tsc 无新增错误
- [ ] 对外导出符号不变（Markdown/computeListInsertAnchor/splitOrderedListItemChildren/shouldOpenMarkdownLinkInNewBlock）
