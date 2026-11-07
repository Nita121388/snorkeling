// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { beforeAll, describe, expect, test } from "vitest";
import type { EmojiAliasMap } from "./emoji-aliases";
import {
    buildEmojiPickerItems,
    emojiPickerEntries,
    getRecentEmojis,
    loadEmojiCatalog,
    matchAliasHits,
    searchEmoji,
    type EmojiCatalog,
} from "./emoji";

let catalog: EmojiCatalog;

beforeAll(async () => {
    catalog = await loadEmojiCatalog();
}, 30000);

function aliasMap(entries: Record<string, string[]>): EmojiAliasMap {
    const map: EmojiAliasMap = {};
    for (const [char, aliases] of Object.entries(entries)) {
        map[char] = { aliases, note: "", updatedAt: 1 };
    }
    return map;
}

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

describe("searchEmoji with user aliases", () => {
    test("exact alias ranks ahead of an exact shortcode match", () => {
        // "smile" is 😄's exact shortcode; the alias must still win because it is the
        // word the user chose for a different emoji.
        const map = aliasMap({ "✅": ["smile"] });
        const r = searchEmoji(catalog, "smile", 10, map);
        expect(r[0].shortcode).toBe("white_check_mark");
        expect(r[1].shortcode).toBe("smile");
    });

    test("alias prefix ranks ahead of built-in matches", () => {
        const map = aliasMap({ "🚧": ["施工中的任务"] });
        const r = searchEmoji(catalog, "施工", 10, map);
        expect(r[0].shortcode).toBe("construction");
    });

    test("exact alias beats prefix alias", () => {
        const map = aliasMap({ "🚧": ["wip"], "✅": ["wip done"] });
        const r = searchEmoji(catalog, "wip", 10, map);
        expect(r[0].shortcode).toBe("construction");
        expect(r[1].shortcode).toBe("white_check_mark");
    });

    test("phrase aliases match on an inner word", () => {
        const map = aliasMap({ "🐛": ["code review"] });
        const r = searchEmoji(catalog, "review", 10, map);
        expect(r[0].shortcode).toBe("bug");
    });

    test("alias matching is case-insensitive", () => {
        const map = aliasMap({ "✅": ["Done"] });
        expect(searchEmoji(catalog, "dOnE", 10, map)[0].shortcode).toBe("white_check_mark");
    });

    test("a char already surfaced by an alias is not duplicated by the built-in pass", () => {
        // 🔥 is a keyword hit for "fire"; alias it to "fire" and it must appear once, first.
        const map = aliasMap({ "🔥": ["fire"] });
        const r = searchEmoji(catalog, "fire", 20, map);
        expect(r[0].char).toBe("🔥");
        expect(r.filter((e) => e.char === "🔥")).toHaveLength(1);
    });

    test("aliases for emoji missing from the catalog are skipped", () => {
        const map = aliasMap({ "🚫not-in-catalog🚫": ["zzzghostzzz"] });
        expect(searchEmoji(catalog, "zzzghostzzz", 10, map)).toEqual([]);
    });

    test("alias stored on a skin-tone variant resolves to the base emoji", () => {
        const map = aliasMap({ "👍🏻": ["dianzan"] });
        const r = searchEmoji(catalog, "dianzan", 10, map);
        expect(r[0].shortcode).toBe("+1");
    });

    test("note text alone does not make an emoji searchable", () => {
        const map: EmojiAliasMap = { "✅": { aliases: [], note: "回归通过", updatedAt: 1 } };
        expect(searchEmoji(catalog, "回归", 10, map).some((e) => e.char === "✅")).toBe(false);
    });

    test("empty query ignores aliases and returns the catalog head", () => {
        const map = aliasMap({ "✅": ["done"] });
        expect(searchEmoji(catalog, "", 3, map)).toEqual(catalog.entries.slice(0, 3));
    });

    test("without aliases the built-in ordering is unchanged", () => {
        expect(searchEmoji(catalog, "smile", 10, {})[0].shortcode).toBe("smile");
    });
});

describe("matchAliasHits", () => {
    test("returns the strongest tier and the alias that matched", () => {
        const map = aliasMap({ "✅": ["done-ish", "done"] });
        const hits = matchAliasHits(catalog, "done", map);
        expect(hits).toHaveLength(1);
        expect(hits[0]).toMatchObject({ alias: "done", tier: 0 });
        expect(hits[0].entry.shortcode).toBe("white_check_mark");
    });

    test("empty query never matches", () => {
        expect(matchAliasHits(catalog, "   ", aliasMap({ "✅": ["done"] }))).toEqual([]);
    });
});

describe("buildEmojiPickerItems alias hints", () => {
    test("alias hits carry the matched alias, built-in hits do not", () => {
        const map = aliasMap({ "✅": ["done"] });
        const items = buildEmojiPickerItems(catalog, "done", [], map);
        const first = items[0];
        expect("entry" in first && first.entry.shortcode).toBe("white_check_mark");
        expect("entry" in first && first.alias).toBe("done");
        // Built-in hits never carry an alias hint.
        const builtinWithAlias = items.filter(
            (it) => "entry" in it && it.entry.shortcode !== "white_check_mark" && it.alias != null
        );
        expect(builtinWithAlias).toEqual([]);
    });

    test("no alias map → no alias field anywhere (backward compatible)", () => {
        const items = buildEmojiPickerItems(catalog, "smile", [], {});
        expect(items.every((it) => !("entry" in it) || it.alias == null)).toBe(true);
    });

    test("empty query structure is unchanged by aliases (no extra group)", () => {
        const withoutAliases = buildEmojiPickerItems(catalog, "", [], {});
        const withAliases = buildEmojiPickerItems(catalog, "", [], aliasMap({ "✅": ["done"] }));
        expect(withAliases.map((it) => it.key)).toEqual(withoutAliases.map((it) => it.key));
    });
});

describe("recents", () => {
    test("no storage in node → empty list, no crash", () => {
        expect(Array.isArray(getRecentEmojis())).toBe(true);
    });
});
