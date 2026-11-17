// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
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
});
