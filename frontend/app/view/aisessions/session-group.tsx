// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import type { ListGroupMode } from "./controls";
import { SessionRow } from "./session-row";
import { buildSessionTree, hiddenChildCount, visibleChildren, type SessionTreeNode } from "./session-tree";
import { NewSessionKey } from "./types";
import type { SessionRunningState } from "./use-sessions-running";
import type { ProjectSessionGroup } from "./utils";

/** A session folder bucket is keyed by its basename, or this constant for 未归类. */
export const UnclassifiedKey = "";
/** Storage key for the folded-shut set of project buckets. */
export const groupCollapsedStorageKey = "aisessions.groupCollapsed";
/** Storage key for the expanded set of parent sessions (sub-session trees). */
export const expandedParentsStorageKey = "aisessions.expandedParents";

export function readCollapsedGroups(): string[] {
    if (typeof window === "undefined") return [];
    try {
        const raw = window.localStorage.getItem(groupCollapsedStorageKey);
        return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
        return [];
    }
}

export function writeCollapsedGroups(collapsed: string[]): void {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(groupCollapsedStorageKey, JSON.stringify(collapsed));
    } catch {
        // Ignore unavailable storage; the in-memory choice still works.
    }
}

export function readExpandedParents(): string[] {
    if (typeof window === "undefined") return [];
    try {
        const raw = window.localStorage.getItem(expandedParentsStorageKey);
        return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
        return [];
    }
}

export function writeExpandedParents(expanded: string[]): void {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(expandedParentsStorageKey, JSON.stringify(expanded));
    } catch {
        // Ignore unavailable storage; the in-memory choice still works.
    }
}

export function SessionGroup({
    group,
    collapsed,
    onToggleCollapsed,
    children,
}: {
    group: ProjectSessionGroup;
    collapsed: boolean;
    onToggleCollapsed: () => void;
    children: ReactNode;
}) {
    return (
        <div className="mb-2 flex flex-col">
            <button
                type="button"
                aria-expanded={!collapsed}
                title={`${group.name} · ${group.sessions.length} sessions`}
                onClick={onToggleCollapsed}
                className={cn(
                    "group/head sticky top-0 z-10 flex w-full cursor-pointer items-center gap-2 rounded-md border-b border-border bg-block-solid px-2 py-1.5 text-left text-xs transition-colors hover:bg-hoverbg",
                    group.unclassified && "text-secondary"
                )}
            >
                <i
                    className={cn(
                        "fa-sharp fa-solid text-[11px]",
                        group.unclassified
                            ? "fa-inbox text-secondary/70"
                            : collapsed
                              ? "fa-folder text-secondary"
                              : "fa-folder-open text-accent"
                    )}
                />
                <span className="min-w-0 flex-1 truncate font-medium text-primary">{group.name}</span>
                <span className="shrink-0 rounded-full bg-hoverbg px-1.5 py-px text-[10px] text-secondary tabular-nums">
                    {group.sessions.length}
                </span>
                <i
                    className={cn(
                        "fa-sharp fa-solid text-[10px] text-secondary",
                        collapsed ? "fa-chevron-right" : "fa-chevron-down"
                    )}
                />
            </button>
            {collapsed ? null : <div className="border-l border-border/60 pl-2">{children}</div>}
        </div>
    );
}

type GroupedSessionListProps = {
    groupMode: ListGroupMode;
    sessions: SessionSummary[];
    grouped: ProjectSessionGroup[];
    groupCollapsed: string[];
    onToggleGroup: (key: string) => void;
    selectedKey: string;
    onSelectNew: () => void;
    onSelectSession: (session: SessionSummary, event: ReactMouseEvent<HTMLDivElement>) => void;
    /** 双击行：在 Detail Block 中打开该会话。 */
    onOpenSession: (session: SessionSummary, event: ReactMouseEvent<HTMLDivElement>) => void;
    onMark: (session: SessionSummary, event: ReactMouseEvent<HTMLButtonElement>) => void;
    onNoteSave: (session: SessionSummary, note: string, tags: string[]) => Promise<boolean>;
    onResume: (session: SessionSummary, event: ReactMouseEvent<HTMLButtonElement>) => void;
    resumeDisabled: boolean;
    runningStateOf: (session: SessionSummary) => SessionRunningState | null;
    chatRunningOf: (session: SessionSummary) => boolean;
    onJumpToBlock: (runningState: SessionRunningState) => void;
    /** 已展开的父会话 key 集合（localStorage 持久化）。 */
    expandedParents: string[];
    onToggleExpandParent: (sessionKey: string, showAll?: boolean) => void;
    /** 已点过「显示全部」的父会话 key 集合（本次会话内 state，不落盘）。 */
    fullyExpandedParents: Set<string>;
    /** 列表当前的排序方向（新→旧 / 旧→新）；树必须跟随它，否则排序按钮失效。 */
    sortDescending: boolean;
    /** 工具栏「展开全部标签」的全局偏好（方案 B）。 */
    expandAllTags: boolean;
};

export function GroupedSessionList({
    groupMode,
    sessions,
    grouped,
    groupCollapsed,
    onToggleGroup,
    selectedKey,
    onSelectNew,
    onSelectSession,
    onOpenSession,
    onMark,
    onNoteSave,
    onResume,
    resumeDisabled,
    runningStateOf,
    chatRunningOf,
    onJumpToBlock,
    expandedParents,
    onToggleExpandParent,
    fullyExpandedParents,
    sortDescending,
    expandAllTags,
}: GroupedSessionListProps) {
    const newSession = sessions.find((session) => session.key === NewSessionKey);

    // 树在上层（aisessions.tsx）按筛选结果算好后随 grouped / sessions 一起传下来：
    // 这里只负责渲染，避免每个分组各算一遍。见 ProjectSessionGroup.tree。
    const flatTree =
        groupMode === "project"
            ? []
            : buildSessionTree(
                  sessions.filter((s) => s.key !== NewSessionKey),
                  undefined,
                  sortDescending
              );

    /** 渲染一个树节点及其（已展开的）子节点；子会话超过 20 个时追加「显示全部」。 */
    const renderNode = (node: SessionTreeNode): ReactNode => {
        const key = node.session.key;
        const isParent = node.childCount > 0;
        const expanded = expandedParents.includes(key);
        const showAll = fullyExpandedParents.has(key);
        const children = visibleChildren(node, expanded, showAll);
        const hidden = hiddenChildCount(node, expanded, showAll);
        const childKind =
            node.session.kind === "fork" ? "fork" : node.session.kind === "subagent" ? "subagent" : undefined;
        return (
            <div key={key} data-session-key={key} data-depth={node.depth}>
                <SessionRow
                    session={node.session}
                    selected={key === selectedKey}
                    onSelect={(event) => onSelectSession(node.session, event)}
                    onOpen={(event) => onOpenSession(node.session, event)}
                    onMark={(event) => onMark(node.session, event)}
                    onNoteSave={(note, tags) => onNoteSave(node.session, note, tags)}
                    onResume={(event) => onResume(node.session, event)}
                    resumeDisabled={resumeDisabled}
                    runningState={runningStateOf(node.session)}
                    chatRunning={chatRunningOf(node.session)}
                    onJumpToBlock={onJumpToBlock}
                    depth={node.depth}
                    childKind={childKind}
                    expandable={isParent}
                    expanded={expanded}
                    childCount={node.childCount}
                    matchedChildCount={node.matchedChildCount}
                    onToggleExpand={() => onToggleExpandParent(key)}
                    expandAllTags={expandAllTags}
                />
                {children.map((child) => renderNode(child))}
                {hidden > 0 ? (
                    <button
                        type="button"
                        className="w-full cursor-pointer border-b border-border bg-transparent py-1 pl-9 pr-3 text-left text-[11px] text-secondary transition-colors hover:bg-hoverbg hover:text-accent"
                        onClick={() => onToggleExpandParent(key, true)}
                    >
                        Show all {node.childCount} sub-sessions ({hidden} more)
                    </button>
                ) : null}
            </div>
        );
    };

    /** 一棵树 → 扁平 ReactNode 列表。 */
    const renderTree = (nodes: SessionTreeNode[]): ReactNode[] => nodes.map((node) => renderNode(node));
    return (
        <>
            {newSession ? (
                <button
                    type="button"
                    onClick={onSelectNew}
                    className={cn(
                        "flex w-full cursor-pointer items-center gap-2 border-b border-border px-3 py-1.5 text-left text-xs ring-inset hover:bg-hover",
                        selectedKey === NewSessionKey && "bg-accent/5 ring-1 ring-accent/40"
                    )}
                >
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                    <span className="min-w-0 truncate font-medium text-primary">New Chat</span>
                    <span className="ml-auto shrink-0 text-[10px] text-secondary">unsent</span>
                </button>
            ) : null}
            {groupMode === "project"
                ? grouped.map((group) => (
                      <SessionGroup
                          key={group.path || "unclassified"}
                          group={group}
                          collapsed={groupCollapsed.includes(group.path || "unclassified")}
                          onToggleCollapsed={() => onToggleGroup(group.path || "unclassified")}
                      >
                          {renderTree(group.tree)}
                      </SessionGroup>
                  ))
                : renderTree(flatTree)}
        </>
    );
}
