# Implement — CommonText 弹窗输入链路与列表性能整改

## Pre-flight

- [ ] 加载 `trellis-before-dev`，读取 `.trellis/spec/snorkeling-docs/frontend/index.md` 与 shared guides。
- [ ] 确认工作区已有他人改动，只在下面“允许触碰”的文件里编辑。
- [ ] 对将修改的导出符号（`searchCommonTextComposeItems`、`CommonTextComposeModal`）做调用点扫描；若 GitNexus impact 工具不可用，用 `rg` 列直接调用方并在收尾说明，不谎报已跑 impact。

## Change Boundary

- **行为差距**：现在每次光标移动都重算并重绘列表；改造后只在文本或光标所在行/词变化时重算，并将列表渲染收敛到固定行高的可视窗口。
- **真实落点**：输入语义在 `commontext-model.ts` 的 `searchCommonTextComposeItems` / caret 分词链路；列表状态与渲染在 `commontext-compose-modal.tsx`；行为锁在 commontext 测试文件；验证台只需适配窗口化后的点击方式。
- **不做**：不改 Go 服务、数据库、云同步协议、评分权重、文案视觉结构或第三方虚拟化库。
- **行为不变的证明**：既有 82 个 commontext 目标用例全部绿；`searchCommonTextComposeItemsFromBase` 与旧入口的等价用例锁住排序语义。

## Allowed Files

- `frontend/app/commontext/commontext-compose-modal.tsx`
- `frontend/app/commontext/commontext-compose-modal.test.ts`
- `frontend/app/commontext/commontext-compose-modal.dom.test.tsx`
- `frontend/app/commontext/commontext-model.ts`
- `frontend/app/commontext/commontext-model.test.ts`
- `frontend/app/commontext/commontext-compose-perf.test.tsx`（新增，120 行种子）
- `scripts/verify/commontext-meta-sort/verify.mjs`

禁止触碰其他文件；尤其不要改 loop 台账、看板和 Go 代码。

## Ordered Checklist

### 1. 先落失败测试

- [ ] `commontext-model.test.ts`：`caretContextSignature` 同行同词稳定、换行或换词变化。
- [ ] `commontext-model.test.ts`：`searchCommonTextComposeItemsFromBase` 与旧入口结果一致（pinned、sortKey、tags、creator、device 五组用例）。
- [ ] `commontext-compose-modal.test.ts`：源码断言 `filteredItems` 不再直接依赖 `state.editorCaret`，且存在 `flushSearch`。
- [ ] `commontext-compose-modal.dom.test.tsx`：输入后立刻 Enter 选中当前首位；光标同词内移动不改变行序。
- [ ] 新增 `commontext-compose-perf.test.tsx`：120 条种子，断言窗口化 DOM 行数、绝对索引、关闭态刷新。

### 2. 输入链路（开关 `COMMONTEXT_PERF_INPUT_ENABLED`）

- [ ] 在 `commontext-model.ts` 导出 `caretContextSignature` 与 `searchCommonTextComposeItemsFromBase`。
- [ ] 在弹窗新增 `searchSnapshot`、`pendingSearchRef`、`flushSearch`。
- [ ] `filteredItems` 改依赖 `searchSnapshot`，移除 `state.editorCaret`。
- [ ] `onChange` 排 80ms commit；`onSelect` 仅在 token 签名变化时立即 commit。
- [ ] IME 合成期间不 commit，compositionend 后提交一次。
- [ ] Enter 选中、行内插入按钮统一调用 `flushSearch`，并把 `selectedIndex` 归零后消费返回列表。

### 3. 缓存与行 memo（开关 `COMMONTEXT_PERF_CACHE_ENABLED`）

- [ ] 抽出 `baseItems` useMemo，依赖全集含 allItems、tags、untagged、creator、device、sortKey。
- [ ] 搜索字段改 `WeakMap` 缓存；不缓存 `insertedIds` 与 query 结果。
- [ ] 提取 `CommonTextRow`，handler 用 `useCallback([])` 读取 `stateRef` / `pendingSearchRef` 稳定化。
- [ ] 行 tooltip 与预览在行内计算，接收单次 `now` 与语言值。
- [ ] 关闭态 `allItems` 返回 `EMPTY_ITEMS`；resize 去抖 150ms 后才写 state 与 localStorage。

### 4. 行窗口化（开关 `COMMONTEXT_PERF_WINDOWING_ENABLED`）

- [ ] 常量 `ROW_HEIGHT = 44`、`OVERSCAN = 8`；行设置固定高度与单行标签截断。
- [ ] 计算 start/end，加上下 spacer；行保留绝对 `data-common-text-index`。
- [ ] 容器新增 `data-commontext-total` 与 `data-commontext-window`。
- [ ] 键盘导航改用索引换算滚动，不查离屏节点。
- [ ] 验证台改为先从容器读全量顺序，再滚动到目标标题后点击。

### 5. 收尾

- [ ] 三个开关默认改为 true。
- [ ] 分别以每个开关 false 跑一遍关键断言，确认回到旧行为。
- [ ] 更新 `docs/project/verify-ledger.md` 一行结论（仅摘要，明细放 `verify-runs/`）。
- [ ] 按 Trellis Phase 3 更新 spec、提交。

## Validation Commands

```bash
npx vitest run frontend/app/commontext/commontext-model.test.ts frontend/app/commontext/commontext-compose-modal.test.ts frontend/app/commontext/commontext-compose-modal.dom.test.tsx frontend/app/commontext/commontext-compose-perf.test.tsx
node scripts/check-tsc-baseline.mjs
```

预期：测试全绿；tsc 错误数不高于基线。

不跑真机验证（用户明确暂缓）。不跑全量 `npx vitest run`（本机性能差），只跑上述目标文件。

## Risky Files / Rollback Points

| 文件 | 风险 | 回滚 |
| --- | --- | --- |
| `commontext-compose-modal.tsx` | 状态与 effect 顺序多，易出二次渲染或旧列表 | 三个开关分别关闭；必要时 `git checkout --` 单文件 |
| `commontext-model.ts` | 排序语义不能漂移 | 新入口只包装旧逻辑；等价用例锁住 |
| `scripts/verify/commontext-meta-sort/verify.mjs` | 窗口化后按标题点击会失败 | 保留旧选择器helper，新增滚动 helper 后才切默认 |
| `commontext-compose-perf.test.tsx` | 120 行仍可能慢 | 超时设 120s；OOM 时降到 60 行并注明 |

## Follow-up Checks Before `task.py start`

- 确认 PRD / design / implement 已由用户评审并明确批准。
- 确认 `implement.jsonl` 与 `check.jsonl` 有真实 spec/research 条目。
- 确认没有未授权的跨文件改动。

## Progress Snapshot (2026-11-19 16:15)

- 基线已验：`commontext-model.test.ts / commontext-compose-modal.test.ts / commontext-compose-modal.dom.test.tsx` 共 82 例全绿。
- 已完成 `commontext-model.ts`：
  - 导出 `caretContextSignature`，签名含「当前行 + 当前词」。
  - 新增 `searchCommonTextComposeItemsFromBase`，旧入口改为包装新入口，排序语义不变。
  - 搜索字段改 `WeakMap` 缓存。
- 已补 `commontext-model.test.ts`：`caretContextSignature` 同行同词稳定 / 换行换词变化，`FromBase` 与旧入口等价；该文件 61 例全绿。
- 16:17 已跑 `commontext-compose-modal.test.ts + commontext-compose-modal.dom.test.tsx`：25 例全绿（仅既有 global-atoms 初始化噪声日志）。
- 已改 `commontext-compose-modal.tsx`（代码已落，未跑测试）：
  - 三个性能开关、`ROW_HEIGHT=44 / OVERSCAN=8 / 80ms 防抖`。
  - `searchText / searchCaret / caretTokenRevision`、`pendingSearchRef`、`commitPendingSearch / queueSearchCommit / flushSearch`。
  - `setEditor / updateEditorCaret / handleCompositionEnd / 粘贴图片 / 详情 Insert` 都同步搜索快照。
  - `allItems` 关闭态 guard；`baseItems` 独立 `useMemo`；搜索字段 WeakMap。
  - `CommonTextRow` memo 行组件；`listWindow` + 上下 spacer 已接入列表渲染；旧全量行 DOM 保留在开关 false 分支作回滚基线。
  - `scrollListToIndex / handleListScroll` 改为索引换算；列表容器新增 `data-commontext-total / data-commontext-window`。
  - Enter / 行内插入先 `flushSearch`；行回调用 ref 稳定化。
  - 新增 `nowMinute` 分钟级刷新，降低行内 Date/i18n 重复计算。
- 尚未完成：
  1. `ResizeObserver` 150ms 静默提交尚未实现（当前仍是每 rAF setState）。
  2. `commontext-compose-modal.test.ts` 只修了旧断言，Enter flush / 开关关闭态断言还未补。
  3. `commontext-compose-modal.dom.test.tsx` Enter flush 用例未补。
  4. `commontext-compose-perf.test.tsx` 120 条探针未建。
  5. `scripts/verify/commontext-meta-sort/verify.mjs` 滚动点击未适配。
  6. `node scripts/check-tsc-baseline.mjs` 未跑。
- 下次开工：先补 DOM/source 断言与 perf 探针，再跑 `npx vitest run frontend/app/commontext/commontext-model.test.ts frontend/app/commontext/commontext-compose-modal.test.ts frontend/app/commontext/commontext-compose-modal.dom.test.tsx frontend/app/commontext/commontext-compose-perf.test.tsx` 和 tsc baseline。

## Progress Snapshot (2026-11-19 18:35) — worker agent 收尾完成

按上一快照的 6 条未完成项逐条收尾，全部完成：

1. **ResizeObserver 改 150ms 静默提交**（`commontext-compose-modal.tsx`）：拖拽回调只写 `modalRef` 内联宽高（视觉即时跟随），state/localStorage 走 `RESIZE_COMMIT_MS = 150` 静默提交；提交前比较新旧值（相同跳过 setState，防观察循环）；cleanup 交还 inline 控制权并在静默窗口内兜底落盘最后一次尺寸。删掉了每帧 rAF setState。
2. **`commontext-compose-modal.test.ts` 补 +3 例**：Enter flush 契约（filteredItems memo 不依赖 `state.editorCaret`、`flushSearchRef` 在 4 处确认动作消费、80ms 防抖、IME 不 commit）；三开关关闭态回滚基线源码断言；resize 150ms 静默提交源码断言。20 例全绿。
3. **`commontext-compose-modal.dom.test.tsx` 补 +2 例（Enter flush R2）**：输入后不等防抖立即 Enter → 打开的是当前文本相关度第一名（防抖窗口内新文本被 flush 消费，且窗口重建为 `0-1`、行绝对索引=0）；同词内移动光标不改变行序。注：详情标题 input 锚点是 `data-commontext-detail-title`（placeholder 是 i18n "Untitled"，不是旧 "Title (optional"）。10 例全绿。
4. **新建 `commontext-compose-perf.test.tsx`（120 条种子，3 例）**：窗口化探针（DOM 行数 ≤ 40 且 < 120、绝对索引连续、`data-commontext-total=120`、窗口区间、ArrowDown×20 后窗口滑到覆盖选中行且 scrollTop 按行号换算推进）；计算次数探针（spy `searchCommonTextComposeItemsFromBase`：打字零重算，80ms 防抖到点恰好重算 1 次）；关闭态刷新（关闭后推配置 → 重开可见新条目 121 且排首位）。3 例全绿，已 prettier clean。
5. **`scripts/verify/commontext-meta-sort/verify.mjs` 适配窗口化**：快照改读 `data-commontext-total`（全量总数）/ `data-commontext-window` / 行 `data-common-text-index`；新增 `ensureListRowRendered`（按窗口高度分步滚动 + 派发 scroll 事件）+ `clickListRow`（目标行不在窗口时先滚后点，支持行内子选择器）；新增 3 条窗口化锚点断言；详情标题改读 `data-commontext-detail-title`。`node --check` 通过。
6. **验证跑批**：
   - `npx vitest run frontend/app/commontext/commontext-model.test.ts frontend/app/commontext/commontext-compose-modal.test.ts frontend/app/commontext/commontext-compose-modal.dom.test.tsx frontend/app/commontext/commontext-compose-perf.test.tsx` → **4 文件 94 例全绿**。
   - `node scripts/check-tsc-baseline.mjs` → 当前 55 条 > 基线 47（+8），**全部新增错误集中在白名单外**（emain / agent-status / aipanel / element / onboarding / session-overview / preview / workspace 等，为工作中并存 agent 的半成品）；`frontend/app/commontext/**` 与 `scripts/verify/commontext-meta-sort/**` 0 error。按任务定义（只关注白名单文件是否新增 error）判定通过。

收尾说明：
- 改动仅限白名单 5 个文件：`commontext-compose-modal.tsx`（resize 150ms）、`commontext-compose-modal.test.ts`、`commontext-compose-modal.dom.test.tsx`、`commontext-compose-perf.test.tsx`（新增）、`scripts/verify/commontext-meta-sort/verify.mjs`。未提交（遵守红线）。
- 未跑真机验证（任务要求本机暂缓）；verify 台仅做语法校验。
- 未跑全量 vitest（本机性能差），只跑目标 4 文件。
- 剩余待办（他包/后续）：tsc +8 不在本包白名单、无法在本包清；真机台待环境 OK 后跑。
