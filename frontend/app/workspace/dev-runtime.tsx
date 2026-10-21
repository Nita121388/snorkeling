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

/**
 * Lazy electron preload access. Imported dynamically so this module (and its unit tests)
 * do not pull in the whole global store at module load time.
 */
async function loadAppDebugInfo(): Promise<AppDebugInfo> {
    const { getApi } = await import("@/app/store/global");
    return getApi().getAppDebugInfo();
}

/** Copy payload for the main button: just the CDP endpoint, ready to paste. */
export function formatCdpCopy(runtime: DevRuntimeInfo): string {
    return runtime.cdp?.url ?? "CDP: Disabled";
}

function formatBuildTime(buildTime: number | null | undefined): string | null {
    if (buildTime == null || !Number.isFinite(buildTime) || buildTime <= 0) {
        return null;
    }
    const date = new Date(buildTime);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function joinParts(parts: (string | null | undefined)[], separator = " · "): string {
    return parts.filter((part) => part != null && part !== "").join(separator);
}

function formatInterval(intervalms: number | null | undefined): string | null {
    if (intervalms == null || !Number.isFinite(intervalms) || intervalms <= 0) {
        return null;
    }
    if (intervalms % 3_600_000 === 0) {
        return `${intervalms / 3_600_000}h`;
    }
    if (intervalms % 60_000 === 0) {
        return `${intervalms / 60_000}m`;
    }
    return `${Math.round(intervalms / 1000)}s`;
}

/**
 * Body lines shared by the dev-runtime dump and the full debug dump.
 * `includeAppMeta` / `includeDirs` are turned off by the full dump because the app header
 * and the paths section already carry that information there.
 */
function devRuntimeLines(
    runtime: DevRuntimeInfo,
    opts: { includeAppMeta?: boolean; includeDirs?: boolean } = {}
): string[] {
    const includeAppMeta = opts.includeAppMeta ?? true;
    const includeDirs = opts.includeDirs ?? true;
    const lines = [
        `Profile: ${runtime.profile}`,
        `Branch: ${runtime.gitBranch ?? "n/a"}`,
        `Port mode: ${runtime.portMode}`,
        formatEndpoint("Vite", runtime.vite),
        formatEndpoint("CDP", runtime.cdp),
    ];
    if (includeAppMeta) {
        if (runtime.appVersion != null) {
            lines.push(`App: ${runtime.appVersion}`);
        }
        const versions = joinParts([
            runtime.electronVersion != null ? `Electron ${runtime.electronVersion}` : null,
            runtime.nodeVersion != null ? `Node ${runtime.nodeVersion}` : null,
        ]);
        if (versions !== "") {
            lines.push(`Versions: ${versions}`);
        }
    }
    if (includeDirs && runtime.dirs != null) {
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
    return lines;
}

export function formatDevRuntimeCopy(runtime: DevRuntimeInfo): string {
    return ["Snorkeling Dev Runtime", ...devRuntimeLines(runtime)].join("\n");
}

export type AppDebugCopyOptions = {
    /** Append the tail of waveapp.log. Off by default: it is long and usually noise. */
    includeLogTail?: boolean;
};

/**
 * Full debug dump for pasting into an issue / chat. Built from `getAppDebugInfo()`, which is
 * the only source that carries platform, chrome/v8, build time, packaged flags and updater state.
 * Section layout mirrors the emain payload so the two are easy to compare.
 */
export function formatAppDebugCopy(info: AppDebugInfo, opts: AppDebugCopyOptions = {}): string {
    const lines: string[] = ["Snorkeling Debug Info"];
    if (info.generatedAt) {
        lines.push(`Generated: ${info.generatedAt}`);
    }

    const app = info.app;
    const buildTime = formatBuildTime(app.buildTime);
    const appName = joinParts([app.name, app.version], " ");
    const appFlags = joinParts([app.isDev ? "dev" : null, app.isPackaged ? "packaged" : "unpackaged"], ", ");
    const appSuffix = joinParts([buildTime != null ? `built ${buildTime}` : null, appFlags], ", ");
    lines.push(`App: ${appName}${appSuffix !== "" ? ` (${appSuffix})` : ""}`);

    const runtime = info.runtime;
    if (runtime != null) {
        const runtimeLine = joinParts([
            joinParts([runtime.platform, runtime.arch], " "),
            runtime.electron != null ? `Electron ${runtime.electron}` : null,
            runtime.chrome != null ? `Chrome ${runtime.chrome}` : null,
            runtime.node != null ? `Node ${runtime.node}` : null,
            runtime.v8 != null ? `V8 ${runtime.v8}` : null,
        ]);
        if (runtimeLine !== "") {
            lines.push(`Runtime: ${runtimeLine}`);
        }
    }

    if (info.devRuntime != null) {
        lines.push("", "Dev Runtime:");
        lines.push(...devRuntimeLines(info.devRuntime, { includeAppMeta: false, includeDirs: false }));
    }

    const paths = info.paths;
    if (paths != null) {
        lines.push("");
        if (paths.home != null) {
            lines.push(`Home: ${paths.home}`);
        }
        if (paths.data != null) {
            lines.push(`Data: ${paths.data}`);
        }
        if (paths.config != null) {
            lines.push(`Config: ${paths.config}`);
        }
        if (paths.logFile != null) {
            lines.push(`Log: ${paths.logFile}`);
        }
    }

    const updater = info.updater;
    if (updater != null) {
        const autoCheck =
            updater.autoCheckEnabled == null
                ? null
                : `auto check ${updater.autoCheckEnabled ? "on" : "off"}${formatInterval(updater.intervalms) != null ? ` (${formatInterval(updater.intervalms)})` : ""}`;
        const updaterLine = joinParts([
            updater.channel != null ? `channel ${updater.channel}` : null,
            updater.status != null && updater.status !== "" ? `status ${updater.status}` : null,
            autoCheck,
            updater.lastUpdateCheck != null ? `last check ${updater.lastUpdateCheck}` : null,
            updater.availableUpdateReleaseName != null ? `available ${updater.availableUpdateReleaseName}` : null,
            updater.updateSupport != null && !updater.updateSupport.supported
                ? `update unsupported${updater.updateSupport.reason != null ? `: ${updater.updateSupport.reason}` : ""}`
                : null,
        ]);
        if (updaterLine !== "") {
            lines.push("", `Updater: ${updaterLine}`);
        }
    }

    const log = info.logs?.waveapp;
    if (opts.includeLogTail && log != null) {
        lines.push("", `Log tail (${log.path}${log.size != null ? `, ${log.size} bytes` : ""}):`);
        if (log.tail != null && log.tail !== "") {
            lines.push(log.tail);
        } else if (log.error != null) {
            lines.push(`<error: ${log.error}>`);
        } else if (!log.exists) {
            lines.push("<log file not found>");
        } else {
            lines.push("<empty>");
        }
    }

    return lines.join("\n");
}

function isMainlineBranch(branch: string | null): boolean {
    return branch === "main" || branch === "master";
}

function EndpointValue({
    endpoint,
    disabledLabel,
    onCopyUrl,
}: {
    endpoint: DevRuntimeEndpoint | null;
    disabledLabel: string;
    onCopyUrl?: (url: string) => void;
}) {
    if (endpoint == null) {
        return <span className="text-secondary">{disabledLabel}</span>;
    }
    return (
        <div className="flex min-w-0 items-start gap-1.5">
            <div className="min-w-0 flex-1 font-mono text-[11px] leading-4">
                <div className="break-all text-foreground">{endpoint.url}</div>
                {endpoint.requestedPort !== endpoint.port && (
                    <div className="text-secondary">requested {endpoint.requestedPort}</div>
                )}
            </div>
            {onCopyUrl != null && (
                <button
                    type="button"
                    aria-label="Copy this URL only"
                    title="Copy this URL only"
                    className="border-0 bg-transparent p-0 text-[11px] text-secondary hover:text-foreground cursor-pointer"
                    onClick={() => onCopyUrl(endpoint.url)}
                >
                    <i className="fa fa-regular fa-copy" aria-hidden="true" />
                </button>
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
    onCopyUrl,
}: {
    runtime: DevRuntimeInfo;
    copyStatus: CopyStatus;
    onCopyFull: () => void;
    onCopyUrl: (url: string) => void;
}) {
    const feedback = copyStatus === "copied" ? "Copied" : copyStatus === "failed" ? "Copy failed" : null;
    return (
        <div className="w-[280px] p-1.5">
            <div className="mb-2 flex h-5 items-center justify-between gap-3">
                <span className="text-sm font-semibold text-foreground">Dev Runtime</span>
                <button
                    type="button"
                    aria-label="Copy full debug info"
                    title="Copy full debug info (app, runtime, paths, updater)"
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
                <EndpointValue endpoint={runtime.vite} disabledLabel="Unavailable" onCopyUrl={onCopyUrl} />
                <span className="text-secondary">CDP</span>
                <EndpointValue endpoint={runtime.cdp} disabledLabel="Disabled" onCopyUrl={onCopyUrl} />
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

    // Main button: full debug dump (Shift+click keeps the URL-only fast path for CDP tooling).
    const handleCopyMain = useCallback(
        async (event?: { shiftKey?: boolean }) => {
            if (event?.shiftKey) {
                try {
                    await copyText(formatCdpCopy(runtime));
                    showFeedback("copied");
                } catch {
                    showFeedback("failed");
                }
                return;
            }
            try {
                const info = await loadAppDebugInfo();
                await copyText(formatAppDebugCopy(info));
                showFeedback("copied");
            } catch {
                // Fall back to the synchronous snapshot already in hand so a failed IPC
                // still leaves something useful on the clipboard.
                try {
                    await copyText(formatDevRuntimeCopy(runtime));
                    showFeedback("copied");
                } catch {
                    showFeedback("failed");
                }
            }
        },
        [runtime, showFeedback]
    );

    // Tooltip header icon: full dev-runtime dump.
    const handleCopyFull = useCallback(async () => {
        try {
            await copyText(formatDevRuntimeCopy(runtime));
            showFeedback("copied");
        } catch {
            showFeedback("failed");
        }
    }, [runtime, showFeedback]);

    // Tooltip per-endpoint icon: bare URL only, nothing else.
    const handleCopyUrl = useCallback(
        async (url: string) => {
            try {
                await copyText(url);
                showFeedback("copied");
            } catch {
                showFeedback("failed");
            }
        },
        [showFeedback]
    );

    useEffect(() => {
        return () => {
            if (feedbackTimerRef.current != null) {
                window.clearTimeout(feedbackTimerRef.current);
            }
        };
    }, []);

    const ariaLabel =
        copyStatus === "copied"
            ? "Debug info copied"
            : copyStatus === "failed"
              ? "Failed to copy debug info"
              : "Copy debug info (Shift+click copies the CDP URL only)";
    const iconClass =
        copyStatus === "copied"
            ? "fa fa-solid fa-check text-[22px]"
            : copyStatus === "failed"
              ? "fa fa-solid fa-triangle-exclamation text-error text-[20px]"
              : "fa fa-brands fa-dev fa-fw";
    const mainline = isMainlineBranch(runtime.gitBranch);
    const label = copyStatus === "copied" ? "已复制" : copyStatus === "failed" ? "失败" : "复制调试信息";

    return (
        <Tooltip
            content={
                <DevRuntimeTooltipContent
                    runtime={runtime}
                    copyStatus={copyStatus}
                    onCopyFull={() => void handleCopyFull()}
                    onCopyUrl={(url) => void handleCopyUrl(url)}
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
                onClick={(event) => void handleCopyMain(event)}
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
