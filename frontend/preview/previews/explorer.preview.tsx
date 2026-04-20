// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Block } from "@/app/block/block";
import { globalStore } from "@/app/store/jotaiStore";
import { getTabModelByTabId, TabModelContext } from "@/app/store/tab-model";
import { WaveEnvContext, useWaveEnv } from "@/app/waveenv/waveenv";
import type { MockWaveEnv } from "@/preview/mock/mockwaveenv";
import { applyMockEnvOverrides, PreviewTabId } from "@/preview/mock/mockwaveenv";
import { makeMockNodeModel } from "@/preview/mock/mock-node-model";
import React, { useMemo, useRef } from "react";

const PreviewNodeId = "preview-explorer-node";
const ExplorerBlockId = "preview-explorer-block";
const ExplorerRootPath = "/Users/mike/waveterm";
const ExplorerFilePath = "/Users/mike/waveterm/docs/preview-notes.md";

function makeExplorerEnv(baseEnv: MockWaveEnv): MockWaveEnv {
    const explorerEnv = applyMockEnvOverrides(baseEnv, {
        mockWaveObjs: {
            [`tab:${PreviewTabId}`]: {
                otype: "tab",
                oid: PreviewTabId,
                version: 1,
                name: "Explorer Preview",
                blockids: [ExplorerBlockId],
                meta: {},
            } as Tab,
            [`block:${ExplorerBlockId}`]: {
                otype: "block",
                oid: ExplorerBlockId,
                version: 1,
                meta: {
                    view: "preview",
                    connection: "local",
                    file: ExplorerFilePath,
                    "preview:directory-display": "tree",
                    "preview:explorer-root": ExplorerRootPath,
                    "preview:open-target": "off",
                },
            } as Block,
        },
        services: {
            object: {
                async UpdateObjectMeta(oref: string, meta: MetaType) {
                    const objAtom = explorerEnv.wos.getWaveObjectAtom<Block>(oref);
                    const current = globalStore.get(objAtom);
                    const nextMeta = { ...(current?.meta ?? {}) };
                    for (const [key, value] of Object.entries(meta ?? {})) {
                        if (value === null) {
                            delete nextMeta[key];
                        } else {
                            nextMeta[key] = value;
                        }
                    }
                    explorerEnv.mockSetWaveObj(oref, {
                        ...current,
                        meta: nextMeta,
                    });
                },
            },
        },
    });
    return explorerEnv;
}

export function ExplorerPreview() {
    const baseEnv = useWaveEnv<MockWaveEnv>();
    const envRef = useRef<MockWaveEnv>(null);
    if (envRef.current == null) {
        envRef.current = makeExplorerEnv(baseEnv);
    }

    const nodeModel = useMemo(
        () =>
            makeMockNodeModel({
                nodeId: PreviewNodeId,
                blockId: ExplorerBlockId,
                innerRect: { width: "1180px", height: "720px" },
            }),
        []
    );

    return (
        <WaveEnvContext.Provider value={envRef.current}>
            <TabModelContext.Provider value={getTabModelByTabId(PreviewTabId, envRef.current)}>
                <div className="flex w-full max-w-[1260px] flex-col gap-3 px-6 py-6">
                    <div className="text-xs text-muted font-mono">
                        explorer preview • root: {ExplorerRootPath} • file: {ExplorerFilePath}
                    </div>
                    <div className="rounded-md border border-border bg-panel p-4">
                        <div className="h-[780px]">
                            <Block preview={false} nodeModel={nodeModel} />
                        </div>
                    </div>
                </div>
            </TabModelContext.Provider>
        </WaveEnvContext.Provider>
    );
}

export default ExplorerPreview;
