// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { TabRpcClient } from "@/app/store/wshrpcutil";
import { useWaveEnv } from "@/app/waveenv/waveenv";
import type { WaveEnv } from "@/app/waveenv/waveenv";
import { isBlank, makeConnRoute } from "@/util/util";
import React from "react";

type VcsUiEnv = WaveEnv;

function shortHash(hash: string): string {
    if (isBlank(hash)) return "";
    if (hash.length <= 10) return hash;
    return hash.slice(0, 10);
}

export function VcsBranchesTab({
    repo,
    connection,
}: {
    repo: VcsRepositoryInfo;
    connection: string;
}) {
    const env = useWaveEnv<VcsUiEnv>();
    const [branches, setBranches] = React.useState<RemoteVcsBranchListRtnData | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);
    const [newBranchName, setNewBranchName] = React.useState("");
    const [switching, setSwitching] = React.useState(false);

    const route = React.useMemo(() => {
        if (isBlank(connection)) return null;
        return makeConnRoute(connection);
    }, [connection]);

    const loadBranches = React.useCallback(async () => {
        if (connStatus?.status !== "connected") return;
        setLoading(true);
        setError(null);
        try {
            const response = await env.rpc.RemoteVcsBranchListCommand(
                TabRpcClient,
                { repotype: repo.repotype, repopath: repo.rootpath },
                { route, timeout: 30000 }
            );
            setBranches(response);
        } catch (e) {
            setError(String(e));
        } finally {
            setLoading(false);
        }
    }, [repo, env.rpc, route]);

    const connStatus = React.useMemo(() => {
        return { status: "connected" as const };
    }, []);

    React.useEffect(() => {
        loadBranches();
    }, [loadBranches]);

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
            <div className="flex-1 flex items-center justify-center text-xs text-muted p-4">
                {branches?.error || "No branch information available"}
            </div>
        );
    }

    const localBranches = branches.local ?? [];
    const remoteBranches = branches.remote ?? [];

    return (
        <div className="flex-1 overflow-auto p-2">
            {/* Current branch highlight */}
            {branches.current && (
                <div className="mb-2 flex items-center gap-2 rounded border border-accent/25 bg-accent/8 px-2 py-1.5">
                    <span className="text-[11px] text-muted">当前</span>
                    <span className="text-xs font-semibold text-accent">⑂ {branches.current}</span>
                </div>
            )}

            {/* Local branches */}
            <div className="mb-1 px-1 text-[11px] font-medium text-muted uppercase tracking-wider">
                本地分支 ({localBranches.length})
            </div>
            <div className="space-y-0.5">
                {localBranches.map((branch) => (
                    <div
                        key={branch.name}
                        className={`flex items-center gap-2 rounded px-2 py-1.5 text-xs cursor-pointer transition-colors ${
                            branch.iscurrent
                                ? "border border-accent/25 bg-accent/8"
                                : "hover:bg-hoverbg"
                        }`}
                        onClick={() => {
                            if (!branch.iscurrent && !switching) {
                                setSwitching(true);
                                // TODO: call git switch branch
                                setTimeout(() => setSwitching(false), 500);
                            }
                        }}
                    >
                        <span className={`w-2 h-2 rounded-full shrink-0 ${branch.iscurrent ? "bg-accent" : "invisible"}`} />
                        <span className={`min-w-0 flex-1 truncate font-medium ${branch.iscurrent ? "text-accent" : ""}`}>
                            {branch.name}
                        </span>
                        <span className="text-[11px] text-muted font-mono shrink-0">{shortHash(branch.hash ?? "")}</span>
                        {branch.ahead > 0 && <span className="text-[11px] text-ok shrink-0">↑{branch.ahead}</span>}
                        {branch.behind > 0 && <span className="text-[11px] text-danger shrink-0">↓{branch.behind}</span>}
                    </div>
                ))}
            </div>

            {/* Remote branches */}
            {remoteBranches.length > 0 && (
                <>
                    <div className="mt-3 mb-1 px-1 text-[11px] font-medium text-muted uppercase tracking-wider">
                        远程分支 ({remoteBranches.length})
                    </div>
                    <div className="space-y-0.5">
                        {remoteBranches.map((branch) => (
                            <div key={branch.name} className="flex items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-hoverbg cursor-pointer">
                                <span className="w-2 h-2 rounded-full shrink-0 invisible" />
                                <span className="min-w-0 flex-1 truncate text-secondary">{branch.name}</span>
                                <span className="text-[11px] text-muted font-mono shrink-0">{shortHash(branch.hash ?? "")}</span>
                            </div>
                        ))}
                    </div>
                </>
            )}

            {/* Create new branch */}
            <div className="mt-3 flex items-center gap-2 rounded border border-border bg-panel/80 px-2 py-1.5">
                <input
                    className="flex-1 h-[26px] rounded border border-border bg-panel text-xs text-foreground outline-none px-2 placeholder:text-muted focus:border-accent"
                    type="text"
                    value={newBranchName}
                    onChange={(e) => setNewBranchName(e.target.value)}
                    placeholder="new-branch-name"
                />
                <button
                    className="rounded bg-action px-2.5 py-1 text-[11px] text-actiontext font-semibold hover:bg-actionhover disabled:opacity-40 cursor-pointer disabled:cursor-default"
                    disabled={!newBranchName.trim()}
                    onClick={() => {
                        if (newBranchName.trim()) {
                            // TODO: create branch
                            setNewBranchName("");
                        }
                    }}
                >
                    新建
                </button>
            </div>
        </div>
    );
}
