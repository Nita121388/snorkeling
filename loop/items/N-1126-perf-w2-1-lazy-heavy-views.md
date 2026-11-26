---
id: N-1126-perf-w2-1-lazy-heavy-views
title: "Wave 2-1: Monaco 与重型视图懒加载 + 启动去重（砍每 Tab Renderer 内存与冷切卡顿）"
type: bug
priority: P0
severity: S2
status: open
origin: self
source: design/plans/snorkeling-perf-wave2-3-handoff-20261126.md
task: 11-26-perf-w2-1-lazy-heavy-views
order: 100
touch: [frontend/wave.ts, frontend/app/monaco/, frontend/app/element/streamdown.tsx, frontend/app/view/sysinfo/, frontend/app/view/preview/preview-model.tsx, frontend/app/block/blockregistry.ts, frontend/app/block/block.tsx, frontend/app/block/heavy-views-lazy.test.ts, frontend/wave-monaco-lazy.test.ts, emain/emain.ts, emain/emain-window.ts, emain/emain-tabview.ts, emain/updater.ts, docs/project/verify-ledger.md, loop/**, .trellis/tasks/11-26-perf-w2-1-lazy-heavy-views/**]
rollback: null
budget: {minutes: 180}
releaseCandidate: false
createdAt: "2026-11-26T13:40:00Z"
---

# Wave 2-1: Monaco 与重型视图懒加载 + 启动去重

## 背景

每个普通终端 Tab 的 Renderer 被迫加载 Monaco（含 5 种语言 contribution + monaco-yaml + 6 worker）、
shiki（streamdown 顶层 import，引用面含 aipanel/onboarding）、@observablehq/plot（sysinfo model 与 view
同文件）、markdown.tsx（6261 行，preview-model 静态 import PreviewView 拖入）；启动期发 5 次
GetFullConfigCommand 且 configureAutoUpdater 阻塞 setGlobalIsStarting(false)。

## 来源

- self：design/plans/snorkeling-perf-wave2-3-handoff-20261126.md §Wave 2 包 1（W2-1）

## 验收判据

- [x] `npx vitest run frontend/app/block/heavy-views-lazy.test.ts frontend/wave-monaco-lazy.test.ts && echo W2_1_CONTRACT_OK` → `W2_1_CONTRACT_OK`（2026-11-26 21:5x：2f/6t 全绿；红证 5 red → 绿）
- [x] `npx vitest run frontend/app/view/sysinfo frontend/app/view/preview frontend/app/element frontend/app/block && echo W2_1_REGRESSION_OK` → `W2_1_REGRESSION_OK`（合跑 term+monaco+wave：138f/1517t 全绿；主 agent 补跑 aipanel+onboarding+aisessions：54f/843t 全绿）
- [x] `node scripts/check-tsc-baseline.mjs && echo W2_1_TSC_OK` → `W2_1_TSC_OK`（57 = 基线 57，0 新增；build:prod 成功 ✓ 1m；emain 86t 全绿）

## 记录

- 红证：`.trellis/tasks/11-26-perf-w2-1-lazy-heavy-views/red-proof.txt`（HEAD 5 red / 1 green 保留约束）
- 实现（trellis-implement 子代理 + 主 agent 复核）：monaco-env 拆轻量桩+按需 loader；wave.ts 启动路径不再 await loadMonaco（Builder 面保持启动即加载）；monaco-react 懒壳；streamdown shiki 单飞动态 import + LRU100；sysinfo 拆 sysinfo-view（plot 只在 view 文件）+ React.lazy；preview-model 改 React.lazy(./preview)；block.tsx 两处既有 Suspense 边界复用；emain fullConfig TTL30s 缓存 + relaunchBrowserWindows 传参 + configureAutoUpdater 非阻塞 fireAndForget。
- **遗留 follow-up（入口 chunk 布局）**：源码层急加载已清零，但 Rollup manualChunks 布局仍让入口静态拉 shiki(9.79MB,共享小工具合并所致)与 monaco(8.16MB,preview-edit getFileLanguage 链 + __vitePreload 分组 + vscode-uri 归并)两个 chunk。修法已实验验证（electron.vite.config.ts manualChunks + getFileLanguage 拆分），预计入口闭包 33.85MB→~15MB。需新开包（白名单 electron.vite.config.ts + preview-edit/aifilediff/vcsdiff）。
- G7 真机验收（冷切卡顿/内存采样）待 nita 执行。
