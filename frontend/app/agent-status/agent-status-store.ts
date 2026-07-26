// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { observeAgentStatusTransition } from "@/app/agent-status/agent-status-done-ack-store";
import { normalizeCanonicalAgentStatus } from "@/app/agent-status/agent-status-service";
import type { AgentStatus } from "@/app/agent-status/agent-status-types";
import { globalStore } from "@/app/store/jotaiStore";
import { pslogEvent, makeAgentTraceId } from "@/app/store/pslog-trace";
import { waveEventSubscribeSingle } from "@/app/store/wps";
import * as services from "@/store/services";
import { makeORef } from "@/store/wos";
import { PrimitiveAtom, atom, type Getter } from "jotai";

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
    teardownTimer: ReturnType<typeof setTimeout> | null;
};

const TEARDOWN_DELAY_MS = 0;

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
     * 返回 blockId 对应的状态 atom (复用同一份); 不存在时新建并注册订阅 + 初始 GetAgentStatus.
     * 内部使用 —— 公开入口是 acquire/release 配对, refCount 由 acquire 维护.
     */
    private getAgentStatusAtom(blockId: string): PrimitiveAtom<AgentStatus | null> {
        const entry = this.entries.get(blockId);
        if (entry != null) {
            return entry.atom;
        }
        const statusAtom = atom<AgentStatus | null>(null) as PrimitiveAtom<AgentStatus | null>;
        const unsubscribe = waveEventSubscribeSingle({
            eventType: "agentstatus",
            scope: makeORef("block", blockId),
            handler: (event) => {
                const next = normalizeCanonicalAgentStatus(event.data);
                globalStore.set(statusAtom, next);
                // F2 subscribe-recv: paired with the term-model handler.
                // Reason="agent-status-store" lets a grep split the two paths
                // that fire on the same event.
                pslogEvent({
                    event: "agent.status",
                    stage: "subscribe-recv",
                    blockid: blockId,
                    traceid: makeAgentTraceId(blockId, next?.sessionId ?? ""),
                    reason: "agent-status-store",
                });
                observeAgentStatusTransition(next);
                // F3 transition-observed: this is the path that DOES call
                // observeAgentStatusTransition; the term-model handler emits
                // the matching record with Outcome="skipped". Comparing the
                // two on a block over time shows which path its events came
                // through, and thus whether D-ack was reset.
                pslogEvent({
                    event: "agent.status",
                    stage: "transition",
                    blockid: blockId,
                    traceid: makeAgentTraceId(blockId, next?.sessionId ?? ""),
                    reason: "agent-status-store",
                    outcome: "observed",
                });
            },
        });
        services.BlockService.GetAgentStatus(blockId)
            .then((status) => {
                const normalized = normalizeCanonicalAgentStatus(status);
                globalStore.set(statusAtom, normalized);
                // F1 initial-pull-recv (store instance): written directly to
                // the atom WITHOUT observeAgentStatusTransition, so the D-ack
                // reset that re-lights D on the next idle is skipped here too
                // (matches the term-model initial-pull gap). The
                // "transition/skipped" record makes this explicit so a grep
                // catches it the same way it catches the term-model one.
                pslogEvent({
                    event: "agent.status",
                    stage: "initial-pull-recv",
                    blockid: blockId,
                    traceid: makeAgentTraceId(blockId, normalized?.sessionId ?? ""),
                    reason: normalized?.state ?? "",
                });
                pslogEvent({
                    event: "agent.status",
                    stage: "transition",
                    blockid: blockId,
                    traceid: makeAgentTraceId(blockId, normalized?.sessionId ?? ""),
                    reason: "agent-status-store",
                    outcome: "skipped",
                });
            })
            .catch((error) => {
                console.log("error getting initial agent status (inline-tab store)", blockId, error);
            });
        this.entries.set(blockId, { atom: statusAtom, refCount: 0, unsubscribe, teardownTimer: null });
        return statusAtom;
    }

    acquire(blockId: string): PrimitiveAtom<AgentStatus | null> {
        const atom = this.getAgentStatusAtom(blockId);
        const entry = this.entries.get(blockId);
        if (entry != null) {
            entry.refCount++;
            if (entry.teardownTimer != null) {
                clearTimeout(entry.teardownTimer);
                entry.teardownTimer = null;
            }
        }
        return atom;
    }

    release(blockId: string): void {
        const entry = this.entries.get(blockId);
        if (entry == null) {
            return;
        }
        entry.refCount--;
        if (entry.refCount <= 0 && entry.teardownTimer == null) {
            // 不立即拆订阅: React 18 Strict Mode 下 effect cleanup 与下一次 effect 之间
            // 会有一帧零 refCount 窗口, 立刻 unsubscribe + delete entry 会让正在使用中的
            // atom 被作废, 后续重建的新 atom 与组件持有的旧 atom 不一致 → 事件不再触发 re-render.
            // 延一拍再拆; 期间若 acquire 抵达则取消 teardown.
            entry.teardownTimer = setTimeout(() => {
                const current = this.entries.get(blockId);
                if (current == null || current.refCount > 0) {
                    return;
                }
                current.unsubscribe();
                this.entries.delete(blockId);
            }, TEARDOWN_DELAY_MS);
        }
    }

    /**
     * 仅取已缓存的 status atom, 不创建新订阅、不自增 refCount.
     * 适合 C 层 (顶部 app tab) 这种"被动聚合已存在 agent 状态"的消费者: 一个 block 还没人订阅
     * = 它当前没必要在 C 上提示, 直接返回 null. acquire 才是"我要用、订阅"的强信号入口.
     */
    peekStatusAtom(blockId: string): PrimitiveAtom<AgentStatus | null> | null {
        const entry = this.entries.get(blockId);
        if (entry == null) {
            return null;
        }
        return entry.atom;
    }

    // [DIAG] D 复活排查: 暴露 entries 与 doneAckedAt 快照, 让 CDP eval
    // 可在不写代码改动的情况下抓 atom 实时数值. 排查完删除该方法 + window 挂载.
    diagDump(get: Getter): unknown {
        const out: unknown[] = [];
        for (const [blockId, entry] of this.entries.entries()) {
            const status = get(entry.atom);
            out.push({
                blockId,
                refCount: entry.refCount,
                teardownTimer: entry.teardownTimer != null,
                state: status?.state,
                prevState: status?.prevState,
                phase: status?.phase,
                updatedAt: status?.updatedAt,
                sessionId: status?.sessionId,
            });
        }
        return out;
    }
}

// [DIAG] 临时挂在 globalThis 供 inspect-electron-ui 拉数据. 排查后删除.
if (typeof window !== "undefined") {
    // @ts-ignore
    window.__diagAgentStatusStore = AgentStatusStore.getInstance();
    // @ts-ignore
    window.__diagJotaiGet = (atom: unknown) => atom; // 占位, 实际 getter 由调用方注入
}
