// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { appendBlockMoveMenuItems, useBlockMoveMenuItems } from "@/app/block/block-move-menu";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { globalStore } from "@/app/store/jotaiStore";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { filterVcsFileStatuses, VcsFileTypeFilter, VcsFileTypeFilterOptions } from "@/app/view/vcs/vcs-filter";
import type { WaveEnv } from "@/app/waveenv/waveenv";
import { useWaveEnv } from "@/app/waveenv/waveenv";
import { createBlock, openLink } from "@/store/global";
import { basename, fireAndForget, isBlank, makeConnRoute } from "@/util/util";
import { Atom, atom, useAtomValue } from "jotai";
import React from "react";

const DefaultCommitMessage = "chore: update selected files";
const VcsRepositoryRpcTimeoutMs = 60000;
const VcsMutationRpcTimeoutMs = 150000;

type VcsUiEnv = WaveEnv;

type RepoStringMap = Record<string, string>;
type RepoBoolMap = Record<string, boolean>;
type RepoFilesMap = Record<string, string[]>;
type RepoSectionKey = "changes" | "untracked" | "remote";
type RepoSectionState = Record<RepoSectionKey, boolean>;
type RepoSectionsMap = Record<string, RepoSectionState>;
type VcsSyncAction = "fetch" | "pull" | "push" | "update";
type RepoFileFilterState = {
    search: string;
    type: VcsFileTypeFilter;
    extension: string;
};
type RepoFileFiltersMap = Record<string, RepoFileFilterState>;
type VcsOperationNotice = {
    id: number;
    message: string;
    isError: boolean;
};
type RepoNoticeMap = Record<string, VcsOperationNotice>;

function countByCode(statuses: VcsFileStatus[]): { changed: number; untracked: number } {
    let changed = 0;
    let untracked = 0;
    for (const status of statuses ?? []) {
        if (status?.untracked) {
            untracked++;
            continue;
        }
        changed++;
    }
    return { changed, untracked };
}

function statusCodeLabel(code: string): string {
    if (isBlank(code)) {
        return "·";
    }
    return code;
}

function shortHash(hash: string): string {
    if (isBlank(hash)) {
        return "";
    }
    if (hash.length <= 10) {
        return hash;
    }
    return hash.slice(0, 10);
}

function getRemotePendingCount(repo: VcsRepositoryInfo): number {
    const remote = repo?.remote;
    if (remote == null) {
        return 0;
    }
    const ahead = remote.ahead ?? 0;
    const behind = remote.behind ?? 0;
    const remoteFiles = repo.repotype === "svn" ? (remote.files?.length ?? 0) : 0;
    return ahead + behind + remoteFiles;
}

function formatCommitDate(dateStr: string): string {
    if (isBlank(dateStr)) {
        return "";
    }
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) {
        return dateStr;
    }
    return date.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

function getDefaultSyncAction(repo: VcsRepositoryInfo): VcsSyncAction {
    return repo.repotype === "svn" ? "update" : "pull";
}

function getSyncCompletionLabel(action: VcsSyncAction): string {
    switch (action) {
        case "fetch":
            return "Fetch completed.";
        case "push":
            return "Push completed.";
        case "update":
            return "Update completed.";
        case "pull":
        default:
            return "Pull completed.";
    }
}

function getSyncFailureLabel(action: VcsSyncAction): string {
    switch (action) {
        case "fetch":
            return "Fetch failed.";
        case "push":
            return "Push failed.";
        case "update":
            return "Update failed.";
        case "pull":
        default:
            return "Pull failed.";
    }
}

function makeDefaultSectionState(): RepoSectionState {
    return {
        changes: true,
        untracked: true,
        remote: true,
    };
}

function makeDefaultFileFilterState(): RepoFileFilterState {
    return {
        search: "",
        type: "all",
        extension: "",
    };
}

export class VcsViewModel implements ViewModel {
    viewType = "vcs";
    blockId: string;
    env: VcsUiEnv;
    blockAtom: Atom<Block>;
    viewIcon = atom("code-branch");
    viewName = atom("Version Control");
    hideViewName = atom(true);
    manageConnection = atom(true);
    filterOutNowsh = atom(true);
    noPadding = atom(true);
    refreshNonce = atom(0);
    pathAtom: Atom<string>;
    selectedFileAtom: Atom<string>;
    connection: Atom<string>;
    connStatus: Atom<ConnStatus>;
    viewText: Atom<HeaderElem[]>;
    endIconButtons: Atom<IconButtonDecl[]>;

    constructor({ blockId, waveEnv }: ViewModelInitType) {
        this.blockId = blockId;
        this.env = waveEnv;
        this.blockAtom = this.env.wos.getWaveObjectAtom<Block>(`block:${blockId}`);
        this.pathAtom = atom((get) => {
            const path = get(this.blockAtom)?.meta?.["vcs:path"];
            if (isBlank(path)) {
                return "~";
            }
            return path;
        });
        this.selectedFileAtom = atom((get) => {
            return get(this.blockAtom)?.meta?.["vcs:selectedfile"] ?? "";
        });
        this.connection = atom((get) => {
            const connValue = get(this.blockAtom)?.meta?.connection;
            if (isBlank(connValue)) {
                return "local";
            }
            return connValue;
        });
        this.connStatus = atom((get) => {
            const connAtom = this.env.getConnStatusAtom(get(this.connection));
            return get(connAtom);
        });
        this.viewText = atom((get) => {
            const basePath = get(this.pathAtom);
            // 只显示路径最后一段, hover tooltip 展示完整路径; copytext 支持点击复制
            const displayPath = isBlank(basePath) ? "" : basename(basePath);
            return [
                {
                    elemtype: "copytext",
                    text: basePath,
                    displayText: displayPath,
                    tooltipText: basePath,
                    className: "vcs-block-path",
                },
            ];
        });
        this.endIconButtons = atom(() => {
            return [
                {
                    elemtype: "iconbutton",
                    icon: "arrows-rotate",
                    title: "Refresh",
                    zone: "pinned",
                    click: () => {
                        globalStore.set(this.refreshNonce, (prev) => prev + 1);
                    },
                },
            ];
        });
    }

    get viewComponent(): ViewComponent {
        return VcsView;
    }
}

function RepoHeader({
    repo,
    isExpanded,
    isActive,
    onToggle,
    onOpenCommits,
    onSync,
    onRefresh,
    onContextMenu,
    syncRunning,
}: {
    repo: VcsRepositoryInfo;
    isExpanded: boolean;
    isActive: boolean;
    onToggle: () => void;
    onOpenCommits: () => void;
    onSync: () => void;
    onRefresh: () => void;
    onContextMenu: (e: React.MouseEvent<HTMLDivElement>) => void;
    syncRunning: boolean;
}) {
    const summary = countByCode(repo?.status ?? []);
    const remoteCount = getRemotePendingCount(repo);
    const syncLabel = repo.repotype === "svn" ? "Update" : "Pull";
    const syncRunningLabel = repo.repotype === "svn" ? "Updating..." : "Pulling...";
    return (
        <div
            className={`relative flex items-center gap-2 rounded-md px-2 py-1.5 ${
                isActive
                    ? "bg-white/7 before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-0.5 before:rounded-full before:bg-accent"
                    : "bg-black/15"
            }`}
            onContextMenu={onContextMenu}
        >
            <button
                className="flex min-w-0 flex-1 items-stretch gap-2 text-left cursor-pointer"
                onClick={onToggle}
                title="Toggle repository"
            >
                <span className="flex w-[14px] items-center text-[11px] text-muted">{isExpanded ? "▾" : "▸"}</span>
                <div className="min-w-0 flex-1 pr-2">
                    <div className="flex min-w-0 items-start gap-2">
                        <span className="mt-[1px] shrink-0 rounded border border-border px-1.5 py-[1px] text-[11px] uppercase text-secondary">
                            {repo.repotype}
                        </span>
                        <span className="min-w-0 flex-1 break-words text-sm font-medium leading-[18px]">
                            {repo.name}
                        </span>
                    </div>
                    <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 pl-[48px] text-xs text-secondary">
                        <span className="min-w-0 break-words">{repo.branch || "(no branch)"}</span>
                        <span className="shrink-0 text-[11px] text-muted">
                            C:{summary.changed} U:{summary.untracked} R:{remoteCount}
                        </span>
                    </div>
                </div>
            </button>
            <div className="flex shrink-0 items-center gap-1.5 self-center">
                <button
                    className="rounded border border-border px-2 py-[3px] text-[11px] text-secondary hover:bg-hoverbg cursor-pointer disabled:text-muted disabled:cursor-default disabled:hover:bg-transparent shrink-0"
                    title={syncLabel}
                    disabled={syncRunning}
                    onClick={onSync}
                >
                    {syncRunning ? syncRunningLabel : syncLabel}
                </button>
                <button className="iconbutton !h-[20px] !w-[20px] cursor-pointer" title="Refresh" onClick={onRefresh}>
                    <i className="fa-sharp fa-solid fa-arrows-rotate text-[11px]" />
                </button>
                <button
                    className="iconbutton !h-[20px] !w-[20px] cursor-pointer"
                    title="Open Commits"
                    onClick={onOpenCommits}
                >
                    <i className="fa-sharp fa-solid fa-clock-rotate-left text-[11px]" />
                </button>
            </div>
        </div>
    );
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
    return (
        <div className="flex w-max min-w-full items-center gap-2 border-b border-border px-2 py-1.5 text-xs last:border-b-0">
            <span className="font-mono text-secondary min-w-[78px]">{shortHash(commit.hash ?? "")}</span>
            <span className="min-w-[220px] max-w-[520px] flex-1 truncate pr-3">{commit.subject || "(no subject)"}</span>
            <span className="text-muted min-w-[120px] truncate">{commit.author}</span>
            <span className="text-muted min-w-[110px] whitespace-nowrap">{formatCommitDate(commit.date ?? "")}</span>
        </div>
    );
}

function RemoteCommitList({ title, commits }: { title: string; commits: VcsCommitInfo[] }) {
    if ((commits?.length ?? 0) === 0) {
        return null;
    }
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

function RemoteFileRow({ status }: { status: VcsFileStatus }) {
    return (
        <div className="flex w-max min-w-full items-center gap-2 border-b border-border px-2 py-1.5 text-xs last:border-b-0">
            <span className="font-mono text-secondary min-w-[20px]">{statusCodeLabel(status.code)}</span>
            <span className="flex-1 min-w-[220px] whitespace-nowrap pr-3">{status.path}</span>
        </div>
    );
}

function OperationNotice({ notice, onDismiss }: { notice?: VcsOperationNotice; onDismiss: () => void }) {
    const message = notice?.message?.trim() ?? "";
    if (isBlank(message)) {
        return null;
    }
    const firstLine = message.split(/\r?\n/).find((line) => !isBlank(line)) ?? message;
    const summary = firstLine.length > 180 ? `${firstLine.slice(0, 177)}...` : firstLine;
    const hasDetails = message !== summary;
    return (
        <div
            className={`mb-2 rounded border border-white/10 bg-black/25 px-2 py-1.5 text-xs ${
                notice?.isError ? "text-warning" : "text-secondary"
            }`}
        >
            <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1 whitespace-pre-wrap">{summary}</div>
                <button
                    className="iconbutton !h-[18px] !w-[18px] shrink-0 cursor-pointer"
                    title="Dismiss"
                    onClick={onDismiss}
                >
                    <i className="fa-sharp fa-solid fa-xmark text-[10px]" />
                </button>
            </div>
            {hasDetails && (
                <details className="mt-1">
                    <summary className="cursor-pointer text-[11px] text-muted">Details</summary>
                    <pre className="mt-1 max-h-[180px] overflow-auto whitespace-pre-wrap rounded bg-black/20 p-2 text-[11px]">
                        {message}
                    </pre>
                </details>
            )}
        </div>
    );
}

function RemoteSection({
    repo,
    isOpen,
    onToggle,
    onSyncAction,
    syncRunning,
}: {
    repo: VcsRepositoryInfo;
    isOpen: boolean;
    onToggle: () => void;
    onSyncAction: (action: VcsSyncAction) => void;
    syncRunning: boolean;
}) {
    const remote = repo.remote;
    const ahead = remote?.ahead ?? 0;
    const behind = remote?.behind ?? 0;
    const incoming = remote?.incoming ?? [];
    const outgoing = remote?.outgoing ?? [];
    const remoteFiles = remote?.files ?? [];
    const upstream = remote?.upstream || repo.remoteurl || "";
    const remoteCount = getRemotePendingCount(repo);
    const actions =
        repo.repotype === "svn" ? (
            <RemoteActionButton label="Update" disabled={syncRunning} onClick={() => onSyncAction("update")} />
        ) : (
            <>
                <RemoteActionButton label="Fetch" disabled={syncRunning} onClick={() => onSyncAction("fetch")} />
                <RemoteActionButton
                    label="Pull"
                    disabled={syncRunning || behind <= 0}
                    onClick={() => onSyncAction("pull")}
                />
                <RemoteActionButton
                    label="Push"
                    disabled={syncRunning || ahead <= 0}
                    onClick={() => onSyncAction("push")}
                />
            </>
        );

    return (
        <>
            <CollapsibleHeader
                title="Remote"
                count={remoteCount}
                isOpen={isOpen}
                onToggle={onToggle}
                noBorder={true}
                actions={actions}
            />
            {isOpen && (
                <div className="mt-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-secondary">
                        <span className="text-muted">Upstream</span>
                        <span className="font-mono">{isBlank(upstream) ? "Not configured" : upstream}</span>
                        {repo.repotype === "git" && (
                            <>
                                <span className="rounded border border-border px-1.5 py-[1px] text-[11px] text-secondary">
                                    Behind {behind}
                                </span>
                                <span className="rounded border border-border px-1.5 py-[1px] text-[11px] text-secondary">
                                    Ahead {ahead}
                                </span>
                            </>
                        )}
                    </div>
                    {remote?.error && (
                        <div className="mt-1 text-xs text-warning whitespace-pre-wrap">
                            Remote warning: {remote.error}
                        </div>
                    )}
                    {repo.repotype === "git" ? (
                        <>
                            <RemoteCommitList title="Incoming" commits={incoming} />
                            <RemoteCommitList title="Outgoing" commits={outgoing} />
                            {/* No remote changes message removed */}
                        </>
                    ) : (
                        <>
                            {/* No remote changes message removed */}
                                <div className="mt-1 overflow-x-auto rounded">
                                    <div className="min-w-full">
                                        {remoteFiles.map((status, idx) => (
                                            <RemoteFileRow key={`remote-${status.path}-${idx}`} status={status} />
                                        ))}
                                    </div>
                                </div>
                        </>
                    )}
                </div>
            )}
        </>
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
                            type: e.target.value as VcsFileTypeFilter,
                        })
                    }
                >
                    {VcsFileTypeFilterOptions.map((option) => (
                        <option
                            key={option.value}
                            value={option.value}
                            className="bg-panel text-foreground"
                        >
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
                    onClick={() => onChange(makeDefaultFileFilterState())}
                >
                    Reset
                </button>
            )}
        </div>
    );
}

function RepoPanel({
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
        fileFilterState.type ?? "all",
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
        if (!fileStatuses || fileStatuses.length === 0) {
            return;
        }
        const nextSet = new Set(selectedFiles ?? []);
        for (const fileStatus of fileStatuses) {
            if (!isBlank(fileStatus?.path)) {
                nextSet.add(fileStatus.path);
            }
        }
        setSelectedFiles(Array.from(nextSet));
    };
    const clearAllFor = (fileStatuses: VcsFileStatus[]) => {
        if (!fileStatuses || fileStatuses.length === 0) {
            return;
        }
        const removeSet = new Set(fileStatuses.map((status) => status.path));
        setSelectedFiles((selectedFiles ?? []).filter((filePath) => !removeSet.has(filePath)));
    };
    const hasSelectedFiles = (selectedFiles?.length ?? 0) > 0;
    const remoteSectionOpen = sectionState.remote ?? true;

    return (
        <div className="mt-2 rounded-md p-2 bg-black/25">
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
                        <button
                            className="text-[11px] text-accent hover:underline cursor-pointer disabled:text-muted disabled:no-underline disabled:cursor-default"
                            onClick={() => selectAllFor(filteredChangedList)}
                            disabled={filteredChangedList.length === 0}
                        >
                            Select All
                        </button>
                        <button
                            className="text-[11px] text-secondary hover:underline cursor-pointer disabled:text-muted disabled:no-underline disabled:cursor-default"
                            onClick={() => clearAllFor(filteredChangedList)}
                            disabled={filteredChangedList.length === 0}
                        >
                            Select None
                        </button>
                    </>
                }
            />
            {sectionState.changes && (
                <>
                    {/* No changed files message removed */}
                        <div className="mt-1 overflow-x-auto rounded">
                            <div className="min-w-full">
                                {filteredChangedList.map((status, idx) => (
                                    <FileStatusRow
                                        key={`changed-${status.path}-${idx}`}
                                        status={status}
                                        selected={selectedSet.has(status.path)}
                                        onToggleSelected={() => toggleFile(status.path)}
                                        onOpenDiff={() => onShowFileDiff(status.path)}
                                        onShowHistory={() => onFileHistory(status.path)}
                                    />
                                ))}
                            </div>
                        </div>
                </>
            )}
            <CollapsibleHeader
                title="Untracked"
                count={filteredUntrackedList.length}
                isOpen={sectionState.untracked}
                onToggle={() => setSectionOpen("untracked", !sectionState.untracked)}
                noBorder={true}
                actions={
                    <>
                        <button
                            className="text-[11px] text-accent hover:underline cursor-pointer disabled:text-muted disabled:no-underline disabled:cursor-default"
                            onClick={() => selectAllFor(filteredUntrackedList)}
                            disabled={filteredUntrackedList.length === 0}
                        >
                            Select All
                        </button>
                        <button
                            className="text-[11px] text-secondary hover:underline cursor-pointer disabled:text-muted disabled:no-underline disabled:cursor-default"
                            onClick={() => clearAllFor(filteredUntrackedList)}
                            disabled={filteredUntrackedList.length === 0}
                        >
                            Select None
                        </button>
                    </>
                }
            />
            {sectionState.untracked && (
                <>
                    {/* No untracked files message removed */}
                        <div className="mt-1 overflow-x-auto rounded">
                            <div className="min-w-full">
                                {filteredUntrackedList.map((status, idx) => (
                                    <FileStatusRow
                                        key={`untracked-${status.path}-${idx}`}
                                        status={status}
                                        selected={selectedSet.has(status.path)}
                                        onToggleSelected={() => toggleFile(status.path)}
                                        onOpenDiff={() => onShowFileDiff(status.path)}
                                        onShowHistory={() => onFileHistory(status.path)}
                                    />
                                ))}
                            </div>
                        </div>
                </>
            )}
            <RemoteSection
                repo={repo}
                isOpen={remoteSectionOpen}
                onToggle={() => setSectionOpen("remote", !remoteSectionOpen)}
                onSyncAction={onSyncAction}
                syncRunning={syncRunning}
            />
            {hasSelectedFiles && (
                <>
                    <div className="mt-3 text-xs font-medium text-secondary mb-1">Commit Selected Files</div>
                    <textarea
                        className="w-full min-h-[58px] rounded border border-border bg-panel/80 px-2 py-1.5 text-xs outline-none focus:border-accent"
                        value={commitMessage}
                        onChange={(e) => setCommitMessage(e.target.value)}
                        placeholder="Commit message..."
                    />
                    <div className="mt-2 flex items-center gap-2">
                        <button
                            className="rounded bg-action px-2.5 py-1 text-xs text-actiontext font-semibold hover:bg-actionhover disabled:opacity-50 cursor-pointer disabled:cursor-default"
                            disabled={commitRunning}
                            onClick={onCommit}
                        >
                            {commitRunning ? "Committing..." : `Commit (${selectedFiles.length})`}
                        </button>
                        <span className="text-[11px] text-muted">supports multi-select</span>
                    </div>
                </>
            )}
        </div>
    );
}

function VcsView({ model }: ViewComponentProps<VcsViewModel>) {
    const env = useWaveEnv<VcsUiEnv>();
    const connStatus = useAtomValue(model.connStatus);
    const connection = useAtomValue(model.connection);
    const basePath = useAtomValue(model.pathAtom);
    const selectedFile = useAtomValue(model.selectedFileAtom);
    const refreshNonce = useAtomValue(model.refreshNonce);
    const blockMoveMenuItems = useBlockMoveMenuItems();

    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState<string>(null);
    const [repos, setRepos] = React.useState<VcsRepositoryInfo[]>([]);
    const [expandedRepos, setExpandedRepos] = React.useState<Record<string, boolean>>({});
    const [activeRepoId, setActiveRepoId] = React.useState<string>("");
    const [selectedFilesByRepo, setSelectedFilesByRepo] = React.useState<RepoFilesMap>({});
    const [commitMessageByRepo, setCommitMessageByRepo] = React.useState<RepoStringMap>({});
    const [commitRunningByRepo, setCommitRunningByRepo] = React.useState<RepoBoolMap>({});
    const [syncRunningByRepo, setSyncRunningByRepo] = React.useState<RepoBoolMap>({});
    const [operationNoticeByRepo, setOperationNoticeByRepo] = React.useState<RepoNoticeMap>({});
    const [sectionStateByRepo, setSectionStateByRepo] = React.useState<RepoSectionsMap>({});
    const [fileFilterByRepo, setFileFilterByRepo] = React.useState<RepoFileFiltersMap>({});

    const clearOperationNotice = React.useCallback((repoId: string) => {
        setOperationNoticeByRepo((prev) => {
            if (prev[repoId] == null) {
                return prev;
            }
            const next = { ...prev };
            delete next[repoId];
            return next;
        });
    }, []);

    const setOperationNotice = React.useCallback((repoId: string, message: string, isError: boolean) => {
        const notice: VcsOperationNotice = {
            id: Date.now() + Math.random(),
            message,
            isError,
        };
        setOperationNoticeByRepo((prev) => ({ ...prev, [repoId]: notice }));
    }, []);

    const route = React.useMemo(() => {
        if (isBlank(connection)) {
            return null;
        }
        return makeConnRoute(connection);
    }, [connection]);

    const loadRepositories = React.useCallback(async () => {
        if (connStatus?.status !== "connected") {
            setLoading(false);
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const response = await env.rpc.RemoteVcsRepositoriesCommand(
                TabRpcClient,
                {
                    path: basePath,
                    statuslimit: 300,
                    scandepth: 3,
                    includeparent: true,
                },
                { route, timeout: VcsRepositoryRpcTimeoutMs }
            );
            const repoList = response.repositories ?? [];
            setRepos(repoList);
            if (repoList.length > 0) {
                setActiveRepoId((prev) => prev || repoList[0].repoid);
                setExpandedRepos((prev) => {
                    const next = { ...prev };
                    for (const repo of repoList) {
                        if (next[repo.repoid] == null) {
                            next[repo.repoid] = repoList.length === 1;
                        }
                    }
                    return next;
                });
                if (!isBlank(selectedFile)) {
                    setSelectedFilesByRepo((prev) => {
                        const next = { ...prev };
                        const selectedFileNormalized = selectedFile.replace(/\\/g, "/");
                        for (const repo of repoList) {
                            if (next[repo.repoid]?.length > 0) {
                                continue;
                            }
                            const repoRootNormalized = repo.rootpath.replace(/\\/g, "/");
                            if (
                                selectedFileNormalized !== repoRootNormalized &&
                                !selectedFileNormalized.startsWith(repoRootNormalized + "/")
                            ) {
                                continue;
                            }
                            let relPath = selectedFileNormalized.slice(repoRootNormalized.length);
                            relPath = relPath.replace(/^\/+/, "");
                            if (isBlank(relPath)) {
                                continue;
                            }
                            next[repo.repoid] = [relPath];
                        }
                        return next;
                    });
                }
                setCommitMessageByRepo((prev) => {
                    const next = { ...prev };
                    for (const repo of repoList) {
                        if (isBlank(next[repo.repoid])) {
                            next[repo.repoid] = DefaultCommitMessage;
                        }
                    }
                    return next;
                });
                setSectionStateByRepo((prev) => {
                    const next = { ...prev };
                    for (const repo of repoList) {
                        next[repo.repoid] = {
                            ...makeDefaultSectionState(),
                            ...(next[repo.repoid] ?? {}),
                        };
                    }
                    return next;
                });
                setFileFilterByRepo((prev) => {
                    const next = { ...prev };
                    for (const repo of repoList) {
                        if (next[repo.repoid] == null) {
                            next[repo.repoid] = makeDefaultFileFilterState();
                        }
                    }
                    return next;
                });
            }
        } catch (e) {
            setRepos([]);
            setError(String(e));
        } finally {
            setLoading(false);
        }
    }, [basePath, connStatus?.status, env.rpc, route, selectedFile]);

    React.useEffect(() => {
        loadRepositories();
    }, [loadRepositories, refreshNonce]);

    const toggleRepo = async (repo: VcsRepositoryInfo) => {
        setActiveRepoId(repo.repoid);
        setExpandedRepos((prev) => ({ ...prev, [repo.repoid]: !prev[repo.repoid] }));
    };

    const refreshRepo = async (repoId?: string) => {
        if (!isBlank(repoId)) {
            clearOperationNotice(repoId);
        }
        await loadRepositories();
    };

    const setRepoSelectedFiles = (repoId: string, files: string[]) => {
        setSelectedFilesByRepo((prev) => ({ ...prev, [repoId]: files }));
    };

    const setRepoSectionOpen = (repoId: string, section: RepoSectionKey, open: boolean) => {
        setSectionStateByRepo((prev) => {
            const currentState = prev[repoId] ?? makeDefaultSectionState();
            return {
                ...prev,
                [repoId]: {
                    ...currentState,
                    [section]: open,
                },
            };
        });
    };

    const setRepoFileFilterState = (repoId: string, nextFilterState: RepoFileFilterState) => {
        setFileFilterByRepo((prev) => ({
            ...prev,
            [repoId]: {
                search: nextFilterState.search ?? "",
                type: nextFilterState.type ?? "all",
                extension: nextFilterState.extension ?? "",
            },
        }));
    };

    const handleCommit = async (repo: VcsRepositoryInfo) => {
        const selectedFiles = selectedFilesByRepo[repo.repoid] ?? [];
        const commitMessage = (commitMessageByRepo[repo.repoid] ?? "").trim();
        if (selectedFiles.length === 0) {
            setOperationNotice(repo.repoid, "Please select at least one file.", true);
            return;
        }
        if (isBlank(commitMessage)) {
            setOperationNotice(repo.repoid, "Please enter a commit message.", true);
            return;
        }
        setCommitRunningByRepo((prev) => ({ ...prev, [repo.repoid]: true }));
        clearOperationNotice(repo.repoid);
        try {
            const response = await env.rpc.RemoteVcsCommitCommand(
                TabRpcClient,
                {
                    repotype: repo.repotype,
                    repopath: repo.rootpath,
                    message: commitMessage,
                    files: selectedFiles,
                },
                { route, timeout: VcsMutationRpcTimeoutMs }
            );
            if (response.success) {
                setOperationNotice(repo.repoid, response.output || "Commit completed.", false);
                setSelectedFilesByRepo((prev) => ({ ...prev, [repo.repoid]: [] }));
                await loadRepositories();
            } else {
                const resultMsg = response.error || response.output || "Commit failed.";
                setOperationNotice(repo.repoid, resultMsg, true);
            }
        } catch (e) {
            setOperationNotice(repo.repoid, String(e), true);
        } finally {
            setCommitRunningByRepo((prev) => ({ ...prev, [repo.repoid]: false }));
        }
    };

    const handleSync = async (repo: VcsRepositoryInfo, action?: VcsSyncAction) => {
        const syncAction = action ?? getDefaultSyncAction(repo);
        setActiveRepoId(repo.repoid);
        setExpandedRepos((prev) => ({ ...prev, [repo.repoid]: true }));
        setSyncRunningByRepo((prev) => ({ ...prev, [repo.repoid]: true }));
        clearOperationNotice(repo.repoid);
        let shouldRefresh = false;
        try {
            const response = await env.rpc.RemoteVcsSyncCommand(
                TabRpcClient,
                {
                    repotype: repo.repotype,
                    repopath: repo.rootpath,
                    action: syncAction,
                },
                { route, timeout: VcsMutationRpcTimeoutMs }
            );
            if (response.success) {
                setOperationNotice(repo.repoid, response.output || getSyncCompletionLabel(syncAction), false);
                shouldRefresh = true;
            } else {
                setOperationNotice(
                    repo.repoid,
                    response.error || response.output || getSyncFailureLabel(syncAction),
                    true
                );
            }
        } catch (e) {
            setOperationNotice(repo.repoid, String(e), true);
        } finally {
            setSyncRunningByRepo((prev) => ({ ...prev, [repo.repoid]: false }));
        }
        if (shouldRefresh) {
            await loadRepositories();
        }
    };

    const openHistoryBlock = async (repo: VcsRepositoryInfo, filePath: string) => {
        if (!repo || isBlank(filePath)) {
            return;
        }
        const blockDef: BlockDef = {
            meta: {
                view: "vcshistory",
                connection,
                "vcshistory:repotype": repo.repotype,
                "vcshistory:repopath": repo.rootpath,
                "vcshistory:filepath": filePath,
                "vcshistory:title": `History: ${filePath}`,
            } as any,
        };
        await createBlock(blockDef);
    };

    const openCommitsBlock = async (repo: VcsRepositoryInfo) => {
        if (!repo) {
            return;
        }
        const blockDef: BlockDef = {
            meta: {
                view: "vcscommits",
                connection,
                "vcscommits:repotype": repo.repotype,
                "vcscommits:repopath": repo.rootpath,
                "vcscommits:title": `${repo.name} Commits`,
            } as any,
        };
        await createBlock(blockDef);
    };

    const openDiffBlock = async (repo: VcsRepositoryInfo, filePath: string, revision: string = "") => {
        if (!repo || isBlank(filePath)) {
            return;
        }
        const trimmedRevision = revision?.trim() ?? "";
        const title = isBlank(trimmedRevision)
            ? `${filePath} (working tree)`
            : `${filePath} @ ${shortHash(trimmedRevision)}`;
        const blockDef: BlockDef = {
            meta: {
                view: "vcsdiff",
                connection,
                "vcsdiff:repotype": repo.repotype,
                "vcsdiff:repopath": repo.rootpath,
                "vcsdiff:filepath": filePath,
                "vcsdiff:revision": trimmedRevision,
                "vcsdiff:mode": "side-by-side",
                "vcsdiff:title": title,
            } as any,
        };
        await createBlock(blockDef);
    };

    const handleRepoContextMenu = (repo: VcsRepositoryInfo, e: React.MouseEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        const repoPath = repo?.rootpath ?? "";
        const repoRemoteUrl = repo?.remoteurl ?? "";
        const repoBrowseUrl = repo?.browseurl ?? "";
        const openUrl = !isBlank(repoBrowseUrl) ? repoBrowseUrl : repoRemoteUrl;
        const copyUrl = !isBlank(repoRemoteUrl) ? repoRemoteUrl : repoBrowseUrl;
        const menu: ContextMenuItem[] = [
            {
                label: "Copy Repository Path",
                enabled: !isBlank(repoPath),
                click: () => {
                    fireAndForget(async () => {
                        await navigator.clipboard.writeText(repoPath);
                    });
                },
            },
            {
                label: "Copy Repository URL",
                enabled: !isBlank(copyUrl),
                click: () => {
                    fireAndForget(async () => {
                        await navigator.clipboard.writeText(copyUrl);
                    });
                },
            },
            {
                label: "Open Remote Repository",
                enabled: !isBlank(openUrl),
                click: () => {
                    fireAndForget(async () => {
                        await openLink(openUrl);
                    });
                },
            },
        ];
        ContextMenuModel.getInstance().showContextMenu(appendBlockMoveMenuItems(menu, blockMoveMenuItems), e);
    };

    if (connStatus?.status !== "connected") {
        return (
            <div className="h-full w-full flex items-center justify-center text-sm text-muted">
                Connection unavailable.
            </div>
        );
    }

    return (
        <div className="h-full w-full overflow-hidden p-2">
            <div className="h-full w-full overflow-auto rounded p-2">
                {loading && <div className="text-sm text-muted">Loading repositories...</div>}
                {!loading && error && <div className="text-sm text-error whitespace-pre-wrap">{error}</div>}
                {!loading && !error && repos.length === 0 && (
                    <div className="text-sm text-muted">No Git/SVN repository found in this path.</div>
                )}
                {!loading && !error && repos.length > 0 && (
                    <div className="flex flex-col gap-2">
                        {repos.map((repo) => (
                            <div key={repo.repoid} className="rounded-md">
                                <RepoHeader
                                    repo={repo}
                                    isExpanded={!!expandedRepos[repo.repoid]}
                                    isActive={activeRepoId === repo.repoid}
                                    onToggle={() => {
                                        toggleRepo(repo);
                                    }}
                                    onOpenCommits={() => {
                                        openCommitsBlock(repo).catch((e) => {
                                            setError(String(e));
                                        });
                                    }}
                                    onSync={() => {
                                        handleSync(repo).catch((e) => {
                                            setError(String(e));
                                        });
                                    }}
                                    onRefresh={() => {
                                        refreshRepo(repo.repoid);
                                    }}
                                    onContextMenu={(e) => handleRepoContextMenu(repo, e)}
                                    syncRunning={!!syncRunningByRepo[repo.repoid]}
                                />
                                {expandedRepos[repo.repoid] && (
                                    <RepoPanel
                                        repo={repo}
                                        selectedFiles={selectedFilesByRepo[repo.repoid] ?? []}
                                        setSelectedFiles={(next) => setRepoSelectedFiles(repo.repoid, next)}
                                        commitMessage={commitMessageByRepo[repo.repoid] ?? DefaultCommitMessage}
                                        setCommitMessage={(next) =>
                                            setCommitMessageByRepo((prev) => ({ ...prev, [repo.repoid]: next }))
                                        }
                                        onCommit={() => handleCommit(repo)}
                                        commitRunning={!!commitRunningByRepo[repo.repoid]}
                                        operationNotice={operationNoticeByRepo[repo.repoid]}
                                        onDismissNotice={() => clearOperationNotice(repo.repoid)}
                                        onFileHistory={(filePath) => {
                                            openHistoryBlock(repo, filePath).catch((e) => {
                                                setError(String(e));
                                            });
                                        }}
                                        onShowFileDiff={(filePath) => {
                                            openDiffBlock(repo, filePath).catch((e) => {
                                                setError(String(e));
                                            });
                                        }}
                                        sectionState={sectionStateByRepo[repo.repoid] ?? makeDefaultSectionState()}
                                        setSectionOpen={(section, open) =>
                                            setRepoSectionOpen(repo.repoid, section, open)
                                        }
                                        fileFilterState={fileFilterByRepo[repo.repoid] ?? makeDefaultFileFilterState()}
                                        setFileFilterState={(next) => setRepoFileFilterState(repo.repoid, next)}
                                        onSyncAction={(action) => {
                                            handleSync(repo, action).catch((e) => {
                                                setError(String(e));
                                            });
                                        }}
                                        syncRunning={!!syncRunningByRepo[repo.repoid]}
                                    />
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
