# Design: 前端 gen-store 与一键生成入口 + titleSource 视觉区分

## 1. `aisession-gen-store.ts`（新）

仿 `session-note-cache.ts` 的模块级模式（TTL + 在途合并 + 事件驱动）。

```ts
export type GenStateName = "queued" | "running" | "done" | "failed";

export type GenSnapshot = {
    sessionKey: string;
    connection: string;
    kind: "title" | "metadata" | "both";
    state: GenStateName;
    attempt: number;
    maxAttempts: number;
    error: string;
    updatedAt: number;
};

// key: `${connection}|${sessionKey}|${kind}`
const genCache = new Map<string, GenEntry>();
```

- `ensureGenListener()`：`waveEventSubscribeSingle<"aisessions:generationstatus">`；单例，幂等。
  handler 用 `event.data` 写 entry 并通知订阅者。**注意**：事件里 `kind="both"` 的 metadata 结果
  也要同步映射到 `kind="both"` 条目（不拆成 title/metadata 两条，保持 UI 简单）。
- `useSessionGenerationStatus(sessionKey, connection, kind)`：`useSyncExternalStore`。
- `autoGenerate(service, req)`：
  1. 先用 `resolveMetadataAIMode()` 校验；unavailable → 返回 `{ok:false, reason}`，不发 RPC。
  2. 本地乐观写 `queued`（每个 id+kind 一条）。
  3. `await service.AutoGenerate(req)`（RPC 很快）；把 `skipped` 写为 `failed` + reason。
- `done` 状态 3s 后回落到不显示（用 `setTimeout` 在 store 内部清理，避免组件各自计时）。
- `failed` 保留；`retry(sessionKey, connection, kind)` 重新 `autoGenerate` 单个。

**性能**：批量 50 条 → 50 个 entry，但组件只订阅自己那个 key，渲染 O(1)。
批量栏用 selector 聚合 `queued+running+done+failed` 计数（`useSyncExternalStore` + 手动遍历 Map）。

## 2. `gen-action-button.tsx`（新）

```tsx
type Props = {
    sessionKey: string;
    connection: string;
    kind: "title" | "metadata" | "both";
    force?: boolean;
    size?: "xs" | "sm";
    label?: string;       // 可选文字
    onSkipped?: (reason: string) => void;
};
```

- 状态来源：`useSessionGenerationStatus(sessionKey, connection, kind)`。
- idle → `fa-wand-magic-sparkles`；queued/running → `fa-spinner animate-spin` + disabled；
  failed → `fa-triangle-exclamation text-warning`，点击 = retry；done → `fa-check text-accent`。
- 点击前：
  - `resolveMetadataAIMode()` unavailable → `onSkipped`/本地错误条 + `Open AI settings` 按钮（`createBlock`）。
  - `titleSource === "user" && kind in {title,both} && !force` → 由调用方决定是否确认；
    本组件提供 `onNeedsForce` 回调，调用方弹确认后以 `force` 重新调用。
- 与 `session-note-events` 的关系：不需要它主动 dispatch；后端广播已能让列表/详情刷新。
  但 `session-note-cache` 的 `applyTitleUpdate` 只更新已有订阅；列表的 `aisessions.tsx` 走
  `aisession-note-updated` DOM 事件 → `model.replaceSession`；`generationstatus(done)` 不携带 summary，
  所以组件在 `done` 时额外调一次 `ensureSessionNote(service, key, conn, {force:true})` 拉最新值（背景刷新，不闪）。

## 3. 入口改造

### 3.1 agent card（`session-note-section.tsx`）

- 删除 `titleStatus === "loading|ready|error"` 的整块渲染（约 L120-L170）。
- 两个按钮改 `<GenActionButton kind="title" />` / `<GenActionButton kind="metadata" />`。
- `useSessionNoteState` 里的 `generateTitle/generateMetadata/applyTitle/dismissTitle/...` 保留但不再被
  本组件使用；注释标记「旧提案路径，仅编辑器子任务使用 GenerateMetadata」。
- note 覆盖 Undo：`GenActionButton` 的 `onDone(prev)` 回调里，若 `prev.note` 非空，渲染 Undo toast。

### 3.2 列表行（`session-row.tsx`）

- hover 动作区加 `<GenActionButton kind="title" />` + 一个 `fa-ellipsis-vertical` 小 popover：
  `Title` / `Note & tags` / `Both`（只做单行，popover 复用 `SessionMoreMenu` 风格的绝对定位）。
- 或者更简单：两个按钮（title / metadata）。**默认方案：单个 wand 按钮 = title**，
  另在 `SessionMoreMenu` 里放 note&tags（避免行内过密）。
- `titleSource` badge 插在标题 div 后。

### 3.3 Detail 头栏（`session-detail.tsx`）

- Star 左侧 `<GenActionButton kind="title" size="sm" />`。
- `SessionMoreMenu` 加两行：`Generate title with AI` / `Generate note & tags with AI`。
- 标题 div 后加 `titleSource` badge。

### 3.4 批量栏（`session-batch-bar.tsx`）

- 新增 props：`selectedIds: string[]`、`connection: string`、`onAutoGenerate(kind)`。
- 两个按钮 `AI title` / `AI note+tags`；`ids.length > 50` 时 disabled + tooltip。
- 进度：`queued/running/done/failed` 计数从 gen-store 聚合，显示 `3/12 done · 1 failed`。

### 3.5 Tab 标签

- `use-block-session-title.ts` 返回 `{title, titleSource}`。
- `block.tsx` `InlineTabLabel.defaultTitle` 会话分支：`summaryTitle` 后渲染小图标。
  由于 `InlineTabLabel` 是纯函数取 title，改为用 `useBlockSessionTitle` 返回对象。

## 4. titleSource badge

```tsx
export function TitleSourceBadge({ titleSource }: { titleSource?: string }) {
    if (titleSource !== "ai") return null;
    return <i className="fa-sharp fa-solid fa-wand-magic-sparkles text-[9px] text-accent/70"
              title="AI-generated title" />;
}
```

变体：`titleSource === "source_title"` 可选显示 `fa-tag`（不显示，避免混淆）。

## 5. Undo toast

- 新建 `frontend/app/view/aisessions/undo-toast.tsx`：app 级 `fixed bottom-6 left-1/2`，
  简单 state（模块级单例 store + `useSyncExternalStore`），支持 `show({message, onUndo, ttlMs})`。
- Undo 执行：`service.NoteAndTags({id, note: oldNote, tags: oldTags})` 后
  `dispatchAISessionNoteUpdated(updated)`；先读当前 summary 的 `updatedAt`，若已变则拒绝并提示。
- 不引入新依赖，纯 CSS/Tailwind。

## 6. 测试

- `aisession-gen-store.test.ts`：事件合并、done 回落、failed 保留、connection 隔离。
- `gen-action-button.test.tsx`：三态渲染、unavailable 前置、retry 调用。
- `title-source-badge`：快照/条件渲染。
- `session-batch-bar.test.tsx`：上限禁用、计数聚合。
