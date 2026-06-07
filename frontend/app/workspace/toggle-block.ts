// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atoms, globalStore, refocusNode, WOS } from "@/app/store/global";
import { ObjectService } from "@/app/store/services";
import { getLayoutModelForStaticTab, LayoutTreeActionType, newLayoutNode } from "@/layout/index";
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
};

const DefaultRuntimeOpts: RuntimeOpts = { termsize: { rows: 25, cols: 80 } };

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

async function closeCurrentTabBlock(blockId: string): Promise<void> {
    const layoutModel = getLayoutModelForStaticTab();
    const node = layoutModel?.getNodeByBlockId(blockId);
    if (node != null) {
        await layoutModel.closeNode(node.id);
        if (layoutModel.onNodeDelete == null) {
            await ObjectService.DeleteBlock(blockId);
        }
        return;
    }
    await ObjectService.DeleteBlock(blockId);
}

function insertBlockAtLeft(blockId: string, magnified: boolean): void {
    const layoutModel = getLayoutModelForStaticTab();
    if (layoutModel == null) {
        return;
    }
    const newNode = newLayoutNode(undefined, undefined, undefined, { blockId });
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
    } else {
        const splitAction: LayoutTreeSplitHorizontalAction = {
            type: LayoutTreeActionType.SplitHorizontal,
            targetNodeId: firstNode.id,
            newNode,
            position: "before",
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
}: ToggleCurrentTabBlockOptions): Promise<string | null> {
    if (getCurrentTab() == null) {
        return null;
    }
    const existingBlockId = findCurrentTabBlockByKind(kind);
    if (existingBlockId != null) {
        await closeCurrentTabBlock(existingBlockId);
        return null;
    }
    const meta = {
        ...(blockDef.meta ?? {}),
        [SnorkelingBlockKindMetaKey]: kind,
    } as MetaType;
    const blockId = await ObjectService.CreateBlock({ ...blockDef, meta }, DefaultRuntimeOpts);
    insertBlockAtLeft(blockId, magnified);
    return blockId;
}

export function isCurrentTabBlockKindOpen(kind: string): boolean {
    return findCurrentTabBlockByKind(kind) != null;
}
