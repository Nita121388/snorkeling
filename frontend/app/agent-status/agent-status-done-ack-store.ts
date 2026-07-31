// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { AgentStatus } from "@/app/agent-status/agent-status-types";
import { fireAgentOsNotification } from "@/app/agent-status/agent-status-notify";
import { globalStore } from "@/app/store/jotaiStore";
import { pslogEvent, makeAgentTraceId } from "@/app/store/pslog-trace";
import { atom, type PrimitiveAtom } from "jotai";
import { atomWithStorage } from "jotai/vanilla/utils";
import type { SyncStorage } from "jotai/vanilla/utils/atomWithStorage";

// Per-block "Done 已阅" 时间戳. 与 SessionOverviewModel.agentStatusAckedAtAtom 平行但独立:
// 那份管 R 类未读 (运行中, isAgentStatusUnread 用), 这份管 D 类未读 (完成态跳变,
// isAgentDoneUnread 用). 见决策 6B —— D 走 agent-status 自有通道, 不混到 Session Overview
// 的 ack map 里, 避免改 R 语义与 chip 行为.
//
// ack 触发: 仅"点击 agent Block 头部那枚徽章" (决策 2A).
// 隐式清空: 进入非 idle 时清掉该 block 的 doneAckedAt (方案场景 4), 否则下一轮 idle
// 会被旧 ack 永久压制. 由 observeAgentStatusTransition 在事件层驱动, 不在本 store 里做.

const AgentDoneAckedAtStorageKey = "snorkeling:agent-status:done-acked-at";

function parseAgentDoneAckedAt(raw: string | null): Record<string, number> {
    try {
        const parsed = JSON.parse(raw ?? "{}");
        if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
            return {};
        }
        const result: Record<string, number> = {};
        for (const [key, value] of Object.entries(parsed)) {
            if (typeof key === "string" && typeof value === "number" && Number.isFinite(value)) {
                result[key] = value;
            }
        }
        return result;
    } catch {
        return {};
    }
}

function readAgentDoneAckedAt(): Record<string, number> {
    if (typeof window === "undefined") return {};
    try {
        return parseAgentDoneAckedAt(window.localStorage.getItem(AgentDoneAckedAtStorageKey));
    } catch {
        return {};
    }
}

function writeAgentDoneAckedAt(value: Record<string, number>): void {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(AgentDoneAckedAtStorageKey, JSON.stringify(value));
}

const AgentDoneAckStorage: SyncStorage<Record<string, number>> = {
    getItem: () => readAgentDoneAckedAt(),
    setItem: (_key, value) => writeAgentDoneAckedAt(value),
    removeItem: () => {
        if (typeof window === "undefined") return;
        window.localStorage.removeItem(AgentDoneAckedAtStorageKey);
    },
    subscribe: (_key, callback) => {
        if (typeof window === "undefined" || typeof window.addEventListener !== "function") return () => {};
        const handleStorage = (event: StorageEvent) => {
            if (event.key !== AgentDoneAckedAtStorageKey) return;
            if (event.storageArea != null && event.storageArea !== window.localStorage) return;
            callback(readAgentDoneAckedAt());
        };
        window.addEventListener("storage", handleStorage);
        return () => window.removeEventListener("storage", handleStorage);
    },
};

// 单例容器. 使用 let 而非 static instance 字段, 便于 resetTestInstance 在测试间
// 重新 new — 每次 new 都会重新读取 localStorage, 避免测试间 stale 数据污染.
// 生产代码调用 getInstance() 拿到的始终是同一个单例, 不会重新读 localStorage.
let singletonInstance: AgentStatusDoneAckStore | null = null;

// Bump signal: markDoneAcked / clearDoneAcked 时 +1, 让所有订阅了它的 derived atom
// 强制 invalidate 快照. 用于绕过 jotai "无订阅者时 atom 不会主动 recompute" 的
// 盲区 — 切 Tab 走掉的 VTabWrapper unmount 期间, 它的 tabDotsAtom 失去订阅者,
// jotai 仅标 dirty 但不重算, 重新订阅时按理会自动重算, 但有些场景下 cached
// snapshot 会被 retain; bumpAtom 兜底强制触发一次重算.
export const ackBumpAtom: PrimitiveAtom<number> = atom(0);

class AgentStatusDoneAckStore {
    doneAckedAtAtom = atomWithStorage<Record<string, number>>(
        AgentDoneAckedAtStorageKey,
        {},
        AgentDoneAckStorage,
        { getOnInit: true }
    ) as PrimitiveAtom<Record<string, number>>;

    private constructor() {}

    static getInstance(): AgentStatusDoneAckStore {
        if (singletonInstance == null) {
            singletonInstance = new AgentStatusDoneAckStore();
        }
        return singletonInstance;
    }

    // 仅测试用 — 强制重建单例, 让下一次 getInstance() 重新读 localStorage.
    // 生产环境绝不应调用此方法.
    static resetTestInstance(): void {
        singletonInstance = null;
    }

    markDoneAcked(blockId: string, ackedAt = Date.now(), source = "header-badge"): void {
        if (!blockId) return;
        // ponytail: 先读取最新持久值以覆盖延迟事件竞态; 两个 renderer 真正同时写入仍是
        // last-writer-wins. 若该边界变成可见问题, 再把 ack 所有权移到主进程 IPC.
        const current = readAgentDoneAckedAt();
        const next = { ...current, [blockId]: ackedAt };
        globalStore.set(this.doneAckedAtAtom, next);
        // bump ackBumpAtom 让所有订阅它的 derived atom (e.g. getTabAgentStatusDotsAtom) 强制
        // invalidate 快照. 配合 mark/clearDoneAcked 一起调用, 防止切 Tab 切换 + 模块
        // 缓存 + jotai "无订阅者不主动 recompute" 三者叠加导致 stale D 显示.
        globalStore.set(ackBumpAtom, globalStore.get(ackBumpAtom) + 1);
        // [DIAG] D 复活排查探针: 把 write 完成后的 doneAckedAtMap 真实读回, 验证 atom 内容.
        // 排查完删除. reason="D-write-verify", outcome="map size + last blockId key".
        const verified = globalStore.get(this.doneAckedAtAtom) ?? {};
        pslogEvent({
            event: "agent.status",
            stage: "ack-write",
            blockid: blockId,
            traceid: makeAgentTraceId(blockId, ""),
            reason: `D-write-verify:${source}`,
            durationms: ackedAt,
            outcome: `bump=${globalStore.get(ackBumpAtom)}|mapSize=${Object.keys(verified).length}|selfVal=${verified[blockId]}`,
        });
        // F4 D-ack-write: the user clicked the agent header badge and this block's
        // doneAckedAt is now ackedAt. Value of ackedAt recorded in durationms so
        // the cross-event timing is recoverable without a separate field; the
        // "D → 0 unread" arc is the comparison target. sessionId not available
        // here (ack store has only the map), so traceId is block-scoped.
        // source 放进 reason 后缀 "D:<source>" — 复现 D 复活时, 一条 grep 就能确认每次
        // doneAckedAt 是由哪条 caller 路径 (header-badge / term-model / 其他) 写入的,
        // 排除"幽灵 ack" (如另一个 Wave 进程共写 localStorage).
        pslogEvent({
            event: "agent.status",
            stage: "ack-write",
            blockid: blockId,
            traceid: makeAgentTraceId(blockId, ""),
            reason: `D:${source}`,
            durationms: ackedAt,
        });
    }

    clearDoneAcked(blockId: string, source = "header-badge"): void {
        if (!blockId) return;
        const current = readAgentDoneAckedAt();
        if (!(blockId in current)) return;
        const next = { ...current };
        delete next[blockId];
        globalStore.set(this.doneAckedAtAtom, next);
        // bump ackBumpAtom 让所有订阅它的 derived atom 强制 invalidate 快照,
        // 同 markDoneAcked 的理由 — 防止 clearDoneAcked 后切 Tab 回来 D 仍残留.
        globalStore.set(ackBumpAtom, globalStore.get(ackBumpAtom) + 1);
        // F4 D-ack-clear: either via observeAgentStatusTransition (state bounced
        // back to non-idle) so next idle re-lights D, or direct. Reason="D"
        // keeps it in the same family as the ack-write; Outcome="cleared" tells
        // a grep this is a removal not an addition.
        pslogEvent({
            event: "agent.status",
            stage: "ack-clear",
            blockid: blockId,
            traceid: makeAgentTraceId(blockId, ""),
            // source 放后缀区分是 transition reset (非用户驱动) 还是直接 clearDoneAcked.
            reason: `D:${source}`,
            outcome: "cleared",
        });
    }

    getDoneAckedAt(blockId: string): number {
        const map = globalStore.get(this.doneAckedAtAtom) ?? {};
        return map[blockId] ?? 0;
    }
}

export const agentStatusDoneAckStore = AgentStatusDoneAckStore.getInstance();

// lastObservedByBlock is an in-memory prev-state cache per blockId so observeAgentStatusTransition
// can classify prev→next transitions for OS-toast dispatch. Intentionally NOT persisted:
// a renderer cold-start that re-derives state from a fresh event will see prev=undefined, which
// decideNotifyKind already treats as "cannot fire 'done' without a prior working state" — the
// worst case is missing one toast on the very first cycle after a window reopen, which is fine.
// Cross-renderer: every renderer that observes the transition owns its own prev snapshot, but
// the OS notify path is deduped at the main-process level (lastFiredByBlock in os-notify.ts) via
// blockId-keyed rate limiting, so multiple windows each firing on the same completion collapse
// to a single toast.
const lastObservedByBlock = new Map<string, AgentStatus>();

// For tests: clear the in-memory prev cache so test cases don't leak state across each other.
// Production code has no reason to call this — the cache rebuilds itself from the live event
// stream on the very next transition for any block whose entry was cleared.
export function _resetLastObservedForTests(): void {
    lastObservedByBlock.clear();
}

// [DIAG] 临时挂载到 window 供 CDP eval 拉数据. 排查 D 复活时:
// node scripts/inspect-electron-ui.mjs eval 'window.__diagDoneAck.get()'
// 同时与 window.__JOTAI_DEFAULT_STORE__.get(window.__diagDoneAck.atom) 对比,
// 验证 atom 内容是否与 localStorage 一致 (不一致就是多进程/HMR 漂移).
if (typeof window !== "undefined") {
    // @ts-ignore
    window.__diagDoneAck = {
        atom: agentStatusDoneAckStore.doneAckedAtAtom,
        get: () => globalStore.get(agentStatusDoneAckStore.doneAckedAtAtom),
        readLS: readAgentDoneAckedAt,
    };
}

// Observe agentstatus status transitions to keep doneAckedAt aligned with D lifecycle:
// when state jumps back to non-idle, clear this block's doneAckedAt so the next idle
// transition can light D again (方案场景 4). Called from the agent-status-store event
// handler with the next-status (already normalizeCanonicalAgentStatus'd) so the same
// authoritative event drives both the D atom and the ack reset.
export function observeAgentStatusTransition(next: AgentStatus | null): void {
    if (next == null) return;
    const prev = lastObservedByBlock.get(next.blockId);
    lastObservedByBlock.set(next.blockId, next);
    // 进入非 idle → 下一轮完成可再触发 D, 清掉旧的 ack.
    if (next.state !== "idle" && next.state !== "unknown") {
        agentStatusDoneAckStore.clearDoneAcked(next.blockId, "transition");
    }
    // idle 由消费方按 isAgentDoneUnread 判定, 这里不写 ack: 进入 idle 不算"已阅".

    // OS-toast dispatch: classify the prev→next transition and fire an OS notification when the
    // transition is "done" (working→idle) or "blocked" (*→blocked). Classifying inside this
    // observer means the cross-renderer initial-pull path (which intentionally skips
    // observeAgentStatusTransition per F1) won't fire a toast on renderer load — we only toast on
    // real transition events. fireAgentOsNotification is defensive and never throws into the
    // transition handler; settings/suppression/rate-limit all live in the main process
    // (emain/os-notify.ts).
    fireAgentOsNotification(next, prev);
}
