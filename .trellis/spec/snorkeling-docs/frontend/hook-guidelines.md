# Hook Guidelines

> How hooks are used in this project.

---

## Overview

<!--
Document your project's hook conventions here.

Questions to answer:
- What custom hooks do you have?
- How do you handle data fetching?
- What are the naming conventions?
- How do you share stateful logic?
-->

(To be filled by the team)

---

## Custom Hook Patterns

<!-- How to create and structure custom hooks -->

(To be filled by the team)

---

## Data Fetching

悬浮卡（InfoCard）里的异步数据一律遵守「延迟 + 缓存 + 收敛」三件套。参考实现：
`frontend/app/block/use-repo-info.ts`（`useRepoInfo`，Git 分支信息）。

1. **显示延迟不等同于隐藏延迟。** `useInfoCardHover` 只有 `hideDelayMs`（200–300ms），
   `mouseenter` 会立即开卡。因此任何会发 RPC 的卡片内容必须自己在 hook 里加停留阈值
   （现用 `REPO_INFO_DELAY_MS = 150`），否则快速划过 Tab 栏会打出一串请求。
2. **不预取。** 悬停卡是低频、单实例的 surface，Block 挂载时预取会让「打开 N 个 block」
   变成 N 次 RPC。
3. **模块级缓存 + TTL，正负同寿。** 失败也要写负缓存，防止失败风暴；TTL 到期不主动刷新，
   只在下一次真正需要时重取。
4. **single-flight。** 同 key 在途只保留一个 Promise。
5. **状态只落在叶子组件。** RPC state 放在卡片内部的子组件（如 `RepoLine`），不要提到
   卡片本体或 `BlockInfoCard` 分派器，避免三个消费方（header / inline tab / sidebar）连带 re-render。
6. **缓存 key 带上 connection**（`connection\0path`），本地与远端同名路径是两个仓库。

## Naming Conventions

<!-- How data fetching is handled (React Query, SWR, etc.) -->

(To be filled by the team)

---

## Naming Conventions

<!-- Hook naming rules (use*, etc.) -->

(To be filled by the team)

---

## Common Mistakes

- 把「隐藏延迟」当成「显示延迟」，在 hover 开始时立刻发起 RPC。
- 在卡片本体（`PreviewInfoCard` 等）里直接 `useState + useEffect` 拉数据，
  让卡片壳与分派器一起 re-render。
- 失败不写负缓存 → 每次悬停都重试同一个坏路径。

<!-- Hook-related mistakes your team has made -->

(To be filled by the team)

---

## 硬约束：hook 数量必须恒定（2026-11-09, N-1109 整窗白屏）

**禁止**把 hook 写进 `cond ? useX() : fallback` / `cond && useX()` / `if (cond) useX()`。
React 要求同一组件实例每次渲染的 hook 数量与顺序一致；一旦 `cond` 在两次渲染间翻转，
React 抛 `Rendered more hooks than during the previous render`（生产构建 = **Minified React error #310**）。

### 为什么这条是 P0

`frontend/app/app.tsx` 的根节点在 2026-11-09 之前没有 ErrorBoundary，所以这个异常会让 React
**卸载整棵树** → 窗口只剩主题底色（light 主题是米白）→ 用户看到"整窗白屏、切 tab 无效、
只能重启"。真机现场（Overview 页）抓到的栈就是它：

```
Uncaught Error: Minified React error #310
  at updateWorkInProgressHook
  at Object.updateReducer [as useReducer]     ← jotai useAtomValue 内部
```

`useAtomValueSafe` / `useAtomValue` / `useSyncExternalStore` **都是 hook**，一并受此约束。

### 正确写法：条件放在"选中哪个 atom"，不放在"调不调 hook"

```tsx
// ❌ 会白屏
const tick = tickEnabled ? (useAtomValueSafe(agentStatusSecondTickAtom) ?? 0) : 0;

// ✅ hook 数量恒定；不需要刷新时订阅一个永不变化的 atom，成本可忽略
const tick = useAgentSecondTick(tickEnabled);   // frontend/app/agent-status/agent-status-second-tick.ts
```

同类收敛点（改之前先看这些有没有现成的 hook 可用）：
`useAgentSecondTick`（秒级跑时）、`nowMinuteTickAtom`（分钟级 Done elapsed）。

### 兜底（第二道闸，不替代上面）

`App` 根节点包了 `RootErrorBoundary`（`frontend/app/element/errorboundary.tsx`）：
render 异常渲染成错误卡片（消息 + 组件栈 + Reload），不再整窗白屏，并经 preload `sendLog` 进 `waveapp.log`。
新增根级 Provider / 全局宿主组件时，**不要**把它放到 boundary 外面而绕过兜底。

### 回归用例写法（dev 构建不抛，只报 console.error）

React 19 的 dev 构建在 hook 数量不一致时**不向外抛异常**，而是 `console.error("Internal React error: Expected static flag was missing.")`；
生产构建同一分支才是 `#310`。所以断言要盯 **console.error 信号 + 翻转后 DOM 仍正确**，
不能只写 `expect(...).not.toThrow()`（那样在 dev 里永远是绿的、零信息）。
范式：`frontend/app/session-overview/agent-status-chip-hooks.test.tsx`。
