// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { findNode } from "./layoutNode";
import { DropDirection, LayoutNode, LayoutNodeAdditionalProps, LayoutTreeState } from "./types";

export const InlineTabDragItemType = "INLINE_TAB_ITEM";

export type InlineTabMergeTarget = {
    sourceNode: LayoutNode;
    targetNode: LayoutNode;
};

export type InlineTabDragItem = {
    sourceNodeId: string;
    blockId: string;
    sourceIndex: number;
    origin: "tab-label" | "block-header";
    sourceRect?: Dimensions;
};

export type InlineTabDropResult = {
    action: "reorder" | "move";
};

export type PendingInlineTabDrop = InlineTabDragItem & {
    targetNodeId: string;
    direction: DropDirection;
};

export function getLayoutDataBlockIds(data: TabLayoutData | null | undefined): string[] {
    if (!data) {
        return [];
    }
    if (Array.isArray(data.blockIds) && data.blockIds.length > 0) {
        return data.blockIds.filter((blockId) => blockId != null && blockId !== "");
    }
    return data.blockId ? [data.blockId] : [];
}

export function getLayoutDataActiveBlockId(data: TabLayoutData | null | undefined): string | null {
    const blockIds = getLayoutDataBlockIds(data);
    if (blockIds.length === 0) {
        return null;
    }
    if (data?.activeBlockId && blockIds.includes(data.activeBlockId)) {
        return data.activeBlockId;
    }
    return blockIds[0];
}

export function layoutDataContainsBlockId(data: TabLayoutData | null | undefined, blockId: string): boolean {
    return getLayoutDataBlockIds(data).includes(blockId);
}

export function normalizeInlineTabData(data: TabLayoutData | null | undefined): TabLayoutData {
    const blockIds = getLayoutDataBlockIds(data);
    if (blockIds.length <= 1) {
        return { blockId: blockIds[0] ?? data?.blockId };
    }
    const activeBlockId = getLayoutDataActiveBlockId(data) ?? blockIds[0];
    return {
        blockIds,
        activeBlockId,
        blockTabTitles: data?.blockTabTitles,
    };
}

function rectsOverlapOnY(a: Dimensions, b: Dimensions): boolean {
    const aCenter = a.top + a.height / 2;
    const bTop = b.top;
    const bBottom = b.top + b.height;
    return aCenter >= bTop && aCenter <= bBottom;
}

function rectsOverlapOnX(a: Dimensions, b: Dimensions): boolean {
    const aCenter = a.left + a.width / 2;
    const bLeft = b.left;
    const bRight = b.left + b.width;
    return aCenter >= bLeft && aCenter <= bRight;
}

function getNodeRect(nodeId: string, additionalProps: Record<string, LayoutNodeAdditionalProps>): Dimensions | null {
    return additionalProps[nodeId]?.rect ?? null;
}

function findFallbackPreviousTarget(
    sourceIndex: number,
    leafOrder: LeafOrderEntry[],
    treeState: LayoutTreeState,
    sourceNode: LayoutNode
): LayoutNode | null {
    for (let index = sourceIndex - 1; index >= 0; index--) {
        const targetNode = findNode(treeState.rootNode, leafOrder[index].nodeid);
        if (targetNode && targetNode.id !== sourceNode.id && getLayoutDataBlockIds(targetNode.data).length > 0) {
            return targetNode;
        }
    }
    return null;
}

export function findInlineTabMergeTarget(
    sourceBlockId: string,
    leafOrder: LeafOrderEntry[],
    additionalProps: Record<string, LayoutNodeAdditionalProps>,
    treeState: LayoutTreeState
): InlineTabMergeTarget | null {
    const sourceEntry = leafOrder.find((entry) => {
        const node = findNode(treeState.rootNode, entry.nodeid);
        return layoutDataContainsBlockId(node?.data, sourceBlockId);
    });
    if (!sourceEntry) {
        return null;
    }
    const sourceNode = findNode(treeState.rootNode, sourceEntry.nodeid);
    const sourceRect = getNodeRect(sourceEntry.nodeid, additionalProps);
    if (!sourceNode) {
        return null;
    }
    if (getLayoutDataBlockIds(sourceNode.data).length > 1) {
        return null;
    }

    const sourceIndex = leafOrder.findIndex((entry) => entry.nodeid === sourceEntry.nodeid);
    if (sourceRect) {
        const previousSameRow = leafOrder
            .slice(0, sourceIndex)
            .reverse()
            .find((entry) => {
                const targetRect = getNodeRect(entry.nodeid, additionalProps);
                if (!targetRect || !rectsOverlapOnY(sourceRect, targetRect)) {
                    return false;
                }
                return targetRect.left < sourceRect.left;
            });
        if (previousSameRow) {
            const targetNode = findNode(treeState.rootNode, previousSameRow.nodeid);
            if (targetNode) {
                return { sourceNode, targetNode };
            }
        }

        const sameColumnCandidates = leafOrder
            .filter((entry) => entry.nodeid !== sourceEntry.nodeid)
            .map((entry) => {
                const rect = getNodeRect(entry.nodeid, additionalProps);
                const node = findNode(treeState.rootNode, entry.nodeid);
                if (!rect || !node || !rectsOverlapOnX(sourceRect, rect)) {
                    return null;
                }
                const sourceCenterY = sourceRect.top + sourceRect.height / 2;
                const targetCenterY = rect.top + rect.height / 2;
                return {
                    node,
                    distance: Math.abs(targetCenterY - sourceCenterY),
                    above: targetCenterY < sourceCenterY,
                };
            })
            .filter(
                (candidate): candidate is { node: LayoutNode; distance: number; above: boolean } => candidate != null
            )
            .sort((a, b) => a.distance - b.distance || Number(b.above) - Number(a.above));

        const sameColumnTarget = sameColumnCandidates[0]?.node;
        if (sameColumnTarget) {
            return { sourceNode, targetNode: sameColumnTarget };
        }
    }

    const fallbackTarget = findFallbackPreviousTarget(sourceIndex, leafOrder, treeState, sourceNode);
    return fallbackTarget ? { sourceNode, targetNode: fallbackTarget } : null;
}

export function mergeSourceNodeIntoTargetNode(sourceNode: LayoutNode, targetNode: LayoutNode, sourceBlockId: string) {
    const targetBlockIds = getLayoutDataBlockIds(targetNode.data);
    if (targetBlockIds.includes(sourceBlockId)) {
        return;
    }
    targetNode.data = {
        blockIds: [...targetBlockIds, sourceBlockId],
        activeBlockId: sourceBlockId,
        blockTabTitles: targetNode.data?.blockTabTitles,
    };
    sourceNode.data = normalizeInlineTabData(sourceNode.data);
}

export function reorderInlineTabNodeBlockIds(node: LayoutNode, blockId: string, targetIndex: number): boolean {
    const blockIds = getLayoutDataBlockIds(node.data);
    const sourceIndex = blockIds.indexOf(blockId);
    if (sourceIndex === -1 || sourceIndex === targetIndex || targetIndex < 0 || targetIndex >= blockIds.length) {
        return false;
    }
    const nextBlockIds = [...blockIds];
    nextBlockIds.splice(sourceIndex, 1);
    nextBlockIds.splice(targetIndex, 0, blockId);
    setInlineTabNodeBlockIds(node, nextBlockIds);
    return true;
}

export function moveBlockBetweenInlineTabNodes(
    sourceNode: LayoutNode,
    targetNode: LayoutNode,
    blockId: string
): boolean {
    if (
        sourceNode.id === targetNode.id ||
        !layoutDataContainsBlockId(sourceNode.data, blockId) ||
        layoutDataContainsBlockId(targetNode.data, blockId)
    ) {
        return false;
    }
    const customTitle = sourceNode.data?.blockTabTitles?.[blockId];
    removeBlockIdFromInlineTabNode(sourceNode, blockId);
    const targetBlockIds = getLayoutDataBlockIds(targetNode.data);
    const nextTitles = { ...(targetNode.data?.blockTabTitles ?? {}) };
    if (customTitle) {
        nextTitles[blockId] = customTitle;
    }
    targetNode.data = {
        blockIds: [...targetBlockIds, blockId],
        activeBlockId: blockId,
        blockTabTitles: Object.keys(nextTitles).length > 0 ? nextTitles : undefined,
    };
    return true;
}

export function removeBlockIdFromInlineTabNode(node: LayoutNode, blockId: string): TabLayoutData {
    const currentBlockIds = getLayoutDataBlockIds(node.data);
    const nextBlockIds = currentBlockIds.filter((id) => id !== blockId);
    const nextTitles = { ...(node.data?.blockTabTitles ?? {}) };
    delete nextTitles[blockId];
    const removedIndex = currentBlockIds.indexOf(blockId);
    const nextActiveBlockId =
        node.data?.activeBlockId === blockId
            ? nextBlockIds[Math.min(removedIndex, nextBlockIds.length - 1)]
            : node.data?.activeBlockId;
    return setInlineTabNodeBlockIds(node, nextBlockIds, nextTitles, nextActiveBlockId);
}

export function setInlineTabNodeBlockIds(
    node: LayoutNode,
    nextBlockIds: string[],
    nextTitles: Record<string, string> = node.data?.blockTabTitles ?? {},
    nextActiveBlockId: string = node.data?.activeBlockId
): TabLayoutData {
    if (nextBlockIds.length <= 1) {
        node.data = { blockId: nextBlockIds[0] };
        return node.data;
    }
    const filteredTitles = Object.fromEntries(
        Object.entries(nextTitles).filter(([blockId]) => nextBlockIds.includes(blockId))
    );
    node.data = {
        blockIds: nextBlockIds,
        activeBlockId:
            nextActiveBlockId && nextBlockIds.includes(nextActiveBlockId) ? nextActiveBlockId : nextBlockIds[0],
        blockTabTitles: Object.keys(filteredTitles).length > 0 ? filteredTitles : undefined,
    };
    return node.data;
}
