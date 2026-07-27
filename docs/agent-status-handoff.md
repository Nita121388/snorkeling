# Agent Status "ack 后状态又复活" 问题 - 处理交接文档

> 本文档是给下一个 agent 交接用的纯事实档案。**不含任何推理结论**，只罗列客观证据、源码句段、工具命令、能复现的关键数据。下个 agent 据此继续定位（不被上一个 agent 的偏见带跑）。

---

## 0. 文档生成时的事实边界

- 当前 commit: `e3dc1395`，分支 `main`。
- 本地未提交修改：3 个文件（见 §2 完整 diff）。
- 运行中的 Electron renderer **已被 Vite HMR 推到当前本地源**（已通过 `acquire.toString().indexOf("startSubscription") >= 0` 实测为 `true`，`typeof pullInitialAgentStatus === "function"`）。但页面**没有完整硬刷新**（F5/Cmd-R），HMR 只更新了被改模块的代码，React tree 上的 closure（如 TermViewModel 缓存的 `this.agentStatusAtom`）仍按本次 HMR 重建前的引用继续持有。
- 后端 Go 进程是当前 dev session，但后端日志 `waveapp.log` 最后写入时间为 `2026-07-23 19:01:44`（mtime），与"渲染里实际跟 agent 对话的现在"差了 3 天。**该日志不是当前 session 的日志**——路径 `C:/Users/nita/AppData/Local/snorkeling-dev/Data/waveapp.log` 里的内容是上一周 Electron+wavesrv 的残留，**当前 wavesrv 可能写到了别的路径或被截断**。下个 agent 如需后端 pslog，必须先确认真实日志路径，不要假设。

---

## 1. 用户描述的“症状”

按用户口述记录（不再翻译，原样保留）：

> "现在从置灰状态再次进入工作状态时，agent 的状态恢复了完成状态，但是 Tab 化 Block 的 Tab 状态正常的 working 状态。完成后三处正常，ack 后三处正常，切换 app 的 Tab 页后，清空的 app 的 Tab 状态恢复为完成，再且切换回来，又恢复正常的清空态。"

> "我明明点了的，你做了什么让状态又恢复到看上去没 ack 的样子？"

把上面口述**翻译为可复现的动作序列**（不加入因果判断，只列"做了什么→看到什么"）：

1. agent 完成（idle，prevState=working）→ 三个圆点（A 块头部 pill / B inline tab 状态点 / C 顶部 app tab 圆点）都显示 D done 未读（亮 D）。
2. 用户**点 ack**（pill/header badge 点击）→ 三个圆点都灰化（is-acked）。
3. **agent 再次进入 working**（新一轮）→ "agent 的状态恢复了完成状态"（A 路 pill 显示完成），**但 B 路 inline tab 状态点正常显示 working**。即 A 与 B 不一致：A 停在 stale 的完成态，B 是当前的真实 working 态。
4. 第二轮又完成（idle）→ 三处正常显示 D done 未读。
5. 再次点 ack → 三处正常灰化。
6. **切 app 的 Tab 页**（切到另一个 workspace）→ 原本被 ack 清空的 app Tab 圆点（C 路）**恢复为完成态（D 点亮）**。
7. **再切回来** → C 路又恢复成灰（正常清空态）。

下个 agent 注意：用户描述里有**两个**“复活”现象，分别在 (3) 和 (6)：
- (3) "再次进入 working 时 A 路显示完成" → 似乎只发生在 **A 路（block header pill）**。
- (6) “切 app tab 时 C 路恢复完成” → 只发生在 **C 路（顶部 app tab 圆点）**。
- B 路（inline tab 状态点）在 (3) 中明确“正常 working”，在 (6) 中没单独提及，未排除也未确认。


---
## 2. 本地未提交 diff (git diff HEAD, 三个文件全量, 未经编辑)

```diff
diff --git a/frontend/app/agent-status/agent-status-done-ack-store.ts b/frontend/app/agent-status/agent-status-done-ack-store.ts
index 45389ef8..3c870f04 100644
--- a/frontend/app/agent-status/agent-status-done-ack-store.ts
+++ b/frontend/app/agent-status/agent-status-done-ack-store.ts
@@ -115,16 +115,15 @@ class AgentStatusDoneAckStore {
 
 export const agentStatusDoneAckStore = AgentStatusDoneAckStore.getInstance();
 
-// [DIAG] 临时挂载到 window 供 CDP eval 拉数据. 排查 D 复活时:
-// node scripts/inspect-electron-ui.mjs eval 'window.__diagDoneAck.get()'
-// 同时与 window.__JOTAI_DEFAULT_STORE__.get(window.__diagDoneAck.atom) 对比,
-// 验证 atom 内容是否与 localStorage 一致 (不一致就是多进程/HMR 漂移).
+// [DIAG-D-RESURRECT-v2] 临时, 排查 "ack 后 B/C 不归零" 现场用. 与 v1 不同:
+// 不暴露 atom 引用 (jotai atom 引用变化也无效, 不如直接 call store.get/set).
+// 只暴露一个能从 CDP eval 直接读 doneAckedAt 当前 atom 内容 + LS 内容的 helper.
+// 排查后删除整段.
 if (typeof window !== "undefined") {
     // @ts-ignore
     window.__diagDoneAck = {
-        atom: agentStatusDoneAckStore.doneAckedAtAtom,
-        get: () => globalStore.get(agentStatusDoneAckStore.doneAckedAtAtom),
-        readLS: readAgentDoneAckedAt,
+        getAtom: () => globalStore.get(agentStatusDoneAckStore.doneAckedAtAtom),
+        getLS: readAgentDoneAckedAt,
     };
 }
 
diff --git a/frontend/app/agent-status/agent-status-store.ts b/frontend/app/agent-status/agent-status-store.ts
index cf590d48..c293e038 100644
--- a/frontend/app/agent-status/agent-status-store.ts
+++ b/frontend/app/agent-status/agent-status-store.ts
@@ -26,8 +26,13 @@ import { PrimitiveAtom, atom, type Getter } from "jotai";
 type StatusEntry = {
     atom: PrimitiveAtom<AgentStatus | null>;
     refCount: number;
-    unsubscribe: () => void;
+    unsubscribe: (() => void) | null;
     teardownTimer: ReturnType<typeof setTimeout> | null;
+    // alive = 当前有活的事件订阅. false 表示 entry 处于"休眠":
+    // atom 引用仍稳定保留 (TVM/InlineTab 都还攥着它), 但事件订阅已拆、
+    // 当前没人 new 拉过该 block 的状态. peekStatusAtom 据此决定是否
+    // 给 C 层聚合可见 —— 没 acquire 过的 block 不该上顶部 Tab 圆点.
+    alive: boolean;
 };
 
 const TEARDOWN_DELAY_MS = 0;
@@ -59,6 +64,37 @@ export class AgentStatusStore {
             return entry.atom;
         }
         const statusAtom = atom<AgentStatus | null>(null) as PrimitiveAtom<AgentStatus | null>;
+        // 关键设计: atom 引用一旦创建就**对该 blockId 永久稳定**, 不随订阅拆/重建换实例.
+        // 否则 TermViewModel 这种 ctor 期缓存 atom 引用的消费者会在 store 中途休眠后又
+        // acquire 重建时拿到新 atom 实例, 死攥旧孤儿 atom, 事件再不触发 re-render
+        // (commit a01d850b 的同型 bug 在 B 路已修, A 路残留).
+        const newEntry: StatusEntry = {
+            atom: statusAtom,
+            refCount: 0,
+            unsubscribe: null,
+            teardownTimer: null,
+            alive: false,
+        };
+        this.entries.set(blockId, newEntry);
+        // 首次创建: 既要订阅事件, 也要主动 BreakService.GetAgentStatus 拉一次初始状态,
+        // atom 在没有任何事件通知时也有值 (订阅未到之前需 fallback 渲染). 注意首次拉取与
+        // 后续订阅带来的事件不同 —— GetAgentStatus 不带 prevState/backfill (没有上一帧概念),
+        // 因此 isAgentDoneUnread 对初始帧不点亮 D,这是预期边界 (场景 6 开局不点亮).
+        this.startSubscription(blockId);
+        this.pullInitialAgentStatus(blockId);
+        return statusAtom;
+    }
+
+    // 建立 (或重建) 该 block 的"事件订阅"部分. 只动 waveEventSubscribeSingle +
+    // entry.unsubscribe, 不主动 GetAgentStatus. 这样休眠→复活路径 (acquire 在 alive=false
+    // 上的分支) 拿到的 atom 仍保留休眠前最后一帧的 status (含 prevState, 即跳变派生 D 的
+    // 关键字段), 不被 GetAgentStatus 的 prevState=undefined 快照覆盖掉.
+    // 后续若服务端状态机有变化, 由 attachPrevState 装好 prevState 的 agentstatus 事件来更新.
+    private startSubscription(blockId: string): void {
+        const entry = this.entries.get(blockId);
+        if (entry == null) return;
+        if (entry.unsubscribe != null) return; // 已活
+        const statusAtom = entry.atom;
         const unsubscribe = waveEventSubscribeSingle({
             eventType: "agentstatus",
             scope: makeORef("block", blockId),
@@ -91,6 +127,17 @@ export class AgentStatusStore {
                 });
             },
         });
+        entry.unsubscribe = unsubscribe;
+        entry.alive = true;
+    }
+
+    // 仅在 cache-miss 首次创建 entry 时拉一次初始 GetAgentStatus 把 atom 填一个 fallback 值.
+    // 不在休眠→acquire 复活路径上调用 —— 那条路径需要保留 atom 现有 prevState, 不能被服务端
+    // "无 prevState" 的快照覆盖 (否则用户已 ack 的 D 圆点会因为 prevState 丢失而被点亮/熄灭异常).
+    private pullInitialAgentStatus(blockId: string): void {
+        const entry = this.entries.get(blockId);
+        if (entry == null) return;
+        const statusAtom = entry.atom;
         services.BlockService.GetAgentStatus(blockId)
             .then((status) => {
                 const normalized = normalizeCanonicalAgentStatus(status);
@@ -120,8 +167,6 @@ export class AgentStatusStore {
             .catch((error) => {
                 console.log("error getting initial agent status (inline-tab store)", blockId, error);
             });
-        this.entries.set(blockId, { atom: statusAtom, refCount: 0, unsubscribe, teardownTimer: null });
-        return statusAtom;
     }
 
     acquire(blockId: string): PrimitiveAtom<AgentStatus | null> {
@@ -133,6 +178,12 @@ export class AgentStatusStore {
                 clearTimeout(entry.teardownTimer);
                 entry.teardownTimer = null;
             }
+            // 休眠后再次 acquire: 复活同一 atom 的订阅. 不新建 atom,
+            // 这是关键的"对齐 alive"路径 —— 旧消费者持有的 atom 引用
+            // 因此自动接收后续事件, 不再成为孤儿.
+            if (!entry.alive) {
+                this.startSubscription(blockId);
```

(续上 diff, agent-status-store.ts 的剩余行)
```diff
 
     /**
-     * 仅取已缓存的 status atom, 不创建新订阅、不自增 refCount.
+     * 仅取已活(有订阅、有状态来源)的 status atom, 不创建新订阅、不自增 refCount.
      * 适合 C 层 (顶部 app tab) 这种"被动聚合已存在 agent 状态"的消费者: 一个 block 还没人订阅
      * = 它当前没必要在 C 上提示, 直接返回 null. acquire 才是"我要用、订阅"的强信号入口.
      */
@@ -169,6 +226,9 @@ export class AgentStatusStore {
         if (entry == null) {
             return null;
         }
+        if (!entry.alive) {
+            return null;
+        }
         return entry.atom;
     }
 
@@ -191,6 +251,14 @@ export class AgentStatusStore {
         }
         return out;
     }
+
+    // [DIAG-v3] 暴露 internal store + atom, 让 CDP 不需 rewrite jotaiStore.
+    diagGetStoreRead(): { get: (atom: unknown) => unknown; storeAtomForBlockId: (blockId: string) => unknown } {
+        return {
+            get: (atom: unknown) => globalStore.get(atom as any),
+            storeAtomForBlockId: (blockId: string) => this.entries.get(blockId)?.atom ?? null,
+        };
+    }
 }
 
 // [DIAG] 临时挂在 globalThis 供 inspect-electron-ui 拉数据. 排查后删除.
```
