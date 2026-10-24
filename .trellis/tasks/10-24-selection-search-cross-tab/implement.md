# Implement — Selection Search In Files 跨 Tab

## 前置核对（开工前 10 分钟，不改代码）

- [ ] `python .trellis/scripts/task.py current` 确认活动任务正确。
- [ ] 实测三个 design 待确认项，把结论写回 `design.md` 第 7 节：
  1. `TabTargetModal` 是否可脱离 workspace modal 流程单独调用（读 `frontend/app/tab/tab-target-modal.tsx` 的 props 与调用点）。
  2. `atoms.workspace.tabids` 是否含全部 Tab（`global-atoms.ts:51`）。
  3. 非活跃 Tab 的 Block 对象是否在 WOS 中可读（切到 Tab A 后，`globalStore.get(WOS.getWaveObjectAtom("block", <TabB 的 blockId>))` 是否非空）。
- [ ] GitNexus `impact({target: "openPathInPreview", direction: "upstream"})`，把调用方与风险等级记到本文件末尾。

## Step 1 — 补既有回归网（先测后改）

- [x] 在 `frontend/app/view/preview/file-link-navigation.test.ts` 增加：不传 `tabId` 时 `openPathInPreview` 走到当前 Tab 的树 block、复用已有 block、建新 block 三条用例（mock 必需依赖）。
- [x] 确认 `npx vitest run frontend/app/view/preview` 当前基线（见文末「Step 6 全量验证」）。

## Step 2 — 参数化 `openPathInPreview`

- [x] `FileLinkOpenOptions` 增加 `tabId?: string | null`。
- [x] `findTreeFilesBlock` / `findExistingNonEditPreviewBlock` / `focusTreeBlock` 接受 `tabId` 参数，删除内部对 `atoms.staticTabId` 的直读。
- [x] `openPathInPreview` 入口 `const tabId = options?.tabId ?? globalStore.get(atoms.staticTabId)`。
- [x] 缺省路径不得调用 `setActiveTab` / 任何等待逻辑（保证 R3.3）。
- [x] 自动化回归 `npx vitest run frontend/app/view/preview`（结论见文末）；markdown / 树双击 / 编辑器 action 三处代码路径经静态走查保持等价（未做 GUI 手工回归）。

## Step 3 — 跨 Tab 打开时序（**已按实测修正，`waitForActiveTab` 方案作废**）

`staticTabId` 在同一 renderer 内不可变，`createBlock` 永远落在调用方 Tab，因此：

- [x] 跨 Tab 建块改用 `ObjectService.CreateBlockInTab(targetTabId, blockDef, DefaultCreateBlockRuntimeOpts, false, magnified)`（先例：`widgets.tsx:2084`）。
- [x] 顺序：建 block（服务端落目标 Tab）→ 写 reveal meta → `getApi().setActiveTab(targetTabId)`。
- [x] **跨 Tab 不调 `refocusNode`**（内部写死 static tab）；聚焦交给目标 Tab 的 renderer。
- [x] 复用已有块：`restoreMinimizedBlockToLayout(tabId, blockId)` / `getLayoutModelForTabById(tabId)`。
- [x] 当前 Tab 分支保持原样，零额外开销。

## Step 4 — 目标收集改造（核心）

- [x] 把 `PreviewOpenTarget` 改为 `PreviewTarget`（design 2.3）：注入 `stat` 函数、携带 `tabId` / `isCurrentTab`。
- [x] 保留 BCM 来源（当前 Tab），`stat` 走 `model.statFile` / `model.formatRemoteUri`，标记 `isCurrentTab = true`。
- [x] 新增元数据来源：按 design 2.2 枚举 `atoms.workspace.tabids` → Tab → Block，筛选条件逐条对齐 PRD R1.4 / R1.5 / R1.6。
- [x] 元数据的 `stat` 走 `RpcApi.FileInfoCommand` + `formatRemoteUri(path, connection)`。
- [x] 加入 `withConcurrency(4)`、`statWithTimeout(1500)`、单次查找 `Map` 缓存（design 2.4）。
- [x] 合并两类来源后去重（`connection + lowercased path`），当前 Tab 目标排在最前。
- [x] `scoreTarget` 追加 `isCurrentTab ? +20 : 0`。
- [x] 移除 `SearchInFilesMaxTargets = 8` 的静默截断，改为 `MaxTargetsPerTab=4` + `MaxTotalTargets=32`（`limitTargetsPerTab`，当前 Tab 因排序最前优先生效）。

## Step 5 — 歧义与反馈

- [x] 并列判定改为跨 Tab 才歧义（同 Tab 重复 block 取首个）。
- [x] 实现候选选择：用 `ContextMenuModel` 列表（`TabTargetModal` 已实测不适用，design §7.1）。
- [x] `searchSelectionInFiles` 增加可选 `onFeedback?: (msg: string, kind: string) => void`；缺省退化为 `window.alert`。
- [x] `selection-copy-overlay.tsx` 透传气泡回调，文案 `Opened in Tab "<name>"` / `Searched N tab(s) but no matching file…`。
- [x] 未命中文案改为可诊断信息（PRD R4.4），旧 `No Files block is open in this tab.` 已删除。

## Step 6 — 测试与验收

- [x] 新增 `frontend/app/element/selection-search-in-files.crosstab.test.ts`：目标收集（mock 对象存储）、当前 Tab 优先、connection 隔离、歧义判定、跨 Tab 路由。
- [x] 自动化回归：`npx vitest run frontend/app/element` **498 全绿**；`npx vitest run frontend/app/view/preview` **18 failed / 322 passed**，失败集合与 HEAD 基线逐条一致（详见文末）。
- [x] `npx tsc --noEmit -p tsconfig.json` **70 error（基线 72，无新增，反而少 2 个既有 error）**；eslint 改动文件 **clean**。
- [ ] 手工验收 PRD 全部 Acceptance Criteria（3 Tab 场景：`snorkeling` / `docs` / 无 Files）——**需在运行中的 Electron 内人工完成**。
- [ ] `detect_changes()` 确认改动面只覆盖预期符号——**提交前由主会话执行**。

## 回滚点

| 回滚点 | 状态 |
|---|---|
| R0 | Step 1 完成，只有测试新增，源码未动 —— 可直接 revert |
| R1 | Step 2 完成，`tabId` 参数化但无调用方使用 —— 行为等价旧版，安全 |
| R2 | Step 3-4 完成，跨 Tab 生效 —— 出问题关掉「跨 Tab 来源」即可回落 Step 2 状态 |
| R3 | 全部完成 |

## 影响面记录（Step 0 填写）

### GitNexus impact（2026-10-24）

```
node .gitnexus/run.cjs impact openPathInPreview --direction upstream \
  --file frontend/app/view/preview/file-link-navigation.ts

risk: HIGH   epistemic: exact   impactedCount: 12
summary: direct 3, processes_affected 1, modules_affected 3 (Preview/Element/Workspace)
```

**直接调用方（depth 1）**

| 符号 | 文件 |
|---|---|
| `searchSelectionInFiles` | `frontend/app/element/selection-search-in-files.ts` |
| `openFileLinkInPreview` | `frontend/app/view/preview/file-link-navigation.ts` |
| `openSearchPath` | `frontend/app/view/preview/preview-explorer.tsx` |

**间接（depth 2，需一并回归）**：`markdown.tsx:onClick`、`streamdown.tsx:onClick`、`selection-copy-overlay.tsx` 的 `handleSearchInFiles`/`click`、
`preview-edit.tsx:run`（编辑器 `searchInFiles` action）、`preview-explorer.tsx` 的 `queueSearchSingleOpen`/`openSearchDouble`。
受影响执行流：`PreviewExplorer`（earliest_broken_step 1）。

> 风险等级 **HIGH**（与 design §5 预判一致）。缓解：`tabId` 缺省路径完全等价旧行为，且 Step 1 先落地 3 条默认路径回归用例（R0 回滚点）。

### Step 1 基线（改源码前）

`npx vitest run frontend/app/view/preview` → 31 文件 / 333 用例：**17 failed, 316 passed**。
失败集合稳定为 3 个**与本任务无关的既有红**：`plugins/export/html-export.test.ts`、
`plugins/md-properties/obsidian-properties-card.test.tsx`、`preview-directory-utils.test.ts`。
`file-link-navigation.test.ts` 全绿（9 用例），作为本任务基线。

### Step 2 后验证

- `npx vitest run frontend/app/view/preview` → 338 用例：**17 failed, 321 passed**（失败集合与基线逐条一致，新增 5 用例全绿）。
- `npx vitest run frontend/app/element` → 37 文件 / **487 用例全绿**。
- `npx tsc --noEmit -p tsconfig.json` → 改动前后均 **72 个 error**，均为既有错误（含 `file-link-navigation.ts:314 statPath` 的
  `FileInfo.mimetype` 缺失告警，源自工作区中他人未提交的 `gotypes.d.ts` 改动），**无新增**。
- `npx eslint` 两个改动文件 → 无输出（clean）。
- `npx prettier --check` → 两个文件在改动前即为 warn，未新增格式漂移（未执行 `--write`，避免制造无关 diff）。

### 遗留 / 下一轮

- Step 3 依赖 design §7.4 的冲突结论：`waitForActiveTab` 不可行，需改走 `CreateBlockInTab` + `getLayoutModelForTabById`。**开工前需确认。**

### Step 6 全量验证（2026-10-24，check agent 复核）

命令均在 `powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; <cmd>"` 下执行。

| 命令 | 本次结果 | 对拍基线 | 结论 |
|---|---|---|---|
| `npx vitest run frontend/app/element` | 38 文件 / **498 passed, 0 failed** | 改动前 487 全绿 | **无回归**，新增 11 用例（crosstab）全绿 |
| `npx vitest run frontend/app/view/preview` | 31 文件 / **18 failed, 322 passed (340)** | **HEAD 实测同样 18 failed / 315 passed (333)**（见下） | **无回归**：新增 7 用例全绿，失败集合逐条一致 |
| `npx tsc --noEmit -p tsconfig.json` | **70 error** | 记录值 72 | **无新增**（少 2 个），且唯一涉及 `file-link-navigation.ts` 的是既有 `statPath`（旧 309 行→现 342 行）`mimetype` 告警 |
| `npx eslint <改动 5 文件>` | 无输出 clean | — | **无新增 lint 错误** |

**基线修正（关键）**：`implement.md` 旧记录的「17 failed / 316 passed」已过时。
本机在**完整套件**下对 **HEAD（stash 掉本任务 4 个改动文件 + 移走新测试）** 实测为
**18 failed / 315 passed (333)**，失败仍集中在 3 个既有红文件：`preview-directory-utils.test.ts`、
`plugins/export/html-export.test.ts`、`plugins/md-properties/obsidian-properties-card.test.tsx`。
其中 `preview-directory-utils.test.ts` 单独运行稳定为 **13 failed / 14 passed**（均为 5s `Test timed out`，
与 `file-link-navigation` / `selection-search-in-files` 无依赖关系），整套件下偶发多 1 条超时是既有 flaky，非本任务引入。

**结论：本任务零新增失败、零新增类型错误、零新增 lint 错误。**

### PRD 逐条核对（check agent）

- R1.1 当前 Tab 优先：`collectMountedTargets` 标 `isCurrentTab`，排序 + `+20` 分，✓
- R1.2 其它 Tab：`collectObjectStoreTargets` 枚举 workspace tabids，✓
- R1.3 不依赖挂载：对象存储 + `loadAndPinWaveObject` + RPC stat，不实例化 PreviewModel，✓
- R1.4 connection 隔离：**按 target 各自 connection 发起 stat**，绝对路径不会串 connection（crosstab 测试已覆盖）；⚠ 但搜索范围本身未按单一 connection 过滤，相对路径若在 local 与远端树同时存在会产生跨 connection 歧义候选（见「问题清单」）。
- R1.5 只认 tree、排除 edit：`isTreeDisplayPreviewBlock`（view=preview && edit!==true && displayMode==tree），✓
- R1.6 根推导：`preview:explorer-root` → `meta.file`（stat 为目录才认），✓
- R1.7 `scoreTarget` +20 当前 Tab 权重，✓
- R2.1/R2.2/R2.3/R2.4/R2.5/R2.6/R2.7：`openResolvedTarget` + `openPathInPreview({tabId})` 分支覆盖，✓
- R3.1 `tabId?` 缺省回落 staticTabId，✓；R3.2 全部 tab 相关函数按 tabId 工作，✓；
- R3.3 缺省等价旧行为：`isCrossTab` 为 false 时不调 `setActiveTab`；`focusTreeBlock` 仅在 `tabId===staticTabId` 时 `refocusNode`；`createPreviewBlock` 仅跨 Tab 才走 `CreateBlockInTab`——静态走查等价，✓（唯一差异：`findTreeFilesBlock` 现经 `isTreeDisplayPreviewBlock` 额外排除 edit 块，而 edit 块 `meta.file` 为文件、原 stat 目录校验本就会 skip，实际结果不变）
- R3.4 顺序建块→写 reveal→`setActiveTab`，✓
- R4.1 ContextMenu 候选（Tab 名 + 相对路径），✓；R4.2 唯一直接开，✓；R4.3 `Opened in Tab "<name>"` 气泡，✓；R4.4 未命中文案可诊断，旧文案已删，✓；R4.5 解析 null 仍走 `No file reference found…`，✓
- R5.1 `StatConcurrency=4`，✓；R5.2 `StatTimeoutMs=1500`，✓；R5.3 `makeCachedStat` 缓存，✓；R5.4 RPC 异常统一吞成 null，✓；R5.5 匹配阶段并发（⚠ 收集阶段对无 explorer-root 的块为串行 stat，见问题清单）
- R6.1/R6.2/R6.3：crosstab 11 用例 + file-link-navigation 新增用例 + 既有测试全绿，✓

### 问题清单（check agent，按严重度）

1. **【中】R1.4/R5.5 部分偏差（非阻断，需产品确认）**
   - `collectPreviewTargets` 收集全部 Tab（含不同 connection），未按发起方 connection 过滤搜索范围。
     绝对路径不会误串 connection（stat 按各自 connection 发生，已测），但同一**相对路径**在 local 与远端树都存在时，会产出跨 connection 的歧义候选。
     若产品要求严格「不混查」，需引入「发起 connection」并过滤 target；当前无该入参。
   - `collectObjectStoreTargets` 对「无 explorer-root 且 meta.file 为目录」的块逐 Tab **串行** `withStatTimeout` stat（R5.5 禁止的全量串行 stat 的弱化版）；匹配阶段已并发。量级随 Tab 数线性，典型工作区可忽略，但严格对齐 R5.5 可改为并发收集。
2. **【低】`handleSearchInFiles` 在无 `onCommonTextFeedback` 宿主时**`feedbackShown` 仍置 true，导致 overlay 多停留 1600ms（无气泡可见）。无功能危害。
3. **【信息】手工 Acceptance Criteria 与 `detect_changes()`** 未由 check agent 执行（需运行中的 Electron / 主会话提交前执行）。

