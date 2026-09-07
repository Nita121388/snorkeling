// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Git/project status bar shown above the chat composer. Shows the project folder
// name (with full path on hover), the current branch (click to view & switch
// branches), and added/removed line counts + file count. Refreshes while the
// agent is running and right after a branch switch.

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { cn, makeConnRoute } from "@/util/util";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

type GitStat = {
    branch: string;
    added: number;
    removed: number;
    files: number;
};

type GitStatusBarProps = {
    projectPath?: string;
    connection?: string;
    canChangeDirectory?: boolean;
    onChangeDirectory?: () => Promise<void>;
    isRunning?: boolean;
    className?: string;
};

const REFRESH_INTERVAL_MS = 5000;

const projectNameOf = (projectPath?: string) => projectPath?.split(/[\\/]/).filter(Boolean).at(-1) || null;

export const GitStatusBar = memo(
    ({
        projectPath,
        connection,
        canChangeDirectory = false,
        onChangeDirectory,
        isRunning,
        className,
    }: GitStatusBarProps) => {
        // makeConnRoute("") == "conn:local"; the VCS panel uses the same value so local
        // repos reach the wshremote server that implements the VCS commands.
        const route = useMemo(() => makeConnRoute(connection ?? ""), [connection]);
        const [stat, setStat] = useState<GitStat | null>(null);
        const [branches, setBranches] = useState<RemoteVcsBranchListRtnData | null>(null);
        const [branchMenuOpen, setBranchMenuOpen] = useState(false);
        const [branchQuery, setBranchQuery] = useState("");
        const [switching, setSwitching] = useState<string | null>(null);
        const [switchError, setSwitchError] = useState<string | null>(null);
        const projectName = useMemo(() => projectNameOf(projectPath), [projectPath]);
        const menuRef = useRef<HTMLDivElement>(null);

        const fetchStat = useCallback(async () => {
            if (!projectPath) {
                setStat(null);
                return;
            }
            try {
                const result = await RpcApi.RemoteVcsStatCommand(
                    TabRpcClient,
                    { path: projectPath },
                    { route, timeout: 30000 }
                );
                if (result.error) {
                    setStat(null);
                    setSwitchError(`读取 Git 状态失败：${result.error}`);
                    return;
                }
                setStat({
                    branch: result.branch ?? "",
                    added: result.added,
                    removed: result.removed,
                    files: result.files,
                });
                setSwitchError(null);
            } catch (error) {
                setStat(null);
                setSwitchError(`读取 Git 状态失败：${String(error)}`);
            }
        }, [projectPath, route]);

        const fetchBranches = useCallback(async () => {
            if (!projectPath) {
                setBranches(null);
                return;
            }
            try {
                const result = await RpcApi.RemoteVcsBranchListCommand(
                    TabRpcClient,
                    {
                        repotype: "git",
                        repopath: projectPath,
                    },
                    { route, timeout: 30000 }
                );
                setBranches(result.error ? null : result);
            } catch {
                setBranches(null);
            }
        }, [TabRpcClient, projectPath, route]);

        const refreshAll = useCallback(async () => {
            await fetchStat();
            await fetchBranches();
        }, [fetchStat, fetchBranches]);

        // Initial fetch. The tab RPC can still be initializing when the composer mounts,
        // so retry once shortly afterward instead of permanently rendering an empty bar.
        useEffect(() => {
            void fetchStat();
            void fetchBranches();
            const retry = window.setTimeout(() => {
                void fetchStat();
                void fetchBranches();
            }, 800);
            return () => window.clearTimeout(retry);
        }, [fetchStat, fetchBranches]);

        // Periodic refresh while agent is running
        useEffect(() => {
            if (!isRunning) return;
            const timer = setInterval(() => {
                void fetchStat();
            }, REFRESH_INTERVAL_MS);
            return () => clearInterval(timer);
        }, [isRunning, fetchStat]);

        // Close the branch menu on outside click / Escape
        useEffect(() => {
            if (!branchMenuOpen) return;
            const onMouseDown = (event: MouseEvent) => {
                if (!menuRef.current?.contains(event.target as Node)) setBranchMenuOpen(false);
            };
            const onKeyDown = (event: KeyboardEvent) => {
                if (event.key === "Escape") {
                    setBranchMenuOpen(false);
                    setBranchQuery("");
                }
            };
            document.addEventListener("mousedown", onMouseDown);
            document.addEventListener("keydown", onKeyDown);
            return () => {
                document.removeEventListener("mousedown", onMouseDown);
                document.removeEventListener("keydown", onKeyDown);
            };
        }, [branchMenuOpen]);

        const switchTo = useCallback(
            async (branch: string) => {
                if (!projectPath || switching) return;
                setSwitching(branch);
                setSwitchError(null);
                try {
                    const result = await RpcApi.RemoteVcsSwitchBranchCommand(
                        TabRpcClient,
                        {
                            repotype: "git",
                            repopath: projectPath,
                            branch,
                        },
                        { route, timeout: 30000 }
                    );
                    if (result.error) {
                        setSwitchError(result.error);
                        return;
                    }
                    setBranchMenuOpen(false);
                    setBranchQuery("");
                    await refreshAll();
                } catch (error) {
                    setSwitchError(String(error));
                } finally {
                    setSwitching(null);
                }
            },
            [TabRpcClient, projectPath, route, switching, refreshAll]
        );

        const needle = branchQuery.trim().toLowerCase();
        const localBranches = (branches?.local ?? []).filter(
            (branch) => !needle || branch.name.toLowerCase().includes(needle)
        );
        const remoteBranches = (branches?.remote ?? []).filter(
            (branch) => !needle || branch.name.toLowerCase().includes(needle)
        );

        return (
            <div
                className={cn(
                    "relative flex min-h-7 items-center gap-2 border-b border-border bg-panel/40 px-3 py-1 text-xs",
                    className
                )}
            >
                <button
                    type="button"
                    disabled={!canChangeDirectory || !onChangeDirectory}
                    className={cn(
                        "flex min-w-0 items-center gap-1 rounded px-1 text-secondary",
                        canChangeDirectory && "cursor-pointer hover:bg-hover hover:text-primary"
                    )}
                    title={canChangeDirectory ? "切换项目目录（发送消息后不可切换）" : projectPath}
                    onClick={() => void onChangeDirectory?.()}
                >
                    <i className="fa-sharp fa-solid fa-folder text-[10px]" />
                    <span className="max-w-32 truncate font-mono">{projectName ?? "选择目录"}</span>
                    {canChangeDirectory && <i className="fa-sharp fa-solid fa-chevron-down text-[9px]" />}
                </button>
                {stat?.branch && (
                    <>
                        <span className="text-border">·</span>
                        <button
                            type="button"
                            className="flex max-w-52 items-center gap-1 rounded px-1.5 py-0.5 text-secondary hover:bg-hover hover:text-primary"
                            title="查看和切换分支"
                            onClick={() => setBranchMenuOpen((open) => !open)}
                        >
                            <i className="fa-sharp fa-solid fa-code-branch text-[10px]" />
                            <span className="truncate font-mono">{stat.branch}</span>
                            <i className="fa-sharp fa-solid fa-chevron-down text-[9px]" />
                        </button>
                    </>
                )}
                {stat && (
                    <>
                        <span className="text-border">·</span>
                        <span
                            className="flex items-center gap-1.5 font-mono text-[11px]"
                            title="当前工作区相对 HEAD 的改动"
                        >
                            {stat.files > 0 ? (
                                <>
                                    {stat.added > 0 && (
                                        <span className="text-[var(--success-color,#22c55e)]">+{stat.added}</span>
                                    )}
                                    {stat.removed > 0 && (
                                        <span className="text-[var(--error-color,#ef4444)]">−{stat.removed}</span>
                                    )}
                                    <span className="text-secondary">· {stat.files} files</span>
                                </>
                            ) : (
                                <span className="text-secondary">clean</span>
                            )}
                        </span>
                    </>
                )}
                {projectPath && !stat && (
                    <span className="truncate text-secondary" title={switchError ?? undefined}>
                        {switchError ?? "Git 状态不可用"}
                    </span>
                )}
                {branchMenuOpen && (
                    <div
                        ref={menuRef}
                        className="absolute bottom-full left-3 z-30 mb-1 max-h-80 w-72 overflow-auto rounded-lg border border-border bg-modalbg p-1.5 shadow-2xl"
                    >
                        <input
                            autoFocus
                            value={branchQuery}
                            onChange={(event) => setBranchQuery(event.target.value)}
                            placeholder="搜索分支"
                            className="mb-1 h-7 w-full rounded border border-border bg-transparent px-2 text-xs outline-none focus:border-secondary/50"
                        />
                        {switchError && (
                            <div className="mb-1 rounded border border-error/40 bg-error/10 px-2 py-1.5 text-[11px] whitespace-pre-wrap text-error">
                                {switchError}
                            </div>
                        )}
                        {localBranches.map((branch) => (
                            <button
                                key={branch.name}
                                type="button"
                                disabled={switching !== null || branch.iscurrent}
                                onClick={() => void switchTo(branch.name)}
                                className={cn(
                                    "flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-hover disabled:cursor-default",
                                    branch.iscurrent ? "bg-hover text-accent" : "text-secondary"
                                )}
                            >
                                <i className="fa-sharp fa-solid fa-code-branch text-[10px]" />
                                <span className="min-w-0 flex-1 truncate font-mono">{branch.name}</span>
                                {branch.iscurrent && <i className="fa-sharp fa-solid fa-check text-[10px]" />}
                                {switching === branch.name && (
                                    <i className="fa-sharp fa-solid fa-spinner animate-spin text-[10px]" />
                                )}
                            </button>
                        ))}
                        {remoteBranches.length > 0 && (
                            <div className="px-2 pb-1 pt-2 text-[10px] text-secondary">远程分支</div>
                        )}
                        {remoteBranches.map((branch) => (
                            <button
                                key={branch.name}
                                type="button"
                                disabled={switching !== null || branch.name.startsWith(`${stat?.branch}/`)}
                                onClick={() => void switchTo(branch.name)}
                                className="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-secondary hover:bg-hover disabled:cursor-default"
                            >
                                <i className="fa-sharp fa-solid fa-code-branch text-[10px]" />
                                <span className="min-w-0 flex-1 truncate font-mono">{branch.name}</span>
                                {switching === branch.name && (
                                    <i className="fa-sharp fa-solid fa-spinner animate-spin text-[10px]" />
                                )}
                            </button>
                        ))}
                        {localBranches.length === 0 && remoteBranches.length === 0 && (
                            <div className="px-2 py-3 text-center text-xs text-secondary">没有匹配的分支</div>
                        )}
                    </div>
                )}
            </div>
        );
    }
);

GitStatusBar.displayName = "GitStatusBar";
