// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    __resetEmojiAliasesForTests,
    EMOJI_ALIAS_MAX_COUNT,
    EMOJI_ALIAS_MAX_LENGTH,
    EMOJI_ALIAS_STORAGE_KEY,
    emojiBaseCandidates,
    getEmojiAlias,
    getEmojiAliasMap,
    getEmojiAliasVersion,
    isEmojiAliasStorageForeign,
    normalizeAliases,
    removeEmojiAliases,
    setEmojiAliases,
    splitAliasInput,
    subscribeEmojiAliases,
} from "./emoji-aliases";

function makeLocalStorageMock() {
    const store = new Map<string, string>();
    const localStorage = {
        getItem: vi.fn((key: string) => store.get(key) ?? null),
        setItem: vi.fn((key: string, value: string) => {
            store.set(key, String(value));
        }),
        removeItem: vi.fn((key: string) => {
            store.delete(key);
        }),
        _store: store,
    };
    const windowMock = {
        localStorage,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    };
    return { localStorage, windowMock };
}

function envelope(byChar: Record<string, unknown>, version = 1): string {
    return JSON.stringify({ version, byChar });
}

describe("normalizeAliases", () => {
    it("trims, drops empties and de-duplicates case-insensitively keeping first spelling", () => {
        expect(normalizeAliases(["  Done ", "", "   ", "done", "DONE", "已解决"])).toEqual(["Done", "已解决"]);
    });

    it("collapses inner whitespace and caps each alias length", () => {
        expect(normalizeAliases(["code   review"])).toEqual(["code review"]);
        const long = "x".repeat(EMOJI_ALIAS_MAX_LENGTH + 10);
        expect(normalizeAliases([long])[0]).toHaveLength(EMOJI_ALIAS_MAX_LENGTH);
    });

    it("caps the alias count", () => {
        const many = Array.from({ length: EMOJI_ALIAS_MAX_COUNT + 5 }, (_, i) => `a${i}`);
        expect(normalizeAliases(many)).toHaveLength(EMOJI_ALIAS_MAX_COUNT);
    });

    it("ignores non-string input", () => {
        expect(normalizeAliases([1 as unknown as string, "ok"])).toEqual(["ok"]);
    });
});

describe("splitAliasInput", () => {
    it("splits on commas (ASCII + full width), semicolons, tabs and newlines", () => {
        expect(splitAliasInput("已解决, done，验收通过;  回归\t通过\nok")).toEqual([
            "已解决",
            "done",
            "验收通过",
            "回归",
            "通过",
            "ok",
        ]);
    });

    it("keeps spaces inside a single alias", () => {
        expect(splitAliasInput("code review")).toEqual(["code review"]);
    });
});

describe("emojiBaseCandidates", () => {
    it("returns the char itself first, then the VS16 form", () => {
        const candidates = emojiBaseCandidates("✅");
        expect(candidates[0]).toBe("✅");
        expect(candidates[1]).toBe("✅️");
    });

    it("falls back from a skin-tone variant to the base emoji", () => {
        const candidates = emojiBaseCandidates("👍🏻");
        expect(candidates[0]).toBe("👍🏻");
        expect(candidates).toContain("👍");
    });

    it("falls back from a variation-selector form to the bare char", () => {
        const candidates = emojiBaseCandidates("❤️");
        expect(candidates[0]).toBe("❤️");
        expect(candidates).toContain("❤");
    });

    it("is empty for empty input", () => {
        expect(emojiBaseCandidates("")).toEqual([]);
    });
});

describe("emoji-aliases store", () => {
    let localStorageMock: ReturnType<typeof makeLocalStorageMock>["localStorage"];

    beforeEach(() => {
        const mock = makeLocalStorageMock();
        localStorageMock = mock.localStorage;
        vi.stubGlobal("window", mock.windowMock);
        __resetEmojiAliasesForTests();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("round-trips aliases through storage", () => {
        setEmojiAliases("✅", { aliases: ["已解决", "done"], note: "回归通过" });
        expect(getEmojiAlias("✅")).toMatchObject({ aliases: ["已解决", "done"], note: "回归通过" });
        const raw = localStorageMock._store.get(EMOJI_ALIAS_STORAGE_KEY);
        expect(raw).toBeDefined();
        const parsed = JSON.parse(raw as string);
        expect(parsed.version).toBe(1);
        expect(parsed.byChar["✅"].aliases).toEqual(["已解决", "done"]);
        expect(parsed.byChar["✅"].note).toBe("回归通过");
    });

    it("normalizes on write", () => {
        setEmojiAliases("✅", { aliases: [" done ", "DONE", ""], note: "  a   b  " });
        expect(getEmojiAlias("✅")?.aliases).toEqual(["done"]);
        expect(getEmojiAlias("✅")?.note).toBe("a b");
    });

    it("removes the storage key when the map becomes empty", () => {
        setEmojiAliases("✅", { aliases: ["done"] });
        removeEmojiAliases("✅");
        expect(getEmojiAliasMap()).toEqual({});
        expect(localStorageMock._store.has(EMOJI_ALIAS_STORAGE_KEY)).toBe(false);
    });

    it("treats write with empty aliases and note as a removal", () => {
        setEmojiAliases("✅", { aliases: ["done"] });
        setEmojiAliases("✅", { aliases: [], note: "   " });
        expect(getEmojiAlias("✅")).toBeNull();
    });

    it("keeps a note-only record", () => {
        setEmojiAliases("🚧", { aliases: [], note: "施工中" });
        expect(getEmojiAlias("🚧")).toMatchObject({ aliases: [], note: "施工中" });
    });

    it("resolves a skin-tone variant through its base alias", () => {
        setEmojiAliases("👍", { aliases: ["赞"] });
        expect(getEmojiAlias("👍🏻")?.aliases).toEqual(["赞"]);
    });

    it("bumps the version on every write and notifies subscribers", () => {
        const listener = vi.fn();
        const unsubscribe = subscribeEmojiAliases(listener);
        const before = getEmojiAliasVersion();
        setEmojiAliases("✅", { aliases: ["done"] });
        expect(getEmojiAliasVersion()).toBe(before + 1);
        expect(listener).toHaveBeenCalledTimes(1);
        setEmojiAliases("✅", { aliases: ["done"] });
        expect(getEmojiAliasVersion()).toBe(before + 2);
        unsubscribe();
        setEmojiAliases("🚧", { aliases: ["wip"] });
        expect(listener).toHaveBeenCalledTimes(2);
    });

    it("survives corrupt JSON without throwing", () => {
        localStorageMock._store.set(EMOJI_ALIAS_STORAGE_KEY, "{not json");
        expect(getEmojiAliasMap()).toEqual({});
        expect(getEmojiAlias("✅")).toBeNull();
    });

    it("ignores a non-object envelope", () => {
        localStorageMock._store.set(EMOJI_ALIAS_STORAGE_KEY, JSON.stringify([1, 2, 3]));
        expect(getEmojiAliasMap()).toEqual({});
    });

    it("ignores a future version and does not overwrite it", () => {
        const payload = envelope({ "✅": { aliases: ["future"], note: "" } }, 2);
        localStorageMock._store.set(EMOJI_ALIAS_STORAGE_KEY, payload);
        expect(getEmojiAliasMap()).toEqual({});
        expect(isEmojiAliasStorageForeign()).toBe(true);
        expect(localStorageMock._store.get(EMOJI_ALIAS_STORAGE_KEY)).toBe(payload);
    });

    it("drops malformed entries but keeps valid siblings", () => {
        localStorageMock._store.set(
            EMOJI_ALIAS_STORAGE_KEY,
            envelope({
                "✅": { aliases: ["done"], note: "", updatedAt: 1 },
                "🚧": { aliases: "not-an-array", note: "" },
                "🐛": null,
                "": { aliases: ["x"], note: "" },
            })
        );
        expect(Object.keys(getEmojiAliasMap())).toEqual(["✅"]);
    });

    it("reads legacy entries without updatedAt", () => {
        localStorageMock._store.set(EMOJI_ALIAS_STORAGE_KEY, envelope({ "✅": { aliases: ["done"], note: "" } }));
        expect(getEmojiAlias("✅")).toMatchObject({ aliases: ["done"], note: "", updatedAt: 0 });
    });

    it("degrades to an in-memory map when storage throws", () => {
        localStorageMock.setItem.mockImplementation(() => {
            throw new Error("QuotaExceededError");
        });
        expect(() => setEmojiAliases("✅", { aliases: ["done"] })).not.toThrow();
        expect(getEmojiAlias("✅")?.aliases).toEqual(["done"]);
    });
});

describe("variation-selector symmetry", () => {
    let localStorageMock: ReturnType<typeof makeLocalStorageMock>["localStorage"];

    beforeEach(() => {
        const mock = makeLocalStorageMock();
        localStorageMock = mock.localStorage;
        vi.stubGlobal("window", mock.windowMock);
        __resetEmojiAliasesForTests();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("adds the VS16 form so a bare-char lookup finds a VS16-keyed record", () => {
        expect(emojiBaseCandidates("\u2705")).toContain("\u2705\uFE0F");
        setEmojiAliases("\u2705\uFE0F", { aliases: ["done"] });
        expect(getEmojiAlias("\u2705")?.aliases).toEqual(["done"]);
    });

    it("strips VS16 so a VS16 lookup finds a bare-keyed record", () => {
        setEmojiAliases("\u2705", { aliases: ["done"] });
        expect(getEmojiAlias("\u2705\uFE0F")?.aliases).toEqual(["done"]);
    });
});
