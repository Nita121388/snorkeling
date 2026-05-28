// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import { CopyIconButton } from "./controls";
import {
    collapsedMessagePreview,
    displayRole,
    formatDateTimeToSecond,
    isCollapsibleMessage,
    trimMessageText,
} from "./utils";

export function MessageCard({
    message,
    collapsed,
    onToggleCollapsed,
    registerRef,
}: {
    message: Message;
    collapsed: boolean;
    onToggleCollapsed: () => void;
    registerRef: (node: HTMLDivElement | null) => void;
}) {
    const isUser = message.role === "user";
    const collapsible = isCollapsibleMessage(message.text);
    const shownText = collapsed && collapsible ? collapsedMessagePreview(message.text) : trimMessageText(message.text);
    return (
        <div
            ref={registerRef}
            id={`aisession-message-${message.seq}`}
            className={cn(
                "group max-w-[92%] scroll-mt-3 rounded border p-3",
                collapsible && "cursor-pointer",
                isUser ? "ml-auto border-accent/35 bg-accent/10" : "mr-auto border-border bg-bg"
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
                <CopyIconButton
                    text={message.text}
                    label="Copy message"
                    className="ml-auto opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                    size="xs"
                />
            </div>
            <div className={cn("whitespace-pre-wrap break-words text-xs leading-5", isUser && "text-primary")}>
                {shownText}
            </div>
        </div>
    );
}
