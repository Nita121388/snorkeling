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

---

## localStorage 外部 store 范式（2026-11-03, task 11-02-emoji-alias-picker-search）

「一个模块 + 一个 localStorage 键 + 内存快照 + 单调版本号 + 订阅者」是本项目的标准做法。
**canonical 实例**：`frontend/app/element/markdown-transform/emoji-aliases.ts`
（同构的还有 `agent-persona/persona-store.ts`、`agent-persona/session-persona-store.ts`）。

必须遵守的四条：

1. **版本信封**：存 `{ version: 1, ... }` 而不是裸数据。读到不认识的 `version` 时
   **返回空表但绝不覆写**，否则新版本写的数据会被旧版本静默清掉。
2. **快照 + 版本号**：`getXxx()` 返回稳定的内存快照（`useSyncExternalStore` 的快照同一性要求），
   写入时 `snapshot = next; version++`。派生列表把 `version` 放进 `useMemo` 依赖，
   **不要把整个 map 塞进依赖**（每次写都是新对象，容易连带重算无关逻辑）。
3. **跨窗口同步**：只注册一次 `window.addEventListener("storage")`，用
   `event.key === KEY` 与 `event.storageArea !== window.localStorage` 双重过滤，
   收到外部写入时重读快照 + `version++` + 广播。
4. **读写全包 `try/catch`，失败降级为内存态**：localStorage 满了 / 隐私模式下，
   写入失败不能让 UI 操作抛错，本次会话内照常可用。

**禁止**：在渲染路径里直接 `localStorage.getItem`（每次击键都同步读盘，且破坏快照同一性）；
把派生状态写回同一个键（双写者 → 数据丢失，见上文 `preview:pinned-directories` 反例）。

---

## 派生状态：单一呈现源 + ack 指纹同源（2026-11-03, task 11-03-agent-status-cross-surface-consistency）

同一份后端状态被多个 UI 面展示时，**只允许有一个派生函数和一份订阅**，所有面读同一个 atom。

反例（已修复）：agent 状态有三条独立管线 —— block 头部（store presented atom，只 `applyStaleness`）、
Session Overview（自建 `GetAgentStatus` + `agentstatus` 订阅 + `presentAgentStatus` 的 idle→done 派生）、
inline tab / Tab 圆点（store）。结果同一个 block：

- 头部按 canonical 取 label 显示 `"Idle 10m"`，Overview 派生 `state:"done"` 显示 `"Done"`；
- 两侧都写同一份 `agentStatusAckedFpAtom[blockId]`，但 fingerprint 由**不同的 status 对象**算出
  （`...|hook|7|idle|...` vs `...|session|7|done|...`）→ 在任一面 ack 后，另一面比对不上、重新亮起。

约定：

1. **一个派生函数**：`agent-status-derive.ts` 的 `presentCanonicalAgentStatus()` 是唯一呈现层
   （idle+`prevState` 提升为 `done`、working 超阈值衰减 `stale`、null 保持 null）。
   新增展示面必须读 `AgentStatusStore.acquire()` / `peekPresentedStatusAtom()`，**禁止**自己再拉 RPC。
2. **ack 指纹必须同源**：`statusFingerprint(status)` 的入参必须是"所有面都会读到的那一个对象"。
   两个面用不同形态的 status 计算 fingerprint，就等于两份互不相认的 ack 状态。
3. **ack 写全**：R 类（fingerprint）与 D 类（`doneAckedAt`）各自独立，任何一个 ack 入口都要同时写两边，
   否则另一面会因为只认自己那份判定而"复活"。参见 `session-overview.tsx` 的 `ackAgentStatus`。
4. **showing 判定只看 `state`**：`done` 长期保留直到下一次非 idle 事件或 ack；不要用"时间窗口"（例如
   15 分钟内才显示）作为单侧显示条件——时间窗口会让同一状态在两个面不同时消失。

---

## persona 归属判定：props.persona 是唯一归属，路径命中只管折叠（2026-11-12, task 11-12-persona-aisessions）

AISessions 里"一个会话属于哪个人设"必须只读 `summary.props.persona`（显式、人/AI 可改，
写入通道 `wsh agent card set --prop persona=<id>`，A3 登场管线也调它）。行标 🎭、persona
筛选、登场史计数（`countSessionsOfPersona`）都只读它，**禁止**从路径反推归属。

路径（`projectPath` 位于 persona 根目录下且根的第一级子目录名是名册 id，`/`/`\` 都认、
大小写不敏感）只用于**分组折叠**：命中 → 桶 key `persona:<id>`、组名 `🎭 <emoji> <name>`、
不渲染路径。两机制职责不同：折叠解决"据点伪项目混排"，props.persona 解决"归属与统计"。
判定逻辑收口在 `frontend/app/view/aisessions/utils.ts` 的纯函数
（`buildPersonaContext` / `makePersonaPathMatcher` / `personaIdOfSession`），不要在组件里
散写第二份路径匹配。
