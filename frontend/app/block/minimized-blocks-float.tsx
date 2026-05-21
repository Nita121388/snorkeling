// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getLayoutModelForTabById } from "@/layout/index";
import { ObjectService } from "@/store/services";
import { makeIconClass } from "@/util/util";
import clsx from "clsx";
import { type Atom, useAtomValue } from "jotai";
import {
    type CSSProperties,
    type MouseEvent as ReactMouseEvent,
    type PointerEvent as ReactPointerEvent,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { getMinimizedBlockIds, removeMinimizedBlockId, restoreMinimizedBlockToLayout } from "./block-minimize";

const FloatPositionStoragePrefix = "snorkeling:minimized-blocks-float-position:";
const FloatButtonSize = 42;
const FloatEdgePadding = 8;
const FloatDefaultPosition = { right: 14, bottom: 14 };
const DragThresholdPx = 4;

type MinimizedBlockItem = {
    blockId: string;
    title: string;
    subtitle: string;
    icon: string;
};

type FloatPosition = {
    right: number;
    bottom: number;
};

type FloatDragState = {
    pointerId: number;
    startX: number;
    startY: number;
    startRight: number;
    startBottom: number;
    containerWidth: number;
    containerHeight: number;
    moved: boolean;
};

function getFloatPositionStorageKey(tabId: string): string {
    return `${FloatPositionStoragePrefix}${tabId}`;
}

function clampFloatPosition(position: FloatPosition, containerWidth: number, containerHeight: number): FloatPosition {
    const maxRight = Math.max(FloatEdgePadding, containerWidth - FloatButtonSize - FloatEdgePadding);
    const maxBottom = Math.max(FloatEdgePadding, containerHeight - FloatButtonSize - FloatEdgePadding);
    return {
        right: Math.min(Math.max(position.right, FloatEdgePadding), maxRight),
        bottom: Math.min(Math.max(position.bottom, FloatEdgePadding), maxBottom),
    };
}

function readStoredFloatPosition(tabId: string): FloatPosition {
    if (typeof window === "undefined") {
        return FloatDefaultPosition;
    }
    try {
        const rawValue = window.localStorage.getItem(getFloatPositionStorageKey(tabId));
        if (!rawValue) {
            return FloatDefaultPosition;
        }
        const parsedValue = JSON.parse(rawValue) as Partial<FloatPosition>;
        if (!Number.isFinite(parsedValue.right) || !Number.isFinite(parsedValue.bottom)) {
            return FloatDefaultPosition;
        }
        return { right: parsedValue.right, bottom: parsedValue.bottom };
    } catch {
        return FloatDefaultPosition;
    }
}

function writeStoredFloatPosition(tabId: string, position: FloatPosition) {
    if (typeof window === "undefined") {
        return;
    }
    try {
        window.localStorage.setItem(getFloatPositionStorageKey(tabId), JSON.stringify(position));
    } catch {
        // Local storage can be unavailable in hardened browser contexts. Drag should still work for the session.
    }
}

function getBlockTitle(block: Block | null | undefined): string {
    const meta = block?.meta ?? {};
    return (
        meta["frame:title"] ||
        meta["frame:text"] ||
        meta["display:name"] ||
        meta.file ||
        meta.url ||
        meta.cmd ||
        meta.view ||
        block?.oid ||
        "Block"
    );
}

function getBlockSubtitle(block: Block | null | undefined): string {
    const meta = block?.meta ?? {};
    const view = meta.view || "block";
    const location = meta.file || meta.url || meta["cmd:cwd"] || meta.connection;
    return location ? `${view} · ${location}` : view;
}

function MinimizedBlockRow({
    item,
    tabId,
    onPreview,
    onRestore,
    onDelete,
    deleting,
}: {
    item: MinimizedBlockItem;
    tabId: string;
    onPreview: (blockId: string) => void;
    onRestore: (blockId: string) => void;
    onDelete: (blockId: string) => void;
    deleting: boolean;
}) {
    return (
        <div className="minimized-block-row">
            <button
                type="button"
                className="minimized-block-preview-button"
                onClick={() => onPreview(item.blockId)}
                title="Preview Block"
            >
                <i className={makeIconClass(item.icon, false, { defaultIcon: "cube" })} />
                <span>
                    <span className="minimized-block-title">{item.title}</span>
                    <span className="minimized-block-subtitle">{item.subtitle}</span>
                </span>
            </button>
            <button
                type="button"
                className="minimized-block-restore-button"
                onClick={() => {
                    restoreMinimizedBlockToLayout(tabId, item.blockId);
                    onRestore(item.blockId);
                }}
                title="Show in Tab"
                aria-label="Show in Tab"
            >
                <i className={makeIconClass("arrow-up-right-from-square", false)} />
            </button>
            <button
                type="button"
                className="minimized-block-delete-button"
                onClick={() => onDelete(item.blockId)}
                title={deleting ? "Deleting Block" : "Delete Block"}
                aria-label={`Delete Block ${item.title}`}
                disabled={deleting}
            >
                <i className={makeIconClass("trash", false)} />
            </button>
        </div>
    );
}

function MinimizedBlocksFloat({ tabId, tabAtom }: { tabId: string; tabAtom: Atom<Tab> }) {
    const tab = useAtomValue(tabAtom);
    const minimizedBlockIds = getMinimizedBlockIds(tab);
    const [open, setOpen] = useState(false);
    const [position, setPosition] = useState<FloatPosition>(() => readStoredFloatPosition(tabId));
    const [containerWidth, setContainerWidth] = useState(0);
    const [dragging, setDragging] = useState(false);
    const [deletingBlockIds, setDeletingBlockIds] = useState<Set<string>>(() => new Set());
    const floatRef = useRef<HTMLDivElement>(null);
    const dragStateRef = useRef<FloatDragState | null>(null);
    const deletingBlockIdsRef = useRef<Set<string>>(new Set());
    const latestPositionRef = useRef(position);
    const suppressClickRef = useRef(false);
    const layoutModel = getLayoutModelForTabById(tabId);
    const items = useMemo<MinimizedBlockItem[]>(() => {
        return minimizedBlockIds
            .map((blockId) => {
                const block = layoutModel?.getBlockById(blockId);
                return {
                    blockId,
                    title: getBlockTitle(block),
                    subtitle: getBlockSubtitle(block),
                    icon: block?.meta?.["frame:icon"] || block?.meta?.icon || block?.meta?.view || "cube",
                };
            })
            .filter((item) => item.title);
    }, [layoutModel, minimizedBlockIds.join(":")]);
    const popoverAlignLeft = containerWidth > 0 && containerWidth - position.right < 360;

    const applyPosition = useCallback((nextPosition: FloatPosition, containerRect: DOMRect) => {
        const clampedPosition = clampFloatPosition(nextPosition, containerRect.width, containerRect.height);
        latestPositionRef.current = clampedPosition;
        setPosition(clampedPosition);
        setContainerWidth(containerRect.width);
        return clampedPosition;
    }, []);

    useEffect(() => {
        const storedPosition = readStoredFloatPosition(tabId);
        latestPositionRef.current = storedPosition;
        setPosition(storedPosition);
    }, [tabId]);

    useEffect(() => {
        if (typeof window === "undefined") {
            return;
        }
        const handleResize = () => {
            const containerRect = floatRef.current?.parentElement?.getBoundingClientRect();
            if (!containerRect) {
                return;
            }
            const clampedPosition = applyPosition(latestPositionRef.current, containerRect);
            writeStoredFloatPosition(tabId, clampedPosition);
        };
        const parentElement = floatRef.current?.parentElement;
        const resizeObserver =
            parentElement && window.ResizeObserver
                ? new ResizeObserver(() => {
                      handleResize();
                  })
                : null;
        if (parentElement) {
            resizeObserver?.observe(parentElement);
        }
        handleResize();
        window.addEventListener("resize", handleResize);
        return () => {
            resizeObserver?.disconnect();
            window.removeEventListener("resize", handleResize);
        };
    }, [applyPosition, tabId]);

    const previewBlock = useCallback(
        (blockId: string) => {
            layoutModel?.newEphemeralNode(blockId, { deleteOnClose: false });
            setOpen(false);
        },
        [layoutModel]
    );

    const restoreBlock = useCallback(
        (_blockId: string) => {
            if (items.length <= 1) {
                setOpen(false);
            }
        },
        [items.length]
    );

    const deleteBlock = useCallback(
        (blockId: string) => {
            if (deletingBlockIdsRef.current.has(blockId)) {
                return;
            }
            deletingBlockIdsRef.current.add(blockId);
            setDeletingBlockIds((current) => new Set(current).add(blockId));
            ObjectService.DeleteBlock(blockId)
                .then(() => {
                    layoutModel?.closeEphemeralNodeForBlock(blockId);
                    removeMinimizedBlockId(tabId, blockId);
                    if (items.length <= 1) {
                        setOpen(false);
                    }
                })
                .catch((e) => {
                    console.warn("Failed to delete minimized block:", e);
                })
                .finally(() => {
                    deletingBlockIdsRef.current.delete(blockId);
                    setDeletingBlockIds((current) => {
                        const next = new Set(current);
                        next.delete(blockId);
                        return next;
                    });
                });
        },
        [items.length, layoutModel, tabId]
    );

    const handlePointerDown = useCallback((e: ReactPointerEvent<HTMLButtonElement>) => {
        if (e.button !== 0) {
            return;
        }
        const containerRect = floatRef.current?.parentElement?.getBoundingClientRect();
        if (!containerRect) {
            return;
        }
        setContainerWidth(containerRect.width);
        dragStateRef.current = {
            pointerId: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            startRight: latestPositionRef.current.right,
            startBottom: latestPositionRef.current.bottom,
            containerWidth: containerRect.width,
            containerHeight: containerRect.height,
            moved: false,
        };
        e.currentTarget.setPointerCapture(e.pointerId);
    }, []);

    const handlePointerMove = useCallback((e: ReactPointerEvent<HTMLButtonElement>) => {
        const dragState = dragStateRef.current;
        if (!dragState || dragState.pointerId !== e.pointerId) {
            return;
        }
        const deltaX = e.clientX - dragState.startX;
        const deltaY = e.clientY - dragState.startY;
        if (!dragState.moved && Math.hypot(deltaX, deltaY) < DragThresholdPx) {
            return;
        }
        dragState.moved = true;
        setDragging(true);
        e.preventDefault();
        const nextPosition = {
            right: dragState.startRight - deltaX,
            bottom: dragState.startBottom - deltaY,
        };
        const clampedPosition = clampFloatPosition(nextPosition, dragState.containerWidth, dragState.containerHeight);
        latestPositionRef.current = clampedPosition;
        setPosition(clampedPosition);
    }, []);

    const finishDrag = useCallback(
        (e: ReactPointerEvent<HTMLButtonElement>) => {
            const dragState = dragStateRef.current;
            if (!dragState || dragState.pointerId !== e.pointerId) {
                return;
            }
            dragStateRef.current = null;
            setDragging(false);
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                e.currentTarget.releasePointerCapture(e.pointerId);
            }
            if (dragState.moved) {
                suppressClickRef.current = true;
                writeStoredFloatPosition(tabId, latestPositionRef.current);
            }
        },
        [tabId]
    );

    const handleButtonClick = useCallback((e: ReactMouseEvent<HTMLButtonElement>) => {
        if (suppressClickRef.current) {
            suppressClickRef.current = false;
            e.preventDefault();
            e.stopPropagation();
            return;
        }
        setOpen((current) => !current);
    }, []);

    const floatStyle = useMemo<CSSProperties>(
        () => ({
            right: position.right,
            bottom: position.bottom,
        }),
        [position.bottom, position.right]
    );

    if (!layoutModel || items.length === 0) {
        return null;
    }

    return (
        <div
            className={clsx(
                "minimized-blocks-float",
                open && "is-open",
                dragging && "is-dragging",
                popoverAlignLeft && "popover-align-left"
            )}
            ref={floatRef}
            style={floatStyle}
        >
            {open && (
                <div className="minimized-blocks-popover">
                    <div className="minimized-blocks-popover-header">
                        <span>Minimized Blocks</span>
                        <strong>{items.length}</strong>
                    </div>
                    <div className="minimized-blocks-list">
                        {items.map((item) => (
                            <MinimizedBlockRow
                                key={item.blockId}
                                item={item}
                                tabId={tabId}
                                onPreview={previewBlock}
                                onRestore={restoreBlock}
                                onDelete={deleteBlock}
                                deleting={deletingBlockIds.has(item.blockId)}
                            />
                        ))}
                    </div>
                </div>
            )}
            <button
                type="button"
                className={clsx("minimized-blocks-button", open && "is-open")}
                onClick={handleButtonClick}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={finishDrag}
                onPointerCancel={finishDrag}
                title="Minimized Blocks"
                aria-label="Minimized Blocks"
                aria-pressed={open}
            >
                <i className={makeIconClass(open ? "box-open" : "box", false)} />
                <span>{items.length}</span>
            </button>
        </div>
    );
}

export { MinimizedBlocksFloat };
