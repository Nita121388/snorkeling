// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atoms, getBlockComponentModel, globalStore, refocusNode, WOS } from "@/app/store/global";
import { ObjectService } from "@/app/store/services";
import { getLayoutModelForStaticTab, LayoutTreeActionType, newLayoutNode, removeHiddenBlockId } from "@/layout/index";
import type { LayoutTreeInsertNodeAction, LayoutTreeSplitHorizontalAction } from "@/layout/lib/types";
import { isBlank } from "@/util/util";
import { atom, type Atom } from "jotai";

export const SnorkelingBlockKindMetaKey = "snorkeling:block-kind";
export const SnorkelingBlockKindOverview = "overview";
export const SnorkelingBlockKindNote = "note";

type ToggleCurrentTabBlockOptions = {
    kind: string;
    blockDef: BlockDef;
    magnified?: boolean;
    hideInsteadOfClose?: boolean;
};

type FixedLeftBlockEntry = {
    blockId: string;
    kind: string | null;
};

type FixedLeftBlockInsertionAnchor = {
    blockId: string;
    position: "before" | "after";
};

const DefaultRuntimeOpts: RuntimeOpts = { termsize: { rows: 25, cols: 80 } };
const FixedLeftBlockKindOrder: Record<string, number> = {
    [SnorkelingBlockKindOverview]: 0,
    [SnorkelingBlockKindNote]: 1,
};

function fixedLeftBlockOrder(kind: string | null | undefined): number | null {
    if (kind == null) {
        return null;
    }
    return FixedLeftBlockKindOrder[kind] ?? null;
}

function getCurrentTab(): Tab | null {
    const tabId = globalStore.get(atoms.staticTabId);
    if (isBlank(tabId)) {
        return null;
    }
    return globalStore.get(WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", tabId)));
}

function getBlock(blockId: string): Block | null {
    if (isBlank(blockId)) {
        return null;
    }
    return globalStore.get(WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", blockId)));
}

function findCurrentTabBlockByKind(kind: string): string | null {
    const tab = getCurrentTab();
    for (const blockId of tab?.blockids ?? []) {
        const block = getBlock(blockId);
        if (block?.meta?.[SnorkelingBlockKindMetaKey] === kind) {
            return blockId;
        }
    }
    return null;
}

export function makeCurrentTabBlockKindOpenAtom(kind: string): Atom<boolean> {
    return atom((get) => {
        const tabId = get(atoms.staticTabId);
        if (isBlank(tabId)) {
            return false;
        }
        const tab = get(WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", tabId)));
        for (const blockId of tab?.blockids ?? []) {
            const block = get(WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", blockId)));
            if (block?.meta?.[SnorkelingBlockKindMetaKey] === kind) {
                return true;
            }
        }
        return false;
    });
}

async function closeCurrentTabBlock(blockId: string): Promise<boolean> {
    const viewModel = getBlockComponentModel(blockId)?.viewModel;
    if (viewModel?.viewType === "preview" && viewModel.confirmClose && !(await viewModel.confirmClose())) {
        return false;
    }
    const layoutModel = getLayoutModelForStaticTab();
    const node = layoutModel?.getNodeByBlockId(blockId);
    if (node != null) {
        const tab = getCurrentTab();
        if (tab?.oid) {
            removeHiddenBlockId(tab.oid, blockId);
        }
        await layoutModel.closeNode(node.id);
        if (layoutModel.onNodeDelete == null) {
            await ObjectService.DeleteBlock(blockId);
        }
        return true;
    }
    await ObjectService.DeleteBlock(blockId);
    return true;
}

export function resolveFixedLeftBlockInsertionAnchor(
    kind: string,
    orderedBlocks: FixedLeftBlockEntry[]
): FixedLeftBlockInsertionAnchor | null {
    const order = fixedLeftBlockOrder(kind);
    if (order == null || orderedBlocks.length === 0) {
        return null;
    }

    const firstNonFixedIndex = orderedBlocks.findIndex((block) => fixedLeftBlockOrder(block.kind) == null);
    const fixedGroup = firstNonFixedIndex === -1 ? orderedBlocks : orderedBlocks.slice(0, firstNonFixedIndex);
    let previousFixedBlock: FixedLeftBlockInsertionAnchor | null = null;
    for (const block of fixedGroup) {
        const blockOrder = fixedLeftBlockOrder(block.kind);
        if (blockOrder == null) {
            continue;
        }
        if (blockOrder > order) {
            return { blockId: block.blockId, position: "before" };
        }
        if (blockOrder < order) {
            previousFixedBlock = { blockId: block.blockId, position: "after" };
        }
    }

    return previousFixedBlock ?? { blockId: orderedBlocks[0].blockId, position: "before" };
}

function getBlockKind(blockId: string): string | null {
    const kind = getBlock(blockId)?.meta?.[SnorkelingBlockKindMetaKey];
    return typeof kind === "string" ? kind : null;
}

function getOrderedLayoutBlocks(
    layoutModel: NonNullable<ReturnType<typeof getLayoutModelForStaticTab>>
): FixedLeftBlockEntry[] {
    return (layoutModel.getter(layoutModel.leafOrder) ?? [])
        .map((leaf) => leaf.blockid)
        .filter((blockId): blockId is string => !isBlank(blockId))
        .map((blockId) => ({
            blockId,
            kind: getBlockKind(blockId),
        }));
}

function insertBlockAtDefaultLeft(
    layoutModel: NonNullable<ReturnType<typeof getLayoutModelForStaticTab>>,
    newNode: ReturnType<typeof newLayoutNode>,
    magnified: boolean
): void {
    const firstBlockId = layoutModel?.getFirstBlockId();
    const firstNode = firstBlockId == null ? null : layoutModel.getNodeByBlockId(firstBlockId);
    if (firstNode == null) {
        const insertAction: LayoutTreeInsertNodeAction = {
            type: LayoutTreeActionType.InsertNode,
            node: newNode,
            magnified,
            focused: true,
        };
        layoutModel.treeReducer(insertAction);
        return;
    }

    const splitAction: LayoutTreeSplitHorizontalAction = {
        type: LayoutTreeActionType.SplitHorizontal,
        targetNodeId: firstNode.id,
        newNode,
        position: "before",
        focused: true,
    };
    layoutModel.treeReducer(splitAction);
}

function insertBlockAtFixedLeftOrder(kind: string, blockId: string, magnified: boolean): void {
    const layoutModel = getLayoutModelForStaticTab();
    if (layoutModel == null) {
        return;
    }
    const newNode = newLayoutNode(undefined, undefined, undefined, { blockId });

    const anchor = resolveFixedLeftBlockInsertionAnchor(kind, getOrderedLayoutBlocks(layoutModel));
    const anchorNode = anchor == null ? null : layoutModel.getNodeByBlockId(anchor.blockId);
    if (anchorNode == null) {
        insertBlockAtDefaultLeft(layoutModel, newNode, magnified);
    } else {
        const splitAction: LayoutTreeSplitHorizontalAction = {
            type: LayoutTreeActionType.SplitHorizontal,
            targetNodeId: anchorNode.id,
            newNode,
            position: anchor.position,
            focused: true,
        };
        layoutModel.treeReducer(splitAction);
    }
    window.setTimeout(() => refocusNode(blockId), 80);
    window.setTimeout(() => refocusNode(blockId), 220);
}

export async function toggleCurrentTabBlockByKind({
    kind,
    blockDef,
    magnified = false,
    hideInsteadOfClose = false,
}: ToggleCurrentTabBlockOptions): Promise<string | null> {
    if (getCurrentTab() == null) {
        return null;
    }
    const existingBlockId = findCurrentTabBlockByKind(kind);
    if (existingBlockId != null) {
        if (hideInsteadOfClose) {
            const layoutModel = getLayoutModelForStaticTab();
            const existingNode = layoutModel?.getNodeByBlockId(existingBlockId);
            if (layoutModel != null && existingNode != null) {
                if (layoutModel.isBlockHidden(existingBlockId)) {
                    layoutModel.showBlock(existingBlockId);
                    window.setTimeout(() => refocusNode(existingBlockId), 80);
                    window.setTimeout(() => refocusNode(existingBlockId), 220);
                    return existingBlockId;
                }
                layoutModel.hideBlock(existingBlockId);
                return null;
            }
        }
        const didClose = await closeCurrentTabBlock(existingBlockId);
        return didClose ? null : existingBlockId;
    }
    const meta = {
        ...(blockDef.meta ?? {}),
        [SnorkelingBlockKindMetaKey]: kind,
    } as MetaType;
    const blockId = await ObjectService.CreateBlock({ ...blockDef, meta }, DefaultRuntimeOpts);
    insertBlockAtFixedLeftOrder(kind, blockId, magnified);
    return blockId;
}

export function isCurrentTabBlockKindOpen(kind: string): boolean {
    return findCurrentTabBlockByKind(kind) != null;
}
