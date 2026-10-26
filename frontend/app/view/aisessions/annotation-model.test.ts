// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    anchorHash,
    annotationCountBySeq,
    annotationsForSeq,
    buildAnnotationAnchors,
    buildRailItems,
    clusterRailItems,
    type AnnotationLike,
} from "./annotation-model";

function annotation(overrides: Partial<AnnotationLike> & { id: number; seq: number }): AnnotationLike {
    return {
        sessionKey: "s1",
        anchorKey: `e${overrides.seq}:m0`,
        kind: "note",
        title: "",
        body: "",
        status: "accepted",
        source: "user",
        ...overrides,
    };
}

describe("annotation-model", () => {
    it("groups by node, drops nodes without annotations, keeps order", () => {
        const items = buildRailItems([
            annotation({ id: 2, seq: 5 }),
            annotation({ id: 1, seq: 2 }),
            annotation({ id: 3, seq: 5, status: "draft" }),
        ]);
        expect(items.map((item) => item.seq)).toEqual([2, 5]);
        expect(items[1].annotations).toHaveLength(2);
        expect(items[1].hasDraft).toBe(true);
        expect(items[1].hasAccepted).toBe(true);
    });

    it("merges multiple annotations on the same node", () => {
        const items = buildRailItems([annotation({ id: 1, seq: 2 }), annotation({ id: 2, seq: 2, orphaned: true })]);
        expect(items).toHaveLength(1);
        expect(items[0].hasOrphan).toBe(true);
    });

    it("clusters above the slot limit and keeps chronological order", () => {
        const items = buildRailItems(
            Array.from({ length: 100 }, (_, index) => annotation({ id: index + 1, seq: index + 1 }))
        );
        const clusters = clusterRailItems(items, 40);
        expect(clusters).toHaveLength(40);
        expect(clusters[0].items[0].seq).toBe(1);
        expect(clusters[clusters.length - 1].items.at(-1)!.seq).toBe(100);
        // Every item belongs to exactly one cluster.
        const flattened = clusters.flatMap((cluster) => cluster.items);
        expect(flattened).toHaveLength(100);
    });

    it("returns one cluster per item under the limit", () => {
        const items = buildRailItems([annotation({ id: 1, seq: 1 }), annotation({ id: 2, seq: 2 })]);
        const clusters = clusterRailItems(items, 40);
        expect(clusters).toHaveLength(2);
        expect(clusters[0].items).toHaveLength(1);
    });

    it("counts and looks up annotations per seq", () => {
        const list = [annotation({ id: 1, seq: 3 }), annotation({ id: 2, seq: 3 }), annotation({ id: 3, seq: 7 })];
        expect(annotationsForSeq(list, 3)).toHaveLength(2);
        const counts = annotationCountBySeq(list);
        expect(counts.get(3)).toBe(2);
        expect(counts.get(7)).toBe(1);
        expect(counts.get(4)).toBeUndefined();
    });

    it("anchorHash normalizes whitespace and is stable", () => {
        expect(anchorHash("hello   world\n\nsecond")).toBe(anchorHash("  hello world second "));
        expect(anchorHash("   ")).toBe("0");
        expect(anchorHash("")).toBe("0");
        expect(anchorHash("a")).not.toBe(anchorHash("b"));
    });

    it("builds anchors from messages and tool calls", () => {
        const anchors = buildAnnotationAnchors(
            [{ itemKey: "e1:m0", seq: 1, role: "user", text: "hi" }],
            [{ itemKey: "e1:t0", seq: 1, name: "bash", summary: "ls" }]
        );
        expect(anchors).toHaveLength(2);
        expect(anchors[1].role).toBe("tool");
        expect(anchors[0].hash).toBe(anchorHash("hi"));
    });
});
