// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { appendBlockMoveMenuItems, useBlockMoveMenuItems } from "@/app/block/block-move-menu";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { globalStore } from "@/app/store/jotaiStore";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { useWaveEnv } from "@/app/waveenv/waveenv";
import { checkKeyPressed, isCharacterKeyEvent } from "@/util/keyutil";
import { PLATFORM, PlatformMacOS } from "@/util/platformutil";
import { fireAndForget } from "@/util/util";
import { formatRemoteUri } from "@/util/waveutil";
import { offset, useDismiss, useFloating, useInteractions } from "@floating-ui/react";
import {
    Header,
    Row,
    RowData,
    Table,
    createColumnHelper,
    flexRender,
    getCoreRowModel,
    getSortedRowModel,
    useReactTable,
} from "@tanstack/react-table";
import clsx from "clsx";
import { PrimitiveAtom, atom, useAtom, useAtomValue, useSetAtom } from "jotai";
import { OverlayScrollbarsComponent, OverlayScrollbarsComponentRef } from "overlayscrollbars-react";
import React, { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDrag, useDrop } from "react-dnd";
import { debounce } from "throttle-debounce";
import "./directorypreview.scss";
import { EntryManagerOverlay, EntryManagerOverlayProps, EntryManagerType } from "./entry-manager";
import {
    cleanMimetype,
    getBestUnit,
    getLastModifiedTime,
    getSortIcon,
    handleMoveTo,
    handleRename,
    isIconValid,
    makeDirectoryBackgroundMenuItems,
    makeDirectoryEntryMenuItems,
    mergeError,
    overwriteError,
} from "./preview-directory-utils";
import { copyPreviewFileItems, getPreviewFileClipboard, pastePreviewFileItems } from "./preview-file-clipboard";
import { type PreviewModel } from "./preview-model";
import { resolveExplorerRootPathForOpenInCurrentBlock } from "./preview-navigation";
import { openPreviewEntry } from "./preview-open";
import { isWindowsDrivesPath } from "./preview-windows-drives";
import type { PreviewEnv } from "./previewenv";

const PageJumpSize = 20;

interface DirectoryTableHeaderCellProps {
    header: Header<FileInfo, unknown>;
}

function DirectoryTableHeaderCell({ header }: DirectoryTableHeaderCellProps) {
    return (
        <div
            className="dir-table-head-cell"
            key={header.id}
            style={{ width: `calc(var(--header-${header.id}-size) * 1px)` }}
        >
            <div className="dir-table-head-cell-content" onClick={() => header.column.toggleSorting()}>
                {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                {getSortIcon(header.column.getIsSorted())}
            </div>
            <div className="dir-table-head-resize-box">
                <div
                    className="dir-table-head-resize"
                    onMouseDown={header.getResizeHandler()}
                    onTouchStart={header.getResizeHandler()}
                />
            </div>
        </div>
    );
}

declare module "@tanstack/react-table" {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    interface TableMeta<TData extends RowData> {
        updateName: (path: string, isDir: boolean) => void;
        newFile: () => void;
        newDirectory: () => void;
        moveToOpen: (fileInfos: FileInfo[]) => void;
    }
}

interface DirectoryTableProps {
    model: PreviewModel;
    data: FileInfo[];
    search: string;
    focusIndex: number;
    setFocusIndex: (_: number) => void;
    setSearch: (_: string) => void;
    setSelectedPath: (_: string) => void;
    selectedPaths: Set<string>;
    setSelectedPaths: React.Dispatch<React.SetStateAction<Set<string>>>;
    entryManagerOverlayPropsAtom: PrimitiveAtom<EntryManagerOverlayProps>;
    newFile: () => void;
    newDirectory: () => void;
}

const columnHelper = createColumnHelper<FileInfo>();

function DirectoryTable({
    model,
    data,
    search,
    focusIndex,
    setFocusIndex,
    setSearch,
    setSelectedPath,
    selectedPaths,
    setSelectedPaths,
    entryManagerOverlayPropsAtom,
    newFile,
    newDirectory,
}: DirectoryTableProps) {
    const env = useWaveEnv<PreviewEnv>();
    const fullConfig = useAtomValue(env.atoms.fullConfigAtom);
    const defaultSort = useAtomValue(env.getSettingsKeyAtom("preview:defaultsort")) ?? "name";
    const setErrorMsg = useSetAtom(model.errorMsgAtom);
    const getIconFromMimeType = useCallback(
        (mimeType: string): string => {
            while (mimeType.length > 0) {
                const icon = fullConfig.mimetypes?.[mimeType]?.icon ?? null;
                if (isIconValid(icon)) {
                    return `fa fa-solid fa-${icon} fa-fw`;
                }
                mimeType = mimeType.slice(0, -1);
            }
            return "fa fa-solid fa-file fa-fw";
        },
        [fullConfig.mimetypes]
    );
    const getIconColor = useCallback(
        (mimeType: string): string => fullConfig.mimetypes?.[mimeType]?.color ?? "inherit",
        [fullConfig.mimetypes]
    );
    const columns = useMemo(
        () => [
            columnHelper.accessor("mimetype", {
                cell: (info) => (
                    <i
                        className={getIconFromMimeType(info.getValue() ?? "")}
                        style={{ color: getIconColor(info.getValue() ?? "") }}
                    ></i>
                ),
                header: () => <span></span>,
                id: "logo",
                size: 25,
                enableSorting: false,
            }),
            columnHelper.accessor("name", {
                cell: (info) => <span className="dir-table-name ellipsis">{info.getValue()}</span>,
                header: () => <span className="dir-table-head-name">Name</span>,
                sortingFn: "alphanumeric",
                size: 200,
                minSize: 90,
            }),
            columnHelper.accessor("modestr", {
                cell: (info) => <span className="dir-table-modestr">{info.getValue()}</span>,
                header: () => <span>Perm</span>,
                size: 91,
                minSize: 90,
                sortingFn: "alphanumeric",
            }),
            columnHelper.accessor("modtime", {
                cell: (info) => <span className="dir-table-lastmod">{getLastModifiedTime(info.getValue())}</span>,
                header: () => <span>Last Modified</span>,
                size: 91,
                minSize: 65,
                sortingFn: "datetime",
            }),
            columnHelper.accessor("size", {
                cell: (info) => <span className="dir-table-size">{getBestUnit(info.getValue())}</span>,
                header: () => <span className="dir-table-head-size">Size</span>,
                size: 55,
                minSize: 50,
                sortingFn: "auto",
            }),
            columnHelper.accessor("mimetype", {
                cell: (info) => <span className="dir-table-type ellipsis">{cleanMimetype(info.getValue() ?? "")}</span>,
                header: () => <span className="dir-table-head-type">Type</span>,
                size: 97,
                minSize: 97,
                sortingFn: "alphanumeric",
            }),
            columnHelper.accessor("path", {}),
        ],
        [fullConfig]
    );

    const setEntryManagerProps = useSetAtom(entryManagerOverlayPropsAtom);

    const updateName = useCallback(
        (path: string, isDir: boolean) => {
            const fileName = path.split("/").at(-1);
            setEntryManagerProps({
                entryManagerType: EntryManagerType.EditName,
                startingValue: fileName,
                onSave: (newName: string) => {
                    let newPath: string;
                    if (newName !== fileName) {
                        const lastInstance = path.lastIndexOf(fileName);
                        newPath = path.substring(0, lastInstance) + newName;
                        console.log(`replacing ${fileName} with ${newName}: ${path}`);
                        handleRename(model, path, newPath, isDir, setErrorMsg);
                    }
                    setEntryManagerProps(undefined);
                },
            });
        },
        [model, setErrorMsg]
    );

    const openMoveTo = useCallback(
        (fileInfos: FileInfo[]) => {
            const target = fileInfos[0];
            if (target == null) {
                return;
            }
            const startingDir = target.dir ?? (target.path.split("/").slice(0, -1).join("/") || target.path);
            setEntryManagerProps({
                entryManagerType: EntryManagerType.MoveTo,
                startingValue: startingDir,
                hint: "Destination folder — the file name is kept.",
                onSave: (destDirInput: string) => {
                    const destDir = destDirInput.trim();
                    if (destDir !== "") {
                        handleMoveTo(model, fileInfos, destDir, setErrorMsg);
                    }
                    setEntryManagerProps(undefined);
                },
            });
        },
        [model, setErrorMsg]
    );

    const initialSorting = defaultSort === "modtime" ? [{ id: "modtime", desc: true }] : [{ id: "name", desc: false }];

    const table = useReactTable({
        data,
        columns,
        columnResizeMode: "onChange",
        getSortedRowModel: getSortedRowModel(),
        getCoreRowModel: getCoreRowModel(),

        initialState: {
            sorting: initialSorting,
            columnVisibility: {
                path: false,
            },
        },
        enableMultiSort: false,
        enableSortingRemoval: false,
        meta: {
            updateName,
            newFile,
            newDirectory,
            moveToOpen: openMoveTo,
        },
    });
    const sortingState = table.getState().sorting;
    useEffect(() => {
        const allRows = table.getRowModel()?.flatRows || [];
        setSelectedPath((allRows[focusIndex]?.getValue("path") as string) ?? null);
    }, [focusIndex, data, setSelectedPath, sortingState]);

    const columnSizeVars = useMemo(() => {
        const headers = table.getFlatHeaders();
        const colSizes: { [key: string]: number } = {};
        for (let i = 0; i < headers.length; i++) {
            const header = headers[i]!;
            colSizes[`--header-${header.id}-size`] = header.getSize();
            colSizes[`--col-${header.column.id}-size`] = header.column.getSize();
        }
        return colSizes;
    }, [table.getState().columnSizingInfo]);

    const osRef = useRef<OverlayScrollbarsComponentRef>(null);
    const bodyRef = useRef<HTMLDivElement>(null);
    const [scrollHeight, setScrollHeight] = useState(0);

    const onScroll = useCallback(
        debounce(2, () => {
            setScrollHeight(osRef.current.osInstance().elements().viewport.scrollTop);
        }),
        []
    );

    const TableComponent = table.getState().columnSizingInfo.isResizingColumn ? MemoizedTableBody : TableBody;

    return (
        <OverlayScrollbarsComponent
            options={{ scrollbars: { autoHide: "leave" } }}
            events={{ scroll: onScroll }}
            className="dir-table"
            style={{ ...columnSizeVars }}
            ref={osRef}
            data-scroll-height={scrollHeight}
        >
            <div className="dir-table-head">
                {table.getHeaderGroups().map((headerGroup) => (
                    <div className="dir-table-head-row" key={headerGroup.id}>
                        {headerGroup.headers.map((header) => (
                            <DirectoryTableHeaderCell key={header.id} header={header} />
                        ))}
                    </div>
                ))}
            </div>
            <TableComponent
                bodyRef={bodyRef}
                model={model}
                data={data}
                table={table}
                search={search}
                focusIndex={focusIndex}
                setFocusIndex={setFocusIndex}
                setSearch={setSearch}
                setSelectedPath={setSelectedPath}
                selectedPaths={selectedPaths}
                setSelectedPaths={setSelectedPaths}
                osRef={osRef.current}
            />
        </OverlayScrollbarsComponent>
    );
}

interface TableBodyProps {
    bodyRef: React.RefObject<HTMLDivElement>;
    model: PreviewModel;
    data: Array<FileInfo>;
    table: Table<FileInfo>;
    search: string;
    focusIndex: number;
    setFocusIndex: (_: number) => void;
    setSearch: (_: string) => void;
    setSelectedPath: (_: string) => void;
    selectedPaths: Set<string>;
    setSelectedPaths: React.Dispatch<React.SetStateAction<Set<string>>>;
    osRef: OverlayScrollbarsComponentRef;
}

function TableBody({
    bodyRef,
    model,
    table,
    search,
    focusIndex,
    setFocusIndex,
    setSearch,
    selectedPaths,
    setSelectedPaths,
    osRef,
}: TableBodyProps) {
    const searchActive = useAtomValue(model.directorySearchActive);
    const dummyLineRef = useRef<HTMLDivElement>(null);
    const warningBoxRef = useRef<HTMLDivElement>(null);
    const conn = useAtomValue(model.connection);
    const dirPath = useAtomValue(model.statFilePath);
    const setErrorMsg = useSetAtom(model.errorMsgAtom);
    const [selectionAnchorPath, setSelectionAnchorPath] = useState<string | null>(null);
    const blockMoveMenuItems = useBlockMoveMenuItems();

    useEffect(() => {
        if (focusIndex === null || !bodyRef.current || !osRef) {
            return;
        }

        const rowElement = bodyRef.current.querySelector(`[data-rowindex="${focusIndex}"]`) as HTMLDivElement;
        if (!rowElement) {
            return;
        }

        const viewport = osRef.osInstance().elements().viewport;
        const viewportHeight = viewport.offsetHeight;
        const rowRect = rowElement.getBoundingClientRect();
        const parentRect = viewport.getBoundingClientRect();
        const viewportScrollTop = viewport.scrollTop;
        const rowTopRelativeToViewport = rowRect.top - parentRect.top + viewport.scrollTop;
        const rowBottomRelativeToViewport = rowRect.bottom - parentRect.top + viewport.scrollTop;

        if (rowTopRelativeToViewport - 30 < viewportScrollTop) {
            // Row is above the visible area
            let topVal = rowTopRelativeToViewport - 30;
            if (topVal < 0) {
                topVal = 0;
            }
            viewport.scrollTo({ top: topVal });
        } else if (rowBottomRelativeToViewport + 5 > viewportScrollTop + viewportHeight) {
            // Row is below the visible area
            const topVal = rowBottomRelativeToViewport - viewportHeight + 5;
            viewport.scrollTo({ top: topVal });
        }
    }, [focusIndex]);

    const allRows = table.getRowModel().flatRows;
    const selectedFileInfos = useMemo(
        () => allRows.map((row) => row.original).filter((fileInfo) => selectedPaths.has(fileInfo.path)),
        [allRows, selectedPaths]
    );

    const handleRowClick = useCallback(
        (e: React.MouseEvent<HTMLDivElement>, row: Row<FileInfo>, idx: number) => {
            const rowPath = row.getValue("path") as string;
            setFocusIndex(idx);
            if (e.shiftKey && selectionAnchorPath != null) {
                const anchorIndex = allRows.findIndex(
                    (candidateRow) => candidateRow.getValue("path") === selectionAnchorPath
                );
                const startIndex = anchorIndex >= 0 ? anchorIndex : focusIndex;
                const [start, end] = [Math.min(startIndex, idx), Math.max(startIndex, idx)];
                const nextSelectedPaths = new Set<string>();
                allRows.slice(start, end + 1).forEach((candidateRow) => {
                    const candidatePath = candidateRow.getValue("path") as string;
                    if (candidatePath) {
                        nextSelectedPaths.add(candidatePath);
                    }
                });
                setSelectedPaths(nextSelectedPaths);
                return;
            }
            if (e.ctrlKey || e.metaKey) {
                setSelectedPaths((prev) => {
                    const next = new Set(prev);
                    if (next.has(rowPath)) {
                        next.delete(rowPath);
                    } else {
                        next.add(rowPath);
                    }
                    return next;
                });
                setSelectionAnchorPath(rowPath);
                return;
            }
            setSelectedPaths(new Set(rowPath ? [rowPath] : []));
            setSelectionAnchorPath(rowPath);
        },
        [allRows, focusIndex, selectionAnchorPath, setFocusIndex, setSelectedPaths]
    );

    const handleFileContextMenu = useCallback(
        async (e: any, finfo: FileInfo, idx: number) => {
            e.preventDefault();
            e.stopPropagation();
            if (finfo == null) {
                return;
            }
            setFocusIndex(idx);
            const contextSelectedFileInfos = selectedPaths.has(finfo.path) ? selectedFileInfos : [finfo];
            if (!selectedPaths.has(finfo.path)) {
                setSelectedPaths(new Set([finfo.path]));
                setSelectionAnchorPath(finfo.path);
            }
            const menu = await makeDirectoryEntryMenuItems(
                model,
                finfo,
                conn,
                setErrorMsg,
                {
                    newFile: table.options.meta.newFile,
                    newDirectory: table.options.meta.newDirectory,
                    rename: () => table.options.meta.updateName(finfo.path, finfo.isdir),
                    moveTo: () => table.options.meta.moveToOpen(contextSelectedFileInfos),
                },
                {
                    openInCurrentBlock: () =>
                        model.goHistory(finfo.path, undefined, resolveExplorerRootPathForOpenInCurrentBlock(finfo)),
                    selectedFileInfos: contextSelectedFileInfos,
                    relativePathRoot: dirPath,
                }
            );
            ContextMenuModel.getInstance().showContextMenu(appendBlockMoveMenuItems(menu, blockMoveMenuItems), e);
        },
        [
            blockMoveMenuItems,
            conn,
            model,
            selectedFileInfos,
            selectedPaths,
            setErrorMsg,
            setFocusIndex,
            setSelectedPaths,
            table,
        ]
    );

    const dotdotRow = allRows.find((row) => row.getValue("name") === "..");
    const otherRows = allRows.filter((row) => row.getValue("name") !== "..");

    return (
        <div className="dir-table-body" ref={bodyRef}>
            {(searchActive || search !== "") && (
                <div className="flex rounded-[3px] py-1 px-2 bg-warning text-black" ref={warningBoxRef}>
                    <span>{search === "" ? "Type to search (Esc to cancel)" : `Searching for "${search}"`}</span>
                    <div
                        className="ml-auto bg-transparent flex justify-center items-center flex-col p-0.5 rounded-md hover:bg-hoverbg focus:bg-hoverbg focus-within:bg-hoverbg cursor-pointer"
                        onClick={() => {
                            setSearch("");
                            globalStore.set(model.directorySearchActive, false);
                        }}
                    >
                        <i className="fa-solid fa-xmark" />
                        <input
                            type="text"
                            value={search}
                            onChange={() => {}}
                            className="w-0 h-0 opacity-0 p-0 border-none pointer-events-none"
                        />
                    </div>
                </div>
            )}
            <div className="dir-table-body-scroll-box">
                <div className="dummy dir-table-body-row" ref={dummyLineRef}>
                    <div className="dir-table-body-cell">dummy-data</div>
                </div>
                {dotdotRow && (
                    <TableRow
                        model={model}
                        row={dotdotRow}
                        focusIndex={focusIndex}
                        setSearch={setSearch}
                        idx={0}
                        selected={selectedPaths.has(dotdotRow.getValue("path") as string)}
                        handleRowClick={handleRowClick}
                        handleFileContextMenu={handleFileContextMenu}
                        key="dotdot"
                    />
                )}
                {otherRows.map((row, idx) => (
                    <TableRow
                        model={model}
                        row={row}
                        focusIndex={focusIndex}
                        setSearch={setSearch}
                        idx={dotdotRow ? idx + 1 : idx}
                        selected={selectedPaths.has(row.getValue("path") as string)}
                        handleRowClick={handleRowClick}
                        handleFileContextMenu={handleFileContextMenu}
                        key={idx}
                    />
                ))}
            </div>
        </div>
    );
}

type TableRowProps = {
    model: PreviewModel;
    row: Row<FileInfo>;
    focusIndex: number;
    setSearch: (_: string) => void;
    idx: number;
    selected: boolean;
    handleRowClick: (e: React.MouseEvent<HTMLDivElement>, row: Row<FileInfo>, idx: number) => void;
    handleFileContextMenu: (e: any, finfo: FileInfo, idx: number) => Promise<void>;
};

function TableRow({
    model,
    row,
    focusIndex,
    setSearch,
    idx,
    selected,
    handleRowClick,
    handleFileContextMenu,
}: TableRowProps) {
    const dirPath = useAtomValue(model.statFilePath);
    const connection = useAtomValue(model.connection);

    const dragItem: DraggedFile = {
        relName: row.getValue("name") as string,
        absParent: dirPath,
        uri: formatRemoteUri(row.getValue("path") as string, connection),
        isDir: row.original.isdir,
    };
    const [_, drag] = useDrag(
        () => ({
            type: "FILE_ITEM",
            canDrag: true,
            item: () => dragItem,
        }),
        [dragItem]
    );

    const dragRef = useCallback(
        (node: HTMLDivElement | null) => {
            drag(node);
        },
        [drag]
    );

    return (
        <div
            className={clsx("dir-table-body-row", { focused: focusIndex === idx, selected })}
            data-rowindex={idx}
            onDoubleClick={(e) => {
                fireAndForget(() =>
                    openPreviewEntry(model, row.original, connection, { forceNewBlock: e.ctrlKey || e.metaKey })
                );
                setSearch("");
                globalStore.set(model.directorySearchActive, false);
            }}
            onClick={(e) => handleRowClick(e, row, idx)}
            onContextMenu={(e) => handleFileContextMenu(e, row.original, idx)}
            ref={dragRef}
        >
            {row.getVisibleCells().map((cell) => (
                <div
                    className={clsx("dir-table-body-cell", "col-" + cell.column.id)}
                    key={cell.id}
                    style={{ width: `calc(var(--col-${cell.column.id}-size) * 1px)` }}
                >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </div>
            ))}
        </div>
    );
}

const MemoizedTableBody = React.memo(
    TableBody,
    (prev, next) => prev.table.options.data == next.table.options.data
) as typeof TableBody;

interface DirectoryPreviewProps {
    model: PreviewModel;
}

function DirectoryPreview({ model }: DirectoryPreviewProps) {
    const env = useWaveEnv<PreviewEnv>();
    const [searchText, setSearchText] = useState("");
    const [focusIndex, setFocusIndex] = useState(0);
    const [unfilteredData, setUnfilteredData] = useState<FileInfo[]>([]);
    const showHiddenFiles = useAtomValue(model.showHiddenFiles);
    const [selectedPath, setSelectedPath] = useState("");
    const [selectedPaths, setSelectedPaths] = useState<Set<string>>(() => new Set());
    const refreshVersion = useAtomValue(model.refreshVersion);
    const conn = useAtomValue(model.connection);
    const blockData = useAtomValue(model.blockAtom);
    const finfo = useAtomValue(model.statFile);
    const dirPath = finfo?.path;
    const supportsFileCreation = finfo?.supportsmkdir !== false && !isWindowsDrivesPath(dirPath);
    const setErrorMsg = useSetAtom(model.errorMsgAtom);
    const blockMoveMenuItems = useBlockMoveMenuItems();

    useEffect(
        () =>
            fireAndForget(async () => {
                const entries: FileInfo[] = [];
                try {
                    const remotePath = await model.formatRemoteUri(dirPath, globalStore.get);
                    const stream = env.rpc.FileListStreamCommand(TabRpcClient, { path: remotePath }, null);
                    for await (const chunk of stream) {
                        if (chunk?.fileinfo) {
                            entries.push(...chunk.fileinfo);
                        }
                    }
                    if (finfo?.dir && finfo?.path !== finfo?.dir) {
                        entries.unshift({
                            name: "..",
                            path: finfo.dir,
                            isdir: true,
                            modtime: new Date().getTime(),
                            mimetype: "directory",
                        });
                    }
                } catch (e) {
                    console.error("Directory Read Error", e);
                    setErrorMsg({
                        status: "Cannot Read Directory",
                        text: `${e}`,
                    });
                }
                setUnfilteredData(entries);
            }),
        [conn, dirPath, refreshVersion]
    );

    const filteredData = useMemo(
        () =>
            unfilteredData?.filter((fileInfo) => {
                if (fileInfo.name == null) {
                    console.log("fileInfo.name is null", fileInfo);
                    return false;
                }
                if (!showHiddenFiles && fileInfo.name.startsWith(".") && fileInfo.name != "..") {
                    return false;
                }
                return fileInfo.name.toLowerCase().includes(searchText);
            }) ?? [],
        [unfilteredData, showHiddenFiles, searchText]
    );

    useEffect(() => {
        const visiblePaths = new Set(filteredData.map((fileInfo) => fileInfo.path));
        setSelectedPaths((prev) => {
            let changed = false;
            const next = new Set<string>();
            prev.forEach((path) => {
                if (visiblePaths.has(path)) {
                    next.add(path);
                } else {
                    changed = true;
                }
            });
            return changed ? next : prev;
        });
    }, [filteredData]);

    useEffect(() => {
        model.directoryKeyDownHandler = (waveEvent: WaveKeyboardEvent): boolean => {
            if (checkKeyPressed(waveEvent, "Cmd:f")) {
                globalStore.set(model.directorySearchActive, true);
                return true;
            }
            if (checkKeyPressed(waveEvent, "Cmd:c") || checkKeyPressed(waveEvent, "Ctrl:c")) {
                const selectedFileInfos = filteredData.filter((fileInfo) => selectedPaths.has(fileInfo.path));
                if (selectedFileInfos.length === 0) {
                    return true;
                }
                copyPreviewFileItems(selectedFileInfos, conn);
                return true;
            }
            if (checkKeyPressed(waveEvent, "Cmd:v") || checkKeyPressed(waveEvent, "Ctrl:v")) {
                if (dirPath == null || dirPath === "" || !supportsFileCreation) {
                    return true;
                }
                fireAndForget(() =>
                    pastePreviewFileItems(model, getPreviewFileClipboard(), dirPath, conn, setErrorMsg)
                );
                return true;
            }
            if (checkKeyPressed(waveEvent, "Escape")) {
                setSearchText("");
                globalStore.set(model.directorySearchActive, false);
                return;
            }
            if (checkKeyPressed(waveEvent, "ArrowUp")) {
                setFocusIndex((idx) => {
                    const nextIndex = Math.max(idx - 1, 0);
                    const nextPath = filteredData[nextIndex]?.path;
                    setSelectedPaths(new Set(nextPath ? [nextPath] : []));
                    return nextIndex;
                });
                return true;
            }
            if (checkKeyPressed(waveEvent, "ArrowDown")) {
                setFocusIndex((idx) => {
                    const nextIndex = Math.max(0, Math.min(idx + 1, filteredData.length - 1));
                    const nextPath = filteredData[nextIndex]?.path;
                    setSelectedPaths(new Set(nextPath ? [nextPath] : []));
                    return nextIndex;
                });
                return true;
            }
            if (checkKeyPressed(waveEvent, "PageUp")) {
                setFocusIndex((idx) => {
                    const nextIndex = Math.max(idx - PageJumpSize, 0);
                    const nextPath = filteredData[nextIndex]?.path;
                    setSelectedPaths(new Set(nextPath ? [nextPath] : []));
                    return nextIndex;
                });
                return true;
            }
            if (checkKeyPressed(waveEvent, "PageDown")) {
                setFocusIndex((idx) => {
                    const nextIndex = Math.max(0, Math.min(idx + PageJumpSize, filteredData.length - 1));
                    const nextPath = filteredData[nextIndex]?.path;
                    setSelectedPaths(new Set(nextPath ? [nextPath] : []));
                    return nextIndex;
                });
                return true;
            }
            if (checkKeyPressed(waveEvent, "Enter")) {
                if (filteredData.length == 0) {
                    return;
                }
                const selectedFileInfo = filteredData.find((fileInfo) => fileInfo.path === selectedPath);
                fireAndForget(() =>
                    selectedFileInfo == null
                        ? model.openPathWithTarget(selectedPath)
                        : openPreviewEntry(model, selectedFileInfo, conn)
                );
                setSearchText("");
                globalStore.set(model.directorySearchActive, false);
                return true;
            }
            if (checkKeyPressed(waveEvent, "Backspace")) {
                if (searchText.length == 0) {
                    return true;
                }
                setSearchText((current) => current.slice(0, -1));
                return true;
            }
            if (
                checkKeyPressed(waveEvent, "Space") &&
                searchText == "" &&
                PLATFORM == PlatformMacOS &&
                !blockData?.meta?.connection
            ) {
                env.electron.onQuicklook(selectedPath);
                return true;
            }
            if (isCharacterKeyEvent(waveEvent)) {
                setSearchText((current) => current + waveEvent.key);
                return true;
            }
            return false;
        };
        return () => {
            model.directoryKeyDownHandler = null;
        };
    }, [
        conn,
        dirPath,
        filteredData,
        model,
        selectedPath,
        selectedPaths,
        setErrorMsg,
        searchText,
        supportsFileCreation,
    ]);

    useEffect(() => {
        if (filteredData.length != 0 && focusIndex > filteredData.length - 1) {
            setFocusIndex(filteredData.length - 1);
        }
    }, [filteredData]);

    const entryManagerPropsAtom = useState(
        atom<EntryManagerOverlayProps>(null) as PrimitiveAtom<EntryManagerOverlayProps>
    )[0];
    const [entryManagerProps, setEntryManagerProps] = useAtom(entryManagerPropsAtom);

    const { refs, floatingStyles, context } = useFloating({
        open: !!entryManagerProps,
        onOpenChange: () => setEntryManagerProps(undefined),
        middleware: [offset(({ rects }) => -rects.reference.height / 2 - rects.floating.height / 2)],
    });

    const handleDropCopy = useCallback(
        async (data: CommandFileCopyData, isDir: boolean) => {
            try {
                await env.rpc.FileCopyCommand(TabRpcClient, data, { timeout: data.opts.timeout });
            } catch (e) {
                console.warn("Copy failed:", e);
                const copyError = `${e}`;
                const allowRetry = copyError.includes(overwriteError) || copyError.includes(mergeError);
                let errorMsg: ErrorMsg;
                if (allowRetry) {
                    errorMsg = {
                        status: "Confirm Overwrite File(s)",
                        text: "This copy operation will overwrite an existing file. Would you like to continue?",
                        level: "warning",
                        buttons: [
                            {
                                text: "Delete Then Copy",
                                onClick: async () => {
                                    data.opts.overwrite = true;
                                    await handleDropCopy(data, isDir);
                                },
                            },
                            {
                                text: "Sync",
                                onClick: async () => {
                                    data.opts.merge = true;
                                    await handleDropCopy(data, isDir);
                                },
                            },
                        ],
                    };
                } else {
                    errorMsg = {
                        status: "Copy Failed",
                        text: copyError,
                        level: "error",
                    };
                }
                setErrorMsg(errorMsg);
            }
            model.refresh();
        },
        [model]
    );

    const [, drop] = useDrop(
        () => ({
            accept: "FILE_ITEM", //a name of file drop type
            canDrop: (_, monitor) => {
                const dragItem = monitor.getItem<DraggedFile>();
                // drop if not current dir is the parent directory of the dragged item
                // requires absolute path
                if (monitor.isOver({ shallow: false }) && dragItem.absParent !== dirPath) {
                    return true;
                }
                return false;
            },
            drop: async (draggedFile: DraggedFile, monitor) => {
                if (!monitor.didDrop()) {
                    const timeoutYear = 31536000000; // one year
                    const opts: FileCopyOpts = {
                        timeout: timeoutYear,
                    };
                    const desturi = await model.formatRemoteUri(dirPath, globalStore.get);
                    const data: CommandFileCopyData = {
                        srcuri: draggedFile.uri,
                        desturi,
                        opts,
                    };
                    await handleDropCopy(data, draggedFile.isDir);
                }
            },
            // TODO: mabe add a hover option?
        }),
        [dirPath, model]
    );

    useEffect(() => {
        drop(refs.reference);
    }, [refs.reference]);

    const dismiss = useDismiss(context);
    const { getReferenceProps, getFloatingProps } = useInteractions([dismiss]);

    const newFile = useCallback(() => {
        if (!supportsFileCreation) {
            return;
        }
        setEntryManagerProps({
            entryManagerType: EntryManagerType.NewFile,
            onSave: (newName: string) => {
                console.log(`newFile: ${newName}`);
                fireAndForget(async () => {
                    await env.rpc.FileCreateCommand(
                        TabRpcClient,
                        {
                            info: {
                                path: await model.formatRemoteUri(`${dirPath}/${newName}`, globalStore.get),
                            },
                        },
                        null
                    );
                    model.refresh();
                });
                setEntryManagerProps(undefined);
            },
        });
    }, [dirPath, env.rpc, model, supportsFileCreation]);
    const newDirectory = useCallback(() => {
        if (!supportsFileCreation) {
            return;
        }
        setEntryManagerProps({
            entryManagerType: EntryManagerType.NewDirectory,
            onSave: (newName: string) => {
                console.log(`newDirectory: ${newName}`);
                fireAndForget(async () => {
                    await env.rpc.FileMkdirCommand(TabRpcClient, {
                        info: {
                            path: await model.formatRemoteUri(`${dirPath}/${newName}`, globalStore.get),
                        },
                    });
                    model.refresh();
                });
                setEntryManagerProps(undefined);
            },
        });
    }, [dirPath, env.rpc, model, supportsFileCreation]);

    const handleFileContextMenu = useCallback(
        async (e: any) => {
            e.preventDefault();
            e.stopPropagation();
            const menu = await makeDirectoryBackgroundMenuItems(model, conn, finfo, setErrorMsg, {
                newFile,
                newDirectory,
            });
            ContextMenuModel.getInstance().showContextMenu(appendBlockMoveMenuItems(menu, blockMoveMenuItems), e);
        },
        [blockMoveMenuItems, conn, finfo, model, newFile, newDirectory, setErrorMsg]
    );

    return (
        <Fragment>
            <div
                ref={refs.setReference}
                className="dir-table-container"
                onChangeCapture={(e) => {
                    const event = e as React.ChangeEvent<HTMLInputElement>;
                    if (!entryManagerProps) {
                        setSearchText(event.target.value.toLowerCase());
                    }
                }}
                {...getReferenceProps()}
                onContextMenu={(e) => handleFileContextMenu(e)}
                onClick={() => setEntryManagerProps(undefined)}
            >
                <DirectoryTable
                    model={model}
                    data={filteredData}
                    search={searchText}
                    focusIndex={focusIndex}
                    setFocusIndex={setFocusIndex}
                    setSearch={setSearchText}
                    setSelectedPath={setSelectedPath}
                    selectedPaths={selectedPaths}
                    setSelectedPaths={setSelectedPaths}
                    entryManagerOverlayPropsAtom={entryManagerPropsAtom}
                    newFile={newFile}
                    newDirectory={newDirectory}
                />
            </div>
            {entryManagerProps && (
                <EntryManagerOverlay
                    {...entryManagerProps}
                    forwardRef={refs.setFloating}
                    style={floatingStyles}
                    getReferenceProps={getFloatingProps}
                    onCancel={() => setEntryManagerProps(undefined)}
                />
            )}
        </Fragment>
    );
}

export { DirectoryPreview };
