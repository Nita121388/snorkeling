// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { createBlock, createBlockSplitHorizontally } from "@/store/global";

export async function openAISessionDetailBlock(sessionId: string, sourceBlockId?: string): Promise<void> {
    const trimmedSessionId = sessionId.trim();
    if (trimmedSessionId === "") {
        return;
    }
    const blockDef: BlockDef = {
        meta: {
            view: "aisessions",
            "frame:title": "Session Details",
            "aisessions:sessionid": trimmedSessionId,
            "aisessions:sessionlistcollapsed": true,
            icon: "comments",
        },
    };
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
