// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Lightweight git status bar shown above the chat composer. Displays branch name
// and added/removed line counts, updated while the agent is running.

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { cn } from "@/util/util";
import { memo, useCallback, useEffect, useState } from "react";

type GitStat = {
    branch: string;
    added: number;
    removed: number;
    files: number;
};

type GitStatusBarProps = {
    projectPath?: string;
    isRunning?: boolean;
    className?: string;
};

const REFRESH_INTERVAL_MS = 5000;

export const GitStatusBar = memo(({ projectPath, isRunning, className }: GitStatusBarProps) => {
    const [stat, setStat] = useState<GitStat | null>(null);

    const fetchStat = useCallback(async () => {
        if (!projectPath) {
            setStat(null);
            return;
        }
        try {
            const result = await RpcApi.RemoteVcsStatCommand(TabRpcClient, { path: projectPath });
            if (result.error) {
                setStat(null);
                return;
            }
            // Only show if there are changes or a meaningful branch
            if (result.files === 0 && !result.branch) {
                setStat(null);
                return;
            }
            setStat({
                branch: result.branch ?? "",
                added: result.added,
                removed: result.removed,
                files: result.files,
            });
        } catch {
            setStat(null);
        }
    }, [projectPath]);

    // Initial fetch
    useEffect(() => {
        void fetchStat();
    }, [fetchStat]);

    // Periodic refresh while agent is running
    useEffect(() => {
        if (!isRunning) return;
        const timer = setInterval(() => {
            void fetchStat();
        }, REFRESH_INTERVAL_MS);
        return () => clearInterval(timer);
    }, [isRunning, fetchStat]);

    if (!stat || (!stat.branch && stat.files === 0)) {
        return null;
    }

    return (
        <div
            className={cn(
                "flex items-center gap-2 px-3 py-1 text-xs border-b border-border",
                className
            )}
        >
            {stat.branch && (
                <span className="flex items-center gap-1 text-secondary">
                    <i className="fa-sharp fa-solid fa-code-branch text-[10px]" />
                    <span className="font-mono">{stat.branch}</span>
                </span>
            )}
            {stat.files > 0 && (
                <>
                    <span className="text-border">·</span>
                    <span className="flex items-center gap-1.5 font-mono text-[11px]">
                        {stat.added > 0 && (
                            <span className="text-[var(--success-color,#22c55e)]">+{stat.added}</span>
                        )}
                        {stat.removed > 0 && (
                            <span className="text-[var(--error-color,#ef4444)]">−{stat.removed}</span>
                        )}
                        {stat.added === 0 && stat.removed === 0 && (
                            <span className="text-secondary">{stat.files} files</span>
                        )}
                    </span>
                </>
            )}
        </div>
    );
});

GitStatusBar.displayName = "GitStatusBar";
