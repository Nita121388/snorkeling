// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { InlineRenameInput } from "@/app/element/inline-rename-input";
import { makeIconClass, naturalStringCompare } from "@/util/util";
import { useVirtualizer } from "@tanstack/react-virtual";
import clsx from "clsx";
import React, {
    CSSProperties,
    KeyboardEvent,
    MouseEvent,
    forwardRef,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from "react";

type TreeNodeChildrenStatus = "unloaded" | "loading" | "loaded" | "error" | "capped";

export interface TreeNodeData {
    id: string;
    parentId?: string;
    label?: string;
    path?: string;
    isDirectory: boolean;
    mimeType?: string;
    icon?: string;
    iconColor?: string;
    isReadonly?: boolean;
    notfound?: boolean;
    staterror?: string;
    childrenStatus?: TreeNodeChildrenStatus;
    childrenIds?: string[];
    capInfo?: { max: number; totalKnown?: number };
}

export interface FetchDirResult {
    nodes: TreeNodeData[];
    capped?: boolean;
    totalKnown?: number;
}

export interface TreeViewVisibleRow {
    id: string;
    parentId?: string;
    depth: number;
    kind: "node" | "loading" | "error" | "capped";
    label: string;
    isDirectory?: boolean;
    isExpanded?: boolean;
    hasChildren?: boolean;
    icon?: string;
    iconColor?: string;
    node?: TreeNodeData;
}

export interface TreeViewProps {
    rootIds: string[];
    initialNodes: Record<string, TreeNodeData>;
    fetchDir?: (id: string, limit: number) => Promise<FetchDirResult>;
    refreshKey?: string | number;
    defaultExpandedIds?: string[];
    maxDirEntries?: number;
    maxExpandAllDepth?: number;
    maxExpandAllDirectories?: number;
    rowHeight?: number;
    indentWidth?: number;
    overscan?: number;
    minWidth?: number;
    maxWidth?: number;
    width?: number | string;
    height?: number | string;
    className?: string;
    selectedId?: string;
    extraSelectedIds?: string[];
    expandDirectoriesOnSingleClick?: boolean;
    onOpenFile?: (id: string, node: TreeNodeData, event: MouseEvent<HTMLDivElement>) => void;
    onSelectionChange?: (id: string, node: TreeNodeData) => void;
    onNodeClick?: (event: MouseEvent<HTMLDivElement>, id: string, node: TreeNodeData) => void;
    onMarqueeSelect?: (nodes: TreeNodeData[]) => void;
    onRenameSelected?: (id: string, node: TreeNodeData) => void;
    onNodeContextMenu?: (event: MouseEvent<HTMLDivElement>, id: string, node: TreeNodeData) => void;
    onBackgroundContextMenu?: (event: MouseEvent<HTMLDivElement>) => void;
    onBackgroundClick?: () => void;
    editingNodeId?: string | null;
    onRenameCommit?: (id: string, newLabel: string) => void;
    onRenameCancel?: (id: string) => void;
}

export interface TreeViewExpandAllResult {
    expandedCount: number;
    reachedLimit: boolean;
}

export interface TreeViewRef {
    scrollToId: (id: string) => void;
    revealId: (id: string) => Promise<boolean>;
    refresh: (id?: string) => void;
    collapseAll: () => void;
    expandAll: () => Promise<TreeViewExpandAllResult>;
}

const DefaultRowHeight = 24;
const DefaultIndentWidth = 12;
const DefaultOverscan = 10;
const DefaultMaxExpandAllDepth = 8;
const DefaultMaxExpandAllDirectories = 500;
const ChevronWidth = 12;
const MarqueeDragThreshold = 5;

function normalizeLabel(node: TreeNodeData): string {
    if (node.label?.trim()) {
        return node.label;
    }
    const path = node.path ?? node.id;
    const chunks = path.split("/").filter(Boolean);
    return chunks[chunks.length - 1] ?? path;
}

function sortIdsByNode(nodesById: Map<string, TreeNodeData>, ids: string[]): string[] {
    return [...ids].sort((leftId, rightId) => {
        const left = nodesById.get(leftId);
        const right = nodesById.get(rightId);
        const leftDir = left?.isDirectory ? 0 : 1;
        const rightDir = right?.isDirectory ? 0 : 1;
        if (leftDir !== rightDir) {
            return leftDir - rightDir;
        }
        const leftLabel = normalizeLabel(left ?? { id: leftId, isDirectory: false }).toLocaleLowerCase();
        const rightLabel = normalizeLabel(right ?? { id: rightId, isDirectory: false }).toLocaleLowerCase();
        if (leftLabel !== rightLabel) {
            return naturalStringCompare(leftLabel, rightLabel);
        }
        return naturalStringCompare(leftId, rightId);
    });
}

export function buildVisibleRows(
    nodesById: Map<string, TreeNodeData>,
    rootIds: string[],
    expandedIds: Set<string>
): TreeViewVisibleRow[] {
    const rows: TreeViewVisibleRow[] = [];

    const appendNode = (id: string, depth: number) => {
        const node = nodesById.get(id);
        if (node == null) {
            return;
        }
        const childIds = node.childrenIds ?? [];
        const hasChildren = node.isDirectory && (childIds.length > 0 || node.childrenStatus !== "loaded");
        const isExpanded = expandedIds.has(id);
        rows.push({
            id,
            parentId: node.parentId,
            depth,
            kind: "node",
            label: normalizeLabel(node),
            isDirectory: node.isDirectory,
            isExpanded,
            hasChildren,
            icon: node.icon,
            iconColor: node.iconColor,
            node,
        });
        if (!isExpanded || !node.isDirectory) {
            return;
        }
        const status = node.childrenStatus ?? "unloaded";
        if (status === "loading") {
            rows.push({
                id: `${id}::__loading`,
                parentId: id,
                depth: depth + 1,
                kind: "loading",
                label: "Loading…",
            });
            return;
        }
        if (status === "error") {
            rows.push({
                id: `${id}::__error`,
                parentId: id,
                depth: depth + 1,
                kind: "error",
                label: node.staterror ? `Error: ${node.staterror}` : "Unable to load directory",
            });
            return;
        }

        const sortedChildren = sortIdsByNode(nodesById, childIds);
        sortedChildren.forEach((childId) => appendNode(childId, depth + 1));
        if (status === "capped") {
            const capMax = node.capInfo?.max ?? childIds.length;
            rows.push({
                id: `${id}::__capped`,
                parentId: id,
                depth: depth + 1,
                kind: "capped",
                label: `Showing first ${capMax} entries`,
            });
        }
    };

    sortIdsByNode(nodesById, rootIds).forEach((id) => appendNode(id, 0));
    return rows;
}

function getNodeIcon(node: TreeNodeData, isExpanded: boolean): string {
    if (node.notfound || node.staterror) {
        return "triangle-exclamation";
    }
    if (node.icon) {
        return node.icon;
    }
    if (node.isDirectory) {
        return isExpanded ? "folder-open" : "folder";
    }
    const mime = node.mimeType ?? "";
    if (mime.startsWith("image/")) {
        return "image";
    }
    if (mime === "application/pdf") {
        return "file-pdf";
    }
    const extension = normalizeLabel(node).split(".").pop()?.toLocaleLowerCase();
    if (
        ["js", "jsx", "ts", "tsx", "go", "py", "java", "c", "cpp", "h", "hpp", "json", "yaml", "yml"].includes(
            extension
        )
    ) {
        return "file-code";
    }
    if (["md", "txt", "log"].includes(extension)) {
        return "file-lines";
    }
    return "file";
}

function normalizeInitialNodes(initialNodes: Record<string, TreeNodeData>): Map<string, TreeNodeData> {
    return new Map(
        Object.entries(initialNodes).map(([id, node]) => [
            id,
            { ...node, childrenStatus: node.childrenStatus ?? "unloaded" },
        ])
    );
}

function deleteNodeSubtree(nodesById: Map<string, TreeNodeData>, id: string) {
    const node = nodesById.get(id);
    node?.childrenIds?.forEach((childId) => deleteNodeSubtree(nodesById, childId));
    nodesById.delete(id);
}

export function mergeFetchedTreeChildren(
    nodesById: Map<string, TreeNodeData>,
    parentId: string,
    result: FetchDirResult,
    maxDirEntries: number
): Map<string, TreeNodeData> {
    const next = new Map(nodesById);
    const parentNode = next.get(parentId);
    if (parentNode == null) {
        return nodesById;
    }
    const nextChildIds = new Set(result.nodes.map((node) => node.id));
    parentNode.childrenIds?.forEach((childId) => {
        if (!nextChildIds.has(childId)) {
            deleteNodeSubtree(next, childId);
        }
    });
    result.nodes.forEach((node) => {
        const existing = next.get(node.id);
        const preserveDirectoryState = node.isDirectory && existing?.isDirectory;
        const merged: TreeNodeData = {
            ...existing,
            ...node,
            parentId: node.parentId ?? parentId,
            childrenStatus:
                node.childrenStatus ??
                (node.isDirectory
                    ? preserveDirectoryState
                        ? (existing.childrenStatus ?? "unloaded")
                        : "unloaded"
                    : "loaded"),
            childrenIds: node.isDirectory
                ? (node.childrenIds ?? (preserveDirectoryState ? existing.childrenIds : undefined))
                : undefined,
            capInfo: node.isDirectory
                ? (node.capInfo ?? (preserveDirectoryState ? existing.capInfo : undefined))
                : undefined,
        };
        if (!node.isDirectory) {
            delete merged.childrenIds;
            delete merged.capInfo;
        }
        next.set(merged.id, merged);
    });
    const childrenIds = sortIdsByNode(
        next,
        result.nodes.map((entry) => entry.id)
    );
    next.set(parentId, {
        ...parentNode,
        childrenIds,
        childrenStatus: result.capped ? "capped" : "loaded",
        capInfo: result.capped ? { max: maxDirEntries, totalKnown: result.totalKnown } : undefined,
        staterror: undefined,
    });
    return next;
}

export function getExpandableDirectoryChildIds(nodesById: Map<string, TreeNodeData>, id: string): string[] {
    const node = nodesById.get(id);
    if (node == null || node.childrenStatus === "capped") {
        return [];
    }
    return sortIdsByNode(
        nodesById,
        (node.childrenIds ?? []).filter((childId) => {
            const child = nodesById.get(childId);
            return !!child?.isDirectory && !child.notfound && !child.staterror;
        })
    );
}

export function collapseTreeExpandedIds(expandedIds: Set<string>, rootIds: string[]): Set<string> {
    const roots = new Set(rootIds);
    let changed = false;
    const next = new Set<string>(rootIds);
    if (next.size !== expandedIds.size) {
        changed = true;
    }
    expandedIds.forEach((id) => {
        if (roots.has(id)) {
            next.add(id);
        } else {
            changed = true;
        }
    });
    return changed ? next : expandedIds;
}

function normalizeTreePath(path: string): string {
    if (path == null) {
        return "";
    }
    let value = path.replace(/\\/g, "/").replace(/\/+/g, "/");
    if (/^\/[A-Za-z]:/.test(value)) {
        value = value.slice(1);
    }
    if (value.length > 1 && !/^[A-Za-z]:\/$/.test(value)) {
        value = value.replace(/\/+$/, "");
    }
    return value;
}

export function getTreeRevealAncestorIds(targetId: string, rootIds: string[]): string[] {
    const target = normalizeTreePath(targetId);
    const root = rootIds
        .map((rootId) => normalizeTreePath(rootId))
        .filter((rootId) => target === rootId || target.startsWith(rootId.endsWith("/") ? rootId : `${rootId}/`))
        .sort((left, right) => right.length - left.length)[0];
    if (root == null) {
        return [];
    }
    const ancestorIds = [root];
    let current = root;
    const suffix = target.slice(root.length).replace(/^\/+/, "");
    if (suffix === "") {
        return ancestorIds;
    }
    const parts = suffix.split("/").filter(Boolean);
    for (let idx = 0; idx < parts.length - 1; idx++) {
        current = current.endsWith("/") ? `${current}${parts[idx]}` : `${current}/${parts[idx]}`;
        ancestorIds.push(current);
    }
    return ancestorIds;
}

export const TreeView = forwardRef<TreeViewRef, TreeViewProps>((props, ref) => {
    const {
        rootIds,
        initialNodes,
        fetchDir,
        refreshKey,
        defaultExpandedIds,
        maxDirEntries = 500,
        maxExpandAllDepth = DefaultMaxExpandAllDepth,
        maxExpandAllDirectories = DefaultMaxExpandAllDirectories,
        rowHeight = DefaultRowHeight,
        indentWidth = DefaultIndentWidth,
        overscan = DefaultOverscan,
        minWidth = 100,
        maxWidth = 400,
        width = "100%",
        height = 360,
        className,
        selectedId: propSelectedId,
        extraSelectedIds,
        expandDirectoriesOnSingleClick = false,
        onOpenFile,
        onSelectionChange,
        onRenameSelected,
        onNodeContextMenu,
        onBackgroundContextMenu,
        onNodeClick,
        onMarqueeSelect,
        onBackgroundClick,
        editingNodeId,
        onRenameCommit,
        onRenameCancel,
    } = props;
    const [nodesById, setNodesById] = useState<Map<string, TreeNodeData>>(() => normalizeInitialNodes(initialNodes));
    const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set(defaultExpandedIds ?? []));
    const [selectedId, setSelectedId] = useState<string>(propSelectedId ?? rootIds[0]);
    const extraSelectedSet = useMemo(() => new Set(extraSelectedIds ?? []), [extraSelectedIds]);
    const scrollRef = useRef<HTMLDivElement>(null);
    const nodesByIdRef = useRef(nodesById);
    const expandedIdsRef = useRef(expandedIds);
    const idToIndexRef = useRef<Map<string, number>>(new Map());
    const pendingScrollIdRef = useRef<string | null>(null);
    const loadingIdsRef = useRef<Set<string>>(new Set());
    const lastRefreshKeyRef = useRef(refreshKey);
    const rootIdsKey = rootIds.join("\u0000");
    const defaultExpandedIdsKey = (defaultExpandedIds ?? []).join("\u0000");

    // Marquee (rubber-band) selection state
    const [marqueeActive, setMarqueeActive] = useState(false);
    const [marqueeRect, setMarqueeRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
    const marqueeStartRef = useRef<{ x: number; y: number } | null>(null);
    const marqueeDraggingRef = useRef(false);
    const dragStartXRef = useRef<number>(0);
    const dragStartYRef = useRef<number>(0);
    const ignoreNextClickRef = useRef(false);
    const marqueeJustCompletedRef = useRef(false);
    const onMarqueeSelectRef = useRef(onMarqueeSelect);
    onMarqueeSelectRef.current = onMarqueeSelect;

    const onScrollContainerMouseDown = (e: MouseEvent<HTMLDivElement>) => {
        if (e.button !== 0) {
            return;
        }
        const target = e.target as HTMLElement;
        if (target.closest("button")) {
            return;
        }
        if (!scrollRef.current) {
            return;
        }
        // Clear the flag so the NEXT click (not this mousedown's click) works normally
        marqueeJustCompletedRef.current = false;
        const rect = scrollRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left + scrollRef.current.scrollLeft;
        const y = e.clientY - rect.top + scrollRef.current.scrollTop;
        marqueeStartRef.current = { x, y };
        marqueeDraggingRef.current = true;
        dragStartXRef.current = e.clientX;
        dragStartYRef.current = e.clientY;
    };

    useEffect(() => {
        nodesByIdRef.current = nodesById;
    }, [nodesById]);

    useEffect(() => {
        expandedIdsRef.current = expandedIds;
    }, [expandedIds]);

    useEffect(() => {
        setNodesById(normalizeInitialNodes(initialNodes));
    }, [initialNodes]);

    useEffect(() => {
        setExpandedIds(new Set(defaultExpandedIds ?? []));
    }, [defaultExpandedIdsKey, rootIdsKey]);

    useEffect(() => {
        setSelectedId(propSelectedId ?? rootIds[0]);
    }, [propSelectedId, rootIdsKey]);

    const visibleRows = useMemo(
        () => buildVisibleRows(nodesById, rootIds, expandedIds),
        [nodesById, rootIds, expandedIds]
    );
    const idToIndex = useMemo(() => new Map(visibleRows.map((row, index) => [row.id, index])), [visibleRows]);
    const virtualizer = useVirtualizer({
        count: visibleRows.length,
        getScrollElement: () => scrollRef.current,
        estimateSize: () => rowHeight,
        overscan,
    });

    // Document-level mouse handlers for marquee drag
    useEffect(() => {
        const handleMouseMove = (e: globalThis.MouseEvent) => {
            if (!marqueeDraggingRef.current || !scrollRef.current || !marqueeStartRef.current) {
                return;
            }
            const rect = scrollRef.current.getBoundingClientRect();
            const currentX = e.clientX - rect.left + scrollRef.current.scrollLeft;
            const currentY = e.clientY - rect.top + scrollRef.current.scrollTop;
            const startX = marqueeStartRef.current.x;
            const startY = marqueeStartRef.current.y;
            const dragDistance =
                Math.abs(e.clientX - dragStartXRef.current) + Math.abs(e.clientY - dragStartYRef.current);

            if (!marqueeActive && dragDistance > MarqueeDragThreshold) {
                setMarqueeActive(true);
                ignoreNextClickRef.current = true;
            }

            if (marqueeActive || dragDistance > MarqueeDragThreshold) {
                const left = Math.min(startX, currentX);
                const top = Math.min(startY, currentY);
                const width = Math.abs(currentX - startX);
                const height = Math.abs(currentY - startY);
                setMarqueeRect({ left, top, width, height });

                // Calculate intersecting rows
                const virtualItems = virtualizer.getVirtualItems();
                const intersectingNodes: TreeNodeData[] = [];
                for (const virtualRow of virtualItems) {
                    const row = visibleRows[virtualRow.index];
                    if (row.kind !== "node" || row.node == null) {
                        continue;
                    }
                    const rowTop = virtualRow.start;
                    const rowBottom = rowTop + rowHeight;
                    const intersects = top < rowBottom && top + height > rowTop;
                    if (intersects) {
                        intersectingNodes.push(row.node);
                    }
                }

                onMarqueeSelectRef.current?.(intersectingNodes);
            }
        };

        const handleMouseUp = () => {
            if (marqueeDraggingRef.current) {
                marqueeDraggingRef.current = false;
                marqueeStartRef.current = null;
                if (marqueeActive) {
                    marqueeJustCompletedRef.current = true;
                }
                setMarqueeActive(false);
                setMarqueeRect(null);
            }
        };

        document.addEventListener("mousemove", handleMouseMove);
        document.addEventListener("mouseup", handleMouseUp);
        return () => {
            document.removeEventListener("mousemove", handleMouseMove);
            document.removeEventListener("mouseup", handleMouseUp);
        };
    }, [marqueeActive, rowHeight, visibleRows, virtualizer]);

    const commitSelection = (id: string) => {
        const node = nodesByIdRef.current.get(id);
        if (node == null) {
            return;
        }
        setSelectedId(id);
        onSelectionChange?.(id, node);
    };

    const scrollToId = (id: string) => {
        const index = idToIndexRef.current.get(id);
        if (index == null) {
            return;
        }
        virtualizer.scrollToIndex(index, { align: "auto" });
    };

    useEffect(() => {
        idToIndexRef.current = idToIndex;
        const pendingScrollId = pendingScrollIdRef.current;
        if (pendingScrollId == null || !idToIndex.has(pendingScrollId)) {
            return;
        }
        pendingScrollIdRef.current = null;
        virtualizer.scrollToIndex(idToIndex.get(pendingScrollId), { align: "auto" });
    }, [idToIndex, virtualizer]);

    const updateNodesById = React.useCallback(
        (updater: (prev: Map<string, TreeNodeData>) => Map<string, TreeNodeData>) => {
            setNodesById((prev) => {
                const next = updater(prev);
                nodesByIdRef.current = next;
                return next;
            });
        },
        []
    );

    const updateExpandedIds = React.useCallback((updater: (prev: Set<string>) => Set<string>) => {
        setExpandedIds((prev) => {
            const next = updater(prev);
            expandedIdsRef.current = next;
            return next;
        });
    }, []);

    const loadChildren = React.useCallback(
        async (id: string, force = false) => {
            const currentNode = nodesByIdRef.current.get(id);
            if (
                currentNode == null ||
                !currentNode.isDirectory ||
                currentNode.notfound ||
                (!force && currentNode.staterror) ||
                fetchDir == null
            ) {
                return;
            }
            const status = currentNode.childrenStatus ?? "unloaded";
            if (loadingIdsRef.current.has(id) || (!force && status !== "unloaded")) {
                return;
            }
            loadingIdsRef.current.add(id);
            const keepCurrentChildrenOnError = force && status !== "unloaded" && status !== "error";
            if (status === "unloaded" || status === "error") {
                updateNodesById((prev) => {
                    const source = prev.get(id);
                    if (source == null) {
                        return prev;
                    }
                    const next = new Map(prev);
                    next.set(id, { ...source, childrenStatus: "loading" });
                    return next;
                });
            }
            try {
                const result = await fetchDir(id, maxDirEntries);
                updateNodesById((prev) => mergeFetchedTreeChildren(prev, id, result, maxDirEntries));
            } catch (error) {
                updateNodesById((prev) => {
                    const next = new Map(prev);
                    const source = next.get(id);
                    if (source == null || keepCurrentChildrenOnError) {
                        return prev;
                    }
                    next.set(id, {
                        ...source,
                        childrenStatus: "error",
                        staterror: error instanceof Error ? error.message : "Unknown error",
                    });
                    return next;
                });
            } finally {
                loadingIdsRef.current.delete(id);
            }
        },
        [fetchDir, maxDirEntries, updateNodesById]
    );

    const refreshDirectory = React.useCallback(
        (id?: string) => {
            const ids = id == null ? Array.from(expandedIdsRef.current) : [id];
            ids.forEach((expandedId) => {
                const node = nodesByIdRef.current.get(expandedId);
                if (node?.isDirectory) {
                    void loadChildren(expandedId, true);
                }
            });
        },
        [loadChildren]
    );

    const collapseAll = React.useCallback(() => {
        updateExpandedIds((prev) => collapseTreeExpandedIds(prev, rootIds));
    }, [rootIdsKey, updateExpandedIds]);

    const expandAll = React.useCallback(async (): Promise<TreeViewExpandAllResult> => {
        let expandedCount = 0;
        let reachedLimit = false;
        const rootSet = new Set(rootIds);
        const visitedIds = new Set<string>();

        const markExpanded = (id: string) => {
            updateExpandedIds((prev) => {
                if (prev.has(id)) {
                    return prev;
                }
                const next = new Set(prev);
                next.add(id);
                return next;
            });
        };

        const visitDirectory = async (id: string, depth: number) => {
            if (reachedLimit || visitedIds.has(id)) {
                return;
            }
            const node = nodesByIdRef.current.get(id);
            if (node == null || !node.isDirectory || node.notfound || node.staterror) {
                return;
            }
            visitedIds.add(id);
            markExpanded(id);
            if (!rootSet.has(id)) {
                expandedCount++;
            }
            if (expandedCount >= maxExpandAllDirectories || depth >= maxExpandAllDepth) {
                reachedLimit = true;
                return;
            }
            if ((node.childrenStatus ?? "unloaded") === "unloaded") {
                await loadChildren(id);
            }
            const currentNode = nodesByIdRef.current.get(id);
            if (currentNode?.childrenStatus === "capped" || currentNode?.childrenStatus === "error") {
                return;
            }
            for (const childId of getExpandableDirectoryChildIds(nodesByIdRef.current, id)) {
                await visitDirectory(childId, depth + 1);
                if (reachedLimit) {
                    return;
                }
            }
        };

        for (const rootId of rootIds) {
            await visitDirectory(rootId, 0);
            if (reachedLimit) {
                break;
            }
        }
        return { expandedCount, reachedLimit };
    }, [loadChildren, maxExpandAllDepth, maxExpandAllDirectories, rootIdsKey, updateExpandedIds]);

    const revealId = React.useCallback(
        async (id: string): Promise<boolean> => {
            const targetId = normalizeTreePath(id);
            const ancestorIds = getTreeRevealAncestorIds(targetId, rootIds);
            if (ancestorIds.length === 0) {
                return false;
            }
            for (const ancestorId of ancestorIds) {
                updateExpandedIds((prev) => {
                    if (prev.has(ancestorId)) {
                        return prev;
                    }
                    const next = new Set(prev);
                    next.add(ancestorId);
                    return next;
                });
                const node = nodesByIdRef.current.get(ancestorId);
                if (node?.isDirectory && (node.childrenStatus ?? "unloaded") === "unloaded") {
                    await loadChildren(ancestorId);
                }
            }
            const targetNode = nodesByIdRef.current.get(targetId);
            if (targetNode == null) {
                return false;
            }
            commitSelection(targetId);
            pendingScrollIdRef.current = targetId;
            window.setTimeout(() => scrollToId(targetId), 0);
            return true;
        },
        [loadChildren, rootIdsKey, updateExpandedIds]
    );

    useImperativeHandle(
        ref,
        () => ({
            scrollToId,
            revealId,
            refresh: refreshDirectory,
            collapseAll,
            expandAll,
        }),
        [collapseAll, expandAll, idToIndex, refreshDirectory, revealId, virtualizer]
    );

    useEffect(() => {
        expandedIds.forEach((id) => {
            const node = nodesById.get(id);
            if (node?.isDirectory && (node.childrenStatus ?? "unloaded") === "unloaded") {
                void loadChildren(id);
            }
        });
    }, [expandedIds, nodesById, loadChildren]);

    useEffect(() => {
        setExpandedIds((prev) => {
            let changed = false;
            const next = new Set<string>();
            prev.forEach((id) => {
                if (nodesById.has(id)) {
                    next.add(id);
                } else {
                    changed = true;
                }
            });
            return changed ? next : prev;
        });
    }, [nodesById]);

    useEffect(() => {
        if (refreshKey == null || Object.is(lastRefreshKeyRef.current, refreshKey)) {
            return;
        }
        lastRefreshKeyRef.current = refreshKey;
        refreshDirectory();
    }, [refreshDirectory, refreshKey]);

    const toggleExpand = (id: string) => {
        const node = nodesById.get(id);
        if (node == null || !node.isDirectory || node.notfound || node.staterror) {
            return;
        }
        const expanded = expandedIds.has(id);
        if (!expanded) {
            loadChildren(id);
        }
        updateExpandedIds((prev) => {
            const next = new Set(prev);
            if (expanded) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
        scrollToId(id);
    };

    const selectVisibleNodeAt = (index: number) => {
        if (index < 0 || index >= visibleRows.length) {
            return;
        }
        const row = visibleRows[index];
        if (row.kind !== "node") {
            return;
        }
        commitSelection(row.id);
        scrollToId(row.id);
    };

    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        const selectedIndex = selectedId != null ? idToIndex.get(selectedId) : undefined;
        if (event.key === "ArrowDown") {
            event.preventDefault();
            const nextIndex = (selectedIndex ?? -1) + 1;
            for (let idx = nextIndex; idx < visibleRows.length; idx++) {
                if (visibleRows[idx].kind === "node") {
                    selectVisibleNodeAt(idx);
                    break;
                }
            }
            return;
        }
        if (event.key === "ArrowUp") {
            event.preventDefault();
            const previousIndex = (selectedIndex ?? visibleRows.length) - 1;
            for (let idx = previousIndex; idx >= 0; idx--) {
                if (visibleRows[idx].kind === "node") {
                    selectVisibleNodeAt(idx);
                    break;
                }
            }
            return;
        }
        const node = selectedId ? nodesById.get(selectedId) : null;
        if (node == null) {
            return;
        }
        if (event.key === "F2") {
            event.preventDefault();
            event.stopPropagation();
            onRenameSelected?.(node.id, node);
            return;
        }
        if (event.key === "ArrowLeft") {
            event.preventDefault();
            if (node.isDirectory && expandedIds.has(node.id)) {
                toggleExpand(node.id);
                return;
            }
            if (node.parentId != null) {
                commitSelection(node.parentId);
                scrollToId(node.parentId);
            }
            return;
        }
        if (event.key === "ArrowRight") {
            event.preventDefault();
            if (node.isDirectory && !expandedIds.has(node.id)) {
                toggleExpand(node.id);
                return;
            }
            if (node.isDirectory && expandedIds.has(node.id) && node.childrenIds?.[0]) {
                commitSelection(node.childrenIds[0]);
                scrollToId(node.childrenIds[0]);
            }
        }
    };

    const containerStyle: CSSProperties = {
        width,
        minWidth,
        maxWidth,
        height,
    };

    return (
        <div
            className={clsx("rounded-md bg-panel", className)}
            style={containerStyle}
            tabIndex={0}
            onKeyDown={onKeyDown}
        >
            <div
                ref={scrollRef}
                className="h-full overflow-auto select-none"
                style={{ position: "relative" }}
                onMouseDown={onScrollContainerMouseDown}
                onClick={(event) => {
                    // Click on empty space (not on a row) → clear selection
                    // But skip if a marquee just completed (the flag will be cleared on next mousedown)
                    if (!(event.target as HTMLElement).closest("[data-treeview-row]") && !marqueeJustCompletedRef.current) {
                        onBackgroundClick?.();
                    }
                }}
                onContextMenu={(event) => {
                    onBackgroundContextMenu?.(event);
                }}
            >
                <div className="relative w-max min-w-full" style={{ height: virtualizer.getTotalSize() }}>
                    {virtualizer.getVirtualItems().map((virtualRow) => {
                        const row = visibleRows[virtualRow.index];
                        if (row.kind === "node" && row.node == null) {
                            return null;
                        }
                        const selected = row.id === selectedId || extraSelectedSet.has(row.id);
                        return (
                            <div
                                key={row.id}
                                data-treeview-row
                                className={clsx(
                                    "absolute left-0 right-0 flex items-center overflow-hidden rounded-[5px] text-sm",
                                    row.kind === "node" ? "cursor-pointer" : "text-muted",
                                    selected ? "bg-accent/25 text-foreground" : "text-foreground hover:bg-hoverbg"
                                )}
                                style={{
                                    top: 0,
                                    height: rowHeight,
                                    transform: `translateY(${virtualRow.start}px)`,
                                }}
                                onClick={(event) => {
                                    if (row.kind !== "node" || row.node == null) {
                                        return;
                                    }
                                    // Skip click if a marquee drag just completed
                                    if (ignoreNextClickRef.current || marqueeJustCompletedRef.current) {
                                        ignoreNextClickRef.current = false;
                                        marqueeJustCompletedRef.current = false;
                                        return;
                                    }
                                    onNodeClick?.(event, row.id, row.node);
                                    commitSelection(row.id);
                                    // ctrl/cmd 按住时为多选操作,不展开文件夹,避免多选多个目录把树撑长
                                    if (
                                        expandDirectoriesOnSingleClick &&
                                        row.isDirectory &&
                                        !(event.ctrlKey || event.metaKey)
                                    ) {
                                        toggleExpand(row.id);
                                    }
                                }}
                                onDoubleClick={(event) => {
                                    if (row.kind !== "node") {
                                        return;
                                    }
                                    if (row.isDirectory) {
                                        if (expandDirectoriesOnSingleClick) {
                                            return;
                                        }
                                        toggleExpand(row.id);
                                        return;
                                    }
                                    if (row.node != null) {
                                        onOpenFile?.(row.id, row.node, event);
                                    }
                                }}
                                onContextMenu={(event) => {
                                    if (row.kind !== "node" || row.node == null) {
                                        return;
                                    }
                                    event.preventDefault();
                                    event.stopPropagation();
                                    commitSelection(row.id);
                                    onNodeContextMenu?.(event, row.id, row.node);
                                }}
                            >
                                <div
                                    className="flex items-center"
                                    style={{
                                        paddingLeft: row.depth * indentWidth,
                                        width: ChevronWidth + row.depth * indentWidth,
                                    }}
                                >
                                    {row.kind === "node" && row.isDirectory && row.hasChildren ? (
                                        <button
                                            className="rounded text-muted hover:text-foreground cursor-pointer flex items-center justify-center shrink-0"
                                            style={{ width: ChevronWidth, height: ChevronWidth }}
                                            onClick={(event: MouseEvent<HTMLButtonElement>) => {
                                                event.stopPropagation();
                                                toggleExpand(row.id);
                                            }}
                                        >
                                            <i
                                                className={clsx(
                                                    "fa-sharp fa-solid text-[10px]",
                                                    row.isExpanded ? "fa-chevron-down" : "fa-chevron-right"
                                                )}
                                            />
                                        </button>
                                    ) : (
                                        <span
                                            className="inline-block shrink-0"
                                            style={{ width: ChevronWidth, height: ChevronWidth }}
                                        />
                                    )}
                                </div>
                                {row.kind === "node" ? (
                                    <>
                                        <i
                                            className={makeIconClass(getNodeIcon(row.node, row.isExpanded), true)}
                                            style={{
                                                color:
                                                    row.node.notfound || row.node.staterror
                                                        ? "var(--color-error)"
                                                        : (row.node.iconColor ?? "inherit"),
                                            }}
                                        />
                                        {editingNodeId === row.id ? (
                                            <InlineRenameInput
                                                className="ml-1 h-full min-w-0 flex-1 rounded-[3px] border border-[var(--accent-color)] bg-[var(--overlay-bg-color)] px-1 text-sm outline-none"
                                                defaultValue={row.label}
                                                onCommit={(newLabel) => onRenameCommit?.(row.id, newLabel)}
                                                onCancel={() => onRenameCancel?.(row.id)}
                                            />
                                        ) : (
                                            <span
                                                className={clsx("ml-1 truncate", row.node.isReadonly && "text-muted")}
                                                title={row.label}
                                            >
                                                {row.label}
                                            </span>
                                        )}
                                    </>
                                ) : (
                                    <span className="ml-1 truncate text-xs">{row.label}</span>
                                )}
                            </div>
                        );
                    })}
                </div>
                {marqueeActive && marqueeRect && (
                    <div
                        className="pointer-events-none absolute z-50 border border-[var(--accent-color)] bg-[var(--accent-color)]/10"
                        style={{
                            left: marqueeRect.left,
                            top: marqueeRect.top,
                            width: marqueeRect.width,
                            height: marqueeRect.height,
                        }}
                    />
                )}
            </div>
        </div>
    );
});

TreeView.displayName = "TreeView";
