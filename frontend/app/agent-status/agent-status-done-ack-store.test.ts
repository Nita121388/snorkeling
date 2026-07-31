// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentStatusDoneAckStore, observeAgentStatusTransition, _resetLastObservedForTests } from "./agent-status-done-ack-store";
import type { AgentStatus } from "./agent-status-types";
import { globalStore } from "@/app/store/jotaiStore";
import { createStore } from "jotai";

// Mock the OS-notify dispatcher so observer tests can assert caller behavior without a live RPC.
// fireAgentOsNotification's own classifier-based no-fire is unit-tested in agent-status-notify.test.ts.
// vi.hoisted lifts the spy above the vi.mock factory so the factory (which itself is hoisted above
// imports) closes over a defined binding rather than a TDZ reference.
const { fireAgentOsNotificationMock } = vi.hoisted(() => ({ fireAgentOsNotificationMock: vi.fn() }));
vi.mock("@/app/agent-status/agent-status-notify", () => ({
    fireAgentOsNotification: (...args: unknown[]) => fireAgentOsNotificationMock(...args),
}));

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
        fireAgentOsNotificationMock.mockReset();
        _resetLastObservedForTests();
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
        fireAgentOsNotificationMock.mockReset();
        _resetLastObservedForTests();
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

describe("observeAgentStatusTransition OS-toast dispatch", () => {
    beforeEach(() => {
        globalStore.set(agentStatusDoneAckStore.doneAckedAtAtom, {});
        fireAgentOsNotificationMock.mockReset();
        _resetLastObservedForTests();
    });

    afterEach(() => {
        globalStore.set(agentStatusDoneAckStore.doneAckedAtAtom, {});
    });

    // The observer's contract is one-shot per transition: every call to observeAgentStatusTransition
    // forwards (next, prev) to fireAgentOsNotification exactly once. The fire/no-fire decision is
    // owned by decideNotifyKind inside fireAgentOsNotification — that's unit-tested separately in
    // agent-status-notify.test.ts. Here we assert the *observer* correctly threads prev (its real
    // job) so the classifier has the info it needs to do its job.

    it("threads prev through to fireAgentOsNotification on working → idle", () => {
        observeAgentStatusTransition(makeStatus("working"));
        observeAgentStatusTransition(makeStatus("idle"));
        // Two observer calls → two dispatcher calls; the LAST one is the transition we care about.
        const lastCall = fireAgentOsNotificationMock.mock.calls.at(-1)!;
        const [next, prev] = lastCall;
        expect(next.state).toBe("idle");
        expect(prev?.state).toBe("working");
    });

    it("threads prev through to fireAgentOsNotification on * → blocked", () => {
        observeAgentStatusTransition(makeStatus("working"));
        observeAgentStatusTransition(makeStatus("blocked"));
        const lastCall = fireAgentOsNotificationMock.mock.calls.at(-1)!;
        const [next, prev] = lastCall;
        expect(next.state).toBe("blocked");
        expect(prev?.state).toBe("working");
    });

    it("passes prev=undefined on the FIRST transition for a block (renderer warm-start)", () => {
        observeAgentStatusTransition(makeStatus("idle"));
        // First call ever for this block → no prior snapshot in lastObservedByBlock.
        expect(fireAgentOsNotificationMock).toHaveBeenCalledTimes(1);
        const [, prev] = fireAgentOsNotificationMock.mock.calls[0];
        // Undefined (not null): lastObservedByBlock.get on a miss. The TS signature is
        // AgentStatus | null but Map.get returns undefined; the classifier treats both as "no prev"
        // via `prev == null`. Production semantics preserved.
        expect(prev).toBeUndefined();
    });

    it("threads prev on every working → working wobble (classifier decides no-fire separately)", () => {
        observeAgentStatusTransition(makeStatus("working"));
        observeAgentStatusTransition(makeStatus("working"));
        expect(fireAgentOsNotificationMock).toHaveBeenCalledTimes(2);
        const [firstNext, firstPrev] = fireAgentOsNotificationMock.mock.calls[0];
        const [secondNext, secondPrev] = fireAgentOsNotificationMock.mock.calls[1];
        expect(firstNext.state).toBe("working");
        expect(firstPrev).toBeUndefined();
        expect(secondNext.state).toBe("working");
        expect(secondPrev?.state).toBe("working");
    });

    it("null next is a no-op: fireAgentOsNotification is NOT called for that event", () => {
        observeAgentStatusTransition(makeStatus("working"));
        observeAgentStatusTransition(null);
        // The null branch returns before fireAgentOsNotification is touched.
        expect(fireAgentOsNotificationMock).toHaveBeenCalledTimes(1);
    });

    it("isolates prev-state per blockId (block-2's first transition sees undefined regardless of block-1 history)", () => {
        observeAgentStatusTransition(makeStatus("working", { blockId: "block-1" }));
        observeAgentStatusTransition(makeStatus("idle", { blockId: "block-1" }));
        // block-2 is fresh — its first event should report prev=undefined even though block-1 has history.
        observeAgentStatusTransition(makeStatus("idle", { blockId: "block-2" }));
        const block2Call = fireAgentOsNotificationMock.mock.calls.at(-1)!;
        const [next, prev] = block2Call;
        expect(next.blockId).toBe("block-2");
        expect(prev).toBeUndefined();
    });
});
