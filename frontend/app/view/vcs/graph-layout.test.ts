// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import {
    computeLayout,
    graphWidth,
    gutterLines,
    rowShapes,
    type GraphCommit,
} from "./graph-layout";

interface MockCommit extends GraphCommit {
    subject: string;
}

// Newest first; two branches overlap so three lanes are visible at once.
// Mirrors the validated prototype dataset (design/prototypes/vcs/vcs-history-graph/data.js).
const COMMITS: MockCommit[] = [
    { hash: "c21", parents: ["c20"], subject: "Released v2.4", refs: ["HEAD -> main", "tag: v2.4", "origin/main"] },
    { hash: "c20", parents: ["c19", "b3"], subject: "Merge streaming-responses" },
    { hash: "b3", parents: ["b2"], subject: "Render replies token by token", refs: ["streaming-responses"] },
    { hash: "c19", parents: ["c18", "s3"], subject: "Merge hybrid-search" },
    { hash: "s3", parents: ["s2"], subject: "Cache embeddings", refs: ["hybrid-search"] },
    { hash: "b2", parents: ["b1"], subject: "Buffer partial tool calls" },
    { hash: "s2", parents: ["s1"], subject: "Rerank passages" },
    { hash: "c18", parents: ["c17"], subject: "Fix citation links" },
    { hash: "b1", parents: ["c15"], subject: "Handle stream aborts" },
    { hash: "s1", parents: ["c15"], subject: "Tune chunk overlap" },
    { hash: "c17", parents: ["c16"], subject: "Log token usage" },
    { hash: "c16", parents: ["c15"], subject: "Shorten system prompt" },
    { hash: "c15", parents: ["c14"], subject: "Combined keyword and vector search" },
    { hash: "c14", parents: ["c13"], subject: "BM25 alongside embeddings" },
    { hash: "c13", parents: ["c12"], subject: "Eval suite" },
    { hash: "c12", parents: ["c11"], subject: "Retry with backoff" },
    { hash: "c11", parents: ["c10"], subject: "Redact personal data" },
    { hash: "c10", parents: ["c9"], subject: "Versioned prompt templates" },
    { hash: "c9", parents: ["c8"], subject: "Feedback buttons" },
    { hash: "c8", parents: ["c7"], subject: "Server-sent events" },
    { hash: "c7", parents: ["c6"], subject: "Vector store uploads" },
    { hash: "c6", parents: ["c5"], subject: "Gateway fallbacks" },
    { hash: "c5", parents: [], subject: "Initial scaffold" },
];

const MAIN = "#3b82f6";
const STREAMING = "#f97316";
const HYBRID = "#e74c4c";

const colorForCommit = (commit: MockCommit) => {
    const ref = (commit.refs ?? []).find((entry) => entry.startsWith("HEAD ->") || !entry.includes(" ") && !entry.startsWith("tag:") && !entry.includes("/"));
    if (!ref) return null;
    if (ref === "streaming-responses") return STREAMING;
    if (ref === "hybrid-search") return HYBRID;
    if (ref.startsWith("HEAD -> main") || ref === "main") return MAIN;
    return null;
};

describe("computeLayout", () => {
    it("lays out every commit exactly once", () => {
        const layout = computeLayout(COMMITS);
        const hashes = layout.rows.map((row) => row.commit.hash);
        expect(hashes).toHaveLength(COMMITS.length);
        expect(new Set(hashes).size).toBe(COMMITS.length);
    });

    it("never lets two lanes wait for the same commit", () => {
        const layout = computeLayout(COMMITS);
        for (const row of layout.rows) {
            const ids = row.bottomLanes.map((lane) => lane.id);
            expect(new Set(ids).size).toBe(ids.length);
        }
    });

    it("leaves no dangling lanes at the root commit", () => {
        const layout = computeLayout(COMMITS);
        const last = layout.rows[layout.rows.length - 1];
        expect(last.commit.hash).toBe("c5");
        expect(last.bottomLanes).toHaveLength(0);
    });

    it("gives every parent edge a drawable lane", () => {
        const layout = computeLayout(COMMITS);
        for (const row of layout.rows) {
            for (const parent of row.parents) {
                expect(row.parentLanes.some((entry) => entry.id === parent)).toBe(true);
            }
        }
    });

    it("keeps the main line colour across converging branches", () => {
        const layout = computeLayout(COMMITS);
        const mainRow = layout.rows.find((row) => row.commit.hash === "c15");
        expect(mainRow).toBeDefined();
        expect(mainRow.nodeLane).toBe(0);
        expect(mainRow.nodeColor).toBe(MAIN);
    });

    it("shows three concurrent lanes", () => {
        const layout = computeLayout(COMMITS);
        expect(layout.maxLanes).toBe(3);
    });

    it("binds lane colours to branch identity", () => {
        const layout = computeLayout(COMMITS, { colorForCommit });
        const streamingRow = layout.rows.find((row) => row.commit.hash === "b3");
        const hybridRow = layout.rows.find((row) => row.commit.hash === "s3");
        expect(streamingRow.nodeColor).toBe(STREAMING);
        expect(hybridRow.nodeColor).toBe(HYBRID);
    });

    it("keeps colour stability on a paged subset", () => {
        const page = COMMITS.slice(0, 10);
        const layout = computeLayout(page, { colorForCommit });
        const streamingRow = layout.rows.find((row) => row.commit.hash === "b3");
        expect(streamingRow.nodeColor).toBe(STREAMING);
        expect(layout.rows).toHaveLength(page.length);
    });

    it("marks only the HEAD commit", () => {
        const layout = computeLayout(COMMITS, { colorForCommit });
        const headRows = layout.rows.filter((row) => row.isHead);
        expect(headRows.map((row) => row.commit.hash)).toEqual(["c21"]);
    });

    it("handles unknown parents (paginated slices) without dangling lanes", () => {
        const slice = COMMITS.slice(10); // parents outside the slice are unknown
        const layout = computeLayout(slice, { colorForCommit });
        const lastRow = layout.rows[layout.rows.length - 1];
        expect(lastRow.bottomLanes).toHaveLength(0);
    });
});

describe("rowShapes", () => {
    it("produces a node plus edges with no NaN coordinates", () => {
        const layout = computeLayout(COMMITS, { colorForCommit });
        for (const row of layout.rows) {
            const shapes = rowShapes(row, 46);
            expect(shapes.node.color).toBeTruthy();
            expect(Number.isFinite(shapes.node.x)).toBe(true);
            for (const edge of shapes.edges) {
                expect(edge.d).not.toMatch(/NaN|undefined/);
            }
        }
    });

    it("emits a wider edge set for merge commits", () => {
        const layout = computeLayout(COMMITS, { colorForCommit });
        const mergeRow = layout.rows.find((row) => row.commit.hash === "c20");
        const plainRow = layout.rows.find((row) => row.commit.hash === "c18");
        expect(mergeRow.parentLanes).toHaveLength(2);
        expect(plainRow.parentLanes).toHaveLength(1);
    });
});

describe("gutterLines and graphWidth", () => {
    it("returns one line per active lane", () => {
        const layout = computeLayout(COMMITS, { colorForCommit });
        const row = layout.rows.find((r) => r.commit.hash === "c18");
        const lines = gutterLines(row.bottomLanes);
        expect(lines).toHaveLength(row.bottomLanes.length);
        for (const line of lines) expect(line.color).toBeTruthy();
    });

    it("grows with lane count", () => {
        expect(graphWidth(1)).toBeLessThan(graphWidth(3));
    });
});
