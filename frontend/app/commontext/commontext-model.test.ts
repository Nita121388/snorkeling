// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    DefaultCommonTextSortKey,
    filterCommonTextItemsByTags,
    findDuplicateCommonText,
    getCommonTextTagSummaries,
    getCommonTextDeviceSummaries,
    markCommonTextUsed,
    normalizeCommonTextItem,
    normalizeCommonTextSortKey,
    normalizeCommonTextTags,
    normalizeCommonTextTitle,
    searchCommonTextComposeItems,
    searchCommonTextItems,
    sortCommonTextItems,
    sortCommonTextItemsBy,
    tokenizeCommonTextQuery,
    type CommonTextItem,
    type CommonTextSortKey,
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

    describe("sortCommonTextItemsBy", () => {
        const ids = (items: CommonTextItem[]) => items.map((item) => item.id);
        // 三条同列数据：created / updated / lastused / usage 四个维度的高低位刚好错开，
        // 任何一个排序键选错都会立刻体现为次序不同。
        const items = [
            makeItem({
                id: "oldest",
                title: "Zeta",
                createdat: 100,
                updatedat: 100,
                lastusedat: 100,
                usagecount: 1,
            }),
            makeItem({
                id: "newest",
                title: "Alpha",
                createdat: 900,
                updatedat: 900,
                lastusedat: 900,
                usagecount: 9,
            }),
            makeItem({
                id: "middle",
                title: "Mid",
                createdat: 500,
                updatedat: 500,
                lastusedat: 500,
                usagecount: 5,
            }),
        ];

        it("defaults to recently used", () => {
            expect(ids(sortCommonTextItemsBy(items))).toEqual(["newest", "middle", "oldest"]);
            expect(DefaultCommonTextSortKey).toBe("lastused-desc");
        });

        it("sorts by every user-facing key", () => {
            expect(ids(sortCommonTextItemsBy(items, "lastused-desc"))).toEqual(["newest", "middle", "oldest"]);
            expect(ids(sortCommonTextItemsBy(items, "updated-desc"))).toEqual(["newest", "middle", "oldest"]);
            expect(ids(sortCommonTextItemsBy(items, "created-desc"))).toEqual(["newest", "middle", "oldest"]);
            expect(ids(sortCommonTextItemsBy(items, "created-asc"))).toEqual(["oldest", "middle", "newest"]);
            expect(ids(sortCommonTextItemsBy(items, "usage-desc"))).toEqual(["newest", "middle", "oldest"]);
            expect(ids(sortCommonTextItemsBy(items, "title-asc"))).toEqual(["newest", "middle", "oldest"]);
        });

        it("keeps pinned items first in every mode", () => {
            const pinnedLast = [
                ...items,
                makeItem({
                    id: "pinned",
                    title: "Zulu",
                    createdat: 1,
                    updatedat: 1,
                    lastusedat: 1,
                    usagecount: 0,
                    pinned: true,
                }),
            ];
            for (const key of [
                "lastused-desc",
                "updated-desc",
                "created-desc",
                "created-asc",
                "usage-desc",
                "title-asc",
            ] as CommonTextSortKey[]) {
                expect(ids(sortCommonTextItemsBy(pinnedLast, key))[0]).toBe("pinned");
            }
        });

        it("falls back to updatedat then title when the primary key ties", () => {
            const tied = [
                makeItem({ id: "b-tie", title: "Beta", createdat: 5, updatedat: 5, usagecount: 3 }),
                makeItem({ id: "a-tie", title: "Alpha", createdat: 5, updatedat: 5, usagecount: 3 }),
                makeItem({ id: "fresh", title: "Fresh", createdat: 5, updatedat: 9, usagecount: 3 }),
            ];
            expect(ids(sortCommonTextItemsBy(tied, "usage-desc"))).toEqual(["fresh", "a-tie", "b-tie"]);
        });

        it("treats a missing usage count or last-used stamp as the lowest value", () => {
            const neverUsed = [
                makeItem({ id: "used", title: "Used", createdat: 1, updatedat: 1, lastusedat: 10, usagecount: 2 }),
                makeItem({ id: "fresh", title: "Fresh", createdat: 2, updatedat: 2 }),
            ];
            expect(ids(sortCommonTextItemsBy(neverUsed, "lastused-desc"))).toEqual(["used", "fresh"]);
            expect(ids(sortCommonTextItemsBy(neverUsed, "usage-desc"))).toEqual(["used", "fresh"]);
        });

        it("normalizes unknown or missing sort keys to the default", () => {
            expect(normalizeCommonTextSortKey(undefined)).toBe(DefaultCommonTextSortKey);
            expect(normalizeCommonTextSortKey("bogus")).toBe(DefaultCommonTextSortKey);
            expect(normalizeCommonTextSortKey(42)).toBe(DefaultCommonTextSortKey);
            expect(normalizeCommonTextSortKey("usage-desc")).toBe("usage-desc");
            expect(ids(sortCommonTextItemsBy(items, "bogus" as CommonTextSortKey))).toEqual(
                ids(sortCommonTextItemsBy(items, DefaultCommonTextSortKey))
            );
        });

        it("keeps sortCommonTextItems pinned-first / last-used / updated / title in that order", () => {
            // 不用"与 sortCommonTextItemsBy 相等"来断言（那是自证：两者现在是委托关系）。
            // 这里用冻结的期望次序钉住它——它决定写盘顺序、返回顺序与弹窗 ↑↓ 落点。
            const fixture = [
                makeItem({ id: "tie-b", title: "Beta", updatedat: 50, lastusedat: 10, pinned: false }),
                makeItem({ id: "never", title: "Zulu", updatedat: 90, pinned: false }),
                makeItem({ id: "used", title: "Alpha", updatedat: 10, lastusedat: 80, pinned: false }),
                makeItem({ id: "pinned-old", title: "Pinned Old", updatedat: 1, lastusedat: 1, pinned: true }),
                makeItem({ id: "tie-a", title: "Alpha Two", updatedat: 50, lastusedat: 10, pinned: false }),
            ];
            expect(sortCommonTextItems(fixture).map((item) => item.id)).toEqual([
                "pinned-old", // 置顶恒最先，与时间无关
                "used", // lastusedat 80
                "tie-a", // lastusedat 10 并列 → updatedat 50 并列 → title 升序
                "tie-b",
                "never", // 无 lastusedat 落最后
            ]);
            // 默认键等价于显式传 lastused-desc（行为契约，不是实现细节）
            expect(DefaultCommonTextSortKey).toBe("lastused-desc");
        });
    });

    describe("markCommonTextUsed", () => {
        const item = makeItem({ id: "a", lastusedat: 100, usagecount: 2 });

        it("bumps both the last-used stamp and the usage count by default", () => {
            expect(markCommonTextUsed(item, 500)).toMatchObject({ lastusedat: 500, usagecount: 3 });
        });

        it("can refresh the last-used stamp without counting a use (new item path)", () => {
            expect(markCommonTextUsed(item, 500, false)).toMatchObject({ lastusedat: 500, usagecount: 2 });
        });

        it("defaults a missing usage count to zero", () => {
            const noCount = makeItem({ id: "b" });
            expect(markCommonTextUsed(noCount, 500, false).usagecount).toBe(0);
            expect(markCommonTextUsed(noCount, 500).usagecount).toBe(1);
        });
    });

    describe("searchCommonTextComposeItems sortKey", () => {
        const items = [
            makeItem({
                id: "deploy",
                title: "Deploy server",
                text: "kubectl apply production",
                createdat: 3,
                updatedat: 3,
                usagecount: 1,
            }),
            makeItem({
                id: "refund",
                title: "Refund reply",
                text: "refund processed",
                createdat: 2,
                updatedat: 2,
                usagecount: 7,
            }),
            makeItem({
                id: "standup",
                title: "Standup",
                text: "daily team sync",
                createdat: 1,
                updatedat: 1,
                usagecount: 4,
            }),
        ];

        it("applies the chosen sort key while browsing", () => {
            expect(
                searchCommonTextComposeItems(items, "", "", { sortKey: "title-asc" }).map((item) => item.id)
            ).toEqual(["deploy", "refund", "standup"]);
            expect(
                searchCommonTextComposeItems(items, "", "", { sortKey: "usage-desc" }).map((item) => item.id)
            ).toEqual(["refund", "standup", "deploy"]);
            // 默认键不变：仍是最近使用（无 lastusedat 时回落 updatedat desc → createdat 越大越前）
            expect(searchCommonTextComposeItems(items, "", "").map((item) => item.id)).toEqual([
                "deploy",
                "refund",
                "standup",
            ]);
        });

        it("lets relevance beat the chosen key while searching", () => {
            // 浏览态 title-asc 把 deploy 排第一；搜索 refund 时相关度把 refund 提到最前
            expect(
                searchCommonTextComposeItems(items, "", "refund", { sortKey: "title-asc" }).map((item) => item.id)
            ).toEqual(["refund"]);
        });

        it("keeps pinned as a tie-breaker only while searching", () => {
            const pinnedWeak = makeItem({
                id: "pinned-weak",
                title: "Refund notes",
                text: "notes about refunds",
                pinned: true,
            });
            const strongMatch = makeItem({ id: "strong", title: "Refund", text: "refund processed" });
            const ranked = searchCommonTextComposeItems([pinnedWeak, strongMatch], "", "refund").map((item) => item.id);
            // 搜索态：相关度更高者在前，置顶不强制最前
            expect(ranked).toEqual(["strong", "pinned-weak"]);
            // 浏览态：置顶恒在最前
            expect(
                searchCommonTextComposeItems([pinnedWeak, strongMatch], "", "", { sortKey: "title-asc" }).map(
                    (item) => item.id
                )
            ).toEqual(["pinned-weak", "strong"]);
        });
    });

    describe("sync metadata normalize", () => {
        it("fills legacy defaults when the fields are absent", () => {
            const item = normalizeCommonTextItem({ id: "legacy", text: "body" });
            expect(item).not.toBeNull();
            // 旧条目（同步功能之前写的）读出来必须是稳定兜底值，不能是 undefined
            expect(item.createdby).toEqual({ kind: "human", name: "" });
            expect(item.origin).toEqual({ deviceid: "local", devicename: "This machine", platform: "" });
            expect(item.rev).toBe(0);
            expect(item.deletedat).toBeUndefined();
        });

        it("keeps provided metadata intact", () => {
            const item = normalizeCommonTextItem({
                id: "agent-1",
                text: "body",
                createdby: { kind: "agent", name: "pi" },
                origin: { deviceid: "dev-home-7c3a", devicename: "Home PC", platform: "win32" },
                rev: 7,
                deletedat: 1234,
            });
            expect(item.createdby).toEqual({ kind: "agent", name: "pi" });
            expect(item.origin).toEqual({ deviceid: "dev-home-7c3a", devicename: "Home PC", platform: "win32" });
            expect(item.rev).toBe(7);
            expect(item.deletedat).toBe(1234);
        });

        it("rejects an unknown createdby kind instead of trusting it", () => {
            const item = normalizeCommonTextItem({ id: "x", text: "body", createdby: { kind: "robot", name: "r2" } });
            expect(item.createdby).toEqual({ kind: "human", name: "r2" });
        });

        it("falls back per field when origin is partially missing", () => {
            const item = normalizeCommonTextItem({ id: "x", text: "body", origin: { platform: "darwin" } });
            expect(item.origin).toEqual({ deviceid: "local", devicename: "This machine", platform: "darwin" });
        });
    });

    describe("creator / device filters", () => {
        const home = { deviceid: "dev-home", devicename: "Home PC", platform: "win32" };
        const work = { deviceid: "dev-work", devicename: "Work Mac", platform: "darwin" };
        const dataset: CommonTextItem[] = [
            makeItem({ id: "a", title: "A", text: "a", createdby: { kind: "human", name: "Nita" }, origin: home }),
            makeItem({ id: "b", title: "B", text: "b", createdby: { kind: "agent", name: "pi" }, origin: home }),
            makeItem({ id: "c", title: "C", text: "c", createdby: { kind: "human", name: "Nita" }, origin: work }),
            makeItem({ id: "d", title: "D", text: "d", createdby: { kind: "agent", name: "codex" }, origin: work }),
        ];
        const ids = (items: CommonTextItem[]) => items.map((i) => i.id).sort();

        it("filters by creator kind", () => {
            expect(ids(searchCommonTextComposeItems(dataset, "", "", { creator: "human" }))).toEqual(["a", "c"]);
            expect(ids(searchCommonTextComposeItems(dataset, "", "", { creator: "agent" }))).toEqual(["b", "d"]);
            expect(ids(searchCommonTextComposeItems(dataset, "", "", { creator: "all" }))).toEqual(["a", "b", "c", "d"]);
        });

        it("filters by originating device", () => {
            expect(ids(searchCommonTextComposeItems(dataset, "", "", { device: "dev-home" }))).toEqual(["a", "b"]);
            expect(ids(searchCommonTextComposeItems(dataset, "", "", { device: "dev-work" }))).toEqual(["c", "d"]);
            expect(ids(searchCommonTextComposeItems(dataset, "", "", { device: "any" }))).toEqual(["a", "b", "c", "d"]);
        });

        it("combines creator and device as AND", () => {
            expect(ids(searchCommonTextComposeItems(dataset, "", "", { creator: "human", device: "dev-work" }))).toEqual([
                "c",
            ]);
            expect(ids(searchCommonTextComposeItems(dataset, "", "", { creator: "agent", device: "dev-home" }))).toEqual([
                "b",
            ]);
        });

        it("applies the source filter before the result limit", () => {
            // 来源是硬过滤：先筛再截断，否则 limit 会把本该命中的行挤掉
            const filtered = searchCommonTextComposeItems(dataset, "", "", { creator: "agent", limit: 2 });
            expect(ids(filtered)).toEqual(["b", "d"]);
        });

        it("treats missing metadata as human / local device", () => {
            const legacy = [makeItem({ id: "legacy", title: "Legacy", text: "legacy text" })];
            expect(ids(searchCommonTextComposeItems(legacy, "", "", { creator: "human" }))).toEqual(["legacy"]);
            expect(ids(searchCommonTextComposeItems(legacy, "", "", { creator: "agent" }))).toEqual([]);
            expect(ids(searchCommonTextComposeItems(legacy, "", "", { device: "local" }))).toEqual(["legacy"]);
        });

        it("summarizes devices with counts in first-seen order", () => {
            expect(getCommonTextDeviceSummaries(dataset)).toEqual([
                { deviceid: "dev-home", devicename: "Home PC", count: 2 },
                { deviceid: "dev-work", devicename: "Work Mac", count: 2 },
            ]);
        });
    });
});
