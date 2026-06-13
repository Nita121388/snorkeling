// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { createBlock, createBlockSplitHorizontally } from "@/store/global";

export async function openAISessionDetailBlock(
    sessionId: string,
    sourceBlockId?: string,
    connection?: string
): Promise<void> {
    const trimmedSessionId = sessionId.trim();
    if (trimmedSessionId === "") {
        return;
    }
    const meta: MetaType & Record<string, unknown> = {
        view: "aisessions",
        "frame:title": "Session Details",
        "aisessions:sessionid": trimmedSessionId,
        "aisessions:sessionlistcollapsed": true,
        icon: "comments",
    };
    const blockDef: BlockDef = {
        meta,
    };
    const trimmedConnection = connection?.trim() ?? "";
    if (trimmedConnection !== "") {
        blockDef.meta.connection = trimmedConnection;
    }
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
