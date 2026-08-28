// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    addTabToGroup,
    buildRenderSegments,
    buildTabGroups,
    createGroup,
    getGroupOfTab,
    removeTabFromGroup,
    setGroupColor,
    toggleGroupCollapsed,
    type TabGroup,
} from "./tabgroup";

const g = (over: Partial<TabGroup> & Pick<TabGroup, "id" | "tabIds">): TabGroup => ({
    name: over.name ?? "G",
    color: over.color ?? "#58C142",
    collapsed: over.collapsed ?? false,
    ...over,
});

describe("buildTabGroups", () => {
    it("returns [] for non-array input", () => {
        expect(buildTabGroups(null)).toEqual([]);
        expect(buildTabGroups(undefined)).toEqual([]);
        expect(buildTabGroups("nope")).toEqual([]);
    });

    it("drops malformed / empty / duplicate-id entries", () => {
        const raw = [
            { id: "a", tabIds: ["t1", "t2"] },
            null,
            { tabIds: ["t3"] }, // missing id
            { id: "a", tabIds: ["t4"] }, // duplicate id -> skipped
            { id: "b", tabIds: [] }, // empty -> skipped
            { id: "c", tabIds: ["t5", "t5", "t6"] }, // dup member ids collapsed
        ];
        const groups = buildTabGroups(raw);
        expect(groups.map((x) => x.id)).toEqual(["a", "c"]);
        expect(groups.find((x) => x.id === "c")!.tabIds).toEqual(["t5", "t6"]);
    });
});

describe("getGroupOfTab", () => {
    it("finds the owning group", () => {
        const groups = [g({ id: "a", tabIds: ["t1", "t2"] })];
        expect(getGroupOfTab(groups, "t2")?.id).toBe("a");
        expect(getGroupOfTab(groups, "zzz")).toBeNull();
    });
});

describe("buildRenderSegments", () => {
    it("passes through non-grouped tabs in order", () => {
        const segs = buildRenderSegments(["t1", "t2"], []);
        expect(segs).toEqual([
            { kind: "tab", tabId: "t1" },
            { kind: "tab", tabId: "t2" },
        ]);
    });

    it("collapses a group into a single anchor segment", () => {
        const groups = [g({ id: "a", tabIds: ["t2", "t3"], collapsed: true })];
        const segs = buildRenderSegments(["t1", "t2", "t3", "t4"], groups);
        expect(segs).toEqual([
            { kind: "tab", tabId: "t1" },
            { kind: "group", groupId: "a", expanded: false },
            { kind: "tab", tabId: "t4" },
        ]);
    });

    it("expands a group into anchor + member tabs at its anchor position", () => {
        const groups = [g({ id: "a", tabIds: ["t2", "t3"], collapsed: false })];
        const segs = buildRenderSegments(["t1", "t2", "t3", "t4"], groups);
        expect(segs).toEqual([
            { kind: "tab", tabId: "t1" },
            { kind: "group", groupId: "a", expanded: true },
            { kind: "tab", tabId: "t2" },
            { kind: "tab", tabId: "t3" },
            { kind: "tab", tabId: "t4" },
        ]);
    });

    it("renders each group only once even if its members scatter in tabids", () => {
        const groups = [g({ id: "a", tabIds: ["t1", "t9"] })];
        const segs = buildRenderSegments(["t1", "t2", "t9"], groups);
        expect(segs.filter((s) => s.kind === "group")).toHaveLength(1);
        // Members render in group.tabIds order at the group's anchor; the non-grouped t2 follows.
        expect(segs).toEqual([
            { kind: "group", groupId: "a", expanded: true },
            { kind: "tab", tabId: "t1" },
            { kind: "tab", tabId: "t9" },
            { kind: "tab", tabId: "t2" },
        ]);
    });
});

describe("immutable transforms", () => {
    it("addTabToGroup moves a tab out of its old group", () => {
        const groups = [g({ id: "a", tabIds: ["t1"] }), g({ id: "b", tabIds: ["t2"] })];
        const next = addTabToGroup(groups, "b", "t1");
        expect(getGroupOfTab(next, "t1")?.id).toBe("b");
        expect(next.find((x) => x.id === "a")).toBeUndefined(); // dropped empty
        expect(next.find((x) => x.id === "b")!.tabIds).toEqual(["t2", "t1"]);
    });

    it("removeTabFromGroup drops the now-empty group", () => {
        const groups = [g({ id: "a", tabIds: ["t1"] })];
        expect(removeTabFromGroup(groups, "t1")).toEqual([]);
    });

    it("toggleGroupCollapsed flips collapsed without mutating input", () => {
        const groups = [g({ id: "a", tabIds: ["t1"], collapsed: false })];
        const next = toggleGroupCollapsed(groups, "a");
        expect(groups[0].collapsed).toBe(false);
        expect(next[0].collapsed).toBe(true);
    });

    it("setGroupColor changes color only", () => {
        const groups = [g({ id: "a", tabIds: ["t1"], color: "#58C142" })];
        const next = setGroupColor(groups, "a", "#FF453A");
        expect(next[0].color).toBe("#FF453A");
        expect(next[0].tabIds).toEqual(["t1"]);
    });

    it("createGroup appends with generated id", () => {
        const { groups, groupId } = createGroup([], { id: "x", name: "New", tabIds: ["t1"] });
        expect(groupId).toBe("x");
        expect(groups).toHaveLength(1);
        expect(groups[0].collapsed).toBe(false);
    });
});
