// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import type { WaveEnv } from "@/app/waveenv/waveenv";
import { useWaveEnv } from "@/app/waveenv/waveenv";
import { isBlank, makeConnRoute } from "@/util/util";
import { Atom, atom, useAtomValue } from "jotai";
import React from "react";

type VcsDiffEnv = WaveEnv;

export class VcsDiffViewModel implements ViewModel {
    viewType = "vcsdiff";
    blockId: string;
    env: VcsDiffEnv;
    blockAtom: Atom<Block>;
    viewIcon = atom("file-code");
    viewName = atom("File Diff");
    manageConnection = atom(true);
    filterOutNowsh = atom(true);
    noPadding = atom(true);
    refreshNonce = atom(0);

    repoTypeAtom: Atom<string>;
    repoPathAtom: Atom<string>;
    filePathAtom: Atom<string>;
    revisionAtom: Atom<string>;
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
    const refreshNonce = useAtomValue(model.refreshNonce);

    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState<string>(null);
    const [diffText, setDiffText] = React.useState<string>("");

    const route = React.useMemo(() => {
        if (isBlank(connection)) {
            return null;
        }
        return makeConnRoute(connection);
    }, [connection]);

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
                setDiffText(response.diff ?? "");
            } catch (e) {
                if (isCanceled) {
                    return;
                }
                setError(String(e));
                setDiffText("");
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
        return <div className="h-full w-full flex items-center justify-center text-sm text-muted">Connection unavailable.</div>;
    }

    return (
        <div className="h-full w-full overflow-hidden p-2">
            <div className="h-full w-full overflow-auto rounded border border-white/10 bg-black/25 p-2">
                {loading && <div className="text-sm text-muted">Loading diff...</div>}
                {!loading && error && <div className="text-sm text-error whitespace-pre-wrap">{error}</div>}
                {!loading && !error && isBlank(diffText) && <div className="text-sm text-muted">No diff output.</div>}
                {!loading && !error && !isBlank(diffText) && (
                    <pre className="text-[12px] leading-[1.35] whitespace-pre-wrap font-mono">{diffText}</pre>
                )}
            </div>
        </div>
    );
}
