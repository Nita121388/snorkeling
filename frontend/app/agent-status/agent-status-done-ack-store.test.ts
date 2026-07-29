// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentStatusDoneAckStore, observeAgentStatusTransition } from "./agent-status-done-ack-store";
import type { AgentStatus } from "./agent-status-types";
import { globalStore } from "@/app/store/jotaiStore";
import { createStore } from "jotai";

const STORAGE_KEY = "snorkeling:agent-status:done-acked-at";

// localStorage backed by a Map — store.ts uses window.localStorage.{getItem,setItem,removeItem}.
function makeLocalStorageMock() {
    const store = new Map<string, string>();
    const listeners = new Set<(event: StorageEvent) => void>();
    const localStorage = {
        getItem: vi.fn((key: string) => store.get(key) ?? null),
        setItem: vi.fn((key: string, value: string) => {
            store.set(key, String(value));
        }),
        removeItem: vi.fn((key: string) => {
            store.delete(key);
        }),
        clear: vi.fn(() => store.clear()),
        _store: store,
    } as const;
    const windowMock = {
        localStorage,
        addEventListener: vi.fn((type: string, listener: (event: StorageEvent) => void) => {
            if (type === "storage") listeners.add(listener);
        }),
        removeEventListener: vi.fn((type: string, listener: (event: StorageEvent) => void) => {
            if (type === "storage") listeners.delete(listener);
        }),
    };
    return {
        localStorage,
        windowMock,
        dispatchStorage(key: string, newValue = localStorage.getItem(key)) {
            const event = {
                key,
                newValue,
                storageArea: localStorage,
            } as unknown as StorageEvent;
            for (const listener of listeners) listener(event);
        },
    };
}

function makeStatus(state: AgentStatus["state"], overrides: Partial<AgentStatus> = {}): AgentStatus {
    return {
        blockId: "block-1",
        provider: "codex",
        state,
        phase: state === "idle" ? "none" : "thinking",
        source: "hook",
        confidence: "high",
        updatedAt: 1_790_000_000_000,
        ...overrides,
    };
}

describe("agentStatusDoneAckStore", () => {
    let lsMock: ReturnType<typeof makeLocalStorageMock>;

    beforeEach(() => {
        lsMock = makeLocalStorageMock();
        vi.stubGlobal("window", lsMock.windowMock);
        lsMock.localStorage.removeItem(STORAGE_KEY);
        globalStore.set(agentStatusDoneAckStore.doneAckedAtAtom, {});
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        globalStore.set(agentStatusDoneAckStore.doneAckedAtAtom, {});
    });

    it("markDoneAcked writes per-block ack + persists to localStorage", () => {
        agentStatusDoneAckStore.markDoneAcked("block-1", 1_000);
        expect(agentStatusDoneAckStore.getDoneAckedAt("block-1")).toBe(1_000);
        expect(JSON.parse(lsMock.localStorage.getItem(STORAGE_KEY) ?? "{}")).toEqual({ "block-1": 1000 });
    });

    it("updates a second renderer store after another renderer acknowledges a block", () => {
        const rendererTwoStore = createStore();
        const unsubscribe = rendererTwoStore.sub(agentStatusDoneAckStore.doneAckedAtAtom, () => {});

        agentStatusDoneAckStore.markDoneAcked("block-1", 1_000);
        expect(rendererTwoStore.get(agentStatusDoneAckStore.doneAckedAtAtom)["block-1"]).toBeUndefined();

        lsMock.dispatchStorage(STORAGE_KEY);

        expect(rendererTwoStore.get(agentStatusDoneAckStore.doneAckedAtAtom)["block-1"]).toBe(1_000);
        unsubscribe();
    });

    it("merges the latest persisted map and ignores a delayed older storage event", () => {
        const rendererTwoStore = createStore();
        const unsubscribe = rendererTwoStore.sub(agentStatusDoneAckStore.doneAckedAtAtom, () => {});
        const delayedValue = JSON.stringify({ "block-1": 1_000 });
        lsMock.localStorage.setItem(STORAGE_KEY, delayedValue);

        agentStatusDoneAckStore.markDoneAcked("block-2", 2_000);

        expect(JSON.parse(lsMock.localStorage.getItem(STORAGE_KEY) ?? "{}")).toEqual({
            "block-1": 1_000,
            "block-2": 2_000,
        });
        lsMock.dispatchStorage(STORAGE_KEY, delayedValue);
        expect(rendererTwoStore.get(agentStatusDoneAckStore.doneAckedAtAtom)).toEqual({
            "block-1": 1_000,
            "block-2": 2_000,
        });
        unsubscribe();
    });

    it("clears from the latest persisted map when the local atom is stale", () => {
        lsMock.localStorage.setItem(STORAGE_KEY, JSON.stringify({ "block-1": 1_000, "block-2": 2_000 }));

        agentStatusDoneAckStore.clearDoneAcked("block-1");

        expect(JSON.parse(lsMock.localStorage.getItem(STORAGE_KEY) ?? "{}")).toEqual({ "block-2": 2_000 });
    });

    it("clearDoneAcked removes the block id without touching others", () => {
        agentStatusDoneAckStore.markDoneAcked("block-1", 1_000);
        agentStatusDoneAckStore.markDoneAcked("block-2", 2_000);
        agentStatusDoneAckStore.clearDoneAcked("block-1");
        expect(agentStatusDoneAckStore.getDoneAckedAt("block-1")).toBe(0);
        expect(agentStatusDoneAckStore.getDoneAckedAt("block-2")).toBe(2_000);
        expect(JSON.parse(lsMock.localStorage.getItem(STORAGE_KEY) ?? "{}")).toEqual({ "block-2": 2000 });
    });

    it("clearDoneAcked is a no-op when the block has no ack", () => {
        agentStatusDoneAckStore.markDoneAcked("block-1", 1_000);
        agentStatusDoneAckStore.clearDoneAcked("block-missing");
        expect(agentStatusDoneAckStore.getDoneAckedAt("block-1")).toBe(1_000);
    });

    it("getDoneAckedAt returns 0 for unknown block id", () => {
        expect(agentStatusDoneAckStore.getDoneAckedAt("block-missing")).toBe(0);
    });
});

describe("observeAgentStatusTransition", () => {
    let lsMock: ReturnType<typeof makeLocalStorageMock>;

    beforeEach(() => {
        lsMock = makeLocalStorageMock();
        vi.stubGlobal("window", lsMock.windowMock);
        lsMock.localStorage.removeItem(STORAGE_KEY);
        globalStore.set(agentStatusDoneAckStore.doneAckedAtAtom, {});
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        globalStore.set(agentStatusDoneAckStore.doneAckedAtAtom, {});
    });

    it("entering non-idle clears doneAckedAt for that block (next idle can re-light D)", () => {
        agentStatusDoneAckStore.markDoneAcked("block-1", 5_000);
        observeAgentStatusTransition(makeStatus("working", { prevState: "idle" }));
        expect(agentStatusDoneAckStore.getDoneAckedAt("block-1")).toBe(0);
    });

    it("entering idle does NOT clear ackedAt (idle itself is not an ack-trigger)", () => {
        agentStatusDoneAckStore.markDoneAcked("block-1", 5_000);
        observeAgentStatusTransition(makeStatus("idle", { prevState: "working" }));
        expect(agentStatusDoneAckStore.getDoneAckedAt("block-1")).toBe(5_000);
    });

    it("null status is a no-op", () => {
        agentStatusDoneAckStore.markDoneAcked("block-1", 5_000);
        observeAgentStatusTransition(null);
        expect(agentStatusDoneAckStore.getDoneAckedAt("block-1")).toBe(5_000);
    });

    it("unknown state does not clear ack (kept to be safe — unknown is not a real start)", () => {
        agentStatusDoneAckStore.markDoneAcked("block-1", 5_000);
        observeAgentStatusTransition(makeStatus("unknown", { prevState: "working" }));
        expect(agentStatusDoneAckStore.getDoneAckedAt("block-1")).toBe(5_000);
    });
});
