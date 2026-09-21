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
import { VcsRepoSwitcher } from "./vcs-repo-switcher";
import { VcsHistoryTab } from "./vcs-history-tab";

const DefaultCommitMessage = "chore: update selected files";
const VcsRepositoryRpcTimeoutMs = 60000;
const VcsMutationRpcTimeoutMs = 150000;

type VcsUiEnv = WaveEnv;

type RepoStringMap = Record<string, string>;
type RepoFilesMap = Record<string, string[]>;
type RepoSectionKey = "changes" | "untracked" | "remote";
type RepoSectionState = Record<RepoSectionKey, boolean>;
type RepoSectionsMap = Record<string, RepoSectionState>;
type VcsSyncAction = "fetch" | "pull" | "push" | "update";
type VcsOperationAction = VcsSyncAction | "commit";
type VcsOperationState = "running" | "success" | "error";
type VcsOperationInfo = {
    id: number;
    action: VcsOperationAction;
    state: VcsOperationState;
    source?: "header" | "changes" | "commit";
    message?: string;
    details?: string;
};
type RepoOperationMap = Record<string, VcsOperationInfo>;
// RepoFileFilterState is imported from vcs-changes-tab.tsx
type RepoFileFiltersMap = Record<string, RepoFileFilterState>;

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

// Present tense verb shown while an operation is running.
const VcsOperationVerb: Record<VcsOperationAction, string> = {
    pull: "Pulling…",
    push: "Pushing…",
    fetch: "Fetching…",
    update: "Updating…",
    commit: "Committing…",
};

// Short noun label used in success/failure summaries.
const VcsOperationLabel: Record<VcsOperationAction, string> = {
    pull: "Pull",
    push: "Push",
    fetch: "Fetch",
    update: "Update",
    commit: "Commit",
};

function firstMeaningfulLine(text: string): string {
    const firstLine = text.split(/\r?\n/).find((line) => !isBlank(line)) ?? text;
    return firstLine.length > 240 ? `${firstLine.slice(0, 237)}...` : firstLine;
}

function OperationDetails({ details }: { details: string }) {
    return (
        <details className="mt-1">
            <summary className="cursor-pointer text-[11px] text-muted">Details</summary>
            <pre className="mt-1 max-h-[180px] overflow-auto whitespace-pre-wrap rounded bg-black/20 p-2 text-[11px]">
                {details}
            </pre>
        </details>
    );
}

/**
 * Shared operation progress card rendered in VcsView below the tab bar.
 * Because it lives in the shared area, it is visible on all four tabs
 * (Changes / Branches / Pipelines / History) regardless of which is active.
 */
function VcsProgressCard({
    operation,
    onDismiss,
}: {
    operation?: VcsOperationInfo;
    onDismiss: () => void;
}) {
    // Keep the latest dismiss callback without resetting the auto-dismiss timer.
    const dismissRef = React.useRef(onDismiss);
    React.useEffect(() => {
        dismissRef.current = onDismiss;
    });

    // Success cards auto-dismiss after 8s; running/error cards persist.
    React.useEffect(() => {
        if (operation?.state !== "success") return;
        const timer = window.setTimeout(() => dismissRef.current(), 8000);
        return () => window.clearTimeout(timer);
    }, [operation?.id, operation?.state]);

    if (!operation) return null;

    const action = operation.action;
    const details = operation.details?.trim() ?? "";
    const message = operation.message?.trim() ?? "";
    const summary = isBlank(message) ? "" : firstMeaningfulLine(message);
    const hasDetails = details !== "" && details !== summary;
    const dismissBtn = (
        <button
            className="iconbutton !h-[18px] !w-[18px] shrink-0 cursor-pointer"
            title="Dismiss"
            onClick={onDismiss}
        >
            <i className="fa-sharp fa-solid fa-xmark text-[10px]" />
        </button>
    );

    let body: React.ReactNode;
    let boxClass = "";
    if (operation.state === "running") {
        boxClass = "mb-2 rounded border border-border/70 bg-panel/60 px-2 py-1.5 text-xs text-secondary";
        body = (
            <div className="flex items-center gap-2">
                <i className="fa-sharp fa-solid fa-spinner animate-spin text-[11px] text-accent shrink-0" />
                <span className="min-w-0 flex-1 truncate">{VcsOperationVerb[action]}</span>
                {dismissBtn}
            </div>
        );
    } else if (operation.state === "success") {
        boxClass = "mb-2 rounded border border-white/10 bg-black/25 px-2 py-1.5 text-xs text-secondary";
        body = (
            <div className="flex items-start gap-2">
                <i className="fa-sharp fa-solid fa-circle-check text-[11px] text-emerald-400 shrink-0 mt-[1px]" />
                <div className="min-w-0 flex-1">
                    <div className="whitespace-pre-wrap">{summary || `${VcsOperationLabel[action]} completed.`}</div>
                    {hasDetails && <OperationDetails details={details} />}
                </div>
                {dismissBtn}
            </div>
        );
    } else {
        boxClass = "mb-2 rounded border border-warning/40 bg-warning/8 px-2 py-1.5 text-xs text-warning";
        body = (
            <div className="flex items-start gap-2">
                <i className="fa-sharp fa-solid fa-triangle-exclamation text-[11px] shrink-0 mt-[1px]" />
                <div className="min-w-0 flex-1">
                    <div className="whitespace-pre-wrap">{summary || `${VcsOperationLabel[action]} failed.`}</div>
                    {hasDetails && <OperationDetails details={details} />}
                </div>
                {dismissBtn}
            </div>
        );
    }

    return <div className={boxClass}>{body}</div>;
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
    const [operationByRepo, setOperationByRepo] = React.useState<RepoOperationMap>({});
    const [sectionStateByRepo, setSectionStateByRepo] = React.useState<RepoSectionsMap>({});
    const [fileFilterByRepo, setFileFilterByRepo] = React.useState<RepoFileFiltersMap>({});
    const [currentView, setCurrentView] = React.useState<View>("changes");

    const clearOperation = React.useCallback((repoId: string) => {
        setOperationByRepo((prev) => {
            if (prev[repoId] == null) return prev;
            const next = { ...prev };
            delete next[repoId];
            return next;
        });
    }, []);

    const startOperation = React.useCallback(
        (repoId: string, action: VcsOperationAction, source: "header" | "changes" | "commit") => {
            const info: VcsOperationInfo = {
                id: Date.now() + Math.random(),
                action,
                state: "running",
                source,
            };
            setOperationByRepo((prev) => ({ ...prev, [repoId]: info }));
            return info.id;
        },
        []
    );

    const completeOperation = React.useCallback(
        (repoId: string, id: number, state: "success" | "error", message?: string, details?: string) => {
            setOperationByRepo((prev) => {
                const existing = prev[repoId];
                if (existing == null || existing.id !== id) return prev;
                const next: VcsOperationInfo = {
                    ...existing,
                    state,
                    message,
                    details,
                };
                return { ...prev, [repoId]: next };
            });
        },
        []
    );

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
            clearOperation(repoId);
        }
        await loadRepositories();
    };

    const handleCommit = async (repo: VcsRepositoryInfo) => {
        const selectedFiles = selectedFilesByRepo[repo.repoid] ?? [];
        const commitMessage = (commitMessageByRepo[repo.repoid] ?? "").trim();
        if (selectedFiles.length === 0) {
            setOperationByRepo((prev) => ({
                ...prev,
                [repo.repoid]: {
                    id: Date.now() + Math.random(),
                    action: "commit",
                    state: "error",
                    message: "Please select at least one file.",
                },
            }));
            return;
        }
        if (isBlankStr(commitMessage)) {
            setOperationByRepo((prev) => ({
                ...prev,
                [repo.repoid]: {
                    id: Date.now() + Math.random(),
                    action: "commit",
                    state: "error",
                    message: "Please enter a commit message.",
                },
            }));
            return;
        }
        const opId = startOperation(repo.repoid, "commit", "commit");
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
                const output = response.output || "Commit completed.";
                completeOperation(repo.repoid, opId, "success", output, output);
                setSelectedFilesByRepo((prev) => ({ ...prev, [repo.repoid]: [] }));
                await loadRepositories();
            } else {
                const resultMsg = response.error || response.output || "Commit failed.";
                completeOperation(repo.repoid, opId, "error", resultMsg, resultMsg);
            }
        } catch (e) {
            completeOperation(repo.repoid, opId, "error", String(e), String(e));
        }
    };

    const handleSync = async (repo: VcsRepositoryInfo, action?: VcsSyncAction) => {
        const syncAction = action ?? getDefaultSyncAction(repo);
        setActiveRepoId(repo.repoid);
        const opId = startOperation(repo.repoid, syncAction, action ? "changes" : "header");
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
                const output = response.output || getSyncCompletionLabel(syncAction);
                completeOperation(repo.repoid, opId, "success", output, output);
                shouldRefresh = true;
            } else {
                const resultMsg = response.error || response.output || getSyncFailureLabel(syncAction);
                completeOperation(repo.repoid, opId, "error", resultMsg, resultMsg);
            }
        } catch (e) {
            completeOperation(repo.repoid, opId, "error", String(e), String(e));
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
    const activeOp = activeRepo ? operationByRepo[activeRepo.repoid] : null;
    const busySync = !!activeOp && activeOp.state === "running" && activeOp.action !== "commit";
    const busyCommit = !!activeOp && activeOp.state === "running" && activeOp.action === "commit";
    const runningSyncAction = busySync && activeOp ? (activeOp.action as VcsSyncAction) : null;

    return (
        <div className="h-full w-full overflow-hidden flex flex-col">
            {loading && <div className="p-2 text-sm text-muted">Loading repositories...</div>}
            {!loading && error && <div className="p-2 text-sm text-error whitespace-pre-wrap">{error}</div>}
            {!loading && !error && repos.length === 0 && (
                <div className="p-2 text-sm text-muted">No Git/SVN repository found in this path.</div>
            )}
            {!loading && !error && repos.length > 0 && activeRepo && (
                <>
                    {/* Multi-repo switcher (hidden for single repo) */}
                    <VcsRepoSwitcher
                        repos={repos}
                        activeRepoId={activeRepo.repoid}
                        onSelect={(repoId) => {
                            setActiveRepoId(repoId);
                            clearOperation(repoId);
                        }}
                    />

                    {/* Repo Header with sync controls */}
                    <VcsRepoHeader
                        repo={activeRepo}
                        onSync={() => handleSync(activeRepo)}
                        onRefresh={() => refreshRepo(activeRepo.repoid)}
                        syncRunning={busySync}
                        syncAction={runningSyncAction}
                    />

                    {/* Tab bar */}
                    <VcsTabBar
                        repo={activeRepo}
                        currentView={currentView}
                        onViewChange={setCurrentView}
                        busy={busySync}
                    />

                    {/* Shared operation progress card, visible across all tabs */}
                    <VcsProgressCard operation={activeOp} onDismiss={() => clearOperation(activeRepo.repoid)} />

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
                                syncAction={runningSyncAction}
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
                        {currentView === "history" && (
                            <VcsHistoryTab repo={activeRepo} connection={connection} />
                        )}
                    </div>
                </>
            )}
        </div>
    );
}
