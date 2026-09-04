// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { TabRpcClient } from "@/app/store/wshrpcutil";
import { useWaveEnv } from "@/app/waveenv/waveenv";
import type { WaveEnv } from "@/app/waveenv/waveenv";
import { isBlank, makeConnRoute } from "@/util/util";
import React from "react";

type VcsUiEnv = WaveEnv;

function formatDuration(startedAt?: string, endedAt?: string): string {
    if (!startedAt) return "";
    const start = new Date(startedAt).getTime();
    if (Number.isNaN(start)) return "";
    const end = endedAt ? new Date(endedAt).getTime() : Date.now();
    const diff = Math.max(0, Math.floor((end - start) / 1000));
    if (diff < 60) return `${diff}s`;
    const mins = Math.floor(diff / 60);
    const secs = diff % 60;
    return `${mins}m ${secs}s`;
}

function formatTime(iso?: string): string {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function StatusDot({ status, conclusion }: { status: string; conclusion?: string }) {
    let colorClass = "bg-muted";
    if (status === "in_progress") {
        colorClass = "bg-accent animate-pulse";
    } else if (conclusion === "success" || status === "completed") {
        colorClass = "bg-ok";
    } else if (conclusion === "failure" || status === "failed") {
        colorClass = "bg-danger";
    }
    return <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${colorClass}`} />;
}

function shortHash(hash?: string): string {
    if (isBlank(hash)) return "";
    if (hash.length <= 10) return hash;
    return hash.slice(0, 10);
}

export function VcsPipelinesTab({
    repo,
    connection,
}: {
    repo: VcsRepositoryInfo;
    connection: string;
}) {
    const env = useWaveEnv<VcsUiEnv>();
    const [pipelines, setPipelines] = React.useState<RemoteVcsPipelineListRtnData | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);
    const [expandedRun, setExpandedRun] = React.useState<number | null>(null);

    const route = React.useMemo(() => {
        if (isBlank(connection)) return null;
        return makeConnRoute(connection);
    }, [connection]);

    const loadPipelines = React.useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const response = await env.rpc.RemoteVcsPipelineListCommand(
                TabRpcClient,
                { repotype: repo.repotype, repopath: repo.rootpath, limit: 20 },
                { route, timeout: 30000 }
            );
            setPipelines(response);
        } catch (e) {
            setError(String(e));
        } finally {
            setLoading(false);
        }
    }, [repo, env.rpc, route]);

    React.useEffect(() => {
        loadPipelines();
    }, [loadPipelines]);

    if (loading) {
        return (
            <div className="flex-1 flex items-center justify-center text-xs text-muted p-4">
                Loading pipelines...
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex-1 flex items-center justify-center text-xs text-warning p-4 whitespace-pre-wrap">
                {error}
            </div>
        );
    }

    if (!pipelines || pipelines.error) {
        return (
            <div className="flex-1 flex items-center justify-center text-xs text-muted p-4 text-center">
                <div className="max-w-[240px]">
                    <div className="text-secondary font-medium mb-1">暂无流水线记录</div>
                    <div>{pipelines?.error || "尚未检测到 CI/CD 构建记录"}</div>
                </div>
            </div>
        );
    }

    const runs = pipelines.runs ?? [];

    if (runs.length === 0) {
        return (
            <div className="flex-1 flex items-center justify-center text-xs text-muted p-4 text-center">
                <div className="max-w-[240px]">
                    <div className="text-secondary font-medium mb-1">暂无流水线记录</div>
                    <div>尚未在此仓库检测到 CI/CD 构建记录</div>
                </div>
            </div>
        );
    }

    return (
        <div className="flex-1 overflow-auto p-2 space-y-1">
            {/* Header */}
            <div className="flex items-center justify-between px-1 py-1">
                <span className="text-xs font-medium text-secondary">CI / CD 流水线</span>
                <button
                    className="text-[11px] text-accent hover:underline cursor-pointer"
                    onClick={() => loadPipelines()}
                >
                    刷新
                </button>
            </div>

            {/* Runs list */}
            {runs.map((run) => {
                const isExpanded = expandedRun === run.id;
                return (
                    <div key={run.id} className="rounded-lg border border-border bg-card transition-colors hover:border-accent/30">
                        <button
                            type="button"
                            onClick={() => setExpandedRun(isExpanded ? null : run.id)}
                            className="w-full text-left p-2.5 cursor-pointer"
                        >
                            <div className="flex items-center justify-between gap-2 mb-1">
                                <div className="flex items-center gap-2 min-w-0">
                                    <StatusDot status={run.status} conclusion={run.conclusion} />
                                    <span className="text-xs font-medium text-foreground truncate">{run.name || "Workflow"}</span>
                                </div>
                                <span className="text-[11px] text-muted shrink-0 whitespace-nowrap">{formatTime(run.startedat)}</span>
                            </div>
                            <div className="text-[11px] text-muted pl-4 mb-1 truncate">{run.commit ? shortHash(run.commit) : "—"}</div>
                            <div className="flex items-center gap-3 text-[11px] text-muted pl-4">
                                {run.branch && (
                                    <span className="flex items-center gap-1 truncate max-w-[130px]">
                                        <span>⑂</span>
                                        <span className="truncate">{run.branch}</span>
                                    </span>
                                )}
                                <span className="font-mono text-[11px]">{formatDuration(run.startedat, run.endedat)}</span>
                            </div>
                        </button>
                        {isExpanded && (
                            <div className="px-2.5 pb-2.5 pt-0.5 space-y-1 border-t border-border">
                                <div className="flex items-center justify-between py-1 text-[11px]">
                                    <span className="text-muted">状态</span>
                                    <span className="text-secondary">{run.conclusion || run.status}</span>
                                </div>
                                {run.commit && (
                                    <div className="flex items-center justify-between py-1 text-[11px]">
                                        <span className="text-muted">提交</span>
                                        <span className="text-secondary font-mono">{run.commit}</span>
                                    </div>
                                )}
                                {run.author && (
                                    <div className="flex items-center justify-between py-1 text-[11px]">
                                        <span className="text-muted">触发者</span>
                                        <span className="text-secondary">{run.author}</span>
                                    </div>
                                )}
                                <div className="flex items-center justify-between py-1 text-[11px]">
                                    <span className="text-muted">耗时</span>
                                    <span className="text-secondary">{formatDuration(run.startedat, run.endedat)}</span>
                                </div>
                                {run.url && (
                                    <a
                                        href={run.url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="inline-block mt-1 text-[11px] text-accent hover:underline"
                                    >
                                        在浏览器中查看 →
                                    </a>
                                )}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
