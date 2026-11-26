// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";
import { TermWrap } from "./termwrap";

function makeMinimalTermWrap(): {
    wrap: TermWrap;
    processSpy: ReturnType<typeof vi.fn>;
} {
    const wrap = Object.create(TermWrap.prototype) as TermWrap;
    const processSpy = vi.fn();
    wrap.repaintScrollTimer = null;
    wrap.promptMarkers = [];
    wrap.webglContextLossDisposable = null;
    wrap.toDispose = [];
    wrap.terminal = { dispose: vi.fn() } as unknown as TermWrap["terminal"];
    wrap.mainFileSubject = { release: vi.fn() } as unknown as TermWrap["mainFileSubject"];
    wrap.processAndCacheData = processSpy;
    return { wrap, processSpy };
}

describe("TermWrap dispose idle timer cleanup", () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("cancels scheduled idle timer on dispose so processAndCacheData never fires again", () => {
        vi.useFakeTimers();
        const idleCallbacks = new Map<number, IdleRequestCallback>();
        let nextIdleId = 1;
        const origRIC = globalThis.window?.requestIdleCallback;
        const origCIC = globalThis.window?.cancelIdleCallback;

        const mockRIC = vi.fn((cb: IdleRequestCallback) => {
            const id = nextIdleId++;
            idleCallbacks.set(id, cb);
            return id;
        });
        const mockCIC = vi.fn((id: number) => {
            idleCallbacks.delete(id);
        });

        Object.defineProperty(globalThis, "window", {
            value: {
                ...(globalThis.window ?? {}),
                requestIdleCallback: mockRIC,
                cancelIdleCallback: mockCIC,
            },
            configurable: true,
            writable: true,
        });

        try {
            const { wrap, processSpy } = makeMinimalTermWrap();
            wrap.runProcessIdleTimeout();

            // Dispose before the 5s timeout fires — timer must be cancelled.
            wrap.dispose();
            vi.advanceTimersByTime(15_000);
            for (const cb of idleCallbacks.values()) {
                cb({ didTimeout: false, timeRemaining: () => 50 });
            }
            expect(processSpy).toHaveBeenCalledTimes(0);

            // Also test disposing while a requestIdleCallback is already queued.
            const second = makeMinimalTermWrap();
            second.wrap.runProcessIdleTimeout();
            vi.advanceTimersByTime(5_000);
            expect(mockRIC).toHaveBeenCalledTimes(1);
            second.wrap.dispose();
            expect(mockCIC).toHaveBeenCalledTimes(1);
            for (const cb of idleCallbacks.values()) {
                cb({ didTimeout: false, timeRemaining: () => 50 });
            }
            expect(second.processSpy).toHaveBeenCalledTimes(0);
        } finally {
            if (globalThis.window) {
                globalThis.window.requestIdleCallback = origRIC;
                globalThis.window.cancelIdleCallback = origCIC;
            }
        }
    });
});
