// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { BrowserWindow, Notification, powerMonitor } from "electron";
import { AGENT_OS_NOTIFY_DEFAULTS } from "@/util/sharedconst";
import { focusedWaveWindow, getAllWaveWindows } from "./emain-window";

// Encapsulates the OS-level notification pipeline for agent-status state transitions.
//
// Public surface (AgentOsNotifyGate) owns the mutable suppression state; everything else —
// settings read, focused-window suppression, idle detection, cooldown/merging, click → focus-app,
// Notification instance — stays here.
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
    // Min ms of system-wide idleness required before a notification may be shown.
    // 0 disables the idle check (every event notifies, pre-2026-10 behavior).
    idleMinMs: number;
    // Per-kind cooldown window in ms. Events inside the window are merged into one summary
    // notification when the window ends. 0 disables cooldown and merging.
    cooldownMs: number;
}

export interface AgentOsNotifyContext {
    settings: AgentOsNotifySettings;
    // True if any Snorkeling window is currently focused.
    isAnyWindowFocused: () => boolean;
    // Epoch-ms timestamp. Pluggable for tests.
    now: () => number;
    // System-wide idle time in seconds (no keyboard/mouse input anywhere on the machine).
    // 0 means the platform does not report an idle time — callers must not treat that as "active".
    userIdleSeconds: () => number;
    // Fire the underlying Notification.
    showNotification: (opts: { title: string; body: string; silent: boolean; onClick: () => void }) => void;
    // Bring the app to the foreground. POC: window-level focus only — per-block tab focus
    // needs a main-process blockId→tabId index that does not exist yet; deferred.
    focusApp: () => void;
}

// Snapshot of the gate's mutable state, read at decision time. Kept as plain numbers so the
// suppression decision stays a pure function of (descriptor, context, state).
export interface AgentOsNotifyState {
    // Last time a notification actually fired for (blockId, kind). 0 = never.
    lastFiredByBlock: number;
    // Last time an event for (kind, blockId) was seen. Used to collapse the duplicate
    // reports that multiple renderers emit for the same agent event. 0 = never.
    lastSeenByBlockKind: number;
    // Last time a notification actually fired for a kind. Drives the per-kind cooldown. 0 = never.
    lastFiredByKind: number;
}

export type SendAgentOsNotifyReason =
    | "master-disabled"
    | "kind-disabled"
    | "window-focused"
    | "user-active"
    | "duplicate"
    | "cooldown"
    | "min-interval";

export type SendAgentOsNotificationOutcome =
    | { fired: true }
    | { fired: false; reason: SendAgentOsNotifyReason; merged?: boolean };

// Default values for the two knobs that have no setting yet. They are applied by the caller
// (emain-wsh) when the corresponding settings key is absent, so the Go side keeps the
// "unset != false" semantics of the *bool/*int64 settings fields. The canonical copy lives in
// frontend/util/sharedconst.ts — the Wave Config panel shows the same numbers.
export const DefaultAgentOsNotifyIdleMinMs = AGENT_OS_NOTIFY_DEFAULTS.idleMinMs;
export const DefaultAgentOsNotifyCooldownMs = AGENT_OS_NOTIFY_DEFAULTS.cooldownMs;

const blockStateKey = (blockId: string, kind: AgentOsNotifyKind) => `${blockId}#${kind}`;
const kindBlockStateKey = (kind: AgentOsNotifyKind, blockId: string) => `${kind}#${blockId}`;

/**
 * Pure suppression decision — exposed for unit tests.
 * Returns null to fire, or a short reason string explaining why it was suppressed.
 *
 * The order is fixed and ordered cheapest-check-first (see design.md §2):
 *   1. master switch  2. kind switch  3. focused window  4. user is active
 *   5. duplicate (cross-window)  6. per-kind cooldown  7. per-block blocked interval
 */
export function decideSuppression(
    desc: AgentOsNotificationDescriptor,
    ctx: AgentOsNotifyContext,
    state: AgentOsNotifyState
): SendAgentOsNotifyReason | null {
    if (!ctx.settings.masterEnabled) return "master-disabled";
    if (!isKindEnabled(ctx.settings, desc.kind)) return "kind-disabled";
    if (ctx.isAnyWindowFocused() && !ctx.settings.notifyWhenFocused) return "window-focused";
    if (isUserActive(ctx)) return "user-active";
    if (isDuplicateEvent(desc, ctx, state)) return "duplicate";
    if (isInCooldown(desc, ctx, state)) return "cooldown";

    const intervalMs = settingsToIntervalMs(ctx.settings, desc.kind);
    if (intervalMs > 0) {
        const lastMs = state.lastFiredByBlock;
        if (lastMs !== 0 && ctx.now() - lastMs < intervalMs) {
            return "min-interval";
        }
    }
    return null;
}

// The user is "active" while they are still touching the machine. A system idle time of 0 means
// the platform does not report one — that must NOT suppress, or notifications would go silent
// forever on those platforms.
function isUserActive(ctx: AgentOsNotifyContext): boolean {
    const idleMinMs = ctx.settings.idleMinMs;
    if (idleMinMs <= 0) return false;
    const idleSec = ctx.userIdleSeconds();
    if (idleSec <= 0) return false;
    return idleSec * 1000 < idleMinMs;
}

// Two renderers (two Snorkeling windows) both observe the same agent event and both report it.
// The first report is remembered; the second one within the cooldown window is dropped — and
// dropped without counting, so the merged summary does not over-report.
function isDuplicateEvent(
    desc: AgentOsNotificationDescriptor,
    ctx: AgentOsNotifyContext,
    state: AgentOsNotifyState
): boolean {
    const cooldownMs = ctx.settings.cooldownMs;
    if (cooldownMs <= 0) return false;
    const seenAt = state.lastSeenByBlockKind;
    if (seenAt === 0) return false;
    return ctx.now() - seenAt < cooldownMs;
}

function isInCooldown(
    desc: AgentOsNotificationDescriptor,
    ctx: AgentOsNotifyContext,
    state: AgentOsNotifyState
): boolean {
    const cooldownMs = ctx.settings.cooldownMs;
    if (cooldownMs <= 0) return false;
    const lastFired = state.lastFiredByKind;
    if (lastFired === 0) return false;
    return ctx.now() - lastFired < cooldownMs;
}

function isKindEnabled(s: AgentOsNotifySettings, kind: AgentOsNotifyKind): boolean {
    switch (kind) {
        case "done":
            return s.doneEnabled;
        case "blocked":
            return s.blockedEnabled;
    }
}

// Only "blocked" carries a per-block min-interval today (Done is one-shot, no spam risk).
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

// Summary copy for the events that the cooldown window swallowed. Provider-agnostic on purpose:
// the merged events may come from different providers.
function buildSummaryTitleAndBody(kind: AgentOsNotifyKind, count: number): { title: string; body: string } {
    switch (kind) {
        case "done":
            return {
                title: "Agents done",
                body: `${count} ${count === 1 ? "agent" : "agents"} finished. Click to return to the app.`,
            };
        case "blocked":
            return {
                title: "Agents blocked",
                body: `${count} ${count === 1 ? "agent is" : "agents are"} waiting for input. Click to switch to the app.`,
            };
    }
}

/**
 * Decide whether to fire and, if so, fire. Returns the outcome — the caller records
 * a successful fire into its own last-fired state so the next call can rate-limit.
 */
export function sendAgentOsNotification(
    desc: AgentOsNotificationDescriptor,
    ctx: AgentOsNotifyContext,
    state: AgentOsNotifyState
): SendAgentOsNotificationOutcome {
    const reason = decideSuppression(desc, ctx, state);
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

// Summary of the events that were swallowed by the cooldown window. Emitted when the window
// closes so nothing is silently dropped.
function sendSummaryNotification(
    kind: AgentOsNotifyKind,
    count: number,
    ctx: AgentOsNotifyContext
): void {
    const { title, body } = buildSummaryTitleAndBody(kind, count);
    ctx.showNotification({
        title,
        body,
        silent: true,
        onClick: () => ctx.focusApp(),
    });
}

export interface AgentOsNotifyGateOptions {
    // Re-read the settings when a cooldown window closes, so a setting change made during the
    // window (e.g. the user turning notifications off) is honored. Optional: without it the
    // settings snapshot captured when the event was merged is reused.
    loadSettings?: () => Promise<AgentOsNotifySettings>;
}

/**
 * Owns every piece of mutable notification state. Lives in the main process so the suppression
 * decision stays consistent across renderer crashes / reloads and across multiple windows.
 *
 * Per-kind cooldown with trailing summary:
 *   - the first event of a kind fires immediately;
 *   - further events of the same kind inside the cooldown window are counted, not dropped;
 *   - when the window closes, one summary notification reports the count.
 */
export class AgentOsNotifyGate {
    private lastFiredByBlock = new Map<string, number>();
    private lastSeenByBlockKind = new Map<string, number>();
    private lastFiredByKind = new Map<string, number>();
    private pendingByKind = new Map<AgentOsNotifyKind, { count: number; timer: ReturnType<typeof setTimeout> | null }>();

    private readonly options: AgentOsNotifyGateOptions;

    constructor(options: AgentOsNotifyGateOptions = {}) {
        this.options = options;
    }

    offer(desc: AgentOsNotificationDescriptor, ctx: AgentOsNotifyContext): SendAgentOsNotificationOutcome {
        const now = ctx.now();
        const state = this.readState(desc, now);
        const reason = decideSuppression(desc, ctx, state);

        // "duplicate" must not be recorded: the first report of the event already recorded it.
        // master/kind disabled are "the whole feature is off" — recording there would suppress
        // a legitimate event that arrives right after the user re-enables notifications.
        if (reason !== "duplicate" && reason !== "master-disabled" && reason !== "kind-disabled") {
            this.lastSeenByBlockKind.set(kindBlockStateKey(desc.kind, desc.blockId), now);
        }

        if (reason == null) {
            this.lastFiredByBlock.set(blockStateKey(desc.blockId, desc.kind), now);
            this.lastFiredByKind.set(desc.kind, now);
            // A fresh notification supersedes whatever the previous window had queued.
            this.clearPending(desc.kind);
            return sendAgentOsNotification(desc, ctx, state);
        }

        if (reason === "cooldown") {
            this.mergeIntoPending(desc, ctx, now, state);
            return { fired: false, reason, merged: true };
        }

        return { fired: false, reason };
    }

    private readState(desc: AgentOsNotificationDescriptor, _now: number): AgentOsNotifyState {
        return {
            lastFiredByBlock: this.lastFiredByBlock.get(blockStateKey(desc.blockId, desc.kind)) ?? 0,
            lastSeenByBlockKind: this.lastSeenByBlockKind.get(kindBlockStateKey(desc.kind, desc.blockId)) ?? 0,
            lastFiredByKind: this.lastFiredByKind.get(desc.kind) ?? 0,
        };
    }

    private mergeIntoPending(
        desc: AgentOsNotificationDescriptor,
        ctx: AgentOsNotifyContext,
        now: number,
        state: AgentOsNotifyState
    ): void {
        const cooldownMs = ctx.settings.cooldownMs;
        if (cooldownMs <= 0) return;
        const existing = this.pendingByKind.get(desc.kind);
        if (existing != null) {
            existing.count++;
            return;
        }
        // The window closes when the cooldown that started at the last fired notification ends.
        const remaining = state.lastFiredByKind === 0 ? cooldownMs : state.lastFiredByKind + cooldownMs - now;
        const delay = Math.max(0, remaining);
        const entry = { count: 1, timer: null as ReturnType<typeof setTimeout> | null };
        entry.timer = setTimeout(() => {
            void this.flushSummary(desc.kind, ctx);
        }, delay);
        this.pendingByKind.set(desc.kind, entry);
    }

    private clearPending(kind: AgentOsNotifyKind): void {
        const entry = this.pendingByKind.get(kind);
        if (entry == null) return;
        if (entry.timer != null) clearTimeout(entry.timer);
        this.pendingByKind.delete(kind);
    }

    private async flushSummary(kind: AgentOsNotifyKind, ctx: AgentOsNotifyContext): Promise<void> {
        const entry = this.pendingByKind.get(kind);
        if (entry == null || entry.count === 0) return;
        this.pendingByKind.delete(kind);
        if (entry.timer != null) clearTimeout(entry.timer);
        const settings = this.options.loadSettings ? await this.options.loadSettings() : ctx.settings;
        const summaryCtx: AgentOsNotifyContext = { ...ctx, settings };
        // The user is back at the keyboard — the in-app indicator already tells them, so the
        // summary would only be an interruption.
        if (isUserActive(summaryCtx)) return;

        sendSummaryNotification(kind, entry.count, summaryCtx);
        this.lastFiredByKind.set(kind, summaryCtx.now());
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

// System-wide idle time in seconds. Returns 0 when the platform does not report one — the
// suppression logic treats that as "unknown" and lets the notification through.
export function defaultUserIdleSeconds(): number {
    try {
        const idle = powerMonitor.getSystemIdleTime();
        return Number.isFinite(idle) && idle > 0 ? idle : 0;
    } catch {
        return 0;
    }
}

export function makeDefaultFocusApp(platform: NodeJS.Platform = process.platform): () => void {
    // POC: pull the last-focused wave window to the foreground on click. Per-block
    // navigation is a follow-up once the main process has a blockId→(windowId,tabId) index.
    return () => {
        const win = focusedWaveWindow ?? getAllWaveWindows()[0];
        if (!win || win.isDestroyed()) return;

        // Windows holds a foreground lock — a background process's plain focus() is usually
        // ignored when a toast is clicked, and focus() is a no-op on a minimized window.
        // restore + show + moveTop + an always-on-top flip force the window above the lock;
        // keep the flip win32-only to avoid z-order churn on mac/linux.
        if (win.isMinimized()) win.restore();
        win.show();
        win.moveTop();
        if (platform === "win32") {
            win.setAlwaysOnTop(true);
            win.setAlwaysOnTop(false);
        }
        win.focus();
        win.activeTabView?.webContents?.focus();
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
