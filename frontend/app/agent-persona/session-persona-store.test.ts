// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    __resetSessionEmojisForTests,
    getSessionEmojiSnapshot,
    normalizeSessionEmojiKey,
    setSessionEmoji,
    subscribeSessionEmojis,
} from "./session-persona-store";

const STORAGE_KEY = "snorkeling:agent-session-emojis";

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

describe("session-persona-store", () => {
    let localStorageMock: ReturnType<typeof makeLocalStorageMock>["localStorage"];

    beforeEach(() => {
        const mock = makeLocalStorageMock();
        localStorageMock = mock.localStorage;
        vi.stubGlobal("window", mock.windowMock);
        __resetSessionEmojisForTests();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("round-trips a session emoji", () => {
        setSessionEmoji("sess-1", "🦊");
        expect(getSessionEmojiSnapshot()).toEqual({ "sess-1": "🦊" });
        expect(localStorageMock._store.get(STORAGE_KEY)).toBe(JSON.stringify({ "sess-1": "🦊" }));
    });

    it("removes a session emoji and drops the storage key when empty", () => {
        setSessionEmoji("sess-1", "🦊");
        setSessionEmoji("sess-1", null);
        expect(getSessionEmojiSnapshot()).toEqual({});
        expect(localStorageMock._store.has(STORAGE_KEY)).toBe(false);
    });

    it("ignores empty or whitespace-only session ids", () => {
        setSessionEmoji("", "🦊");
        setSessionEmoji("   ", "🦊");
        expect(getSessionEmojiSnapshot()).toEqual({});
    });

    it("notifies subscribers on write", () => {
        const listener = vi.fn();
        const unsub = subscribeSessionEmojis(listener);
        setSessionEmoji("sess-1", "🐙");
        expect(listener).toHaveBeenCalledTimes(1);
        unsub();
        setSessionEmoji("sess-2", "🐙");
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it("trims keys but keeps case", () => {
        expect(normalizeSessionEmojiKey("  AbC-1  ")).toBe("AbC-1");
        expect(normalizeSessionEmojiKey(null)).toBe("");
    });
});
