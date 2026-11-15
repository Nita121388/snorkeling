// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { BlockNodeModel } from "@/app/block/blocktypes";
import type { TabModel } from "@/app/store/tab-model";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { DiffViewer } from "@/app/view/codeeditor/diffviewer";
import { getFileLanguage } from "@/app/view/preview/preview-edit";
import type { WaveEnv, WaveEnvSubset } from "@/app/waveenv/waveenv";
import { i18n } from "@/i18n/config";
import { localeTextAtom } from "@/i18n/i18nmodel";
import { globalStore } from "@/store/jotaiStore";
import { base64ToString } from "@/util/util";
import * as jotai from "jotai";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

type DiffData = {
    original: string;
    modified: string;
    fileName: string;
};

export type AiFileDiffEnv = WaveEnvSubset<{
    rpc: {
        WaveAIGetToolDiffCommand: WaveEnv["rpc"]["WaveAIGetToolDiffCommand"];
    };
    wos: WaveEnv["wos"];
}>;

export class AiFileDiffViewModel implements ViewModel {
    blockId: string;
    nodeModel: BlockNodeModel;
    tabModel: TabModel;
    env: AiFileDiffEnv;
    viewType = "aifilediff";
    blockAtom: jotai.Atom<Block>;
    diffDataAtom: jotai.PrimitiveAtom<DiffData | null>;
    errorAtom: jotai.PrimitiveAtom<string | null>;
    loadingAtom: jotai.PrimitiveAtom<boolean>;
    viewIcon: jotai.Atom<string>;
    viewName: jotai.Atom<string>;
    viewText: jotai.Atom<string>;

    constructor({ blockId, nodeModel, tabModel, waveEnv }: ViewModelInitType) {
        this.blockId = blockId;
        this.nodeModel = nodeModel;
        this.tabModel = tabModel;
        this.env = waveEnv as AiFileDiffEnv;
        this.blockAtom = this.env.wos.getWaveObjectAtom<Block>(`block:${blockId}`);
        this.diffDataAtom = jotai.atom(null) as jotai.PrimitiveAtom<DiffData | null>;
        this.errorAtom = jotai.atom(null) as jotai.PrimitiveAtom<string | null>;
        this.loadingAtom = jotai.atom<boolean>(true);
        this.viewIcon = jotai.atom("file-lines");
        this.viewName = localeTextAtom(() => i18n.t("aifilediff:viewName"));
        this.viewText = jotai.atom((get) => {
            const diffData = get(this.diffDataAtom);
            return diffData?.fileName ?? "";
        });
    }

    get viewComponent(): ViewComponent {
        return AiFileDiffView;
    }
}

function AiFileDiffView({ blockId, model }: ViewComponentProps<AiFileDiffViewModel>) {
    // Subscription only — the markup below reads `i18n.t(...)`.
    useTranslation("aifilediff");
    const blockData = jotai.useAtomValue(model.blockAtom);
    const diffData = jotai.useAtomValue(model.diffDataAtom);
    const error = jotai.useAtomValue(model.errorAtom);
    const loading = jotai.useAtomValue(model.loadingAtom);

    useEffect(() => {
        async function loadDiffData() {
            const chatId = blockData?.meta?.["aifilediff:chatid"];
            const toolCallId = blockData?.meta?.["aifilediff:toolcallid"];
            const fileName = blockData?.meta?.file;

            if (!chatId || !toolCallId) {
                globalStore.set(model.errorAtom, "Missing chatId or toolCallId in block metadata");
                globalStore.set(model.loadingAtom, false);
                return;
            }

            if (!fileName) {
                globalStore.set(model.errorAtom, "Missing file name in block metadata");
                globalStore.set(model.loadingAtom, false);
                return;
            }

            try {
                const result = await model.env.rpc.WaveAIGetToolDiffCommand(TabRpcClient, {
                    chatid: chatId,
                    toolcallid: toolCallId,
                });

                if (!result) {
                    globalStore.set(model.errorAtom, "No diff data returned from server");
                    globalStore.set(model.loadingAtom, false);
                    return;
                }

                const originalContent = base64ToString(result.originalcontents64);
                const modifiedContent = base64ToString(result.modifiedcontents64);

                globalStore.set(model.diffDataAtom, {
                    original: originalContent,
                    modified: modifiedContent,
                    fileName: fileName,
                });
                globalStore.set(model.loadingAtom, false);
            } catch (e) {
                console.error("Error loading diff data:", e);
                globalStore.set(model.errorAtom, i18n.t("aifilediff:loadError", { message: e.message }));
                globalStore.set(model.loadingAtom, false);
            }
        }

        loadDiffData();
    }, [blockData?.meta?.["aifilediff:chatid"], blockData?.meta?.["aifilediff:toolcallid"], blockData?.meta?.file]);

    if (loading) {
        return (
            <div className="flex items-center justify-center w-full h-full">
                <div className="text-secondary">{i18n.t("aifilediff:loading")}</div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex items-center justify-center w-full h-full">
                <div className="text-red-500">{error}</div>
            </div>
        );
    }

    if (!diffData) {
        return (
            <div className="flex items-center justify-center w-full h-full">
                <div className="text-secondary">{i18n.t("aifilediff:noData")}</div>
            </div>
        );
    }

    return (
        <DiffViewer
            blockId={blockId}
            original={diffData.original}
            modified={diffData.modified}
            fileName={diffData.fileName}
            language={getFileLanguage(diffData.fileName)}
        />
    );
}

export default AiFileDiffView;
