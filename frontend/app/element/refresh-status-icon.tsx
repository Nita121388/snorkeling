// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Tooltip } from "@/app/element/tooltip";
import { cn, makeIconClass } from "@/util/util";
import { useEffect, useState } from "react";

/**
 * Refresh status for the icon button.
 * - idle: no active refresh, data is fresh (<30s)
 * - syncing: a refresh is in progress
 * - stale: data exists but hasn't been refreshed for a while (>=30s)
 * - autoEnabled: auto-refresh is on (shows interval badge)
 * - error: last refresh failed
 */
export type RefreshStatus = "idle" | "syncing" | "stale" | "autoEnabled" | "error";

interface RefreshStatusIconProps {
    status: RefreshStatus;
    /** Timestamp (ms) of the last successful refresh */
    lastRefreshAt?: number;
    /** Auto-refresh interval in ms, or 0 if disabled */
    autoRefreshIntervalMs?: number;
    /** Tooltip override */
    tooltip?: string;
    className?: string;
}

function formatElapsed(ms: number): string {
    if (ms < 10_000) return "just now";
    if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
    const minutes = Math.floor(ms / 60_000);
    if (minutes < 60) return `${minutes}m ago`;
    return `${Math.floor(minutes / 60)}h ago`;
}

function formatCountdown(ms: number): string {
    const seconds = Math.ceil(ms / 1000);
    if (seconds <= 0) return "now";
    if (seconds < 60) return `${seconds}s`;
    return `${Math.ceil(seconds / 60)}m`;
}

const STATUS_CONFIG: Record<RefreshStatus, { icon: string; className: string; ariaLabel: string }> = {
    idle: { icon: "fa-circle-check", className: "text-secondary", ariaLabel: "Up to date" },
    syncing: { icon: "fa-arrows-rotate", className: "text-accent", ariaLabel: "Syncing" },
    stale: { icon: "fa-clock-rotate-left", className: "text-secondary", ariaLabel: "Data may be stale" },
    autoEnabled: { icon: "fa-rotate", className: "text-accent", ariaLabel: "Auto-refresh active" },
    error: { icon: "fa-plug-circle-xmark", className: "text-error", ariaLabel: "Connection error" },
};

/**
 * Renders a small status icon that communicates refresh state.
 *
 * Usage in endIconButtons:
 * ```ts
 * icon: <RefreshStatusIcon status="syncing" lastRefreshAt={Date.now()} />
 * ```
 */
export function RefreshStatusIcon({
    status,
    lastRefreshAt,
    autoRefreshIntervalMs,
    tooltip: tooltipOverride,
    className,
}: RefreshStatusIconProps) {
    const [now, setNow] = useState(Date.now());

    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 5_000);
        return () => window.clearInterval(timer);
    }, []);

    const cfg = STATUS_CONFIG[status];
    const elapsed = lastRefreshAt && lastRefreshAt > 0 ? now - lastRefreshAt : 0;
    const nextAuto = autoRefreshIntervalMs && autoRefreshIntervalMs > 0 && lastRefreshAt
        ? Math.max(0, autoRefreshIntervalMs - elapsed)
        : 0;

    let tooltip = tooltipOverride;
    if (!tooltip) {
        if (status === "syncing") {
            tooltip = "Syncing sessions…";
        } else if (status === "error") {
            tooltip = "Refresh failed — click to retry";
        } else if (status === "autoEnabled" && nextAuto > 0) {
            tooltip = `Auto-refresh in ${formatCountdown(nextAuto)} (last: ${formatElapsed(elapsed)})`;
        } else if (elapsed > 0) {
            tooltip = `Last synced ${formatElapsed(elapsed)}`;
        } else {
            tooltip = "Up to date";
        }
    }

    return (
        <Tooltip content={tooltip} placement="bottom" hideOnClick divClassName="inline-flex">
            <span className={cn("inline-flex items-center gap-1 text-[11px]", cfg.className, className)}>
                <i
                    className={cn(
                        "fa-sharp fa-solid text-[11px]",
                        cfg.icon,
                        status === "syncing" && "animate-spin"
                    )}
                    aria-label={cfg.ariaLabel}
                />
                {status === "autoEnabled" && autoRefreshIntervalMs && autoRefreshIntervalMs > 0 && (
                    <span className="rounded bg-accent/10 px-1 py-px text-[9px] font-medium leading-none text-accent">
                        Auto
                    </span>
                )}
            </span>
        </Tooltip>
    );
}

/**
 * Derives a RefreshStatus from the current ViewModel state.
 */
export function deriveRefreshStatus(opts: {
    loading: boolean;
    autoRefreshEnabled: boolean;
    autoRefreshIntervalMs: number;
    lastRefreshAt: number;
    error: string;
    now: number;
}): RefreshStatus {
    const { loading, autoRefreshEnabled, autoRefreshIntervalMs, lastRefreshAt, error, now } = opts;

    if (loading) return "syncing";
    if (error) return "error";
    if (autoRefreshEnabled && autoRefreshIntervalMs > 0) return "autoEnabled";
    if (lastRefreshAt > 0 && now - lastRefreshAt >= 30_000) return "stale";
    return "idle";
}
