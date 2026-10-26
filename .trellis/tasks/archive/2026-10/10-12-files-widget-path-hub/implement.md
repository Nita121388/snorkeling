# Implement — Files 悬浮窗升级为路径中枢

> 执行顺序按"先契约、后纯逻辑、再接线、最后 UI"排列。每一步都可单独验证，失败即停在该步。

## Step 0 — 前置检查（不改代码）

```bash
git status --short
node scripts/run-task.mjs check:ts   # 或 npx tsc --noEmit
npm run test -- --run
```

- [ ] 确认起点干净（只有 `.trellis/` 未跟踪）
- [ ] 记录基线：tsc 通过、测试通过数（用于对比）

**Rollback point R0**：无改动，随时可放弃。

---

## Step 1 — 后端配置契约（Go）

**改动**
- `pkg/wconfig/settingsconfig.go`
  - 新增 `PathUsageEntryType`（紧邻 `PinnedDirectoryType`，见 design §2.1）
  - `SettingsType` 新增 `PreviewPathUsage []PathUsageEntryType \`json:"preview:path-usage,omitempty"\``（紧邻 `PreviewPinnedDirectories`）
- `pkg/wconfig/metaconsts.go`
  - 新增 `ConfigKey_PreviewPathUsage = "preview:path-usage"`（紧邻 `ConfigKey_PreviewPinnedDirectories`）

**验证**

```bash
grep -rn "preview:path-usage\|PreviewPathUsage\|PathUsageEntryType" pkg/wconfig/
cd pkg && go build ./wconfig/    # 或 node scripts/run-task.mjs build:backend:quickdev
```

- [ ] 两个 json tag 完全一致：`preview:path-usage`
- [ ] `go build ./...`（wconfig 包）通过

**Rollback point R1**：`git checkout -- pkg/wconfig/`

---

## Step 2 — 重新生成 TS 绑定

```bash
node scripts/run-task.mjs generate
git diff --stat
```

- [ ] `frontend/types/gotypes.d.ts` 出现 `PathUsageEntryType` 与 `preview:path-usage`
- [ ] `git diff --stat` 只有预期生成文件变化（无意外大范围重写）
- [ ] 若 `generate` 需要工具链：先 `npm run setup`，再重试

**Rollback point R2**：与 R1 一起回滚（生成物必须与 Go 源码同步回滚）。

---

## Step 3 — 纯逻辑 `path-usage.ts` + 单测

**新文件**
- `frontend/app/view/preview/path-usage.ts`
- `frontend/app/view/preview/path-usage.test.ts`

**接口**（design §3.1）：类型 + 常量 + `normalizeUsagePath` / `usageEntryKey` / `isNoiseUsagePath` / `recordPathUsageEntry` / `removePathUsageEntry` / `pathUsageScore` / `selectFrequentPaths` / `selectRecentPaths`

**约束**
- 不 import jotai / react / `@/store/*` / electron（保证可纯测）
- 归一化、噪音规则、打分公式严格按 design §2.2–§2.5
- 无变化时返回**原数组引用**（调用方据此跳过写入）

**测试必须覆盖**（对应 AC11）
- [ ] 归一化：尾随斜杠、`\`→`/`、空白
- [ ] 噪音：`/tmp/...`、`.../node_modules/...`、`.../.git/...` 命中；`~`、普通目录不命中
- [ ] 记录：首次 count=1；重复 count 递增且 lastAt 更新；kind 以最新为准
- [ ] connection 隔离：同 path 不同 connection = 两条
- [ ] 上限：超过 `PathUsageMaxEntries` 淘汰最低分
- [ ] 衰减：count 相同但更新时间更早 → score 更低
- [ ] frequent：count<2 不入选；按 score desc；limit 生效
- [ ] recent：按 lastAt desc；`excludeKeys` 生效
- [ ] remove：精确移除一条，其余不动

**验证**

```bash
npx vitest run frontend/app/view/preview/path-usage.test.ts
node scripts/run-task.mjs check:ts
```

**Rollback point R3**：删除两个新文件。

---

## Step 4 — 面板 view model `path-panel-model.ts` + 单测

**新文件**
- `frontend/app/view/preview/path-panel-model.ts`
- `frontend/app/view/preview/path-panel-model.test.ts`

**接口**（design §3.3）：`PathSelection` / `PathPanelRow` / `PathPanelSection` / `buildPathPanelSections` / `flattenPanelRows` / `formatPath`（从 `preview-new-files.tsx` 迁移过来的纯函数）

**测试必须覆盖**（对应 AC5 / AC7）
- [ ] query 空 → pinned/frequent/recent 三块，顺序固定
- [ ] frequent 与 recent 互斥（recent 排除 frequent 与 pinned 的 key）
- [ ] query 非空 → 单块 `search`，匹配 path 或 basename，大小写不敏感
- [ ] query 非空时不出现空分区块
- [ ] pinned 行的 `pinned=true`；usage 行若在 pinned 中 `pinned=true`
- [ ] `flattenPanelRows` 顺序与分区顺序一致
- [ ] empty hint 在对应分区为空且 query 为空时提供

**验证**

```bash
npx vitest run frontend/app/view/preview/path-panel-model.test.ts
```

**Rollback point R4**：删除两个新文件。

---

## Step 5 — store 接线 `path-usage-store.ts`

**新文件**：`frontend/app/view/preview/path-usage-store.ts`

**接口**（design §3.2）：`pathUsageAtom`（派生自 `getSettingsKeyAtom("preview:path-usage")`）、`recordPathUsage`、`removePathUsage`、`flushPathUsageWrites`

**约束**
- 读：`pendingEntries ?? globalStore.get(pathUsageAtom)`
- 写：600ms 节流合并 → `RpcApi.SetConfigCommand(TabRpcClient, { "preview:path-usage": entries })`
- 回声与 `pendingEntries` 深度相等时清空缓冲
- 预览窗口（NullAtom）下 no-op
- 写失败只 `console.warn`，不抛出

**验证**

```bash
node scripts/run-task.mjs check:ts
npx vitest run frontend/app/view/preview/ path-usage
```

- [ ] 无循环 import 警告（`@/store/global` → 不反向 import preview）

**Rollback point R5**：删除新文件（Step 6/7 尚未接线，可安全暂停）。

---

## Step 6 — 记录埋点（`preview-model.tsx`）

**改动**
- 删除：`recentDirs` 字段声明与初始化、`trackRecentDir()`、`clearRecentDir()`
- 新增：`_pathUsageUnsub`、`recordCurrentPathUsage()`（见 design §3.5）
- 构造函数尾部：先记录当前路径，再 `globalStore.sub(this.metaFilePath, ...)`
- `dispose()`：`this._pathUsageUnsub?.()`

**验证**（对应 AC1 / AC2 / AC3 / AC9 / AC10 的一半）

```bash
grep -rn "trackRecentDir\|clearRecentDir" frontend/   # 期望：0 命中
node scripts/run-task.mjs check:ts
npm run test -- --run
```

- [ ] 与基线测试结果一致（删除死代码无回归）

**Rollback point R6**：`git checkout -- frontend/app/view/preview/preview-model.tsx`

---

## Step 7 — 面板重写 + widgets 接线

**改动**
- `frontend/app/view/preview/preview-new-files.tsx`：props 改为 `onSelect(selection)` / `onTogglePin` / `onRemoveUsage` / `usageEntries`；按 `buildPathPanelSections` 渲染；搜索 + 键盘 + 行内操作（design §3.4）
- `frontend/app/workspace/widgets.tsx`：
  - 删除 `filesRecentDirs` state
  - `const filesUsageEntries = useAtomValue(pathUsageAtom)`
  - `onSelect` / `onTogglePin` / `onRemoveUsage` 实现
  - `handleWidgetSelect` 增加 `DefaultFilesWidgetId` → 打开面板
  - 所有路径透传 `connection`

**验证**

```bash
node scripts/run-task.mjs check:ts
npm run test -- --run
grep -n "pathUsage\|onTogglePin\|onRemoveUsage" frontend/app/workspace/widgets.tsx
```

- [ ] 无残留 `filesRecentDirs`
- [ ] `handleWidgetSelect` 中 files 分支先于通用 blockdef 分支返回

**Rollback point R7**：`git checkout -- frontend/app/view/preview/preview-new-files.tsx frontend/app/workspace/widgets.tsx`

---

## Step 8 — 端到端验证（Quality Check）

```bash
node scripts/run-task.mjs check:ts
npm run test -- --run
node scripts/run-task.mjs generate && git diff --stat   # 确认生成物已提交且无漂移
```

**AC 对照表**

| AC | 验证方式 |
|---|---|
| AC1 真实记录 | 手工/预览：开一个文件 + 一个目录 → 面板 Recent 出现 |
| AC2 持久化 | 单测覆盖归约；手工：重启后仍在（或检查 settings.json 写入 `preview:path-usage`） |
| AC3 常用阈值 | `path-usage.test.ts` frequent count>=2 |
| AC4 衰减排序 | `path-usage.test.ts` 衰减用例 |
| AC5 去重 | `path-panel-model.test.ts` 互斥用例 |
| AC6 面板内 Pin | 手工；配置键写入断言可由预览/手工确认 |
| AC7 搜索 | `path-panel-model.test.ts` + 手工 Esc |
| AC8 点击开面板 | 手工（或 CDP `inspect-electron-ui.mjs`） |
| AC9 connection 隔离 | `path-usage.test.ts` 隔离用例 |
| AC10 噪音过滤 | `path-usage.test.ts` 噪音用例 |
| AC11 单测 | Step 3/4 |
| AC12 tsc + test | Step 8 命令 |

若有 CDP Electron 环境，可用 `node scripts/inspect-electron-ui.mjs` 做一次界面取证（hover 打开、搜索、Pin 生效）。

**Rollback point R8**：整个 Step 1–7 可 `git checkout` 回滚；配置键残留无害。

---

## Step 9 — 文档与收尾

- [ ] 若期间发现可复用的前端约定（配置键注册流程、纯逻辑/store 拆分模式），更新 `.trellis/spec/snorkeling-docs/frontend/*` 对应文件（当前为占位）
- [ ] Snorkeling 项目记录：`/Users/nita/Primary/obsidians/Obsidian/My Projects/Snorkling/06-开发记录.md`
- [ ] 按 `git diff --stat` 决定是否追加 `.trellis/tasks/10-12-files-widget-path-hub/` 到同一次提交

## Commit gates

- 每次提交前：`detect_changes()`（GitNexus；若不可用则 `git diff --stat` + 手工核对调用方）
- 提交信息遵循仓库风格：`feat(files-widget): ...`
