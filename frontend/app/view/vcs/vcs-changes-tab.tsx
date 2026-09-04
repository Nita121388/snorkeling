// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { filterVcsFileStatuses, VcsFileTypeFilterOptions } from "@/app/view/vcs/vcs-filter";
import { isBlank } from "@/util/util";
import React from "react";

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
                noBorder ? "bg-transparent" : "border border-white/10 bg-black/20"
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
        "h-[24px] rounded border border-border bg-panel text-xs text-foreground outline-none " +
        "placeholder:text-muted focus:border-accent";
    return (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded border border-border bg-panel/80 px-2 py-1.5">
            <div className="relative min-w-[180px] flex-1">
                <i className="fa-sharp fa-solid fa-magnifying-glass pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-muted" />
                <input
                    className={`${controlClassName} w-full pl-6 pr-7`}
                    type="search"
                    value={search}
                    onChange={(e) => onChange({ ...filterState, search: e.target.value })}
                    placeholder="Search files"
                />
                {search.trim() !== "" && (
                    <button
                        className="iconbutton !absolute !right-1 !top-1/2 !h-[18px] !w-[18px] -translate-y-1/2 cursor-pointer"
                        title="Clear search"
                        onClick={() => onChange({ ...filterState, search: "" })}
                    >
                        <i className="fa-sharp fa-solid fa-xmark text-[10px]" />
                    </button>
                )}
            </div>
            <div className="relative w-[118px] shrink-0">
                <input
                    className={`${controlClassName} w-full px-2 pr-7`}
                    type="search"
                    value={extension}
                    onChange={(e) => onChange({ ...filterState, extension: e.target.value })}
                    placeholder="Ext .ts"
                    title="Filter by file extension, e.g. .ts or .tsx,.scss"
                />
                {extension.trim() !== "" && (
                    <button
                        className="iconbutton !absolute !right-1 !top-1/2 !h-[18px] !w-[18px] -translate-y-1/2 cursor-pointer"
                        title="Clear extension"
                        onClick={() => onChange({ ...filterState, extension: "" })}
                    >
                        <i className="fa-sharp fa-solid fa-xmark text-[10px]" />
                    </button>
                )}
            </div>
            <label className="flex items-center gap-1.5 text-[11px] text-secondary">
                <span>Type</span>
                <select
                    className={`${controlClassName} px-1.5`}
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
            </label>
            <div className="ml-auto shrink-0 text-[11px] text-muted">
                {filtersActive ? `${visibleCount}/${totalCount} shown` : `${totalCount} files`}
            </div>
            {filtersActive && (
                <button
                    className="text-[11px] text-secondary hover:underline cursor-pointer"
                    onClick={() => onChange({ search: "", type: "all", extension: "" })}
                >
                    Reset
                </button>
            )}
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
        <div className="flex w-max min-w-full items-center gap-2 border-b border-border px-2 py-1.5 text-xs last:border-b-0">
            <input type="checkbox" checked={selected} onChange={onToggleSelected} className="cursor-pointer" />
            <span className="font-mono text-secondary min-w-[20px]">{statusCodeLabel(status.code)}</span>
            <span className="flex-1 min-w-[180px] whitespace-nowrap pr-3">{status.path}</span>
            <button className="text-[11px] text-accent hover:underline cursor-pointer shrink-0" onClick={onOpenDiff}>
                Diff
            </button>
            <button className="text-[11px] text-accent hover:underline cursor-pointer shrink-0" onClick={onShowHistory}>
                History
            </button>
        </div>
    );
}

function RemoteActionButton({ label, disabled, onClick }: { label: string; disabled?: boolean; onClick: () => void }) {
    return (
        <button
            className="text-[11px] text-accent hover:underline cursor-pointer disabled:text-muted disabled:no-underline disabled:cursor-default"
            disabled={disabled}
            onClick={onClick}
        >
            {label}
        </button>
    );
}

function RemoteCommitRow({ commit }: { commit: VcsCommitInfo }) {
    const shortHash = (hash: string) => (hash?.length > 10 ? hash.slice(0, 10) : hash);
    return (
        <div className="flex w-max min-w-full items-center gap-2 border-b border-border px-2 py-1.5 text-xs last:border-b-0">
            <span className="font-mono text-secondary min-w-[78px]">{shortHash(commit.hash ?? "")}</span>
            <span className="min-w-[220px] max-w-[520px] flex-1 truncate pr-3">{commit.subject || "(no subject)"}</span>
            <span className="text-muted min-w-[120px] truncate">{commit.author}</span>
            <span className="text-muted min-w-[110px] whitespace-nowrap">{commit.date ?? ""}</span>
        </div>
    );
}

function RemoteCommitList({ title, commits }: { title: string; commits: VcsCommitInfo[] }) {
    if ((commits?.length ?? 0) === 0) return null;
    return (
        <div className="mt-2">
            <div className="mb-1 text-[11px] font-medium text-secondary">{title}</div>
            <div className="overflow-x-auto rounded">
                <div className="min-w-full">
                    {commits.map((commit, idx) => (
                        <RemoteCommitRow key={`${title}-${commit.hash}-${idx}`} commit={commit} />
                    ))}
                </div>
            </div>
        </div>
    );
}

function OperationNotice({ notice, onDismiss }: { notice?: VcsOperationNotice; onDismiss: () => void }) {
    const message = notice?.message?.trim() ?? "";
    if (isBlank(message)) return null;
    const firstLine = message.split(/\r?\n/).find((line) => !isBlank(line)) ?? message;
    const summary = firstLine.length > 180 ? `${firstLine.slice(0, 177)}...` : firstLine;
    const hasDetails = message !== summary;
    return (
        <div className={`mb-2 rounded border border-white/10 bg-black/25 px-2 py-1.5 text-xs ${notice?.isError ? "text-warning" : "text-secondary"}`}>
            <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1 whitespace-pre-wrap">{summary}</div>
                <button className="iconbutton !h-[18px] !w-[18px] shrink-0 cursor-pointer" title="Dismiss" onClick={onDismiss}>
                    <i className="fa-sharp fa-solid fa-xmark text-[10px]" />
                </button>
            </div>
            {hasDetails && (
                <details className="mt-1">
                    <summary className="cursor-pointer text-[11px] text-muted">Details</summary>
                    <pre className="mt-1 max-h-[180px] overflow-auto whitespace-pre-wrap rounded bg-black/20 p-2 text-[11px]">{message}</pre>
                </details>
            )}
        </div>
    );
}

type VcsOperationNotice = {
    id: number;
    message: string;
    isError: boolean;
};

export function VcsChangesTab({
    repo,
    selectedFiles,
    setSelectedFiles,
    commitMessage,
    setCommitMessage,
    onCommit,
    commitRunning,
    operationNotice,
    onDismissNotice,
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
    operationNotice?: VcsOperationNotice;
    onDismissNotice: () => void;
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
            <OperationNotice notice={operationNotice} onDismiss={onDismissNotice} />
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
                        <button className="text-[11px] text-accent hover:underline cursor-pointer disabled:text-muted disabled:no-underline disabled:cursor-default" onClick={() => selectAllFor(filteredChangedList)} disabled={filteredChangedList.length === 0}>Select All</button>
                        <button className="text-[11px] text-secondary hover:underline cursor-pointer disabled:text-muted disabled:no-underline disabled:cursor-default" onClick={() => clearAllFor(filteredChangedList)} disabled={filteredChangedList.length === 0}>Select None</button>
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
                        <button className="text-[11px] text-accent hover:underline cursor-pointer disabled:text-muted disabled:no-underline disabled:cursor-default" onClick={() => selectAllFor(filteredUntrackedList)} disabled={filteredUntrackedList.length === 0}>Select All</button>
                        <button className="text-[11px] text-secondary hover:underline cursor-pointer disabled:text-muted disabled:no-underline disabled:cursor-default" onClick={() => clearAllFor(filteredUntrackedList)} disabled={filteredUntrackedList.length === 0}>Select None</button>
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
                                <RemoteActionButton label="Fetch" disabled={syncRunning} onClick={() => onSyncAction("fetch")} />
                                <RemoteActionButton label="Pull" disabled={syncRunning || behind <= 0} onClick={() => onSyncAction("pull")} />
                                <RemoteActionButton label="Push" disabled={syncRunning || ahead <= 0} onClick={() => onSyncAction("push")} />
                            </>
                        }
                    />
                    {remoteSectionOpen && (
                        <div className="mt-1">
                            <div className="flex flex-wrap items-center gap-2 text-xs text-secondary">
                                <span className="text-muted">Upstream</span>
                                <span className="font-mono">{isBlank(remote?.upstream) ? "Not configured" : remote?.upstream}</span>
                                <span className="rounded border border-border px-1.5 py-[1px] text-[11px] text-secondary">Behind {behind}</span>
                                <span className="rounded border border-border px-1.5 py-[1px] text-[11px] text-secondary">Ahead {ahead}</span>
                            </div>
                            <RemoteCommitList title="Incoming" commits={incoming} />
                            <RemoteCommitList title="Outgoing" commits={outgoing} />
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
                        actions={<RemoteActionButton label="Update" disabled={syncRunning} onClick={() => onSyncAction("update" as any)} />}
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
                    <div className="mt-3 text-xs font-medium text-secondary mb-1">Commit Selected Files</div>
                    <textarea className="w-full min-h-[58px] rounded border border-border bg-panel/80 px-2 py-1.5 text-xs outline-none focus:border-accent" value={commitMessage} onChange={(e) => setCommitMessage(e.target.value)} placeholder="Commit message..." />
                    <div className="mt-2 flex items-center gap-2">
                        <button className="rounded bg-action px-2.5 py-1 text-xs text-actiontext font-semibold hover:bg-actionhover disabled:opacity-50 cursor-pointer disabled:cursor-default" disabled={commitRunning} onClick={onCommit}>
                            {commitRunning ? "Committing..." : `Commit (${selectedFiles.length})`}
                        </button>
                        <span className="text-[11px] text-muted">supports multi-select</span>
                    </div>
                </>
            )}
        </div>
    );
}

type VcsSyncAction = "fetch" | "pull" | "push" | "update";
