// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import type { ReactNode } from "react";
import { CopyIconButton } from "./controls";
import {
    collapsedMessagePreview,
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
    collapsed: boolean;
    onToggleCollapsed: () => void;
    registerRef: (node: HTMLDivElement | null) => void;
    searchQuery?: string;
    searchActive?: boolean;
}) {
    const isUser = message.role === "user";
    const collapsible = isCollapsibleMessage(message.text);
    const defaultShownText =
        collapsed && collapsible ? collapsedMessagePreview(message.text) : trimMessageText(message.text);
    const normalizedSearchQuery = searchQuery?.trim().toLowerCase() ?? "";
    const searchMatched = normalizedSearchQuery !== "" && message.text.toLowerCase().includes(normalizedSearchQuery);
    const defaultSearchShown =
        normalizedSearchQuery !== "" && defaultShownText.toLowerCase().includes(normalizedSearchQuery);
    const shownText = searchActive && searchMatched && !defaultSearchShown ? message.text : defaultShownText;
    const searchShown = normalizedSearchQuery !== "" && shownText.toLowerCase().includes(normalizedSearchQuery);
    return (
        <div
            ref={registerRef}
            id={`aisession-message-${message.seq}`}
            className={cn(
                "group max-w-[92%] scroll-mt-3 rounded border p-3",
                collapsible && "cursor-pointer",
                isUser ? "ml-auto border-accent/35 bg-accent/10" : "mr-auto border-border bg-bg",
                searchActive && "border-yellow-400/70 ring-2 ring-yellow-400/60"
            )}
            title={collapsible ? (collapsed ? "Double-click to expand" : "Double-click to collapse") : undefined}
            onDoubleClick={collapsible ? onToggleCollapsed : undefined}
        >
            <div className={cn("mb-2 flex items-center gap-2 text-xxs text-secondary", isUser && "justify-end")}>
                <span className={cn("font-medium uppercase", isUser && "text-accent")}>
                    {displayRole(message.role)}
                </span>
                <span>#{message.seq}</span>
                {message.timestamp ? <span>{formatDateTimeToSecond(message.timestamp)}</span> : null}
                {collapsible ? (
                    <span className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] text-secondary">
                        <i className={cn("fa-sharp fa-solid", collapsed ? "fa-chevron-down" : "fa-chevron-up")} />
                        {collapsed ? "Collapsed" : "Double-click"}
                    </span>
                ) : null}
                {searchMatched ? (
                    <span className="flex items-center gap-1 rounded border border-yellow-400/40 bg-yellow-400/10 px-1.5 py-0.5 text-[10px] text-yellow-300">
                        <i className="fa-sharp fa-solid fa-magnifying-glass" />
                        {searchActive
                            ? "Current match"
                            : collapsed && !searchShown
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
            </div>
            <div className={cn("whitespace-pre-wrap break-words text-xs leading-5", isUser && "text-primary")}>
                <HighlightedMessageText text={shownText} searchQuery={searchQuery} active={searchActive} />
            </div>
        </div>
    );
}
