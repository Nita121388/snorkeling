// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { agentDoneElapsedMs, formatDoneElapsed, isAgentDoneUnread } from "@/app/agent-status/agent-status-done-unread";
import { agentStatusDoneAckStore } from "@/app/agent-status/agent-status-done-ack-store";
import { nowMinuteTickAtom } from "@/app/agent-status/agent-status-done-tick";
import { AgentStatusStore } from "@/app/agent-status/agent-status-store";
import type { AgentStatus } from "@/app/agent-status/agent-status-types";
import { isAgentStatusUnread } from "@/app/agent-status/agent-status-unread";
import { SessionOverviewModel } from "@/app/session-overview/session-overview-model";
import * as WOS from "@/store/wos";
import { atom, Atom, Getter } from "jotai";

/**
 * C 层 (顶部 app tab) agent status 聚合 — 22 号方案决策 6B 选定: D 走 agent-status 自有通道,
 * 不进 badge.ts set/clear 管线. 这里只把 store 里已存在的 per-block status atom 按 tab 聚合,
 * 渲染交给 TabBadges 槽位复用, 但数据出口与 ack 语义仍归 agent-status 通道管.
 *
 * 设计要点:
 * - 不主动 acquire 任何 block (那样的强订阅会强行订阅未使用的 block); 只 peek 已缓存的 atom
 *   ("agent block 的状态被 inline-tab / term-header / session-overview 之一订阅过才参与聚合").
 * - 收集范围: D (非 idle→idle 跳变未阅) + R.blocked (waiting/blocked 未阅). working/running 不上 tab
 *   圆点 (用户拍板: "完成、阻塞这样的状态才显示状态到 app 的 tab"), 避免在跑的 agent 把顶部 tab
 *   涂成一片主题绿与 D 撞色.
 * - 排序: D 优先 > blocked > 其他; 同优先级按 updatedAt 倒序.
 * - 仅返回未阅信号 (R unread 或 D unread), 已阅的不再在顶部 tab 上提示.
 * - 多 agent: 决策 4 仅显示主槽 1 + 副点 2, 这里把所有未阅点都返回, 由 TabBadges 现有"主槽1+副2"
 *   渲染约定裁切. "不能忽略任何一个 agent" 的兜底由方案待办项继续讨论.
 *
 * Note: formatDoneElapsed 在 derive 内部用 Date.now() — 仅在每次 store atom 变化时重算,
 * 暂不做分钟级 tick (同 A 头部), 后续可统一接 nowAtom.
 */

export type TabAgentStatusDotKind = "R" | "D";

export interface TabAgentStatusDot {
    blockId: string;
    kind: TabAgentStatusDotKind;
    state: string;
    /** perceived display color — done=green, blocked=amber. working 不上 tab 圆点。 */
    color: string;
    /** elapsed label only set for D ("10m" / "1h"). R leaves this empty. */
    elapsedText: string;
    title: string;
}

const TabAgentStatusDotAtomCache = new Map<string, Atom<TabAgentStatusDot[]>>();

function rankPriority(kind: TabAgentStatusDotKind, state: string): number {
    if (kind === "D") return 100;
    if (state === "blocked") return 70;
    // working/stale 不再上 tab 圆点 (collectBlockDots 已过滤); 仅 30 兜底.
    return 30;
}

function updatedAtMs(status: AgentStatus): number {
    const u = status.updatedAt;
    if (typeof u === "number") return u < 1e12 ? u * 1000 : u;
    return 0;
}

function collectBlockDots(
    get: Getter,
    blockIds: string[],
    ackedAtMap: Record<string, number>,
    doneAckedAtMap: Record<string, number>
): TabAgentStatusDot[] {
    const store = AgentStatusStore.getInstance();
    const dots: TabAgentStatusDot[] = [];
    for (const blockId of blockIds) {
        const statusAtom = store.peekStatusAtom(blockId);
        if (statusAtom == null) continue;
        const status = get(statusAtom);
        if (status == null) continue;
        const ackedAt = ackedAtMap[blockId] ?? 0;
        const doneAckedAt = doneAckedAtMap[blockId] ?? 0;
        const unread = isAgentStatusUnread(status, ackedAt);
        const doneUnread = isAgentDoneUnread(status, doneAckedAt);
        if (!unread && !doneUnread) continue;
        if (doneUnread) {
            const elapsedMs = agentDoneElapsedMs(status, Date.now());
            dots.push({
                blockId,
                kind: "D",
                state: status.state,
                color: "#22c55e",
                elapsedText: formatDoneElapsed(elapsedMs),
                title: `Agent done ${formatDoneElapsed(elapsedMs)} ago — switch to block to dismiss`,
            });
        } else if (status.state === "blocked") {
            // R 类仅收 blocked: working/running 不上顶部 tab 圆点 (用户拍板: "完成、阻塞这样的状态
            // 才显示状态到 app 的 tab"). 已阅判定仍走 isAgentStatusUnread.
            dots.push({
                blockId,
                kind: "R",
                state: status.state,
                color: "var(--warning-color, #f59e0b)",
                elapsedText: "",
                title: `Agent blocked — click tab to view`,
            });
        }
        // 其它 R 状态 (working/running/stale/unknown) 不收, 避免在跑的 agent 把顶部 tab 涂成一片
        // accent 绿与 D 完成态绿撞色. 这些状态走 A 头部徽章与 Session Overview chip 已足够提示.
    }
    dots.sort((a, b) => {
        const pa = rankPriority(a.kind, a.state);
        const pb = rankPriority(b.kind, b.state);
        if (pa !== pb) return pb - pa;
        // 同优先级按 updatedAt 倒序: 新的更靠前
        const ua = updatedAtFromBlockId(get, a.blockId);
        const ub = updatedAtFromBlockId(get, b.blockId);
        return ub - ua;
    });
    return dots;
}

function updatedAtFromBlockId(get: Getter, blockId: string): number {
    const store = AgentStatusStore.getInstance();
    const statusAtom = store.peekStatusAtom(blockId);
    if (statusAtom == null) return 0;
    const status = get(statusAtom);
    return status == null ? 0 : updatedAtMs(status);
}

/**
 * 返回该 app tab 下"未阅 agent 状态点"的聚合 atom. D (完成态未阅) 走 agent-status 自有通道,
 * 与 R 共用一份 ack map; 渲染时由 TabBadges 主槽 + 2 副点裁切, 不进 store/badge.ts 管线.
 */
export function getTabAgentStatusDotsAtom(tabId: string): Atom<TabAgentStatusDot[]> {
    if (tabId == null) {
        const empty = atom<TabAgentStatusDot[]>([]);
        return empty;
    }
    let rtn = TabAgentStatusDotAtomCache.get(tabId);
    if (rtn != null) return rtn;
    const tabOref = WOS.makeORef("tab", tabId);
    const tabAtom = WOS.getWaveObjectAtom<Tab>(tabOref);
    const overview = SessionOverviewModel.getInstance();
    rtn = atom((get) => {
        const tab = get(tabAtom);
        const blockIds = tab?.blockids ?? [];
        if (blockIds.length === 0) return [];
        const ackedAtMap = get(overview.agentStatusAckedAtAtom) ?? {};
        const doneAckedAtMap = get(agentStatusDoneAckStore.doneAckedAtAtom) ?? {};
        const dots = collectBlockDots(get, blockIds, ackedAtMap, doneAckedAtMap);
        // 仅在有 D 点亮时才订阅 nowMinuteTickAtom — 不必让无 D 的 tab 跟着分钟刷新空跑.
        // 把 get 放在后面, 没有产生 D 的就跳过这次订阅, 减少无谓 rederive.
        if (dots.some((d) => d.kind === "D")) {
            get(nowMinuteTickAtom);
        }
        return dots;
    });
    TabAgentStatusDotAtomCache.set(tabId, rtn);
    return rtn;
}
