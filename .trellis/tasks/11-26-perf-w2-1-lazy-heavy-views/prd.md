# Wave 2-1: Monaco 与重型视图懒加载 + 启动去重

> 来源：`design/plans/snorkeling-perf-wave2-3-handoff-20261126.md` §Wave 2 包 1（W2-1）。
> 用户已授权（2026-11-26：「除了真机验证部分由我来执行，其他的请你将它们做完」）。

## Goal

砍掉每个普通终端 Tab Renderer 被迫加载的三大重型依赖（Monaco、shiki、@observablehq/plot），并消除启动期
5 次 `GetFullConfigCommand` 与 updater 阻塞 —— 缓解 6 个 Renderer 占 1.5GB 与冷切 1s 卡顿。

## 实证根因（handoff 文档锚点，实施前先复核行号）

- `frontend/wave.ts:14-15, 54, 92-96, 274`：静态导入 `monaco-env.ts` 与 `registerBuiltinViews()`，且首帧渲染前同步阻塞 `await loadMonaco()`。
- `frontend/app/monaco/monaco-env.ts:4-20, 49-96`：顶层静态导入 `monaco-editor`、5 种语言 contribution、`monaco-yaml` 和 6 个 `?worker`。
- `frontend/app/block/builtinviews.ts:4-60`：静态导入全部 24 个 ViewModel（AiSessions→`streamdown.tsx` 的 `shiki/bundle/web`、Sysinfo→`@observablehq/plot`、Preview→6,261 行 `markdown.tsx`+`@tanstack/react-table`）灌入每个普通终端 Tab。
- `emain/emain.ts:463`、`emain/emain-window.ts:1402`、`emain/emain-tabview.ts:312`、`frontend/wave.ts:275`、`emain/updater.ts:867`：启动期发 5 次 `GetFullConfigCommand`；`emain/updater.ts:131,369` 的 `await configureAutoUpdater()` 阻塞 `setGlobalIsStarting(false)` 与全局快捷键注册。

## Requirements

- R1 `monaco-env.ts` 拆轻量 theme 同步桩 + 按需 `async ensureMonacoLoaded()`（动态 `import()` 真正的 Monaco 配置模块）；`wave.ts` 移除阻塞式 `loadMonaco()`，仅在 Monaco 已加载时同步主题，未加载时记目标主题待首次打开编辑器再应用。
- R2 `builtinviews.ts`/`blockregistry`：`"term"`（及轻量 `"launcher"`/`"tips"`/`"web"`）保持同步可用；重型视图 ViewModel/`viewComponent` 按需 `React.lazy` / 动态加载；`streamdown.tsx` 的 `shiki/bundle/web` 改按需动态导入 + 有界 LRU 缓存 `codeToHtml` 结果。
- R3 `emain/` 启动缓存一次 `fullConfig` 传给 `relaunchBrowserWindows()` / `getOrCreateWebViewForTab()`（带过期或监听更新）；`configureAutoUpdater()` 改非阻塞后台执行（不阻塞 `setGlobalIsStarting(false)`）。

## Acceptance Criteria（机器判定）

- [ ] 源码契约红测转绿：`npx vitest run frontend/app/block/builtinviews-lazy.test.ts frontend/wave-monaco-lazy.test.ts`（HEAD 上红：重型视图静态 import + wave.ts await loadMonaco + monaco-env 顶层 import monaco-editor）。
- [ ] `npx vitest run frontend/app/block frontend/app/monaco frontend/wave`（涉及面定向回归）全绿。
- [ ] `npx vitest run frontend/app/view/preview`（Preview 懒加载后回归）全绿。
- [ ] `node scripts/check-tsc-baseline.mjs`（57 基线，0 新增）。
- [ ] 构建面：`vite build` 成功（如环境不可用，写进 skipped，由用户真机补）。

### Out of scope

- G7 真机验收（冷切卡顿对比 / 内存采样）→ 用户执行。
- Wave 2-3 的 WPS 合批 / DirectoryTable 虚拟化（另一包）。

## 风险

- React.lazy 需要 Suspense 边界：块视图挂载期的 fallback 不得闪（复用既有 block 加载态）。
- 主题应用时序：未加载 Monaco 时切主题，桩只记目标值。
- emain fullConfig 缓存过期：跟随既有 waveconfig 更新事件失效，别造第二套失效机制。
