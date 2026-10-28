// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    __resetAgentPersonasForTests,
    clearAgentPersona,
    getAgentPersonaSnapshot,
    normalizeAgentPersonaKey,
    setAgentPersona,
    subscribeAgentPersonas,
} from "./persona-store";

const KEY = "snorkeling:agent-personas";

// This project's Node/jsdom does not expose localStorage (Node >= 22.11), so tests
// inject the same minimal Storage mock the other storage tests use.
function createLocalStorageMock(): Storage {
    const store = new Map<string, string>();
    return {
        get length() {
            return store.size;
        },
        clear: () => store.clear(),
        getItem: (key: string) => store.get(key) ?? null,
        key: (index: number) => [...store.keys()][index] ?? null,
        removeItem: (key: string) => store.delete(key),
        setItem: (key: string, value: string) => store.set(key, value),
    };
}

let storage: Storage;

beforeEach(() => {
    storage = createLocalStorageMock();
    vi.stubGlobal("window", { localStorage: storage });
});

afterEach(() => {
    __resetAgentPersonasForTests();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("normalizeAgentPersonaKey", () => {
    it("trims and lowercases", () => {
        expect(normalizeAgentPersonaKey("  Claude ")).toBe("claude");
        expect(normalizeAgentPersonaKey("CODEX")).toBe("codex");
        expect(normalizeAgentPersonaKey(null)).toBe("");
    });
});

describe("agent persona store", () => {
    it("reads back what it writes", () => {
        setAgentPersona("claude", "🐱");
        expect(getAgentPersonaSnapshot()).toEqual({ claude: "🐱" });
        expect(JSON.parse(storage.getItem(KEY) ?? "{}")).toEqual({ claude: "🐱" });
    });

    it("clears a persona and removes the storage key when empty", () => {
        setAgentPersona("claude", "🐱");
        clearAgentPersona("claude");
        expect(getAgentPersonaSnapshot()).toEqual({});
        expect(storage.getItem(KEY)).toBeNull();
    });

    it("ignores the generic 'agent' key", () => {
        setAgentPersona("agent", "🐱");
        expect(getAgentPersonaSnapshot()).toEqual({});
        expect(storage.getItem(KEY)).toBeNull();
    });

    it("falls back to {} on bad JSON at module load", async () => {
        storage.setItem(KEY, "{not json");
        vi.resetModules();
        const fresh = await import("./persona-store");
        expect(fresh.getAgentPersonaSnapshot()).toEqual({});
    });

    it("notifies subscribers on change", () => {
        const listener = vi.fn();
        const unsubscribe = subscribeAgentPersonas(listener);
        setAgentPersona("pi", "🚀");
        expect(listener).toHaveBeenCalledTimes(1);
        unsubscribe();
        setAgentPersona("pi", "🛰️");
        expect(listener).toHaveBeenCalledTimes(1);
    });
});
