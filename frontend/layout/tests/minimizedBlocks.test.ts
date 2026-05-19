// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    getMinimizedBlockIdsFromTab,
    MinimizedBlocksMetaKey,
    normalizeMinimizedBlockIds,
} from "../lib/minimizedBlocks";

function makeTab(blockids: string[], minimized: unknown): Tab {
    return {
        otype: "tab",
        oid: "tab-1",
        version: 1,
        name: "Tab",
        layoutstate: "layout-1",
        blockids,
        meta: {
            [MinimizedBlocksMetaKey]: minimized,
        } as unknown as MetaType,
    };
}

describe("minimized block metadata", () => {
    it("normalizes persisted minimized block ids", () => {
        expect(normalizeMinimizedBlockIds(["b1", "", "b2", "b1", 4, null])).toEqual(["b1", "b2"]);
    });

    it("keeps only blocks that still belong to the tab", () => {
        const tab = makeTab(["b1", "b3"], ["b1", "b2", "b3"]);

        expect(getMinimizedBlockIdsFromTab(tab)).toEqual(["b1", "b3"]);
    });
});
