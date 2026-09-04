// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import React from "react";

type View = "changes" | "branches" | "pipelines";

const VIEWS: { id: View; label: string; icon: string }[] = [
    { id: "changes", label: "文件改动", icon: "✎" },
    { id: "branches", label: "分支", icon: "⑂" },
    { id: "pipelines", label: "流水线", icon: "◫" },
];

function shortHash(hash: string): string {
    if (!hash || hash.length <= 10) return hash;
    return hash.slice(0, 10);
}

function countChanged(repo: VcsRepositoryInfo): number {
    return (repo.status ?? []).filter((s) => !s.untracked).length;
}

function countUntracked(repo: VcsRepositoryInfo): number {
    return (repo.status ?? []).filter((s) => s.untracked).length;
}

function getRemotePendingCount(repo: VcsRepositoryInfo): number {
    const remote = repo?.remote;
    if (remote == null) return 0;
    const ahead = remote.ahead ?? 0;
    const behind = remote.behind ?? 0;
    const remoteFiles = repo.repotype === "svn" ? (remote.files?.length ?? 0) : 0;
    return ahead + behind + remoteFiles;
}

export function VcsTabBar({
    repo,
    currentView,
    onViewChange,
    busy,
}: {
    repo: VcsRepositoryInfo;
    currentView: View;
    onViewChange: (view: View) => void;
    busy: boolean;
}) {
    const isGit = repo.repotype === "git";
    const changed = countChanged(repo);
    const untracked = countUntracked(repo);
    const changeCount = changed + untracked;
    const remoteCount = getRemotePendingCount(repo);

    return (
        <div className="flex shrink-0 items-center gap-0.5 px-1.5 pb-1.5">
            {VIEWS.map((entry) => {
                const isDisabled = entry.id === "branches" && !isGit;
                const badge =
                    entry.id === "changes" && changeCount > 0
                        ? changeCount
                        : entry.id === "pipelines" && remoteCount > 0
                          ? remoteCount
                          : null;
                return (
                    <button
                        key={entry.id}
                        type="button"
                        disabled={isDisabled}
                        onClick={() => !isDisabled && onViewChange(entry.id)}
                        className={`flex h-[26px] shrink-0 items-center gap-1.5 rounded-md text-detail transition-colors px-2.5 ${
                            isDisabled ? "opacity-40 cursor-default" : ""
                        } ${
                            currentView === entry.id
                                ? "bg-card-hover text-ink"
                                : "text-ink-muted hover:bg-card-hover/60"
                        }`}
                    >
                        <span className="text-[12px] shrink-0">{entry.icon}</span>
                        <span className="truncate">{entry.label}</span>
                        {badge != null && (
                            <span className="min-w-[16px] h-[14px] rounded-full bg-accent/12 text-accent text-[10px] tabular-nums inline-flex items-center justify-center px-1">
                                {badge}
                            </span>
                        )}
                    </button>
                );
            })}
        </div>
    );
}

export function VcsRepoHeader({
    repo,
    onSync,
    onRefresh,
    syncRunning,
}: {
    repo: VcsRepositoryInfo;
    onSync: () => void;
    onRefresh: () => void;
    syncRunning: boolean;
}) {
    const isGit = repo.repotype === "svn";
    const remote = repo.remote;
    const ahead = remote?.ahead ?? 0;
    const behind = remote?.behind ?? 0;
    const changed = countChanged(repo);
    const untracked = countUntracked(repo);
    const totalChanged = changed + untracked;
    const remoteCount = getRemotePendingCount(repo);

    return (
        <div className="flex h-8 shrink-0 items-center gap-1.5 px-2.5">
            <span className="text-ink-faint text-[12px] shrink-0">⑂</span>
            <span className="text-[11px] text-muted truncate min-w-0">{repo.branch || "(no branch)"}</span>
            {repo.repotype === "git" && (ahead > 0 || behind > 0) && (
                <span className="text-[11px] text-muted tabular-nums shrink-0">
                    {ahead > 0 && `↑${ahead}`}
                    {ahead > 0 && behind > 0 && " "}
                    {behind > 0 && `↓${behind}`}
                </span>
            )}
            <div className="min-w-1 flex-1" />
            <span className={`text-[10px] tabular-nums px-1.5 py-[1px] rounded border border-border ${totalChanged > 0 ? "text-warning" : "text-muted"}`}>
                {totalChanged} changed
            </span>
            {isGit && (
                <>
                    <span className={`text-[10px] tabular-nums px-1.5 py-[1px] rounded border border-border ${behind > 0 ? "text-warning" : "text-muted"}`}>
                        ↓{behind}
                    </span>
                    <span className={`text-[10px] tabular-nums px-1.5 py-[1px] rounded border border-border ${ahead > 0 ? "text-warning" : "text-muted"}`}>
                        ↑{ahead}
                    </span>
                </>
            )}
            <button
                className="rounded border border-border px-2 py-[3px] text-[11px] text-secondary hover:bg-hoverbg cursor-pointer disabled:text-muted disabled:cursor-default disabled:hover:bg-transparent shrink-0"
                title="Pull"
                disabled={syncRunning || !isGit}
                onClick={onSync}
            >
                Pull
            </button>
            <button
                className="iconbutton !h-[20px] !w-[20px] cursor-pointer"
                title="Refresh"
                onClick={onRefresh}
            >
                <i className="fa-sharp fa-solid fa-arrows-rotate text-[11px]" />
            </button>
        </div>
    );
}

export type { View };
