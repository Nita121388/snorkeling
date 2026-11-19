# Design：reinitWave 增量减负

## 1. 边界与原则

- 唯一行为变更点：`frontend/wave.ts` 的 `reinitWave()` 与 `reloadAllWorkspaceTabs()`。
- `initWave()`（首开路径）完全不动。
- `WOS.reloadWaveObject` 本身不动；只在调用侧减少串行等待与重复调用。
- 新增纯函数模块只描述「该发哪些动作、按什么依赖分批」，不执行 RPC、不碰 DOM、不 import React/WOS。

## 2. 当前调用图与依赖

```
reinitWave()
  ├─ nohover 反闪（DOM）
  ├─ reload(client)          ─┐
  ├─ reload(window)          ─┼─ 无依赖，当前串行
  ├─ reload(workspace) ← window.workspaceid
  ├─ reload(tab)             ─┘
  ├─ reload(layout)   ← tab.layoutstate
  ├─ reloadAllWorkspaceTabs(ws) → N × reload(tab)
  └─ 收尾副作用 ×6（title / wave-ready / reinitVersion++ / updater / refocus）
```

依赖边只有两条：`window → workspace`、`tab → layout`。`client` 独立。

## 3. 改造后数据流

```
planReinitWave(deps, enabled) → Plan
  Plan = { batches: ReloadBatch[], sideEffects: SideEffect[], tabIdsToReload: string[] | null }

enabled=true：
  batch0 = [client, window, tab]         // 并行 Promise.all
  batch1 = [workspace, layout]           // batch0 完成后并行
  tabIdsToReload = prevWsTabIds === ws.tabids ? null : ws.tabids

enabled=false：
  batches = [[client], [window], [workspace], [tab], [layout]]  // 逐项串行，与现状一致
  tabIdsToReload = ws.tabids                                   // 保持现状
```

执行器在 `wave.ts`：按 `batches` 顺序逐批 `Promise.all`；每批内部的 reload 结果按 oref 写回同一个局部结果表，供后续批次取依赖值（如 `workspace` 从 `window.workspaceid` 取）。

**实现期微调（contract 拆二）**：规划时 `ws.tabids` 尚未 reload 出来，所以把纯函数拆成两个：
`planReinitWave(deps, enabled)` 只出批次 + 副作用清单；`planWorkspaceTabReload(prev, current, enabled)`
在 reload 完成后单独决策是否重刷 tabs。两者默认参数都读模块级开关，`wave.ts` 不传 `enabled`。
这让纯函数保持无副作用且无需假数据入参。

## 4. 契约（纯函数）

```ts
type Deps = { clientId: string; windowId: string; tabId: string };
type ReloadKind = "client" | "window" | "workspace" | "tab" | "layout";
type SideEffect = "nohover" | "title" | "waveReady" | "reinitVersion"
                  | "updaterSync" | "refocus" | "reloadWorkspaceTabs";
interface Plan {
    batches: ReloadKind[][];
    sideEffects: readonly SideEffect[];   // 两条路径同序同集
    relief: boolean;                      // 是否走减负路径
}
function planReinitWave(deps: Deps, enabled?: boolean): Plan;
function planWorkspaceTabReload(
    prevWsTabIds: readonly string[] | undefined,
    wsTabIds: readonly string[] | undefined,
    enabled?: boolean
): readonly string[] | null;
```

## 5. 兼容性与回滚

- `REINITWAVE_RELIEF_ENABLED = false` 时，`planReinitWave` 输出 5 次串行 + 全部 tabIds，执行器等价于现状。
- 开关是模块级 const，与仓库现有回滚范式一致；关闭只需改一行并重启 renderer。
- `prevWsTabIds` 来源：模块内 `let` 缓存上一次 `ws.tabids`（浅拷贝）。首帧为 undefined → 等价有变化 → 走 reload，与现状一致。

## 6. 取舍

- **不跳过 client/window reload**：虽然 client 每次内容相近，但 reload 会刷新 atom；跳过会引入未验证的新鲜度风险。减负只来自「并行 + 去重」，不改语义。
- **不把 workspace/layout 并行进 batch0**：它们有真实依赖，强行并行会拿到 undefined 依赖值。
- **`reloadVersion` 副作用保留**：Tab 栏重排依赖它，去掉会让「更多」窗口与激活高亮错位。
- **`reloadAllWorkspaceTabs` 只在 tabids 变化时跑**：Tab 标题/未读点的陈旧风险来自「tab 内容变了但 id 列表没变」。本改造不处理该情形（超出本片范围），仅去掉「id 列表未变时的无意义 N 次 RPC」。若后续发现陈旧，另开任务。

## 7. 验证（本机可执行，无真机）

- 纯函数单测覆盖：批次形状、依赖顺序、开关 off 的逐项回归锁、副作用清单一致性、tabids 去重。
- `node scripts/check-tsc-baseline.mjs`：类型债不新增。
- `git diff --name-only`：白名单核对。
