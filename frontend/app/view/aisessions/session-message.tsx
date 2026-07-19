// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import type { ReactNode } from "react";
import { CopyIconButton } from "./controls";
import {
    displayRole,
    formatDateTimeToSecond,
    isCollapsibleMessage,
    trimMessageText,
} from "./utils";

export function HighlightedMessageText({
    text,
    searchQuery,
    active = false,
}: {
    text: string;
    searchQuery?: string;
    active?: boolean;
}) {
    const query = searchQuery?.trim() ?? "";
    if (query === "") {
        return <>{text}</>;
    }
    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const parts: ReactNode[] = [];
    let cursor = 0;
    let matchIndex = lowerText.indexOf(lowerQuery);
    let key = 0;
    while (matchIndex >= 0) {
        if (matchIndex > cursor) {
            parts.push(text.slice(cursor, matchIndex));
        }
        const end = matchIndex + query.length;
        parts.push(
            <mark
                key={`match-${key++}`}
                className={cn("rounded px-0.5 text-inherit", active ? "bg-yellow-300/55" : "bg-yellow-300/30")}
            >
                {text.slice(matchIndex, end)}
            </mark>
        );
        cursor = end;
        matchIndex = lowerText.indexOf(lowerQuery, cursor);
    }
    if (cursor < text.length) {
        parts.push(text.slice(cursor));
    }
    return <>{parts}</>;
}

export function MessageCard({
    message,
    collapsed,
    onToggleCollapsed,
    registerRef,
    searchQuery,
    searchActive = false,
}: {
    message: Message;
    collapsed?: boolean;
    onToggleCollapsed: () => void;
    registerRef: (node: HTMLDivElement | null) => void;
    searchQuery?: string;
    searchActive?: boolean;
}) {
    const isUser = message.role === "user";
    const collapsible = isCollapsibleMessage(message.text);
    const effectiveCollapsed = collapsed ?? collapsible;
    const normalizedSearchQuery = searchQuery?.trim().toLowerCase() ?? "";
    const searchMatched = normalizedSearchQuery !== "" && message.text.toLowerCase().includes(normalizedSearchQuery);
    const collapsedShownText = trimMessageText(message.text);
    const collapsedSearchShown =
        normalizedSearchQuery !== "" && collapsedShownText.toLowerCase().includes(normalizedSearchQuery);
    // 展开后用全文，不再受 trimMessageText 的 2400 字截断；只在折叠时截断
    const useFullText = !effectiveCollapsed || (searchActive && searchMatched && !collapsedSearchShown);
    const shownText = useFullText ? message.text : collapsedShownText;
    const searchShown = normalizedSearchQuery !== "" && shownText.toLowerCase().includes(normalizedSearchQuery);
    const shouldClampText = effectiveCollapsed && !(searchActive && searchMatched && !collapsedSearchShown);
    return (
        <div
            ref={registerRef}
            id={`aisession-message-${message.seq}`}
            className={cn(
                "group scroll-mt-3 rounded border p-3",
                isUser ? "border-accent/35 bg-accent/10 shadow-sm" : "border-border bg-surface-strong",
                searchActive && "border-yellow-400/70 ring-2 ring-yellow-400/60"
            )}
        >
            <div
                className={cn(
                    "mb-2 flex items-center gap-2 rounded text-xxs text-secondary",
                    isUser && "justify-end",
                    collapsible && "cursor-pointer hover:text-primary"
                )}
                title={collapsible ? (effectiveCollapsed ? "Expand message" : "Collapse message") : undefined}
                onClick={collapsible ? onToggleCollapsed : undefined}
            >
                <span className="relative">
                    <span className="min-w-0 truncate" title={message.timestamp ? formatDateTimeToSecond(message.timestamp) : undefined}>
                        {message.seq}
                    </span>
                    {message.timestamp ? (
                        <span
                            className="pointer-events-none absolute left-full top-1/2 z-10 ml-1 -translate-y-1/2 whitespace-nowrap rounded bg-panel px-2 py-1 text-xxs leading-none text-secondary shadow-md opacity-0 transition-opacity group-hover:opacity-100"
                        >
                            {formatDateTimeToSecond(message.timestamp)}
                        </span>
                    ) : null}
                </span>
                {searchMatched ? (
                    <span className="flex items-center gap-1 rounded border border-yellow-400/40 bg-yellow-400/10 px-1.5 py-0.5 text-[10px] text-yellow-300">
                        <i className="fa-sharp fa-solid fa-magnifying-glass" />
                        {searchActive
                            ? "Current match"
                            : effectiveCollapsed && !searchShown
                              ? "Match in collapsed text"
                              : "Search match"}
                    </span>
                ) : null}
                <CopyIconButton
                    text={message.text}
                    label="Copy message"
                    className="ml-auto opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                    size="xs"
                />
                {collapsible ? (
                    <button
                        type="button"
                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-secondary opacity-0 transition-opacity hover:bg-hover hover:text-primary group-hover:opacity-100 group-focus-within:opacity-100"
                        title={effectiveCollapsed ? "Expand message" : "Collapse message"}
                        aria-label={effectiveCollapsed ? "Expand message" : "Collapse message"}
                        onClick={(e) => {
                            e.stopPropagation();
                            onToggleCollapsed();
                        }}
                    >
                        <i
                            className={cn(
                                "fa-sharp fa-solid text-[10px]",
                                effectiveCollapsed ? "fa-chevron-down" : "fa-chevron-up"
                            )}
                        />
                    </button>
                ) : null}
            </div>
            <div
                className={cn(
                    "whitespace-pre-wrap break-words text-xs leading-5",
                    isUser && "text-primary",
                    shouldClampText && "line-clamp-4"
                )}
            >
                <HighlightedMessageText text={shownText} searchQuery={searchQuery} active={searchActive} />
            </div>
        </div>
    );
}
