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
import { CommitGraphCell, CommitGraphGutter } from "./vcs-history-graph";
import { GRAPH_GEO, computeLayout, type GraphCommit } from "./graph-layout";
import {
    avatarColor,
    colorForCommitRefs,
    colorForRefName,
    initials,
    parseGitRefs,
    type CommitRef,
} from "./vcs-commit-meta";
import { formatAbsoluteTime, formatRelativeTime } from "./vcs-time";
import { VcsIconButton } from "./vcs-icon-button";

type VcsUiEnv = WaveEnv;

const VcsHistoryRpcTimeoutMs = 30000;
const DefaultPageSize = 50;
/** Extra px added to the computed lane width for breathing room on both sides. */
const GraphGutterPadding = 10;

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

function statusCodeClass(code: string): string {
    switch (code) {
        case "A":
            return "text-success";
        case "D":
            return "text-error";
        case "R":
            return "text-accent";
        default:
            return "text-warning";
    }
}

function hexToAlpha(hex: string, alpha: number): string {
    if (!hex.startsWith("#") || hex.length !== 7) return `rgba(120, 120, 120, ${alpha})`;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Ref badges above/beside the commit subject. Branch colours match the lane
 * colour the commit is drawn on, so a branch and its lane always agree.
 */
function RefBadges({ refs, colorByBranch }: { refs: CommitRef[]; colorByBranch: Map<string, string> }) {
    if (refs.length === 0) return null;
    return (
        <span
            className="flex min-w-0 max-w-[45%] shrink-0 items-center gap-1 overflow-hidden"
            data-vcs-commit-refs="1"
        >
            {refs.map((ref, index) => {
                const color = colorByBranch.get(ref.name) ?? colorForRefName(ref.name);
                if (ref.type === "tag") {
                    return (
                        <span
                            key={`${ref.type}-${ref.name}-${index}`}
                            title={`tag ${ref.name}`}
                            className="inline-flex h-4 max-w-[190px] items-center gap-1 truncate rounded border border-warning/40 bg-warning/12 px-1.5 text-[10px] font-mono text-warning"
                        >
                            <i className="fa-sharp fa-solid fa-tag text-[8px] shrink-0" />
                            <span className="truncate">{ref.name}</span>
                        </span>
                    );
                }
                if (ref.type === "remote") {
                    return (
                        <span
                            key={`${ref.type}-${ref.name}-${index}`}
                            title={`remote branch ${ref.name}`}
                            className="inline-flex h-4 max-w-[190px] items-center gap-1 truncate rounded border border-border/70 px-1.5 text-[10px] font-mono text-muted"
                        >
                            <i className="fa-sharp fa-solid fa-cloud text-[8px] shrink-0" />
                            <span className="truncate">{ref.name}</span>
                        </span>
                    );
                }
                const isHead = ref.type === "head";
                return (
                    <span
                        key={`${ref.type}-${ref.name}-${index}`}
                        title={isHead ? `HEAD at ${ref.name}` : `branch ${ref.name}`}
                        className="inline-flex h-4 max-w-[190px] items-center gap-1 truncate rounded border px-1.5 text-[10px] font-mono"
                        style={{
                            color,
                            borderColor: hexToAlpha(color, 0.45),
                            backgroundColor: hexToAlpha(color, 0.14),
                        }}
                    >
                        {isHead && <span className="shrink-0 opacity-80">HEAD →</span>}
                        <span className="truncate">{ref.name}</span>
                    </span>
                );
            })}
        </span>
    );
}

function CommitFilesPanel({
    files,
    loading,
    error,
    gutterLanes,
    gutterWidth,
    onShowFileDiff,
}: {
    files: VcsCommitFileInfo[];
    loading: boolean;
    error: string;
    gutterLanes: Parameters<typeof CommitGraphGutter>[0]["lanes"];
    gutterWidth: number;
    onShowFileDiff?: (filePath: string) => void;
}) {
    if (loading) {
        return <div className="ml-2 border-l border-border/60 px-2 py-1 text-[11px] text-muted">Loading files...</div>;
    }
    if (!isBlank(error)) {
        return (
            <div className="ml-2 border-l border-border/60 px-2 py-1 text-[11px] text-error whitespace-pre-wrap">
                {error}
            </div>
        );
    }
    if (files.length === 0) {
        return (
            <div className="ml-2 border-l border-border/60 px-2 py-1 text-[11px] text-muted">
                No changed files in this commit.
            </div>
        );
    }
    const bodyHeight = files.length * 26 + 8;
    return (
        <div
            className="grid items-start pr-2.5"
            style={{ gridTemplateColumns: `${gutterWidth}px minmax(0, 1fr)`, height: bodyHeight }}
            data-vcs-commit-files="1"
        >
            <CommitGraphGutter lanes={gutterLanes} width={gutterWidth} height={bodyHeight} />
            <div className="overflow-hidden rounded border border-border/70 bg-surface-strong/40">
                {files.map((file, index) => {
                    const hasStats = (file.added ?? 0) > 0 || (file.deleted ?? 0) > 0;
                    return (
                        <div
                            key={`${file.path}-${index}`}
                            className="group flex h-[26px] items-center gap-2 border-b border-border/50 px-2 text-[11px] last:border-b-0 hover:bg-hoverbg/50"
                        >
                            <span
                                className={`w-[12px] shrink-0 text-center font-mono font-semibold ${statusCodeClass(file.code)}`}
                            >
                                {statusCodeLabel(file.code)}
                            </span>
                            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-secondary">
                                {file.path}
                            </span>
                            {hasStats && (
                                <span className="shrink-0 font-mono text-[10px] tabular-nums">
                                    {(file.added ?? 0) > 0 && <span className="text-success">+{file.added}</span>}
                                    {(file.deleted ?? 0) > 0 && (
                                        <span className="text-error ml-1">−{file.deleted}</span>
                                    )}
                                </span>
                            )}
                            {onShowFileDiff != null && (
                                <VcsIconButton
                                    icon="code-compare"
                                    title={`View diff of ${file.path}`}
                                    size="sm"
                                    tone="accent"
                                    reveal="hover"
                                    onClick={() => onShowFileDiff(file.path)}
                                />
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
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

    // Lane layout is computed per page slice: parents outside the slice are
    // unknown and simply do not draw an edge (documented trade-off).
    const layout = React.useMemo(
        () =>
            computeLayout(commits as (VcsCommitInfo & GraphCommit)[], {
                colorForCommit: (commit) => colorForCommitRefs(commit.refs),
            }),
        [commits]
    );

    // Branch colour lookup so a badge and its lane never disagree.
    const colorByBranch = React.useMemo(() => {
        const map = new Map<string, string>();
        for (const row of layout.rows) {
            for (const ref of parseGitRefs(row.commit.refs)) {
                if (!map.has(ref.name)) map.set(ref.name, row.nodeColor);
            }
        }
        return map;
    }, [layout]);

    const graphWidth = Math.max(layout.width + GraphGutterPadding, GRAPH_GEO.laneWidth + GraphGutterPadding);
    const pageStart = (Math.max(1, page) - 1) * Math.max(1, pageSize) + 1;
    const pageEnd = (Math.max(1, page) - 1) * Math.max(1, pageSize) + commits.length;
    const showGraphColumn = layout.maxLanes > 1 || commits.some((commit) => (commit.parents?.length ?? 0) > 0);

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
                    <div className="flex flex-col @container" data-vcs-commit-list="1">
                        {layout.rows.map((row) => {
                            const commit = row.commit;
                            const revision = commit.hash ?? "";
                            const isExpanded = !!expanded[revision];
                            const fileLoading = !!filesLoading[revision];
                            const fileErr = filesError[revision] ?? "";
                            const files = filesByHash[revision] ?? [];
                            const refs = parseGitRefs(commit.refs);
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
                            const relativeTime = formatRelativeTime(commit.date);
                            return (
                                <div
                                    key={`${revision}-${row.nodeLane}`}
                                    className="group border-b border-border/30"
                                    onContextMenu={handleCommitContextMenu}
                                    data-vcs-commit-row={revision}
                                >
                                    <div
                                        className="flex cursor-pointer items-center gap-2 pr-2.5 hover:bg-hoverbg/50"
                                        style={{ height: GRAPH_GEO.rowHeight }}
                                        onClick={() => toggleCommit(commit)}
                                    >
                                        <span
                                            className="flex h-full shrink-0 items-center"
                                            style={{ width: graphWidth }}
                                        >
                                            {showGraphColumn && (
                                                <CommitGraphCell row={row} width={layout.width} />
                                            )}
                                        </span>
                                        <span className="flex min-w-0 flex-1 items-center gap-1.5">
                                            <span className="w-[10px] shrink-0 text-[10px] text-muted">
                                                {isExpanded ? "▾" : "▸"}
                                            </span>
                                            <RefBadges refs={refs} colorByBranch={colorByBranch} />
                                            <span
                                                className="min-w-0 flex-1 truncate text-xs text-foreground"
                                                title={commit.subject || "(no message)"}
                                            >
                                                {commit.subject || "(no message)"}
                                            </span>
                                        </span>
                                        <span
                                            className="hidden shrink-0 rounded bg-surface-strong/60 px-1.5 py-0.5 font-mono text-[10px] text-muted @[420px]:inline-block"
                                            title={revision}
                                        >
                                            {shortHash(revision)}
                                        </span>
                                        <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-secondary">
                                            <span
                                                className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[8px] font-semibold text-white"
                                                style={{
                                                    backgroundColor: avatarColor(commit.author),
                                                    boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.14)",
                                                }}
                                                aria-hidden="true"
                                            >
                                                {initials(commit.author)}
                                            </span>
                                            <span className="hidden max-w-[150px] truncate @[520px]:inline">
                                                {commit.author || "unknown"}
                                            </span>
                                        </span>
                                        <span
                                            className="shrink-0 text-right text-[11px] tabular-nums text-muted"
                                            title={formatAbsoluteTime(commit.date)}
                                        >
                                            {relativeTime}
                                        </span>
                                        <span className="hidden shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 @[440px]:flex">
                                            <VcsIconButton
                                                icon="copy"
                                                title="Copy hash"
                                                size="sm"
                                                reveal="always"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    fireAndForget(async () => {
                                                        await navigator.clipboard.writeText(revision);
                                                    });
                                                }}
                                            />
                                            {!isBlank(commitRemoteUrl) && (
                                                <VcsIconButton
                                                    icon="arrow-up-right-from-square"
                                                    title="Open commit on remote"
                                                    size="sm"
                                                    reveal="always"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        fireAndForget(async () => {
                                                            await openLink(commitRemoteUrl);
                                                        });
                                                    }}
                                                />
                                            )}
                                        </span>
                                    </div>
                                    {isExpanded && (
                                        <CommitFilesPanel
                                            files={files}
                                            loading={fileLoading}
                                            error={fileErr}
                                            gutterLanes={row.bottomLanes}
                                            gutterWidth={graphWidth}
                                            onShowFileDiff={
                                                onShowFileDiff != null
                                                    ? (filePath) => onShowFileDiff(filePath, revision)
                                                    : undefined
                                            }
                                        />
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}

                {!loading && !error && (
                    <div className="mt-3 flex items-center justify-between gap-2 text-[11px]">
                        <span className="text-muted tabular-nums">
                            {commits.length === 0
                                ? "0 commits"
                                : `${pageStart}–${pageEnd} of ${commits.length} commits · page ${page}`}
                        </span>
                        <div className="flex items-center gap-1">
                            <VcsIconButton
                                icon="chevron-left"
                                title="Previous page"
                                className="border border-border"
                                disabled={page <= 1}
                                onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                            />
                            <VcsIconButton
                                icon="chevron-right"
                                title="Next page"
                                className="border border-border"
                                disabled={!hasMore}
                                onClick={() => setPage((prev) => prev + 1)}
                            />
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
