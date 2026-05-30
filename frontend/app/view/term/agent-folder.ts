// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { restoreMinimizedBlockToLayout } from "@/app/block/block-minimize";
import { atoms, createBlock, globalStore, refocusNode, WOS } from "@/app/store/global";
import { AISessionsServiceType } from "@/app/store/services";
import { getLayoutModelForStaticTab } from "@/layout/index";
import { isBlank } from "@/util/util";
import { dirname } from "../aisessions/utils";

type AgentFolderOpenParams = {
    blockId: string;
    block: Block | null;
    sessionId?: string;
};

type AgentFolderTarget = {
    path: string;
    connection: string | null;
};

function normalizePath(path: unknown): string {
    if (typeof path !== "string") return "";
    const trimmed = path.trim();
    if (trimmed === "/") return trimmed;
    return trimmed.replace(/\/+$/, "");
}

function normalizeConnection(connection: unknown): string {
    return typeof connection === "string" ? connection.trim() : "";
}

function sameConnection(left: unknown, right: unknown): boolean {
    return normalizeConnection(left) === normalizeConnection(right);
}

function samePath(left: unknown, right: unknown): boolean {
    return normalizePath(left) === normalizePath(right);
}

function getBlockFolderPath(block: Block | null): string {
    return normalizePath(block?.meta?.["cmd:cwd"]);
}

function getSessionId(block: Block | null, explicitSessionId: string | undefined): string {
    const explicit = normalizePath(explicitSessionId);
    if (!isBlank(explicit)) return explicit;
    return normalizePath(block?.meta?.["agent:sessionid"]);
}

async function resolveAgentFolderTarget(params: AgentFolderOpenParams): Promise<AgentFolderTarget | null> {
    const blockPath = getBlockFolderPath(params.block);
    if (!isBlank(blockPath)) {
        return {
            path: blockPath,
            connection: normalizeConnection(params.block?.meta?.connection) || null,
        };
    }

    const sessionId = getSessionId(params.block, params.sessionId);
    if (isBlank(sessionId)) return null;

    const service = new AISessionsServiceType();
    const summary = await service.Summary({ id: sessionId });
    const sessionPath = normalizePath(summary.projectPath) || dirname(summary.filePath ?? "");
    if (isBlank(sessionPath)) return null;
    return {
        path: sessionPath,
        connection: normalizeConnection(params.block?.meta?.connection) || null,
    };
}

async function focusOrCreateFilesBlock(target: AgentFolderTarget): Promise<void> {
    const tabId = globalStore.get(atoms.staticTabId);
    if (isBlank(tabId)) return;
    const tab = globalStore.get(WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", tabId)));
    for (const blockId of tab?.blockids ?? []) {
        const block = globalStore.get(WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", blockId)));
        if (
            block?.meta?.view === "preview" &&
            samePath(block.meta.file, target.path) &&
            sameConnection(block.meta.connection, target.connection)
        ) {
            const layoutModel = getLayoutModelForStaticTab();
            const node = layoutModel?.getNodeByBlockId(blockId);
            if (node?.id != null) {
                refocusNode(blockId);
                return;
            }
            if (restoreMinimizedBlockToLayout(tabId, blockId)) {
                window.setTimeout(() => refocusNode(blockId), 50);
                return;
            }
        }
    }

    const meta: MetaType = {
        view: "preview",
        file: target.path,
    };
    if (!isBlank(target.connection)) {
        meta.connection = target.connection;
    }
    await createBlock({ meta });
}

export function canOpenAgentFolder(block: Block | null, sessionId?: string): boolean {
    return !isBlank(getBlockFolderPath(block)) || !isBlank(getSessionId(block, sessionId));
}

export async function openAgentFolderInCurrentTab(params: AgentFolderOpenParams): Promise<void> {
    const target = await resolveAgentFolderTarget(params);
    if (target == null) {
        throw new Error("No agent folder is available for this block.");
    }
    await focusOrCreateFilesBlock(target);
}
