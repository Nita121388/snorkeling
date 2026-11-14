// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    clearOptimisticActiveTab,
    optimisticActiveTabClearTimeoutMs,
    optimisticActiveTabIdAtom,
    resolveHighlightTabId,
    setOptimisticActiveTab,
} from "./tab-optimistic-active";

describe("optimistic active tab highlight", () => {
    beforeEach(() => {
        vi.useRealTimers();
        clearOptimisticActiveTab();
    });

    it("sets the optimistic value and clears it on demand", () => {
        setOptimisticActiveTab("t2");
        expect(globalStore.get(optimisticActiveTabIdAtom)).toBe("t2");
        clearOptimisticActiveTab();
        expect(globalStore.get(optimisticActiveTabIdAtom)).toBeNull();
    });

    it("auto-clears after the safety timeout", () => {
        vi.useFakeTimers();
        setOptimisticActiveTab("t3");
        expect(globalStore.get(optimisticActiveTabIdAtom)).toBe("t3");
        vi.advanceTimersByTime(optimisticActiveTabClearTimeoutMs + 10);
        expect(globalStore.get(optimisticActiveTabIdAtom)).toBeNull();
        vi.useRealTimers();
    });

    it("keeps only the latest click when tabs are clicked rapidly", () => {
        setOptimisticActiveTab("t1");
        setOptimisticActiveTab("t2");
        expect(globalStore.get(optimisticActiveTabIdAtom)).toBe("t2");
    });

    it("ignores blank tab ids", () => {
        setOptimisticActiveTab("t1");
        setOptimisticActiveTab("");
        expect(globalStore.get(optimisticActiveTabIdAtom)).toBe("t1");
    });

    it("resolves highlight as optimistic value first, static tab id otherwise", () => {
        expect(resolveHighlightTabId("t1", "t0")).toBe("t1");
        expect(resolveHighlightTabId(null, "t0")).toBe("t0");
    });
});
