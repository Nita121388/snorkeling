// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ackBumpAtom, agentStatusDoneAckStore } from "./agent-status-done-ack-store";
import { __resetTabAgentStatusDotAtomCacheForTests, getTabAgentStatusDotsAtom } from "./agent-status-tab-aggregate";
import { AgentStatusStore } from "./agent-status-store";
import type { AgentStatus } from "./agent-status-types";
import { globalStore } from "@/app/store/jotaiStore";
import { SessionOverviewModel } from "@/app/session-overview/session-overview-model";
import * as WOS from "@/store/wos";
import { atom, createStore } from "jotai";

const ACKED_FP_STORAGE_KEY = "snorkeling:agent-status:acked-fp";
const ACKED_AT_STORAGE_KEY = "snorkeling:session-overview:agent-status-acked-at";
const DONE_ACK_STORAGE_KEY = "snorkeling:agent-status:done-acked-at";

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

function makeStatus(overrides: Partial<AgentStatus>): AgentStatus {
    return {
        blockId: "block-1",
        provider: "codex",
        state: "blocked",
        prevState: "working",
        phase: "approval",
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
        vi.stubGlobal("window", lsMock.windowMock);
        lsMock.localStorage.removeItem(ACKED_FP_STORAGE_KEY);
        lsMock.localStorage.removeItem(ACKED_AT_STORAGE_KEY);
        lsMock.localStorage.removeItem(DONE_ACK_STORAGE_KEY);
        globalStore.set(ackBumpAtom, 0);
        globalStore.set(SessionOverviewModel.getInstance().agentStatusAckedAtAtom, {});
        globalStore.set(SessionOverviewModel.getInstance().agentStatusAckedFpAtom, {});
        __resetTabAgentStatusDotAtomCacheForTests();
    });

    afterEach(() => {
        vi.restoreAllMocks();
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

    it("updates a second renderer store after another renderer acknowledges a blocked state", () => {
        const overview = SessionOverviewModel.getInstance();
        const rendererTwoStore = createStore();
        const unsubscribe = rendererTwoStore.sub(overview.agentStatusAckedFpAtom, () => {});
        const status = makeStatus({});

        overview.markAgentStatusAcked("block-1", 1_000, status);
        expect(rendererTwoStore.get(overview.agentStatusAckedFpAtom)["block-1"]).toBeUndefined();

        lsMock.dispatchStorage(ACKED_FP_STORAGE_KEY);

        expect(rendererTwoStore.get(overview.agentStatusAckedFpAtom)["block-1"]).toBe(
            "blocked|approval|hook"
        );
        unsubscribe();
    });

    it("updates a second renderer timestamp store after another renderer acknowledges a blocked state", () => {
        const overview = SessionOverviewModel.getInstance();
        const rendererTwoStore = createStore();
        const unsubscribe = rendererTwoStore.sub(overview.agentStatusAckedAtAtom, () => {});

        overview.markAgentStatusAcked("block-1", 1_000, makeStatus({}));
        expect(rendererTwoStore.get(overview.agentStatusAckedAtAtom)["block-1"]).toBeUndefined();

        lsMock.dispatchStorage(ACKED_AT_STORAGE_KEY);

        expect(rendererTwoStore.get(overview.agentStatusAckedAtAtom)["block-1"]).toBe(1_000);
        unsubscribe();
    });

    it("merges the latest persisted R ack maps before writing from a stale renderer", () => {
        const overview = SessionOverviewModel.getInstance();
        lsMock.localStorage.setItem(ACKED_AT_STORAGE_KEY, JSON.stringify({ "block-1": 1_000 }));
        lsMock.localStorage.setItem(ACKED_FP_STORAGE_KEY, JSON.stringify({ "block-1": "blocked|approval|hook" }));

        overview.markAgentStatusAcked("block-2", 2_000, makeStatus({ blockId: "block-2", phase: "tool" }));

        expect(JSON.parse(lsMock.localStorage.getItem(ACKED_AT_STORAGE_KEY) ?? "{}")).toEqual({
            "block-1": 1_000,
            "block-2": 2_000,
        });
        expect(JSON.parse(lsMock.localStorage.getItem(ACKED_FP_STORAGE_KEY) ?? "{}")).toEqual({
            "block-1": "blocked|approval|hook",
            "block-2": "blocked|tool|hook",
        });
    });

    it("does not let a delayed legacy fingerprint event delete current valid storage", () => {
        const overview = SessionOverviewModel.getInstance();
        const rendererTwoStore = createStore();
        const unsubscribe = rendererTwoStore.sub(overview.agentStatusAckedFpAtom, () => {});
        const currentValue = JSON.stringify({ "block-1": "blocked|approval|hook" });
        lsMock.localStorage.setItem(ACKED_FP_STORAGE_KEY, currentValue);

        lsMock.dispatchStorage(ACKED_FP_STORAGE_KEY, JSON.stringify({ "block-old": 1_000 }));

        expect(lsMock.localStorage.getItem(ACKED_FP_STORAGE_KEY)).toBe(currentValue);
        expect(rendererTwoStore.get(overview.agentStatusAckedFpAtom)).toEqual({
            "block-1": "blocked|approval|hook",
        });
        unsubscribe();
    });

    it("clears C across renderer remounts and lights it again only for a new fingerprint", () => {
        const overview = SessionOverviewModel.getInstance();
        const rendererTwoStore = createStore();
        const tabAtom = atom({ blockids: ["block-1"] } as unknown as Tab);
        const blockAtom = atom({ blockid: "block-1", subblockids: [] } as unknown as Block);
        const statusAtom = atom<AgentStatus | null>(makeStatus({ updatedAt: 1_000 }));
        vi.spyOn(WOS, "getWaveObjectAtom").mockImplementation((oref: string) => {
            return (oref === WOS.makeORef("tab", "tab-1") ? tabAtom : blockAtom) as never;
        });
        vi.spyOn(AgentStatusStore, "getInstance").mockReturnValue({
            peekStatusAtom: () => statusAtom,
        } as unknown as AgentStatusStore);
        let dotsAtom = getTabAgentStatusDotsAtom("tab-1");
        let unsubscribe = rendererTwoStore.sub(dotsAtom, () => {});
        expect(rendererTwoStore.get(dotsAtom)).toHaveLength(1);

        overview.markAgentStatusAcked("block-1", 1_500, makeStatus({ updatedAt: 1_000 }));
        lsMock.dispatchStorage(ACKED_FP_STORAGE_KEY);
        expect(rendererTwoStore.get(dotsAtom)).toEqual([]);

        unsubscribe();
        dotsAtom = getTabAgentStatusDotsAtom("tab-1");
        unsubscribe = rendererTwoStore.sub(dotsAtom, () => {});
        expect(rendererTwoStore.get(dotsAtom)).toEqual([]);

        rendererTwoStore.set(statusAtom, makeStatus({ phase: "tool", updatedAt: 2_000 }));
        expect(rendererTwoStore.get(dotsAtom)).toHaveLength(1);
        unsubscribe();
    });
});
