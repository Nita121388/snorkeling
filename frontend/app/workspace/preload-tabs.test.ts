// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import * as preloadTabs from "./preload-tabs";
import { computeRenderPreloadTabIds, PreloadTabCap } from "./preload-tabs";

describe("computeRenderPreloadTabIds", () => {
    it("keeps the legacy shape when nothing is pending (active first, preload capped)", () => {
        expect(computeRenderPreloadTabIds("t1", ["t1", "t2", "t3", "t4"], [])).toEqual(["t1", "t2", "t3"]);
        expect(PreloadTabCap).toBe(3);
    });

    it("renders nothing when there is no active tab", () => {
        expect(computeRenderPreloadTabIds("", ["t2"], ["t9"])).toEqual([]);
    });

    it("never slices a pending tab away, even beyond the preload cap", () => {
        const rendered = computeRenderPreloadTabIds("t1", ["t1", "t2", "t3", "t4"], ["t9", "t10"]);
        expect(rendered).toEqual(["t1", "t2", "t3", "t9", "t10"]);
        expect(rendered.slice(0, PreloadTabCap)).not.toContain("t9");
    });

    it("dedupes a pending tab that is already preloaded or active", () => {
        expect(computeRenderPreloadTabIds("t1", ["t1", "t2"], ["t2", "t1", "t3"])).toEqual(["t1", "t2", "t3"]);
    });

    it("is stable when inputs contain empty ids", () => {
        expect(computeRenderPreloadTabIds("t1", ["", "t2"], ["", "t3"])).toEqual(["t1", "t2", "t3"]);
    });

    it("keeps order: active → preload → pending", () => {
        expect(computeRenderPreloadTabIds("tA", ["tB"], ["tC"])).toEqual(["tA", "tB", "tC"]);
    });

    it("handles a cap smaller than the preload list", () => {
        expect(computeRenderPreloadTabIds("t1", ["t1", "t2", "t3"], ["t4"], 1)).toEqual(["t1", "t4"]);
    });

    it("disables phantom hover tab preloading by default while preserving active and pending tabs", () => {
        const mod = preloadTabs as unknown as {
            HOVER_TAB_PRELOAD_ENABLED?: boolean;
            updateHoverPreloadTabIds?: (prev: readonly string[], hoveredTabId: string | null) => string[];
            updateActivePreloadTabIds?: (prev: readonly string[], activeTabId: string) => string[];
        };
        expect(mod.HOVER_TAB_PRELOAD_ENABLED).toBe(false);
        expect(typeof mod.updateHoverPreloadTabIds).toBe("function");
        expect(typeof mod.updateActivePreloadTabIds).toBe("function");

        const afterActive = mod.updateActivePreloadTabIds!(["old-1", "old-2"], "t1");
        expect(afterActive).toEqual(["t1"]);

        const afterHover = mod.updateHoverPreloadTabIds!(afterActive, "t2");
        expect(afterHover).toEqual(["t1"]);

        // Pending CommonText background mounts still pass through untouched.
        expect(computeRenderPreloadTabIds("t1", afterHover, ["t-pending"])).toEqual(["t1", "t-pending"]);
        expect(computeRenderPreloadTabIds("t1", afterHover, [])).toEqual(["t1"]);
    });
});
