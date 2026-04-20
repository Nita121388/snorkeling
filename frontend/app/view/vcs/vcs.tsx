// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { ContextMenuModel } from "@/app/store/contextmenu";
import { globalStore } from "@/app/store/jotaiStore";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import type { WaveEnv } from "@/app/waveenv/waveenv";
import { useWaveEnv } from "@/app/waveenv/waveenv";
import { createBlock, openLink } from "@/store/global";
import { fireAndForget, isBlank, makeConnRoute } from "@/util/util";
import { Atom, atom, useAtomValue } from "jotai";
import React from "react";

const DefaultCommitMessage = "chore: update selected files";

type VcsUiEnv = WaveEnv;

type RepoStringMap = Record<string, string>;
type RepoBoolMap = Record<string, boolean>;
type RepoFilesMap = Record<string, string[]>;
type RepoSectionKey = "changes" | "untracked";
type RepoSectionState = Record<RepoSectionKey, boolean>;
type RepoSectionsMap = Record<string, RepoSectionState>;

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

function makeDefaultSectionState(): RepoSectionState {
    return {
        changes: true,
        untracked: true,
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
            return [
                {
                    elemtype: "text",
                    text: basePath,
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
    const syncLabel = repo.repotype === "svn" ? "Update" : "Pull";
    const syncRunningLabel = repo.repotype === "svn" ? "Updating..." : "Pulling...";
    return (
        <div
            className={`flex items-center gap-2 rounded-md border px-2 py-1.5 ${
                isActive ? "border-accent bg-white/7" : "border-white/10 bg-black/20"
            }`}
            onContextMenu={onContextMenu}
        >
            <button
                className="flex min-w-0 flex-1 items-center gap-2 text-left cursor-pointer"
                onClick={onToggle}
                title="Toggle repository"
            >
                <span className="text-[11px] text-muted w-[14px]">{isExpanded ? "▾" : "▸"}</span>
                <span className="text-[11px] rounded border border-white/10 px-1.5 py-[1px] text-secondary uppercase">
                    {repo.repotype}
                </span>
                <div className="min-w-0 flex-1 overflow-x-auto">
                    <div className="flex w-max min-w-full items-center gap-2 pr-2">
                        <span className="font-medium text-sm whitespace-nowrap">{repo.name}</span>
                        <span className="text-xs text-secondary whitespace-nowrap">{repo.branch || "(no branch)"}</span>
                    </div>
                </div>
                <span className="text-[11px] text-muted shrink-0">
                    C:{summary.changed} U:{summary.untracked}
                </span>
            </button>
            <button
                className="rounded border border-white/15 px-2 py-[3px] text-[11px] text-secondary hover:bg-white/5 cursor-pointer disabled:text-muted disabled:cursor-default disabled:hover:bg-transparent shrink-0"
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
        <div className="flex w-max min-w-full items-center gap-2 border-b border-white/8 px-2 py-1.5 text-xs last:border-b-0">
            <input type="checkbox" checked={selected} onChange={onToggleSelected} className="cursor-pointer" />
            <span className="font-mono text-secondary min-w-[20px]">{statusCodeLabel(status.code)}</span>
            <span className="flex-1 min-w-[180px] whitespace-nowrap pr-3">{status.path}</span>
            <button
                className="text-[11px] text-accent hover:underline cursor-pointer shrink-0"
                onClick={onOpenDiff}
            >
                Diff
            </button>
            <button
                className="text-[11px] text-accent hover:underline cursor-pointer shrink-0"
                onClick={onShowHistory}
            >
                History
            </button>
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
    commitResult,
    onFileHistory,
    onShowFileDiff,
    sectionState,
    setSectionOpen,
    syncResult,
    syncResultIsError,
}: {
    repo: VcsRepositoryInfo;
    selectedFiles: string[];
    setSelectedFiles: (next: string[]) => void;
    commitMessage: string;
    setCommitMessage: (next: string) => void;
    onCommit: () => void;
    commitRunning: boolean;
    commitResult: string;
    onFileHistory: (filePath: string) => void;
    onShowFileDiff: (filePath: string) => void;
    sectionState: RepoSectionState;
    setSectionOpen: (section: RepoSectionKey, open: boolean) => void;
    syncResult?: string;
    syncResultIsError?: boolean;
}) {
    const statusList = repo.status ?? [];
    const changedList = statusList.filter((status) => !status.untracked);
    const untrackedList = statusList.filter((status) => !!status.untracked);
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

    return (
        <div className="mt-2 rounded-md border border-white/10 p-2 bg-black/25">
            {syncResult && (
                <div className={`mb-2 text-xs whitespace-pre-wrap ${syncResultIsError ? "text-warning" : "text-secondary"}`}>
                    {syncResult}
                </div>
            )}
            {repo.statuserr && <div className="text-xs text-warning mb-2">Status warning: {repo.statuserr}</div>}
            <CollapsibleHeader
                title="Changes"
                count={changedList.length}
                isOpen={sectionState.changes}
                onToggle={() => setSectionOpen("changes", !sectionState.changes)}
                noBorder={true}
                actions={
                    <>
                        <button
                            className="text-[11px] text-accent hover:underline cursor-pointer disabled:text-muted disabled:no-underline disabled:cursor-default"
                            onClick={() => selectAllFor(changedList)}
                            disabled={changedList.length === 0}
                        >
                            Select All
                        </button>
                        <button
                            className="text-[11px] text-secondary hover:underline cursor-pointer disabled:text-muted disabled:no-underline disabled:cursor-default"
                            onClick={() => clearAllFor(changedList)}
                            disabled={changedList.length === 0}
                        >
                            Select None
                        </button>
                    </>
                }
            />
            {sectionState.changes && (
                <>
                    {changedList.length === 0 ? (
                        <div className="text-xs text-muted mt-1">No changed files.</div>
                    ) : (
                        <div className="mt-1 max-h-[180px] overflow-x-auto overflow-y-auto rounded">
                            <div className="min-w-full">
                                {changedList.map((status, idx) => (
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
                    )}
                </>
            )}
            <CollapsibleHeader
                title="Untracked"
                count={untrackedList.length}
                isOpen={sectionState.untracked}
                onToggle={() => setSectionOpen("untracked", !sectionState.untracked)}
                noBorder={true}
                actions={
                    <>
                        <button
                            className="text-[11px] text-accent hover:underline cursor-pointer disabled:text-muted disabled:no-underline disabled:cursor-default"
                            onClick={() => selectAllFor(untrackedList)}
                            disabled={untrackedList.length === 0}
                        >
                            Select All
                        </button>
                        <button
                            className="text-[11px] text-secondary hover:underline cursor-pointer disabled:text-muted disabled:no-underline disabled:cursor-default"
                            onClick={() => clearAllFor(untrackedList)}
                            disabled={untrackedList.length === 0}
                        >
                            Select None
                        </button>
                    </>
                }
            />
            {sectionState.untracked && (
                <>
                    {untrackedList.length === 0 ? (
                        <div className="text-xs text-muted mt-1">No untracked files.</div>
                    ) : (
                        <div className="mt-1 max-h-[180px] overflow-x-auto overflow-y-auto rounded">
                            <div className="min-w-full">
                                {untrackedList.map((status, idx) => (
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
                    )}
                </>
            )}
            {hasSelectedFiles && (
                <>
                    <div className="mt-3 text-xs font-medium text-secondary mb-1">Commit Selected Files</div>
                    <textarea
                        className="w-full min-h-[58px] rounded border border-white/15 bg-black/30 px-2 py-1.5 text-xs outline-none focus:border-accent"
                        value={commitMessage}
                        onChange={(e) => setCommitMessage(e.target.value)}
                        placeholder="Commit message..."
                    />
                    <div className="mt-2 flex items-center gap-2">
                        <button
                            className="rounded bg-accent px-2.5 py-1 text-xs text-black font-semibold hover:bg-accenthover disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                            disabled={commitRunning}
                            onClick={onCommit}
                        >
                            {commitRunning ? "Committing..." : `Commit (${selectedFiles.length})`}
                        </button>
                        <span className="text-[11px] text-muted">supports multi-select</span>
                    </div>
                    {commitResult && <div className="mt-1.5 text-xs text-secondary whitespace-pre-wrap">{commitResult}</div>}
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

    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState<string>(null);
    const [repos, setRepos] = React.useState<VcsRepositoryInfo[]>([]);
    const [expandedRepos, setExpandedRepos] = React.useState<Record<string, boolean>>({});
    const [activeRepoId, setActiveRepoId] = React.useState<string>("");
    const [selectedFilesByRepo, setSelectedFilesByRepo] = React.useState<RepoFilesMap>({});
    const [commitMessageByRepo, setCommitMessageByRepo] = React.useState<RepoStringMap>({});
    const [commitRunningByRepo, setCommitRunningByRepo] = React.useState<RepoBoolMap>({});
    const [commitResultByRepo, setCommitResultByRepo] = React.useState<RepoStringMap>({});
    const [syncRunningByRepo, setSyncRunningByRepo] = React.useState<RepoBoolMap>({});
    const [syncResultByRepo, setSyncResultByRepo] = React.useState<RepoStringMap>({});
    const [syncResultErrorByRepo, setSyncResultErrorByRepo] = React.useState<RepoBoolMap>({});
    const [sectionStateByRepo, setSectionStateByRepo] = React.useState<RepoSectionsMap>({});

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
                { route }
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

    const refreshRepo = async () => {
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

    const handleCommit = async (repo: VcsRepositoryInfo) => {
        const selectedFiles = selectedFilesByRepo[repo.repoid] ?? [];
        const commitMessage = (commitMessageByRepo[repo.repoid] ?? "").trim();
        if (selectedFiles.length === 0) {
            setCommitResultByRepo((prev) => ({ ...prev, [repo.repoid]: "Please select at least one file." }));
            return;
        }
        if (isBlank(commitMessage)) {
            setCommitResultByRepo((prev) => ({ ...prev, [repo.repoid]: "Please enter a commit message." }));
            return;
        }
        setCommitRunningByRepo((prev) => ({ ...prev, [repo.repoid]: true }));
        setCommitResultByRepo((prev) => ({ ...prev, [repo.repoid]: "" }));
        try {
            const response = await env.rpc.RemoteVcsCommitCommand(
                TabRpcClient,
                {
                    repotype: repo.repotype,
                    repopath: repo.rootpath,
                    message: commitMessage,
                    files: selectedFiles,
                },
                { route }
            );
            if (response.success) {
                setCommitResultByRepo((prev) => ({
                    ...prev,
                    [repo.repoid]: response.output || "Commit completed.",
                }));
                setSelectedFilesByRepo((prev) => ({ ...prev, [repo.repoid]: [] }));
                await loadRepositories();
            } else {
                const resultMsg = response.error || response.output || "Commit failed.";
                setCommitResultByRepo((prev) => ({ ...prev, [repo.repoid]: resultMsg }));
            }
        } catch (e) {
            setCommitResultByRepo((prev) => ({ ...prev, [repo.repoid]: String(e) }));
        } finally {
            setCommitRunningByRepo((prev) => ({ ...prev, [repo.repoid]: false }));
        }
    };

    const handleSync = async (repo: VcsRepositoryInfo) => {
        setActiveRepoId(repo.repoid);
        setExpandedRepos((prev) => ({ ...prev, [repo.repoid]: true }));
        setSyncRunningByRepo((prev) => ({ ...prev, [repo.repoid]: true }));
        setSyncResultByRepo((prev) => ({ ...prev, [repo.repoid]: "" }));
        setSyncResultErrorByRepo((prev) => ({ ...prev, [repo.repoid]: false }));
        try {
            const response = await env.rpc.RemoteVcsSyncCommand(
                TabRpcClient,
                {
                    repotype: repo.repotype,
                    repopath: repo.rootpath,
                },
                { route }
            );
            if (response.success) {
                setSyncResultByRepo((prev) => ({
                    ...prev,
                    [repo.repoid]: response.output || (repo.repotype === "svn" ? "Update completed." : "Pull completed."),
                }));
                setSyncResultErrorByRepo((prev) => ({ ...prev, [repo.repoid]: false }));
                await loadRepositories();
            } else {
                setSyncResultByRepo((prev) => ({
                    ...prev,
                    [repo.repoid]: response.error || response.output || (repo.repotype === "svn" ? "Update failed." : "Pull failed."),
                }));
                setSyncResultErrorByRepo((prev) => ({ ...prev, [repo.repoid]: true }));
            }
        } catch (e) {
            setSyncResultByRepo((prev) => ({ ...prev, [repo.repoid]: String(e) }));
            setSyncResultErrorByRepo((prev) => ({ ...prev, [repo.repoid]: true }));
        } finally {
            setSyncRunningByRepo((prev) => ({ ...prev, [repo.repoid]: false }));
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
        ContextMenuModel.getInstance().showContextMenu(menu, e);
    };

    if (connStatus?.status !== "connected") {
        return <div className="h-full w-full flex items-center justify-center text-sm text-muted">Connection unavailable.</div>;
    }

    return (
        <div className="h-full w-full overflow-hidden p-2">
            <div className="h-full w-full overflow-auto rounded border border-white/10 bg-black/20 p-2">
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
                                        refreshRepo();
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
                                        commitResult={commitResultByRepo[repo.repoid]}
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
                                        syncResult={syncResultByRepo[repo.repoid]}
                                        syncResultIsError={!!syncResultErrorByRepo[repo.repoid]}
                                        sectionState={sectionStateByRepo[repo.repoid] ?? makeDefaultSectionState()}
                                        setSectionOpen={(section, open) => setRepoSectionOpen(repo.repoid, section, open)}
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
