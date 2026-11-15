// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import React from "react";

import { VcsIconButton } from "./vcs-icon-button";
import { getRepoOpenUrl } from "./vcs-remote";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { openLink } from "@/store/global";
import { fireAndForget, isBlank } from "@/util/util";
import { i18n } from "@/i18n/config";
import { useTranslation } from "react-i18next";

type View = "changes" | "branches" | "pipelines" | "history";
type VcsSyncAction = "fetch" | "pull" | "push" | "update";

/**
 * Tab 定义只存 `labelKey`：`t()` 在渲染期求值，切语言即时生效（Pattern C）。
 * `as const` 保住 key 的字面量类型，`i18n.t(entry.labelKey)` 才能过类型检查。
 */
const VIEWS = [
    { id: "changes", labelKey: "vcs:tabs.views.changes", icon: "fa-file-pen" },
    { id: "branches", labelKey: "vcs:tabs.views.branches", icon: "fa-code-branch" },
    { id: "pipelines", labelKey: "vcs:tabs.views.pipelines", icon: "fa-diagram-project" },
    { id: "history", labelKey: "vcs:tabs.views.history", icon: "fa-clock-rotate-left" },
] as const satisfies readonly { id: View; labelKey: string; icon: string }[];

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
}: {
    repo: VcsRepositoryInfo;
    currentView: View;
    onViewChange: (view: View) => void;
}) {
    const { t } = useTranslation("vcs");
    const isGit = repo.repotype === "git";
    const changed = countChanged(repo);
    const untracked = countUntracked(repo);
    const changeCount = changed + untracked;
    const remoteCount = getRemotePendingCount(repo);

    return (
        <div className="flex shrink-0 items-center gap-1 border-b border-border/70 px-2">
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
                        data-vcs-tab="1"
                        disabled={isDisabled}
                        onClick={() => !isDisabled && onViewChange(entry.id)}
                        aria-label={t(entry.labelKey)}
                        className={`relative flex h-8 shrink-0 items-center gap-1.5 px-2.5 text-xs transition-colors ${
                            isDisabled ? "opacity-40 cursor-default" : "cursor-pointer"
                        } ${
                            currentView === entry.id
                                ? "text-foreground after:absolute after:inset-x-2 after:bottom-[-1px] after:h-0.5 after:rounded-full after:bg-accent"
                                : "text-muted hover:bg-hoverbg/60 hover:text-secondary"
                        }`}
                    >
                        <i className={`fa-sharp fa-solid ${entry.icon} text-[11px] shrink-0`} />
                        <span className="truncate">{t(entry.labelKey)}</span>
                        {badge != null && (
                            <span className="min-w-[18px] h-4 rounded-full bg-accent/12 text-accent text-[10px] tabular-nums inline-flex items-center justify-center px-1">
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
    syncAction,
}: {
    repo: VcsRepositoryInfo;
    onSync: () => void;
    onRefresh: () => void;
    syncRunning: boolean;
    syncAction?: VcsSyncAction;
}) {
    const { t } = useTranslation("vcs");
    const isGit = repo.repotype === "git";
    const remote = repo.remote;
    const ahead = remote?.ahead ?? 0;
    const behind = remote?.behind ?? 0;
    const changed = countChanged(repo);
    const untracked = countUntracked(repo);
    const totalChanged = changed + untracked;
    const remoteCount = getRemotePendingCount(repo);
    const repoOpenUrl = getRepoOpenUrl(repo);

    const handleHeaderContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
        e.preventDefault();
        const repoPath = repo?.rootpath ?? "";
        const copyUrl = !isBlank(repo?.remoteurl) ? repo.remoteurl : (repo?.browseurl ?? "");
        const menu: ContextMenuItem[] = [
            {
                label: t("vcs:tabs.copyRepoPath"),
                enabled: !isBlank(repoPath),
                click: () => {
                    fireAndForget(async () => {
                        await navigator.clipboard.writeText(repoPath);
                    });
                },
            },
            {
                label: t("vcs:tabs.copyRepoUrl"),
                enabled: !isBlank(copyUrl),
                click: () => {
                    fireAndForget(async () => {
                        await navigator.clipboard.writeText(copyUrl);
                    });
                },
            },
            {
                label: t("vcs:tabs.openRemoteRepository"),
                enabled: !isBlank(repoOpenUrl),
                click: () => {
                    fireAndForget(async () => {
                        await openLink(repoOpenUrl);
                    });
                },
            },
        ];
        ContextMenuModel.getInstance().showContextMenu(menu, e);
    };

    return (
        <div
            className="flex h-8 shrink-0 items-center gap-1.5 px-2.5"
            onContextMenu={handleHeaderContextMenu}
        >
            <span className="text-muted text-[12px] shrink-0">⑂</span>
            <span className="text-[11px] text-muted truncate min-w-0">{repo.branch || t("vcs:common.noBranch")}</span>
            {repo.repotype === "git" && (ahead > 0 || behind > 0) && (
                <span className="text-[11px] text-muted tabular-nums shrink-0">
                    {ahead > 0 && `↑${ahead}`}
                    {ahead > 0 && behind > 0 && " "}
                    {behind > 0 && `↓${behind}`}
                </span>
            )}
            <div className="min-w-1 flex-1" />
            {!isBlank(repoOpenUrl) && (
                <VcsIconButton
                    icon="arrow-up-right-from-square"
                    title={t("vcs:tabs.openRemoteRepositoryTooltip")}
                    onClick={() => {
                        fireAndForget(async () => {
                            await openLink(repoOpenUrl);
                        });
                    }}
                />
            )}
            <span className={`text-[10px] tabular-nums px-1.5 py-[1px] rounded border border-border ${totalChanged > 0 ? "text-warning" : "text-muted"}`}>
                {i18n.t("vcs:tabs.changed", { count: totalChanged })}
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
            <VcsIconButton
                icon="arrow-down-to-line"
                title={
                    syncRunning && syncAction === "pull" ? t("vcs:operations.verb.pull") : t("vcs:operations.label.pull")
                }
                loading={syncRunning && syncAction === "pull"}
                disabled={syncRunning || !isGit}
                tone="accent"
                onClick={onSync}
            />
            <VcsIconButton
                icon="arrows-rotate"
                title={t("vcs:common.refresh")}
                disabled={syncRunning}
                onClick={onRefresh}
            />
        </div>
    );
}

export type { View };
