// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import React from "react";

const MaxVisibleChips = 4;

function repoIsDirty(repo: VcsRepositoryInfo): boolean {
    const status = repo.status ?? [];
    const hasChanges = status.some((s) => !s.untracked) || status.some((s) => s.untracked);
    const remote = repo.remote;
    const hasRemoteDelta = (remote?.ahead ?? 0) > 0 || (remote?.behind ?? 0) > 0;
    return hasChanges || hasRemoteDelta;
}

export function VcsRepoSwitcher({
    repos,
    activeRepoId,
    onSelect,
}: {
    repos: VcsRepositoryInfo[];
    activeRepoId: string;
    onSelect: (repoId: string) => void;
}) {
    const [overflowOpen, setOverflowOpen] = React.useState(false);
    const moreRef = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
        if (!overflowOpen) return;
        const onDocClick = (e: MouseEvent) => {
            if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
                setOverflowOpen(false);
            }
        };
        document.addEventListener("mousedown", onDocClick);
        return () => document.removeEventListener("mousedown", onDocClick);
    }, [overflowOpen]);

    if (!repos || repos.length <= 1) return null;

    const visible = repos.slice(0, MaxVisibleChips);
    const overflow = repos.slice(MaxVisibleChips);

    return (
        <div className="flex shrink-0 items-center gap-1.5 border-b border-border/70 bg-panel/60 px-2 py-1.5 [scrollbar-width:none] overflow-x-auto whitespace-nowrap">
            {visible.map((repo) => (
                <button
                    key={repo.repoid}
                    type="button"
                    onClick={() => onSelect(repo.repoid)}
                    title={`${repo.name} — ${repo.branch} — ${repo.rootpath}`}
                    className={`flex h-6 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[11px] transition-colors cursor-pointer ${
                        repo.repoid === activeRepoId
                            ? "border-accent bg-accent text-actiontext font-medium"
                            : "border-border bg-surface text-secondary hover:bg-hoverbg"
                    }`}
                >
                    <span
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                            repoIsDirty(repo)
                                ? repo.repoid === activeRepoId
                                    ? "bg-white/85"
                                    : "bg-warning"
                                : repo.repoid === activeRepoId
                                  ? "bg-white/85"
                                  : "bg-success"
                        }`}
                    />
                    <span className="max-w-[120px] truncate">{repo.name}</span>
                    <span className={`font-mono text-[10px] ${repo.repoid === activeRepoId ? "opacity-85" : "text-muted"}`}>
                        {repo.branch || "(no branch)"}
                    </span>
                </button>
            ))}
            {overflow.length > 0 && (
                <div ref={moreRef} className="relative shrink-0">
                    <button
                        type="button"
                        onClick={() => setOverflowOpen((v) => !v)}
                        className="flex h-6 items-center gap-1 rounded-full border border-border bg-surface px-2.5 text-[11px] text-secondary hover:bg-hoverbg cursor-pointer"
                        title={`${overflow.length} more repositories`}
                    >
                        +{overflow.length}
                    </button>
                    {overflowOpen && (
                        <div className="absolute left-0 top-full z-50 mt-1 min-w-[200px] rounded-md border border-border bg-block p-1 shadow-xl">
                            {overflow.map((repo) => {
                                const dirty = repoIsDirty(repo);
                                const active = repo.repoid === activeRepoId;
                                return (
                                    <button
                                        key={repo.repoid}
                                        type="button"
                                        onClick={() => {
                                            onSelect(repo.repoid);
                                            setOverflowOpen(false);
                                        }}
                                        className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors cursor-pointer ${
                                            active ? "bg-actionsoft text-actionsofttext" : "text-secondary hover:bg-hoverbg"
                                        }`}
                                    >
                                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dirty ? "bg-warning" : "bg-success"}`} />
                                        <span className="min-w-0 flex-1 truncate font-medium">{repo.name}</span>
                                        <span className="font-mono text-[10px] text-muted truncate max-w-[110px]">{repo.branch || "(no branch)"}</span>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
