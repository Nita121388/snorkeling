---
id: N-1127-perf-w2-1b-entry-chunk-layout
title: "Wave 2-1b: 入口 chunk 布局——monaco/shiki 脱离入口静态闭包（31.52MB → 10.62MB）"
type: bug
priority: P0
severity: S2
status: open
origin: self
source: 11-26 W2-1 子代理构建分析 follow-up（实测实验验证）
task: 11-27-perf-w2-1b-entry-chunk-layout
order: 100
touch: [electron.vite.config.ts, frontend/app/view/preview/preview-file-language.ts, frontend/app/view/preview/preview-edit.tsx, frontend/app/view/preview/chunk-layout.test.ts, frontend/app/view/aifilediff/aifilediff.tsx, frontend/app/view/vcsdiff/vcsdiff.tsx, docs/project/verify-ledger.md, loop/**, .trellis/tasks/11-27-perf-w2-1b-entry-chunk-layout/**]
rollback: null
budget: {minutes: 90}
releaseCandidate: false
createdAt: "2026-11-27T00:15:00Z"
---

# Wave 2-1b: 入口 chunk 布局

## 背景

W2-1 在源码层清零了急加载（契约测试锁死），但实测构建产物入口静态闭包仍 31.52MB：
1. aifilediff/vcsdiff 为拿 `getFileLanguage` 静态 import `preview-edit.tsx`（静态 import monaco-editor）
   → monaco 7.78MB chunk 进每个终端 Tab 入口；
2. vite preload-helper 被 rollup 分进 monaco manual chunk（入口为拿 1KB helper 拉整包）；
3. manualChunks 把已是动态 import 的 mermaid/cytoscape/katex 强制分组后因执行顺序被入口 bare-import 整包拖入（3.35+1.47+0.46MB）。

## 治理与实测

- `preview-file-language.ts`（新，零重型依赖）：shellFileMap/extensionLanguageMap/getFileLanguage；
  preview-edit re-export 保持兼容，aifilediff/vcsdiff 改直引。
- manualChunks：monaco 组收窄到 `monaco-editor/` + `monaco-yaml/`；`vite/preload-helper` 单开；
  移除 mermaid/cytoscape/katex 强制分组。
- 实测入口静态闭包 **31.52MB → 10.62MB**（-66%）；chunk 明细：
  index 9.62 + shiki 1.00 + vite-helper 0.00。

## 验收判据

- [x] `npx vitest run frontend/app/view/preview/chunk-layout.test.ts && echo W2_1B_LAYOUT_OK` → `W2_1B_LAYOUT_OK`（5t 全绿，红证 5 red）
- [x] `npx vitest run frontend/app/view/preview frontend/app/view/aifilediff frontend/app/view/vcsdiff --no-file-parallelism && echo W2_1B_REGRESSION_OK` → `W2_1B_REGRESSION_OK`（38f/457t 全绿）
- [x] `node scripts/check-tsc-baseline.mjs && echo W2_1B_TSC_OK` → `W2_1B_TSC_OK`（57 = 基线 57）
- [x] `npx electron-vite build` + 闭包测量脚本 → 入口静态闭包 **10.62MB**（≤12MB；改善前 31.52MB，-66%）

## 记录

- 红证：`.trellis/tasks/11-27-perf-w2-1b-entry-chunk-layout/red-proof.txt`（HEAD 5 red）
- 注：本包由 W2-1 子代理的构建分析直接续做（实验已验证收益），主 agent 实机迭代测量。
