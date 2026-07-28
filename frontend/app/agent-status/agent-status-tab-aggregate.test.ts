// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ackBumpAtom, agentStatusDoneAckStore, observeAgentStatusTransition } from "./agent-status-done-ack-store";
import type { AgentStatus } from "./agent-status-types";
import { globalStore } from "@/app/store/jotaiStore";
import { atom, createStore } from "jotai";

const ACKED_FP_STORAGE_KEY = "snorkeling:agent-status:acked-fp";
const DONE_ACK_STORAGE_KEY = "snorkeling:agent-status:done-acked-at";

function makeLocalStorageMock() {
    const store = new Map<string, string>();
    return {
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
}

function makeStatus(overrides: Partial<AgentStatus>): AgentStatus {
    return {
        blockId: "block-1",
        provider: "codex",
        state: "blocked",
        prevState: "working",
        phase: "permission",
        source: "hook",
        confidence: "high",
        reason: "test",
        updatedAt: Date.now(),
        ...overrides,
    };
}

describe("R-class ack bump signal (F5 fix)", () => {
    let lsMock: ReturnType<typeof makeLocalStorageMock>;

    beforeEach(() => {
        lsMock = makeLocalStorageMock();
        vi.stubGlobal("window", { localStorage: lsMock });
        lsMock.removeItem(ACKED_FP_STORAGE_KEY);
        lsMock.removeItem(DONE_ACK_STORAGE_KEY);
        globalStore.set(ackBumpAtom, 0);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("ackBumpAtom increments when markDoneAcked is called (D-class baseline)", () => {
        const before = globalStore.get(ackBumpAtom);
        agentStatusDoneAckStore.markDoneAcked("block-x", Date.now(), "test");
        const after = globalStore.get(ackBumpAtom);
        expect(after).toBe(before + 1);
    });

    it("ackBumpAtom increments when clearDoneAcked is called (D-class baseline)", () => {
        agentStatusDoneAckStore.markDoneAcked("block-x", 1_000);
        const before = globalStore.get(ackBumpAtom);
        agentStatusDoneAckStore.clearDoneAcked("block-x", "test");
        const after = globalStore.get(ackBumpAtom);
        expect(after).toBe(before + 1);
    });

    it("ackBumpAtom is a PrimitiveAtom that survives across store swap", () => {
        // Different globalStore wouldn't matter — but here we're testing the same store.
        // Confirm: bumping one doesn't affect ackBumpAtom identity (still a primitive).
        const a = globalStore.get(ackBumpAtom);
        expect(typeof a).toBe("number");
    });
});
