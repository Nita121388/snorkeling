// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from "vitest";
import { DefaultCommonTextSortKey } from "./commontext-model";
import { loadCommonTextSortKey, saveCommonTextSortKey } from "./commontext-sort-preference";

function installFakeStorage(throwOnAccess = false): Map<string, string> {
    const store = new Map<string, string>();
    const fail = () => {
        throw new Error("storage unavailable");
    };
    const fake = {
        getItem: (key: string) => (throwOnAccess ? fail() : (store.get(key) ?? null)),
        setItem: (key: string, value: string) => (throwOnAccess ? fail() : void store.set(key, value)),
        removeItem: (key: string) => (throwOnAccess ? fail() : void store.delete(key)),
    };
    vi.stubGlobal("localStorage", fake);
    return store;
}

describe("commontext-sort-preference", () => {
    beforeEach(() => {
        vi.unstubAllGlobals();
    });

    it("falls back to the default key when nothing is stored", () => {
        installFakeStorage();
        expect(loadCommonTextSortKey()).toBe(DefaultCommonTextSortKey);
    });

    it("round-trips a non-default key", () => {
        installFakeStorage();
        saveCommonTextSortKey("usage-desc");
        expect(loadCommonTextSortKey()).toBe("usage-desc");
    });

    it("drops the storage entry when the value is the default key", () => {
        const store = installFakeStorage();
        saveCommonTextSortKey("created-desc");
        expect(store.size).toBe(1);
        saveCommonTextSortKey(DefaultCommonTextSortKey);
        expect(store.size).toBe(0);
    });

    it("normalizes a stale or corrupted stored value instead of trusting it", () => {
        const store = installFakeStorage();
        store.set("commontext:sortKey", "sort-by-vibes");
        expect(loadCommonTextSortKey()).toBe(DefaultCommonTextSortKey);
    });

    it("stays silent when localStorage is unavailable (private mode / quota)", () => {
        installFakeStorage(true);
        expect(() => saveCommonTextSortKey("title-asc")).not.toThrow();
        expect(loadCommonTextSortKey()).toBe(DefaultCommonTextSortKey);
    });
});
