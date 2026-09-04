// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { cn } from "@/util/util";
import type { ListGroupMode } from "./controls";
import { SessionRow } from "./session-row";
import { NewSessionKey } from "./types";
import type { SessionRunningState } from "./use-sessions-running";
import type { ProjectSessionGroup } from "./utils";

/** A session folder bucket is keyed by its basename, or this constant for 未归类. */
export const UnclassifiedKey = "";
/** Storage key for the folded-shut set of project buckets. */
export const groupCollapsedStorageKey = "aisessions.groupCollapsed";

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
                    "group/head sticky top-0 z-10 flex w-full cursor-pointer items-center gap-2 rounded-md border-t border-border px-2 py-1.5 text-left text-xs transition-colors hover:bg-hoverbg",
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
                <span className="shrink-0 rounded-full bg-surface px-1.5 py-px text-[10px] text-secondary tabular-nums">
                    {group.sessions.length}
                </span>
                <i className={cn("fa-sharp fa-solid text-[10px] text-secondary", collapsed ? "fa-chevron-right" : "fa-chevron-down")} />
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
    onSelectSession: (session: SessionSummary) => void;
    onMark: (session: SessionSummary, event: ReactMouseEvent<HTMLButtonElement>) => void;
    onNoteSave: (session: SessionSummary, note: string, tags: string[]) => Promise<boolean>;
    onResume: (session: SessionSummary, event: ReactMouseEvent<HTMLButtonElement>) => void;
    resumeDisabled: boolean;
    runningStateOf: (session: SessionSummary) => SessionRunningState | null;
    chatRunningOf: (session: SessionSummary) => boolean;
    onJumpToBlock: (runningState: SessionRunningState) => void;
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
    onMark,
    onNoteSave,
    onResume,
    resumeDisabled,
    runningStateOf,
    chatRunningOf,
    onJumpToBlock,
}: GroupedSessionListProps) {
    const newSession = sessions.find((session) => session.key === NewSessionKey);
    const row = (session: SessionSummary) => (
        <SessionRow
            key={session.key}
            session={session}
            selected={session.key === selectedKey}
            onSelect={() => onSelectSession(session)}
            onMark={(event) => onMark(session, event)}
            onNoteSave={(note, tags) => onNoteSave(session, note, tags)}
            onResume={(event) => onResume(session, event)}
            resumeDisabled={resumeDisabled}
            runningState={runningStateOf(session)}
            chatRunning={chatRunningOf(session)}
            onJumpToBlock={onJumpToBlock}
        />
    );
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
            {groupMode === "project" ? (
                grouped.map((group) => (
                    <SessionGroup
                        key={group.path || "unclassified"}
                        group={group}
                        collapsed={groupCollapsed.includes(group.path || "unclassified")}
                        onToggleCollapsed={() => onToggleGroup(group.path || "unclassified")}
                    >
                        {group.sessions.map(row)}
                    </SessionGroup>
                ))
            ) : (
                sessions.filter((session) => session.key !== NewSessionKey).map(row)
            )}
        </>
    );
}
