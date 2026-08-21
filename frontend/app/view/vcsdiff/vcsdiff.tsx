// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { DiffViewer } from "@/app/view/codeeditor/diffviewer";
import { getFileLanguage } from "@/app/view/preview/preview-edit";
import type { WaveEnv } from "@/app/waveenv/waveenv";
import { useWaveEnv } from "@/app/waveenv/waveenv";
import * as WOS from "@/store/wos";
import { isBlank, makeConnRoute } from "@/util/util";
import { Atom, atom, useAtomValue } from "jotai";
import React from "react";

type VcsDiffEnv = WaveEnv;
type VcsDiffMode = "side-by-side" | "inline";

function normalizeVcsDiffMode(val: any): VcsDiffMode {
    return val === "inline" ? "inline" : "side-by-side";
}

function makeAbsoluteDiffPath(repoPath: string, filePath: string): string {
    const normalizedFilePath = (filePath ?? "").replace(/\\/g, "/");
    if (isBlank(normalizedFilePath)) {
        return "";
    }
    if (normalizedFilePath.startsWith("/")) {
        return normalizedFilePath;
    }
    const normalizedRepoPath = (repoPath ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
    if (isBlank(normalizedRepoPath)) {
        return normalizedFilePath;
    }
    return `${normalizedRepoPath}/${normalizedFilePath.replace(/^\/+/, "")}`;
}

export class VcsDiffViewModel implements ViewModel {
    viewType = "vcsdiff";
    blockId: string;
    env: VcsDiffEnv;
    blockAtom: Atom<Block>;
    viewIcon = atom("file-code");
    viewName = atom("File Diff");
    hideViewName = atom(true);
    manageConnection = atom(true);
    filterOutNowsh = atom(true);
    noPadding = atom(true);
    refreshNonce = atom(0);

    repoTypeAtom: Atom<string>;
    repoPathAtom: Atom<string>;
    filePathAtom: Atom<string>;
    revisionAtom: Atom<string>;
    modeAtom: Atom<VcsDiffMode>;
    titleAtom: Atom<string>;
    connection: Atom<string>;
    connStatus: Atom<ConnStatus>;

    viewText: Atom<HeaderElem[]>;
    endIconButtons: Atom<IconButtonDecl[]>;

    constructor({ blockId, waveEnv }: ViewModelInitType) {
        this.blockId = blockId;
        this.env = waveEnv;
        this.blockAtom = this.env.wos.getWaveObjectAtom<Block>(`block:${blockId}`);

        this.repoTypeAtom = atom((get) => get(this.blockAtom)?.meta?.["vcsdiff:repotype"] ?? "");
        this.repoPathAtom = atom((get) => get(this.blockAtom)?.meta?.["vcsdiff:repopath"] ?? "");
        this.filePathAtom = atom((get) => get(this.blockAtom)?.meta?.["vcsdiff:filepath"] ?? "");
        this.revisionAtom = atom((get) => get(this.blockAtom)?.meta?.["vcsdiff:revision"] ?? "");
        this.modeAtom = atom((get) => normalizeVcsDiffMode(get(this.blockAtom)?.meta?.["vcsdiff:mode"]));
        this.titleAtom = atom((get) => {
            const customTitle = get(this.blockAtom)?.meta?.["vcsdiff:title"];
            if (!isBlank(customTitle)) {
                return customTitle;
            }
            const filePath = get(this.filePathAtom);
            const revision = get(this.revisionAtom);
            if (isBlank(filePath)) {
                return "Diff";
            }
            if (isBlank(revision)) {
                return `${filePath} (working tree)`;
            }
            return `${filePath} @ ${revision}`;
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
                    className: "vcsdiff-title",
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
        return VcsDiffView;
    }
}

function VcsDiffView({ model }: ViewComponentProps<VcsDiffViewModel>) {
    const env = useWaveEnv<VcsDiffEnv>();
    const connection = useAtomValue(model.connection);
    const connStatus = useAtomValue(model.connStatus);
    const repoType = useAtomValue(model.repoTypeAtom);
    const repoPath = useAtomValue(model.repoPathAtom);
    const filePath = useAtomValue(model.filePathAtom);
    const revision = useAtomValue(model.revisionAtom);
    const mode = useAtomValue(model.modeAtom);
    const blockData = useAtomValue(model.blockAtom);
    const refreshNonce = useAtomValue(model.refreshNonce);

    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState<string>(null);
    const [originalText, setOriginalText] = React.useState<string>(null);
    const [modifiedText, setModifiedText] = React.useState<string>(null);
    const [patchText, setPatchText] = React.useState<string>(null);
    const [renderHint, setRenderHint] = React.useState<string>("");
    const [modeSaving, setModeSaving] = React.useState(false);

    const route = React.useMemo(() => {
        if (isBlank(connection)) {
            return null;
        }
        return makeConnRoute(connection);
    }, [connection]);
    const absoluteDiffPath = React.useMemo(() => makeAbsoluteDiffPath(repoPath, filePath), [repoPath, filePath]);

    const setMode = React.useCallback(
        async (nextMode: VcsDiffMode) => {
            if (nextMode === mode) {
                return;
            }
            setModeSaving(true);
            try {
                await model.env.services.object.UpdateObjectMeta(WOS.makeORef("block", model.blockId), {
                    ...(blockData?.meta ?? {}),
                    "vcsdiff:mode": nextMode,
                } as any);
            } catch (e) {
                setError(String(e));
            } finally {
                setModeSaving(false);
            }
        },
        [mode, model, blockData?.meta]
    );

    React.useEffect(() => {
        let isCanceled = false;

        async function loadDiff() {
            if (connStatus?.status !== "connected") {
                setLoading(false);
                return;
            }
            if (isBlank(repoType) || isBlank(repoPath) || isBlank(filePath)) {
                setLoading(false);
                setError("Missing vcsdiff metadata (repotype/repopath/filepath).");
                return;
            }
            setLoading(true);
            setError(null);
            try {
                const response = await env.rpc.RemoteVcsFileDiffCommand(
                    TabRpcClient,
                    {
                        repotype: repoType,
                        repopath: repoPath,
                        filepath: filePath,
                        revision: revision,
                    },
                    { route }
                );
                if (isCanceled) {
                    return;
                }
                if (response.original != null && response.modified != null) {
                    setOriginalText(response.original);
                    setModifiedText(response.modified);
                    setPatchText(null);
                    setRenderHint("");
                } else {
                    setOriginalText(null);
                    setModifiedText(null);
                    setPatchText(response.diff ?? "");
                    if (!isBlank(response.diff)) {
                        setRenderHint(
                            "Showing raw patch because this diff is not renderable as a single-file visual diff."
                        );
                    } else {
                        setRenderHint("No diff output.");
                    }
                }
            } catch (e) {
                if (isCanceled) {
                    return;
                }
                setError(String(e));
                setOriginalText(null);
                setModifiedText(null);
                setPatchText(null);
                setRenderHint("");
            } finally {
                if (!isCanceled) {
                    setLoading(false);
                }
            }
        }

        loadDiff();

        return () => {
            isCanceled = true;
        };
    }, [connStatus?.status, repoType, repoPath, filePath, revision, route, refreshNonce]);

    if (connStatus?.status !== "connected") {
        return (
            <div className="h-full w-full flex items-center justify-center text-sm text-muted">
                Connection unavailable.
            </div>
        );
    }

    return (
        <div className="h-full w-full overflow-hidden p-2">
            <div className="h-full w-full overflow-auto rounded border border-white/10 bg-black/25 p-2">
                {loading && <div className="text-sm text-muted">Loading diff...</div>}
                {!loading && error && <div className="text-sm text-error whitespace-pre-wrap">{error}</div>}
                {!loading && !error && (
                    <div className="mb-2 flex items-center gap-1.5">
                        <span className="text-[11px] text-secondary">View</span>
                        <button
                            className={`rounded px-2 py-0.5 text-[11px] border cursor-pointer ${
                                mode === "side-by-side"
                                    ? "border-accent text-accent bg-accent/10"
                                    : "border-border text-secondary hover:bg-hoverbg"
                            }`}
                            onClick={() => setMode("side-by-side")}
                            disabled={modeSaving}
                        >
                            Side by side
                        </button>
                        <button
                            className={`rounded px-2 py-0.5 text-[11px] border cursor-pointer ${
                                mode === "inline"
                                    ? "border-accent text-accent bg-accent/10"
                                    : "border-border text-secondary hover:bg-hoverbg"
                            }`}
                            onClick={() => setMode("inline")}
                            disabled={modeSaving}
                        >
                            Inline
                        </button>
                    </div>
                )}
                {!loading && !error && originalText != null && modifiedText != null && (
                    <DiffViewer
                        blockId={model.blockId}
                        original={originalText}
                        modified={modifiedText}
                        fileName={filePath}
                        language={getFileLanguage(filePath)}
                        mode={mode}
                        copyContextFilePath={absoluteDiffPath}
                    />
                )}
                {!loading && !error && (originalText == null || modifiedText == null) && (
                    <div className="flex flex-col gap-2">
                        <div className="text-sm text-muted">{renderHint || "No visual diff content available."}</div>
                        {!isBlank(patchText) && (
                            <pre className="overflow-auto rounded border border-white/10 bg-black/30 p-2 font-mono text-[12px] leading-5 text-secondary whitespace-pre">
                                {patchText}
                            </pre>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
