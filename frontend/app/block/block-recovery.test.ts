// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    getInlineTabRuntimeOpts,
    getRemainingInlineTabBlockIds,
    isConfirmedMissingInlineTabBlock,
    shouldWarmupInlineTabController,
} from "./block-recovery";

describe("inline tab block recovery", () => {
    it("does not treat a still-loading block as missing", () => {
        expect(isConfirmedMissingInlineTabBlock(true, true)).toBe(false);
        expect(isConfirmedMissingInlineTabBlock(false, true)).toBe(true);
    });

    it("removes only the block confirmed missing", () => {
        expect(getRemainingInlineTabBlockIds(["loaded", "loading", "missing"], "missing")).toEqual([
            "loaded",
            "loading",
        ]);
    });

    it("warms only an inactive loaded terminal with a controller", () => {
        const base = {
            active: false,
            preview: false,
            blockIsLoading: false,
            blockExists: true,
            blockView: "term",
            controller: "shell",
        };
        expect(shouldWarmupInlineTabController(base)).toBe(true);
        expect(shouldWarmupInlineTabController({ ...base, active: true })).toBe(false);
        expect(shouldWarmupInlineTabController({ ...base, blockView: "preview" })).toBe(false);
        expect(shouldWarmupInlineTabController({ ...base, controller: "" })).toBe(false);
    });

    it("preserves a valid persisted terminal size and rejects invalid values", () => {
        expect(getInlineTabRuntimeOpts(42, 120)).toEqual({ termsize: { rows: 42, cols: 120 } });
        expect(getInlineTabRuntimeOpts(0, 120)).toBeUndefined();
        expect(getInlineTabRuntimeOpts(undefined, 120)).toBeUndefined();
    });
});
