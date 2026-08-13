// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";

// os-notify.ts imports ./emain-window (heavy module graph) — mock it so the focus
// logic is testable with plain window stubs.
const h = vi.hoisted(() => {
    let focusedWindow: unknown = null;
    const windows: unknown[] = [];
    return {
        get focusedWindow() {
            return focusedWindow;
        },
        setFocusedWindow: (w: unknown) => {
            focusedWindow = w;
        },
        windows,
    };
});

vi.mock("electron", () => ({
    BrowserWindow: class {},
    Notification: class {
        on() {}
        show() {}
    },
}));
vi.mock("./emain-window", () => ({
    get focusedWaveWindow() {
        return h.focusedWindow;
    },
    getAllWaveWindows: () => h.windows,
}));

import { makeDefaultFocusApp, sendAgentOsNotification } from "./os-notify";

function makeStubWindow() {
    const order: string[] = [];
    const win = {
        isDestroyed: () => false,
        isMinimized: () => false,
        restore: vi.fn(() => order.push("restore")),
        show: vi.fn(() => order.push("show")),
        moveTop: vi.fn(() => order.push("moveTop")),
        setAlwaysOnTop: vi.fn((flag: boolean) => order.push(`alwaysOnTop:${flag}`)),
        focus: vi.fn(() => order.push("focus")),
        activeTabView: { webContents: { focus: vi.fn(() => order.push("wcFocus")) } },
    };
    return { win, order };
}

describe("makeDefaultFocusApp", () => {
    afterEach(() => {
        h.setFocusedWindow(null);
        h.windows.length = 0;
        vi.restoreAllMocks();
    });

    it("focuses the last-focused window and its active tab on non-Windows", () => {
        const { win, order } = makeStubWindow();
        h.setFocusedWindow(win);
        makeDefaultFocusApp("darwin")();
        expect(win.focus).toHaveBeenCalled();
        expect(order).toEqual(["show", "moveTop", "focus", "wcFocus"]);
    });

    it("forces focus above the Windows foreground lock with an always-on-top flip", () => {
        const { win, order } = makeStubWindow();
        h.setFocusedWindow(win);
        makeDefaultFocusApp("win32")();
        expect(order).toEqual(["show", "moveTop", "alwaysOnTop:true", "alwaysOnTop:false", "focus", "wcFocus"]);
    });

    it("restores a minimized window before focusing", () => {
        const { win, order } = makeStubWindow();
        win.isMinimized = () => true;
        h.setFocusedWindow(win);
        makeDefaultFocusApp("win32")();
        expect(order[0]).toBe("restore");
    });

    it("falls back to the first window when nothing was focused yet", () => {
        const { win } = makeStubWindow();
        h.windows.push(win);
        makeDefaultFocusApp("linux")();
        expect(win.focus).toHaveBeenCalled();
    });

    it("is a no-op when the window was destroyed", () => {
        const { win, order } = makeStubWindow();
        win.isDestroyed = () => true;
        h.setFocusedWindow(win);
        makeDefaultFocusApp("win32")();
        expect(order).toEqual([]);
    });
});

describe("sendAgentOsNotification", () => {
    const desc = { kind: "done" as const, blockId: "b1", provider: "pi" };

    function makeContext(overrides: Partial<Parameters<typeof sendAgentOsNotification>[1]> = {}) {
        const ctx = {
            settings: {
                masterEnabled: true,
                doneEnabled: true,
                blockedEnabled: true,
                notifyWhenFocused: false,
                blockedMinIntervalMs: 0,
            },
            isAnyWindowFocused: () => false,
            now: () => 0,
            lastFiredAt: () => 0,
            showNotification: vi.fn(),
            focusApp: vi.fn(),
            ...overrides,
        };
        return ctx;
    }

    it("wires the notification click to focusApp", () => {
        let capturedOnClick: (() => void) | undefined;
        const showNotification = vi.fn((opts: { onClick: () => void }) => {
            capturedOnClick = opts.onClick;
        });
        const focusApp = vi.fn();
        const outcome = sendAgentOsNotification(desc, makeContext({ showNotification, focusApp }));

        expect(outcome).toEqual({ fired: true });
        expect(showNotification).toHaveBeenCalledWith(
            expect.objectContaining({ silent: true, title: "Agent done — pi", body: expect.any(String) })
        );
        // Clicking the OS notification must actually run the focus-app path.
        capturedOnClick?.();
        expect(focusApp).toHaveBeenCalled();
    });

    it("fires a blocked notification with the blocked body text", () => {
        const showNotification = vi.fn();
        const outcome = sendAgentOsNotification(
            { kind: "blocked", blockId: "b1", provider: "codex" },
            makeContext({ showNotification })
        );
        expect(outcome).toEqual({ fired: true });
        expect(showNotification).toHaveBeenCalledWith(expect.objectContaining({ title: "Agent blocked — codex" }));
    });

    it("suppresses when the master switch is off", () => {
        const ctx = makeContext();
        ctx.settings.masterEnabled = false;
        expect(sendAgentOsNotification(desc, ctx)).toEqual({ fired: false, reason: "master-disabled" });
    });

    it("suppresses when the kind is disabled", () => {
        const ctx = makeContext();
        ctx.settings.doneEnabled = false;
        expect(sendAgentOsNotification(desc, ctx)).toEqual({ fired: false, reason: "kind-disabled" });
    });

    it("suppresses when any window is focused", () => {
        const ctx = makeContext({ isAnyWindowFocused: () => true });
        expect(sendAgentOsNotification(desc, ctx)).toEqual({ fired: false, reason: "window-focused" });
    });

    it("rate-limits blocked notifications below the min interval", () => {
        const ctx = makeContext({
            now: () => 10_000,
            lastFiredAt: () => 9_500,
        });
        ctx.settings.blockedMinIntervalMs = 2000;
        const outcome = sendAgentOsNotification({ kind: "blocked", blockId: "b1", provider: "pi" }, ctx);
        expect(outcome).toEqual({ fired: false, reason: "min-interval" });
    });
});
