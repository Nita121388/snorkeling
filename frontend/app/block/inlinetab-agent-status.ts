// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Shared presentation helper for the inline-tab agent status dot.
// Used by BOTH the strip label (InlineTabLabel) and the "more tabs" dropdown
// (tabsInfo): keep the R/D noise-reduction rules in one place so the two
// surfaces never drift apart.
//
// Presentation rules (mirrors 19/22 号方案):
// - R-class (working/blocked …): shown when its fingerprint is un-acked.
// - D-class (transitioned to idle, still unreviewed): also lights up.
// - idle/unknown with no doneUnread: suppressed for noise reduction.

import { agentStatusPresentation, isInferredAgentStatus } from "@/app/agent-status/agent-status-derive";
import { agentDoneElapsedMs, formatDoneElapsed, isAgentDoneUnread } from "@/app/agent-status/agent-status-done-unread";
import { AgentStatusStore } from "@/app/agent-status/agent-status-store";
import type { AgentStatus } from "@/app/agent-status/agent-status-types";
import { isAgentStatusUnread } from "@/app/agent-status/agent-status-unread";
import type { Getter } from "jotai";

export type InlineTabStatusDot = {
    state: string;
    inferred: boolean;
    unread: boolean;
    doneUnread: boolean;
    doneElapsedText: string;
    title: string;
};

export function buildAgentStatusDot(
    agentStatus: AgentStatus | null,
    blockId: string,
    ackedFpMap: Record<string, string> | null | undefined,
    doneAckedAtMap: Record<string, number> | null | undefined,
    nowMs: number = Date.now()
): InlineTabStatusDot | null {
    if (agentStatus == null) {
        return null;
    }
    const state = agentStatus.state;
    const ackedFp = ackedFpMap?.[blockId] ?? null;
    const unread = isAgentStatusUnread(agentStatus, ackedFp);
    const doneAckedAt = doneAckedAtMap?.[blockId] ?? 0;
    const doneUnread = isAgentDoneUnread(agentStatus, doneAckedAt);
    // idle/unknown 默认不渲染 R 状态点减噪; 但 D 触发 (doneUnread) 后即便 state=idle
    // 也要点亮, 否则进入"开局即 idle 不亮"分支会把 D 也误吞.
    if ((state === "idle" || state === "unknown") && !doneUnread) {
        return null;
    }
    const presentation = agentStatusPresentation(agentStatus);
    const inferred = isInferredAgentStatus(agentStatus);
    const doneElapsedMs = doneUnread ? agentDoneElapsedMs(agentStatus, nowMs) : 0;
    const doneElapsedText = doneUnread ? formatDoneElapsed(doneElapsedMs) : "";
    return {
        state,
        inferred,
        unread,
        doneUnread,
        doneElapsedText,
        title: `${presentation.label}${inferred ? " (inferred)" : ""}${
            unread
                ? " — click to mark as read"
                : doneUnread
                  ? ` — done ${doneElapsedText} ago, switch to block to dismiss`
                  : " — up to date"
        }`,
    };
}

/**
 * Resolve a status dot from inside a jotai derived atom (those can't use hooks).
 * Uses AgentStatusStore.peekPresentedStatusAtom so the dropdown only reads
 * already-subscribed statuses instead of creating new subscriptions — the
 * strip labels hold acquire() for every tab in the group, so peeks hit.
 */
export function getAgentStatusDotInAtom(
    get: Getter,
    store: AgentStatusStore,
    blockId: string,
    ackedFpMap: Record<string, string> | null | undefined,
    doneAckedAtMap: Record<string, number> | null | undefined
): InlineTabStatusDot | null {
    const presented = store.peekPresentedStatusAtom(blockId);
    if (presented == null) {
        return null;
    }
    const status = get(presented);
    return buildAgentStatusDot(status, blockId, ackedFpMap, doneAckedAtMap);
}

/**
 * Locality of a block's path: remote iff its connection meta is non-local.
 * `local`, `local:*`, and blank all count as local; `wsl://` and ssh
 * connections count as remote.
 */
export function blockPathLocality(connection: unknown): { isRemote: boolean; connection: string } {
    const conn = typeof connection === "string" ? connection.trim() : "";
    if (conn === "" || conn === "local" || conn.startsWith("local:")) {
        return { isRemote: false, connection: conn };
    }
    return { isRemote: true, connection: conn };
}
