# md-core 物理抽包：抽出可独立构建的 packages/md-core

## Goal
上一任务已让「4 层零宿主依赖」成为可验证不变量（748 用例 / 边界门禁）。本任务把它**物理搬进 npm workspace 包 `packages/md-core`**，成为**能独立构建、独立测试、可被外部项目依赖**的包 —— 即用户要的「markdown 部分可单独抽离，甚至作为独立项目」。

## 现状（可直接复用的事实）
- npm workspaces 已存在：`['docs', 'tsunami/frontend']`（加一个成员即可）
- 别名定义处：`tsconfig.json`（`@/*`→`frontend/*` 等若干条）+ `electron.vite.config.ts`（alias）+ 根 `vitest.config.ts`
- 待搬：`frontend/app/element/{markdown-transform(12), block-model(4), remark(10), markdown-render(12), markdown-core(3)}`
- 外部引用点 **21 个**（`markdown.tsx`、`markdown-inline-edit.tsx`、`block-editor/**`、`use-editor-history.ts`、`wysiwyg-editor.tsx`、`view/preview/plugins/**` 等）
- 边界门禁白名单（包仍需的**非**包内依赖）：`markdown-util`、`markdown-task-toggle`、`markdown-ordered-list`、`remark-mermaid-to-tag`、`markdown-contentblock-plugin`、`block-editor/flags`、`block-editor/components/table-block`、`copybutton`、`iconbutton`

## Requirements
- R1 新包 `packages/md-core`（name `@snorkeling/md-core`，`"type":"module"`，导出入口 `index.ts`），加入 root `package.json` workspaces
- R2 纯层随包搬入：`markdown-transform` / `block-model` / `remark` / `markdown-render` / `markdown-core` → `packages/md-core/src/{transform,block-model,remark,render,core}`；包内**一律相对导入**
- R3 把包所需的**纯共享根文件**（`markdown-util`、`markdown-task-toggle`、`markdown-ordered-list`、`remark-mermaid-to-tag`）搬入包内；应用侧引用改为 `@md/core/...`
- R4 仍属宿主的部分（`IconButton`/`CopyButton`/`TableBlock`/`features flags`/`contentblock 插件`）**经 host 注入**（扩展现有 `markdown-core/host.ts` 的能力面），使包内**零 `@/` 宿主 import**
- R5 应用侧 21 个引用点改为 `@md/core/...`；别名在 `tsconfig.json` + `electron.vite.config.ts` + `vitest.config.ts` 三处一致添加
- R6 **行为零变化**：不改渲染输出、不改交互、不改写盘逻辑

## Acceptance Criteria
- [ ] `npx vitest run frontend/app/element` + 包内测试 = **748 用例全绿**（用例数不得减少；包内测试随包搬走后仍被 vitest 收集到）
- [ ] `npx tsc --noEmit` = **68**（基线，无新增）
- [ ] 包内 `grep -rn "from \"@/" packages/md-core/src` = **0**
- [ ] `npx vite build`（或 `npm run build:dev`）通过 —— 证明别名在**构建期**也解析正确
- [ ] 边界门禁测试更新为指向新路径且通过
- [ ] `git diff --stat` 显示外部文件仅改导入路径与必要接线，无逻辑改动

## 明确不做
- 不动 `markdown.tsx`（5165 行集成壳）/ `markdown-inline-edit.tsx` / `markdown.scss` 的归属（它们是宿主侧，Phase C 再议）
- 不发布到 npm、不改版本号策略
- 不重构逻辑、不顺手改 bug（发现 bug 只记录）

## 风险与停手条件
若发现「宿主注入点 > 8 处」或「某层其实是宿主强耦合（无法在不动逻辑的前提下解耦）」，**停下来报告**，不要硬搬。
