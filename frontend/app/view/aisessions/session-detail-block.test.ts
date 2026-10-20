// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";

vi.mock("@/store/global", () => ({
    atoms: { staticTabId: {} },
    createBlock: vi.fn(),
    createBlockSplitHorizontally: vi.fn(),
    globalStore: { get: () => null },
    refocusNode: vi.fn(),
    WOS: { getWaveObjectAtom: vi.fn(), makeORef: vi.fn() },
}));
vi.mock("@/store/services", () => ({ ObjectService: { CreateBlock: vi.fn() } }));
vi.mock("@/layout/lib/layoutModelHooks", () => ({ getLayoutModelForStaticTab: vi.fn() }));

import { isSessionDetailMeta, planSessionDetailOpen } from "./session-detail-block";

describe("isSessionDetailMeta", () => {
    it("recognizes an aisessions detail block", () => {
        expect(isSessionDetailMeta({ view: "aisessions", "aisessions:sessionid": "abc" } as any)).toBe(true);
    });

    it("rejects the plain list block (no session id)", () => {
        expect(isSessionDetailMeta({ view: "aisessions" } as any)).toBe(false);
        expect(isSessionDetailMeta({ view: "aisessions", "aisessions:sessionid": "  " } as any)).toBe(false);
    });

    it("rejects other view types and null", () => {
        expect(isSessionDetailMeta({ view: "term", "aisessions:sessionid": "abc" } as any)).toBe(false);
        expect(isSessionDetailMeta(null)).toBe(false);
    });
});

describe("planSessionDetailOpen", () => {
    const base = { sessionId: "s1", forceNewBlock: false, existingBlockId: null, hostBlockId: null };

    it("focuses the already-open block for the same session", () => {
        expect(planSessionDetailOpen({ ...base, existingBlockId: "b1", hostBlockId: "b1" })).toEqual({
            kind: "focus",
            blockId: "b1",
        });
    });

    it("opens a new session as a Tab in the existing detail host", () => {
        expect(planSessionDetailOpen({ ...base, existingBlockId: null, hostBlockId: "host" })).toEqual({
            kind: "tab",
            hostBlockId: "host",
        });
    });

    it("splits when there is no detail block yet", () => {
        expect(planSessionDetailOpen(base)).toEqual({ kind: "split" });
    });

    it("Ctrl+click force-splits even when a detail block exists", () => {
        expect(
            planSessionDetailOpen({ ...base, forceNewBlock: true, existingBlockId: "b1", hostBlockId: "b1" })
        ).toEqual({ kind: "split" });
    });
});
