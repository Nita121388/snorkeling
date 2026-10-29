// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 打开的会话（open sessions）纯逻辑投影。
//
// 不 import jotai / react：输入是已取好的 block/tab/布局快照，输出是可直测的数据结构。
// 状态层（open-sessions-store.ts）负责从 wos + layoutModel 取数并订阅。
//
// 级别定义（由弱到强）：
//   open     block 存在且绑定了 sessionId（含未激活 tab、最小化、隐藏）
//   visible  block 当前真的渲染在屏幕上（布局叶子 active 子块，且非 hidden / minimized）
//   active   所在 tab 是当前工作区的 activetabid（且 visible）
//   focused  就是当前焦点节点解析出的 block
//
// 与「进程在跑」（useSessionsRunning）正交：在跑 ≠ 已打开，已打开 ≠ 在跑。

import { resolveAgentSessionIdFromMeta } from "@/app/view/term/agent-session";
import { getLayoutDataActiveBlockId } from "@/layout/lib/inlineTabs";
import type { LayoutNode } from "@/layout/lib/types";

export type OpenLevel = "open" | "visible" | "active" | "focused";
export type OpenState = "any" | "open" | "visible" | "active";
export type OpenSource = "chat" | "agent";

export const DefaultOpenState: OpenState = "any";

const LevelRank: Record<OpenLevel, number> = {
    open: 0,
    visible: 1,
    active: 2,
    focused: 3,
};

/** 打开状态筛选的级别门槛（any 表示不筛选）。 */
const StateRank: Record<Exclude<OpenState, "any">, number> = {
    open: 0,
    visible: 1,
    active: 2,
};

export type OpenSessionEntry = {
    sessionId: string;
    /** 归一化后的连接（本地为 ""）。 */
    connection: string;
    source: OpenSource;
    cwd: string;
    /** 级别最高的那个块；其余出现在 duplicateBlockIds。 */
    blockId: string;
    tabId: string;
    level: OpenLevel;
    duplicateBlockIds: string[];
};

export type OpenSessionsSnapshot = {
    /** key = `${connection}\u0000${sessionId}`。 */
    byKey: Map<string, OpenSessionEntry>;
    /** 快捷索引：同 id 多个连接时保留级别最高者。 */
    bySessionId: Map<string, OpenSessionEntry>;
    byBlockId: Map<string, OpenSessionEntry>;
    at: number;
};

export type OpenSessionBlock = {
    blockId: string;
    tabId: string;
    sessionId: string;
    source: OpenSource;
    connection: string;
    cwd: string;
};

/** 状态层取数用：只要有 blockId / tabId / meta 就够。 */
export type OpenSessionBlockSource = {
    blockId: string;
    tabId: string;
    meta: Record<string, unknown> | null | undefined;
};

export type OpenSessionsContext = {
    /** 当前工作区的 activetabid。 */
    activeTabId: string;
    /** 当前真正渲染中的 block（布局叶子 active 子块，且非 hidden / minimized）。 */
    renderedBlockIds: ReadonlySet<string>;
    /** 焦点节点解析出的 block id。 */
    focusedBlockId: string | null;
};

export const EmptyOpenSessions: OpenSessionsSnapshot = {
    byKey: new Map(),
    bySessionId: new Map(),
    byBlockId: new Map(),
    at: 0,
};

export function openSessionKey(connection: string, sessionId: string): string {
    return `${connection}\u0000${sessionId}`;
}

function readString(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

/** 本地连接存在 "" / "local" / "local:*" 多种拼写，统一成 "". */
export function normalizeOpenConnection(raw: unknown): string {
    const value = readString(raw);
    if (value === "" || value === "local" || value.startsWith("local:")) {
        return "";
    }
    return value;
}

/**
 * 从 block 列表里挑出「绑定了会话」的块。
 * - aisessions 视图：meta["aisessions:sessionid"]（newchat 占位块无 sessionId，会被自然排除）
 * - 其它视图（term/agent）：resolveAgentSessionIdFromMeta
 */
export function collectOpenSessionBlocks(sources: readonly OpenSessionBlockSource[]): OpenSessionBlock[] {
    const out: OpenSessionBlock[] = [];
    for (const source of sources) {
        const meta = (source.meta ?? {}) as Record<string, unknown>;
        const view = readString(meta.view);
        const connection = normalizeOpenConnection(meta.connection);
        const cwd = readString(meta["cmd:cwd"]);
        if (view === "aisessions") {
            if (meta["aisessions:newchat"] === true) continue;
            const sessionId = readString(meta["aisessions:sessionid"]);
            if (sessionId === "") continue;
            out.push({ blockId: source.blockId, tabId: source.tabId, sessionId, source: "chat", connection, cwd });
            continue;
        }
        const sessionId = resolveAgentSessionIdFromMeta(meta).trim();
        if (sessionId === "") continue;
        out.push({ blockId: source.blockId, tabId: source.tabId, sessionId, source: "agent", connection, cwd });
    }
    return out;
}

/** 单个块的级别。 */
export function openLevelOf(block: OpenSessionBlock, ctx: OpenSessionsContext): OpenLevel {
    if (ctx.focusedBlockId != null && ctx.focusedBlockId === block.blockId) {
        return "focused";
    }
    if (!ctx.renderedBlockIds.has(block.blockId)) {
        return "open";
    }
    if (block.tabId === ctx.activeTabId) {
        return "active";
    }
    return "visible";
}

/**
 * 合并同一 session 的多个块：level 取最高，其余进 duplicateBlockIds。
 * 输出按 key（connection + sessionId）索引。
 */
export function projectOpenSessions(
    blocks: readonly OpenSessionBlock[],
    ctx: OpenSessionsContext,
    at: number = Date.now()
): OpenSessionsSnapshot {
    const byKey = new Map<string, OpenSessionEntry>();
    const byBlockId = new Map<string, OpenSessionEntry>();

    for (const block of blocks) {
        if (block.sessionId === "") continue;
        const level = openLevelOf(block, ctx);
        const key = openSessionKey(block.connection, block.sessionId);
        const existing = byKey.get(key);
        if (existing == null) {
            const entry: OpenSessionEntry = {
                sessionId: block.sessionId,
                connection: block.connection,
                source: block.source,
                cwd: block.cwd,
                blockId: block.blockId,
                tabId: block.tabId,
                level,
                duplicateBlockIds: [],
            };
            byKey.set(key, entry);
            byBlockId.set(block.blockId, entry);
            continue;
        }
        // 已存在：级别更高者成为主块，其余块进 duplicateBlockIds。
        if (LevelRank[level] > LevelRank[existing.level]) {
            existing.duplicateBlockIds.push(existing.blockId);
            existing.blockId = block.blockId;
            existing.tabId = block.tabId;
            existing.level = level;
            if (existing.cwd === "" && block.cwd !== "") existing.cwd = block.cwd;
            if (existing.source === "agent" && block.source === "chat") existing.source = block.source;
        } else {
            existing.duplicateBlockIds.push(block.blockId);
        }
        byBlockId.set(block.blockId, existing);
    }

    const bySessionId = new Map<string, OpenSessionEntry>();
    for (const entry of byKey.values()) {
        const current = bySessionId.get(entry.sessionId);
        if (current == null || LevelRank[entry.level] > LevelRank[current.level]) {
            bySessionId.set(entry.sessionId, entry);
        }
    }

    return { byKey, bySessionId, byBlockId, at };
}

/**
 * 遍历布局树，收集「当前真的渲染」的 block：
 * 只认叶子节点的 active 子块（InlineTab 组只有激活的那个渲染），并排除 hidden / minimized。
 * 子块（subblockids）与 ephemeral 节点不是布局叶子，天然不计入。
 */
export function collectRenderedBlockIds(
    rootNode: LayoutNode | null | undefined,
    hiddenBlockIds: ReadonlySet<string>,
    minimizedBlockIds: ReadonlySet<string>
): Set<string> {
    const out = new Set<string>();
    if (rootNode == null) return out;

    const walk = (node: LayoutNode | null | undefined): void => {
        if (node == null) return;
        if (node.children != null && node.children.length > 0) {
            for (const child of node.children) walk(child);
            return;
        }
        const activeBlockId = getLayoutDataActiveBlockId(node.data);
        if (activeBlockId == null || activeBlockId === "") return;
        if (hiddenBlockIds.has(activeBlockId) || minimizedBlockIds.has(activeBlockId)) return;
        out.add(activeBlockId);
    };

    walk(rootNode);
    return out;
}

/** 级别是否达到筛选要求（any 恒真，focused 计入 active）。 */
export function openLevelSatisfies(level: OpenLevel, required: OpenState): boolean {
    if (required === "any") return true;
    return LevelRank[level] >= StateRank[required];
}

/** 某个 sessionId 是否满足 Open 筛选（供列表过滤使用）。 */
export function openSessionMatches(snapshot: OpenSessionsSnapshot, sessionId: string, required: OpenState): boolean {
    if (required === "any") return true;
    const entry = snapshot.bySessionId.get(sessionId);
    if (entry == null) return false;
    return openLevelSatisfies(entry.level, required);
}

/** 快照等价判断：级别与重复块集合一致即视为同一份（用于避免无意义重渲）。 */
export function openSessionsEqual(a: OpenSessionsSnapshot | null, b: OpenSessionsSnapshot | null): boolean {
    if (a == null || b == null) return a === b;
    if (a.byKey.size !== b.byKey.size) return false;
    for (const [key, left] of a.byKey) {
        const right = b.byKey.get(key);
        if (right == null) return false;
        if (left.level !== right.level || left.blockId !== right.blockId || left.tabId !== right.tabId) return false;
        if (left.duplicateBlockIds.length !== right.duplicateBlockIds.length) return false;
    }
    return true;
}
