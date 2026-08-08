// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { BrowserWindow, Notification } from "electron";
import { getAllWaveWindows } from "./emain-window";

// Encapsulates the OS-level notification pipeline for agent-status state transitions.
//
// Public surface (sendAgentOsNotification) takes a typed descriptor produced by the FE
// (the agent-status store's observer). Everything else — settings read, focused-window
// suppression, click → focus-app, Notification instance — stays here.
//
// Extension: to add a new state, append a case to buildTitleAndBody and isKindEnabled.
// The FE dispatcher controls which kinds ever reach this module.

export type AgentOsNotifyKind = "done" | "blocked";

export interface AgentOsNotificationDescriptor {
    kind: AgentOsNotifyKind;
    blockId: string;
    provider: string;
    // Optional human label for body. If omitted, derived from provider/kind in buildTitleAndBody.
    body?: string;
}

export interface AgentOsNotifySettings {
    masterEnabled: boolean;
    doneEnabled: boolean;
    blockedEnabled: boolean;
    // If false, suppress when ANY Snorkeling window has focus (POC: simple suppression).
    notifyWhenFocused: boolean;
    // Min ms between blocked notifications for the same block. 0 = no rate limit.
    blockedMinIntervalMs: number;
}

export interface AgentOsNotifyContext {
    settings: AgentOsNotifySettings;
    // True if any Snorkeling window is currently focused.
    isAnyWindowFocused: () => boolean;
    // Epoch-ms timestamp. Pluggable for tests.
    now: () => number;
    // Per-block last-fired timestamp (epoch ms) for rate limiting. Held by the caller
    // across calls; the module itself is stateless so it stays unit-testable.
    lastFiredAt: (blockId: string, kind: AgentOsNotifyKind) => number;
    // Fire the underlying Notification.
    showNotification: (opts: { title: string; body: string; silent: boolean; onClick: () => void }) => void;
    // Bring the app to the foreground. POC: window-level focus only — per-block tab focus
    // needs a main-process blockId→tabId index that does not exist yet; deferred.
    focusApp: () => void;
}

export type SendAgentOsNotifyReason =
    | "master-disabled"
    | "kind-disabled"
    | "window-focused"
    | "min-interval";

export type SendAgentOsNotificationOutcome =
    | { fired: true }
    | { fired: false; reason: SendAgentOsNotifyReason };

/**
 * Decide whether to fire and, if so, fire. Returns the outcome — the caller records
 * a successful fire into its own last-fired state so the next call can rate-limit.
 */
export function sendAgentOsNotification(
    desc: AgentOsNotificationDescriptor,
    ctx: AgentOsNotifyContext
): SendAgentOsNotificationOutcome {
    const reason = decideSuppression(desc, ctx);
    if (reason != null) return { fired: false, reason };

    const { title, body } = buildTitleAndBody(desc);
    ctx.showNotification({
        title,
        body,
        // Agent state transitions are user-relevant but not surprising; keep the system sound off
        // so back-to-back cycles in an agentic loop don't become audio spam.
        // (Per-kind sound is a future extension vector.)
        silent: true,
        onClick: () => ctx.focusApp(),
    });
    return { fired: true };
}

/**
 * Pure suppression decision — exposed for unit tests.
 * Returns null to fire, or a short reason string explaining why it was suppressed.
 */
export function decideSuppression(
    desc: AgentOsNotificationDescriptor,
    ctx: AgentOsNotifyContext
): SendAgentOsNotifyReason | null {
    if (!ctx.settings.masterEnabled) return "master-disabled";
    if (!isKindEnabled(ctx.settings, desc.kind)) return "kind-disabled";
    if (ctx.isAnyWindowFocused()) return "window-focused";

    const intervalMs = settingsToIntervalMs(ctx.settings, desc.kind);
    if (intervalMs > 0) {
        const lastMs = ctx.lastFiredAt(desc.blockId, desc.kind);
        if (lastMs !== 0 && ctx.now() - lastMs < intervalMs) {
            return "min-interval";
        }
    }
    return null;
}

function isKindEnabled(s: AgentOsNotifySettings, kind: AgentOsNotifyKind): boolean {
    switch (kind) {
        case "done":
            return s.doneEnabled;
        case "blocked":
            return s.blockedEnabled;
    }
}

// Only "blocked" carries a min-interval today (Done is one-shot, no spam risk).
function settingsToIntervalMs(s: AgentOsNotifySettings, kind: AgentOsNotifyKind): number {
    if (kind === "blocked") return s.blockedMinIntervalMs;
    return 0;
}

function buildTitleAndBody(desc: AgentOsNotificationDescriptor): { title: string; body: string } {
    const providerLabel = desc.provider || "Agent";
    switch (desc.kind) {
        case "done":
            return {
                title: `Agent done — ${providerLabel}`,
                body: desc.body ?? "Agent finished. Click to return to the app.",
            };
        case "blocked":
            return {
                title: `Agent blocked — ${providerLabel}`,
                body: desc.body ?? "Agent is waiting for input. Click to switch to the app.",
            };
    }
}

// ---------------- Production wiring ----------------
// These default implementations are injected by emain-wsh.handle_notify. Kept here so the
// click → focus path lives next to the notification that produces it.

export function defaultIsAnyWindowFocused(): boolean {
    for (const win of getAllWaveWindows()) {
        const bw = win as unknown as BrowserWindow;
        if (bw.isFocused?.()) return true;
    }
    return false;
}

export function makeDefaultFocusApp(): () => void {
    // POC: pull any wave window to the foreground on click. Per-block navigation is a
    // follow-up once the main process has a blockId→(windowId,tabId) index.
    return () => {
        const anyWin = getAllWaveWindows()[0] as unknown as BrowserWindow | undefined;
        anyWin?.focus?.();
    };
}

export function defaultShowNotification(opts: {
    title: string;
    body: string;
    silent: boolean;
    onClick: () => void;
}): void {
    const n = new Notification({
        title: opts.title,
        body: opts.body,
        silent: opts.silent,
    });
    n.on("click", opts.onClick);
    n.show();
}
