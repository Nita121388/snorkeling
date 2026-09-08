// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { SessionOverviewModel } from "@/app/session-overview/session-overview-model";
import { globalStore } from "@/app/store/jotaiStore";
import * as WOS from "@/store/wos";
import { atom, createStore, PrimitiveAtom } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ackBumpAtom, agentStatusDoneAckStore } from "./agent-status-done-ack-store";
import { AgentStatusStore } from "./agent-status-store";
import { __resetTabAgentStatusDotAtomCacheForTests, getTabAgentStatusDotsAtom } from "./agent-status-tab-aggregate";
import type { AgentStatus } from "./agent-status-types";
import { statusFingerprint } from "./agent-status-unread";

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

        expect(rendererTwoStore.get(overview.agentStatusAckedFpAtom)["block-1"]).toBe(statusFingerprint(status));
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
        const blockOneStatus = makeStatus({});
        const blockTwoStatus = makeStatus({ blockId: "block-2", phase: "tool" });
        lsMock.localStorage.setItem(ACKED_AT_STORAGE_KEY, JSON.stringify({ "block-1": 1_000 }));
        lsMock.localStorage.setItem(
            ACKED_FP_STORAGE_KEY,
            JSON.stringify({ "block-1": statusFingerprint(blockOneStatus) })
        );

        overview.markAgentStatusAcked("block-2", 2_000, blockTwoStatus);

        expect(JSON.parse(lsMock.localStorage.getItem(ACKED_AT_STORAGE_KEY) ?? "{}")).toEqual({
            "block-1": 1_000,
            "block-2": 2_000,
        });
        expect(JSON.parse(lsMock.localStorage.getItem(ACKED_FP_STORAGE_KEY) ?? "{}")).toEqual({
            "block-1": statusFingerprint(blockOneStatus),
            "block-2": statusFingerprint(blockTwoStatus),
        });
    });

    it("does not let a delayed legacy fingerprint event delete current valid storage", () => {
        const overview = SessionOverviewModel.getInstance();
        const rendererTwoStore = createStore();
        const unsubscribe = rendererTwoStore.sub(overview.agentStatusAckedFpAtom, () => {});
        const blockOneFp = statusFingerprint(makeStatus({}));
        const currentValue = JSON.stringify({ "block-1": blockOneFp });
        lsMock.localStorage.setItem(ACKED_FP_STORAGE_KEY, currentValue);

        lsMock.dispatchStorage(ACKED_FP_STORAGE_KEY, JSON.stringify({ "block-old": 1_000 }));

        expect(lsMock.localStorage.getItem(ACKED_FP_STORAGE_KEY)).toBe(currentValue);
        expect(rendererTwoStore.get(overview.agentStatusAckedFpAtom)).toEqual({
            "block-1": blockOneFp,
        });
        unsubscribe();
    });

    it("re-lights C for a new blocked event but not a new working event across remounts", () => {
        const overview = SessionOverviewModel.getInstance();
        const rendererTwoStore = createStore();
        const tabAtom = atom({ blockids: ["block-1"] } as unknown as Tab);
        const blockAtom = atom({ blockid: "block-1", subblockids: [] } as unknown as Block);
        const acknowledged = makeStatus({ seq: 101, updatedAt: 1_000 });
        const statusAtom = atom<AgentStatus | null>(acknowledged);
        vi.spyOn(WOS, "getWaveObjectAtom").mockImplementation((oref: string) => {
            return (oref === WOS.makeORef("tab", "tab-1") ? tabAtom : blockAtom) as never;
        });
        vi.spyOn(AgentStatusStore, "getInstance").mockReturnValue({
            peekStatusAtom: () => statusAtom,
            peekPresentedStatusAtom: () => statusAtom,
        } as unknown as AgentStatusStore);
        let dotsAtom = getTabAgentStatusDotsAtom("tab-1");
        let unsubscribe = rendererTwoStore.sub(dotsAtom, () => {});
        expect(rendererTwoStore.get(dotsAtom)).toHaveLength(1);

        overview.markAgentStatusAcked("block-1", 1_500, acknowledged);
        lsMock.dispatchStorage(ACKED_FP_STORAGE_KEY);
        expect(rendererTwoStore.get(dotsAtom)).toEqual([]);

        unsubscribe();
        dotsAtom = getTabAgentStatusDotsAtom("tab-1");
        unsubscribe = rendererTwoStore.sub(dotsAtom, () => {});
        expect(rendererTwoStore.get(dotsAtom)).toEqual([]);

        const nextBlocked = makeStatus({ seq: 102, updatedAt: 2_000 });
        rendererTwoStore.set(statusAtom, nextBlocked);
        expect(rendererTwoStore.get(dotsAtom)).toMatchObject([{ kind: "R", state: "blocked" }]);

        overview.markAgentStatusAcked("block-1", 2_500, nextBlocked);
        lsMock.dispatchStorage(ACKED_FP_STORAGE_KEY);
        expect(rendererTwoStore.get(dotsAtom)).toEqual([]);

        rendererTwoStore.set(statusAtom, makeStatus({ state: "working", phase: "tool", seq: 103, updatedAt: 3_000 }));
        expect(rendererTwoStore.get(dotsAtom)).toEqual([]);
        unsubscribe();
    });
});

describe("S-class (stale) tab dots", () => {
    let lsMock: ReturnType<typeof makeLocalStorageMock>;

    beforeEach(() => {
        lsMock = makeLocalStorageMock();
        vi.stubGlobal("window", lsMock.windowMock);
        lsMock.localStorage.removeItem(ACKED_FP_STORAGE_KEY);
        lsMock.localStorage.removeItem(ACKED_AT_STORAGE_KEY);
        lsMock.localStorage.removeItem(DONE_ACK_STORAGE_KEY);
        globalStore.set(ackBumpAtom, 0);
        globalStore.set(agentStatusDoneAckStore.doneAckedAtAtom, {});
        globalStore.set(SessionOverviewModel.getInstance().agentStatusAckedAtAtom, {});
        globalStore.set(SessionOverviewModel.getInstance().agentStatusAckedFpAtom, {});
        __resetTabAgentStatusDotAtomCacheForTests();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    // 每个 blockId 一份独立 status atom + block atom, AgentStatusStore 的 peek* 按 blockId 分发.
    // 走 peekPresentedStatusAtom (而不是 peekStatusAtom): stale 是前端按阈值现算的, raw 里没有.
    function setupTab(tabId: string, statuses: Record<string, AgentStatus>) {
        const tabAtom = atom({ blockids: Object.keys(statuses) } as unknown as Tab);
        const statusAtoms = new Map<string, PrimitiveAtom<AgentStatus | null>>();
        const blockAtoms = new Map<string, PrimitiveAtom<Block>>();
        for (const [blockId, status] of Object.entries(statuses)) {
            statusAtoms.set(blockId, atom<AgentStatus | null>(status));
            blockAtoms.set(blockId, atom({ blockid: blockId, subblockids: [] } as unknown as Block));
        }
        vi.spyOn(WOS, "getWaveObjectAtom").mockImplementation((oref: string) => {
            if (oref === WOS.makeORef("tab", tabId)) return tabAtom as never;
            const blockId = oref.slice(oref.indexOf(":") + 1);
            return (blockAtoms.get(blockId) ??
                atom({ blockid: blockId, subblockids: [] } as unknown as Block)) as never;
        });
        vi.spyOn(AgentStatusStore, "getInstance").mockReturnValue({
            peekStatusAtom: (blockId: string) => statusAtoms.get(blockId) ?? null,
            peekPresentedStatusAtom: (blockId: string) => statusAtoms.get(blockId) ?? null,
        } as unknown as AgentStatusStore);
        return statusAtoms;
    }

    function staleStatus(blockId: string, staleForMs = 12 * 60_000): AgentStatus {
        return makeStatus({
            blockId,
            state: "stale",
            phase: "none",
            prevState: "working",
            updatedAt: Date.now() - staleForMs,
            completedAt: undefined,
        });
    }

    it("renders a purple S dot for an unacknowledged stale agent", () => {
        setupTab("tab-stale-1", { "block-1": staleStatus("block-1") });
        const dots = globalStore.get(getTabAgentStatusDotsAtom("tab-stale-1"));
        expect(dots).toHaveLength(1);
        expect(dots[0]).toMatchObject({
            kind: "S",
            state: "stale",
            color: "var(--agent-stale-color, #a855f7)",
        });
        expect(dots[0].title).toContain("no update for");
        expect(dots[0].elapsedText).toBe("12m");
    });

    it("drops the S dot once the stale status is acknowledged (决策 2: stale 可 ack)", () => {
        const stale = staleStatus("block-1");
        setupTab("tab-stale-2", { "block-1": stale });
        const overview = SessionOverviewModel.getInstance();
        const rendererTwoStore = createStore();
        const dotsAtom = getTabAgentStatusDotsAtom("tab-stale-2");
        const unsubscribe = rendererTwoStore.sub(dotsAtom, () => {});
        expect(rendererTwoStore.get(dotsAtom)).toHaveLength(1);

        overview.markAgentStatusAcked("block-1", Date.now(), stale);
        lsMock.dispatchStorage(ACKED_FP_STORAGE_KEY);
        expect(rendererTwoStore.get(dotsAtom)).toEqual([]);
        unsubscribe();
    });

    it("orders D above blocked above S", () => {
        const nowMs = Date.now();
        const done = makeStatus({
            blockId: "b-done",
            state: "idle",
            phase: "none",
            prevState: "working",
            completedAt: nowMs - 60_000,
            updatedAt: nowMs,
        });
        const blocked = makeStatus({ blockId: "b-blocked", state: "blocked", phase: "approval", updatedAt: nowMs });
        setupTab("tab-stale-3", {
            "b-stale": staleStatus("b-stale"),
            "b-blocked": blocked,
            "b-done": done,
        });
        const dots = globalStore.get(getTabAgentStatusDotsAtom("tab-stale-3"));
        expect(dots.map((dot) => [dot.kind, dot.blockId])).toEqual([
            ["D", "b-done"],
            ["R", "b-blocked"],
            ["S", "b-stale"],
        ]);
    });
});
