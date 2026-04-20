// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { ContextMenuModel } from "@/app/store/contextmenu";
import { globalStore } from "@/app/store/jotaiStore";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { TreeNodeData, TreeView } from "@/app/treeview/treeview";
import { useWaveEnv } from "@/app/waveenv/waveenv";
import { fireAndForget, makeConnRoute } from "@/util/util";
import { offset, useDismiss, useFloating, useInteractions } from "@floating-ui/react";
import clsx from "clsx";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { startTransition, useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
import { EntryManagerOverlay, EntryManagerOverlayProps, EntryManagerType } from "./entry-manager";
import {
    handleRename,
    makeDirectoryBackgroundMenuItems,
    makeDirectoryEntryMenuItems,
} from "./preview-directory-utils";
import type { PreviewModel } from "./preview-model";
import type { PreviewEnv } from "./previewenv";

const TreeFetchLimit = 1024;
const TreeMaxEntries = 500;
const SearchMinLength = 2;
const SearchDebounceMs = 350;
const SearchLimit = 500;
const SearchMaxFileSize = 1024 * 1024;

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

function toTreeNode(fileInfo: FileInfo, parentId: string, directoryIconColor: string): TreeNodeData {
    return {
        id: fileInfo.path,
        parentId,
        path: fileInfo.path,
        label: fileInfo.name,
        isDirectory: fileInfo.isdir,
        mimeType: fileInfo.mimetype,
        iconColor: fileInfo.isdir ? directoryIconColor : undefined,
        isReadonly: fileInfo.readonly,
        notfound: fileInfo.notfound,
        staterror: fileInfo.staterror,
    };
}

function groupSearchMatches(matches: FileSearchMatch[]): { path: string; relPath: string; matches: FileSearchMatch[] }[] {
    const groups = new Map<string, { path: string; relPath: string; matches: FileSearchMatch[] }>();
    for (const match of matches) {
        const current = groups.get(match.path);
        if (current) {
            current.matches.push(match);
            continue;
        }
        groups.set(match.path, {
            path: match.path,
            relPath: match.relpath ?? match.path,
            matches: [match],
        });
    }
    return Array.from(groups.values());
}

function resultSnippet(lineText: string): string {
    const trimmed = lineText.trim();
    return trimmed === "" ? "(blank line)" : trimmed;
}

function getPathLeaf(path: string): string {
    return path.split("/").filter(Boolean).pop() ?? path;
}

function treeNodeToFileInfo(node: TreeNodeData): FileInfo {
    const path = node.path ?? node.id;
    return {
        name: node.label ?? getPathLeaf(path),
        path,
        dir: node.parentId,
        isdir: node.isDirectory,
        mimetype: node.isDirectory ? "directory" : node.mimeType,
        readonly: node.isReadonly,
        notfound: node.notfound,
        staterror: node.staterror,
    };
}

interface PreviewExplorerProps {
    model: PreviewModel;
    rootPath: string;
}

function PreviewExplorer({ model, rootPath }: PreviewExplorerProps) {
    const env = useWaveEnv<PreviewEnv>();
    const fullConfig = useAtomValue(env.atoms.fullConfigAtom);
    const showHiddenFiles = useAtomValue(model.showHiddenFiles);
    const refreshVersion = useAtomValue(model.refreshVersion);
    const currentPath = useAtomValue(model.statFilePath);
    const connection = useAtomValue(model.connection);
    const currentDirectoryInfo = useAtomValue(model.statFile);
    const setErrorMsg = useSetAtom(model.errorMsgAtom);
    const [searchActive, setSearchActive] = useAtom(model.directorySearchActive);
    const [searchQuery, setSearchQuery] = useState("");
    const [searching, setSearching] = useState(false);
    const [searchResults, setSearchResults] = useState<FileSearchMatch[]>([]);
    const [searchError, setSearchError] = useState<string | null>(null);
    const [searchTruncated, setSearchTruncated] = useState(false);
    const [collapsedSearchPaths, setCollapsedSearchPaths] = useState<Set<string>>(() => new Set());
    const [entryManagerProps, setEntryManagerProps] = useState<EntryManagerOverlayProps | null>(null);
    const directoryIconColor = fullConfig?.mimetypes?.directory?.color ?? "var(--term-bright-blue)";

    const initialNodes = useMemo(
        () => ({
            [rootPath]: {
                id: rootPath,
                path: rootPath,
                label: normalizeRootLabel(rootPath),
                isDirectory: true,
                iconColor: directoryIconColor,
                childrenStatus: "unloaded" as const,
            },
        }),
        [directoryIconColor, rootPath]
    );
    const rootIds = useMemo(() => [rootPath], [rootPath]);
    const defaultExpandedIds = useMemo(() => [rootPath], [rootPath]);
    const groupedResults = useMemo(() => groupSearchMatches(searchResults), [searchResults]);
    const route = useMemo(() => makeConnRoute(connection), [connection]);
    const { refs, floatingStyles, context } = useFloating({
        open: !!entryManagerProps,
        onOpenChange: () => setEntryManagerProps(null),
        middleware: [offset(({ rects }) => -rects.reference.height / 2 - rects.floating.height / 2)],
    });
    const dismiss = useDismiss(context);
    const { getReferenceProps, getFloatingProps } = useInteractions([dismiss]);

    useEffect(() => {
        const activePaths = new Set(groupedResults.map((group) => group.path));
        setCollapsedSearchPaths((prev) => {
            let changed = false;
            const next = new Set<string>();
            prev.forEach((path) => {
                if (activePaths.has(path)) {
                    next.add(path);
                } else {
                    changed = true;
                }
            });
            if (!changed && next.size === prev.size) {
                return prev;
            }
            return next;
        });
    }, [groupedResults]);

    useEffect(() => {
        model.refreshCallback = () => {
            globalStore.set(model.refreshVersion, (v) => v + 1);
        };
        return () => {
            model.refreshCallback = null;
        };
    }, [model]);

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
                nodes: visibleEntries.slice(0, limit).map((entry) => toTreeNode(entry, id, directoryIconColor)),
                capped: visibleEntries.length > limit,
                totalKnown: visibleEntries.length,
            };
        },
        [directoryIconColor, env.rpc, model, showHiddenFiles]
    );

    const openCreateFile = useCallback(
        (targetDir: string) => {
            setEntryManagerProps({
                entryManagerType: EntryManagerType.NewFile,
                onSave: (newName: string) => {
                    fireAndForget(async () => {
                        await env.rpc.FileCreateCommand(
                            TabRpcClient,
                            {
                                info: {
                                    path: await model.formatRemoteUri(`${targetDir}/${newName}`, globalStore.get),
                                },
                            },
                            null
                        );
                        model.refreshCallback();
                    });
                    setEntryManagerProps(null);
                },
            });
        },
        [env.rpc, model]
    );

    const openCreateDirectory = useCallback(
        (targetDir: string) => {
            setEntryManagerProps({
                entryManagerType: EntryManagerType.NewDirectory,
                onSave: (newName: string) => {
                    fireAndForget(async () => {
                        await env.rpc.FileMkdirCommand(TabRpcClient, {
                            info: {
                                path: await model.formatRemoteUri(`${targetDir}/${newName}`, globalStore.get),
                            },
                        });
                        model.refreshCallback();
                    });
                    setEntryManagerProps(null);
                },
            });
        },
        [env.rpc, model]
    );

    const openRename = useCallback(
        (path: string, isDir: boolean) => {
            const fileName = getPathLeaf(path);
            setEntryManagerProps({
                entryManagerType: EntryManagerType.EditName,
                startingValue: fileName,
                onSave: (newName: string) => {
                    if (newName !== fileName) {
                        const lastInstance = path.lastIndexOf(fileName);
                        const newPath = path.substring(0, lastInstance) + newName;
                        handleRename(model, path, newPath, isDir, setErrorMsg);
                    }
                    setEntryManagerProps(null);
                },
            });
        },
        [model, setErrorMsg]
    );

    const handleTreeNodeContextMenu = useCallback(
        async (event: MouseEvent<HTMLDivElement>, _id: string, node: TreeNodeData) => {
            const finfo = treeNodeToFileInfo(node);
            const targetDir = finfo.isdir ? finfo.path : finfo.dir ?? rootPath;
            const menu = await makeDirectoryEntryMenuItems(model, finfo, connection, setErrorMsg, {
                newFile: () => openCreateFile(targetDir),
                newDirectory: () => openCreateDirectory(targetDir),
                rename: () => openRename(finfo.path, finfo.isdir),
            });
            ContextMenuModel.getInstance().showContextMenu(menu, event);
        },
        [connection, model, openCreateDirectory, openCreateFile, openRename, rootPath, setErrorMsg]
    );

    const handleTreeBackgroundContextMenu = useCallback(
        async (event: MouseEvent<HTMLDivElement>) => {
            event.preventDefault();
            event.stopPropagation();
            if (!currentDirectoryInfo) {
                return;
            }
            const menu = await makeDirectoryBackgroundMenuItems(model, connection, currentDirectoryInfo, setErrorMsg, {
                newFile: () => openCreateFile(rootPath),
                newDirectory: () => openCreateDirectory(rootPath),
            });
            ContextMenuModel.getInstance().showContextMenu(menu, event);
        },
        [connection, currentDirectoryInfo, model, openCreateDirectory, openCreateFile, rootPath, setErrorMsg]
    );

    useEffect(() => {
        if (!searchActive) {
            return;
        }
        const query = searchQuery.trim();
        if (query.length < SearchMinLength) {
            startTransition(() => {
                setSearching(false);
                setSearchResults([]);
                setSearchError(null);
                setSearchTruncated(false);
            });
            return;
        }

        let cancelled = false;
        let stream: AsyncGenerator<CommandRemoteFileSearchRtnData, void, boolean> = null;
        const timeoutId = window.setTimeout(() => {
            void (async () => {
                startTransition(() => {
                    setSearching(true);
                    setSearchResults([]);
                    setSearchError(null);
                    setSearchTruncated(false);
                });
                try {
                    stream = env.rpc.RemoteFileSearchStreamCommand(
                        TabRpcClient,
                        {
                            path: rootPath,
                            query,
                            limit: SearchLimit,
                            maxfilesize: SearchMaxFileSize,
                            includehidden: showHiddenFiles,
                        },
                        { route }
                    );
                    for await (const chunk of stream) {
                        if (cancelled) {
                            break;
                        }
                        startTransition(() => {
                            if (chunk?.matches?.length) {
                                setSearchResults((prev) => [...prev, ...chunk.matches]);
                            }
                            if (chunk?.truncated) {
                                setSearchTruncated(true);
                            }
                        });
                    }
                } catch (err) {
                    if (!cancelled) {
                        startTransition(() => {
                            setSearchError(`${err}`);
                        });
                    }
                } finally {
                    if (!cancelled) {
                        startTransition(() => {
                            setSearching(false);
                        });
                    }
                }
            })();
        }, SearchDebounceMs);

        return () => {
            cancelled = true;
            window.clearTimeout(timeoutId);
            fireAndForget(async () => {
                await stream?.return?.(undefined);
            });
        };
    }, [env.rpc, rootPath, route, searchActive, searchQuery, showHiddenFiles]);

    const treeKey = `${rootPath}:${showHiddenFiles ? "show" : "hide"}:${refreshVersion}:${connection ?? ""}`;

    return (
        <div
            ref={refs.setReference}
            className="flex h-full flex-col overflow-hidden"
            {...getReferenceProps()}
            onClick={() => setEntryManagerProps(null)}
        >
            <div className="flex items-center gap-1 border-b border-white/8 px-2 py-1.5">
                <button
                    className={clsx(
                        "rounded-md px-2 py-1 text-[11px] font-[600] transition-colors",
                        !searchActive ? "bg-white/10 text-white" : "text-muted hover:bg-white/5"
                    )}
                    onClick={() => setSearchActive(false)}
                >
                    Explorer
                </button>
                <button
                    className={clsx(
                        "rounded-md px-2 py-1 text-[11px] font-[600] transition-colors",
                        searchActive ? "bg-white/10 text-white" : "text-muted hover:bg-white/5"
                    )}
                    onClick={() => setSearchActive(true)}
                >
                    Search
                </button>
            </div>
            <div className="relative flex-1 overflow-hidden p-2">
                <div className={clsx("absolute inset-2", searchActive && "hidden")}>
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
                        expandDirectoriesOnSingleClick={true}
                        onOpenFile={(id) => {
                            fireAndForget(() => model.openPathWithTarget(id));
                        }}
                        onNodeContextMenu={handleTreeNodeContextMenu}
                        onBackgroundContextMenu={handleTreeBackgroundContextMenu}
                    />
                </div>
                <div
                    className={clsx(
                        "absolute inset-2 flex h-full flex-col overflow-hidden rounded-md border border-border bg-panel",
                        !searchActive && "hidden"
                    )}
                >
                        <div className="border-b border-white/8 px-2 py-2">
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder={`Search contents in ${normalizeRootLabel(rootPath)}`}
                                className="w-full rounded-md border border-white/10 bg-transparent px-2 py-1.5 text-[12px] outline-none transition-colors focus:border-[var(--accent-color)]"
                            />
                            <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted">
                                <span>{searching ? "Searching..." : `${searchResults.length} matches`}</span>
                                {searchTruncated && <span>Showing first {SearchLimit} matches</span>}
                            </div>
                        </div>
                        <div className="flex-1 overflow-y-auto px-2 py-2">
                            {searchError ? (
                                <div className="rounded-md border border-red-500/20 bg-red-500/5 px-2 py-2 text-[12px] text-red-200">
                                    {searchError}
                                </div>
                            ) : searchQuery.trim().length < SearchMinLength ? (
                                <div className="px-1 py-3 text-[12px] text-muted">
                                    Type at least {SearchMinLength} characters to search file contents.
                                </div>
                            ) : !searching && groupedResults.length === 0 ? (
                                <div className="px-1 py-3 text-[12px] text-muted">No matches found.</div>
                            ) : (
                                groupedResults.map((group) => (
                                    <div key={group.path} className="mb-3 last:mb-0">
                                        <button
                                            className={clsx(
                                                "flex w-full items-center gap-2 rounded-md px-1 py-1 text-left transition-colors",
                                                currentPath === group.path ? "bg-white/10" : "hover:bg-white/5"
                                            )}
                                            onClick={() => {
                                                setCollapsedSearchPaths((prev) => {
                                                    const next = new Set(prev);
                                                    if (next.has(group.path)) {
                                                        next.delete(group.path);
                                                    } else {
                                                        next.add(group.path);
                                                    }
                                                    return next;
                                                });
                                            }}
                                        >
                                            <i
                                                className={clsx(
                                                    "fa-sharp fa-solid w-3 text-[10px] text-muted",
                                                    collapsedSearchPaths.has(group.path) ? "fa-chevron-right" : "fa-chevron-down"
                                                )}
                                            />
                                            <span className="truncate flex-1 text-[11px] font-[600] text-muted">
                                                {group.relPath}
                                            </span>
                                            <span className="shrink-0 text-[10px] text-muted">
                                                {group.matches.length} match{group.matches.length === 1 ? "" : "es"}
                                            </span>
                                        </button>
                                        {!collapsedSearchPaths.has(group.path) && (
                                            <div className="mt-1 space-y-1">
                                                {group.matches.map((match) => (
                                                    <button
                                                        key={`${match.path}:${match.linenumber}:${match.linetext}`}
                                                        className={clsx(
                                                            "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                                                            currentPath === match.path ? "bg-white/10" : "hover:bg-white/5"
                                                        )}
                                                        onClick={() => {
                                                            fireAndForget(() =>
                                                                model.openPathWithTarget(match.path, {
                                                                    lineNumber: match.linenumber,
                                                                })
                                                            );
                                                        }}
                                                    >
                                                        <span className="min-w-[2.5rem] text-[11px] font-[600] text-[var(--accent-color)]">
                                                            {match.linenumber}
                                                        </span>
                                                        <span className="truncate text-[12px]">{resultSnippet(match.linetext)}</span>
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                ))
                            )}
                    </div>
                </div>
            </div>
            {entryManagerProps && (
                <EntryManagerOverlay
                    {...entryManagerProps}
                    forwardRef={refs.setFloating}
                    style={floatingStyles}
                    getReferenceProps={getFloatingProps}
                    onCancel={() => setEntryManagerProps(null)}
                />
            )}
        </div>
    );
}

export { PreviewExplorer };
