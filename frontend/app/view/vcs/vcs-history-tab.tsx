// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { TabRpcClient } from "@/app/store/wshrpcutil";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { buildCommitRemoteUrl, getRepoOpenUrl } from "@/app/view/vcs/vcs-remote";
import { openLink } from "@/store/global";
import { useWaveEnv } from "@/app/waveenv/waveenv";
import type { WaveEnv } from "@/app/waveenv/waveenv";
import { fireAndForget, isBlank, makeConnRoute } from "@/util/util";
import React from "react";
import { VcsIconButton } from "./vcs-icon-button";

type VcsUiEnv = WaveEnv;

const VcsHistoryRpcTimeoutMs = 30000;
const DefaultPageSize = 50;

type CommitFilesMap = Record<string, VcsCommitFileInfo[]>;
type CommitBoolMap = Record<string, boolean>;
type CommitStringMap = Record<string, string>;

function shortHash(hash: string): string {
    if (isBlank(hash)) return "";
    if (hash.length <= 10) return hash;
    return hash.slice(0, 10);
}

function statusCodeLabel(code: string): string {
    if (isBlank(code)) return "·";
    return code;
}

export function VcsHistoryTab({
    repo,
    connection,
    onShowFileDiff,
}: {
    repo: VcsRepositoryInfo;
    connection: string;
    onShowFileDiff?: (filePath: string, revision: string) => void;
}) {
    const env = useWaveEnv<VcsUiEnv>();
    const route = React.useMemo(() => {
        if (isBlank(connection)) return null;
        return makeConnRoute(connection);
    }, [connection]);

    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);
    const [commits, setCommits] = React.useState<VcsCommitInfo[]>([]);
    const [hasMore, setHasMore] = React.useState(false);

    const [keywordInput, setKeywordInput] = React.useState("");
    const [sinceInput, setSinceInput] = React.useState("");
    const [untilInput, setUntilInput] = React.useState("");
    const [keyword, setKeyword] = React.useState("");
    const [since, setSince] = React.useState("");
    const [until, setUntil] = React.useState("");
    const [page, setPage] = React.useState(1);
    const [pageSize, setPageSize] = React.useState(DefaultPageSize);

    const [expanded, setExpanded] = React.useState<CommitBoolMap>({});
    const [filesByHash, setFilesByHash] = React.useState<CommitFilesMap>({});
    const [filesLoading, setFilesLoading] = React.useState<CommitBoolMap>({});
    const [filesError, setFilesError] = React.useState<CommitStringMap>({});

    const loadCommits = React.useCallback(async () => {
        if (isBlank(repo.repotype) || isBlank(repo.rootpath)) {
            setLoading(false);
            setError("Missing repository metadata.");
            return;
        }
        setLoading(true);
        setError(null);
        const offset = (Math.max(1, page) - 1) * Math.max(1, pageSize);
        try {
            const response = await env.rpc.RemoteVcsCommitsCommand(
                TabRpcClient,
                {
                    repotype: repo.repotype,
                    repopath: repo.rootpath,
                    limit: pageSize,
                    offset,
                    since: since.trim(),
                    until: until.trim(),
                    keyword: keyword.trim(),
                },
                { route, timeout: VcsHistoryRpcTimeoutMs }
            );
            setCommits(response.commits ?? []);
            setHasMore(!!response.hasmore);
            setExpanded({});
            setFilesByHash({});
            setFilesLoading({});
            setFilesError({});
        } catch (e) {
            setError(String(e));
            setCommits([]);
        } finally {
            setLoading(false);
        }
    }, [env.rpc, keyword, page, pageSize, repo.repotype, repo.rootpath, route, since, until]);

    React.useEffect(() => {
        loadCommits();
    }, [loadCommits]);

    const loadFiles = React.useCallback(
        async (revision: string) => {
            if (isBlank(revision) || filesByHash[revision] != null || filesLoading[revision]) return;
            setFilesLoading((prev) => ({ ...prev, [revision]: true }));
            setFilesError((prev) => ({ ...prev, [revision]: "" }));
            try {
                const response = await env.rpc.RemoteVcsCommitFilesCommand(
                    TabRpcClient,
                    { repotype: repo.repotype, repopath: repo.rootpath, revision },
                    { route }
                );
                setFilesByHash((prev) => ({ ...prev, [revision]: response.files ?? [] }));
            } catch (e) {
                setFilesError((prev) => ({ ...prev, [revision]: String(e) }));
            } finally {
                setFilesLoading((prev) => ({ ...prev, [revision]: false }));
            }
        },
        [env.rpc, filesByHash, filesLoading, repo.repotype, repo.rootpath, route]
    );

    const toggleCommit = (commit: VcsCommitInfo) => {
        const revision = commit?.hash ?? "";
        if (isBlank(revision)) return;
        const nextOpen = !expanded[revision];
        setExpanded((prev) => ({ ...prev, [revision]: nextOpen }));
        if (nextOpen) {
            loadFiles(revision).catch(() => {});
        }
    };

    const applyFilters = () => {
        setPage(1);
        setKeyword(keywordInput.trim());
        setSince(sinceInput.trim());
        setUntil(untilInput.trim());
    };

    const resetFilters = () => {
        setKeywordInput("");
        setSinceInput("");
        setUntilInput("");
        setKeyword("");
        setSince("");
        setUntil("");
        setPage(1);
    };

    return (
        <div className="h-full w-full overflow-hidden p-2">
            <div className="h-full w-full overflow-auto p-2">
                <div className="mb-2 grid grid-cols-1 gap-1.5 md:grid-cols-[1.2fr_auto_auto_auto_auto_auto] md:items-center">
                    <input
                        className="rounded border border-border bg-panel/80 px-2 py-1 text-xs outline-none focus:border-accent"
                        placeholder="Keyword (hash/author/subject)"
                        value={keywordInput}
                        onChange={(e) => setKeywordInput(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") applyFilters();
                        }}
                    />
                    <input
                        type="date"
                        className="rounded border border-border bg-panel/80 px-2 py-1 text-xs outline-none focus:border-accent"
                        value={sinceInput}
                        onChange={(e) => setSinceInput(e.target.value)}
                        title="Since"
                    />
                    <input
                        type="date"
                        className="rounded border border-border bg-panel/80 px-2 py-1 text-xs outline-none focus:border-accent"
                        value={untilInput}
                        onChange={(e) => setUntilInput(e.target.value)}
                        title="Until"
                    />
                    <select
                        className="rounded border border-border bg-panel/80 px-2 py-1 text-xs outline-none focus:border-accent"
                        value={String(pageSize)}
                        onChange={(e) => {
                            setPageSize(Number(e.target.value) || DefaultPageSize);
                            setPage(1);
                        }}
                    >
                        <option value="20">20 / page</option>
                        <option value="50">50 / page</option>
                        <option value="100">100 / page</option>
                    </select>
                    <VcsIconButton
                        icon="check"
                        title="Apply filters"
                        tone="accent"
                        className="border border-accent"
                        onClick={applyFilters}
                    />
                    <VcsIconButton
                        icon="rotate-left"
                        title="Reset filters"
                        className="border border-border"
                        onClick={resetFilters}
                    />
                </div>

                {loading && <div className="text-sm text-muted">Loading commits...</div>}
                {!loading && error && <div className="text-sm text-error whitespace-pre-wrap">{error}</div>}
                {!loading && !error && commits.length === 0 && (
                    <div className="text-sm text-muted">No commits found.</div>
                )}

                {!loading && !error && commits.length > 0 && (
                    <div className="flex flex-col gap-1.5">
                        {commits.map((commit, idx) => {
                            const revision = commit.hash ?? "";
                            const isExpanded = !!expanded[revision];
                            const fileLoading = !!filesLoading[revision];
                            const fileErr = filesError[revision] ?? "";
                            const files = filesByHash[revision] ?? [];
                            const commitRemoteUrl =
                                repo.repotype === "git" ? buildCommitRemoteUrl(repo.browseurl, revision) : "";
                            const handleCommitContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
                                e.preventDefault();
                                const menu: ContextMenuItem[] = [
                                    {
                                        label: "Copy Hash",
                                        enabled: !isBlank(revision),
                                        click: () => {
                                            fireAndForget(async () => {
                                                await navigator.clipboard.writeText(revision);
                                            });
                                        },
                                    },
                                    {
                                        label: "Open Commit on Remote",
                                        enabled: !isBlank(commitRemoteUrl),
                                        click: () => {
                                            fireAndForget(async () => {
                                                await openLink(commitRemoteUrl);
                                            });
                                        },
                                    },
                                    {
                                        label: "Open Remote Repository",
                                        enabled: !isBlank(getRepoOpenUrl(repo)),
                                        click: () => {
                                            fireAndForget(async () => {
                                                await openLink(getRepoOpenUrl(repo));
                                            });
                                        },
                                    },
                                ];
                                ContextMenuModel.getInstance().showContextMenu(menu, e);
                            };
                            return (
                                <div key={`${revision}-${idx}`} className="group px-2 py-1.5" onContextMenu={handleCommitContextMenu}>
                                    <div
                                        className={`flex items-center gap-2 text-xs ${!isBlank(revision) ? "cursor-pointer" : ""}`}
                                        onClick={() => toggleCommit(commit)}
                                    >
                                        <span className="text-muted w-[12px] shrink-0">{isExpanded ? "▾" : "▸"}</span>
                                        <span className="font-mono text-secondary shrink-0">{shortHash(revision)}</span>
                                        <span className="truncate flex-1">{commit.subject || "(no message)"}</span>
                                        {!isBlank(commitRemoteUrl) && (
                                            <VcsIconButton
                                                icon="arrow-up-right-from-square"
                                                title="Open commit on remote"
                                                size="sm"
                                                reveal="hover"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    fireAndForget(async () => {
                                                        await openLink(commitRemoteUrl);
                                                    });
                                                }}
                                            />
                                        )}
                                    </div>
                                    <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted">
                                        <span className="truncate">{commit.author || "unknown"}</span>
                                        <span className="truncate">{commit.date || ""}</span>
                                    </div>

                                    {isExpanded && (
                                        <div className="mt-1.5 rounded border border-border bg-surface-strong">
                                            {fileLoading && (
                                                <div className="px-2 py-1 text-[11px] text-muted">Loading files...</div>
                                            )}
                                            {!fileLoading && !isBlank(fileErr) && (
                                                <div className="px-2 py-1 text-[11px] text-error whitespace-pre-wrap">{fileErr}</div>
                                            )}
                                            {!fileLoading && isBlank(fileErr) && files.length === 0 && (
                                                <div className="px-2 py-1 text-[11px] text-muted">No changed files in this commit.</div>
                                            )}
                                            {!fileLoading && isBlank(fileErr) && files.length > 0 && (
                                                <div className="max-h-[240px] overflow-auto">
                                                    {files.map((file, fileIdx) => (
                                                        <div
                                                            key={`${revision}-${file.path}-${fileIdx}`}
                                                            className="group flex items-center gap-2 border-b border-border px-2 py-1 text-[11px] last:border-b-0"
                                                        >
                                                            <span className="font-mono text-secondary min-w-[20px]">
                                                                {statusCodeLabel(file.code)}
                                                            </span>
                                                            <span className="truncate flex-1">{file.path}</span>
                                                            {onShowFileDiff != null && (
                                                                <VcsIconButton
                                                                    icon="code-compare"
                                                                    title={`View diff of ${file.path}`}
                                                                    size="sm"
                                                                    tone="accent"
                                                                    reveal="hover"
                                                                    onClick={() => onShowFileDiff(file.path, revision)}
                                                                />
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}

                {!loading && !error && (
                    <div className="mt-2 flex items-center justify-end gap-2 text-xs">
                        <VcsIconButton
                            icon="chevron-left"
                            title="Previous page"
                            className="border border-border"
                            disabled={page <= 1}
                            onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                        />
                        <span className="text-muted">Page {page}</span>
                        <VcsIconButton
                            icon="chevron-right"
                            title="Next page"
                            className="border border-border"
                            disabled={!hasMore}
                            onClick={() => setPage((prev) => prev + 1)}
                        />
                    </div>
                )}
            </div>
        </div>
    );
}
