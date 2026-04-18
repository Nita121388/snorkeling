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

type RepoLogsMap = Record<string, VcsCommitInfo[]>;
type RepoErrorMap = Record<string, string>;
type RepoStringMap = Record<string, string>;
type RepoBoolMap = Record<string, boolean>;
type RepoFilesMap = Record<string, string[]>;
type RepoSectionKey = "changes" | "untracked" | "commits";
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
        commits: false,
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
    onRefresh,
    onContextMenu,
}: {
    repo: VcsRepositoryInfo;
    isExpanded: boolean;
    isActive: boolean;
    onToggle: () => void;
    onRefresh: () => void;
    onContextMenu: (e: React.MouseEvent<HTMLDivElement>) => void;
}) {
    const summary = countByCode(repo?.status ?? []);
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
                <span className="truncate font-medium text-sm">{repo.name}</span>
                <span className="truncate text-xs text-secondary">{repo.branch || "(no branch)"}</span>
                <span className="text-[11px] text-muted shrink-0">
                    C:{summary.changed} U:{summary.untracked}
                </span>
            </button>
            <button className="iconbutton !h-[20px] !w-[20px] cursor-pointer" title="Refresh" onClick={onRefresh}>
                <i className="fa-sharp fa-solid fa-arrows-rotate text-[11px]" />
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
        <div className="flex items-center gap-2 border-b border-white/8 px-2 py-1.5 text-xs last:border-b-0">
            <input type="checkbox" checked={selected} onChange={onToggleSelected} className="cursor-pointer" />
            <span className="font-mono text-secondary min-w-[20px]">{statusCodeLabel(status.code)}</span>
            <span className="truncate flex-1">{status.path}</span>
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

function CommitList({
    commits,
    onOpenDiff,
}: {
    commits: VcsCommitInfo[];
    onOpenDiff?: (commit: VcsCommitInfo) => void;
}) {
    if (!commits || commits.length === 0) {
        return <div className="text-xs text-muted">No commits yet.</div>;
    }
    return (
        <div className="flex flex-col gap-1">
            {commits.map((commit, idx) => (
                <div
                    key={`${commit.hash}-${idx}`}
                    className={`rounded border border-white/10 px-2 py-1.5 bg-black/20 ${
                        onOpenDiff && !isBlank(commit.hash) ? "cursor-pointer hover:bg-black/35" : ""
                    }`}
                    onClick={() => {
                        if (onOpenDiff && !isBlank(commit.hash)) {
                            onOpenDiff(commit);
                        }
                    }}
                >
                    <div className="flex items-center gap-2 text-xs">
                        <span className="font-mono text-secondary">{shortHash(commit.hash)}</span>
                        <span className="truncate flex-1">{commit.subject || "(no message)"}</span>
                        {onOpenDiff && !isBlank(commit.hash) && (
                            <button
                                className="text-[11px] text-accent hover:underline cursor-pointer shrink-0"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onOpenDiff(commit);
                                }}
                            >
                                Open Diff
                            </button>
                        )}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted">
                        <span className="truncate">{commit.author || "unknown"}</span>
                        <span className="truncate">{commit.date || ""}</span>
                    </div>
                </div>
            ))}
        </div>
    );
}

function RepoPanel({
    repo,
    selectedFiles,
    setSelectedFiles,
    logs,
    logsLoading,
    logsError,
    commitMessage,
    setCommitMessage,
    onCommit,
    commitRunning,
    commitResult,
    onFileHistory,
    onShowFileDiff,
    sectionState,
    setSectionOpen,
}: {
    repo: VcsRepositoryInfo;
    selectedFiles: string[];
    setSelectedFiles: (next: string[]) => void;
    logs: VcsCommitInfo[];
    logsLoading: boolean;
    logsError: string;
    commitMessage: string;
    setCommitMessage: (next: string) => void;
    onCommit: () => void;
    commitRunning: boolean;
    commitResult: string;
    onFileHistory: (filePath: string) => void;
    onShowFileDiff: (filePath: string) => void;
    sectionState: RepoSectionState;
    setSectionOpen: (section: RepoSectionKey, open: boolean) => void;
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
                            全选
                        </button>
                        <button
                            className="text-[11px] text-secondary hover:underline cursor-pointer disabled:text-muted disabled:no-underline disabled:cursor-default"
                            onClick={() => clearAllFor(changedList)}
                            disabled={changedList.length === 0}
                        >
                            全不选
                        </button>
                    </>
                }
            />
            {sectionState.changes && (
                <>
                    {changedList.length === 0 ? (
                        <div className="text-xs text-muted mt-1">No changed files.</div>
                    ) : (
                        <div className="mt-1 max-h-[180px] overflow-auto rounded">
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
                            全选
                        </button>
                        <button
                            className="text-[11px] text-secondary hover:underline cursor-pointer disabled:text-muted disabled:no-underline disabled:cursor-default"
                            onClick={() => clearAllFor(untrackedList)}
                            disabled={untrackedList.length === 0}
                        >
                            全不选
                        </button>
                    </>
                }
            />
            {sectionState.untracked && (
                <>
                    {untrackedList.length === 0 ? (
                        <div className="text-xs text-muted mt-1">No untracked files.</div>
                    ) : (
                        <div className="mt-1 max-h-[180px] overflow-auto rounded">
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
            <CollapsibleHeader
                title="Recent Commits"
                count={logs?.length ?? 0}
                isOpen={sectionState.commits}
                onToggle={() => setSectionOpen("commits", !sectionState.commits)}
            />
            {sectionState.commits && (
                <div className="mt-1">
                    {logsLoading && <div className="text-xs text-muted mb-2">Loading commits...</div>}
                    {logsError && <div className="text-xs text-error mb-2">{logsError}</div>}
                    {!logsLoading && !logsError && <CommitList commits={logs ?? []} />}
                </div>
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
    const [logsByRepo, setLogsByRepo] = React.useState<RepoLogsMap>({});
    const [logsLoadingByRepo, setLogsLoadingByRepo] = React.useState<RepoBoolMap>({});
    const [logsErrorByRepo, setLogsErrorByRepo] = React.useState<RepoErrorMap>({});
    const [sectionStateByRepo, setSectionStateByRepo] = React.useState<RepoSectionsMap>({});

    const route = React.useMemo(() => {
        if (isBlank(connection)) {
            return null;
        }
        return makeConnRoute(connection);
    }, [connection]);

    const loadRepoLogs = React.useCallback(
        async (repo: VcsRepositoryInfo, forceRefresh = false) => {
            if (!forceRefresh && logsByRepo[repo.repoid]) {
                return;
            }
            setLogsLoadingByRepo((prev) => ({ ...prev, [repo.repoid]: true }));
            setLogsErrorByRepo((prev) => ({ ...prev, [repo.repoid]: "" }));
            try {
                const response = await env.rpc.RemoteVcsCommitsCommand(
                    TabRpcClient,
                    {
                        repotype: repo.repotype,
                        repopath: repo.rootpath,
                        limit: 50,
                    },
                    { route }
                );
                setLogsByRepo((prev) => ({ ...prev, [repo.repoid]: response.commits ?? [] }));
            } catch (e) {
                setLogsErrorByRepo((prev) => ({ ...prev, [repo.repoid]: String(e) }));
            } finally {
                setLogsLoadingByRepo((prev) => ({ ...prev, [repo.repoid]: false }));
            }
        },
        [env.rpc, logsByRepo, route]
    );

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
        await loadRepoLogs(repo);
    };

    const refreshRepo = async (repo: VcsRepositoryInfo) => {
        await loadRepositories();
        await loadRepoLogs(repo, true);
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
                await loadRepoLogs(repo, true);
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
                label: "复制仓库路径",
                enabled: !isBlank(repoPath),
                click: () => {
                    fireAndForget(async () => {
                        await navigator.clipboard.writeText(repoPath);
                    });
                },
            },
            {
                label: "复制仓库链接",
                enabled: !isBlank(copyUrl),
                click: () => {
                    fireAndForget(async () => {
                        await navigator.clipboard.writeText(copyUrl);
                    });
                },
            },
            {
                label: "跳转到远程仓库",
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
                                    onRefresh={() => {
                                        refreshRepo(repo);
                                    }}
                                    onContextMenu={(e) => handleRepoContextMenu(repo, e)}
                                />
                                {expandedRepos[repo.repoid] && (
                                    <RepoPanel
                                        repo={repo}
                                        selectedFiles={selectedFilesByRepo[repo.repoid] ?? []}
                                        setSelectedFiles={(next) => setRepoSelectedFiles(repo.repoid, next)}
                                        logs={logsByRepo[repo.repoid] ?? []}
                                        logsLoading={!!logsLoadingByRepo[repo.repoid]}
                                        logsError={logsErrorByRepo[repo.repoid]}
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
