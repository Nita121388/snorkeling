// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { appendBlockMoveMenuItems, useBlockMoveMenuItems } from "@/app/block/block-move-menu";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { globalStore } from "@/app/store/jotaiStore";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { TreeNodeData, TreeView } from "@/app/treeview/treeview";
import { useWaveEnv } from "@/app/waveenv/waveenv";
import { checkKeyPressed, isCharacterKeyEvent } from "@/util/keyutil";
import { fireAndForget, makeConnRoute } from "@/util/util";
import { offset, useDismiss, useFloating, useInteractions } from "@floating-ui/react";
import clsx from "clsx";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { startTransition, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { EntryManagerOverlay, EntryManagerOverlayProps, EntryManagerType } from "./entry-manager";
import { handleRename, makeDirectoryBackgroundMenuItems, makeDirectoryEntryMenuItems } from "./preview-directory-utils";
import type { PreviewModel } from "./preview-model";
import { resolveExplorerRootPathForOpenInCurrentBlock } from "./preview-navigation";
import { openPreviewEntry } from "./preview-open";
import {
    FileNameSearchSkipDirNames,
    groupContentSearchMatches,
    matchesFileNameSearchQuery,
    shouldFallbackFileNameSearch,
    sortFileNameMatches,
} from "./preview-search";
import type { PreviewEnv } from "./previewenv";

const TreeFetchLimit = 1024;
const TreeMaxEntries = 500;
const SearchMinLength = 2;
const SearchLimit = 500;
const SearchMaxFileSize = 1024 * 1024;
const SearchAutoSubmitMs = 250;
const DirectoryAutoRefreshMs = 4000;

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
    const blockMoveMenuItems = useBlockMoveMenuItems();
    const [searchActive, setSearchActive] = useAtom(model.directorySearchActive);
    const [searchInput, setSearchInput] = useState("");
    const [searchQuery, setSearchQuery] = useState("");
    const [searchingContent, setSearchingContent] = useState(false);
    const [searchingNames, setSearchingNames] = useState(false);
    const [contentSearchResults, setContentSearchResults] = useState<FileSearchMatch[]>([]);
    const [nameSearchResults, setNameSearchResults] = useState<FileNameSearchMatch[]>([]);
    const [contentSearchError, setContentSearchError] = useState<string | null>(null);
    const [nameSearchError, setNameSearchError] = useState<string | null>(null);
    const [contentSearchTruncated, setContentSearchTruncated] = useState(false);
    const [nameSearchTruncated, setNameSearchTruncated] = useState(false);
    const [collapsedSearchPaths, setCollapsedSearchPaths] = useState<Set<string>>(() => new Set());
    const [entryManagerProps, setEntryManagerProps] = useState<EntryManagerOverlayProps | null>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const searchActiveRef = useRef(searchActive);
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
    const groupedContentResults = useMemo(
        () => groupContentSearchMatches(contentSearchResults),
        [contentSearchResults]
    );
    const sortedNameResults = useMemo(() => sortFileNameMatches(nameSearchResults), [nameSearchResults]);
    const searching = searchingContent || searchingNames;
    const totalSearchMatches = sortedNameResults.length + contentSearchResults.length;
    const draftSearchQuery = searchInput.trim();
    const submittedSearchQuery = searchQuery.trim();
    const searchInputPending = draftSearchQuery !== submittedSearchQuery;
    const canSubmitSearch = draftSearchQuery.length >= SearchMinLength && !searching;
    const route = useMemo(() => makeConnRoute(connection), [connection]);
    const { refs, floatingStyles, context } = useFloating({
        open: !!entryManagerProps,
        onOpenChange: () => setEntryManagerProps(null),
        middleware: [offset(({ rects }) => -rects.reference.height / 2 - rects.floating.height / 2)],
    });
    const dismiss = useDismiss(context);
    const { getReferenceProps, getFloatingProps } = useInteractions([dismiss]);

    const clearSearchResults = useCallback(() => {
        startTransition(() => {
            setSearchingContent(false);
            setSearchingNames(false);
            setContentSearchResults([]);
            setNameSearchResults([]);
            setContentSearchError(null);
            setNameSearchError(null);
            setContentSearchTruncated(false);
            setNameSearchTruncated(false);
        });
    }, []);

    const submitSearch = useCallback(() => {
        setSearchQuery(draftSearchQuery);
    }, [draftSearchQuery]);

    const clearSearch = useCallback(() => {
        setSearchInput("");
        setSearchQuery("");
        clearSearchResults();
    }, [clearSearchResults]);

    const closeSearch = useCallback(() => {
        searchActiveRef.current = false;
        clearSearch();
        setSearchActive(false);
    }, [clearSearch, setSearchActive]);

    const startDirectNameSearch = useCallback(
        (initialText: string) => {
            if (initialText.trim() === "") {
                return;
            }
            const shouldAppend = searchActiveRef.current;
            searchActiveRef.current = true;
            setSearchActive(true);
            setSearchInput((current) => `${shouldAppend ? current : ""}${initialText}`);
            setSearchQuery("");
            clearSearchResults();
        },
        [clearSearchResults, setSearchActive]
    );

    useEffect(() => {
        searchActiveRef.current = searchActive;
    }, [searchActive]);

    useEffect(() => {
        if (!searchActive) {
            return;
        }
        const timeoutId = window.setTimeout(() => {
            searchInputRef.current?.focus();
        }, 0);
        return () => window.clearTimeout(timeoutId);
    }, [searchActive]);

    useEffect(() => {
        if (!searchActive || draftSearchQuery.length < SearchMinLength || draftSearchQuery === submittedSearchQuery) {
            return;
        }
        const timeoutId = window.setTimeout(() => {
            setSearchQuery(draftSearchQuery);
        }, SearchAutoSubmitMs);
        return () => window.clearTimeout(timeoutId);
    }, [draftSearchQuery, searchActive, submittedSearchQuery]);

    useEffect(() => {
        model.directoryKeyDownHandler = (waveEvent: WaveKeyboardEvent): boolean => {
            if (checkKeyPressed(waveEvent, "Cmd:f")) {
                setSearchActive(true);
                return true;
            }
            if (checkKeyPressed(waveEvent, "Escape")) {
                if (!searchActive && searchInput === "" && searchQuery === "") {
                    return false;
                }
                closeSearch();
                return true;
            }
            if (isCharacterKeyEvent(waveEvent)) {
                startDirectNameSearch(waveEvent.key);
                return waveEvent.key.trim() !== "";
            }
            return false;
        };
        return () => {
            model.directoryKeyDownHandler = null;
        };
    }, [closeSearch, model, searchActive, searchInput, searchQuery, setSearchActive, startDirectNameSearch]);

    useEffect(() => {
        const activePaths = new Set(groupedContentResults.map((group) => group.path));
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
    }, [groupedContentResults]);

    useEffect(() => {
        model.refreshCallback = () => {
            globalStore.set(model.refreshVersion, (v) => v + 1);
        };
        return () => {
            model.refreshCallback = null;
        };
    }, [model]);

    useEffect(() => {
        if (!rootPath) {
            return;
        }
        const intervalId = window.setInterval(() => {
            if (document.visibilityState === "hidden") {
                return;
            }
            globalStore.set(model.refreshVersion, (v) => v + 1);
        }, DirectoryAutoRefreshMs);
        return () => {
            window.clearInterval(intervalId);
        };
    }, [model, rootPath]);

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
            const targetDir = finfo.isdir ? finfo.path : (finfo.dir ?? rootPath);
            const menu = await makeDirectoryEntryMenuItems(
                model,
                finfo,
                connection,
                setErrorMsg,
                {
                    newFile: () => openCreateFile(targetDir),
                    newDirectory: () => openCreateDirectory(targetDir),
                    rename: () => openRename(finfo.path, finfo.isdir),
                },
                {
                    relativePathRoot: rootPath,
                    openInCurrentBlock: () =>
                        model.goHistory(finfo.path, undefined, resolveExplorerRootPathForOpenInCurrentBlock(finfo)),
                }
            );
            ContextMenuModel.getInstance().showContextMenu(appendBlockMoveMenuItems(menu, blockMoveMenuItems), event);
        },
        [blockMoveMenuItems, connection, model, openCreateDirectory, openCreateFile, openRename, rootPath, setErrorMsg]
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
            ContextMenuModel.getInstance().showContextMenu(appendBlockMoveMenuItems(menu, blockMoveMenuItems), event);
        },
        [
            blockMoveMenuItems,
            connection,
            currentDirectoryInfo,
            model,
            openCreateDirectory,
            openCreateFile,
            rootPath,
            setErrorMsg,
        ]
    );

    const runNameSearchFallback = useCallback(
        async (query: string, limit: number, isCancelled: () => boolean) => {
            const matches: FileNameSearchMatch[] = [];
            let truncated = false;

            const walkDirectory = async (dirPath: string, relDir = "") => {
                if (isCancelled() || truncated) {
                    return;
                }
                const remotePath = await model.formatRemoteUri(dirPath, globalStore.get);
                const stream = env.rpc.FileListStreamCommand(
                    TabRpcClient,
                    {
                        path: remotePath,
                        opts: showHiddenFiles ? { all: true } : undefined,
                    },
                    null
                );
                const entries: FileInfo[] = [];
                for await (const chunk of stream) {
                    if (isCancelled() || truncated) {
                        await stream.return?.(undefined);
                        return;
                    }
                    if (chunk?.fileinfo) {
                        entries.push(...chunk.fileinfo);
                    }
                }
                for (const entry of entries) {
                    if (isCancelled() || truncated) {
                        return;
                    }
                    const name = entry.name ?? getPathLeaf(entry.path);
                    const isDirectory = !!entry.isdir;
                    if (!showHiddenFiles && isHiddenEntry(entry)) {
                        continue;
                    }
                    if (isDirectory && FileNameSearchSkipDirNames.has(name)) {
                        continue;
                    }
                    if (matchesFileNameSearchQuery(name, query)) {
                        matches.push({
                            path: entry.path,
                            relpath: relDir ? `${relDir}/${name}` : name,
                            isdir: isDirectory,
                        });
                        if (matches.length >= limit) {
                            truncated = true;
                            return;
                        }
                    }
                    if (isDirectory) {
                        await walkDirectory(entry.path, relDir ? `${relDir}/${name}` : name);
                    }
                }
            };

            await walkDirectory(rootPath);
            return { matches, truncated };
        },
        [env.rpc, model, rootPath, showHiddenFiles]
    );

    useEffect(() => {
        if (!searchActive) {
            return;
        }
        const query = submittedSearchQuery;
        if (query.length < SearchMinLength || searchInputPending) {
            clearSearchResults();
            return;
        }

        let cancelled = false;
        let contentStream: AsyncGenerator<CommandRemoteFileSearchRtnData, void, boolean> = null;
        let nameStream: AsyncGenerator<CommandRemoteFileNameSearchRtnData, void, boolean> = null;
        void (async () => {
            startTransition(() => {
                setSearchingContent(true);
                setSearchingNames(true);
                setContentSearchResults([]);
                setNameSearchResults([]);
                setContentSearchError(null);
                setNameSearchError(null);
                setContentSearchTruncated(false);
                setNameSearchTruncated(false);
            });

            const runContentSearch = async () => {
                try {
                    contentStream = env.rpc.RemoteFileSearchStreamCommand(
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
                    for await (const chunk of contentStream) {
                        if (cancelled) {
                            break;
                        }
                        startTransition(() => {
                            if (chunk?.matches?.length) {
                                setContentSearchResults((prev) => [...prev, ...chunk.matches]);
                            }
                            if (chunk?.truncated) {
                                setContentSearchTruncated(true);
                            }
                        });
                    }
                } catch (err) {
                    if (!cancelled) {
                        startTransition(() => {
                            setContentSearchError(`${err}`);
                        });
                    }
                } finally {
                    if (!cancelled) {
                        startTransition(() => {
                            setSearchingContent(false);
                        });
                    }
                }
            };

            const runNameSearch = async () => {
                try {
                    nameStream = env.rpc.RemoteFileNameSearchStreamCommand(
                        TabRpcClient,
                        {
                            path: rootPath,
                            query,
                            limit: SearchLimit,
                            includehidden: showHiddenFiles,
                        },
                        { route }
                    );
                    for await (const chunk of nameStream) {
                        if (cancelled) {
                            break;
                        }
                        startTransition(() => {
                            if (chunk?.matches?.length) {
                                setNameSearchResults((prev) => [...prev, ...chunk.matches]);
                            }
                            if (chunk?.truncated) {
                                setNameSearchTruncated(true);
                            }
                        });
                    }
                } catch (err) {
                    if (!cancelled && shouldFallbackFileNameSearch(err)) {
                        try {
                            const fallbackResult = await runNameSearchFallback(query, SearchLimit, () => cancelled);
                            if (!cancelled) {
                                startTransition(() => {
                                    setNameSearchResults(fallbackResult.matches);
                                    setNameSearchTruncated(fallbackResult.truncated);
                                    setNameSearchError(null);
                                });
                            }
                        } catch (fallbackErr) {
                            if (!cancelled) {
                                startTransition(() => {
                                    setNameSearchError(`${fallbackErr}`);
                                });
                            }
                        }
                    } else if (!cancelled) {
                        startTransition(() => {
                            setNameSearchError(`${err}`);
                        });
                    }
                } finally {
                    if (!cancelled) {
                        startTransition(() => {
                            setSearchingNames(false);
                        });
                    }
                }
            };

            await Promise.allSettled([runNameSearch(), runContentSearch()]);
        })();

        return () => {
            cancelled = true;
            fireAndForget(async () => {
                await Promise.allSettled([contentStream?.return?.(undefined), nameStream?.return?.(undefined)]);
            });
        };
    }, [
        clearSearchResults,
        env.rpc,
        rootPath,
        route,
        runNameSearchFallback,
        searchActive,
        searchInputPending,
        showHiddenFiles,
        submittedSearchQuery,
    ]);

    const treeKey = `${rootPath}:${connection ?? ""}`;
    const treeRefreshKey = `${refreshVersion}:${showHiddenFiles ? "show" : "hide"}`;

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
                        refreshKey={treeRefreshKey}
                        defaultExpandedIds={defaultExpandedIds}
                        selectedId={currentPath}
                        height="100%"
                        width="100%"
                        minWidth={160}
                        maxWidth={9999}
                        maxDirEntries={TreeMaxEntries}
                        className="h-full"
                        expandDirectoriesOnSingleClick={true}
                        onOpenFile={(_id, node, event) => {
                            fireAndForget(() =>
                                openPreviewEntry(model, treeNodeToFileInfo(node), connection, {
                                    forceNewBlock: event.ctrlKey || event.metaKey,
                                })
                            );
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
                        <div className="flex items-center gap-1">
                            <input
                                ref={searchInputRef}
                                type="text"
                                value={searchInput}
                                onChange={(e) => {
                                    setSearchInput(e.target.value);
                                    if (searchQuery !== "") {
                                        setSearchQuery("");
                                    }
                                }}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                        e.preventDefault();
                                        submitSearch();
                                    } else if (e.key === "Escape") {
                                        e.preventDefault();
                                        closeSearch();
                                    }
                                }}
                                placeholder={`Search names and contents in ${normalizeRootLabel(rootPath)}`}
                                className="min-w-0 flex-1 rounded-md border border-white/10 bg-transparent px-2 py-1.5 text-[12px] outline-none transition-colors focus:border-[var(--accent-color)]"
                            />
                            <button
                                type="button"
                                title="Search"
                                disabled={!canSubmitSearch}
                                onClick={submitSearch}
                                className={clsx(
                                    "flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-md border border-white/10 text-[11px] transition-colors",
                                    canSubmitSearch
                                        ? "text-white hover:border-[var(--accent-color)] hover:bg-white/5"
                                        : "cursor-default text-muted opacity-50"
                                )}
                            >
                                <i className="fa-sharp fa-solid fa-magnifying-glass" />
                            </button>
                        </div>
                        <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted">
                            <span>
                                {searching
                                    ? "Searching..."
                                    : draftSearchQuery.length >= SearchMinLength && searchInputPending
                                      ? "Searching shortly"
                                      : submittedSearchQuery.length >= SearchMinLength
                                        ? `${totalSearchMatches} matches`
                                        : "Search on Enter"}
                            </span>
                            <span>
                                {sortedNameResults.length} names, {contentSearchResults.length} content matches
                            </span>
                        </div>
                    </div>
                    <div className="flex-1 overflow-y-auto px-2 py-2">
                        {draftSearchQuery.length < SearchMinLength ? (
                            <div className="px-1 py-3 text-[12px] text-muted">
                                Type at least {SearchMinLength} characters to search file names and contents.
                            </div>
                        ) : searchInputPending ? (
                            <div className="px-1 py-3 text-[12px] text-muted">
                                Searching file names and contents shortly.
                            </div>
                        ) : !searching &&
                          sortedNameResults.length === 0 &&
                          groupedContentResults.length === 0 &&
                          !nameSearchError &&
                          !contentSearchError ? (
                            <div className="px-1 py-3 text-[12px] text-muted">No matches found.</div>
                        ) : (
                            <>
                                {nameSearchError && (
                                    <div className="mb-3 rounded-md border border-red-500/20 bg-red-500/5 px-2 py-2 text-[12px] text-red-200">
                                        File name search failed: {nameSearchError}
                                    </div>
                                )}
                                {sortedNameResults.length > 0 && (
                                    <div className="mb-4">
                                        <div className="mb-2 flex items-center justify-between gap-2 px-1 text-[11px] font-[600] uppercase tracking-[0.08em] text-muted">
                                            <span>Name matches</span>
                                            {nameSearchTruncated && <span>Showing first {SearchLimit}</span>}
                                        </div>
                                        <div className="space-y-1">
                                            {sortedNameResults.map((match) => {
                                                const displayPath = match.relpath ?? match.path;
                                                const displayName = getPathLeaf(displayPath);
                                                return (
                                                    <button
                                                        key={match.path}
                                                        className={clsx(
                                                            "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                                                            currentPath === match.path
                                                                ? "bg-white/10"
                                                                : "hover:bg-white/5"
                                                        )}
                                                        onClick={(event) => {
                                                            fireAndForget(() =>
                                                                model.openPathWithTarget(match.path, {
                                                                    forceNewBlock: event.ctrlKey || event.metaKey,
                                                                })
                                                            );
                                                        }}
                                                    >
                                                        <i
                                                            className={clsx(
                                                                "fa-sharp fa-solid w-3 shrink-0 pt-[2px] text-[11px]",
                                                                match.isdir ? "fa-folder" : "fa-file"
                                                            )}
                                                            style={{
                                                                color: match.isdir ? directoryIconColor : undefined,
                                                            }}
                                                        />
                                                        <div className="min-w-0 flex-1">
                                                            <div className="truncate text-[12px] font-[600]">
                                                                {displayName}
                                                            </div>
                                                            <div className="truncate text-[10px] text-muted">
                                                                {displayPath}
                                                            </div>
                                                        </div>
                                                        <span className="shrink-0 pt-[2px] text-[10px] text-muted">
                                                            {match.isdir ? "Folder" : "File"}
                                                        </span>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                                {contentSearchError && (
                                    <div className="mb-3 rounded-md border border-red-500/20 bg-red-500/5 px-2 py-2 text-[12px] text-red-200">
                                        File content search failed: {contentSearchError}
                                    </div>
                                )}
                                {groupedContentResults.length > 0 && (
                                    <div>
                                        <div className="mb-2 flex items-center justify-between gap-2 px-1 text-[11px] font-[600] uppercase tracking-[0.08em] text-muted">
                                            <span>Content matches</span>
                                            {contentSearchTruncated && <span>Showing first {SearchLimit}</span>}
                                        </div>
                                        {groupedContentResults.map((group) => (
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
                                                            collapsedSearchPaths.has(group.path)
                                                                ? "fa-chevron-right"
                                                                : "fa-chevron-down"
                                                        )}
                                                    />
                                                    <span className="truncate flex-1 text-[11px] font-[600] text-muted">
                                                        {group.relPath}
                                                    </span>
                                                    <span className="shrink-0 text-[10px] text-muted">
                                                        {group.matches.length} match
                                                        {group.matches.length === 1 ? "" : "es"}
                                                    </span>
                                                </button>
                                                {!collapsedSearchPaths.has(group.path) && (
                                                    <div className="mt-1 space-y-1">
                                                        {group.matches.map((match) => (
                                                            <button
                                                                key={`${match.path}:${match.linenumber}:${match.linetext}`}
                                                                className={clsx(
                                                                    "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                                                                    currentPath === match.path
                                                                        ? "bg-white/10"
                                                                        : "hover:bg-white/5"
                                                                )}
                                                                onClick={(event) => {
                                                                    fireAndForget(() =>
                                                                        model.openPathWithTarget(match.path, {
                                                                            lineNumber: match.linenumber,
                                                                            forceNewBlock:
                                                                                event.ctrlKey || event.metaKey,
                                                                        })
                                                                    );
                                                                }}
                                                            >
                                                                <span className="min-w-[2.5rem] text-[11px] font-[600] text-[var(--accent-color)]">
                                                                    {match.linenumber}
                                                                </span>
                                                                <span className="truncate text-[12px]">
                                                                    {resultSnippet(match.linetext)}
                                                                </span>
                                                            </button>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </>
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
