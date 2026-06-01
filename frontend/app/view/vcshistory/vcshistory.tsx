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

type VcsHistoryEnv = WaveEnv;
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

export class VcsHistoryViewModel implements ViewModel {
    viewType = "vcshistory";
    blockId: string;
    env: VcsHistoryEnv;
    blockAtom: Atom<Block>;

    viewIcon = atom("clock-rotate-left");
    viewName = atom("File History");
    manageConnection = atom(true);
    filterOutNowsh = atom(true);
    noPadding = atom(true);
    refreshNonce = atom(0);

    repoTypeAtom: Atom<string>;
    repoPathAtom: Atom<string>;
    filePathAtom: Atom<string>;
    titleAtom: Atom<string>;
    connection: Atom<string>;
    connStatus: Atom<ConnStatus>;
    viewText: Atom<HeaderElem[]>;
    endIconButtons: Atom<IconButtonDecl[]>;

    constructor({ blockId, waveEnv }: ViewModelInitType) {
        this.blockId = blockId;
        this.env = waveEnv;
        this.blockAtom = this.env.wos.getWaveObjectAtom<Block>(`block:${blockId}`);

        this.repoTypeAtom = atom((get) => get(this.blockAtom)?.meta?.["vcshistory:repotype"] ?? "");
        this.repoPathAtom = atom((get) => get(this.blockAtom)?.meta?.["vcshistory:repopath"] ?? "");
        this.filePathAtom = atom((get) => get(this.blockAtom)?.meta?.["vcshistory:filepath"] ?? "");
        this.titleAtom = atom((get) => {
            const customTitle = get(this.blockAtom)?.meta?.["vcshistory:title"];
            if (!isBlank(customTitle)) {
                return customTitle;
            }
            const filePath = get(this.filePathAtom);
            if (isBlank(filePath)) {
                return "File History";
            }
            return `History: ${filePath}`;
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
                    className: "vcshistory-title",
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
        return VcsHistoryView;
    }
}

function VcsHistoryView({ model }: ViewComponentProps<VcsHistoryViewModel>) {
    const env = useWaveEnv<VcsHistoryEnv>();
    const connection = useAtomValue(model.connection);
    const connStatus = useAtomValue(model.connStatus);
    const repoType = useAtomValue(model.repoTypeAtom);
    const repoPath = useAtomValue(model.repoPathAtom);
    const filePath = useAtomValue(model.filePathAtom);
    const refreshNonce = useAtomValue(model.refreshNonce);

    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState<string>(null);
    const [commits, setCommits] = React.useState<VcsCommitInfo[]>([]);
    const [openingDiffKey, setOpeningDiffKey] = React.useState<string>("");
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

    React.useEffect(() => {
        let isCanceled = false;
        async function loadHistory() {
            if (connStatus?.status !== "connected") {
                setLoading(false);
                return;
            }
            if (isBlank(repoType) || isBlank(repoPath) || isBlank(filePath)) {
                setLoading(false);
                setError("Missing vcshistory metadata (repotype/repopath/filepath).");
                return;
            }
            setLoading(true);
            setError(null);
            try {
                const response = await env.rpc.RemoteVcsFileHistoryCommand(
                    TabRpcClient,
                    {
                        repotype: repoType,
                        repopath: repoPath,
                        filepath: filePath,
                        limit: 100,
                    },
                    { route }
                );
                if (isCanceled) {
                    return;
                }
                setCommits(response.commits ?? []);
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
                setExpandedByRevision({});
                setFilesByRevision({});
                setFilesLoadingByRevision({});
                setFilesErrorByRevision({});
            } finally {
                if (!isCanceled) {
                    setLoading(false);
                }
            }
        }

        loadHistory();
        return () => {
            isCanceled = true;
        };
    }, [connStatus?.status, repoType, repoPath, filePath, route, refreshNonce]);

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
                        filepath: filePath,
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
        [env.rpc, filePath, filesByRevision, filesLoadingByRevision, repoPath, repoType, route]
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

    const openDiff = async (diffFilePath: string, revision: string) => {
        if (isBlank(diffFilePath) || isBlank(revision)) {
            return;
        }
        const diffKey = `${revision}:${diffFilePath}`;
        setOpeningDiffKey(diffKey);
        try {
            const blockDef: BlockDef = {
                meta: {
                    view: "vcsdiff",
                    connection,
                    "vcsdiff:repotype": repoType,
                    "vcsdiff:repopath": repoPath,
                    "vcsdiff:filepath": diffFilePath,
                    "vcsdiff:revision": revision,
                    "vcsdiff:mode": "side-by-side",
                    "vcsdiff:title": `${diffFilePath} @ ${shortHash(revision)}`,
                } as any,
            };
            await createBlock(blockDef);
        } finally {
            setOpeningDiffKey("");
        }
    };

    if (connStatus?.status !== "connected") {
        return <div className="h-full w-full flex items-center justify-center text-sm text-muted">Connection unavailable.</div>;
    }

    return (
        <div className="h-full w-full overflow-hidden p-2">
            <div className="h-full w-full overflow-auto rounded border border-white/10 bg-black/25 p-2">
                {loading && <div className="text-sm text-muted">Loading path history...</div>}
                {!loading && error && <div className="text-sm text-error whitespace-pre-wrap">{error}</div>}
                {!loading && !error && commits.length === 0 && (
                    <div className="text-sm text-muted">No history entries found for this path.</div>
                )}
                {!loading && !error && commits.length > 0 && (
                    <div className="flex flex-col gap-1">
                        {commits.map((commit, idx) => {
                            const revision = commit.hash ?? "";
                            const clickable = !isBlank(revision);
                            const expanded = !!expandedByRevision[revision];
                            const filesLoading = !!filesLoadingByRevision[revision];
                            const filesError = filesErrorByRevision[revision] ?? "";
                            const files = filesByRevision[revision] ?? [];
                            return (
                                <div
                                    key={`${revision}-${idx}`}
                                    className="rounded border border-white/10 px-2 py-1.5 bg-black/20"
                                >
                                    <div
                                        className={`flex items-center gap-2 text-xs ${
                                            clickable ? "cursor-pointer hover:text-accent" : ""
                                        }`}
                                        onClick={() => toggleCommit(commit)}
                                    >
                                        <span className="text-muted w-[12px] shrink-0">{expanded ? "▾" : "▸"}</span>
                                        <span className="font-mono text-secondary">{shortHash(revision)}</span>
                                        <span className="truncate flex-1">{commit.subject || "(no message)"}</span>
                                    </div>
                                    <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted">
                                        <span className="truncate">{commit.author || "unknown"}</span>
                                        <span className="truncate">{commit.date || ""}</span>
                                    </div>

                                    {expanded && (
                                        <div className="mt-1.5 rounded border border-white/10 bg-black/25">
                                            {filesLoading && (
                                                <div className="px-2 py-1 text-[11px] text-muted">Loading files...</div>
                                            )}
                                            {!filesLoading && !isBlank(filesError) && (
                                                <div className="px-2 py-1 text-[11px] text-error whitespace-pre-wrap">
                                                    {filesError}
                                                </div>
                                            )}
                                            {!filesLoading && isBlank(filesError) && files.length === 0 && (
                                                <div className="px-2 py-1 text-[11px] text-muted">
                                                    No changed files found for this path in this commit.
                                                </div>
                                            )}
                                            {!filesLoading && isBlank(filesError) && files.length > 0 && (
                                                <div className="max-h-[240px] overflow-auto">
                                                    {files.map((file, fileIdx) => {
                                                        const diffKey = `${revision}:${file.path}`;
                                                        const isOpening = openingDiffKey === diffKey;
                                                        return (
                                                            <div
                                                                key={`${revision}-${file.path}-${fileIdx}`}
                                                                className="flex items-center gap-2 border-b border-white/8 px-2 py-1 text-[11px] last:border-b-0"
                                                            >
                                                                <span className="font-mono text-secondary min-w-[20px]">
                                                                    {statusCodeLabel(file.code)}
                                                                </span>
                                                                <span className="truncate flex-1">{file.path}</span>
                                                                <button
                                                                    className="text-accent hover:underline cursor-pointer shrink-0 disabled:opacity-50 disabled:cursor-default"
                                                                    disabled={isOpening}
                                                                    onClick={() => {
                                                                        openDiff(file.path, revision).catch((e) => {
                                                                            setError(String(e));
                                                                        });
                                                                    }}
                                                                >
                                                                    {isOpening ? "Opening..." : "Diff"}
                                                                </button>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
