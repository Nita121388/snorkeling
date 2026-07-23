// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { AgentStatus } from "@/app/agent-status/agent-status-types";
import { globalStore } from "@/app/store/jotaiStore";
import { atom, type PrimitiveAtom } from "jotai";

// Per-block "Done 已阅" 时间戳. 与 SessionOverviewModel.agentStatusAckedAtAtom 平行但独立:
// 那份管 R 类未读 (运行中, isAgentStatusUnread 用), 这份管 D 类未读 (完成态跳变,
// isAgentDoneUnread 用). 见决策 6B —— D 走 agent-status 自有通道, 不混到 Session Overview
// 的 ack map 里, 避免改 R 语义与 chip 行为.
//
// ack 触发: 仅"点击 agent Block 头部那枚徽章" (决策 2A).
// 隐式清空: 进入非 idle 时清掉该 block 的 doneAckedAt (方案场景 4), 否则下一轮 idle
// 会被旧 ack 永久压制. 由 observeAgentStatusTransition 在事件层驱动, 不在本 store 里做.

const AgentDoneAckedAtStorageKey = "snorkeling:agent-status:done-acked-at";

function readAgentDoneAckedAt(): Record<string, number> {
    if (typeof window === "undefined") return {};
    try {
        const parsed = JSON.parse(window.localStorage.getItem(AgentDoneAckedAtStorageKey) ?? "{}");
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

function writeAgentDoneAckedAt(value: Record<string, number>): void {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(AgentDoneAckedAtStorageKey, JSON.stringify(value));
}

class AgentStatusDoneAckStore {
    private static instance: AgentStatusDoneAckStore | null = null;
    doneAckedAtAtom: PrimitiveAtom<Record<string, number>> = atom(
        readAgentDoneAckedAt()
    ) as PrimitiveAtom<Record<string, number>>;

    private constructor() {}

    static getInstance(): AgentStatusDoneAckStore {
        if (!AgentStatusDoneAckStore.instance) {
            AgentStatusDoneAckStore.instance = new AgentStatusDoneAckStore();
        }
        return AgentStatusDoneAckStore.instance;
    }

    static resetInstance(): void {
        AgentStatusDoneAckStore.instance = null;
    }

    markDoneAcked(blockId: string, ackedAt = Date.now()): void {
        if (!blockId) return;
        const current = globalStore.get(this.doneAckedAtAtom) ?? {};
        const next = { ...current, [blockId]: ackedAt };
        globalStore.set(this.doneAckedAtAtom, next);
        writeAgentDoneAckedAt(next);
    }

    clearDoneAcked(blockId: string): void {
        if (!blockId) return;
        const current = globalStore.get(this.doneAckedAtAtom) ?? {};
        if (!(blockId in current)) return;
        const next = { ...current };
        delete next[blockId];
        globalStore.set(this.doneAckedAtAtom, next);
        writeAgentDoneAckedAt(next);
    }

    getDoneAckedAt(blockId: string): number {
        const map = globalStore.get(this.doneAckedAtAtom) ?? {};
        return map[blockId] ?? 0;
    }
}

export const agentStatusDoneAckStore = AgentStatusDoneAckStore.getInstance();

// Observe agentstatus status transitions to keep doneAckedAt aligned with D lifecycle:
// when state jumps back to non-idle, clear this block's doneAckedAt so the next idle
// transition can light D again (方案场景 4). Called from the agent-status-store event
// handler with the next-status (already normalizeCanonicalAgentStatus'd) so the same
// authoritative event drives both the D atom and the ack reset.
export function observeAgentStatusTransition(next: AgentStatus | null): void {
    if (next == null) return;
    // 进入非 idle → 下一轮完成可再触发 D, 清掉旧的 ack.
    if (next.state !== "idle" && next.state !== "unknown") {
        agentStatusDoneAckStore.clearDoneAcked(next.blockId);
    }
    // idle 由消费方按 isAgentDoneUnread 判定, 这里不写 ack: 进入 idle 不算"已阅".
}
