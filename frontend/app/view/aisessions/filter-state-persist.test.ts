// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it } from "vitest";
import { DefaultFilterPresetFilter, filterPresetFilterEqual, type FilterPresetFilter } from "./filter-presets";
import {
    buildFilterStateMeta,
    clearFilterStateCache,
    filterStateEqual,
    parseFilterStateMeta,
    recallFilterState,
    rememberFilterState,
    resolveRestoredPresetId,
} from "./filter-state-persist";

const SampleFilter: FilterPresetFilter = {
    source: "claude",
    markedFilter: "starred",
    dateRange: { preset: "custom", from: 100, to: 200 },
    attachMode: "children",
    tagPresence: "any",
    tagFilters: ["bug", "perf"],
    excludeTags: ["wip"],
    pathSelections: ["E:\\code\\snorkeling"],
    pathExcludes: ["E:\\code\\snorkeling\\node_modules"],
};

describe("parseFilterStateMeta", () => {
    it("returns null for missing / empty / broken payloads", () => {
        expect(parseFilterStateMeta(undefined)).toBeNull();
        expect(parseFilterStateMeta(null)).toBeNull();
        expect(parseFilterStateMeta("")).toBeNull();
        expect(parseFilterStateMeta("{not json")).toBeNull();
        expect(parseFilterStateMeta("[]")).toBeNull();
        expect(parseFilterStateMeta(42)).toBeNull();
    });

    it("roundtrips a snapshot written by buildFilterStateMeta", () => {
        const payload = buildFilterStateMeta({ filter: SampleFilter, activePresetId: "preset-1" });
        const parsed = parseFilterStateMeta(payload);
        expect(parsed).not.toBeNull();
        expect(parsed.activePresetId).toBe("preset-1");
        expect(filterPresetFilterEqual(parsed.filter, SampleFilter)).toBe(true);
    });

    it("accepts an already-parsed object (meta value not stringified)", () => {
        const parsed = parseFilterStateMeta({ activePresetId: "abc", filter: SampleFilter });
        expect(parsed.activePresetId).toBe("abc");
        expect(parsed.filter.source).toBe("claude");
    });

    it("degrades invalid fields item by item instead of throwing", () => {
        const parsed = parseFilterStateMeta({
            activePresetId: 12,
            filter: {
                source: "not-a-source",
                markedFilter: 1,
                dateRange: { preset: "yesterday", from: "x" },
                attachMode: null,
                tagPresence: "weird",
                tagFilters: "not-an-array",
                excludeTags: [null, " ok "],
                pathSelections: {},
                pathExcludes: ["E:\\code\\snorkeling"],
            },
        });
        expect(parsed).not.toBeNull();
        expect(parsed.activePresetId).toBe("");
        expect(parsed.filter.source).toBe(DefaultFilterPresetFilter.source);
        expect(parsed.filter.markedFilter).toBe(DefaultFilterPresetFilter.markedFilter);
        expect(parsed.filter.dateRange.preset).toBe("all");
        expect(parsed.filter.attachMode).toBe(DefaultFilterPresetFilter.attachMode);
        expect(parsed.filter.tagPresence).toBe(DefaultFilterPresetFilter.tagPresence);
        expect(parsed.filter.tagFilters).toEqual([]);
        expect(parsed.filter.pathSelections).toEqual([]);
        expect(parsed.filter.pathExcludes.length).toBe(1);
    });

    it("treats a missing filter object as defaults", () => {
        const parsed = parseFilterStateMeta({ activePresetId: "p" });
        expect(filterPresetFilterEqual(parsed.filter, DefaultFilterPresetFilter)).toBe(true);
    });
});

describe("filterStateEqual", () => {
    it("compares filter fields order-insensitively and checks the preset id", () => {
        const a = { filter: SampleFilter, activePresetId: "p1" };
        const b = {
            filter: { ...SampleFilter, tagFilters: ["perf", "bug"], excludeTags: ["wip"] },
            activePresetId: "p1",
        };
        expect(filterStateEqual(a, b)).toBe(true);
        expect(filterStateEqual(a, { ...b, activePresetId: "p2" })).toBe(false);
        expect(filterStateEqual(null, null)).toBe(true);
        expect(filterStateEqual(a, null)).toBe(false);
    });
});

describe("resolveRestoredPresetId", () => {
    it("keeps known ids and drops deleted ones", () => {
        expect(resolveRestoredPresetId("", ["a"])).toBe("");
        expect(resolveRestoredPresetId("a", ["a", "b"])).toBe("a");
        expect(resolveRestoredPresetId("gone", ["a", "b"])).toBe("");
    });
});

describe("filterStateCache", () => {
    beforeEach(() => {
        clearFilterStateCache();
    });

    it("remembers per block and returns defensive copies", () => {
        rememberFilterState("block-1", { filter: SampleFilter, activePresetId: "p1" });
        const first = recallFilterState("block-1");
        expect(first.activePresetId).toBe("p1");
        first.filter.tagFilters.push("mutated");
        const second = recallFilterState("block-1");
        expect(second.filter.tagFilters).not.toContain("mutated");
        expect(recallFilterState("block-2")).toBeNull();
    });

    it("ignores empty block ids and keeps the newest value", () => {
        rememberFilterState("", { filter: SampleFilter, activePresetId: "p1" });
        expect(recallFilterState("")).toBeNull();
        rememberFilterState("b", { filter: SampleFilter, activePresetId: "old" });
        rememberFilterState("b", { filter: DefaultFilterPresetFilter, activePresetId: "new" });
        expect(recallFilterState("b").activePresetId).toBe("new");
    });
});
