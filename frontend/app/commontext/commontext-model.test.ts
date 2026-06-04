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
});
