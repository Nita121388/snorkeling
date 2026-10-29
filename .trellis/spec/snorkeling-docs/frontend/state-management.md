# State Management

> How state is managed in this project.

---

## Overview

<!--
Document your project's state management conventions here.

Questions to answer:
- What state management solution do you use?
- How is local vs global state decided?
- How do you handle server state?
- What are the patterns for derived state?
-->

(To be filled by the team)

---

## State Categories

<!-- Local state, global state, server state, URL state -->

(To be filled by the team)

---

## When to Use Global State

<!-- Criteria for promoting state to global -->

(To be filled by the team)

---

## Server State

<!-- How server data is cached and synchronized -->

(To be filled by the team)

---

## Common Mistakes

<!-- State management mistakes your team has made -->

### 1. 快照式持久化状态会产生双写者（data loss）

反例：构造函数里把配置值快照进 `PrimitiveAtom`，之后写入时仍从这份**过期**快照重建整个数组。
两个写者（视图 A 的本地 atom、视图 B 直接写配置）会互相覆盖。

实证：`preview:pinned-directories` 曾由 `PreviewModel.pinnedDirs`（一次性快照）与
`widgets.tsx` 面板 Pin 同时写入，面板 Pin 的记录会被目录右键 Pin 覆盖丢失。

正确做法：**配置即唯一事实源**，用派生 atom 读配置，删除本地 `globalStore.set`：

```ts
// preview-model.tsx
this.pinnedDirs = atom((get) => {
    const saved = get(this.env.getSettingsKeyAtom(PreviewPinnedDirectoriesKey));
    return Array.isArray(saved) ? (saved as PinnedDirectory[]) : [];
});
```

### 2. 只在 TS 侧新增 settings 键

后端 `wconfig.SetBaseConfigValue` 反射校验 `SettingsType` 的 json tag，
未注册的键直接返回 `invalid config key`，用 `fireAndForget` 包裹时表现为**静默失效**。
新增配置键的完整链路（Go 注册 → `node scripts/run-task.mjs generate` → TS 派生 atom）见
`docs/project/config-settings-key-flow.md`。

### 3. 用作身份键前未归一化 connection

本地连接存在 `""` / `"local"` / `"local:*"` 多种拼写；直接拼身份键会让同一路径被记成多条、去重失效。
先归一化再拼 key（见 `frontend/app/view/preview/path-usage.ts` 的 `canonicalConnection`）。

### 4. 高频状态直接落盘

配置文件是整文件重写。导航类状态用"模块级缓冲 + debounce + 条目上限"合并写入，
并在 `pagehide` 做 best-effort flush。参考 `frontend/app/view/preview/path-usage-store.ts`。

### 5. 共享的二级浮窗：close ≠ 「用户关掉了」
多个二级浮窗（Terminal / Agent / Files 目标选择器）共用一个打开位时，
**打开另一个必须先 close 当前**。如果 close 函数里带「通知发起方」的回调
（例如 `launch-popup-bus` 的 `onOpenChange(false)`），那么「换浮窗」会被误报成
「二级被用户关掉」：一级菜单立刻认为二级已关 → 提前收起 + Esc 一次关两层。

正确做法：给 close 加一个「是否通知发起方」的参数，只有**真正的用户关闭**
（Esc / 点外面 / 选完）才通知；「换浮窗」走静默关闭。

```ts
// frontend/app/workspace/widgets.tsx
const closeTerminalTargetSelector = useCallback((notifyBus = true) => { ... }, []);
// 换浮窗：静默
closeTerminalTargetSelector(false);
// 用户真的关掉了：通知
closeTerminalTargetSelector();
```

配套约定：

- 「换浮窗」路径里 **先 close 再设共享状态**（close 常常会把 sink / 选中项重置为 null）；
- 只有最后一个真正关闭的浮窗负责回传 `onOpenChange(false)`，避免重复通知。

### 6. VM 实例字段当持久状态：Tab 化 Block 切 tab 就丢

`InlineTabBlock` 只挂载当前激活的子块（`frontend/app/block/block.tsx`：`<SingleBlock key={activeBlockId}>`），
切走会卸载旧块并 `dispose` 它的 ViewModel，切回来是**全新实例**。
所以「用户配置」若只存在 VM 的 jotai atom 上，切 tab / 重开就会回默认值。

约定：**每个 block 自己的 UI 配置**落 block meta（随布局持久化、随 block 关闭清理），
**跨 block 的全局偏好**落 localStorage，VM 构造时读回、变更时 debounce 写回：

```ts
// frontend/app/view/aisessions/aisessions.tsx
this.restoreFilterState();              // 构造：meta → atom
this.attachFilterStatePersistence();    // globalStore.sub(atom, debounce(400ms) → SetMetaCommand)
dispose(): void { /* 退订 + flush 最后一次变化 */ }
```

另外两点经验：

- **热缓存兜底**：`SetMetaCommand` 是异步 RPC，「块卸载 → 立刻切回」可能读到未落地的旧 meta，
  所以持久化时同时写一张按 blockId 的内存缓存（`filter-state-persist.ts`），构造时优先读它。
- **构造时把「当前状态」记为已写基准**（`filter-stateLastWritten`），否则块只是被打开/关闭就会
  往 meta 里写一份默认值，把「没配置过」和「配置成默认」混为一谈。

参考实现：`frontend/app/view/aisessions/filter-state-persist.ts`（纯函数 + 缓存，可直接单测）。

---

## Recommended Split: pure logic + stateful store

可测状态的推荐拆法（本仓库已验证）：

- `xxx.ts` — 纯逻辑：类型、归一化、归约、排序、过滤。**不 import** jotai / react / env / electron，
  因此可以直接单测，无需 jsdom。参考 `frontend/app/view/preview/path-usage.ts`。
- `xxx-store.ts` — 有状态适配层：jotai atom、配置持久化、节流。参考 `path-usage-store.ts`。
- 组件只负责渲染 store 暴露的数据与调用 store 的动作。
