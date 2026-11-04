// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    OverviewBoardStatuses,
    OverviewViewModeDefault,
    OverviewViewModeStorageKey,
    groupBlocksByStatus,
    isOverviewViewMode,
    normalizeOverviewBoardStatus,
    readOverviewViewMode,
    writeOverviewViewMode,
    type OverviewViewModeStorageLike,
} from "./overview-board-model";

function block(blockId: string) {
    return { blockId };
}

function ids(columnIds: string[]): string[] {
    return columnIds;
}

describe("normalizeOverviewBoardStatus", () => {
    it("keeps every board status as-is", () => {
        for (const status of OverviewBoardStatuses) {
            expect(normalizeOverviewBoardStatus(status)).toBe(status);
        }
    });

    it("folds unknown and missing states into idle", () => {
        expect(normalizeOverviewBoardStatus("mystery-state")).toBe("idle");
        expect(normalizeOverviewBoardStatus("weird-state")).toBe("idle");
        expect(normalizeOverviewBoardStatus("unknown")).toBe("idle");
        expect(normalizeOverviewBoardStatus("")).toBe("idle");
        expect(normalizeOverviewBoardStatus(null)).toBe("idle");
        expect(normalizeOverviewBoardStatus(undefined)).toBe("idle");
    });
});

describe("groupBlocksByStatus", () => {
    it("returns no columns for empty input", () => {
        expect(groupBlocksByStatus([], {})).toEqual([]);
    });

    it("uses the fixed column order regardless of input order", () => {
        const blocks = [block("c"), block("a"), block("b")];
        const columns = groupBlocksByStatus(blocks, {
            a: "idle",
            b: "blocked",
            c: "working",
        });

        expect(columns.map((column) => column.status)).toEqual(["blocked", "working", "idle"]);
        expect(columns.map((column) => column.title)).toEqual(["待我处理", "进行中", "空闲"]);
    });

    it("keeps input order inside a column", () => {
        const columns = groupBlocksByStatus([block("a"), block("b"), block("c")], {
            a: "working",
            b: "working",
            c: "working",
        });

        expect(columns).toHaveLength(1);
        expect(columns[0].blocks.map((entry) => entry.blockId)).toEqual(ids(["a", "b", "c"]));
    });

    it("groups each status into its own column", () => {
        const columns = groupBlocksByStatus(
            [block("a"), block("b"), block("c"), block("d"), block("e")],
            {
                a: "blocked",
                b: "working",
                c: "done",
                d: "idle",
                e: "stale",
            }
        );

        expect(columns.map((column) => [column.status, column.blocks[0].blockId])).toEqual([
            ["blocked", "a"],
            ["working", "b"],
            ["done", "c"],
            ["idle", "d"],
            ["stale", "e"],
        ]);
    });

    it("falls back to idle for unknown or missing statuses", () => {
        const columns = groupBlocksByStatus([block("a"), block("b"), block("c")], {
            a: "mystery-state",
            b: "weird-state",
            // c has no entry at all
        });

        expect(columns).toHaveLength(1);
        expect(columns[0].status).toBe("idle");
        expect(columns[0].blocks.map((entry) => entry.blockId)).toEqual(ids(["a", "b", "c"]));
    });

    it("accepts objects with a state field (AgentStatus-shaped)", () => {
        const columns = groupBlocksByStatus([block("a"), block("b")], {
            a: { state: "working" },
            b: null,
        });

        expect(columns.map((column) => column.status)).toEqual(["working", "idle"]);
        expect(columns[1].blocks.map((entry) => entry.blockId)).toEqual(ids(["b"]));
    });

    it("truncates the total card count in column order", () => {
        const columns = groupBlocksByStatus(
            [block("a1"), block("a2"), block("b1"), block("b2"), block("c1")],
            {
                a1: "blocked",
                a2: "blocked",
                b1: "working",
                b2: "working",
                c1: "done",
            },
            { maxTotal: 3 }
        );

        expect(columns.map((column) => [column.status, column.blocks.length])).toEqual([
            ["blocked", 2],
            ["working", 1],
        ]);
    });

    it("drops columns emptied by the total cap", () => {
        const columns = groupBlocksByStatus([block("a"), block("b")], { a: "working", b: "done" }, { maxTotal: 1 });

        expect(columns.map((column) => column.status)).toEqual(["working"]);
    });

    it("supports maxTotal zero and negative values as an empty board", () => {
        expect(groupBlocksByStatus([block("a")], { a: "working" }, { maxTotal: 0 })).toEqual([]);
        expect(groupBlocksByStatus([block("a")], { a: "working" }, { maxTotal: -5 })).toEqual([]);
    });

    it("keeps empty columns only when includeEmpty is set", () => {
        const columns = groupBlocksByStatus([block("a")], { a: "done" }, { includeEmpty: true });

        expect(columns.map((column) => column.status)).toEqual([...OverviewBoardStatuses]);
        expect(columns.find((column) => column.status === "done")?.blocks).toHaveLength(1);
        expect(columns.find((column) => column.status === "blocked")?.blocks).toHaveLength(0);
    });

    it("honors a custom status order", () => {
        const columns = groupBlocksByStatus([block("a"), block("b")], { a: "done", b: "working" }, {
            statuses: ["working", "done"],
        });

        expect(columns.map((column) => column.status)).toEqual(["working", "done"]);
    });
});

describe("overview view mode storage", () => {
    function fakeStorage(initial: Record<string, string> = {}): OverviewViewModeStorageLike & {
        data: Record<string, string>;
    } {
        const data = { ...initial };
        return {
            data,
            getItem: (key) => data[key] ?? null,
            setItem: (key, value) => {
                data[key] = value;
            },
            removeItem: (key) => {
                delete data[key];
            },
        };
    }

    it("validates known modes only", () => {
        expect(isOverviewViewMode("list")).toBe(true);
        expect(isOverviewViewMode("board")).toBe(true);
        expect(isOverviewViewMode("kanban")).toBe(false);
        expect(isOverviewViewMode(null)).toBe(false);
    });

    it("defaults to list for missing or corrupt values", () => {
        expect(readOverviewViewMode(null)).toBe(OverviewViewModeDefault);
        expect(readOverviewViewMode(fakeStorage())).toBe("list");
        expect(readOverviewViewMode(fakeStorage({ [OverviewViewModeStorageKey]: "kanban" }))).toBe("list");
    });

    it("round-trips board and list", () => {
        const storage = fakeStorage();
        expect(writeOverviewViewMode(storage, "board")).toBe("board");
        expect(readOverviewViewMode(storage)).toBe("board");
        expect(writeOverviewViewMode(storage, "list")).toBe("list");
        expect(readOverviewViewMode(storage)).toBe("list");
    });

    it("does not write without storage", () => {
        expect(writeOverviewViewMode(null, "board")).toBeNull();
    });
});

describe("normalizeOverviewBoardStatus — 报警状态不能被灰成空闲", () => {
    it("error / rate-limited 归入「待我处理」而不是 idle", () => {
        expect(normalizeOverviewBoardStatus("error")).toBe("blocked");
        expect(normalizeOverviewBoardStatus("rate-limited")).toBe("blocked");
    });
    it("未知值仍然兜底 idle", () => {
        expect(normalizeOverviewBoardStatus("nonsense")).toBe("idle");
        expect(normalizeOverviewBoardStatus(null)).toBe("idle");
        expect(normalizeOverviewBoardStatus(undefined)).toBe("idle");
    });
});
