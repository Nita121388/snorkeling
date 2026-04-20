// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { TreeNodeData, TreeView } from "@/app/treeview/treeview";
import { useWaveEnv } from "@/app/waveenv/waveenv";
import { fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { useCallback, useMemo } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import type { PreviewModel } from "./preview-model";
import type { PreviewEnv } from "./previewenv";

const TreeFetchLimit = 1024;
const TreePaneDefaultSize = 28;
const TreePaneMinSize = 16;
const TreePaneMaxSize = 45;
const TreeMaxEntries = 500;

function normalizeRootLabel(path: string): string {
    if (path === "/" || path === "~") {
        return path;
    }
    const trimmedPath = path.endsWith("/") && path !== "/" ? path.slice(0, -1) : path;
    const chunks = trimmedPath.split("/").filter(Boolean);
    return chunks[chunks.length - 1] ?? trimmedPath;
}

function isHiddenEntry(fileInfo: FileInfo): boolean {
    return fileInfo.name?.startsWith(".") ?? false;
}

function toTreeNode(fileInfo: FileInfo, parentId: string): TreeNodeData {
    return {
        id: fileInfo.path,
        parentId,
        path: fileInfo.path,
        label: fileInfo.name,
        isDirectory: fileInfo.isdir,
        mimeType: fileInfo.mimetype,
        isReadonly: fileInfo.readonly,
        notfound: fileInfo.notfound,
        staterror: fileInfo.staterror,
    };
}

interface PreviewExplorerProps {
    model: PreviewModel;
    rootPath: string;
    children: React.ReactNode;
}

function PreviewExplorer({ model, rootPath, children }: PreviewExplorerProps) {
    const env = useWaveEnv<PreviewEnv>();
    const showHiddenFiles = useAtomValue(model.showHiddenFiles);
    const refreshVersion = useAtomValue(model.refreshVersion);
    const currentPath = useAtomValue(model.statFilePath);
    const connection = useAtomValue(model.connection);

    const initialNodes = useMemo(
        () => ({
            [rootPath]: {
                id: rootPath,
                path: rootPath,
                label: normalizeRootLabel(rootPath),
                isDirectory: true,
                childrenStatus: "unloaded" as const,
            },
        }),
        [rootPath]
    );
    const rootIds = useMemo(() => [rootPath], [rootPath]);
    const defaultExpandedIds = useMemo(() => [rootPath], [rootPath]);

    const fetchDir = useCallback(
        async (id: string, limit: number) => {
            const remotePath = await model.formatRemoteUri(id, globalStore.get);
            const entries: FileInfo[] = [];
            const stream = env.rpc.FileListStreamCommand(
                TabRpcClient,
                {
                    path: remotePath,
                    opts: {
                        limit: TreeFetchLimit,
                    },
                },
                null
            );
            for await (const chunk of stream) {
                if (chunk?.fileinfo) {
                    entries.push(...chunk.fileinfo);
                }
            }
            const visibleEntries = showHiddenFiles ? entries : entries.filter((entry) => !isHiddenEntry(entry));
            return {
                nodes: visibleEntries.slice(0, limit).map((entry) => toTreeNode(entry, id)),
                capped: visibleEntries.length > limit,
                totalKnown: visibleEntries.length,
            };
        },
        [env.rpc, model, showHiddenFiles]
    );

    const treeKey = `${rootPath}:${showHiddenFiles ? "show" : "hide"}:${refreshVersion}:${connection ?? ""}`;

    return (
        <PanelGroup direction="horizontal" className="h-full">
            <Panel defaultSize={TreePaneDefaultSize} minSize={TreePaneMinSize} maxSize={TreePaneMaxSize}>
                <div className="h-full overflow-hidden pr-1">
                    <TreeView
                        key={treeKey}
                        rootIds={rootIds}
                        initialNodes={initialNodes}
                        fetchDir={fetchDir}
                        defaultExpandedIds={defaultExpandedIds}
                        selectedId={currentPath}
                        height="100%"
                        width="100%"
                        minWidth={160}
                        maxWidth={9999}
                        maxDirEntries={TreeMaxEntries}
                        className="h-full"
                        onOpenFile={(id) => {
                            fireAndForget(() => model.openPathWithTarget(id));
                        }}
                    />
                </div>
            </Panel>
            <PanelResizeHandle className="w-0.5 bg-transparent hover:bg-gray-500/20 transition-colors" />
            <Panel minSize={35}>
                <div className="h-full overflow-hidden pl-1">{children}</div>
            </Panel>
        </PanelGroup>
    );
}

export { PreviewExplorer };
