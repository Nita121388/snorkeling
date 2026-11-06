// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    formatBoardAge,
    groupBlocksByStatus,
    groupOverviewCards,
    groupOverviewCardsByProject,
    groupOverviewCardsByProvider,
    groupOverviewCardsByTab,
    groupOverviewCardsByTags,
    isOverviewBoardGroup,
    isOverviewViewMode,
    normalizeBoardTags,
    normalizeOverviewBoardStatus,
    OverviewBoardGroupDefault,
    OverviewBoardGroups,
    OverviewBoardGroupStorageKey,
    OverviewBoardProjectFallbackTitle,
    OverviewBoardProviderFallbackTitle,
    OverviewBoardStatuses,
    OverviewBoardTagFallbackTitle,
    OverviewViewModeDefault,
    OverviewViewModeStorageKey,
    projectNameFromPath,
    providerDisplayLabel,
    readOverviewBoardGroup,
    readOverviewViewMode,
    resolveBoardCardTitle,
    resolveBoardTagChips,
    truncateBoardPreview,
    writeOverviewBoardGroup,
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
        const columns = groupBlocksByStatus([block("a"), block("b"), block("c"), block("d"), block("e")], {
            a: "blocked",
            b: "working",
            c: "done",
            d: "idle",
            e: "stale",
        });

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
        const columns = groupBlocksByStatus(
            [block("a"), block("b")],
            { a: "done", b: "working" },
            {
                statuses: ["working", "done"],
            }
        );

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

describe("providerDisplayLabel", () => {
    it("maps known providers to their display names", () => {
        expect(providerDisplayLabel("claude")).toBe("Claude");
        expect(providerDisplayLabel("claude-code")).toBe("Claude");
        expect(providerDisplayLabel("CODEX")).toBe("Codex");
        expect(providerDisplayLabel("opencode")).toBe("OpenCode");
    });

    it("title-cases unknown providers instead of dropping them", () => {
        expect(providerDisplayLabel("some-new-agent")).toBe("Some New Agent");
        expect(providerDisplayLabel("weird_thing")).toBe("Weird Thing");
    });

    it("returns empty for missing/generic providers", () => {
        expect(providerDisplayLabel("")).toBe("");
        expect(providerDisplayLabel(null)).toBe("");
        expect(providerDisplayLabel(undefined)).toBe("");
        expect(providerDisplayLabel("agent")).toBe("");
    });
});

describe("projectNameFromPath", () => {
    it("takes the basename for posix and windows paths", () => {
        expect(projectNameFromPath("/Users/nita/Primary/projects/snorkeling")).toBe("snorkeling");
        expect(projectNameFromPath("/Users/nita/Primary/projects/snorkeling/")).toBe("snorkeling");
        expect(projectNameFromPath("E:\\code\\snorkeling")).toBe("snorkeling");
    });

    it("refuses paths whose basename is not a useful chip", () => {
        expect(projectNameFromPath("")).toBe("");
        expect(projectNameFromPath(null)).toBe("");
        expect(projectNameFromPath("/")).toBe("");
        expect(projectNameFromPath("~")).toBe("");
        expect(projectNameFromPath(".")).toBe("");
    });
});

describe("resolveBoardCardTitle", () => {
    it("prefers the session title for agent cards", () => {
        expect(
            resolveBoardCardTitle({
                isAgentLike: true,
                sessionTitle: "Refactor auth middleware",
                note: "note text",
                projectName: "snorkeling",
                tabName: "main",
                providerLabel: "Claude",
                blockTitle: "Terminal",
            })
        ).toBe("Refactor auth middleware");
    });

    it("falls back note → project → provider · tab for agent cards", () => {
        expect(
            resolveBoardCardTitle({
                isAgentLike: true,
                note: "先跑类型检查",
                projectName: "snorkeling",
                tabName: "main",
                providerLabel: "Claude",
            })
        ).toBe("先跑类型检查");
        expect(
            resolveBoardCardTitle({
                isAgentLike: true,
                projectName: "snorkeling",
                tabName: "main",
                providerLabel: "Claude",
            })
        ).toBe("snorkeling");
        expect(resolveBoardCardTitle({ isAgentLike: true, tabName: "main", providerLabel: "Claude" })).toBe(
            "Claude · main"
        );
        expect(resolveBoardCardTitle({ isAgentLike: true })).toBe("Agent");
    });

    it("never renders the block view name for agent cards", () => {
        const title = resolveBoardCardTitle({
            isAgentLike: true,
            tabName: "main",
            providerLabel: "Codex",
            blockTitle: "Terminal",
        });
        expect(title).not.toBe("Terminal");
    });

    it("keeps the block title for non-agent blocks", () => {
        expect(resolveBoardCardTitle({ isAgentLike: false, blockTitle: "snorkeling", tabName: "main" })).toBe(
            "snorkeling"
        );
        expect(resolveBoardCardTitle({ isAgentLike: false, tabName: "main" })).toBe("main");
        expect(resolveBoardCardTitle({ isAgentLike: false })).toBe("Untitled");
    });

    it("collapses whitespace and ignores blank strings", () => {
        expect(resolveBoardCardTitle({ isAgentLike: true, sessionTitle: "  fix   preview  ", tabName: "main" })).toBe(
            "fix preview"
        );
    });
});

describe("formatBoardAge", () => {
    const now = 1_700_000_000_000;
    it("formats compact ages", () => {
        expect(formatBoardAge(now - 30_000, now)).toBe("now");
        expect(formatBoardAge(now - 12 * 60_000, now)).toBe("12m");
        expect(formatBoardAge(now - 3 * 3_600_000, now)).toBe("3h");
        expect(formatBoardAge(now - 2 * 86_400_000, now)).toBe("2d");
    });

    it("hides the age when there is no timestamp", () => {
        expect(formatBoardAge(0, now)).toBe("");
        expect(formatBoardAge(-1, now)).toBe("");
    });
});

describe("truncateBoardPreview", () => {
    it("collapses whitespace and keeps short text", () => {
        expect(truncateBoardPreview("  hello   world ")).toBe("hello world");
        expect(truncateBoardPreview("")).toBe("");
        expect(truncateBoardPreview(null)).toBe("");
    });

    it("ellipsizes long text at the requested length", () => {
        const out = truncateBoardPreview("x".repeat(40), 10);
        expect(out.length).toBe(10);
        expect(out.endsWith("...")).toBe(true);
    });
});

function card(
    blockId: string,
    overrides: Partial<{
        tabId: string;
        tabName: string;
        providerLabel: string;
        projectName: string;
        tags: readonly string[];
    }> = {}
) {
    return {
        blockId,
        tabId: overrides.tabId ?? "tab-1",
        tabName: overrides.tabName ?? "main",
        providerLabel: overrides.providerLabel ?? "",
        projectName: overrides.projectName,
        tags: overrides.tags,
    };
}

describe("groupOverviewCardsByTab", () => {
    it("orders columns by first appearance and keeps card order inside a column", () => {
        const columns = groupOverviewCardsByTab([
            card("a", { tabId: "t2", tabName: "feature/overview" }),
            card("b", { tabId: "t1", tabName: "main" }),
            card("c", { tabId: "t2", tabName: "feature/overview" }),
        ]);
        expect(columns.map((column) => column.title)).toEqual(["feature/overview", "main"]);
        expect(columns[0].blocks.map((b) => b.blockId)).toEqual(["a", "c"]);
        expect(columns[1].blocks.map((b) => b.blockId)).toEqual(["b"]);
        expect(columns.map((column) => column.key)).toEqual(["tab:t2", "tab:t1"]);
    });

    it("never produces empty columns and tolerates blank tab names", () => {
        const columns = groupOverviewCardsByTab([card("a", { tabId: "t1", tabName: "  " })]);
        expect(columns).toHaveLength(1);
        expect(columns[0].title).toBe("Untitled");
    });
});

describe("groupOverviewCardsByProvider", () => {
    it("sorts by card count desc then title asc and folds unknown providers", () => {
        const columns = groupOverviewCardsByProvider([
            card("a", { providerLabel: "Claude" }),
            card("b", { providerLabel: "" }),
            card("c", { providerLabel: "Codex" }),
            card("d", { providerLabel: "Claude" }),
        ]);
        expect(columns.map((column) => column.title)).toEqual(["Claude", "Codex", OverviewBoardProviderFallbackTitle]);
        expect(columns[0].blocks.map((b) => b.blockId)).toEqual(["a", "d"]);
    });

    it("keeps the fallback column last when counts tie", () => {
        const columns = groupOverviewCardsByProvider([
            card("a", { providerLabel: "" }),
            card("b", { providerLabel: "Codex" }),
            card("c", { providerLabel: "Claude" }),
        ]);
        expect(columns.map((column) => column.title)).toEqual(["Claude", "Codex", OverviewBoardProviderFallbackTitle]);
    });
});

describe("groupOverviewCards dispatcher", () => {
    const cards = [card("a", { providerLabel: "Claude" }), card("b", { tabId: "t2", tabName: "wt" })];
    const statuses = { a: "working", b: "idle" };

    it("status grouping keeps the fixed 5 columns with tone", () => {
        const columns = groupOverviewCards(cards, statuses, "status", { includeEmpty: true });
        expect(columns).toHaveLength(OverviewBoardStatuses.length);
        expect(columns.every((column) => column.tone != null)).toBe(true);
        expect(columns[0].key).toBe("status:blocked");
    });

    it("status grouping without includeEmpty only keeps non-empty columns", () => {
        const columns = groupOverviewCards(cards, statuses, "status");
        expect(columns.map((column) => column.key)).toEqual(["status:working", "status:idle"]);
    });

    it("tab and provider grouping have no tone and no empty columns", () => {
        for (const group of ["tab", "provider", "project", "tags"] as const) {
            const columns = groupOverviewCards(cards, statuses, group);
            expect(columns.length).toBeGreaterThan(0);
            expect(columns.every((column) => column.tone == null)).toBe(true);
            expect(columns.every((column) => column.blocks.length > 0)).toBe(true);
        }
    });
});

describe("groupOverviewCardsByProject — 目录视图", () => {
    it("groups by project basename and sorts by card count desc then title asc", () => {
        const columns = groupOverviewCardsByProject([
            card("a", { projectName: "snorkeling" }),
            card("b", { projectName: "loop" }),
            card("c", { projectName: "snorkeling" }),
        ]);
        expect(columns.map((column) => column.title)).toEqual(["snorkeling", "loop"]);
        expect(columns[0].blocks.map((c) => c.blockId)).toEqual(["a", "c"]);
        expect(columns[0].key).toBe("project:snorkeling");
    });

    it("folds empty / blank projects into a trailing 无项目 column", () => {
        const columns = groupOverviewCardsByProject([
            card("a", { projectName: "" }),
            card("b", { projectName: "   " }),
            card("c", { projectName: "snorkeling" }),
        ]);
        expect(columns).toHaveLength(2);
        expect(columns[columns.length - 1].title).toBe(OverviewBoardProjectFallbackTitle);
        expect(columns[columns.length - 1].blocks.map((c) => c.blockId)).toEqual(["a", "b"]);
    });

    it("keeps the fallback column last even when it has the most cards", () => {
        const columns = groupOverviewCardsByProject([
            card("a"),
            card("b"),
            card("c"),
            card("d", { projectName: "solo" }),
        ]);
        // fallback 优先级高于卡片数：哪怕它有 3 张、solo 只有 1 张，仍排最后。
        expect(columns.map((column) => column.title)).toEqual(["solo", OverviewBoardProjectFallbackTitle]);
        expect(columns[1].blocks).toHaveLength(3);
    });

    it("never produces duplicated cards (one card belongs to exactly one project)", () => {
        const columns = groupOverviewCardsByProject([card("a", { projectName: "p" })]);
        expect(columns.reduce((n, column) => n + column.blocks.length, 0)).toBe(1);
    });
});

describe("groupOverviewCardsByTags — 标签视图", () => {
    it("puts a multi-tag card in every matching column", () => {
        const columns = groupOverviewCardsByTags([card("a", { tags: ["重构", "auth"] })]);
        expect(columns.map((column) => column.title).sort()).toEqual(["auth", "重构"].sort());
        expect(columns.map((column) => column.blocks.map((c) => c.blockId))).toEqual([["a"], ["a"]]);
        // 关键不变量：列计数之和 >= 卡片数（多标签跳列）
        expect(columns.reduce((n, column) => n + column.blocks.length, 0)).toBeGreaterThanOrEqual(1);
    });

    it("dedupes repeated / hash-prefixed tags before bucketing", () => {
        const columns = groupOverviewCardsByTags([card("a", { tags: ["#ui", "ui", " ui ", ""] })]);
        expect(columns).toHaveLength(1);
        expect(columns[0].title).toBe("ui");
        expect(columns[0].blocks).toHaveLength(1);
    });

    it("sorts tag columns alphabetically and keeps 无标签 last", () => {
        const columns = groupOverviewCardsByTags([
            card("a"),
            card("b", { tags: ["zeta"] }),
            card("c", { tags: ["alpha"] }),
        ]);
        expect(columns.map((column) => column.title)).toEqual(["alpha", "zeta", OverviewBoardTagFallbackTitle]);
        expect(columns[2].blocks.map((c) => c.blockId)).toEqual(["a"]);
    });
});

describe("normalizeBoardTags / resolveBoardTagChips", () => {
    it("strips #, trims, dedupes and keeps order", () => {
        expect(normalizeBoardTags(["#ui", " ui ", "auth", "#auth", ""])).toEqual(["ui", "auth"]);
    });

    it("returns an empty list for missing / null tags", () => {
        expect(normalizeBoardTags(undefined)).toEqual([]);
        expect(normalizeBoardTags(null)).toEqual([]);
        expect(normalizeBoardTags([])).toEqual([]);
    });

    it("shows up to 3 tags and counts the overflow", () => {
        expect(resolveBoardTagChips(["a"])).toEqual({ visible: ["a"], hiddenCount: 0 });
        expect(resolveBoardTagChips(["a", "b", "c"])).toEqual({ visible: ["a", "b", "c"], hiddenCount: 0 });
        expect(resolveBoardTagChips(["a", "b", "c", "d", "e"])).toEqual({
            visible: ["a", "b", "c"],
            hiddenCount: 2,
        });
    });

    it("honours a custom max, including 0", () => {
        expect(resolveBoardTagChips(["a", "b"], 0)).toEqual({ visible: [], hiddenCount: 2 });
        expect(resolveBoardTagChips(["a", "b"], 1)).toEqual({ visible: ["a"], hiddenCount: 1 });
    });
});

describe("board group storage", () => {
    function fakeStorage(initial: Record<string, string> = {}) {
        const data = { ...initial };
        return {
            data,
            getItem: (key: string) => data[key] ?? null,
            setItem: (key: string, value: string) => {
                data[key] = value;
            },
            removeItem: (key: string) => {
                delete data[key];
            },
        };
    }

    it("accepts the documented groups only", () => {
        for (const group of OverviewBoardGroups) {
            expect(isOverviewBoardGroup(group)).toBe(true);
        }
        expect(OverviewBoardGroups).toContain("project");
        expect(OverviewBoardGroups).toContain("tags");
        expect(isOverviewBoardGroup("lane")).toBe(false);
        expect(isOverviewBoardGroup(null)).toBe(false);
    });

    it("defaults to status for missing or corrupt values", () => {
        expect(readOverviewBoardGroup(null)).toBe(OverviewBoardGroupDefault);
        expect(readOverviewBoardGroup(fakeStorage())).toBe("status");
        expect(readOverviewBoardGroup(fakeStorage({ [OverviewBoardGroupStorageKey]: "lane" }))).toBe("status");
    });

    it("round-trips provider and rejects unknown writes", () => {
        const storage = fakeStorage();
        expect(writeOverviewBoardGroup(storage, "provider")).toBe("provider");
        expect(readOverviewBoardGroup(storage)).toBe("provider");
        expect(writeOverviewBoardGroup(storage, "lane" as never)).toBeNull();
        expect(readOverviewBoardGroup(storage)).toBe("provider");
    });
});

describe("overview view mode — 已实现值与未来值", () => {
    it("accepts timeline now that the view exists", () => {
        expect(isOverviewViewMode("timeline")).toBe(true);
        expect(readOverviewViewMode({ getItem: () => "timeline", setItem: () => {} })).toBe("timeline");
    });

    it("still rejects values this build does not render (no white screen on downgrade)", () => {
        expect(isOverviewViewMode("gantt-v2")).toBe(false);
        expect(readOverviewViewMode({ getItem: () => "gantt-v2", setItem: () => {} })).toBe("list");
    });
});
