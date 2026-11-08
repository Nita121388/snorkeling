import { describe, expect, it, vi } from "vitest";

import { planBlockRemoval } from "./block-removal";

describe("planBlockRemoval", () => {
    it("uses uxCloseBlock for static tab blocks", () => {
        expect(planBlockRemoval({ tabId: "static", blockId: "b1", staticTabId: "static", hasNode: true, hasOnNodeDelete: true })).toEqual({
            kind: "ux-close-block",
            blockId: "b1",
        });
    });

    it("uses layout closeBlock when a node exists so inline-tab groups remove only the target block", () => {
        expect(planBlockRemoval({ tabId: "tab-1", blockId: "b2", staticTabId: "static", hasNode: true, hasOnNodeDelete: true })).toEqual({
            kind: "layout-close-block",
            tabId: "tab-1",
            blockId: "b2",
        });
    });

    it("deletes the block object directly when the layout node is missing", () => {
        expect(planBlockRemoval({ tabId: "tab-1", blockId: "b3", staticTabId: "static", hasNode: false, hasOnNodeDelete: false })).toEqual({
            kind: "delete-block",
            blockId: "b3",
        });
    });

    it("prefers layout closeBlock over direct delete when the node exists even without onNodeDelete", () => {
        expect(planBlockRemoval({ tabId: "tab-1", blockId: "b4", staticTabId: "static", hasNode: true, hasOnNodeDelete: false })).toEqual({
            kind: "layout-close-block",
            tabId: "tab-1",
            blockId: "b4",
        });
    });
});
