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
    /** 已按列表当前排序方向排好的直接子会话。 */
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

/** 按列表当前排序方向比较两个会话（时间相同按 key 稳定）。 */
function makeSessionOrder(descending: boolean) {
    if (descending) return byNewestFirst;
    return (left: SessionSummary, right: SessionSummary): number => -byNewestFirst(left, right);
}

/**
 * 组织父子树。
 *
 * @param rows          列表/筛选结果（平铺）
 * @param matchedKeys   命中本次筛选的行 key 集合。缺省表示「没有生效的筛选」，
 *                      此时 matchedChildCount 恒为 0，父行只显示普通 `+N` 徽标。
 * @param descending    列表当前排序方向（仅在未传 compare 时生效）。
 * @param compare       可选自定义比较器（排序链）。传入时忽略 descending，
 *                      顶层行与子行都用它排序；不传保持原有的时间排序。
 *
 * 规则：
 *  - parentKey 为空 / 指向不存在的行 / 指向自己 → 顶层
 *  - 其余挂到父节点下；父不在结果集里的子行提升为顶层（不丢结果）
 *  - 顶层按 order 排序；子行按 order 排序跟在父行后
 */
export function buildSessionTree(
    rows: SessionSummary[],
    matchedKeys?: Set<string>,
    descending = true,
    compare?: (left: SessionSummary, right: SessionSummary) => number
): SessionTreeNode[] {
    const allMatched = matchedKeys == null;
    const order = compare ?? makeSessionOrder(descending);
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

    // 脏数据的另一种形态：两个会话互为父（A→B→A）。它们既不是根，也不在任何根的
    // 子树里，直接构树会让两行一起从列表里消失。把没有从根可达的行提升为顶层。
    const reachable = new Set<string>();
    const markReachable = (key: string) => {
        if (reachable.has(key)) return;
        reachable.add(key);
        for (const child of childMap.get(key) ?? []) {
            markReachable(child.key);
        }
    };
    roots.forEach((root) => markReachable(root.key));
    for (const row of rows) {
        if (reachable.has(row.key)) continue;
        roots.push(row);
        markReachable(row.key);
    }

    const makeNode = (session: SessionSummary, depth: number, ancestors: Set<string>): SessionTreeNode => {
        const path = new Set(ancestors);
        path.add(session.key);
        // 防御环路：已经出现在这条链上的会话不再当作子行，否则递归会无限展开。
        const children = (childMap.get(session.key) ?? []).filter((child) => !path.has(child.key)).sort(order);
        return {
            session,
            depth,
            childCount: children.length,
            // 没有生效的筛选时不存在「命中」的概念，给 0 让父行回到普通的 `+N` 徽标。
            matchedChildCount: allMatched ? 0 : children.filter((child) => matchedKeys!.has(child.key)).length,
            children: children.map((child) => makeNode(child, depth + 1, path)),
            matched: allMatched || matchedKeys!.has(session.key),
        };
    };

    return [...roots].sort(order).map((session) => makeNode(session, 0, new Set()));
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

/**
 * 从平铺的会话列表推导「父行 key 集合」：只要某个会话的 parentKey 指向列表里的
 * 另一行，那个 parentKey 就是父行。判定与 buildSessionTree 的根部规则一致
 * （空白 / 自引用 / 父不在结果集 → 不算父），所以两种分组模式下得到的集合相同。
 *
 * 用平铺列表而不是树来算：Project 模式有 N 棵树，Time 模式只有一棵，全局展开需要
 * 两者的并集，让每棵树各算一遍再合并会重复判定孤儿与自引用。
 */
export function collectParentKeys(sessions: SessionSummary[]): Set<string> {
    const known = new Set(sessions.map((session) => session.key));
    const parents = new Set<string>();
    for (const session of sessions) {
        const parentKey = (session.parentKey ?? "").trim();
        if (parentKey === "" || parentKey === session.key || !known.has(parentKey)) {
            continue;
        }
        parents.add(parentKey);
    }
    return parents;
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
