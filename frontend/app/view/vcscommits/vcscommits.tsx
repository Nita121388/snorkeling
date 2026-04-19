// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import type { WaveEnv } from "@/app/waveenv/waveenv";
import { useWaveEnv } from "@/app/waveenv/waveenv";
import { createBlock } from "@/store/global";
import { isBlank, makeConnRoute } from "@/util/util";
import { Atom, atom, useAtomValue } from "jotai";
import React from "react";

type VcsCommitsEnv = WaveEnv;

type CommitFilesMap = Record<string, VcsCommitFileInfo[]>;
type CommitBoolMap = Record<string, boolean>;
type CommitStringMap = Record<string, string>;

function shortHash(hash: string): string {
    if (isBlank(hash)) {
        return "";
    }
    if (hash.length <= 10) {
        return hash;
    }
    return hash.slice(0, 10);
}

function statusCodeLabel(code: string): string {
    if (isBlank(code)) {
        return "·";
    }
    return code;
}

export class VcsCommitsViewModel implements ViewModel {
    viewType = "vcscommits";
    blockId: string;
    env: VcsCommitsEnv;
    blockAtom: Atom<Block>;

    viewIcon = atom("clock-rotate-left");
    viewName = atom("Repo Commits");
    manageConnection = atom(true);
    filterOutNowsh = atom(true);
    noPadding = atom(true);
    refreshNonce = atom(0);

    repoTypeAtom: Atom<string>;
    repoPathAtom: Atom<string>;
    titleAtom: Atom<string>;
    connection: Atom<string>;
    connStatus: Atom<ConnStatus>;
    viewText: Atom<HeaderElem[]>;
    endIconButtons: Atom<IconButtonDecl[]>;

    constructor({ blockId, waveEnv }: ViewModelInitType) {
        this.blockId = blockId;
        this.env = waveEnv;
        this.blockAtom = this.env.wos.getWaveObjectAtom<Block>(`block:${blockId}`);

        this.repoTypeAtom = atom((get) => get(this.blockAtom)?.meta?.["vcscommits:repotype"] ?? "");
        this.repoPathAtom = atom((get) => get(this.blockAtom)?.meta?.["vcscommits:repopath"] ?? "");
        this.titleAtom = atom((get) => {
            const customTitle = get(this.blockAtom)?.meta?.["vcscommits:title"];
            if (!isBlank(customTitle)) {
                return customTitle;
            }
            const repoPath = get(this.repoPathAtom);
            if (isBlank(repoPath)) {
                return "Repo Commits";
            }
            const trimmed = repoPath.replace(/\\/g, "/").replace(/\/+$/, "");
            const seg = trimmed.split("/").filter(Boolean).pop() ?? trimmed;
            return `${seg} Commits`;
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
            const title = get(this.titleAtom);
            return [
                {
                    elemtype: "text",
                    text: title,
                    className: "vcscommits-title",
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
        return VcsCommitsView;
    }
}

function VcsCommitsView({ model }: ViewComponentProps<VcsCommitsViewModel>) {
    const env = useWaveEnv<VcsCommitsEnv>();
    const connection = useAtomValue(model.connection);
    const connStatus = useAtomValue(model.connStatus);
    const repoType = useAtomValue(model.repoTypeAtom);
    const repoPath = useAtomValue(model.repoPathAtom);
    const refreshNonce = useAtomValue(model.refreshNonce);

    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState<string>(null);
    const [commits, setCommits] = React.useState<VcsCommitInfo[]>([]);
    const [hasMore, setHasMore] = React.useState(false);

    const [keywordInput, setKeywordInput] = React.useState("");
    const [sinceInput, setSinceInput] = React.useState("");
    const [untilInput, setUntilInput] = React.useState("");
    const [keyword, setKeyword] = React.useState("");
    const [since, setSince] = React.useState("");
    const [until, setUntil] = React.useState("");

    const [page, setPage] = React.useState(1);
    const [pageSize, setPageSize] = React.useState(50);

    const [expandedByRevision, setExpandedByRevision] = React.useState<CommitBoolMap>({});
    const [filesByRevision, setFilesByRevision] = React.useState<CommitFilesMap>({});
    const [filesLoadingByRevision, setFilesLoadingByRevision] = React.useState<CommitBoolMap>({});
    const [filesErrorByRevision, setFilesErrorByRevision] = React.useState<CommitStringMap>({});

    const route = React.useMemo(() => {
        if (isBlank(connection)) {
            return null;
        }
        return makeConnRoute(connection);
    }, [connection]);

    const offset = React.useMemo(() => {
        const normalizedPage = Math.max(1, page);
        return (normalizedPage - 1) * Math.max(1, pageSize);
    }, [page, pageSize]);

    React.useEffect(() => {
        let isCanceled = false;
        async function loadCommits() {
            if (connStatus?.status !== "connected") {
                setLoading(false);
                return;
            }
            if (isBlank(repoType) || isBlank(repoPath)) {
                setLoading(false);
                setError("Missing vcscommits metadata (repotype/repopath).");
                return;
            }
            setLoading(true);
            setError(null);
            try {
                const response = await env.rpc.RemoteVcsCommitsCommand(
                    TabRpcClient,
                    {
                        repotype: repoType,
                        repopath: repoPath,
                        limit: pageSize,
                        offset,
                        since: isBlank(since) ? "" : since,
                        until: isBlank(until) ? "" : until,
                        keyword: isBlank(keyword) ? "" : keyword,
                    },
                    { route }
                );
                if (isCanceled) {
                    return;
                }
                setCommits(response.commits ?? []);
                setHasMore(!!response.hasmore);
                setExpandedByRevision({});
                setFilesByRevision({});
                setFilesLoadingByRevision({});
                setFilesErrorByRevision({});
            } catch (e) {
                if (isCanceled) {
                    return;
                }
                setError(String(e));
                setCommits([]);
                setHasMore(false);
            } finally {
                if (!isCanceled) {
                    setLoading(false);
                }
            }
        }

        loadCommits();
        return () => {
            isCanceled = true;
        };
    }, [connStatus?.status, env.rpc, keyword, offset, pageSize, refreshNonce, repoPath, repoType, route, since, until]);

    const loadCommitFiles = React.useCallback(
        async (revision: string) => {
            if (isBlank(revision)) {
                return;
            }
            if (filesByRevision[revision] != null || filesLoadingByRevision[revision]) {
                return;
            }
            setFilesLoadingByRevision((prev) => ({ ...prev, [revision]: true }));
            setFilesErrorByRevision((prev) => ({ ...prev, [revision]: "" }));
            try {
                const response = await env.rpc.RemoteVcsCommitFilesCommand(
                    TabRpcClient,
                    {
                        repotype: repoType,
                        repopath: repoPath,
                        revision,
                    },
                    { route }
                );
                setFilesByRevision((prev) => ({ ...prev, [revision]: response.files ?? [] }));
            } catch (e) {
                setFilesErrorByRevision((prev) => ({ ...prev, [revision]: String(e) }));
            } finally {
                setFilesLoadingByRevision((prev) => ({ ...prev, [revision]: false }));
            }
        },
        [env.rpc, filesByRevision, filesLoadingByRevision, repoPath, repoType, route]
    );

    const toggleCommit = (commit: VcsCommitInfo) => {
        const revision = commit?.hash ?? "";
        if (isBlank(revision)) {
            return;
        }
        const currentlyOpen = !!expandedByRevision[revision];
        const nextOpen = !currentlyOpen;
        setExpandedByRevision((prev) => ({ ...prev, [revision]: nextOpen }));
        if (nextOpen) {
            loadCommitFiles(revision).catch((e) => {
                setFilesErrorByRevision((prev) => ({ ...prev, [revision]: String(e) }));
            });
        }
    };

    const openDiff = async (filePath: string, revision: string) => {
        if (isBlank(filePath) || isBlank(revision)) {
            return;
        }
        const blockDef: BlockDef = {
            meta: {
                view: "vcsdiff",
                connection,
                "vcsdiff:repotype": repoType,
                "vcsdiff:repopath": repoPath,
                "vcsdiff:filepath": filePath,
                "vcsdiff:revision": revision,
                "vcsdiff:mode": "side-by-side",
                "vcsdiff:title": `${filePath} @ ${shortHash(revision)}`,
            } as any,
        };
        await createBlock(blockDef);
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

    if (connStatus?.status !== "connected") {
        return <div className="h-full w-full flex items-center justify-center text-sm text-muted">Connection unavailable.</div>;
    }

    return (
        <div className="h-full w-full overflow-hidden p-2">
            <div className="h-full w-full overflow-auto rounded border border-white/10 bg-black/25 p-2">
                <div className="mb-2 grid grid-cols-1 gap-1.5 md:grid-cols-[1.2fr_auto_auto_auto_auto_auto] md:items-center">
                    <input
                        className="rounded border border-white/15 bg-black/30 px-2 py-1 text-xs outline-none focus:border-accent"
                        placeholder="关键词（hash/author/subject）"
                        value={keywordInput}
                        onChange={(e) => setKeywordInput(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") {
                                applyFilters();
                            }
                        }}
                    />
                    <input
                        type="date"
                        className="rounded border border-white/15 bg-black/30 px-2 py-1 text-xs outline-none focus:border-accent"
                        value={sinceInput}
                        onChange={(e) => setSinceInput(e.target.value)}
                        title="Since"
                    />
                    <input
                        type="date"
                        className="rounded border border-white/15 bg-black/30 px-2 py-1 text-xs outline-none focus:border-accent"
                        value={untilInput}
                        onChange={(e) => setUntilInput(e.target.value)}
                        title="Until"
                    />
                    <select
                        className="rounded border border-white/15 bg-black/30 px-2 py-1 text-xs outline-none focus:border-accent"
                        value={String(pageSize)}
                        onChange={(e) => {
                            const nextSize = Number(e.target.value) || 50;
                            setPageSize(nextSize);
                            setPage(1);
                        }}
                    >
                        <option value="20">20 / page</option>
                        <option value="50">50 / page</option>
                        <option value="100">100 / page</option>
                    </select>
                    <button
                        className="rounded border border-accent px-2 py-1 text-xs text-accent hover:bg-accent/10 cursor-pointer"
                        onClick={applyFilters}
                    >
                        查询
                    </button>
                    <button
                        className="rounded border border-white/15 px-2 py-1 text-xs text-secondary hover:bg-white/5 cursor-pointer"
                        onClick={resetFilters}
                    >
                        重置
                    </button>
                </div>

                {loading && <div className="text-sm text-muted">Loading commits...</div>}
                {!loading && error && <div className="text-sm text-error whitespace-pre-wrap">{error}</div>}
                {!loading && !error && commits.length === 0 && <div className="text-sm text-muted">No commits found.</div>}

                {!loading && !error && commits.length > 0 && (
                    <div className="flex flex-col gap-1.5">
                        {commits.map((commit, idx) => {
                            const revision = commit.hash ?? "";
                            const expanded = !!expandedByRevision[revision];
                            const filesLoading = !!filesLoadingByRevision[revision];
                            const filesError = filesErrorByRevision[revision] ?? "";
                            const files = filesByRevision[revision] ?? [];
                            return (
                                <div key={`${revision}-${idx}`} className="rounded border border-white/10 bg-black/20 px-2 py-1.5">
                                    <div
                                        className={`flex items-center gap-2 text-xs ${!isBlank(revision) ? "cursor-pointer" : ""}`}
                                        onClick={() => toggleCommit(commit)}
                                    >
                                        <span className="text-muted w-[12px] shrink-0">{expanded ? "▾" : "▸"}</span>
                                        <span className="font-mono text-secondary shrink-0">{shortHash(revision)}</span>
                                        <span className="truncate flex-1">{commit.subject || "(no message)"}</span>
                                    </div>
                                    <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted">
                                        <span className="truncate">{commit.author || "unknown"}</span>
                                        <span className="truncate">{commit.date || ""}</span>
                                    </div>

                                    {expanded && (
                                        <div className="mt-1.5 rounded border border-white/10 bg-black/25">
                                            {filesLoading && <div className="px-2 py-1 text-[11px] text-muted">Loading files...</div>}
                                            {!filesLoading && !isBlank(filesError) && (
                                                <div className="px-2 py-1 text-[11px] text-error whitespace-pre-wrap">{filesError}</div>
                                            )}
                                            {!filesLoading && isBlank(filesError) && files.length === 0 && (
                                                <div className="px-2 py-1 text-[11px] text-muted">No changed files in this commit.</div>
                                            )}
                                            {!filesLoading && isBlank(filesError) && files.length > 0 && (
                                                <div className="max-h-[240px] overflow-auto">
                                                    {files.map((file, fileIdx) => (
                                                        <div
                                                            key={`${revision}-${file.path}-${fileIdx}`}
                                                            className="flex items-center gap-2 border-b border-white/8 px-2 py-1 text-[11px] last:border-b-0"
                                                        >
                                                            <span className="font-mono text-secondary min-w-[20px]">
                                                                {statusCodeLabel(file.code)}
                                                            </span>
                                                            <span className="truncate flex-1">{file.path}</span>
                                                            <button
                                                                className="text-accent hover:underline cursor-pointer shrink-0"
                                                                onClick={() => {
                                                                    openDiff(file.path, revision).catch((e) => {
                                                                        setError(String(e));
                                                                    });
                                                                }}
                                                            >
                                                                Diff
                                                            </button>
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
                        <button
                            className="rounded border border-white/15 px-2 py-1 text-secondary hover:bg-white/5 disabled:opacity-50 disabled:cursor-default cursor-pointer"
                            disabled={page <= 1}
                            onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                        >
                            Prev
                        </button>
                        <span className="text-muted">Page {page}</span>
                        <button
                            className="rounded border border-white/15 px-2 py-1 text-secondary hover:bg-white/5 disabled:opacity-50 disabled:cursor-default cursor-pointer"
                            disabled={!hasMore}
                            onClick={() => setPage((prev) => prev + 1)}
                        >
                            Next
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
