// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { CommitGroup, CommitRow } from "@/app/view/vcs/vcs-commit-row";
import { filterVcsFileStatuses, VcsFileTypeFilterOptions } from "@/app/view/vcs/vcs-filter";
import { getRepoOpenUrl } from "@/app/view/vcs/vcs-remote";
import { openLink } from "@/store/global";
import { fireAndForget, isBlank } from "@/util/util";
import React from "react";
import { VcsIconButton } from "./vcs-icon-button";

const DefaultCommitMessage = "chore: update selected files";

type RepoSectionKey = "changes" | "untracked" | "remote";
type RepoSectionState = Record<RepoSectionKey, boolean>;
export type RepoFileFilterState = {
    search: string;
    type: string;
    extension: string;
};

function statusCodeLabel(code: string): string {
    if (isBlank(code)) return "·";
    return code;
}

function CollapsibleHeader({
    title,
    count,
    isOpen,
    onToggle,
    noBorder,
    actions,
}: {
    title: string;
    count?: number;
    isOpen: boolean;
    onToggle: () => void;
    noBorder?: boolean;
    actions?: React.ReactNode;
}) {
    const countLabel = typeof count === "number" ? ` (${count})` : "";
    return (
        <div
            className={`mt-2 flex w-full items-center gap-2 rounded px-2 py-1 text-xs font-medium ${
                noBorder ? "bg-transparent" : "border border-border bg-surface"
            }`}
        >
            <button
                className="flex min-w-0 flex-1 items-center gap-2 text-left text-secondary hover:text-main cursor-pointer"
                onClick={onToggle}
                title={isOpen ? `Collapse ${title}` : `Expand ${title}`}
            >
                <span className="text-[11px] w-[12px] text-muted">{isOpen ? "▾" : "▸"}</span>
                <span>
                    {title}
                    {countLabel}
                </span>
            </button>
            {actions != null && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </div>
    );
}

function RepoFileFilterBar({
    filterState,
    onChange,
    totalCount,
    visibleCount,
}: {
    filterState: RepoFileFilterState;
    onChange: (next: RepoFileFilterState) => void;
    totalCount: number;
    visibleCount: number;
}) {
    const search = filterState.search ?? "";
    const type = filterState.type ?? "all";
    const extension = filterState.extension ?? "";
    const filtersActive = search.trim() !== "" || type !== "all" || extension.trim() !== "";
    const controlClassName =
        "h-7 rounded-md border border-border bg-surface text-xs text-foreground outline-none " +
        "placeholder:text-muted transition-colors focus:border-accent focus:ring-2 focus:ring-accent/20";
    return (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md bg-panel/60 px-2 py-1.5">
            <div className="group relative min-w-[180px] flex-1">
                <i className="fa-sharp fa-solid fa-magnifying-glass pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[11px] text-muted transition-colors group-focus-within:text-accent" />
                <input
                    className={`${controlClassName} w-full pl-7 ${search.trim() !== "" ? "pr-7" : "pr-2"}`}
                    type="text"
                    value={search}
                    onChange={(e) => onChange({ ...filterState, search: e.target.value })}
                    placeholder="Search files"
                />
                {search.trim() !== "" && (
                    <VcsIconButton
                        icon="xmark"
                        title="Clear search"
                        size="sm"
                        className="!absolute !right-1 !top-1/2 -translate-y-1/2"
                        onClick={() => onChange({ ...filterState, search: "" })}
                    />
                )}
            </div>
            <div className="relative w-[118px] shrink-0">
                <input
                    className={`${controlClassName} w-full px-2 ${extension.trim() !== "" ? "pr-7" : ""}`}
                    type="text"
                    value={extension}
                    onChange={(e) => onChange({ ...filterState, extension: e.target.value })}
                    placeholder="Ext .ts"
                    title="Filter by file extension, e.g. .ts or .tsx,.scss"
                />
                {extension.trim() !== "" && (
                    <VcsIconButton
                        icon="xmark"
                        title="Clear extension"
                        size="sm"
                        className="!absolute !right-1 !top-1/2 -translate-y-1/2"
                        onClick={() => onChange({ ...filterState, extension: "" })}
                    />
                )}
            </div>
            <label className="flex items-center gap-1.5 text-[11px] text-secondary">
                <span>Type</span>
                <div className="relative">
                    <select
                        className={`${controlClassName} appearance-none pl-2 pr-7 cursor-pointer`}
                        value={type}
                        onChange={(e) =>
                            onChange({
                                ...filterState,
                                type: e.target.value as string,
                            })
                        }
                    >
                        {VcsFileTypeFilterOptions.map((option) => (
                            <option key={option.value} value={option.value} className="bg-panel text-foreground">
                                {option.label}
                            </option>
                        ))}
                    </select>
                    <i className="fa-sharp fa-solid fa-chevron-down pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[9px] text-muted" />
                </div>
            </label>
            <div className="ml-auto flex shrink-0 items-center gap-2 text-[11px] text-muted">
                {filtersActive ? `${visibleCount}/${totalCount}` : `${totalCount} files`}
                {filtersActive && (
                    <VcsIconButton
                        icon="rotate-left"
                        title="Reset filters"
                        size="sm"
                        onClick={() => onChange({ search: "", type: "all", extension: "" })}
                    />
                )}
            </div>
        </div>
    );
}

function FileStatusRow({
    status,
    selected,
    onToggleSelected,
    onOpenDiff,
    onShowHistory,
}: {
    status: VcsFileStatus;
    selected: boolean;
    onToggleSelected: () => void;
    onOpenDiff: () => void;
    onShowHistory: () => void;
}) {
    return (
        <div className="group flex w-max min-w-full items-center gap-2 border-b border-border px-2 py-1.5 text-xs last:border-b-0">
            <input type="checkbox" checked={selected} onChange={onToggleSelected} className="cursor-pointer" />
            <span className="font-mono text-secondary min-w-[20px]">{statusCodeLabel(status.code)}</span>
            <span className="flex-1 min-w-[180px] whitespace-nowrap pr-3">{status.path}</span>
            <VcsIconButton
                icon="code-compare"
                title="Show diff"
                size="sm"
                tone="accent"
                reveal="hover"
                onClick={onOpenDiff}
            />
            <VcsIconButton
                icon="clock-rotate-left"
                title="Show file history"
                size="sm"
                reveal="hover"
                onClick={onShowHistory}
            />
        </div>
    );
}

export function VcsChangesTab({
    repo,
    selectedFiles,
    setSelectedFiles,
    commitMessage,
    setCommitMessage,
    onCommit,
    commitRunning,
    syncAction,
    onFileHistory,
    onShowFileDiff,
    sectionState,
    setSectionOpen,
    fileFilterState,
    setFileFilterState,
    onSyncAction,
    syncRunning,
}: {
    repo: VcsRepositoryInfo;
    selectedFiles: string[];
    setSelectedFiles: (next: string[]) => void;
    commitMessage: string;
    setCommitMessage: (next: string) => void;
    onCommit: () => void;
    commitRunning: boolean;
    syncAction?: VcsSyncAction;
    onFileHistory: (filePath: string) => void;
    onShowFileDiff: (filePath: string) => void;
    sectionState: RepoSectionState;
    setSectionOpen: (section: RepoSectionKey, open: boolean) => void;
    fileFilterState: RepoFileFilterState;
    setFileFilterState: (next: RepoFileFilterState) => void;
    onSyncAction: (action: VcsSyncAction) => void;
    syncRunning: boolean;
}) {
    const statusList = repo.status ?? [];
    const changedList = statusList.filter((status) => !status.untracked);
    const untrackedList = statusList.filter((status) => !!status.untracked);
    const filteredStatusList = filterVcsFileStatuses(
        statusList,
        fileFilterState.search,
        (fileFilterState.type ?? "all") as any,
        fileFilterState.extension
    );
    const filteredChangedList = filteredStatusList.filter((status) => !status.untracked);
    const filteredUntrackedList = filteredStatusList.filter((status) => !!status.untracked);
    const selectedSet = new Set(selectedFiles ?? []);

    const toggleFile = (filePath: string) => {
        if (selectedSet.has(filePath)) {
            setSelectedFiles(selectedFiles.filter((file) => file !== filePath));
            return;
        }
        setSelectedFiles([...(selectedFiles ?? []), filePath]);
    };
    const selectAllFor = (fileStatuses: VcsFileStatus[]) => {
        if (!fileStatuses || fileStatuses.length === 0) return;
        const nextSet = new Set(selectedFiles ?? []);
        for (const fileStatus of fileStatuses) {
            if (!isBlank(fileStatus?.path)) nextSet.add(fileStatus.path);
        }
        setSelectedFiles(Array.from(nextSet));
    };
    const clearAllFor = (fileStatuses: VcsFileStatus[]) => {
        if (!fileStatuses || fileStatuses.length === 0) return;
        const removeSet = new Set(fileStatuses.map((status) => status.path));
        setSelectedFiles((selectedFiles ?? []).filter((filePath) => !removeSet.has(filePath)));
    };
    const hasSelectedFiles = (selectedFiles?.length ?? 0) > 0;
    const remote = repo.remote;
    const ahead = remote?.ahead ?? 0;
    const behind = remote?.behind ?? 0;
    const incoming = remote?.incoming ?? [];
    const outgoing = remote?.outgoing ?? [];
    const remoteFiles = remote?.files ?? [];
    const isGit = repo.repotype === "git";
    const remoteSectionOpen = sectionState.remote ?? true;

    return (
        <div className="flex-1 overflow-auto p-2">
            {repo.statuserr && <div className="text-xs text-warning mb-2">Status warning: {repo.statuserr}</div>}
            <RepoFileFilterBar
                filterState={fileFilterState}
                onChange={setFileFilterState}
                totalCount={statusList.length}
                visibleCount={filteredStatusList.length}
            />
            <CollapsibleHeader
                title="Changes"
                count={filteredChangedList.length}
                isOpen={sectionState.changes}
                onToggle={() => setSectionOpen("changes", !sectionState.changes)}
                noBorder={true}
                actions={
                    <>
                        <VcsIconButton
                            icon="square-check"
                            title="Select all changed files"
                            size="sm"
                            tone="accent"
                            disabled={filteredChangedList.length === 0}
                            onClick={() => selectAllFor(filteredChangedList)}
                        />
                        <VcsIconButton
                            icon="square"
                            title="Clear selection"
                            size="sm"
                            disabled={filteredChangedList.length === 0}
                            onClick={() => clearAllFor(filteredChangedList)}
                        />
                    </>
                }
            />
            {sectionState.changes && (
                <div className="mt-1 overflow-x-auto rounded">
                    <div className="min-w-full">
                        {filteredChangedList.map((status, idx) => (
                            <FileStatusRow key={`changed-${status.path}-${idx}`} status={status} selected={selectedSet.has(status.path)} onToggleSelected={() => toggleFile(status.path)} onOpenDiff={() => onShowFileDiff(status.path)} onShowHistory={() => onFileHistory(status.path)} />
                        ))}
                    </div>
                </div>
            )}
            <CollapsibleHeader
                title="Untracked"
                count={filteredUntrackedList.length}
                isOpen={sectionState.untracked}
                onToggle={() => setSectionOpen("untracked", !sectionState.untracked)}
                noBorder={true}
                actions={
                    <>
                        <VcsIconButton
                            icon="square-check"
                            title="Select all untracked files"
                            size="sm"
                            tone="accent"
                            disabled={filteredUntrackedList.length === 0}
                            onClick={() => selectAllFor(filteredUntrackedList)}
                        />
                        <VcsIconButton
                            icon="square"
                            title="Clear selection"
                            size="sm"
                            disabled={filteredUntrackedList.length === 0}
                            onClick={() => clearAllFor(filteredUntrackedList)}
                        />
                    </>
                }
            />
            {sectionState.untracked && (
                <div className="mt-1 overflow-x-auto rounded">
                    <div className="min-w-full">
                        {filteredUntrackedList.map((status, idx) => (
                            <FileStatusRow key={`untracked-${status.path}-${idx}`} status={status} selected={selectedSet.has(status.path)} onToggleSelected={() => toggleFile(status.path)} onOpenDiff={() => onShowFileDiff(status.path)} onShowHistory={() => onFileHistory(status.path)} />
                        ))}
                    </div>
                </div>
            )}
            {isGit && (
                <>
                    <CollapsibleHeader
                        title="Remote"
                        count={ahead + behind}
                        isOpen={remoteSectionOpen}
                        onToggle={() => setSectionOpen("remote", !remoteSectionOpen)}
                        noBorder={true}
                        actions={
                            <>
                                <VcsIconButton
                                    icon="rotate-right"
                                    title={syncRunning && syncAction === "fetch" ? "Fetching…" : "Fetch"}
                                    loading={syncRunning && syncAction === "fetch"}
                                    size="sm"
                                    disabled={syncRunning}
                                    onClick={() => onSyncAction("fetch")}
                                />
                                <VcsIconButton
                                    icon="arrow-down-to-line"
                                    title={syncRunning && syncAction === "pull" ? "Pulling…" : "Pull"}
                                    loading={syncRunning && syncAction === "pull"}
                                    size="sm"
                                    tone="accent"
                                    disabled={syncRunning || behind <= 0}
                                    onClick={() => onSyncAction("pull")}
                                />
                                <VcsIconButton
                                    icon="arrow-up-from-bracket"
                                    title={syncRunning && syncAction === "push" ? "Pushing…" : "Push"}
                                    loading={syncRunning && syncAction === "push"}
                                    size="sm"
                                    tone="accent"
                                    disabled={syncRunning || ahead <= 0}
                                    onClick={() => onSyncAction("push")}
                                />
                            </>
                        }
                    />
                    {remoteSectionOpen && (
                        <div className="mt-1">
                            <div className="flex items-center gap-2 rounded-[7px] bg-surface-soft px-2.5 py-[7px]">
                                <i className="fa-sharp fa-solid fa-code-branch text-[11px] text-muted" />
                                {isBlank(remote?.upstream) ? (
                                    <span className="truncate text-xs italic text-muted" title="Upstream not configured">
                                        No upstream
                                    </span>
                                ) : isBlank(getRepoOpenUrl(repo)) ? (
                                    <span className="max-w-[220px] truncate font-mono text-xs text-secondary" title={remote?.upstream}>
                                        {remote?.upstream}
                                    </span>
                                ) : (
                                    <span
                                        className="max-w-[220px] truncate font-mono text-xs text-secondary cursor-pointer hover:text-accent hover:underline"
                                        title={getRepoOpenUrl(repo)}
                                        onClick={() => {
                                            fireAndForget(async () => {
                                                await openLink(getRepoOpenUrl(repo));
                                            });
                                        }}
                                    >
                                        {remote?.upstream}
                                    </span>
                                )}
                                <span className="flex-1" />
                                {ahead === 0 && behind === 0 ? (
                                    <span className="text-[11px] text-muted">
                                        <span className="text-success">✓</span> in sync
                                    </span>
                                ) : (
                                    <span className="flex items-center gap-1.5 font-mono text-[11px]">
                                        <span className={`text-success ${ahead > 0 ? "" : "opacity-55"}`} title={`Ahead by ${ahead}`}>
                                            ↑{ahead}
                                        </span>
                                        <span className="text-muted opacity-50">·</span>
                                        <span className={`text-error ${behind > 0 ? "" : "opacity-55"}`} title={`Behind by ${behind}`}>
                                            ↓{behind}
                                        </span>
                                    </span>
                                )}
                            </div>
                            <CommitGroup title="Incoming" count={incoming.length}>
                                {incoming.map((commit, idx) => (
                                    <CommitRow key={`incoming-${commit.hash}-${idx}`} commit={commit} railColor="bg-error" />
                                ))}
                            </CommitGroup>
                            <CommitGroup title="Outgoing" count={outgoing.length}>
                                {outgoing.map((commit, idx) => (
                                    <CommitRow key={`outgoing-${commit.hash}-${idx}`} commit={commit} railColor="bg-success" />
                                ))}
                            </CommitGroup>
                        </div>
                    )}
                </>
            )}
            {!isGit && remoteFiles.length > 0 && (
                <>
                    <CollapsibleHeader
                        title="Remote"
                        count={remoteFiles.length}
                        isOpen={remoteSectionOpen}
                        onToggle={() => setSectionOpen("remote", !remoteSectionOpen)}
                        noBorder={true}
                        actions={
                            <VcsIconButton
                                icon="arrow-down"
                                title={syncRunning && syncAction === "update" ? "Updating…" : "Update remote files"}
                                loading={syncRunning && syncAction === "update"}
                                size="sm"
                                disabled={syncRunning}
                                onClick={() => onSyncAction("update" as any)}
                            />
                        }
                    />
                    {remoteSectionOpen && (
                        <div className="mt-1 overflow-x-auto rounded">
                            <div className="min-w-full">
                                {remoteFiles.map((status, idx) => (
                                    <div key={`remote-${status.path}-${idx}`} className="flex w-max min-w-full items-center gap-2 border-b border-border px-2 py-1.5 text-xs last:border-b-0">
                                        <span className="font-mono text-secondary min-w-[20px]">{statusCodeLabel(status.code)}</span>
                                        <span className="flex-1 min-w-[220px] whitespace-nowrap pr-3">{status.path}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </>
            )}
            {hasSelectedFiles && (
                <>
                    <textarea className="w-full min-h-[58px] rounded border border-border bg-panel/80 px-2 py-1.5 text-xs outline-none focus:border-accent" value={commitMessage} onChange={(e) => setCommitMessage(e.target.value)} placeholder="Commit message..." />
                    <div className="mt-2 flex items-center gap-2">
                        <button className="inline-flex items-center gap-1.5 rounded bg-action px-2.5 py-1 text-xs text-actiontext font-semibold hover:bg-actionhover disabled:opacity-50 cursor-pointer disabled:cursor-default" disabled={commitRunning} onClick={onCommit}>
                            <i className={commitRunning ? "fa-sharp fa-solid fa-spinner animate-spin text-[11px]" : "fa-sharp fa-solid fa-code-commit text-[11px]"} />
                            <span>{commitRunning ? "Committing..." : `Commit (${selectedFiles.length})`}</span>
                        </button>
                    </div>
                </>
            )}
        </div>
    );
}

type VcsSyncAction = "fetch" | "pull" | "push" | "update";
