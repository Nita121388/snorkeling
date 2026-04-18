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

function shortHash(hash: string): string {
    if (isBlank(hash)) {
        return "";
    }
    if (hash.length <= 10) {
        return hash;
    }
    return hash.slice(0, 10);
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
    const [openingHash, setOpeningHash] = React.useState<string>("");

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
            } catch (e) {
                if (isCanceled) {
                    return;
                }
                setError(String(e));
                setCommits([]);
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

    const openDiff = async (commit: VcsCommitInfo) => {
        if (!commit || isBlank(commit.hash)) {
            return;
        }
        setOpeningHash(commit.hash);
        try {
            const blockDef: BlockDef = {
                meta: {
                    view: "vcsdiff",
                    connection,
                    "vcsdiff:repotype": repoType,
                    "vcsdiff:repopath": repoPath,
                    "vcsdiff:filepath": filePath,
                    "vcsdiff:revision": commit.hash,
                    "vcsdiff:mode": "side-by-side",
                    "vcsdiff:title": `${filePath} @ ${shortHash(commit.hash)}`,
                } as any,
            };
            await createBlock(blockDef);
        } finally {
            setOpeningHash("");
        }
    };

    if (connStatus?.status !== "connected") {
        return <div className="h-full w-full flex items-center justify-center text-sm text-muted">Connection unavailable.</div>;
    }

    return (
        <div className="h-full w-full overflow-hidden p-2">
            <div className="h-full w-full overflow-auto rounded border border-white/10 bg-black/25 p-2">
                {loading && <div className="text-sm text-muted">Loading file history...</div>}
                {!loading && error && <div className="text-sm text-error whitespace-pre-wrap">{error}</div>}
                {!loading && !error && commits.length === 0 && (
                    <div className="text-sm text-muted">No history entries found for this file.</div>
                )}
                {!loading && !error && commits.length > 0 && (
                    <div className="flex flex-col gap-1">
                        {commits.map((commit, idx) => {
                            const clickable = !isBlank(commit.hash);
                            const isOpening = openingHash === commit.hash && !isBlank(commit.hash);
                            return (
                                <div
                                    key={`${commit.hash}-${idx}`}
                                    className={`rounded border border-white/10 px-2 py-1.5 bg-black/20 ${
                                        clickable ? "cursor-pointer hover:bg-black/35" : ""
                                    }`}
                                    onClick={() => {
                                        if (!clickable || isOpening) {
                                            return;
                                        }
                                        openDiff(commit).catch((e) => setError(String(e)));
                                    }}
                                >
                                    <div className="flex items-center gap-2 text-xs">
                                        <span className="font-mono text-secondary">{shortHash(commit.hash)}</span>
                                        <span className="truncate flex-1">{commit.subject || "(no message)"}</span>
                                        {clickable && (
                                            <span className="text-[11px] text-accent shrink-0">
                                                {isOpening ? "Opening..." : "diff"}
                                            </span>
                                        )}
                                    </div>
                                    <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted">
                                        <span className="truncate">{commit.author || "unknown"}</span>
                                        <span className="truncate">{commit.date || ""}</span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
