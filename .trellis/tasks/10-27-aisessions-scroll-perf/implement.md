# 执行计划：AISessions 详情滚动性能整改

## 前置

- [x] `python .trellis/scripts/task.py start 10-27-aisessions-scroll-perf`
- [x] 复读 `session-detail.tsx` 中 `handleDetailScroll` / `renderTimelineItem` / virtualizer 三处
- [x] 确认 `npx vitest run frontend/app/view/aisessions` 基线全绿

## 步骤（每步一个独立 commit，可单独回退）

### Step 1 — 移除流式期间的 `measure()`（成因 1）

文件：`frontend/app/view/aisessions/session-detail.tsx`

- [x] 把 `liveTurn` 依赖改为布尔 `liveTurnActive = liveTurn != null`
- [x] `useEffect(() => { if (!virtualEnabled) return; virtualizer.measure(); }, [virtualEnabled, liveTurnActive, virtualizer])`
- [x] `measureElement` 改为 `(element) => element.offsetHeight`
- [x] 注释说明「每 32ms 换引用的 liveTurn 不能进依赖」
- 验证：流式中 `measure()` 仅边界触发（临时打点确认后移除）
- 回滚点：`git revert <step1>`

### Step 2 — 修复 `MessageCard.memo`（成因 2）

文件：`frontend/app/view/aisessions/session-detail.tsx`、`session-message.tsx`

- [x] `session-detail.tsx` 用 `useRef` 提供稳定 `registerMessageRef(seq, node)` 与
      `openAnnotationsFor(seq, itemKey)`（`useCallback` 依赖尽量为空，必要时用 ref 读最新 state）
- [x] `MessageCard` 新增 props `registerMessageRef`、`onOpenAnnotations` 的稳定版本；
      内部 `useCallback((node) => registerMessageRef(message.seq, node), [message.seq, registerMessageRef])`
- [x] 删除 `renderTimelineItem` 里的内联 `registerRef` / `onOpenAnnotations` 闭包
- [x] `renderTimelineItem` 的 `useCallback` 依赖去掉 `annotations` / `subagentTabCwd` 等可走 ref 的项
- 单测：`session-message.dom.test.tsx` 新增「父级重渲染不引起 MessageCard 重渲染」用例
  （render 计数或 `React.Profiler`）
- 回滚点：Step 2 commit

### Step 3 — 滚动事件 rAF 合并（成因 3）

文件：`frontend/app/view/aisessions/session-detail.tsx`、`timeline-virtual.ts`(+test)

- [x] `timeline-virtual.ts` 新增可测纯逻辑：`createRafCoalescer(cb)`（一帧多次调用只执行一次，
      返回 `{ schedule(), cancel() }`）
- [x] `handleDetailScroll` 改为 `schedule()`；`commitScrollState` 内做
      `nearBottomRef` 更新 + 一次 `setShowJumpPill` + 底部 delta 节流判定
- [x] 卸载时 `cancel()`
- 单测：`timeline-virtual.test.ts` 覆盖 `createRafCoalescer`（fake timers / 手动 rAF 队列）
- 回滚点：Step 3 commit

### Step 4 — 回归与验收

- [x] `npx vitest run frontend/app/view/aisessions` 全绿
- [x] `npm run build:dev` 通过（类型检查）
- [x] 手动回归清单（见 PRD「验收标准」与 design.md §5）：
      搜索跳转 / 批注跳转 / 大纲 active / 自动置底 / 底部 delta 追加 / 子代理归位 / live→落盘交接
- [x] CDP 复测：大会话滚动 + 流式，确认 commit 与 layout 次数下降
- [x] 更新 `.trellis/spec/snorkeling-docs/frontend/component-guidelines.md`：
      新增「虚拟化列表里的 memo：禁止把内联闭包当 props 传给 memo 组件」条目
- [x] `python .trellis/scripts/task.py finish` → `archive`

## 验证命令

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; npx vitest run frontend/app/view/aisessions"
```

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; npm run build:dev"
```

## 实施记录（2026-10-27）

- Step 1：`measureElement` 改 `offsetHeight`；measure effect 改为 `liveTurnActive` 边界触发。
- Step 2：`onOpenAnnotations` 语义改为 `(seq, anchorKey) => void`，父级 `useCallback([])` + `annotationsRef`。
  实施期修正了 PRD 的分析：`MessageCard` 的比较器**不比较** `registerRef`，真正打穿 memo 的是
  `onOpenAnnotations`（已回写 design.md §2.2）。
- Step 3：新增 `createRafCoalescer`（`timeline-virtual.ts`）并接入 `handleDetailScroll`。
- 测试：`npx vitest run frontend/app/view/aisessions` → 30 files / 346 tests 全绿；
  新增 `timeline-virtual.test.ts` 的 `createRafCoalescer` 3 例、`session-message.dom.test.tsx` 3 例。
- 已知非本任务失败：全量 `npx vitest run` 有 12 个文件失败（preview / scripts / blockregistry），
  均与本改动无关且文件未被触碰。

## 风险

| 风险 | 概率 | 缓解 |
|---|---|---|
| 移除 `measure()` 后某类行高变化不被 ResizeObserver 捕获 | 低 | turn 边界全量 measure；库自带 150ms 重算 |
| `MessageCard` props 契约改动影响其他调用点 | 中 | 先 `rg "registerRef="` 确认唯一调用方；保留旧 prop 过渡 |
| rAF 合并导致「跳到最新」按钮出现延迟一帧 | 低 | 一帧 ≈16ms，不可感知；未 nearBottom 时不影响吸底 |
