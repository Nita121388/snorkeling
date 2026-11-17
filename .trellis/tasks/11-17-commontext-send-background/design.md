# 设计：CommonText Send 后台异步发送

## 现状（代码事实）

| 事实 | 位置 |
|---|---|
| 跳 Tab 是前端造成的（**双重激活**：后端 `activateTargetTab=true` 自激活 + 前端再调 `setActiveTab`） | `frontend/app/commontext/commontext-send-button.tsx:238-239/253`、`pkg/service/objectservice/objectservice.go:126-144` |
| 后端 `CreateBlockInTab` 支持 `activateTargetTab=false`；`CreateBlockInNewTab` 本身不激活新 Tab | `objectservice.go:126/154`、`pkg/wcore/workspace.go:256` |
| 注入依赖前端挂载：静默窗口判定 + `terminal.paste` 在 React effect 中 | `frontend/app/view/term/term.tsx:574-620`、`pending-input.ts:96-113` |
| renderer 只挂载「激活 Tab + 最近 3 个预挂载 Tab」，`visibility:hidden` 但保真实尺寸 | `frontend/app/workspace/workspace.tsx:71-93/209-221` |
| pending-input registry 是模块级内存 Map（不落盘），每 renderer 独立 | `pending-input.ts:24` |
| 历史黑屏死锁 = block-jump localStorage 残留 + 模块求值期 TypeError（已修） | `block-jump-signal.ts:66-70`、commit `9b30e6721` |

## 方案：去掉跳转 + pending Tab 临时隐藏挂载

```
Send(create)
  ├─ 建块（activateTargetTab=false，绝不 setActiveTab）
  ├─ registerPendingInput(blockId, text)        （现有）
  ├─ mountPendingInputTab(tabId, blockId)       （新增：进隐藏挂载队列）
  └─ onStatus("已在后台发给 X")

workspace renderPreloadTabIds
  = [activeTab, ...preload(≤3), ...pendingMountIds(≤2)]   ← pending 不参与 cap 切片
  → 目标 Tab 以 visibility:hidden 真实尺寸挂载
  → term.tsx 现有 effect 判定 TUI 就绪 → paste + 延时回车
  → inject/expire 时 removePendingInputTabByBlock(blockId)
```

### 新增模块接口（`frontend/app/commontext/pending-input.ts`）

```ts
// pending Tab 隐藏挂载队列：FIFO、去重、上限 2；纯内存，禁止持久化。
export const PendingInputTabMountCap = 2;
type PendingTabEntry = { tabId: string; blockId: string };
mountPendingInputTab(tabId, blockId): void      // 已存在同 tabId 则前移
unmountPendingInputTab(tabId): void
unmountPendingInputTabByBlock(blockId): void
getPendingMountTabIds(): string[]               // 前 Cap 个（供 workspace 合并）
prunePendingInputTabs(validTabIds: Iterable<string>): void  // 自愈：Tab 已不存在则移除
subscribePendingInput(cb): () => void           // 注册/消费/队列变化都通知
```

- 变更通知：模块级 `listeners: Set<() => void>`，任何 registry / 队列变化 `emit()`。
- term.tsx effect：`useEffect(() => subscribePendingInput(() => setPendingTick(n=>n+1)), [])`，
  tick 进 effect 依赖 → 晚注册也能重起轮询（评审 P1-2）。
- `computeInjectDecision` / `isPendingInputExpired` 保持不变。

### workspace 合并（`frontend/app/workspace/workspace.tsx`）

- 纯函数拆出便于单测：`frontend/app/workspace/preload-tabs.ts`
  ```ts
  computeRenderPreloadTabIds(activeTabId, preloadTabIds, pendingMountIds): string[]
  // [active, ...preload(去重/去 active)] + pending（去重，不 slice）
  ```
- workspace 订阅 `subscribePendingInput` 与 `atoms.workspace` → 算 pendingMountIds 并 prune 非法 tabId。

### term.tsx 守卫（评审 P2-1）

- 新增 `isBlockTabActive(blockId)`：`model.tabModel?.tabId === globalStore.get(atoms.staticTabId)`
  （`staticTabId` 是本 renderer 的激活 Tab，workspace.tsx:46 同源）。
- `wasFocused → giveFocus()`：仅当块所在 Tab 激活时执行。
- `(window as any).term = termWrap`：仅当块所在 Tab 激活时写入，避免隐藏挂载覆盖调试全局
  → **现有 verify 台第 8 步探针改走事件/模块图**（见验证）。
- inject/expire 分支：`unmountPendingInputTabByBlock(blockId)`。

### Send 执行（`commontext-send-button.tsx`）

- `CommontextSendConfig` 新增 `background: boolean`（默认 `true`，会话级 atom，不持久化）。
- `executeCommonTextSend`：
  - `background === false` → 保留旧行为（需要 `setActiveTab`；existing 路径 `activateTargetTab=true`）。
  - `background === true`：
    - current：`createBlock(blockDef, false)`，tabId = `atoms.staticTabId`；
    - existing：`CreateBlockInTab(tabId, ..., false, false)`，**不** `setActiveTab`；
    - new：`CreateBlockInNewTab(...)`，**不** `setActiveTab`；成功后才 mount pending。
  - 顺序：建块成功 → `registerPendingInput` → `mountPendingInputTab`（评审：先建块后入队，避免空 entry）。
- Popover 增加「后台执行」开关行（`data-commontext-send-background`），i18n：
  `commontext:send.background` / `commontext:send.backgroundHint`。

### 启动安全

- 两个集合均为内存，无 localStorage / settings 写入；开关也在会话级 atom。
- 后台创建产物与今天普通建块/建 Tab 完全同构，重启走既有 tab-startup-restore。
- 禁止持久化写进本文件 + code review 关注点。

## 备选（不采用）

后端直接 `SendInput` 写 PTY：bracketed paste 由前端 xterm 协商，未挂载时无人应答终端查询，
多行裸 `\n` 会被逐行提交且绕过用户 `term:bracketedpaste` 设置 → 语义不可控。

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| pending Tab 被 PreloadTabCap 切片逐出 → TTL 永不触发 | pending 不参与 slice；单独 Cap=2；超限排队 |
| 晚注册漏接（静默不注入） | registry 变更通知 + effect 重触发 |
| 隐藏挂载泄漏（xterm/WebGL 上下文） | inject/expire/删块/关 Tab/切换 workspace 全路径移除 + 启动时自愈 prune |
| 隐藏挂载抢焦点 | `isBlockTabActive` 守卫 giveFocus / window.term |
| 多块隐藏挂载性能 | Cap=2，超出排队等待；验证覆盖 4 并发 |
