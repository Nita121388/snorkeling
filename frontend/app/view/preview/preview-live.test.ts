// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { PreviewLiveSourceBlockMetaKey, resolveLivePreviewBlockIdForSource } from "@/app/view/preview/preview-live";
import { describe, expect, it } from "vitest";

function makeBlock(meta: Record<string, unknown>): Block {
    return { meta } as Block;
}

describe("resolveLivePreviewBlockIdForSource", () => {
    it("keeps the cached live preview block when it is open and linked to the source", () => {
        const blocks: Record<string, Block> = {
            source: makeBlock({ view: "preview", edit: true }),
            live: makeBlock({ view: "preview", [PreviewLiveSourceBlockMetaKey]: "source" }),
        };

        expect(
            resolveLivePreviewBlockIdForSource("source", ["source", "live"], (blockId) => blocks[blockId], "live")
        ).toBe("live");
    });

    it("returns null when the cached live preview block is no longer open", () => {
        const blocks: Record<string, Block> = {
            source: makeBlock({ view: "preview", edit: true }),
            live: makeBlock({ view: "preview", [PreviewLiveSourceBlockMetaKey]: "source" }),
        };

        expect(resolveLivePreviewBlockIdForSource("source", ["source"], (blockId) => blocks[blockId], "live")).toBe(
            null
        );
    });

    it("finds another open live preview block when the cached id is stale", () => {
        const blocks: Record<string, Block> = {
            source: makeBlock({ view: "preview", edit: true }),
            stale: makeBlock({ view: "preview", [PreviewLiveSourceBlockMetaKey]: "other-source" }),
            live: makeBlock({ view: "preview", [PreviewLiveSourceBlockMetaKey]: "source" }),
        };

        expect(
            resolveLivePreviewBlockIdForSource(
                "source",
                ["source", "stale", "live"],
                (blockId) => blocks[blockId],
                "stale"
            )
        ).toBe("live");
    });

    it("ignores preview blocks linked to a different source", () => {
        const blocks: Record<string, Block> = {
            source: makeBlock({ view: "preview", edit: true }),
            other: makeBlock({ view: "preview", [PreviewLiveSourceBlockMetaKey]: "other-source" }),
        };

        expect(
            resolveLivePreviewBlockIdForSource("source", ["source", "other"], (blockId) => blocks[blockId], "other")
        ).toBe(null);
    });
});
