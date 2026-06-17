// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn, makeIconClass } from "@/util/util";
import { useEffect, useState, type PointerEvent as ReactPointerEvent } from "react";

const OutlineDefaultWidth = 236;
const OutlineOverlayDefaultHeight = 360;
const OutlineMinWidth = 180;
const OutlineMaxWidth = 520;
const OutlineMinHeight = 140;
const OutlineMaxHeight = 640;

type MarkdownOutlineResizeAxes = {
    width?: boolean;
    height?: boolean;
};

type MarkdownOutlineSize = {
    width: number;
    height: number;
};

export type MarkdownOutlineItem = {
    id: string;
    label: string;
    level: number;
    lineNumber?: number;
    title?: string;
};

export function getMarkdownOutlineLabel(item: Pick<MarkdownOutlineItem, "label">): string {
    return item.label || "(untitled heading)";
}

function getOutlineItemTitle(item: MarkdownOutlineItem): string {
    const label = getMarkdownOutlineLabel(item);
    return item.title ?? (item.lineNumber == null ? label : `${label}: line ${item.lineNumber}`);
}

function clampOutlineValue(value: unknown, min: number, max: number, fallback: number): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return fallback;
    }
    return Math.min(max, Math.max(min, value));
}

function readStoredOutlineSize(storageKey: string, fallback: MarkdownOutlineSize): MarkdownOutlineSize {
    if (typeof window === "undefined") {
        return fallback;
    }
    try {
        const raw = window.localStorage.getItem(storageKey);
        if (raw == null) {
            return fallback;
        }
        const parsed = JSON.parse(raw) as Partial<MarkdownOutlineSize>;
        return {
            width: clampOutlineValue(parsed.width, OutlineMinWidth, OutlineMaxWidth, fallback.width),
            height: clampOutlineValue(parsed.height, OutlineMinHeight, OutlineMaxHeight, fallback.height),
        };
    } catch {
        return fallback;
    }
}

function writeStoredOutlineSize(storageKey: string, size: MarkdownOutlineSize): void {
    if (typeof window === "undefined") {
        return;
    }
    try {
        window.localStorage.setItem(storageKey, JSON.stringify(size));
    } catch {
        // localStorage can be unavailable in restricted browser contexts.
    }
}

export function MarkdownOutline({
    items,
    collapsed = false,
    pinned = true,
    hovered = false,
    placement = "overlay",
    resizeAxes,
    resizeStorageKey,
    emptyMessage = "No headings found",
    className,
    collapsedClassName,
    onHoverChange,
    onToggleCollapsed,
    onTogglePinned,
    onSelectItem,
}: {
    items: MarkdownOutlineItem[];
    collapsed?: boolean;
    pinned?: boolean;
    hovered?: boolean;
    placement?: "overlay" | "sidebar";
    resizeAxes?: MarkdownOutlineResizeAxes;
    resizeStorageKey?: string;
    emptyMessage?: string;
    className?: string;
    collapsedClassName?: string;
    onHoverChange?: (hovered: boolean) => void;
    onToggleCollapsed?: () => void;
    onTogglePinned?: () => void;
    onSelectItem: (item: MarkdownOutlineItem) => void;
}) {
    const visible = placement === "sidebar" ? true : pinned || hovered;
    const outlineOpacityClassName = visible ? "opacity-100" : "opacity-30";
    const collapsedOpacityClassName = visible ? "opacity-100" : "opacity-60";
    const widthResizable = resizeAxes?.width === true;
    const heightResizable = placement === "overlay" && resizeAxes?.height === true;
    const canResize = widthResizable || heightResizable;
    const storageKey = resizeStorageKey ?? `snorkeling.markdownOutline.${placement}.size`;
    const defaultSize: MarkdownOutlineSize = {
        width: OutlineDefaultWidth,
        height: OutlineOverlayDefaultHeight,
    };
    const [outlineSize, setOutlineSize] = useState<MarkdownOutlineSize>(() =>
        readStoredOutlineSize(storageKey, defaultSize)
    );

    useEffect(() => {
        if (!canResize) {
            return;
        }
        writeStoredOutlineSize(storageKey, outlineSize);
    }, [canResize, outlineSize, storageKey]);

    const handleResizeStart = (event: ReactPointerEvent<HTMLDivElement>, axes: Required<MarkdownOutlineResizeAxes>) => {
        event.preventDefault();
        event.stopPropagation();
        const startX = event.clientX;
        const startY = event.clientY;
        const startSize = outlineSize;
        const previousCursor = document.body.style.cursor;
        const previousUserSelect = document.body.style.userSelect;
        document.body.style.cursor = axes.width && axes.height ? "nwse-resize" : axes.width ? "ew-resize" : "ns-resize";
        document.body.style.userSelect = "none";

        const handlePointerMove = (moveEvent: PointerEvent) => {
            const nextWidth = axes.width
                ? clampOutlineValue(
                      startSize.width + startX - moveEvent.clientX,
                      OutlineMinWidth,
                      OutlineMaxWidth,
                      startSize.width
                  )
                : startSize.width;
            const nextHeight = axes.height
                ? clampOutlineValue(
                      startSize.height + moveEvent.clientY - startY,
                      OutlineMinHeight,
                      OutlineMaxHeight,
                      startSize.height
                  )
                : startSize.height;
            setOutlineSize({ width: nextWidth, height: nextHeight });
        };
        const handlePointerUp = () => {
            document.body.style.cursor = previousCursor;
            document.body.style.userSelect = previousUserSelect;
            window.removeEventListener("pointermove", handlePointerMove);
            window.removeEventListener("pointerup", handlePointerUp);
            window.removeEventListener("pointercancel", handlePointerUp);
        };

        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerup", handlePointerUp);
        window.addEventListener("pointercancel", handlePointerUp);
    };

    if (placement === "overlay" && collapsed && onToggleCollapsed != null) {
        return (
            <div
                className={cn(
                    "absolute right-2 top-2 z-20 flex h-8 w-8 items-center justify-center rounded-md border border-border bg-panel/95 shadow-lg transition-opacity duration-150",
                    collapsedOpacityClassName,
                    collapsedClassName
                )}
                onMouseEnter={() => onHoverChange?.(true)}
                onMouseLeave={() => onHoverChange?.(false)}
            >
                <button
                    type="button"
                    className="flex h-7 w-7 items-center justify-center rounded text-secondary hover:bg-hoverbg hover:text-foreground"
                    title="Show Markdown outline"
                    aria-label="Show Markdown outline"
                    onClick={onToggleCollapsed}
                >
                    <i className={makeIconClass("list-tree", false)} />
                </button>
            </div>
        );
    }

    return (
        <aside
            className={cn(
                placement === "overlay"
                    ? "absolute right-2 top-2 z-20 flex max-h-[calc(100%-16px)] max-w-[calc(100%-16px)] flex-col rounded-md border border-border bg-panel/95 text-xs shadow-xl backdrop-blur-sm transition-opacity duration-150"
                    : "relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-md border border-border bg-panel/95 text-xs shadow-xl backdrop-blur-sm",
                outlineOpacityClassName,
                className
            )}
            style={{
                width: outlineSize.width,
                ...(heightResizable ? { height: outlineSize.height } : null),
            }}
            onMouseEnter={placement === "overlay" ? () => onHoverChange?.(true) : undefined}
            onMouseLeave={placement === "overlay" ? () => onHoverChange?.(false) : undefined}
        >
            <div className="flex h-8 shrink-0 items-center gap-1.5 border-b border-border px-2">
                <i className={cn(makeIconClass("list-tree", false), "text-secondary")} />
                <div className="min-w-0 flex-1 truncate font-medium text-foreground">Outline</div>
                {placement === "overlay" && onTogglePinned != null ? (
                    <button
                        type="button"
                        className={cn(
                            "flex h-5 w-5 items-center justify-center rounded text-secondary hover:bg-hoverbg hover:text-foreground",
                            pinned && "text-accent"
                        )}
                        title={pinned ? "Unpin Markdown outline" : "Pin Markdown outline"}
                        aria-label={pinned ? "Unpin Markdown outline" : "Pin Markdown outline"}
                        aria-pressed={pinned}
                        onClick={onTogglePinned}
                    >
                        <i className="fa-sharp fa-solid fa-thumbtack" />
                    </button>
                ) : null}
                {placement === "overlay" && onToggleCollapsed != null ? (
                    <button
                        type="button"
                        className="flex h-5 w-5 items-center justify-center rounded text-secondary hover:bg-hoverbg hover:text-foreground"
                        title="Hide Markdown outline"
                        aria-label="Hide Markdown outline"
                        onClick={onToggleCollapsed}
                    >
                        <i className={makeIconClass("chevron-right", false)} />
                    </button>
                ) : null}
            </div>
            <div className="min-h-0 overflow-auto py-1">
                {items.length === 0 ? (
                    <div className="px-3 py-2 text-secondary">{emptyMessage}</div>
                ) : (
                    items.map((item, index) => (
                        <button
                            key={`${item.id}-${index}`}
                            type="button"
                            className="flex w-full min-w-0 items-center gap-1.5 px-2 py-1 text-left text-secondary hover:bg-hoverbg hover:text-foreground"
                            style={{ paddingLeft: `${8 + Math.min(item.level - 1, 5) * 10}px` }}
                            title={getOutlineItemTitle(item)}
                            onClick={() => onSelectItem(item)}
                        >
                            <span className="w-4 shrink-0 text-[9px] tabular-nums text-muted">{item.level}</span>
                            <span className="min-w-0 flex-1 truncate">{getMarkdownOutlineLabel(item)}</span>
                        </button>
                    ))
                )}
            </div>
            {widthResizable ? (
                <div
                    className="absolute bottom-0 left-0 top-0 z-10 w-2 cursor-ew-resize bg-transparent hover:bg-accent/35"
                    title="Resize outline width"
                    role="separator"
                    aria-orientation="vertical"
                    onPointerDown={(event) => handleResizeStart(event, { width: true, height: false })}
                />
            ) : null}
            {heightResizable ? (
                <div
                    className="absolute bottom-0 left-0 right-0 z-10 h-2 cursor-ns-resize bg-transparent hover:bg-accent/35"
                    title="Resize outline height"
                    role="separator"
                    aria-orientation="horizontal"
                    onPointerDown={(event) => handleResizeStart(event, { width: false, height: true })}
                />
            ) : null}
            {widthResizable && heightResizable ? (
                <div
                    className="absolute bottom-0 left-0 z-20 h-4 w-4 cursor-nesw-resize bg-transparent hover:bg-accent/45"
                    title="Resize outline"
                    role="separator"
                    aria-orientation="horizontal"
                    onPointerDown={(event) => handleResizeStart(event, { width: true, height: true })}
                />
            ) : null}
        </aside>
    );
}
