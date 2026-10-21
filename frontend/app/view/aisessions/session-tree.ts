// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 子会话父子树纯逻辑：把平铺的 SessionSummary 列表组织成「父 → 子」两级树。
//
// 设计约定（见 design.md §2.4 / §3.4）：
//  - 后端只如实给出 parentKey/kind；「父不在结果集 → 提升为顶层」必须放在前端，
//    因为筛选/搜索后的结果集是子集，后端无法预知哪些父会被滤掉。
//  - 顶层行只排 kind=session（或 parentKey 为空）的行；子行跟随父行。
//  - 只做两级：磁盘上 UUID/run-N/ 已是最深层，子会话不再派生子会话。
//  - 自引用 / 环（脏数据）必须防御：parentKey 指向自己的行按顶层处理，
//    否则渲染会无限递归。

export type SessionTreeNode = {
    session: SessionSummary;
    /** 0 = 顶层，1 = 子会话。 */
    depth: number;
    /** 直接子会话数量（depth 0 且有子时为 > 0）。 */
    childCount: number;
    /** 子会话里命中本次筛选的数量（父行展示「匹配子会话」标记用）。 */
    matchedChildCount: number;
    /** 已按 updatedAt 降序排好的直接子会话。 */
    children: SessionTreeNode[];
    /** 该行本身是否命中筛选（父行未命中但子行命中时，父行仍要展示）。 */
    matched: boolean;
};

/** 默认最多渲染多少个子会话行；超出部分由「显示全部」按钮展开。 */
export const DefaultVisibleChildCount = 20;

function sessionTime(session: SessionSummary): number {
    return session.updatedAt || session.createdAt || 0;
}

function byNewestFirst(left: SessionSummary, right: SessionSummary): number {
    const delta = sessionTime(right) - sessionTime(left);
    if (delta !== 0) {
        return delta;
    }
    return left.key.localeCompare(right.key);
}

/**
 * 组织父子树。
 *
 * @param rows          列表/筛选结果（平铺）
 * @param matchedKeys   命中本次筛选的行 key 集合。缺省视为全部命中（无筛选场景），
 *                      此时父行的 matched 恒为 true。
 *
 * 规则：
 *  - parentKey 为空 / 指向不存在的行 / 指向自己 → 顶层
 *  - 其余挂到父节点下；父不在结果集里的子行提升为顶层（不丢结果）
 *  - 顶层按时间倒序；子行按时间倒序跟在父行后
 */
export function buildSessionTree(rows: SessionSummary[], matchedKeys?: Set<string>): SessionTreeNode[] {
    const allMatched = matchedKeys == null;
    const byKey = new Map<string, SessionSummary>();
    for (const row of rows) {
        byKey.set(row.key, row);
    }

    const childMap = new Map<string, SessionSummary[]>();
    const roots: SessionSummary[] = [];
    for (const row of rows) {
        const parentKey = (row.parentKey ?? "").trim();
        // Self-reference or a dangling parent (filtered out, or an orphaned
        // directory whose parent file is gone) both land here as a root row.
        if (parentKey === "" || parentKey === row.key || !byKey.has(parentKey)) {
            roots.push(row);
            continue;
        }
        const siblings = childMap.get(parentKey);
        if (siblings == null) {
            childMap.set(parentKey, [row]);
        } else {
            siblings.push(row);
        }
    }

    const makeNode = (session: SessionSummary, depth: number): SessionTreeNode => {
        const children = (childMap.get(session.key) ?? []).sort(byNewestFirst);
        return {
            session,
            depth,
            childCount: children.length,
            matchedChildCount: children.filter((child) => allMatched || matchedKeys!.has(child.key)).length,
            children: children.map((child) => makeNode(child, depth + 1)),
            matched: allMatched || matchedKeys!.has(session.key),
        };
    };

    return roots.sort(byNewestFirst).map((session) => makeNode(session, 0));
}

/** 展开某父节点时实际要渲染的子行（默认只给前 DefaultVisibleChildCount 个）。 */
export function visibleChildren(node: SessionTreeNode, expanded: boolean, showAll = false): SessionTreeNode[] {
    if (!expanded || node.children.length === 0) {
        return [];
    }
    if (showAll || node.children.length <= DefaultVisibleChildCount) {
        return node.children;
    }
    return node.children.slice(0, DefaultVisibleChildCount);
}

/** 一个父节点是否超过默认展开数量（决定要不要渲染「显示全部」按钮）。 */
export function hasHiddenChildren(node: SessionTreeNode, expanded: boolean, showAll = false): boolean {
    return expanded && !showAll && node.children.length > DefaultVisibleChildCount;
}

/** 折叠后还剩多少行没展示。 */
export function hiddenChildCount(node: SessionTreeNode, expanded: boolean, showAll = false): number {
    if (!hasHiddenChildren(node, expanded, showAll)) {
        return 0;
    }
    return node.children.length - DefaultVisibleChildCount;
}

/** 收集所有「有子会话的父节点」key，用于搜索命中子会话时自动展开。 */
export function collectParentKeysToExpand(nodes: SessionTreeNode[], into: Set<string> = new Set()): Set<string> {
    for (const node of nodes) {
        if (node.children.length > 0) {
            into.add(node.session.key);
        }
        collectParentKeysToExpand(node.children, into);
    }
    return into;
}

/**
 * 找出「某次筛选/搜索需要自动展开的父节点」：它的某个直接子会话命中了筛选。
 * 父行自己命中不在此列（那种情况用户能直接看到父行）。
 */
export function collectParentsOfMatches(
    nodes: SessionTreeNode[],
    matchedKeys: Set<string>,
    into: Set<string> = new Set()
): Set<string> {
    for (const node of nodes) {
        if (node.children.some((child) => matchedKeys.has(child.session.key))) {
            into.add(node.session.key);
        }
        collectParentsOfMatches(node.children, matchedKeys, into);
    }
    return into;
}

/** 统计一棵树里的总行数（顶层 + 全部子行），用于测试与调试。 */
export function countTreeRows(nodes: SessionTreeNode[]): number {
    let total = 0;
    for (const node of nodes) {
        total += 1;
        total += countTreeRows(node.children);
    }
    return total;
}

/** 统计顶层行数（折叠后列表的视觉行数）。 */
export function countRootRows(nodes: SessionTreeNode[]): number {
    return nodes.length;
}

/** 统计子会话总数（相对平铺列表省下来的行数）。 */
export function countChildRows(nodes: SessionTreeNode[]): number {
    return countTreeRows(nodes) - countRootRows(nodes);
}
