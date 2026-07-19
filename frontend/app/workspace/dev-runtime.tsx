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

export function formatDevRuntimeCopy(runtime: DevRuntimeInfo): string {
    const lines = [
        "Snorkeling Dev Runtime",
        `Profile: ${runtime.profile}`,
        `Port mode: ${runtime.portMode}`,
        formatEndpoint("Vite", runtime.vite),
        formatEndpoint("CDP", runtime.cdp),
    ];
    if (runtime.cdpJsonUrl != null) {
        lines.push(`CDP JSON: ${runtime.cdpJsonUrl}`);
    }
    if (runtime.inspectCommand != null) {
        lines.push(`Inspect: ${runtime.inspectCommand}`);
    }
    return lines.join("\n");
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

function DevRuntimeTooltipContent({ runtime, copyStatus }: { runtime: DevRuntimeInfo; copyStatus: CopyStatus }) {
    const feedback = copyStatus === "copied" ? "Copied" : copyStatus === "failed" ? "Copy failed" : null;
    return (
        <div className="w-[280px] p-1.5">
            <div className="mb-2 flex h-5 items-center justify-between gap-3">
                <span className="text-sm font-semibold text-foreground">Dev Runtime</span>
                <span className={copyStatus === "failed" ? "text-error" : "text-secondary"} aria-live="polite">
                    {feedback ?? <i className="fa fa-regular fa-copy" aria-hidden="true" />}
                </span>
            </div>
            <div className="grid grid-cols-[68px_minmax(0,1fr)] gap-x-3 gap-y-2">
                <span className="text-secondary">Profile</span>
                <span className="min-w-0 break-all font-mono text-[11px] text-foreground">{runtime.profile}</span>
                <span className="text-secondary">Port mode</span>
                <span className="font-mono text-[11px] text-foreground">{runtime.portMode}</span>
                <span className="text-secondary">Vite</span>
                <EndpointValue endpoint={runtime.vite} disabledLabel="Unavailable" />
                <span className="text-secondary">CDP</span>
                <EndpointValue endpoint={runtime.cdp} disabledLabel="Disabled" />
            </div>
        </div>
    );
}

export function DevRuntimeButton({ runtime }: { runtime: DevRuntimeInfo }) {
    const [copyStatus, setCopyStatus] = useState<CopyStatus>("idle");
    const feedbackTimerRef = useRef<number | null>(null);

    const handleCopy = useCallback(async () => {
        try {
            await copyText(formatDevRuntimeCopy(runtime));
            setCopyStatus("copied");
        } catch {
            setCopyStatus("failed");
        }
        if (feedbackTimerRef.current != null) {
            window.clearTimeout(feedbackTimerRef.current);
        }
        feedbackTimerRef.current = window.setTimeout(() => {
            setCopyStatus("idle");
            feedbackTimerRef.current = null;
        }, 1500);
    }, [runtime]);

    useEffect(() => {
        return () => {
            if (feedbackTimerRef.current != null) {
                window.clearTimeout(feedbackTimerRef.current);
            }
        };
    }, []);

    const ariaLabel =
        copyStatus === "copied"
            ? "Dev runtime information copied"
            : copyStatus === "failed"
              ? "Failed to copy dev runtime information"
              : "Copy dev runtime information";
    const iconClass =
        copyStatus === "copied"
            ? "fa fa-solid fa-check text-[22px]"
            : copyStatus === "failed"
              ? "fa fa-solid fa-triangle-exclamation text-error text-[20px]"
              : "fa fa-brands fa-dev fa-fw";

    return (
        <Tooltip
            content={<DevRuntimeTooltipContent runtime={runtime} copyStatus={copyStatus} />}
            placement="left"
            openDelay={200}
            divClassName="w-full"
        >
            <button
                type="button"
                aria-label={ariaLabel}
                className="flex h-10 w-full cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent p-0 text-[30px] text-accent hover:bg-hoverbg focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
                onClick={() => void handleCopy()}
            >
                <i className={iconClass} aria-hidden="true" />
            </button>
        </Tooltip>
    );
}
