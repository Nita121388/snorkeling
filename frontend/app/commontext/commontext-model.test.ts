// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    filterCommonTextItemsByTags,
    findDuplicateCommonText,
    getCommonTextTagSummaries,
    normalizeCommonTextItem,
    normalizeCommonTextTags,
    normalizeCommonTextTitle,
    searchCommonTextItems,
    searchCommonTextItemsFuzzy,
    tokenizeCommonTextQuery,
    type CommonTextItem,
} from "./commontext-model";

function makeItem(overrides: Partial<CommonTextItem>): CommonTextItem {
    return {
        id: overrides.id ?? crypto.randomUUID(),
        title: overrides.title ?? "Title",
        text: overrides.text ?? "Text",
        createdat: overrides.createdat ?? 1,
        updatedat: overrides.updatedat ?? 1,
        ...overrides,
    };
}

describe("commontext-model", () => {
    it("creates a title from the first non-empty line", () => {
        expect(normalizeCommonTextTitle("", "\n  hello world\nsecond")).toBe("hello world");
        expect(normalizeCommonTextTitle(" Custom ", "text")).toBe("Custom");
    });

    it("deduplicates tags case-insensitively", () => {
        expect(normalizeCommonTextTags("email, support, Email,  ,ops")).toEqual(["email", "support", "ops"]);
    });

    it("ignores non-string tags defensively", () => {
        expect(normalizeCommonTextTags(["email", 5, null, "support"] as unknown as string[])).toEqual([
            "email",
            "support",
        ]);
        expect(normalizeCommonTextTags({ tag: "email" })).toEqual([]);
    });

    it("normalizes raw settings items", () => {
        const item = normalizeCommonTextItem({
            id: "item-1",
            text: "Saved text",
            tags: ["one", "One", "two"],
            pinned: true,
        });
        expect(item).toMatchObject({
            id: "item-1",
            title: "Saved text",
            text: "Saved text",
            tags: ["one", "two"],
            pinned: true,
        });
    });

    it("searches title, text, shortcut, and tags", () => {
        const items = [
            makeItem({ title: "Daily report", text: "standup notes", shortcut: ";daily" }),
            makeItem({ title: "Support reply", text: "refund request", tags: ["email"] }),
        ];
        expect(searchCommonTextItems(items, "daily")).toHaveLength(1);
        expect(searchCommonTextItems(items, ";daily")[0].title).toBe("Daily report");
        expect(searchCommonTextItems(items, "email refund")[0].title).toBe("Support reply");
    });

    it("summarizes tags by usage count", () => {
        const items = [
            makeItem({ tags: ["email", "support"] }),
            makeItem({ tags: ["Email", "ops"] }),
            makeItem({ tags: ["support"] }),
        ];
        expect(getCommonTextTagSummaries(items)).toEqual([
            { tag: "email", count: 2 },
            { tag: "support", count: 2 },
            { tag: "ops", count: 1 },
        ]);
    });

    it("filters items by all selected tags", () => {
        const items = [
            makeItem({ title: "Email support", tags: ["email", "support"] }),
            makeItem({ title: "Email ops", tags: ["email", "ops"] }),
            makeItem({ title: "No tags", tags: [] }),
        ];
        expect(filterCommonTextItemsByTags(items, ["email", "support"]).map((item) => item.title)).toEqual([
            "Email support",
        ]);
        expect(searchCommonTextItems(items, "email", 40, ["ops"]).map((item) => item.title)).toEqual(["Email ops"]);
    });

    it("finds duplicate text while allowing current item", () => {
        const items = [makeItem({ id: "a", text: "same" }), makeItem({ id: "b", text: "other" })];
        expect(findDuplicateCommonText(items, " same ")?.id).toBe("a");
        expect(findDuplicateCommonText(items, " same ", "a")).toBeNull();
    });

    describe("tokenizeCommonTextQuery", () => {
        it("drops single-char and whitespace-only tokens", () => {
            expect(tokenizeCommonTextQuery("  a  bb   ccc  ")).toEqual(["bb", "ccc"]);
        });
        it("lowercases tokens so matching is case-insensitive", () => {
            expect(tokenizeCommonTextQuery("Deploy SERVER")).toEqual(["deploy", "server"]);
        });
        it("returns empty array for blank queries", () => {
            expect(tokenizeCommonTextQuery("   ")).toEqual([]);
        });
    });

    describe("searchCommonTextItemsFuzzy", () => {
        const items = [
            makeItem({ title: "Deploy", text: "kubectl apply -f deploy.yaml" }),
            makeItem({ title: "Email refund", text: "Refund processed for prod order 123" }),
            makeItem({ title: "Standup notes", text: "sprint daily team sync" }),
        ];

        it("ORs tokens: an item matching one of several words surfaces without needing all of them", () => {
            const titles = searchCommonTextItemsFuzzy(items, "deploy refund", 40).map((i) => i.title);
            // Both Deploy and Email refund match exactly one token each; Standup notes matches none.
            expect(titles).toEqual(expect.arrayContaining(["Deploy", "Email refund"]));
            expect(titles).not.toContain("Standup notes");
        });

        it("ranks items matching more tokens above items matching fewer", () => {
            const multiMatch = [
                makeItem({ title: "Deploy prod refund", text: "prod deploy refund flow" }),
                makeItem({ title: "Deploy only", text: "kubectl deploy" }),
            ];
            const titles = searchCommonTextItemsFuzzy(multiMatch, "deploy refund", 40).map((i) => i.title);
            expect(titles[0]).toBe("Deploy prod refund");
        });

        it("returns all items (no query filter) when the editor is empty, sorted by pin/recency", () => {
            const titles = searchCommonTextItemsFuzzy(items, "", 40).map((i) => i.title);
            expect(titles).toEqual(expect.arrayContaining(["Deploy", "Email refund", "Standup notes"]));
        });

        it("still respects selected tags as a hard filter on top of fuzzy matching", () => {
            const tagged = [
                makeItem({ title: "Ops deploy", text: "kubectl deploy", tags: ["ops"] }),
                makeItem({ title: "Personal deploy", text: "kubectl deploy", tags: ["personal"] }),
            ];
            const titles = searchCommonTextItemsFuzzy(tagged, "deploy", 40, ["ops"]).map((i) => i.title);
            expect(titles).toEqual(["Ops deploy"]);
        });

        it("ignores caret position — only the editor's contents matter", () => {
            // Two queries with identical tokens in different positions/sizes should return the same set.
            const a = searchCommonTextItemsFuzzy(items, "deploy kubectl yaml", 40).map((i) => i.title);
            const b = searchCommonTextItemsFuzzy(items, "yaml kubectl deploy", 40).map((i) => i.title);
            // Order may differ, but the set should be identical.
            expect(a.sort()).toEqual(b.sort());
        });
    });
});
