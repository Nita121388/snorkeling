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
    searchCommonTextComposeItems,
    searchCommonTextItems,
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

    it("filters to untagged items only, ignoring selected tags", () => {
        const items = [
            makeItem({ title: "Email support", tags: ["email", "support"] }),
            makeItem({ title: "Email ops", tags: ["email", "ops"] }),
            makeItem({ title: "No tags", tags: [] }),
            makeItem({ title: "No tags 2" }),
        ];
        expect(filterCommonTextItemsByTags(items, [], { untagged: true }).map((item) => item.title)).toEqual([
            "No tags",
            "No tags 2",
        ]);
        // untagged 与具体 tag 选择互斥：选中 tags 存在时仍只看无标签条目（避免空集）。
        expect(filterCommonTextItemsByTags(items, ["email"], { untagged: true }).map((item) => item.title)).toEqual([
            "No tags",
            "No tags 2",
        ]);
        expect(searchCommonTextItems(items, "", 40, [], true).map((item) => item.title)).toEqual([
            "No tags",
            "No tags 2",
        ]);
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
        it("keeps command tokens while also segmenting Chinese and punctuation", () => {
            expect(tokenizeCommonTextQuery(";Daily -f feature/foo 部署服务器")).toEqual(
                expect.arrayContaining([";daily", "-f", "feature/foo", "daily", "feature", "foo", "部署"])
            );
        });
        it("can retain a single-character manual search token", () => {
            expect(tokenizeCommonTextQuery("测", 1, 2)).toEqual(["测"]);
            expect(tokenizeCommonTextQuery("-f", 1, 2)).toEqual(["-f"]);
        });
        it("deduplicates repeated tokens", () => {
            expect(tokenizeCommonTextQuery("deploy deploy")).toEqual(["deploy"]);
        });
    });

    describe("searchCommonTextComposeItems", () => {
        const items = [
            makeItem({ id: "deploy", title: "Deploy server", text: "kubectl apply production" }),
            makeItem({ id: "refund", title: "Refund reply", text: "refund processed" }),
            makeItem({ id: "other", title: "Standup", text: "daily team sync" }),
        ];

        it("supports untagged-only filtering and keeps it exclusive from tag selection", () => {
            const taggedItems = [
                makeItem({ id: "deploy", title: "Deploy server", text: "kubectl apply production", tags: ["ops"] }),
                makeItem({ id: "refund", title: "Refund reply", text: "refund processed", tags: ["ops"] }),
                makeItem({ id: "plain", title: "Standup", text: "daily team sync" }),
            ];
            expect(
                searchCommonTextComposeItems(taggedItems, "", "", { untagged: true }).map((item) => item.id)
            ).toEqual(["plain"]);
            // untagged 置 true 时忽略 selectedTags
            expect(
                searchCommonTextComposeItems(taggedItems, "", "", {
                    untagged: true,
                    selectedTags: ["deploy"],
                }).map((item) => item.id)
            ).toEqual(["plain"]);
        });

        it("lets a non-empty manual query fully override editor suggestions", () => {
            expect(searchCommonTextComposeItems(items, "deploy", "refund").map((item) => item.id)).toEqual(["refund"]);
            expect(searchCommonTextComposeItems(items, "standup", "deploy refund").map((item) => item.id)).toEqual([
                "deploy",
                "refund",
            ]);
            expect(searchCommonTextComposeItems(items, "deploy", "").map((item) => item.id)).toEqual(["deploy"]);
        });

        it("ORs editor tokens to keep all matching candidates", () => {
            const ids = searchCommonTextComposeItems(items, "deploy refund", "").map((item) => item.id);
            expect(ids).toEqual(expect.arrayContaining(["deploy", "refund"]));
            expect(ids).not.toContain("other");
        });

        it("supports a single Chinese character in manual search", () => {
            const chineseItems = [
                makeItem({ id: "test", title: "测试命令", text: "运行测试" }),
                makeItem({ id: "deploy", title: "部署命令", text: "运行部署" }),
            ];
            expect(searchCommonTextComposeItems(chineseItems, "", "测").map((item) => item.id)).toEqual(["test"]);
        });

        it("does not broaden a manual command token into one-letter matches", () => {
            const commandItems = [
                makeItem({ id: "flag", title: "Flag", text: "use the flag", shortcut: "-f" }),
                makeItem({ id: "letter", title: "Letter", text: "contains the letter f" }),
            ];
            expect(searchCommonTextComposeItems(commandItems, "", "-f").map((item) => item.id)).toEqual(["flag"]);
        });

        it("ranks the current caret line above older editor text", () => {
            const ids = searchCommonTextComposeItems(items, "deploy\nrefund", "", {
                caret: "deploy\nrefund".length,
            }).map((item) => item.id);
            expect(ids.slice(0, 2)).toEqual(["refund", "deploy"]);
        });

        it("ranks the word nearest the caret within one line", () => {
            const editor = "deploy refund";
            expect(searchCommonTextComposeItems(items, editor, "", { caret: 2 })[0].id).toBe("deploy");
            expect(searchCommonTextComposeItems(items, editor, "", { caret: 10 })[0].id).toBe("refund");
        });

        it("uses Chinese word segmentation for caret ranking", () => {
            const chineseItems = [
                makeItem({ id: "deploy", title: "部署操作", text: "发布应用" }),
                makeItem({ id: "service", title: "服务检查", text: "检查进程" }),
            ];
            const editor = "请部署服务";
            expect(searchCommonTextComposeItems(chineseItems, editor, "", { caret: 2 })[0].id).toBe("deploy");
            expect(searchCommonTextComposeItems(chineseItems, editor, "", { caret: 4 })[0].id).toBe("service");
        });

        it("ranks shortcut, title, tag, and body matches in that order", () => {
            const weightedItems = [
                makeItem({ id: "body", title: "Body match", text: "run needle now" }),
                makeItem({ id: "tag", title: "Tag match", text: "run it", tags: ["needle"] }),
                makeItem({ id: "title", title: "Needle", text: "run it" }),
                makeItem({ id: "shortcut", title: "Shortcut match", text: "run it", shortcut: "needle" }),
            ];
            expect(searchCommonTextComposeItems(weightedItems, "", "needle").map((item) => item.id)).toEqual([
                "shortcut",
                "title",
                "tag",
                "body",
            ]);
        });

        it("demotes an already inserted suggestion without hiding it", () => {
            const repeatedItems = [
                makeItem({ id: "first", title: "Deploy first", text: "deploy", pinned: true }),
                makeItem({ id: "second", title: "Deploy second", text: "deploy" }),
            ];
            expect(
                searchCommonTextComposeItems(repeatedItems, "deploy", "", { insertedIds: ["first"] }).map(
                    (item) => item.id
                )
            ).toEqual(["second", "first"]);
        });

        it("keeps selected tags as a hard filter", () => {
            const taggedItems = [
                makeItem({ id: "ops", title: "Deploy ops", text: "deploy", tags: ["ops"] }),
                makeItem({ id: "personal", title: "Deploy personal", text: "deploy", tags: ["personal"] }),
            ];
            expect(
                searchCommonTextComposeItems(taggedItems, "deploy", "", { selectedTags: ["ops"] }).map(
                    (item) => item.id
                )
            ).toEqual(["ops"]);
        });

        it("uses the standard stable order and limit when the editor is empty", () => {
            const defaultItems = [
                makeItem({ id: "old", title: "Old", updatedat: 1 }),
                makeItem({ id: "recent", title: "Recent", updatedat: 3 }),
                makeItem({ id: "pinned", title: "Pinned", updatedat: 2, pinned: true }),
            ];
            expect(searchCommonTextComposeItems(defaultItems, "", "", { limit: 2 }).map((item) => item.id)).toEqual([
                "pinned",
                "recent",
            ]);
        });
    });
});
