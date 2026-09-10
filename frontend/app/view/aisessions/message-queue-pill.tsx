// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// MessageQueuePill — interactive queue display for the AI Sessions composer.
//
// Collapsed: a compact pill showing "N queued · M high". Click to expand into
// a scrollable list where each item can be cancelled (✕), toggled to/from the
// high lane (⚡), and reordered by dragging. Rendered only when there is at
// least one pending message — mirrors the v2 design language (floating rounded
// surface, low-contrast borders, theme tokens).

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/util/util";
import type { QueuedMessage } from "./message-queue-store";

type MessageQueuePillProps = {
    items: QueuedMessage[];
    queuedCount: number;
    highCount: number;
    active: QueuedMessage | null;
    onCancel: (id: string) => void;
    onPromote: (id: string) => void;
    onReorder: (id: string, targetIdx: number) => void;
};

function messagePreview(item: QueuedMessage): string {
    const text = item.body.message?.trim();
    if (text) return text;
    if (item.body.command?.name) return `/${item.body.command.name}`;
    return "New message";
}

export function MessageQueuePill({
    items,
    queuedCount,
    highCount,
    active,
    onCancel,
    onPromote,
    onReorder,
}: MessageQueuePillProps) {
    const [open, setOpen] = useState(false);
    const listRef = useRef<HTMLDivElement | null>(null);
    const dragIdRef = useRef<string | null>(null);
    const dragOverIdxRef = useRef<number>(-1);

    // If everything drains while open, collapse back.
    useEffect(() => {
        if (open && queuedCount === 0 && active == null) {
            setOpen(false);
        }
    }, [open, queuedCount, active]);

    const handleDragStart = useCallback((e: React.DragEvent, id: string) => {
        dragIdRef.current = id;
        e.dataTransfer.effectAllowed = "move";
        try {
            e.dataTransfer.setData("text/plain", id);
        } catch {
            // some browsers require setData in dragstart; safe to ignore
        }
        requestAnimationFrame(() => {
            // Keep the source visible while dragging (no custom ghost).
        });
    }, []);

    const handleDragOver = useCallback(
        (e: React.DragEvent, idx: number) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            dragOverIdxRef.current = idx;
        },
        []
    );

    const handleDrop = useCallback(
        (e: React.DragEvent, targetIdx: number) => {
            e.preventDefault();
            const fromId = dragIdRef.current;
            dragIdRef.current = null;
            if (fromId == null) return;
            onReorder(fromId, targetIdx);
        },
        [onReorder]
    );

    const handleDragEnd = useCallback(() => {
        dragIdRef.current = null;
    }, []);

    if (queuedCount === 0 && active == null) return null;

    return (
        <div className="relative">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className={cn(
                    "flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-[11px] text-secondary transition-colors hover:bg-hover",
                    open && "bg-hover"
                )}
                aria-expanded={open}
            >
                <i
                    className={cn(
                        "fa-sharp fa-solid fa-list-ul text-[10px] text-accent",
                        active != null && "animate-pulse"
                    )}
                />
                <span className="flex-1">
                    <span className="font-medium text-primary">{queuedCount}</span> queued
                    {active != null ? <span className="ml-1 text-accent">· sending</span> : null}
                    {highCount > 0 ? <span className="ml-1 text-warning">· {highCount} high</span> : null}
                </span>
                <i
                    className={cn(
                        "fa-sharp fa-solid fa-chevron-down text-[9px] text-muted transition-transform",
                        open && "rotate-180"
                    )}
                />
            </button>
            {open ? (
                <div
                    ref={listRef}
                    className="absolute bottom-full left-0 z-40 mb-1 max-h-56 w-full overflow-y-auto rounded-xl border border-border bg-modalbg py-1 shadow-2xl"
                >
                    {active != null ? (
                        <QueueRow
                            item={active}
                            sending
                            onPromote={onPromote}
                            onCancel={onCancel}
                        />
                    ) : null}
                    {items.map((item, idx) => (
                        <QueueRow
                            key={item.id}
                            item={item}
                            onDragStart={handleDragStart}
                            onDragOver={(e) => handleDragOver(e, idx)}
                            onDrop={(e) => handleDrop(e, idx)}
                            onDragEnd={handleDragEnd}
                            onPromote={onPromote}
                            onCancel={onCancel}
                        />
                    ))}
                    {items.length === 0 && active == null ? (
                        <div className="px-3 py-2 text-center text-[11px] text-muted">Queue empty</div>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}

type QueueRowProps = {
    item: QueuedMessage;
    sending?: boolean;
    onDragStart?: (e: React.DragEvent, id: string) => void;
    onDragOver?: (e: React.DragEvent) => void;
    onDrop?: (e: React.DragEvent) => void;
    onDragEnd?: () => void;
    onPromote: (id: string) => void;
    onCancel: (id: string) => void;
};

function QueueRow({
    item,
    sending,
    onDragStart,
    onDragOver,
    onDrop,
    onDragEnd,
    onPromote,
    onCancel,
}: QueueRowProps) {
    const cancelled = item.status === "cancelled";
    return (
        <div
            draggable={!sending && !cancelled}
            onDragStart={onDragStart ? (e) => onDragStart(e, item.id) : undefined}
            onDragOver={onDragOver}
            onDrop={onDrop}
            onDragEnd={onDragEnd}
            className={cn(
                "group flex items-center gap-2 px-3 py-1.5 text-xs",
                sending ? "bg-accent/5" : "hover:bg-hover",
                cancelled && "opacity-40"
            )}
        >
            {!sending ? (
                <i className="fa-sharp fa-solid fa-grip-vertical cursor-grab text-[9px] text-muted group-hover:text-secondary" />
            ) : (
                <i className="fa-sharp fa-solid fa-spinner fa-spin text-[9px] text-accent" />
            )}
            <span
                className={cn(
                    "inline-flex h-4 items-center rounded px-1 text-[9px] font-semibold",
                    item.priority === "high"
                        ? "bg-warning/15 text-warning"
                        : "bg-info/15 text-info"
                )}
            >
                {item.priority === "high" ? "⚡" : "N"}
            </span>
            <span
                className={cn(
                    "min-w-0 flex-1 truncate",
                    cancelled ? "line-through text-muted" : "text-primary"
                )}
                title={messagePreview(item)}
            >
                {messagePreview(item)}
            </span>
            {!sending ? (
                <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                        type="button"
                        className="flex h-5 w-5 items-center justify-center rounded text-muted hover:bg-hover hover:text-warning"
                        title={item.priority === "high" ? "Move to normal" : "Send next (high priority)"}
                        onClick={(e) => {
                            e.stopPropagation();
                            onPromote(item.id);
                        }}
                    >
                        <i className="fa-sharp fa-solid fa-bolt text-[9px]" />
                    </button>
                    <button
                        type="button"
                        className="flex h-5 w-5 items-center justify-center rounded text-muted hover:bg-hover hover:text-error"
                        title="Cancel message"
                        onClick={(e) => {
                            e.stopPropagation();
                            onCancel(item.id);
                        }}
                    >
                        <i className="fa-sharp fa-solid fa-xmark text-[10px]" />
                    </button>
                </span>
            ) : null}
        </div>
    );
}
