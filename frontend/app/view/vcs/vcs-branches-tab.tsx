// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { TabRpcClient } from "@/app/store/wshrpcutil";
import type { WaveEnv } from "@/app/waveenv/waveenv";
import { useWaveEnv } from "@/app/waveenv/waveenv";
import { cn, isBlank, makeConnRoute } from "@/util/util";
import React from "react";

type VcsUiEnv = WaveEnv;

const RpcTimeoutMs = 30000;

function shortHash(hash: string): string {
    if (isBlank(hash)) return "";
    return hash.length <= 10 ? hash : hash.slice(0, 10);
}

function cleanBranchName(raw: string): string {
    const trimmed = raw.trim();
    if (trimmed.startsWith("refs/heads/")) return trimmed.slice("refs/heads/".length);
    return trimmed;
}

export function VcsBranchesTab({
    repo,
    connection,
    onBranchChanged,
}: {
    repo: VcsRepositoryInfo;
    connection: string;
    onBranchChanged?: () => void;
}) {
    const env = useWaveEnv<VcsUiEnv>();

    const route = React.useMemo(() => {
        if (isBlank(connection)) return null;
        return makeConnRoute(connection);
    }, [connection]);

    const [branches, setBranches] = React.useState<RemoteVcsBranchListRtnData | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);

    // Branch name for new branch creation
    const [newBranchName, setNewBranchName] = React.useState("");
    const [createRunning, setCreateRunning] = React.useState(false);
    const [createError, setCreateError] = React.useState<string | null>(null);
    const [createSuccess, setCreateSuccess] = React.useState<string | null>(null);

    // Branch switching
    const [switchingBranch, setSwitchingBranch] = React.useState<string | null>(null);
    const [switchError, setSwitchError] = React.useState<string | null>(null);

    // Branch deletion
    const [deletingBranch, setDeletingBranch] = React.useState<string | null>(null);
    const [deleteConfirmBranch, setDeleteConfirmBranch] = React.useState<string | null>(null);
    const [deleteError, setDeleteError] = React.useState<string | null>(null);

    // Filter
    const [filterInput, setFilterInput] = React.useState("");

    const loadBranches = React.useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const response = await env.rpc.RemoteVcsBranchListCommand(
                TabRpcClient,
                { repotype: repo.repotype, repopath: repo.rootpath },
                { route, timeout: RpcTimeoutMs }
            );
            setBranches(response);
        } catch (e) {
            setError(String(e));
        } finally {
            setLoading(false);
        }
    }, [env.rpc, repo.repotype, repo.rootpath, route]);

    React.useEffect(() => {
        loadBranches();
    }, [loadBranches]);

    const handleSwitchBranch = React.useCallback(async (branchName: string) => {
        setSwitchingBranch(branchName);
        setSwitchError(null);
        setCreateError(null);
        setCreateSuccess(null);
        setDeleteError(null);
        try {
            const response = await env.rpc.RemoteVcsSwitchBranchCommand(
                TabRpcClient,
                { repotype: repo.repotype, repopath: repo.rootpath, branch: branchName },
                { route, timeout: RpcTimeoutMs }
            );
            if (response.error) {
                setSwitchError(response.error);
                return;
            }
            await loadBranches();
            onBranchChanged?.();
        } catch (e) {
            setSwitchError(String(e));
        } finally {
            setSwitchingBranch(null);
        }
    }, [env.rpc, loadBranches, onBranchChanged, repo.repotype, repo.rootpath, route]);

    const handleCheckoutRemote = React.useCallback(async (remoteBranchName: string) => {
        setSwitchingBranch(remoteBranchName);
        setSwitchError(null);
        try {
            const response = await env.rpc.RemoteVcsSwitchBranchCommand(
                TabRpcClient,
                { repotype: repo.repotype, repopath: repo.rootpath, branch: remoteBranchName },
                { route, timeout: RpcTimeoutMs }
            );
            if (response.error) {
                setSwitchError(response.error);
                return;
            }
            await loadBranches();
            onBranchChanged?.();
        } catch (e) {
            setSwitchError(String(e));
        } finally {
            setSwitchingBranch(null);
        }
    }, [env.rpc, loadBranches, onBranchChanged, repo.repotype, repo.rootpath, route]);

    const handleCreateBranch = React.useCallback(async () => {
        const branchName = cleanBranchName(newBranchName);
        if (!branchName.trim()) return;
        setCreateRunning(true);
        setCreateError(null);
        setCreateSuccess(null);
        setSwitchError(null);
        setDeleteError(null);
        try {
            const response = await env.rpc.RemoteVcsCreateBranchCommand(
                TabRpcClient,
                { repotype: repo.repotype, repopath: repo.rootpath, branch: branchName.trim() },
                { route, timeout: RpcTimeoutMs }
            );
            if (response.error) {
                setCreateError(response.error);
                return;
            }
            setCreateSuccess(`Created and switched to ${response.branch}`);
            setNewBranchName("");
            await loadBranches();
            onBranchChanged?.();
        } catch (e) {
            setCreateError(String(e));
        } finally {
            setCreateRunning(false);
        }
    }, [env.rpc, loadBranches, newBranchName, onBranchChanged, repo.repotype, repo.rootpath, route]);

    const handleDeleteBranch = React.useCallback(async (branchName: string) => {
        setDeletingBranch(branchName);
        setDeleteError(null);
        setSwitchError(null);
        setCreateError(null);
        try {
            const response = await env.rpc.RemoteVcsDeleteBranchCommand(
                TabRpcClient,
                { repotype: repo.repotype, repopath: repo.rootpath, branch: branchName },
                { route, timeout: RpcTimeoutMs }
            );
            if (response.error) {
                setDeleteError(response.error);
                return;
            }
            setDeleteConfirmBranch(null);
            await loadBranches();
        } catch (e) {
            setDeleteError(String(e));
        } finally {
            setDeletingBranch(null);
        }
    }, [env.rpc, loadBranches, repo.repotype, repo.rootpath, route]);

    const filterLower = filterInput.trim().toLowerCase();

    if (loading) {
        return (
            <div className="flex-1 flex items-center justify-center text-xs text-muted p-4">
                Loading branches...
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

    if (!branches || branches.error) {
        return (
            <div className="flex-1 flex items-center justify-center text-xs text-muted p-4 text-center">
                <div className="max-w-[240px]">
                    <div className="text-secondary font-medium mb-1">No branch data</div>
                    <div>{branches?.error || "Branch listing is only available for git repositories."}</div>
                </div>
            </div>
        );
    }

    const localBranches = (branches.local ?? []).filter((b) =>
        filterLower === "" || b.name.toLowerCase().includes(filterLower)
    );
    const remoteBranches = (branches.remote ?? []).filter((b) =>
        filterLower === "" || b.name.toLowerCase().includes(filterLower)
    );

    return (
        <div className="flex-1 overflow-auto p-2">
            {/* Toolbar */}
            <div className="mb-2 flex flex-col gap-2 rounded-md bg-panel/60 px-2 py-1.5">
                <div className="flex items-center gap-2">
                    <div className="group relative min-w-[140px] flex-1">
                        <i className="fa-sharp fa-solid fa-magnifying-glass pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[11px] text-muted transition-colors group-focus-within:text-accent" />
                        <input
                            className="h-7 w-full rounded-md border border-border bg-surface text-xs text-foreground pl-7 pr-2 outline-none placeholder:text-muted transition-colors focus:border-accent focus:ring-2 focus:ring-accent/20"
                            type="text"
                            value={filterInput}
                            onChange={(e) => setFilterInput(e.target.value)}
                            placeholder="Filter branches"
                        />
                        {filterInput !== "" && (
                            <button
                                className="iconbutton !absolute !right-1 !top-1/2 !h-[18px] !w-[18px] -translate-y-1/2 cursor-pointer"
                                title="Clear filter"
                                onClick={() => setFilterInput("")}
                            >
                                <i className="fa-sharp fa-solid fa-xmark text-[10px]" />
                            </button>
                        )}
                    </div>
                    <button
                        className="h-7 shrink-0 rounded-md border border-border px-2.5 text-xs text-secondary hover:bg-hoverbg cursor-pointer"
                        title="Refresh branch list"
                        onClick={() => loadBranches()}
                    >
                        <i className="fa-sharp fa-solid fa-arrows-rotate text-[11px]" />
                    </button>
                </div>
                <div className="flex items-center gap-2">
                    <input
                        className="h-7 min-w-0 flex-1 rounded-md border border-border bg-surface text-xs text-foreground outline-none px-2 placeholder:text-muted transition-colors focus:border-accent focus:ring-2 focus:ring-accent/20"
                        type="text"
                        value={newBranchName}
                        onChange={(e) => setNewBranchName(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && newBranchName.trim()) handleCreateBranch();
                        }}
                        placeholder="New branch name..."
                        disabled={createRunning}
                    />
                    <button
                        className="h-7 shrink-0 rounded-md bg-action px-3 text-xs text-actiontext font-medium hover:bg-actionhover transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-default"
                        disabled={!newBranchName.trim() || createRunning}
                        onClick={handleCreateBranch}
                    >
                        {createRunning ? "Creating..." : "Create & Switch"}
                    </button>
                </div>
                {/* Inline feedback */}
                {createError && <div className="text-[11px] text-warning">{createError}</div>}
                {createSuccess && <div className="text-[11px] text-ok">{createSuccess}</div>}
                {switchError && <div className="text-[11px] text-warning">{switchError}</div>}
                {deleteError && <div className="text-[11px] text-warning">{deleteError}</div>}
            </div>

            {/* Current branch */}
            {branches.current && (
                <div className="mb-2 flex items-center gap-2 rounded border border-accent/25 bg-accent/8 px-2 py-1.5">
                    <span className="text-[11px] text-muted">Current</span>
                    <span className="text-xs font-semibold text-accent">
                        <i className="fa-sharp fa-solid fa-code-branch text-[10px] mr-1" />
                        {branches.current}
                    </span>
                </div>
            )}

            {/* Local branches */}
            <div className="mt-2 mb-1 px-1 text-[11px] font-medium text-muted uppercase tracking-wider">
                Local ({localBranches.length})
            </div>
            <div className="space-y-0.5">
                {localBranches.length === 0 && (
                    <div className="px-2 py-1.5 text-[11px] text-muted">No local branches found.</div>
                )}
                {localBranches.map((branch) => {
                    const isCurrent = branch.iscurrent;
                    const isSwitching = switchingBranch === branch.name;
                    const isDeleting = deletingBranch === branch.name;
                    const deletePending = deleteConfirmBranch === branch.name;
                    const canDelete = !isCurrent && !isSwitching && !isDeleting;
                    return (
                        <div
                            key={branch.name}
                            className={cn(
                                "group flex items-center gap-2 rounded px-2 py-1.5 text-xs transition-colors",
                                isCurrent
                                    ? "border border-accent/25 bg-accent/8"
                                    : "hover:bg-hoverbg cursor-pointer"
                            )}
                            onClick={() => !isCurrent && !isSwitching && handleSwitchBranch(branch.name)}
                        >
                            <span
                                className={cn(
                                    "h-2 w-2 shrink-0 rounded-full",
                                    isCurrent ? "bg-accent" : "bg-transparent border border-border"
                                )}
                            />
                            <span className={cn("min-w-0 flex-1 truncate font-medium", isCurrent && "text-accent")}>
                                {branch.name}
                            </span>
                            <span className="text-[11px] text-muted font-mono shrink-0">
                                {shortHash(branch.hash ?? "")}
                            </span>
                            {branch.ahead > 0 && (
                                <span className="text-[11px] text-ok shrink-0" title={`Ahead by ${branch.ahead}`}>
                                    {"\u2191"}{branch.ahead}
                                </span>
                            )}
                            {branch.behind > 0 && (
                                <span className="text-[11px] text-danger shrink-0" title={`Behind by ${branch.behind}`}>
                                    {"\u2193"}{branch.behind}
                                </span>
                            )}
                            {isSwitching && (
                                <span className="text-[11px] text-accent shrink-0">Switching...</span>
                            )}
                            {!isCurrent && !isSwitching && (
                                <>
                                    {deletePending ? (
                                        <div className="flex items-center gap-1 shrink-0">
                                            <span className="text-[11px] text-warning mr-0.5">Delete?</span>
                                            <button
                                                className="text-[10px] text-danger hover:underline cursor-pointer"
                                                disabled={isDeleting}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleDeleteBranch(branch.name);
                                                }}
                                            >
                                                Yes
                                            </button>
                                            <button
                                                className="text-[10px] text-muted hover:underline cursor-pointer"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setDeleteConfirmBranch(null);
                                                }}
                                            >
                                                No
                                            </button>
                                        </div>
                                    ) : (
                                        canDelete && (
                                            <button
                                                className="text-[10px] text-muted hover:text-danger cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                                                title={`Delete branch ${branch.name}`}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setDeleteConfirmBranch(branch.name);
                                                }}
                                            >
                                                <i className="fa-sharp fa-solid fa-trash-can text-[9px]" />
                                            </button>
                                        )
                                    )}
                                </>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Remote branches */}
            {remoteBranches.length > 0 && (
                <>
                    <div className="mt-3 mb-1 px-1 text-[11px] font-medium text-muted uppercase tracking-wider">
                        Remote ({remoteBranches.length})
                    </div>
                    <div className="space-y-0.5">
                        {remoteBranches.map((branch) => {
                            const isSwitching = switchingBranch === branch.name;
                            return (
                                <div
                                    key={branch.name}
                                    className="group flex items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-hoverbg cursor-pointer transition-colors"
                                    onClick={() => !isSwitching && handleCheckoutRemote(branch.name)}
                                    title={`Checkout tracking branch ${branch.name}`}
                                >
                                    <span className="h-2 w-2 shrink-0 rounded-full bg-transparent border border-muted" />
                                    <span className="min-w-0 flex-1 truncate text-secondary">{branch.name}</span>
                                    <span className="text-[11px] text-muted font-mono shrink-0">
                                        {shortHash(branch.hash ?? "")}
                                    </span>
                                    {isSwitching ? (
                                        <span className="text-[11px] text-accent shrink-0">Checking out...</span>
                                    ) : (
                                        <span className="text-[10px] text-muted shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                            Checkout
                                        </span>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </>
            )}

            {/* Total count */}
            <div className="mt-3 px-1 text-[10px] text-muted">
                {branches.local?.length ?? 0} local, {branches.remote?.length ?? 0} remote
            </div>
        </div>
    );
}
