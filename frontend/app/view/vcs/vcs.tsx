// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { appendBlockMoveMenuItems, useBlockMoveMenuItems } from "@/app/block/block-move-menu";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { globalStore } from "@/app/store/jotaiStore";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import type { WaveEnv } from "@/app/waveenv/waveenv";
import { useWaveEnv } from "@/app/waveenv/waveenv";
import { createBlock, openLink } from "@/store/global";
import { basename, fireAndForget, isBlank, makeConnRoute } from "@/util/util";
import { Atom, atom, useAtomValue } from "jotai";
import React from "react";

import { VcsChangesTab, type RepoFileFilterState } from "./vcs-changes-tab";
import { VcsBranchesTab } from "./vcs-branches-tab";
import { VcsPipelinesTab } from "./vcs-pipelines-tab";
import { VcsTabBar, VcsRepoHeader, type View } from "./vcs-tabs";

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
// RepoFileFilterState is imported from vcs-changes-tab.tsx
type RepoFileFiltersMap = Record<string, RepoFileFilterState>;
type VcsOperationNotice = {
    id: number;
    message: string;
    isError: boolean;
};
type RepoNoticeMap = Record<string, VcsOperationNotice>;

function isBlankStr(val: string): boolean {
    return val == null || val.trim() === "";
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

function getDefaultSyncAction(repo: VcsRepositoryInfo): VcsSyncAction {
    return repo.repotype === "svn" ? "update" : "pull";
}

function getSyncCompletionLabel(action: VcsSyncAction): string {
    switch (action) {
        case "fetch": return "Fetch completed.";
        case "push": return "Push completed.";
        case "update": return "Update completed.";
        case "pull":
        default: return "Pull completed.";
    }
}

function getSyncFailureLabel(action: VcsSyncAction): string {
    switch (action) {
        case "fetch": return "Fetch failed.";
        case "push": return "Push failed.";
        case "update": return "Update failed.";
        case "pull":
        default: return "Pull failed.";
    }
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
            if (isBlankStr(path ?? "")) return "~";
            return path;
        });
        this.selectedFileAtom = atom((get) => {
            return get(this.blockAtom)?.meta?.["vcs:selectedfile"] ?? "";
        });
        this.connection = atom((get) => {
            const connValue = get(this.blockAtom)?.meta?.connection;
            if (isBlankStr(connValue ?? "")) return "local";
            return connValue;
        });
        this.connStatus = atom((get) => {
            const connAtom = this.env.getConnStatusAtom(get(this.connection));
            return get(connAtom);
        });
        this.viewText = atom((get) => {
            const basePath = get(this.pathAtom);
            const displayPath = isBlankStr(basePath) ? "" : basename(basePath);
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
    const [activeRepoId, setActiveRepoId] = React.useState<string>("");
    const [selectedFilesByRepo, setSelectedFilesByRepo] = React.useState<RepoFilesMap>({});
    const [commitMessageByRepo, setCommitMessageByRepo] = React.useState<RepoStringMap>({});
    const [commitRunningByRepo, setCommitRunningByRepo] = React.useState<RepoBoolMap>({});
    const [syncRunningByRepo, setSyncRunningByRepo] = React.useState<RepoBoolMap>({});
    const [operationNoticeByRepo, setOperationNoticeByRepo] = React.useState<RepoNoticeMap>({});
    const [sectionStateByRepo, setSectionStateByRepo] = React.useState<RepoSectionsMap>({});
    const [fileFilterByRepo, setFileFilterByRepo] = React.useState<RepoFileFiltersMap>({});
    const [currentView, setCurrentView] = React.useState<View>("changes");

    const clearOperationNotice = React.useCallback((repoId: string) => {
        setOperationNoticeByRepo((prev) => {
            if (prev[repoId] == null) return prev;
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
        if (isBlankStr(connection ?? "")) return null;
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
                setCommitMessageByRepo((prev) => {
                    const next = { ...prev };
                    for (const repo of repoList) {
                        if (isBlankStr(next[repo.repoid] ?? "")) {
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

    const refreshRepo = async (repoId?: string) => {
        if (!isBlankStr(repoId ?? "")) {
            clearOperationNotice(repoId);
        }
        await loadRepositories();
    };

    const handleCommit = async (repo: VcsRepositoryInfo) => {
        const selectedFiles = selectedFilesByRepo[repo.repoid] ?? [];
        const commitMessage = (commitMessageByRepo[repo.repoid] ?? "").trim();
        if (selectedFiles.length === 0) {
            setOperationNotice(repo.repoid, "Please select at least one file.", true);
            return;
        }
        if (isBlankStr(commitMessage)) {
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
        if (!repo || isBlankStr(filePath)) return;
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
        if (!repo || isBlankStr(filePath)) return;
        const trimmedRevision = revision?.trim() ?? "";
        const title = isBlankStr(trimmedRevision) ? `${filePath} (working tree)` : `${filePath} @ ${trimmedRevision.slice(0, 10)}`;
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
        const openUrl = !isBlankStr(repoBrowseUrl) ? repoBrowseUrl : repoRemoteUrl;
        const copyUrl = !isBlankStr(repoRemoteUrl) ? repoRemoteUrl : repoBrowseUrl;
        const menu: ContextMenuItem[] = [
            {
                label: "Copy Repository Path",
                enabled: !isBlankStr(repoPath),
                click: () => {
                    fireAndForget(async () => {
                        await navigator.clipboard.writeText(repoPath);
                    });
                },
            },
            {
                label: "Copy Repository URL",
                enabled: !isBlankStr(copyUrl),
                click: () => {
                    fireAndForget(async () => {
                        await navigator.clipboard.writeText(copyUrl);
                    });
                },
            },
            {
                label: "Open Remote Repository",
                enabled: !isBlankStr(openUrl),
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

    const activeRepo = repos.find((r) => r.repoid === activeRepoId) ?? repos[0];
    const busySync = activeRepo ? !!syncRunningByRepo[activeRepo.repoid] : false;
    const busyCommit = activeRepo ? !!commitRunningByRepo[activeRepo.repoid] : false;

    return (
        <div className="h-full w-full overflow-hidden flex flex-col">
            {loading && <div className="p-2 text-sm text-muted">Loading repositories...</div>}
            {!loading && error && <div className="p-2 text-sm text-error whitespace-pre-wrap">{error}</div>}
            {!loading && !error && repos.length === 0 && (
                <div className="p-2 text-sm text-muted">No Git/SVN repository found in this path.</div>
            )}
            {!loading && !error && repos.length > 0 && activeRepo && (
                <>
                    {/* Repo Header with sync controls */}
                    <VcsRepoHeader
                        repo={activeRepo}
                        onSync={() => handleSync(activeRepo)}
                        onRefresh={() => refreshRepo(activeRepo.repoid)}
                        syncRunning={busySync}
                    />

                    {/* Tab bar */}
                    <VcsTabBar
                        repo={activeRepo}
                        currentView={currentView}
                        onViewChange={setCurrentView}
                        busy={busySync}
                    />

                    {/* Tab content */}
                    <div className="flex-1 min-h-0 overflow-hidden">
                        {currentView === "changes" && (
                            <VcsChangesTab
                                repo={activeRepo}
                                selectedFiles={selectedFilesByRepo[activeRepo.repoid] ?? []}
                                setSelectedFiles={(next) => setSelectedFilesByRepo((prev) => ({ ...prev, [activeRepo.repoid]: next }))}
                                commitMessage={commitMessageByRepo[activeRepo.repoid] ?? DefaultCommitMessage}
                                setCommitMessage={(next) => setCommitMessageByRepo((prev) => ({ ...prev, [activeRepo.repoid]: next }))}
                                onCommit={() => handleCommit(activeRepo)}
                                commitRunning={busyCommit}
                                operationNotice={operationNoticeByRepo[activeRepo.repoid]}
                                onDismissNotice={() => clearOperationNotice(activeRepo.repoid)}
                                onFileHistory={(filePath) => openHistoryBlock(activeRepo, filePath)}
                                onShowFileDiff={(filePath) => openDiffBlock(activeRepo, filePath)}
                                sectionState={sectionStateByRepo[activeRepo.repoid] ?? makeDefaultSectionState()}
                                setSectionOpen={(section, open) =>
                                    setSectionStateByRepo((prev) => ({
                                        ...prev,
                                        [activeRepo.repoid]: {
                                            ...(prev[activeRepo.repoid] ?? makeDefaultSectionState()),
                                            [section]: open,
                                        },
                                    }))
                                }
                                fileFilterState={fileFilterByRepo[activeRepo.repoid] ?? makeDefaultFileFilterState()}
                                setFileFilterState={(next) =>
                                    setFileFilterByRepo((prev) => ({ ...prev, [activeRepo.repoid]: next }))
                                }
                                onSyncAction={(action) => handleSync(activeRepo, action)}
                                syncRunning={busySync}
                            />
                        )}
                        {currentView === "branches" && (
                            <VcsBranchesTab repo={activeRepo} connection={connection} />
                        )}
                        {currentView === "pipelines" && (
                            <VcsPipelinesTab repo={activeRepo} connection={connection} />
                        )}
                    </div>
                </>
            )}
        </div>
    );
}
