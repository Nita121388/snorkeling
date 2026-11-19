// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    __resetSessionEmojisForTests,
    applyBackendSessionSummaries,
    getSessionEmojiSnapshot,
    mergeBackendSessionEmojis,
    migrateLegacySessionEmojis,
    normalizeSessionEmojiKey,
    setBackendSessionEmojis,
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

    it("backend emoji props win over localStorage values", () => {
        setSessionEmoji("sess-1", "🦊");
        setSessionEmoji("sess-2", "🐙");
        setBackendSessionEmojis({ "sess-1": "🛡️" });
        // sess-1: backend wins; sess-2: local fallback still readable.
        expect(getSessionEmojiSnapshot()).toEqual({ "sess-1": "🛡️", "sess-2": "🐙" });
        // localStorage is untouched by the backend push (local stays the write target).
        expect(localStorageMock._store.get(STORAGE_KEY)).toBe(JSON.stringify({ "sess-1": "🦊", "sess-2": "🐙" }));
        // Clearing the backend layer falls back to the local value.
        setBackendSessionEmojis({});
        expect(getSessionEmojiSnapshot()).toEqual({ "sess-1": "🦊", "sess-2": "🐙" });
    });

    it("keeps snapshot identity stable when nothing changes", () => {
        setSessionEmoji("sess-1", "🦊");
        const before = getSessionEmojiSnapshot();
        // Same map pushed again: no emit, same snapshot object.
        const listener = vi.fn();
        subscribeSessionEmojis(listener);
        setBackendSessionEmojis({});
        applyBackendSessionSummaries([]);
        expect(getSessionEmojiSnapshot()).toBe(before);
        expect(listener).not.toHaveBeenCalled();
    });

    it("merges partial backend maps without dropping other sessions", () => {
        setBackendSessionEmojis({ "sess-1": "🦊", "sess-2": "🐙" });
        // A list page that only contains sess-2 must not evict sess-1.
        mergeBackendSessionEmojis({ "sess-2": "🛡️" });
        expect(getSessionEmojiSnapshot()).toEqual({ "sess-1": "🦊", "sess-2": "🛡️" });
    });

    it("derives the backend map from summaries and sanitizes non-emoji values", () => {
        applyBackendSessionSummaries([
            { id: "sess-1", props: { emoji: { value: "🦊" } } },
            { id: "sess-2", props: {} },
            { id: "sess-3", props: { emoji: { value: 42 } } },
            { id: "   ", props: { emoji: { value: "🦊" } } },
        ]);
        expect(getSessionEmojiSnapshot()).toEqual({ "sess-1": "🦊" });
    });


    it("migrates the legacy localStorage map and clears the key on success", async () => {
        setSessionEmoji("sess-1", "🦊");
        setSessionEmoji("sess-2", "🐙");
        const { RpcApi } = await import("@/app/store/wshclientapi");
        const migrateMock = vi
            .spyOn(RpcApi, "SessionEmojiMigrateCommand")
            .mockResolvedValue({ migrated: [], skipped: [] } as never);
        const migrated = await migrateLegacySessionEmojis();
        expect(migrated).toBe(true);
        expect(migrateMock).toHaveBeenCalledTimes(1);
        expect(localStorageMock._store.has(STORAGE_KEY)).toBe(false);
        expect(getSessionEmojiSnapshot()).toEqual({});
    });

    it("keeps the legacy key when the migration RPC fails", async () => {
        setSessionEmoji("sess-1", "🦊");
        const { RpcApi } = await import("@/app/store/wshclientapi");
        vi.spyOn(RpcApi, "SessionEmojiMigrateCommand").mockRejectedValue(new Error("rpc down"));
        const migrated = await migrateLegacySessionEmojis().catch(() => false);
        expect(migrated).toBe(false);
        expect(localStorageMock._store.has(STORAGE_KEY)).toBe(true);
        expect(getSessionEmojiSnapshot()).toEqual({ "sess-1": "🦊" });
    });

    it("migrate with no legacy values is a no-op success", async () => {
        expect(await migrateLegacySessionEmojis()).toBe(true);
    });
});