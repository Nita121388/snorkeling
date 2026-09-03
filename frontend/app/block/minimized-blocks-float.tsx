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
import {
    deleteMinimizedGroup,
    getMinimizedBlockIds,
    getMinimizedGroups,
    removeMinimizedBlockId,
    restoreMinimizedBlockToLayout,
    restoreMinimizedGroupToLayout,
    type MinimizedGroups,
} from "./block-minimize";

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

type MinimizedGroupItem = {
    groupId: string;
    members: MinimizedBlockItem[];
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

function buildItem(block: Block | null | undefined): MinimizedBlockItem {
    return {
        blockId: block?.oid || "",
        title: getBlockTitle(block),
        subtitle: getBlockSubtitle(block),
        icon: block?.meta?.["frame:icon"] || block?.meta?.icon || block?.meta?.view || "cube",
    };
}

/**
 * Build the ordered render list from flat blockIds + group map.
 * Groups are inserted at the position of their first member blockId.
 * Group member blockIds (after the first) are skipped so they don't render
 * as top-level rows; they render inside the group row instead.
 */
function buildRenderList(
    minimizedBlockIds: string[],
    groups: MinimizedGroups,
    layoutModel: ReturnType<typeof getLayoutModelForTabById>
): Array<{ type: "block"; item: MinimizedBlockItem } | { type: "group"; group: MinimizedGroupItem }> {
    const result: Array<{ type: "block"; item: MinimizedBlockItem } | { type: "group"; group: MinimizedGroupItem }> = [];
    const renderedGroupIds = new Set<string>();

    for (const blockId of minimizedBlockIds) {
        // Check if this blockId is a member of any group.
        let foundGroup = false;
        for (const [groupId, memberIds] of Object.entries(groups)) {
            const idx = memberIds.indexOf(blockId);
            if (idx === -1) continue;
            foundGroup = true;

            // Only render the group once, at the position of the first member.
            if (!renderedGroupIds.has(groupId)) {
                renderedGroupIds.add(groupId);
                const members = memberIds
                    .map((id) => buildItem(layoutModel?.getBlockById(id)))
                    .filter((m) => m.blockId && m.title);
                if (members.length > 0) {
                    result.push({ type: "group", group: { groupId, members } });
                }
            }
            // Skip subsequent members — they render inside the group row.
            break;
        }
        if (!foundGroup) {
            const item = buildItem(layoutModel?.getBlockById(blockId));
            if (item.blockId && item.title) {
                result.push({ type: "block", item });
            }
        }
    }
    return result;
}

// ── Row components ──

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

function MinimizedGroupRow({
    group,
    tabId,
    expanded,
    onToggleExpand,
    onPreview,
    onRestoreGroup,
    onDeleteGroup,
}: {
    group: MinimizedGroupItem;
    tabId: string;
    expanded: boolean;
    onToggleExpand: () => void;
    onPreview: (blockId: string) => void;
    onRestoreGroup: (groupId: string) => void;
    onDeleteGroup: (groupId: string) => void;
}) {
    const [showActions, setShowActions] = useState(false);
    const actionsTimerRef = useRef<number | null>(null);

    const cancelHideActions = useCallback(() => {
        if (actionsTimerRef.current != null) {
            window.clearTimeout(actionsTimerRef.current);
            actionsTimerRef.current = null;
        }
    }, []);

    useEffect(() => () => cancelHideActions(), [cancelHideActions]);

    const handleHeaderEnter = useCallback(() => {
        cancelHideActions();
        actionsTimerRef.current = window.setTimeout(() => {
            actionsTimerRef.current = null;
            setShowActions(true);
        }, 300);
    }, [cancelHideActions]);

    const handleHeaderLeave = useCallback(() => {
        cancelHideActions();
        setShowActions(false);
    }, [cancelHideActions]);

    return (
        <div className={clsx("minimized-group-row", expanded && "expanded")}>
            <div
                className="minimized-group-header"
                onClick={onToggleExpand}
                onMouseEnter={handleHeaderEnter}
                onMouseLeave={handleHeaderLeave}
            >
                <button type="button" className="minimized-group-expand-btn" title={expanded ? "Collapse" : "Expand"}>
                    <i className={makeIconClass(expanded ? "folder-open" : "folder", false, { defaultIcon: "layer-group" })} />
                </button>
                <span className="minimized-group-title">Group</span>
                <span className="minimized-group-count">{group.members.length}</span>
                {showActions && (
                    <div className="minimized-group-hover-actions">
                        <button
                            type="button"
                            className="minimized-block-restore-button"
                            onClick={(e) => {
                                e.stopPropagation();
                                onRestoreGroup(group.groupId);
                            }}
                            title="Restore Group"
                        >
                            <i className={makeIconClass("arrow-up-right-from-square", false)} />
                        </button>
                        <button
                            type="button"
                            className="minimized-block-delete-button"
                            onClick={(e) => {
                                e.stopPropagation();
                                onDeleteGroup(group.groupId);
                            }}
                            title="Delete Group"
                        >
                            <i className={makeIconClass("trash", false)} />
                        </button>
                    </div>
                )}
            </div>
            {expanded && (
                <div className="minimized-group-members">
                    {group.members.map((member) => (
                        <div key={member.blockId} className="minimized-group-member-row">
                            <button
                                type="button"
                                className="minimized-block-preview-button minimized-group-member-btn"
                                onClick={() => onPreview(member.blockId)}
                                title={member.title}
                            >
                                <i className={makeIconClass(member.icon, false, { defaultIcon: "cube" })} />
                                <span className="minimized-block-title">{member.title}</span>
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

// ── Main component ──

function MinimizedBlocksFloat({ tabId, tabAtom }: { tabId: string; tabAtom: Atom<Tab> }) {
    const tab = useAtomValue(tabAtom);
    const minimizedBlockIds = getMinimizedBlockIds(tab);
    const minimizedGroups = getMinimizedGroups(tab);
    const [open, setOpen] = useState(false);
    const [position, setPosition] = useState<FloatPosition>(() => readStoredFloatPosition(tabId));
    const [containerWidth, setContainerWidth] = useState(0);
    const [dragging, setDragging] = useState(false);
    const [deletingBlockIds, setDeletingBlockIds] = useState<Set<string>>(() => new Set());
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());
    const floatRef = useRef<HTMLDivElement>(null);
    const dragStateRef = useRef<FloatDragState | null>(null);
    const deletingBlockIdsRef = useRef<Set<string>>(new Set());
    const latestPositionRef = useRef(position);
    const suppressClickRef = useRef(false);
    const layoutModel = getLayoutModelForTabById(tabId);

    const renderList = useMemo(
        () => buildRenderList(minimizedBlockIds, minimizedGroups, layoutModel),
        [minimizedBlockIds, minimizedGroups, layoutModel]
    );

    const totalItemCount = useMemo(() => {
        let count = 0;
        for (const entry of renderList) {
            count += entry.type === "group" ? entry.group.members.length : 1;
        }
        return count;
    }, [renderList]);

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
            if (totalItemCount <= 1) {
                setOpen(false);
            }
        },
        [totalItemCount]
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
                    if (totalItemCount <= 1) {
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
        [totalItemCount, layoutModel, tabId]
    );

    const handleRestoreGroup = useCallback(
        (groupId: string) => {
            restoreMinimizedGroupToLayout(tabId, groupId);
            setExpandedGroups((prev) => {
                const next = new Set(prev);
                next.delete(groupId);
                return next;
            });
            if (totalItemCount <= 1) {
                setOpen(false);
            }
        },
        [tabId, totalItemCount]
    );

    const handleDeleteGroup = useCallback(
        (groupId: string) => {
            deleteMinimizedGroup(tabId, groupId);
            setExpandedGroups((prev) => {
                const next = new Set(prev);
                next.delete(groupId);
                return next;
            });
            if (totalItemCount <= 1) {
                setOpen(false);
            }
        },
        [tabId, totalItemCount]
    );

    const toggleGroupExpand = useCallback((groupId: string) => {
        setExpandedGroups((prev) => {
            const next = new Set(prev);
            if (next.has(groupId)) {
                next.delete(groupId);
            } else {
                next.add(groupId);
            }
            return next;
        });
    }, []);

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

    if (!layoutModel || totalItemCount === 0) {
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
                        <strong>{totalItemCount}</strong>
                    </div>
                    <div className="minimized-blocks-list">
                        {renderList.map((entry) => {
                            if (entry.type === "group") {
                                return (
                                    <MinimizedGroupRow
                                        key={`group-${entry.group.groupId}`}
                                        group={entry.group}
                                        tabId={tabId}
                                        expanded={expandedGroups.has(entry.group.groupId)}
                                        onToggleExpand={() => toggleGroupExpand(entry.group.groupId)}
                                        onPreview={previewBlock}
                                        onRestoreGroup={handleRestoreGroup}
                                        onDeleteGroup={handleDeleteGroup}
                                    />
                                );
                            }
                            return (
                                <MinimizedBlockRow
                                    key={entry.item.blockId}
                                    item={entry.item}
                                    tabId={tabId}
                                    onPreview={previewBlock}
                                    onRestore={restoreBlock}
                                    onDelete={deleteBlock}
                                    deleting={deletingBlockIds.has(entry.item.blockId)}
                                />
                            );
                        })}
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
                <span>{totalItemCount}</span>
            </button>
        </div>
    );
}

export { MinimizedBlocksFloat };
