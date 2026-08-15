// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Tooltip } from "@/app/element/tooltip";
import { copyText } from "@/util/clipboard";
import { useCallback, useEffect, useRef, useState } from "react";

type CopyStatus = "idle" | "copied" | "failed";

function formatEndpoint(label: string, endpoint: DevRuntimeEndpoint | null): string {
    if (endpoint == null) {
        return `${label}: Disabled`;
    }
    const requested = endpoint.requestedPort === endpoint.port ? "" : ` (requested ${endpoint.requestedPort})`;
    return `${label}: ${endpoint.url}${requested}`;
}

/** Copy payload for the main button: just the CDP endpoint, ready to paste. */
export function formatCdpCopy(runtime: DevRuntimeInfo): string {
    return runtime.cdp?.url ?? "CDP: Disabled";
}

export function formatDevRuntimeCopy(runtime: DevRuntimeInfo): string {
    const lines = [
        "Snorkeling Dev Runtime",
        `Profile: ${runtime.profile}`,
        `Branch: ${runtime.gitBranch ?? "n/a"}`,
        `Port mode: ${runtime.portMode}`,
        formatEndpoint("Vite", runtime.vite),
        formatEndpoint("CDP", runtime.cdp),
    ];
    if (runtime.appVersion != null) {
        lines.push(`App: ${runtime.appVersion}`);
    }
    if (runtime.dirs != null) {
        lines.push(`Data: ${runtime.dirs.data}`);
        lines.push(`Config: ${runtime.dirs.config}`);
        lines.push(`Log: ${runtime.dirs.logFile}`);
    }
    if (runtime.cdpJsonUrl != null) {
        lines.push(`CDP JSON: ${runtime.cdpJsonUrl}`);
    }
    if (runtime.inspectCommand != null) {
        lines.push(`Inspect: ${runtime.inspectCommand}`);
    }
    return lines.join("\n");
}

function isMainlineBranch(branch: string | null): boolean {
    return branch === "main" || branch === "master";
}

function EndpointValue({ endpoint, disabledLabel }: { endpoint: DevRuntimeEndpoint | null; disabledLabel: string }) {
    if (endpoint == null) {
        return <span className="text-secondary">{disabledLabel}</span>;
    }
    return (
        <div className="min-w-0 font-mono text-[11px] leading-4">
            <div className="break-all text-foreground">{endpoint.url}</div>
            {endpoint.requestedPort !== endpoint.port && (
                <div className="text-secondary">requested {endpoint.requestedPort}</div>
            )}
        </div>
    );
}

function PathValue({ label, value }: { label: string; value: string | null }) {
    return value == null ? null : (
        <>
            <span className="text-secondary">{label}</span>
            <span className="min-w-0 break-all font-mono text-[11px] text-foreground">{value}</span>
        </>
    );
}

function DevRuntimeTooltipContent({
    runtime,
    copyStatus,
    onCopyFull,
}: {
    runtime: DevRuntimeInfo;
    copyStatus: CopyStatus;
    onCopyFull: () => void;
}) {
    const feedback = copyStatus === "copied" ? "Copied" : copyStatus === "failed" ? "Copy failed" : null;
    return (
        <div className="w-[280px] p-1.5">
            <div className="mb-2 flex h-5 items-center justify-between gap-3">
                <span className="text-sm font-semibold text-foreground">Dev Runtime</span>
                <button
                    type="button"
                    aria-label="Copy full dev runtime info"
                    title="Copy full dev runtime info"
                    aria-live="polite"
                    className={`border-0 bg-transparent p-0 text-sm ${copyStatus === "failed" ? "text-error" : "text-secondary"} hover:text-foreground`}
                    onClick={onCopyFull}
                >
                    {feedback ?? <i className="fa fa-regular fa-copy" aria-hidden="true" />}
                </button>
            </div>
            <div className="grid grid-cols-[68px_minmax(0,1fr)] gap-x-3 gap-y-2">
                <span className="text-secondary">Profile</span>
                <span className="min-w-0 break-all font-mono text-[11px] text-foreground">{runtime.profile}</span>
                <span className="text-secondary">Branch</span>
                <span className="min-w-0 break-all font-mono text-[11px] text-foreground">
                    {runtime.gitBranch ?? "n/a"}
                </span>
                <span className="text-secondary">Port mode</span>
                <span className="font-mono text-[11px] text-foreground">{runtime.portMode}</span>
                <span className="text-secondary">Vite</span>
                <EndpointValue endpoint={runtime.vite} disabledLabel="Unavailable" />
                <span className="text-secondary">CDP</span>
                <EndpointValue endpoint={runtime.cdp} disabledLabel="Disabled" />
                {(runtime.appVersion != null || runtime.electronVersion != null || runtime.nodeVersion != null) && (
                    <>
                        <span className="text-secondary">版本</span>
                        <span className="min-w-0 break-all font-mono text-[11px] text-foreground">
                            {[
                                runtime.appVersion,
                                runtime.electronVersion && `Electron ${runtime.electronVersion}`,
                                runtime.nodeVersion && `Node ${runtime.nodeVersion}`,
                            ]
                                .filter(Boolean)
                                .join(" · ")}
                        </span>
                    </>
                )}
                <PathValue label="数据" value={runtime.dirs?.data ?? null} />
                <PathValue label="配置" value={runtime.dirs?.config ?? null} />
                <PathValue label="日志" value={runtime.dirs?.logFile ?? null} />
            </div>
        </div>
    );
}

export function DevRuntimeButton({
    runtime,
    mode = "normal",
}: {
    runtime: DevRuntimeInfo;
    mode?: "normal" | "compact" | "supercompact";
}) {
    const [copyStatus, setCopyStatus] = useState<CopyStatus>("idle");
    const feedbackTimerRef = useRef<number | null>(null);

    const showFeedback = useCallback((status: CopyStatus) => {
        setCopyStatus(status);
        if (feedbackTimerRef.current != null) {
            window.clearTimeout(feedbackTimerRef.current);
        }
        feedbackTimerRef.current = window.setTimeout(() => {
            setCopyStatus("idle");
            feedbackTimerRef.current = null;
        }, 1500);
    }, []);

    // Main button: quick copy of the CDP endpoint.
    const handleCopyCdp = useCallback(async () => {
        try {
            await copyText(formatCdpCopy(runtime));
            showFeedback("copied");
        } catch {
            showFeedback("failed");
        }
    }, [runtime, showFeedback]);

    // Tooltip header icon: full dev-runtime dump.
    const handleCopyFull = useCallback(async () => {
        try {
            await copyText(formatDevRuntimeCopy(runtime));
            showFeedback("copied");
        } catch {
            showFeedback("failed");
        }
    }, [runtime, showFeedback]);

    useEffect(() => {
        return () => {
            if (feedbackTimerRef.current != null) {
                window.clearTimeout(feedbackTimerRef.current);
            }
        };
    }, []);

    const ariaLabel =
        copyStatus === "copied"
            ? "CDP endpoint copied"
            : copyStatus === "failed"
              ? "Failed to copy CDP endpoint"
              : "Copy CDP endpoint";
    const iconClass =
        copyStatus === "copied"
            ? "fa fa-solid fa-check text-[22px]"
            : copyStatus === "failed"
              ? "fa fa-solid fa-triangle-exclamation text-error text-[20px]"
              : "fa fa-brands fa-dev fa-fw";
    const mainline = isMainlineBranch(runtime.gitBranch);
    const label = copyStatus === "copied" ? "已复制" : copyStatus === "failed" ? "失败" : "点击复制";

    return (
        <Tooltip
            content={
                <DevRuntimeTooltipContent
                    runtime={runtime}
                    copyStatus={copyStatus}
                    onCopyFull={() => void handleCopyFull()}
                />
            }
            placement="left"
            openDelay={200}
            divClassName="w-full"
        >
            <button
                type="button"
                aria-label={ariaLabel}
                className="flex w-full cursor-pointer flex-col items-center justify-center rounded-sm border-0 bg-transparent py-1.5 pr-0.5 text-[30px] text-accent hover:bg-hoverbg focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
                onClick={() => void handleCopyCdp()}
            >
                <div className="relative">
                    <i className={iconClass} aria-hidden="true" />
                    {runtime.gitBranch != null && (
                        <span
                            className={`absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full ${mainline ? "bg-success" : "bg-warning"}`}
                            aria-hidden="true"
                        />
                    )}
                </div>
                {mode === "normal" && (
                    <div className="mt-0.5 w-full whitespace-nowrap overflow-hidden text-ellipsis px-0.5 text-center text-xxs text-secondary">
                        {label}
                    </div>
                )}
            </button>
        </Tooltip>
    );
}
