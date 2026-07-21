// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { normalizeCanonicalAgentStatus } from "@/app/agent-status/agent-status-service";
import type { AgentStatus } from "@/app/agent-status/agent-status-types";
import { globalStore } from "@/app/store/jotaiStore";
import { waveEventSubscribeSingle } from "@/app/store/wps";
import * as services from "@/store/services";
import { makeORef } from "@/store/wos";
import { PrimitiveAtom, atom } from "jotai";

/**
 * 全局 blockId-keyed agent status 缓存.
 *
 * 背景: InlineTabBlock 只渲染当前 active 的子 block, 切走时其 TermViewModel 被 dispose,
 * 挂在它上面的 `agentStatusAtom` 也随之消失. 直接复用 TermViewModel 的 atom 会导致非激活
 * tab 标签上的状态点消失. 这里提供一套独立于 ViewModel 生命周期的缓存: 第一次有消费者
 * 访问某 blockId 时, 主动做一次 GetAgentStatus + 订阅 "agentstatus" 事件; 用引用计数决定
 * 何时释放订阅, 关闭的 block 不再无谓收事件.
 *
 * 与 session-overview / TermViewModel 各自一份订阅不冲突 —— WPS 事件按 scope 分发,
 * 多消费者只是多一次 globalStore.set; 真正的去重收口由后续 follow-up 统一改读本 store.
 */
type StatusEntry = {
    atom: PrimitiveAtom<AgentStatus | null>;
    refCount: number;
    unsubscribe: () => void;
};

export class AgentStatusStore {
    private static instance: AgentStatusStore | null = null;
    private entries = new Map<string, StatusEntry>();

    private constructor() {}

    static getInstance(): AgentStatusStore {
        if (!AgentStatusStore.instance) {
            AgentStatusStore.instance = new AgentStatusStore();
        }
        return AgentStatusStore.instance;
    }

    static resetInstance(): void {
        AgentStatusStore.instance = null;
    }

    /**
     * 返回 blockId 对应的状态 atom (复用同一份). 调用方负责通过 acquire/release 配对维持引用计数;
     * 仅读取 atom 值不配对 acquire 时, 订阅不会被回收 —— 但只要消费者用 useInlineTabAgentStatus
     * 这条标准入口就不会出现这种泄漏.
     */
    getAgentStatusAtom(blockId: string): PrimitiveAtom<AgentStatus | null> {
        const entry = this.entries.get(blockId);
        if (entry != null) {
            return entry.atom;
        }
        const statusAtom = atom<AgentStatus | null>(null) as PrimitiveAtom<AgentStatus | null>;
        const unsubscribe = waveEventSubscribeSingle({
            eventType: "agentstatus",
            scope: makeORef("block", blockId),
            handler: (event) => {
                globalStore.set(statusAtom, normalizeCanonicalAgentStatus(event.data));
            },
        });
        services.BlockService.GetAgentStatus(blockId)
            .then((status) => {
                globalStore.set(statusAtom, normalizeCanonicalAgentStatus(status));
            })
            .catch((error) => {
                console.log("error getting initial agent status (inline-tab store)", blockId, error);
            });
        this.entries.set(blockId, { atom: statusAtom, refCount: 0, unsubscribe });
        return statusAtom;
    }

    acquire(blockId: string): PrimitiveAtom<AgentStatus | null> {
        const atom = this.getAgentStatusAtom(blockId);
        const entry = this.entries.get(blockId);
        if (entry != null) {
            entry.refCount++;
        }
        return atom;
    }

    release(blockId: string): void {
        const entry = this.entries.get(blockId);
        if (entry == null) {
            return;
        }
        entry.refCount--;
        if (entry.refCount <= 0) {
            entry.unsubscribe();
            this.entries.delete(blockId);
        }
    }
}
