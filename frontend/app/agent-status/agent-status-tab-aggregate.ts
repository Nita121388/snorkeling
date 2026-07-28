// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { agentDoneElapsedMs, formatDoneElapsed, isAgentDoneUnread } from "@/app/agent-status/agent-status-done-unread";
import { ackBumpAtom, agentStatusDoneAckStore } from "@/app/agent-status/agent-status-done-ack-store";
import { nowMinuteTickAtom } from "@/app/agent-status/agent-status-done-tick";
import { AgentStatusStore } from "@/app/agent-status/agent-status-store";
import type { AgentStatus } from "@/app/agent-status/agent-status-types";
import { isAgentStatusUnread, normalizeTimeMs, type AgentStatusFp } from "@/app/agent-status/agent-status-unread";
import { makeAgentTraceId, pslogEvent } from "@/app/store/pslog-trace";
import { SessionOverviewModel } from "@/app/session-overview/session-overview-model";
import * as WOS from "@/store/wos";
import { atom, Atom, Getter } from "jotai";
import { useEffect } from "react";
import { useAtomValue } from "jotai";

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
 *   特性保留: working/running 永不上 tab 圆点, 为了减少噪音 — 有必要的才提示用户. 运行中的视觉色
 *   (蓝通道, 与 accent 解耦) 只在 Sessions Overview chip / term header pill / A 头部 pill 等
 *   surface 渲染, 顶部 tab 永远只承担 D / blocked 两类信号.
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


// 对一组 tabIds 派生"本工作区该 acquire 的 blockId 全集 (顶层 + inline 子 block)".
// 缓存以 tabIds.join("") 为 key, 避免每次渲染都重建一个 derived atom.
// 反应式: 它订阅每个 tab/block 的 WOS atom, 任一变化 (tab.blockids 增删、block.subblockids 增删)
// 都会重 derive, 上层 useAtomValue 拿到新列表后重跑 acquire/release 配对.
const WorkspaceBlockIdsAtomCache = new Map<string, Atom<string[]>>();

// 对一组 tabIds 派生"有未阅 agent 状态点 (D 或 R.blocked) 的 tabId 集合".
// 供 TabBar/VTabBar 的 visibleTabIds 过滤使用: 即使某 tab 非激活、非悬停、非本次启动新开,
// 只要有未阅点就强制 keep 到 visibleTabIds — 否则该 TabInner 不挂载, dots 永远画不出来,
// 用户必须先点过去才看到状态 (这正是本次要修的 bug).
//
// 缓存: 以 tabIds.join(" ") 为 key. 每次调用都 new outer atom 会让 useAtomValue 重新订阅,
// 触发 TabBar/VTabBar 重 render, 重 render 又调 getTabsWithUnreadDotsAtom 又 new atom →
// 死循环 (Tooltip "Maximum update depth exceeded"). 用缓存复用同一个 outer atom.
//
// 但是单纯缓存会重蹈 stale 闭包的内层 atom snapshot bug —— 内层 `getTabAgentStatusDotsAtom`
// 仍每次 new, cached outer atom 闭包里持有的 `tabDotAtoms[i]` 是首次构建的 inner atom 实例,
// 那份 inner atom 不再被 bump 推动. 解法: outer atom 显式订阅 ackBumpAtom, 把 ack 写入
// (markDoneAcked / clearDoneAcked) 当作 outer 的 invalidation 信号; bump 会强制 outer 重 derive,
// 重新执行闭包读取内层 atom, 此时内层 atom 会重新读取 doneAckedAtAtom 最新值.
const TabsWithUnreadDotsAtomCache = new Map<string, Atom<Set<string>>>();

export function getTabsWithUnreadDotsAtom(tabIds: string[]): Atom<Set<string>> {
    const key = tabIds.join(" ");
    const cached = TabsWithUnreadDotsAtomCache.get(key);
    if (cached != null) return cached;
    const tabDotAtoms = tabIds.map((id) => getTabAgentStatusDotsAtom(id));
    const derived = atom<Set<string>>((get) => {
        // 订阅 ackBumpAtom 强制 outer 在任何 ack 写入 (markDoneAcked / clearDoneAcked /
        // markAgentStatusAcked 现在也 bump) 时重 derive, 走一遍内层 atom 拿最新 doneAckedAtAtom.
        // 否则 cached outer 闭包持有的 inner atom 实例在它首次被 inner 创建时已 "freeze",
        // 后续 outer 重 derive 不会让那份 inner 重新读 atom.
        get(ackBumpAtom);
        const out = new Set<string>();
        for (let i = 0; i < tabIds.length; i++) {
            const dots = get(tabDotAtoms[i]);
            if (dots != null && dots.length > 0) {
                out.add(tabIds[i]);
            }
        }
        return out;
    });
    TabsWithUnreadDotsAtomCache.set(key, derived);
    return derived;
}

function getWorkspaceBlockIdsAtom(tabIds: string[]): Atom<string[]> {
    const key = tabIds.join("");
    const cached = WorkspaceBlockIdsAtomCache.get(key);
    if (cached != null) return cached;
    const derived = atom<string[]>((get) => {
        const out: string[] = [];
        const seen = new Set<string>();
        for (const tabId of tabIds) {
            const tab = get(WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", tabId)));
            const topIds = tab?.blockids;
            if (topIds == null) continue;
            for (const topId of topIds) {
                if (!seen.has(topId)) {
                    seen.add(topId);
                    out.push(topId);
                }
                const block = get(WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", topId)));
                const sub = block?.subblockids;
                if (sub == null) continue;
                for (const subId of sub) {
                    if (!seen.has(subId)) {
                        seen.add(subId);
                        out.push(subId);
                    }
                }
            }
        }
        return out;
    });
    WorkspaceBlockIdsAtomCache.set(key, derived);
    return derived;
}

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

/**
 * 把 tab.blockids 顶层 block 展开成"顶层 + 各自 inline 子 block"全集.
 * inline-tab 子 block 列在父 Block.subblockids, 用户从未切到的 tab 里这些子 block
 * 不会被 InlineTabBlock 渲染, 也不会触发 useInlineTabAgentStatus 的 acquire;
 * C 层聚合若只走 tab.blockids 就会漏掉它们的 agent 状态, 所以这里一并并入.
 */
function expandBlockIdsWithSubblocks(get: Getter, blockIds: string[]): string[] {
    if (blockIds.length === 0) return blockIds;
    const out: string[] = [];
    const seen = new Set<string>();
    for (const blockId of blockIds) {
        if (!seen.has(blockId)) {
            seen.add(blockId);
            out.push(blockId);
        }
        const blockAtom = WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", blockId));
        const block = get(blockAtom);
        const sub = block?.subblockids;
        if (sub == null) continue;
        for (const subId of sub) {
            if (!seen.has(subId)) {
                seen.add(subId);
                out.push(subId);
            }
        }
    }
    return out;
}

function collectBlockDots(
    get: Getter,
    blockIds: string[],
    ackedFpMap: Record<string, string>,
    doneAckedAtMap: Record<string, number>
): TabAgentStatusDot[] {
    const store = AgentStatusStore.getInstance();
    // expand: 每个 tab.blockids 顶层 block, 若其含 inline 子 block (subblockids), 一并纳入聚合,
    // 否则非激活 inline 子 block 的 D 点在任何 tab 上都会缺失.
    const expanded = expandBlockIdsWithSubblocks(get, blockIds);
    const dots: TabAgentStatusDot[] = [];
    for (const blockId of expanded) {
        const statusAtom = store.peekStatusAtom(blockId);
        if (statusAtom == null) continue;
        const status = get(statusAtom);
        if (status == null) continue;
        // [DIAG] D 复活排查探针: 进入每个 block 的判定循环时, 记录 doneAckedAtMap 的来源,
        // 用于排查 derive 是不是从 stale atom 读到 0. 排查完后删除.
        // 触发条件: state=idle 且 prevState 非 idle (即可能产生 D 的状态), 每次循环都打一条,
        // 确认 map 在 derive 入口处 selfVal 是否真的为 0 还是说已经被写入.
        if (status.state === "idle" && status.prevState != null && status.prevState !== "idle" && status.prevState !== "unknown") {
            const selfVal = doneAckedAtMap[blockId] ?? 0;
            const updatedAtMs = normalizeTimeMs(status.updatedAt);
            pslogEvent({
                event: "agent.status",
                stage: "transition",
                blockid: blockId,
                traceid: makeAgentTraceId(blockId, status.sessionId ?? ""),
                reason: "D-derive-entry",
                outcome: `${status.state}|prev=${status.prevState ?? ""}|selfAck=${selfVal}|upd=${updatedAtMs}`,
                durationms: updatedAtMs,
            });
        }
        // ackedFpMap[blockId] 在写入时由 statusFingerprint(status) 产出 (state|phase|source),
        // 结构上必为 AgentStatusFp 模板字面量类型; 但 localStorage 反序列化与 Record<string,string>
        // 索引会让 TS 拿到宽 string, 这里窄化回 AgentStatusFp 以满足 isAgentStatusUnread 形参类型.
        const ackedFpRaw = ackedFpMap[blockId] ?? null;
        const ackedFp: AgentStatusFp | null = ackedFpRaw == null ? null : (ackedFpRaw as AgentStatusFp);
        const doneAckedAt = doneAckedAtMap[blockId] ?? 0;
        const unread = isAgentStatusUnread(status, ackedFp);
        const doneUnread = isAgentDoneUnread(status, doneAckedAt);
        if (!unread && !doneUnread) continue;
        if (doneUnread) {
            // D 与 R 是两条独立事件流, 各自有独立 ack map (doneAckedAtAtom vs ackedFpAtom).
            // 用户点 header 同时写两边只是"当下清显示", 不应让上一轮 R 的 fp 残留把
            // 下一轮 D 永久压死 — 否则一旦 block 在 ack 后又 working→idle 再跳一次,
            // ackedFpMap[blockId] 永驻不清 (markAgentStatusAcked 只覆盖不删, transition
            // 也只清 doneAckedAt), D 被这条 sticky fp 长期 silence, C 永远不亮完成态.
            // D 是否已读全权交给 isAgentDoneUnread (updatedAt vs doneAckedAt) 判定即可.
            const elapsedMs = agentDoneElapsedMs(status, Date.now());
            // [DIAG] D 复活排查探针: 每次 tab 圆点 derive 出一个 D 时, 打一份关键数值
            // (updatedAt, doneAckedAt, prevState, 当前 state) 进 pslog, 让我能反推
            // D 是"用户新一轮完成" (updatedAt > doneAckedAt 且 prevState=working) 还是
            // "ack 丢失 / atom 重建漏 prev" 等场景. reason="D-derive", outcome=state,
            // durationms=updatedAt(ms); doneAckedAt 与 prevState 因 pslog 字段定型放进
            // trace 后缀 (用 trace 字段为控制零字符量限制,够 grep 即可). 排查完后删除.
            const updatedAtMs = normalizeTimeMs(status.updatedAt);
            pslogEvent({
                event: "agent.status",
                stage: "transition",
                blockid: blockId,
                traceid: makeAgentTraceId(blockId, status.sessionId ?? ""),
                reason: "D-derive",
                outcome: `${status.state}|prev=${status.prevState ?? ""}|ack=${doneAckedAt}|upd=${updatedAtMs}`,
                durationms: updatedAtMs,
            });
            dots.push({
                blockId,
                kind: "D",
                state: status.state,
                // D 完成 tab 圆点走主题感知 --agent-done-color (与 success 解耦), 回退 #22c55e,
                // 不再硬编码绿 — 之前硬 #22c55e 在深色主题下与 accent 绿撞色.
                color: "var(--agent-done-color, #22c55e)",
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
    const tabOref = WOS.makeORef("tab", tabId);
    const tabAtom = WOS.getWaveObjectAtom<Tab>(tabOref);
    const overview = SessionOverviewModel.getInstance();
    // 每次调用都创建新的 atom — 不缓存. 原因: 切 Tab 走掉 VTabWrapper unmount 后,
    // useAtomValue 订阅断开, jotai 的 derived atom snapshot 停在 ack 前的旧值;
    // 重新 mount 时若返回同一 cached atom, 可能拿到 stale snapshot (jotai 内部
    // 在订阅断开→复 mount 间保留旧快照). 每次 new atom 保证 re-derive 读到最新
    // doneAckedAtAtom 值. 性能: 每个 tab 一次 new atom 可忽略.
    return atom((get) => {
        const tab = get(tabAtom);
        const blockIds = tab?.blockids ?? [];
        if (blockIds.length === 0) return [];
        const ackedFpMap = get(overview.agentStatusAckedFpAtom) ?? {};
        const doneAckedAtMap = get(agentStatusDoneAckStore.doneAckedAtAtom) ?? {};
        // Force re-derive on any ack write/clear — see agent-status-done-ack-store
        // comment on ackBumpAtom for the reasoning (bypasses jotai "no subscribers
        // → don't recompute" blind spot when VTabWrapper unmounts then remounts).
        // Both R-class (ackedFpAtom) and D-class (doneAckedAtAtom) writes are covered.
        get(ackBumpAtom);
        // Also subscribe to the R-class ack atom directly — markAgentStatusAcked
        // writes to agentStatusAckedFpAtom but does NOT bump ackBumpAtom, so
        // R-class stale snapshots survive tab switch-back when the derived atom
        // was unsubscribed (VTabWrapper unmount) and the jotai snapshot was
        // retained across the unmount boundary.  The R-class has no minute-tick
        // to force a re-derive either (only D-class opts into nowMinuteTickAtom).
        // Reading ackedFpAtom here creates the dependency so any write to it
        // (markAgentStatusAcked) invalidates and re-renders this derived atom.
        get(overview.agentStatusAckedFpAtom);
        const dots = collectBlockDots(get, blockIds, ackedFpMap, doneAckedAtMap);
        // 仅在有 D 点亮时才订阅 nowMinuteTickAtom — 不必让无 D 的 tab 跟着分钟刷新空跑.
        // 把 get 放在后面, 没有产生 D 的就跳过这次订阅, 减少无谓 rederive.
        if (dots.some((d) => d.kind === "D")) {
            get(nowMinuteTickAtom);
        }
        return dots;
    });
}

/**
 * 让本工作区所有 tab 的顶层 block 及 inline 子 block 都在 AgentStatusStore 持有一份订阅
 * (acquire), 即使该 tab 没被切到、InlineTabBlock 没挂载也照常订阅.
 *
 * 必要性: C 层聚合用 peekStatusAtom 只看"已 acquire 过的 blockId", 对从未切到过的 tab,
 * 其 inline 子 block 的 useInlineTabAgentStatus / TermViewModel 都没跑过 acquire, peekStatusAtom
 * 会返回 null → 该 tab 的"未阅 agent 状态点"在 Tab 栏永远不显示, 必须先切到该 tab 才浮现.
 * 在 TabBar/VTabBar 层 (始终挂载) 调本 hook 把本工作区所有相关 block 都 acquire 一遍,
 * 让 store 全程持有订阅, peekStatusAtom 才有数据可读 — 非激活 tab 也能在 Tab 栏显示状态.
 *
 * 引用计数由 AgentStatusStore.acquire/release 配对维护; Strict Mode 下 cleanup→remount 之间
 * 的零 refCount 窗口由 store 内部 TEARDOWN_DELAY_MS 兜底 (acquire 抵达会取消 teardown),
 * 这里只管按 effect 生命周期配对 acquire/release 即可.
 */
export function useAcquireWorkspaceBlockStatuses(tabIds: string[]): void {
    const store = AgentStatusStore.getInstance();
    // 反应式取得本工作区所有相关 block (顶层 + inline 子 block) 的全集; 任一 tab/block 变化会重 derive,
    // 上层 useAtomValue 触发 re-render.
    const blockIds = useAtomValue(getWorkspaceBlockIdsAtom(tabIds));
    // 仅在 blockIds 实际集合变化时重做 acquire/release, 避免每次 derive 产生新数组引用就重新订阅
    // (否则会触发 store 的 teardown 兜底逻辑反复 un/subscribe 同一批 block, 浪费 GetAgentStatus 请求).
    const blockKey = blockIds.join(" ");
    useEffect(() => {
        for (const blockId of blockIds) {
            store.acquire(blockId);
        }
        return () => {
            for (const blockId of blockIds) {
                store.release(blockId);
            }
        };
        // 依赖用稳定的 blockKey 字符串而不是 blockIds 数组本身; effect body 里仍按 blockIds 配对.
        // blockIds 在每次 derive 是新引用, blockKey 在内容不变时是同一字符串.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [store, blockKey]);
}
