// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { buildVisibleRows, mergeFetchedTreeChildren, TreeNodeData } from "@/app/treeview/treeview";
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
});
