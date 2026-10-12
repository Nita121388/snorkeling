// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { beforeAll, describe, expect, test } from "vitest";
import {
    buildEmojiPickerItems,
    emojiPickerEntries,
    getRecentEmojis,
    loadEmojiCatalog,
    searchEmoji,
    type EmojiCatalog,
} from "./emoji";

let catalog: EmojiCatalog;

beforeAll(async () => {
    catalog = await loadEmojiCatalog();
}, 30000);

describe("emoji catalog", () => {
    test("loads en+zh data with shortcodes, groups and pinyin", async () => {
        expect(catalog.entries.length).toBeGreaterThan(1500);
        const smile = catalog.entries.find((e) => e.shortcode === "smile");
        expect(smile).toBeDefined();
        expect(smile!.char).toBe("😄");
        expect(smile!.keywords).toContain("smile");
        // zh label joined from the zh dataset ("笑" related Chinese label)
        expect(smile!.labelZh.length).toBeGreaterThan(0);
        // pinyin derived from the zh label ([full, initials])
        expect(smile!.pinyin.length).toBeGreaterThan(0);
    });

    test("loadEmojiCatalog is cached (second call returns the same object)", async () => {
        const again = await loadEmojiCatalog();
        expect(again).toBe(catalog);
    });
});

describe("searchEmoji", () => {
    test("shortcode prefix beats label substring", () => {
        const r = searchEmoji(catalog, "smile", 10);
        expect(r.length).toBeGreaterThan(0);
        expect(r[0].shortcode).toBe("smile");
    });

    test("keyword prefix search works (fire)", () => {
        const r = searchEmoji(catalog, "fire");
        expect(r.some((e) => e.char === "🔥")).toBe(true);
    });

    test("pinyin prefix finds the entry from its Chinese label", () => {
        const r = searchEmoji(catalog, "daxiao"); // 大笑
        expect(r.some((e) => e.labelZh === "大笑")).toBe(true);
    });

    test("Chinese label substring match", () => {
        const r = searchEmoji(catalog, "心");
        expect(r.length).toBeGreaterThan(0);
        expect(r.some((e) => e.labelZh.includes("心"))).toBe(true);
    });

    test("empty query returns the catalog head (browsing)", () => {
        const r = searchEmoji(catalog, "", 5);
        expect(r.length).toBe(5);
    });

    test("gibberish query returns empty", () => {
        expect(searchEmoji(catalog, "qqqzzznnn")).toEqual([]);
    });
});

describe("buildEmojiPickerItems", () => {
    test("query → flat search items without headers", () => {
        const items = buildEmojiPickerItems(catalog, "smile", []);
        expect(items.length).toBeGreaterThan(0);
        expect(items.every((it) => "entry" in it)).toBe(true);
    });

    test("no query → group sections with headers; recents first when present", () => {
        const noRecents = buildEmojiPickerItems(catalog, "", []);
        expect(noRecents[0]).toHaveProperty("header");
        const first = catalog.entries[0];
        const withRecents = buildEmojiPickerItems(catalog, "", [first.char]);
        expect(withRecents[0]).toHaveProperty("header", "Recent");
        expect(withRecents[1]).toHaveProperty("entry");
        const pickables = emojiPickerEntries(withRecents);
        expect(pickables[0].char).toBe(first.char);
    });

    test("unknown recents are skipped silently", () => {
        const items = buildEmojiPickerItems(catalog, "", ["🚫not-in-catalog🚫"]);
        expect(items[0]).toHaveProperty("header", "Recent");
        expect(emojiPickerEntries(items).some((e) => e.char === "🚫not-in-catalog🚫")).toBe(false);
    });
});

describe("recents", () => {
    test("no storage in node → empty list, no crash", () => {
        expect(Array.isArray(getRecentEmojis())).toBe(true);
    });
});
