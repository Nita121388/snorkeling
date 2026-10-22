// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    powerMonitor: {
        getSystemIdleTime: () => 0,
    },
}));
vi.mock("./emain-window", () => ({
    get focusedWaveWindow() {
        return h.focusedWindow;
    },
    getAllWaveWindows: () => h.windows,
}));

import {
    AgentOsNotifyGate,
    AgentOsNotifyState,
    decideSuppression,
    makeDefaultFocusApp,
    sendAgentOsNotification,
} from "./os-notify";

const baseSettings = {
    masterEnabled: true,
    doneEnabled: true,
    blockedEnabled: true,
    notifyWhenFocused: false,
    blockedMinIntervalMs: 0,
    idleMinMs: 30000,
    cooldownMs: 60000,
};

const emptyState = (overrides: Partial<AgentOsNotifyState> = {}): AgentOsNotifyState => ({
    lastFiredByBlock: 0,
    lastSeenByBlockKind: 0,
    lastFiredByKind: 0,
    ...overrides,
});

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
            settings: { ...baseSettings },
            isAnyWindowFocused: () => false,
            now: () => 0,
            userIdleSeconds: () => 60,
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
        const outcome = sendAgentOsNotification(desc, makeContext({ showNotification, focusApp }), emptyState());

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
            makeContext({ showNotification }),
            emptyState()
        );
        expect(outcome).toEqual({ fired: true });
        expect(showNotification).toHaveBeenCalledWith(expect.objectContaining({ title: "Agent blocked — codex" }));
    });

    it("suppresses when the master switch is off", () => {
        const ctx = makeContext();
        ctx.settings.masterEnabled = false;
        expect(sendAgentOsNotification(desc, ctx, emptyState())).toEqual({
            fired: false,
            reason: "master-disabled",
        });
    });

    it("suppresses when the kind is disabled", () => {
        const ctx = makeContext();
        ctx.settings.doneEnabled = false;
        expect(sendAgentOsNotification(desc, ctx, emptyState())).toEqual({
            fired: false,
            reason: "kind-disabled",
        });
    });

    it("suppresses when any window is focused", () => {
        const ctx = makeContext({ isAnyWindowFocused: () => true });
        expect(sendAgentOsNotification(desc, ctx, emptyState())).toEqual({
            fired: false,
            reason: "window-focused",
        });
    });

    it("notifies while a Snorkeling window is focused when notifyWhenFocused is on", () => {
        const ctx = makeContext({ isAnyWindowFocused: () => true });
        ctx.settings.notifyWhenFocused = true;
        expect(sendAgentOsNotification(desc, ctx, emptyState())).toEqual({ fired: true });
    });

    it("suppresses while the user is still active on the machine", () => {
        const ctx = makeContext({ userIdleSeconds: () => 5 });
        expect(sendAgentOsNotification(desc, ctx, emptyState())).toEqual({
            fired: false,
            reason: "user-active",
        });
    });

    it("does not suppress when the platform reports no idle time", () => {
        const ctx = makeContext({ userIdleSeconds: () => 0 });
        expect(sendAgentOsNotification(desc, ctx, emptyState())).toEqual({ fired: true });
    });

    it("suppresses a duplicate report of the same event", () => {
        const ctx = makeContext({ now: () => 10_000 });
        const state = emptyState({ lastSeenByBlockKind: 9_500 });
        expect(sendAgentOsNotification(desc, ctx, state)).toEqual({ fired: false, reason: "duplicate" });
    });

    it("suppresses a second event of the same kind inside the cooldown window", () => {
        const ctx = makeContext({ now: () => 10_000 });
        const state = emptyState({ lastFiredByKind: 9_500 });
        expect(sendAgentOsNotification(desc, ctx, state)).toEqual({ fired: false, reason: "cooldown" });
    });

    it("rate-limits blocked notifications below the min interval", () => {
        const ctx = makeContext({
            now: () => 10_000,
        });
        ctx.settings.blockedMinIntervalMs = 2000;
        const outcome = sendAgentOsNotification(
            { kind: "blocked", blockId: "b1", provider: "pi" },
            ctx,
            emptyState({ lastFiredByBlock: 9_500 })
        );
        expect(outcome).toEqual({ fired: false, reason: "min-interval" });
    });

    it("keeps the old behavior when the idle check and the cooldown are disabled", () => {
        const ctx = makeContext({ now: () => 10_000, userIdleSeconds: () => 1 });
        ctx.settings.idleMinMs = 0;
        ctx.settings.cooldownMs = 0;
        const state = emptyState({ lastFiredByKind: 9_500, lastSeenByBlockKind: 9_500 });
        expect(decideSuppression(desc, ctx, state)).toBeNull();
        expect(sendAgentOsNotification(desc, ctx, state)).toEqual({ fired: true });
    });
});

describe("AgentOsNotifyGate", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-10-22T00:00:00Z"));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    function makeCtx(overrides: Partial<Parameters<AgentOsNotifyGate["offer"]>[1]> = {}) {
        return {
            settings: { ...baseSettings },
            isAnyWindowFocused: () => false,
            now: () => Date.now(),
            userIdleSeconds: () => 60,
            showNotification: vi.fn(),
            focusApp: vi.fn(),
            ...overrides,
        };
    }

    const done = (blockId: string) => ({ kind: "done" as const, blockId, provider: "pi" });

    it("fires the first event of a kind immediately", () => {
        const gate = new AgentOsNotifyGate();
        const ctx = makeCtx();
        expect(gate.offer(done("b1"), ctx)).toEqual({ fired: true });
        expect(ctx.showNotification).toHaveBeenCalledTimes(1);
    });

    it("merges the events of the cooldown window into one summary", () => {
        const gate = new AgentOsNotifyGate();
        const ctx = makeCtx();
        gate.offer(done("b1"), ctx);
        for (let i = 2; i <= 10; i++) {
            vi.advanceTimersByTime(100);
            const outcome = gate.offer(done(`b${i}`), ctx);
            expect(outcome).toEqual({ fired: false, reason: "cooldown", merged: true });
        }
        // Only the leading notification so far.
        expect(ctx.showNotification).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(60_000);
        expect(ctx.showNotification).toHaveBeenCalledTimes(2);
        const summary = ctx.showNotification.mock.calls[1][0];
        expect(summary.title).toBe("Agents done");
        expect(summary.body).toContain("9 agents finished");
    });

    it("drops a duplicate report of the same event without inflating the summary", () => {
        const gate = new AgentOsNotifyGate();
        const ctx = makeCtx();
        gate.offer(done("b1"), ctx);
        vi.advanceTimersByTime(500);
        // A second renderer reports the very same completion.
        expect(gate.offer(done("b1"), ctx)).toEqual({ fired: false, reason: "duplicate" });

        vi.advanceTimersByTime(60_000);
        expect(ctx.showNotification).toHaveBeenCalledTimes(1);
    });

    it("keeps the done and blocked cooldown windows independent", () => {
        const gate = new AgentOsNotifyGate();
        const ctx = makeCtx();
        gate.offer(done("b1"), ctx);
        const blocked = { kind: "blocked" as const, blockId: "b1", provider: "pi" };
        expect(gate.offer(blocked, ctx)).toEqual({ fired: true });
        expect(ctx.showNotification).toHaveBeenCalledTimes(2);
    });

    it("does not notify while the user is active", () => {
        const gate = new AgentOsNotifyGate();
        const ctx = makeCtx({ userIdleSeconds: () => 2 });
        expect(gate.offer(done("b1"), ctx)).toEqual({ fired: false, reason: "user-active" });
        expect(ctx.showNotification).not.toHaveBeenCalled();
    });

    it("notifies once the user has been idle long enough", () => {
        const gate = new AgentOsNotifyGate();
        const ctx = makeCtx({ userIdleSeconds: () => 60 });
        expect(gate.offer(done("b1"), ctx)).toEqual({ fired: true });
    });

    it("does not fire again while the user keeps working", () => {
        const gate = new AgentOsNotifyGate();
        let idle = 60;
        const ctx = makeCtx({ userIdleSeconds: () => idle });
        expect(gate.offer(done("b1"), ctx)).toEqual({ fired: true });
        idle = 1;
        expect(gate.offer(done("b2"), ctx)).toEqual({ fired: false, reason: "user-active" });
        expect(ctx.showNotification).toHaveBeenCalledTimes(1);
    });

    it("drops the summary when the user came back before the window closed", async () => {
        const gate = new AgentOsNotifyGate();
        let idle = 60;
        const ctx = makeCtx({ userIdleSeconds: () => idle });
        gate.offer(done("b1"), ctx);
        vi.advanceTimersByTime(100);
        gate.offer(done("b2"), ctx);
        idle = 1;
        vi.advanceTimersByTime(60_000);
        await vi.advanceTimersByTimeAsync(0);
        expect(ctx.showNotification).toHaveBeenCalledTimes(1);
    });

    it("fires every event when the cooldown is disabled", () => {
        const gate = new AgentOsNotifyGate();
        const ctx = makeCtx();
        ctx.settings.cooldownMs = 0;
        expect(gate.offer(done("b1"), ctx)).toEqual({ fired: true });
        expect(gate.offer(done("b2"), ctx)).toEqual({ fired: true });
        expect(ctx.showNotification).toHaveBeenCalledTimes(2);
    });

    it("fires every event when the idle check is disabled", () => {
        const gate = new AgentOsNotifyGate();
        const ctx = makeCtx({ userIdleSeconds: () => 1 });
        ctx.settings.idleMinMs = 0;
        expect(gate.offer(done("b1"), ctx)).toEqual({ fired: true });
    });
});

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
