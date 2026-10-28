// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import {
    DefaultFilterPresetFilter,
    FilterPresetsStorageKey,
    MaxFilterPresets,
    filterPresetFilterEqual,
    filterPresetIsDirty,
    filterPresetViewEqual,
    makeFilterPreset,
    readFilterPresets,
    sanitizeFilterPreset,
    sanitizeFilterPresetFilter,
    sanitizeFilterPresetList,
    writeFilterPresets,
} from "./filter-presets";

function preset(overrides: Record<string, unknown> = {}) {
    return {
        id: "p1",
        name: "Mine",
        createdAt: 1,
        updatedAt: 1,
        filter: { ...DefaultFilterPresetFilter },
        ...overrides,
    };
}

describe("sanitizeFilterPresetFilter", () => {
    it("fills defaults for missing/invalid fields", () => {
        const result = sanitizeFilterPresetFilter({ source: "bogus", markedFilter: 42, tagFilters: "x" });
        expect(result.source).toBe("");
        expect(result.markedFilter).toBe("all");
        expect(result.tagFilters).toEqual([]);
    });

    it("normalizes tags and paths", () => {
        const result = sanitizeFilterPresetFilter({
            tagFilters: ["#Foo", "foo", " BAR "],
            excludeTags: ["#baz"],
            pathSelections: ["E:\\proj\\", "E:\\proj"],
        });
        expect(result.tagFilters).toEqual(["foo", "bar"]);
        expect(result.excludeTags).toEqual(["baz"]);
        expect(result.pathSelections).toHaveLength(1);
    });

    it("keeps custom date range but drops junk numbers", () => {
        expect(sanitizeFilterPresetFilter({ dateRange: { preset: "custom", from: 10, to: "x" } }).dateRange).toEqual({
            preset: "custom",
            from: 10,
            to: 0,
        });
    });
});

describe("sanitizeFilterPreset", () => {
    it("rejects entries without id or name", () => {
        expect(sanitizeFilterPreset({ name: "x" })).toBeNull();
        expect(sanitizeFilterPreset({ id: "x", name: "   " })).toBeNull();
    });

    it("trims name and caps it", () => {
        const long = "x".repeat(100);
        expect(sanitizeFilterPreset({ id: "a", name: `  ${long}  ` })?.name.length).toBe(40);
    });

    it("keeps optional view", () => {
        const withView = sanitizeFilterPreset(preset({ view: { sortChain: [], groupMode: "time" } }));
        expect(withView?.view?.groupMode).toBe("time");
        expect(withView?.view?.sortChain.length).toBeGreaterThan(0);
        const noView = sanitizeFilterPreset(preset());
        expect(noView?.view).toBeUndefined();
    });
});

describe("sanitizeFilterPresetList", () => {
    it("drops invalid and duplicate ids", () => {
        const list = sanitizeFilterPresetList([
            preset({ id: "a" }),
            preset({ id: "a", name: "dup" }),
            preset({ id: "" }),
            null,
            preset({ id: "b" }),
        ]);
        expect(list.map((p) => p.id)).toEqual(["a", "b"]);
    });

    it("truncates to max", () => {
        const many = Array.from({ length: MaxFilterPresets + 5 }, (_, i) => preset({ id: `p${i}` }));
        expect(sanitizeFilterPresetList(many)).toHaveLength(MaxFilterPresets);
    });

    it("returns empty for non-array", () => {
        expect(sanitizeFilterPresetList({})).toEqual([]);
    });
});

describe("storage", () => {
    beforeEach(() => window.localStorage.clear());

    it("round-trips", () => {
        writeFilterPresets([makeFilterPreset("Saved", DefaultFilterPresetFilter)]);
        const read = readFilterPresets();
        expect(read).toHaveLength(1);
        expect(read[0].name).toBe("Saved");
    });

    it("returns empty for corrupt json", () => {
        window.localStorage.setItem(FilterPresetsStorageKey, "{not json");
        expect(readFilterPresets()).toEqual([]);
    });
});

describe("equality and dirty", () => {
    it("treats set order as irrelevant", () => {
        const a = { ...DefaultFilterPresetFilter, tagFilters: ["a", "b"], pathSelections: ["E:\\", "F:\\"] };
        const b = { ...DefaultFilterPresetFilter, tagFilters: ["b", "a"], pathSelections: ["f:/", "e:\\"] };
        expect(filterPresetFilterEqual(a, b)).toBe(true);
    });

    it("detects date range difference", () => {
        const a = { ...DefaultFilterPresetFilter, dateRange: { preset: "all" as const } };
        expect(filterPresetFilterEqual(a, DefaultFilterPresetFilter)).toBe(false);
    });

    it("view equal handles undefined", () => {
        expect(filterPresetViewEqual(undefined, undefined)).toBe(true);
        expect(filterPresetViewEqual(undefined, { sortChain: [], groupMode: "project" })).toBe(false);
    });

    it("reports dirty when filter or view changes", () => {
        const p = makeFilterPreset("p", DefaultFilterPresetFilter, {
            sortChain: [{ field: "time", desc: true }],
            groupMode: "project",
        });
        expect(filterPresetIsDirty(p, DefaultFilterPresetFilter, p.view)).toBe(false);
        expect(filterPresetIsDirty(p, { ...DefaultFilterPresetFilter, markedFilter: "starred" }, p.view)).toBe(true);
        expect(
            filterPresetIsDirty(p, DefaultFilterPresetFilter, { sortChain: p.view.sortChain, groupMode: "time" })
        ).toBe(true);
    });

    it("ignores view when preset has none", () => {
        const p = makeFilterPreset("p", DefaultFilterPresetFilter);
        expect(filterPresetIsDirty(p, DefaultFilterPresetFilter, { sortChain: [], groupMode: "time" })).toBe(false);
    });
});
