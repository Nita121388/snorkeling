// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    buildSessionTree,
    collectParentsOfMatches,
    countChildRows,
    countRootRows,
    countTreeRows,
    DefaultVisibleChildCount,
    hasHiddenChildren,
    hiddenChildCount,
    visibleChildren,
} from "./session-tree";

function session(overrides: Partial<SessionSummary> & { key: string }): SessionSummary {
    return {
        key: overrides.key,
        id: overrides.id ?? overrides.key,
        source: "pi",
        ...overrides,
    } as SessionSummary;
}

describe("buildSessionTree", () => {
    it("returns an empty list for empty input", () => {
        expect(buildSessionTree([])).toEqual([]);
    });

    it("keeps sessions without a parentKey as roots", () => {
        const root = session({ key: "a", kind: "session", updatedAt: 10 });
        const tree = buildSessionTree([root]);
        expect(tree).toHaveLength(1);
        expect(tree[0].session.key).toBe("a");
        expect(tree[0].depth).toBe(0);
        expect(tree[0].childCount).toBe(0);
    });

    it("nests children under their parent and marks depth/childCount", () => {
        const parent = session({ key: "p", kind: "session", updatedAt: 100 });
        const fork = session({ key: "f1", kind: "fork", parentKey: "p", updatedAt: 20 });
        const sub = session({ key: "s1", kind: "subagent", parentKey: "p", updatedAt: 30 });
        const tree = buildSessionTree([parent, fork, sub]);

        expect(tree).toHaveLength(1);
        expect(tree[0].childCount).toBe(2);
        // children sorted newest first
        expect(tree[0].children.map((child) => child.session.key)).toEqual(["s1", "f1"]);
        expect(tree[0].children.every((child) => child.depth === 1)).toBe(true);
    });

    it("promotes children whose parent is missing to root rows", () => {
        const orphan = session({ key: "c1", kind: "subagent", parentKey: "gone", updatedAt: 5 });
        const tree = buildSessionTree([orphan]);
        expect(tree).toHaveLength(1);
        expect(tree[0].session.key).toBe("c1");
        expect(tree[0].depth).toBe(0);
    });

    it("treats a self-referencing parentKey as a root (no infinite recursion)", () => {
        const selfRef = session({ key: "loop", kind: "subagent", parentKey: "loop" });
        const tree = buildSessionTree([selfRef]);
        expect(tree).toHaveLength(1);
        expect(tree[0].session.key).toBe("loop");
        expect(tree[0].children).toHaveLength(0);
    });

    it("treats an empty/whitespace parentKey as root", () => {
        const blank = session({ key: "b", parentKey: "   " });
        const tree = buildSessionTree([blank]);
        expect(tree).toHaveLength(1);
        expect(tree[0].depth).toBe(0);
    });

    it("sorts roots newest first and is stable on ties by key", () => {
        const older = session({ key: "old", kind: "session", updatedAt: 100 });
        const newer = session({ key: "new", kind: "session", updatedAt: 200 });
        const tieA = session({ key: "aaa", kind: "session", updatedAt: 150 });
        const tieB = session({ key: "bbb", kind: "session", updatedAt: 150 });
        const tree = buildSessionTree([older, newer, tieB, tieA]);
        expect(tree.map((node) => node.session.key)).toEqual(["new", "aaa", "bbb", "old"]);
    });

    it("falls back to createdAt when updatedAt is absent", () => {
        const byCreated = session({ key: "created", updatedAt: 0, createdAt: 999 });
        const byUpdated = session({ key: "updated", updatedAt: 500, createdAt: 1 });
        const tree = buildSessionTree([byCreated, byUpdated]);
        expect(tree[0].session.key).toBe("created");
    });

    it("marks matched rows and counts matched children when a filter is applied", () => {
        const parent = session({ key: "p", kind: "session" });
        const hitChild = session({ key: "c-hit", kind: "subagent", parentKey: "p" });
        const missChild = session({ key: "c-miss", kind: "subagent", parentKey: "p" });
        const tree = buildSessionTree([parent, hitChild, missChild], new Set(["c-hit"]));

        expect(tree[0].matched).toBe(false);
        expect(tree[0].matchedChildCount).toBe(1);
        expect(tree[0].childCount).toBe(2);
    });

    it("treats every row as matched when no filter set is given", () => {
        const parent = session({ key: "p", kind: "session" });
        const child = session({ key: "c", kind: "fork", parentKey: "p" });
        const tree = buildSessionTree([parent, child]);
        expect(tree[0].matched).toBe(true);
        expect(tree[0].matchedChildCount).toBe(1);
    });
});

describe("visibleChildren / hiddenChildCount", () => {
    const children = Array.from({ length: 25 }, (_, idx) =>
        session({ key: `c${String(idx).padStart(2, "0")}`, kind: "subagent", parentKey: "p", updatedAt: 1000 - idx })
    );
    const tree = buildSessionTree([session({ key: "p" }), ...children]);

    it("renders nothing while collapsed", () => {
        expect(visibleChildren(tree[0], false)).toEqual([]);
        expect(hasHiddenChildren(tree[0], false)).toBe(false);
        expect(hiddenChildCount(tree[0], false)).toBe(0);
    });

    it("caps an expanded parent at the default visible count", () => {
        expect(visibleChildren(tree[0], true)).toHaveLength(DefaultVisibleChildCount);
        expect(hasHiddenChildren(tree[0], true)).toBe(true);
        expect(hiddenChildCount(tree[0], true)).toBe(25 - DefaultVisibleChildCount);
    });

    it("shows all children once expanded fully", () => {
        expect(visibleChildren(tree[0], true, true)).toHaveLength(25);
        expect(hasHiddenChildren(tree[0], true, true)).toBe(false);
        expect(hiddenChildCount(tree[0], true, true)).toBe(0);
    });
});

describe("collectParentsOfMatches", () => {
    it("returns parents whose child matched", () => {
        const tree = buildSessionTree([
            session({ key: "p" }),
            session({ key: "c1", kind: "fork", parentKey: "p" }),
            session({ key: "c2", kind: "fork", parentKey: "p" }),
            session({ key: "q" }),
        ]);
        const parents = collectParentsOfMatches(tree, new Set(["c2"]));
        expect([...parents]).toEqual(["p"]);
    });

    it("returns nothing when no child matched", () => {
        const tree = buildSessionTree([session({ key: "p" }), session({ key: "c", parentKey: "p" })]);
        expect(collectParentsOfMatches(tree, new Set(["p"])).size).toBe(0);
    });
});

describe("tree counts", () => {
    it("counts roots, children and total rows", () => {
        const tree = buildSessionTree([
            session({ key: "p1" }),
            session({ key: "p1-c1", parentKey: "p1" }),
            session({ key: "p1-c2", parentKey: "p1" }),
            session({ key: "p2" }),
        ]);
        expect(countRootRows(tree)).toBe(2);
        expect(countChildRows(tree)).toBe(2);
        expect(countTreeRows(tree)).toBe(4);
    });

    it("returns zero for an empty tree", () => {
        expect(countRootRows([])).toBe(0);
        expect(countChildRows([])).toBe(0);
        expect(countTreeRows([])).toBe(0);
    });
});