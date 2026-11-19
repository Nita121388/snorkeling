# 执行计划：Agent 卡片标签选择器（全局候选 + 计数）

## 0. 修正说明（重要）

初版规划基于「tags 是逗号分隔自由文本框」，**实测已过期**：
`grep -n "draft.split" frontend/app/view/aisessions/property/property-list.tsx` → 无命中；
tags 早已是共享 Wolai 浮层编辑器（`element/property-editor/tag-editor.tsx`）。
本文件与 `prd.md` / `design.md` 已按实际代码重写，删除了「删除逗号路径」这类不存在的步骤。

## 1. 准入前置（动手前必须成立）

- [ ] `node E:/primary/projects/loop/bin/loop.mjs queue run --id <新 id> --dry-run --root .` 通过（门清）
- [ ] 基线（2026-11-06 实测）
  - `npx vitest run frontend/app/view/aisessions/property` = **3 files / 34 passed**
  - `npx tsc --noEmit -p tsconfig.json | grep -c "error TS"` = **47**

## 2. 实施顺序

### Step 1 — 共享标签清单 store（纯逻辑，先测）

文件：
- 新增 `frontend/app/store/available-session-tags.ts`
- 新增 `frontend/app/store/available-session-tags.test.ts`

要做：
1. `AvailableTagsKey = { connection, origin }`；桶键 `connection + "\0" + origin`。
2. `ensureAvailableTags(key, { refresh, service })` → `service.Tags({ connection, origin, refresh })`，
   **只传最小过滤**（不带 since/before/marked/tagFilters/excludeTags/projects）。
3. 60s TTL + in-flight 去重；失败清 inflight、不写 cache、返回 `[]`。
4. `getAvailableTagsSnapshot(key)` / `subscribeAvailableTags(key, listener)`。

验证：`npx vitest run frontend/app/store/available-session-tags.test.ts` → 全绿

### Step 2 — 共享编辑器加计数通道（向后兼容）

文件：
- 改 `frontend/app/element/property-editor/tag-editor.tsx`（新增可选 `optionCounts`，渲染 `.ptag-option-count`）
- 改 `frontend/app/element/property-editor/tag-editor.scss`（新增 `.ptag-option-count` 样式，用主题变量）
- 新增/补 `frontend/app/element/property-editor/tag-editor.dom.test.tsx`（有 counts 渲染、无 counts 不渲染）

验证：`npx vitest run frontend/app/element/property-editor` → 全绿

### Step 3 — PropertyList 候选合并

文件：`frontend/app/view/aisessions/property/property-list.tsx`
1. 新增可选 prop `tagCatalog?: Record<string, SessionTagSummary[]>`。
2. `dropdownOptions(def, value, catalog?)` 三源合并：已选值 → `def.options` → 全局清单（count 降序、同 count 字母序）。
3. 新增 `optionCountsFor(def, catalog?)`，只保留 catalog 里有 count 的键。
4. `PropertyTagEditor` 调用点传 `optionCounts`。

验证：`npx vitest run frontend/app/view/aisessions/property` → 全绿且用例数 > 34

### Step 4 — SessionNoteSection 供数

文件：`frontend/app/element/info-card/session-note-section.tsx`
- 新增 `useAvailableSessionTags({ connection, origin })`：`ensureAvailableTags` + `useSyncExternalStore`。
- 传给 `PropertyList`：`tagCatalog={{ tags }}`。

验证：`npx vitest run frontend/app/element/info-card` → 全绿

### Step 5 — aisessions 筛选面板同源（按 design §2.5 方案 A）

文件：`frontend/app/view/aisessions/aisessions.tsx`
- 默认 **方案 A**：面板保留自己带 filter 的 `Tags` 调用（计数语义不变），卡片用 store。
- 若实现中能保证两处不出现两份**全局清单**缓存，则仅做注释对齐即可。
- 在「落地记录」写明选了哪个方案及原因。

验证：`npx vitest run frontend/app/view/aisessions` → 全绿

### Step 6 — 真机 CDP 验证台

文件：
- 新增 `scripts/verify/agent-card-tags/verify.mjs`
- 改 `scripts/verify/README.md`（area 表登记）
- 改 `docs/project/verify-ledger.md`（一行结论）

断言：
1. hover agent block 头部 → 卡片出现 → 点 Tags 行 → 浮层出现。
2. 候选项**包含本会话没有的标签**（与 `summary.tags` 求差集，非空）。
3. 至少一个候选项显示数字计数（`.ptag-option-count` 文本为数字）。
4. 点选一个未选标签 → 卡片 chip 里出现该标签；再点 → 消失。
5. AgentCardModal 打开 → 候选项文本与 hover 卡一致（AC7）。
6. 截图 + `report.json`。

验证：`node scripts/verify/agent-card-tags/verify.mjs` → 退出码 `0`，`N/N` 通过

### Step 7 — 收尾

- `npx tsc --noEmit -p tsconfig.json | grep -c "error TS"` → `<=47`（AC6）
- 回写 `.trellis/spec/**`（若产生新硬约束）、`docs/project/ui-verify-playbook.md`（若踩新坑）
- loop 落账：`queue prove` → 等人 `queue accept --score`

## 3. 触达白名单

```
frontend/app/store/available-session-tags.ts
frontend/app/store/available-session-tags.test.ts
frontend/app/element/property-editor/tag-editor.tsx
frontend/app/element/property-editor/tag-editor.scss
frontend/app/element/property-editor/tag-editor.dom.test.tsx
frontend/app/view/aisessions/property/property-list.tsx
frontend/app/element/info-card/session-note-section.tsx
frontend/app/view/aisessions/aisessions.tsx
scripts/verify/agent-card-tags/**
scripts/verify/README.md
docs/project/verify-ledger.md
docs/project/ui-verify-playbook.md
.trellis/tasks/11-06-agent-card-tag-picker/**
.trellis/spec/**
```

**不在白名单**：`pkg/**`、`frontend/types/gotypes.d.ts`（RPC 不变）、
`preview/plugins/md-properties/**`（R7 只做回归验证，不改它）。

## 4. 回滚点

| 回滚点 | 命令 | 影响 |
|---|---|---|
| R1 | 只回滚 Step 3+4 | 卡片候选项回到「def.options + 已选值」，计数消失；store 与编辑器保留（无 UI 影响） |
| R2 | 全量 | `git revert <commit>`；无数据迁移、无 RPC 变更 |

## 5. 判据复跑（loop `queue prove` 会跑这四条）

| # | 命令 | 期望 |
|---|---|---|
| 1 | `npx vitest run frontend/app/view/aisessions/property` | `passed` |
| 2 | `npx vitest run frontend/app/view/aisessions` | `passed` |
| 3 | `npx vitest run frontend/app/element/property-editor` | `passed` |
| 4 | `npx tsc --noEmit -p tsconfig.json \| grep -c "error TS"` | `<=47` |

## 6. 已知坑（预置）

- **`optionCounts` 必须可选且缺省行为零变化**：md 预览属性卡与自定义 select 都走同一个
  `PropertyTagEditor`，任何「无 counts 时也渲染占位」的写法都会污染那两个面（AC3 会红）。
- `InfoCardPortal` 的焦点保活：picker 内输入框聚焦后指针移开不能关掉浮层 —— 改完手动确认一次。
- `property-list.dom.test.tsx` 用 `vi.useFakeTimers()`：涉及 store 异步的用例要显式 flush 或换 real timers。
- `AgentCardModal` 是 `frameless` 内嵌形态：`.ptag-list` 的 `max-height` 若按 hover 卡设定，
  弹窗里会出现双滚动条 —— CDP 里分别看一眼。
- `PropertyValuePopover` 是 portal 到 body 的：CDP 选择器不能用「卡片 DOM 内」的范围查找。
