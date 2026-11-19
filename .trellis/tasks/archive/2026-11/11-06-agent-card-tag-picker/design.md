# 设计：Agent 卡片标签选择器（全局候选 + 计数）

## 1. 现状链路（已核对，勿再假设）

```
AgentHoverCard (view/term/agent-hover-card.tsx)
AgentCardModal (modals/agentcardmodal.tsx, 内嵌 AgentHoverCard frameless)
Tab「更多」首块 (tab/tab-more-agent-card.tsx)
        │
        └─ useSessionNoteState(sessionId, connection)        // store/session-note-hook.ts
                 │  summary.tags: string[]   +  summary.origin
                 ▼
        SessionNoteSection (element/info-card/session-note-section.tsx:342 唯一 PropertyList 调用点)
                 ▼
        PropertyList (view/aisessions/property/property-list.tsx)
                 │  点 Tags 值 → 打开 PropertyValuePopover（portal 到 body）
                 │      options={dropdownOptions(def, value)}     ← 只有 def.options + 已选值
                 ▼
        PropertyTagEditor (element/property-editor/tag-editor.tsx)   ← 共享层，md 预览也用
            已选 chips + 输入过滤 + 「创建 xxx」行 + ✓ 选中态 + 键盘导航
                 │  onChange(items: string[])
                 ▼
        commitDropdown → onChange(key, next, def) → setSessionProperty(...)
```

**缺的那一块**：`dropdownOptions()` 的候选池不含全局标签，且候选项没有 count 承载位。

```
Go: AISessionsService.Tags(AISessionsTagsRequest) → AISessionsTagsResponse{Tags: []SessionTagSummary}
     ListTags 按 ListOptions 统计 tag → count（pkg/aisessions/sqlite_index.go:1596）
前端唯一消费点: aisessions.tsx:735 → availableTagsAtom → filter-panel.tsx:640
```

## 2. 分层设计

### 2.1 L1 — 共享标签清单 store（新文件）

`frontend/app/store/available-session-tags.ts`

```ts
export type AvailableTagsKey = { connection: string; origin: string };

export function getAvailableTagsSnapshot(key: AvailableTagsKey): SessionTagSummary[];
export function subscribeAvailableTags(key: AvailableTagsKey, listener: () => void): () => void;
export function ensureAvailableTags(
    key: AvailableTagsKey,
    opts?: { refresh?: boolean; service?: AISessionsServiceType }
): Promise<SessionTagSummary[]>;
```

要点：

- **分桶键** = `connection + "\u0000" + origin`（同机不同 origin 不混）。
- **最小过滤**：`Tags({ connection, origin, refresh })` —— 不带 `since/before/marked/tagFilters/excludeTags/projects`，
  避免卡片计数被 aisessions 的临时筛选污染（PRD R5 / Notes）。
- **in-flight 去重**：同 key 并发只发一次 RPC；`refresh: true` 强制重发。
- **失败不缓存**：清 inflight、不写 cache、返回 `[]`（R6 降级）。
- **TTL 60s**：hover 卡是高频挂载组件，无 TTL 会被 hover 风暴打穿。
- **service 可注入**：`opts.service` 供单测传 fake；缺省用 `new AISessionsServiceType()`，
  与 `session-note-hook.ts:100` 的写法一致。

### 2.2 L2 — 编辑器加计数通道（改共享层，向后兼容）

`frontend/app/element/property-editor/tag-editor.tsx`

```ts
export type PropertyTagEditorProps = {
    items: string[];
    options?: string[];
    /** 新增：候选项计数。缺失的 key 不渲染计数字段（不伪造 0）。 */
    optionCounts?: Record<string, number>;
    multiple?: boolean;
    placeholder?: string;
    onChange: (items: string[]) => void;
    onClose: () => void;
};
```

渲染：在 `.ptag-option` 内、chip 之后追加

```tsx
{optionCounts?.[option] != null ? (
    <span className="ptag-option-count" aria-label={`${optionCounts[option]} sessions`}>
        {optionCounts[option]}
    </span>
) : null}
```

- 「创建」行与 `.ptag-option-check` 的行为**完全不变**。
- `optionCounts` 缺省 → 渲染结果与今天逐字节等价（R7：md 预览属性卡不传它，零影响）。
- 计数样式（`.ptag-option-count`）加在 `tag-editor.scss`：小号、`tabular-nums`、右对齐、
  用主题变量（禁止写死色值，见 quality-guidelines）。

### 2.3 L3 — PropertyList 接线

`frontend/app/view/aisessions/property/property-list.tsx`

1. 新增可选 prop：
   ```ts
   /** 全局标签清单（含 count），按属性 key 索引。缺省时行为与今天完全一致。 */
   tagCatalog?: Record<string, SessionTagSummary[]>;
   ```
2. `dropdownOptions(def, value, catalog?)` 扩展为三源合并：
   1. 已选值（`itemsFromValue`）—— 永远可见，不因清单缺失而消失；
   2. `def.options`（内置 tags 的 `tagToOption`、自定义 select 的 options）；
   3. `catalog?.[def.key]` 里尚未出现的 tag，按 `count` 降序、同 count 字母序。
3. 新增 `optionCountsFor(def, catalog?)` → `Record<string, number>`，只含 catalog 里有 count 的键。
4. `PropertyTagEditor` 调用点追加 `optionCounts={optionCountsFor(popoverEntry.def, tagCatalog)}`。

> 顺序决策：已选值在前保证「用户刚输入的新标签」不会被列表末尾吞掉；
> def.options 次之（保持 md 预览与自定义 select 的既有顺序语义）；全局清单最后。

### 2.4 L4 — SessionNoteSection 供数

`frontend/app/element/info-card/session-note-section.tsx`

```ts
const tags = useAvailableSessionTags({ connection, origin: summary?.origin ?? "" });
// → PropertyList tagCatalog={{ tags }}
```

`useAvailableSessionTags` 内部：`ensureAvailableTags(...)` + `useSyncExternalStore`，
返回 `SessionTagSummary[]`（失败为空数组 → 自然退化为今天的候选池，R6）。

### 2.5 L5 — aisessions 筛选面板切同一来源

`aisessions.tsx` 的 `loadTags()` 改为写 `ensureAvailableTags(...)` 的结果（或让
`availableTagsAtom` 派生自 store），**保持 `filter-panel.tsx` 的 props 签名不变**。

⚠ 约束：筛选面板的计数语义是「当前筛选条件下的 count」，而 store 缓存的是「最小过滤下的 count」。
两者**不相同**。因此落地时二选一，并写进记录：

- **A**（推荐）：筛选面板继续用自己带 filter 的 `Tags` 调用写 `availableTagsAtom`（语义不变），
  卡片用 store；store 只保证「卡片与面板不出现两份**全局**清单」，不强行统一计数口径。
- **B**：面板也改用 store —— 计数会变成全局值，与面板上方的筛选条件脱钩，**不推荐**。

> 设计取舍：R1 的「单一标签源」指**全局清单的来源唯一**，不是强迫两种语义不同的 count 合流。
> 记录里必须写明选了 A。

## 3. 数据流（改后）

```
        ┌── ensureAvailableTags({connection, origin}) ──→ Tags RPC（60s TTL + in-flight 去重）
        │
        ├─→ SessionNoteSection → PropertyList(tagCatalog) → dropdownOptions 合并
        │                                                    → PropertyTagEditor(optionCounts)
        │
        └─→ aisessions filter panel（方案 A：仍走自己的带筛选 Tags 调用）
                 │
                 ▼
        用户点候选项 → onChange(items) → commitDropdown → setSessionProperty  ← 未改
```

## 4. 兼容与回滚

- **兼容**：`optionCounts` / `tagCatalog` 都是可选参数。不传 → 渲染与行为同今天。
  md 预览属性卡不传 → 零影响（AC3 就是这道回归门）。
- **回滚**：改动集中在新 store + `tag-editor.tsx` 的计数渲染 + `property-list.tsx` 的
  候选合并 + `session-note-section.tsx` 的供数。`git revert` 单提交；无数据迁移、无 RPC 变更。
- **无后端改动** → 无 migration / 版本兼容问题。

## 5. 风险

| 风险 | 处置 |
|---|---|
| `Tags` RPC 被 hover 风暴打爆 | 60s TTL + in-flight 去重；卸载不取消（缓存留给下次 hover） |
| 同一个 tag 在卡片与筛选面板显示不同数字 | 语义不同且在方案 A 下已明确：卡片=全局、面板=条件；两者各自带上下文 |
| 候选过多把浮层撑爆 | `.ptag-list` 已有滚动；新增计数不改变布局高度 |
| 计数走样成「0）」这类噪声 | 无 count 一律不渲染（R3），不做 0 占位 |
| `def.options` 顺序被全局清单打乱 | 合并顺序固定为 已选 → def.options → 全局（见 §2.3） |
| jsdom 里 `useSyncExternalStore` + fake timers | store 单测用注入的 fake service，不依赖网络；组件测用真实同步快照 |

## 6. 验收映射

| AC | 覆盖方式 |
|---|---|
| AC1 | `property-list.dom.test.tsx` 新增「全局候选 + count + 点选/取消」用例 |
| AC2 | `npx vitest run frontend/app/view/aisessions` 全绿 |
| AC3 | `npx vitest run frontend/app/element/property-editor frontend/app/view/preview/plugins/md-properties` 全绿（R7 回归门） |
| AC4 | `available-session-tags.test.ts`（缓存 / in-flight / 分桶 / 失败不缓存） |
| AC5 | `scripts/verify/agent-card-tags/verify.mjs`（CDP，复用 `scripts/verify/lib/`） |
| AC6 | `npx tsc --noEmit` ≤ 47（实测基线） |
| AC7 | 同一 CDP 会话依次打开三个面，比对候选项文本 |
