// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { newLayoutNode } from "@/layout/lib/layoutNode";
import { getLayoutModelForStaticTab } from "@/layout/lib/layoutModelHooks";
import { LayoutTreeActionType, LayoutTreeSplitHorizontalAction } from "@/layout/lib/types";
import {
    atoms,
    createBlock,
    createBlockSplitHorizontally,
    globalStore,
    refocusNode,
    WOS,
} from "@/store/global";
import { ObjectService } from "@/store/services";

// 会话详情「分离到独立块」。
//
// 列表块只负责列表；点击某条会话时把详情拆到右边的新块。重复点击同一个
// 会话直接聚焦已有块（不重复开）；点另一个会话默认作为 Tab 并进已有详情块
// 的节点（省版面）；Ctrl/Cmd+点击则强制单开一个新块，便于左右对比。

export type SessionDetailOpenOptions = {
    connection?: string;
    cwd?: string;
    /** Ctrl/Cmd+点击：即使已有详情块也强制单开。 */
    forceNewBlock?: boolean;
};

export type SessionDetailOpenPlan =
    | { kind: "focus"; blockId: string }
    | { kind: "tab"; hostBlockId: string }
    | { kind: "split" };

/** 该 tab 里记住的「详情块宿主」，用于把后续详情并成 Tab。 */
const detailHostBlockByTab = new Map<string, string>();

function makeSessionDetailBlockDef(sessionId: string, connection?: string, cwd?: string): BlockDef {
    const meta: MetaType & Record<string, unknown> = {
        view: "aisessions",
        "frame:title": "Session Details",
        "aisessions:sessionid": sessionId,
        "aisessions:sessionlistcollapsed": true,
        icon: "comments",
    };
    const blockDef: BlockDef = { meta };
    const trimmedConnection = connection?.trim() ?? "";
    if (trimmedConnection !== "") {
        blockDef.meta.connection = trimmedConnection;
    }
    const trimmedCwd = cwd?.trim() ?? "";
    if (trimmedCwd !== "") {
        blockDef.meta["cmd:cwd"] = trimmedCwd;
    }
    return blockDef;
}

function staticTabId(): string | null {
    return globalStore.get(atoms.staticTabId) ?? null;
}

function getTabBlockIds(): string[] {
    const tabId = staticTabId();
    if (tabId == null) {
        return [];
    }
    const tab = globalStore.get(WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", tabId)));
    return tab?.blockids ?? [];
}

function readBlockMeta(blockId: string): MetaType | null {
    const block = globalStore.get(WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", blockId)));
    return block?.meta ?? null;
}

/** 是否是「单会话详情块」（有 aisessions:sessionid 的 aisessions 视图）。 */
export function isSessionDetailMeta(meta: MetaType | null | undefined): boolean {
    if (meta == null || meta["view"] !== "aisessions") {
        return false;
    }
    const sessionId = meta["aisessions:sessionid"];
    return typeof sessionId === "string" && sessionId.trim() !== "";
}

/**
 * 点击列表行时该做什么。纯函数，便于单测覆盖三条分支。
 *
 * - 同一个会话已经开着 → 聚焦它，避免重复块。
 * - 该 tab 已有详情块 → 新详情并成 Tab。
 * - 其余情况（含 Ctrl 强制单开）→ 横向拆分新块。
 */
export function planSessionDetailOpen(input: {
    sessionId: string;
    forceNewBlock: boolean;
    existingBlockId: string | null;
    hostBlockId: string | null;
}): SessionDetailOpenPlan {
    if (!input.forceNewBlock && input.existingBlockId != null) {
        return { kind: "focus", blockId: input.existingBlockId };
    }
    if (
        !input.forceNewBlock &&
        input.hostBlockId != null &&
        input.hostBlockId !== input.existingBlockId
    ) {
        return { kind: "tab", hostBlockId: input.hostBlockId };
    }
    return { kind: "split" };
}

/**
 * 从列表块打开会话详情。
 * 返回详情块 id；sessionId 为空时返回 null。
 */
export async function openAISessionDetailFromList(
    sessionId: string,
    sourceBlockId: string,
    options: SessionDetailOpenOptions = {}
): Promise<string | null> {
    const trimmedSessionId = sessionId.trim();
    if (trimmedSessionId === "") {
        return null;
    }
    const tabId = staticTabId();
    let existingBlockId: string | null = null;
    let hostBlockId: string | null = tabId != null ? (detailHostBlockByTab.get(tabId) ?? null) : null;
    for (const blockId of getTabBlockIds()) {
        const meta = readBlockMeta(blockId);
        if (!isSessionDetailMeta(meta)) {
            continue;
        }
        if (meta["aisessions:sessionid"] === trimmedSessionId) {
            existingBlockId = blockId;
        }
        if (hostBlockId == null) {
            hostBlockId = blockId;
        }
    }
    const layoutModel = getLayoutModelForStaticTab();
    // 宿主的 layout node 已不存在（块被关掉）就别再往它里面塞 Tab。
    if (hostBlockId != null && layoutModel.getNodeByBlockId(hostBlockId)?.id == null) {
        hostBlockId = null;
    }
    const plan = planSessionDetailOpen({
        sessionId: trimmedSessionId,
        forceNewBlock: options.forceNewBlock === true,
        existingBlockId,
        hostBlockId,
    });
    if (plan.kind === "focus") {
        refocusNode(plan.blockId);
        return plan.blockId;
    }
    const blockDef = makeSessionDetailBlockDef(trimmedSessionId, options.connection, options.cwd);
    if (plan.kind === "tab") {
        const hostNodeId = layoutModel.getNodeByBlockId(plan.hostBlockId)?.id;
        if (hostNodeId != null) {
            const rtOpts: RuntimeOpts = { termsize: { rows: 25, cols: 80 } };
            const newBlockId = await ObjectService.CreateBlock(blockDef, rtOpts);
            if (layoutModel.addBlockToInlineTab(hostNodeId, newBlockId)) {
                if (tabId != null) {
                    detailHostBlockByTab.set(tabId, plan.hostBlockId);
                }
                return newBlockId;
            }
            // 并 Tab 失败就退化成普通拆分，别把块丢了。
        }
    }
    const newBlockId = await splitDetailBlock(blockDef, sourceBlockId);
    if (tabId != null && newBlockId != null) {
        detailHostBlockByTab.set(tabId, newBlockId);
    }
    return newBlockId;
}

/** 横向拆分出一个详情块；源块不可用时退化为普通新建块。 */
async function splitDetailBlock(blockDef: BlockDef, sourceBlockId: string): Promise<string> {
    const layoutModel = getLayoutModelForStaticTab();
    const rtOpts: RuntimeOpts = { termsize: { rows: 25, cols: 80 } };
    const newBlockId = await ObjectService.CreateBlock(blockDef, rtOpts);
    const targetNodeId = layoutModel.getNodeByBlockId(sourceBlockId)?.id;
    if (targetNodeId == null) {
        return newBlockId;
    }
    const splitAction: LayoutTreeSplitHorizontalAction = {
        type: LayoutTreeActionType.SplitHorizontal,
        targetNodeId,
        newNode: newLayoutNode(undefined, undefined, undefined, { blockId: newBlockId }),
        position: "after",
        focused: true,
    };
    layoutModel.treeReducer(splitAction);
    return newBlockId;
}

/** 从一个纯列表块开一个「新会话」详情块（不带 sessionid，靠 newchat 标志自动起会话）。 */
export async function openAISessionNewChatFromList(sourceBlockId: string): Promise<string | null> {
    const meta: MetaType & Record<string, unknown> = {
        view: "aisessions",
        "frame:title": "New Session",
        "aisessions:newchat": true,
        "aisessions:sessionlistcollapsed": true,
        icon: "comments",
    };
    return splitDetailBlock({ meta }, sourceBlockId);
}

/** 从 term 里的 agent 会话打开详情块（保留原行为）。 */
export async function openAISessionDetailBlock(
    sessionId: string,
    sourceBlockId?: string,
    connection?: string,
    cwd?: string
): Promise<void> {
    const trimmedSessionId = sessionId.trim();
    if (trimmedSessionId === "") {
        return;
    }
    const blockDef = makeSessionDetailBlockDef(trimmedSessionId, connection, cwd);
    if (sourceBlockId) {
        try {
            await createBlockSplitHorizontally(blockDef, sourceBlockId, "after");
            return;
        } catch {
            // Some layouts cannot split from the source block; fall back to a regular block.
        }
    }
    await createBlock(blockDef);
}