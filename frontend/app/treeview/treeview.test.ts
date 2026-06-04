// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import {
    buildVisibleRows,
    collapseTreeExpandedIds,
    getExpandableDirectoryChildIds,
    getTreeRevealAncestorIds,
    mergeFetchedTreeChildren,
    TreeNodeData,
} from "@/app/treeview/treeview";
import { describe, expect, it } from "vitest";

function makeNodes(entries: TreeNodeData[]): Map<string, TreeNodeData> {
    return new Map(entries.map((entry) => [entry.id, entry]));
}

describe("treeview visible rows", () => {
    it("sorts directories before files and alphabetically", () => {
        const nodes = makeNodes([
            {
                id: "root",
                isDirectory: true,
                childrenStatus: "loaded",
                childrenIds: ["c", "a", "b"],
            },
            { id: "a", parentId: "root", isDirectory: false, label: "z-last.txt" },
            { id: "b", parentId: "root", isDirectory: true, label: "docs", childrenStatus: "loaded", childrenIds: [] },
            { id: "c", parentId: "root", isDirectory: false, label: "a-first.txt" },
        ]);
        const rows = buildVisibleRows(nodes, ["root"], new Set(["root"]));
        expect(rows.map((row) => row.id)).toEqual(["root", "b", "c", "a"]);
    });

    it("sorts directory labels naturally", () => {
        const nodes = makeNodes([
            {
                id: "root",
                isDirectory: true,
                childrenStatus: "loaded",
                childrenIds: ["s26", "s3", "s1"],
            },
            { id: "s26", parentId: "root", isDirectory: true, label: "S26", childrenStatus: "loaded" },
            { id: "s3", parentId: "root", isDirectory: true, label: "S3", childrenStatus: "loaded" },
            { id: "s1", parentId: "root", isDirectory: true, label: "S1", childrenStatus: "loaded" },
        ]);
        const rows = buildVisibleRows(nodes, ["root"], new Set(["root"]));
        expect(rows.map((row) => row.label)).toEqual(["root", "S1", "S3", "S26"]);
    });

    it("renders loading and capped synthetic rows", () => {
        const nodes = makeNodes([
            { id: "root", isDirectory: true, childrenStatus: "loading" },
            {
                id: "dir",
                isDirectory: true,
                childrenStatus: "capped",
                childrenIds: ["f1"],
                capInfo: { max: 1 },
            },
            { id: "f1", parentId: "dir", isDirectory: false, label: "one.txt" },
        ]);
        const loadingRows = buildVisibleRows(nodes, ["root"], new Set(["root"]));
        expect(loadingRows.map((row) => row.kind)).toEqual(["node", "loading"]);

        const cappedRows = buildVisibleRows(nodes, ["dir"], new Set(["dir"]));
        expect(cappedRows.map((row) => row.kind)).toEqual(["node", "node", "capped"]);
    });

    it("refreshes directory children while preserving loaded descendant state", () => {
        const nodes = makeNodes([
            {
                id: "root",
                isDirectory: true,
                childrenStatus: "loaded",
                childrenIds: ["dir", "gone"],
            },
            {
                id: "dir",
                parentId: "root",
                isDirectory: true,
                label: "dir",
                childrenStatus: "loaded",
                childrenIds: ["nested"],
            },
            { id: "nested", parentId: "dir", isDirectory: false, label: "nested.txt" },
            { id: "gone", parentId: "root", isDirectory: false, label: "gone.txt" },
        ]);

        const next = mergeFetchedTreeChildren(
            nodes,
            "root",
            {
                nodes: [
                    { id: "dir", parentId: "root", isDirectory: true, label: "dir" },
                    { id: "added", parentId: "root", isDirectory: false, label: "added.txt" },
                ],
            },
            500
        );

        expect(next.get("root")?.childrenIds).toEqual(["dir", "added"]);
        expect(next.get("dir")?.childrenStatus).toBe("loaded");
        expect(next.get("dir")?.childrenIds).toEqual(["nested"]);
        expect(next.has("nested")).toBe(true);
        expect(next.has("gone")).toBe(false);
    });

    it("collapses all expanded ids except tree roots", () => {
        const expandedIds = new Set(["root", "src", "src/components", "docs"]);
        const next = collapseTreeExpandedIds(expandedIds, ["root"]);

        expect(Array.from(next)).toEqual(["root"]);
        expect(collapseTreeExpandedIds(next, ["root"])).toBe(next);
        expect(Array.from(collapseTreeExpandedIds(new Set(["src"]), ["root"]))).toEqual(["root"]);
    });

    it("returns only expandable directory children in tree sort order", () => {
        const nodes = makeNodes([
            {
                id: "root",
                isDirectory: true,
                childrenStatus: "loaded",
                childrenIds: ["file", "bad", "z", "a", "missing"],
            },
            { id: "file", parentId: "root", isDirectory: false, label: "file.txt" },
            { id: "bad", parentId: "root", isDirectory: true, label: "bad", staterror: "denied" },
            { id: "z", parentId: "root", isDirectory: true, label: "Zed", childrenStatus: "loaded" },
            { id: "a", parentId: "root", isDirectory: true, label: "Alpha", childrenStatus: "loaded" },
            { id: "missing", parentId: "root", isDirectory: true, label: "Missing", notfound: true },
        ]);

        expect(getExpandableDirectoryChildIds(nodes, "root")).toEqual(["a", "z"]);
    });

    it("builds ancestor ids needed to reveal POSIX and Windows paths", () => {
        expect(getTreeRevealAncestorIds("/tmp/project/src/index.ts", ["/tmp/project"])).toEqual([
            "/tmp/project",
            "/tmp/project/src",
        ]);
        expect(getTreeRevealAncestorIds("E:/code/tpot/tpot/__init__.py", ["E:/code/tpot"])).toEqual([
            "E:/code/tpot",
            "E:/code/tpot/tpot",
        ]);
        expect(getTreeRevealAncestorIds("E:/code/tpot/tpot/__init__.py", ["E:/"])).toEqual([
            "E:/",
            "E:/code",
            "E:/code/tpot",
            "E:/code/tpot/tpot",
        ]);
        expect(getTreeRevealAncestorIds("/other/index.ts", ["/tmp/project"])).toEqual([]);
    });
});
