// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { appendBlockMoveMenuItems, useBlockMoveMenuItems } from "@/app/block/block-move-menu";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { globalStore } from "@/app/store/jotaiStore";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { useWaveEnv } from "@/app/waveenv/waveenv";
import { checkKeyPressed, isCharacterKeyEvent } from "@/util/keyutil";
import { isDragMovement, keysUnderRect, rectToCss, type Rect } from "@/util/selectionrect";
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
import { useVirtualizer } from "@tanstack/react-virtual";
import { InlineRenameInput } from "@/app/element/inline-rename-input";
import { i18n } from "@/i18n/config";
import { useTranslation } from "react-i18next";
import "./directorypreview.scss";
import { EntryManagerOverlay, EntryManagerOverlayProps, EntryManagerType } from "./entry-manager";
import {
    cleanMimetype,
    getBestUnit,
    getLastModifiedTime,
    getSortIcon,
    handleFileDeletes,
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
import { normalizeVcsPath, type VcsTreeStatus } from "./vcs-tree-status";
import { VcsFileMarkTitleKey, useDirectoryVcsTreeStatus } from "./vcs-tree-status-hook";

const PageJumpSize = 20;

interface DirectoryNameCellProps {
    name: string;
    finfo: FileInfo;
    vcsStatus: VcsTreeStatus | null;
}

/** name 列 cell：只在有 VCS 标记时追加节点，干净行保持原样（完全静默）。 */
function DirectoryNameCell({ name, finfo, vcsStatus }: DirectoryNameCellProps) {
    const plainName = <span className="dir-table-name ellipsis">{name}</span>;
    // `..` 上级行不参与（它不是当前目录树里的条目）
    if (vcsStatus == null || name === "..") {
        return plainName;
    }
    const path = normalizeVcsPath(finfo?.path ?? "");
    if (finfo?.isdir) {
        const count = vcsStatus.dirCount.get(path) ?? 0;
        if (count <= 0) {
            return plainName;
        }
        const title = i18n.t("preview:vcsMark.changedDir", { num: count });
        return (
            <span className="dir-vcs-name-wrap">
                <span className="dir-table-name ellipsis" title={title}>
                    {name}
                </span>
                <span className="dir-vcs-mark dir-vcs-count" title={title} aria-hidden="true">
                    {count}
                </span>
            </span>
        );
    }
    const mark = vcsStatus.fileMark.get(path);
    if (mark == null) {
        return plainName;
    }
    const markClass = `is-vcs-${mark.toLowerCase()}`;
    const title = i18n.t("preview:vcsMark.changedFile", { mark: i18n.t(VcsFileMarkTitleKey[mark]) });
    return (
        <span className="dir-vcs-name-wrap">
            <span className={`dir-table-name ellipsis ${markClass}`} title={title}>
                {name}
            </span>
            <span className={`dir-vcs-mark ${markClass}`} title={title} aria-hidden="true">
                {mark}
            </span>
        </span>
    );
}

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
    editingRenameAtom: PrimitiveAtom<{ path: string; isDir: boolean } | null>;
    newFile: () => void;
    newDirectory: () => void;
    vcsStatus: VcsTreeStatus | null;
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
    editingRenameAtom,
    newFile,
    newDirectory,
    vcsStatus,
}: DirectoryTableProps) {
    const { t } = useTranslation("preview");
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
                cell: (info) => (
                    <DirectoryNameCell name={info.getValue()} finfo={info.row.original} vcsStatus={vcsStatus} />
                ),
                header: () => <span className="dir-table-head-name">{t("preview:directory.name")}</span>,
                sortingFn: "alphanumeric",
                size: 200,
                minSize: 90,
            }),
            columnHelper.accessor("modestr", {
                cell: (info) => <span className="dir-table-modestr">{info.getValue()}</span>,
                header: () => <span>{t("preview:directory.perm")}</span>,
                size: 91,
                minSize: 90,
                sortingFn: "alphanumeric",
            }),
            columnHelper.accessor("modtime", {
                cell: (info) => <span className="dir-table-lastmod">{getLastModifiedTime(info.getValue())}</span>,
                header: () => <span>{t("preview:directory.lastModified")}</span>,
                size: 91,
                minSize: 65,
                sortingFn: "datetime",
            }),
            columnHelper.accessor("size", {
                cell: (info) => <span className="dir-table-size">{getBestUnit(info.getValue())}</span>,
                header: () => <span className="dir-table-head-size">{t("preview:directory.size")}</span>,
                size: 55,
                minSize: 50,
                sortingFn: "auto",
            }),
            columnHelper.accessor("mimetype", {
                cell: (info) => <span className="dir-table-type ellipsis">{cleanMimetype(info.getValue() ?? "")}</span>,
                header: () => <span className="dir-table-head-type">{t("preview:directory.type")}</span>,
                size: 97,
                minSize: 97,
                sortingFn: "alphanumeric",
            }),
            columnHelper.accessor("path", {}),
        ],
        [fullConfig, vcsStatus, t]
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

    // W2-3: 滚动高度只服务于 CSS（.dir-table:not([data-scroll-height="0"]) 顶部模糊层），
    // 直写 DOM dataset，删掉 onScroll 2ms 防抖 + scrollHeight state 导致的整表重渲。
    // 初始值 "0" 在 JSX 上保留，未滚动时仍不显示那层 blur。
    const onScroll = useCallback(() => {
        const osc = osRef.current;
        if (osc == null) {
            return;
        }
        const viewport = osc.osInstance()?.elements().viewport;
        const host = osc.getElement();
        if (viewport == null || host == null) {
            return;
        }
        host.dataset.scrollHeight = String(viewport.scrollTop);
    }, []);

    const TableComponent = table.getState().columnSizingInfo.isResizingColumn ? MemoizedTableBody : TableBody;

    return (
        <OverlayScrollbarsComponent
            options={{ scrollbars: { autoHide: "leave" } }}
            events={{ scroll: onScroll }}
            className="dir-table"
            style={{ ...columnSizeVars }}
            ref={osRef}
            data-scroll-height="0"
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
                editingRenameAtom={editingRenameAtom}
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
    editingRenameAtom: PrimitiveAtom<{ path: string; isDir: boolean } | null>;
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
    editingRenameAtom,
}: TableBodyProps) {
    const searchActive = useAtomValue(model.directorySearchActive);
    const dummyLineRef = useRef<HTMLDivElement>(null);
    const warningBoxRef = useRef<HTMLDivElement>(null);
    const conn = useAtomValue(model.connection);
    const dirPath = useAtomValue(model.statFilePath);
    const setErrorMsg = useSetAtom(model.errorMsgAtom);
    const [selectionAnchorPath, setSelectionAnchorPath] = useState<string | null>(null);
    const [marqueeRect, setMarqueeRect] = useState<{ left: number; top: number; width: number; height: number } | null>(
        null
    );
    const marqueeStartRef = useRef<{ x: number; y: number } | null>(null);
    const marqueeBaseRef = useRef<Set<string>>(new Set());
    const marqueeAdditiveRef = useRef(false);
    const blockMoveMenuItems = useBlockMoveMenuItems();

    // ---- W2-3 TableBody 虚拟化 ----
    // 滚动容器 = OverlayScrollbars 的 viewport（即 overlayscrollbars-react 渲染的
    // contents div）。它在 React 树里直接渲染，挂载后就能从 DOM 取到，不依赖
    // osInstance() 初始化完成的时机。
    const getScrollElement = useCallback((): HTMLElement | null => {
        const body = bodyRef.current;
        if (body == null) {
            return null;
        }
        return body.closest("[data-overlayscrollbars-contents]") as HTMLElement | null;
    }, []);

    const scrollBoxRef = useRef<HTMLDivElement>(null);
    // 列表起点到滚动内容顶部的距离（表头 + body padding）。行 absolute 定位时把这部分
    // 从 translateY 里减掉；range 计算和 scrollToIndex 由 virtualizer 的 scrollMargin 对齐。
    const [scrollMargin, setScrollMargin] = useState(0);

    const rowModel = table.getRowModel();
    // 展示顺序：`..` 上级行固定在首位（idx=0），其余行按表格排序。
    const rows = useMemo(() => {
        const flatRows = rowModel.flatRows;
        const dotdot = flatRows.find((row) => row.getValue("name") === "..");
        const others = flatRows.filter((row) => row.getValue("name") !== "..");
        return dotdot == null ? others : [dotdot, ...others];
    }, [rowModel]);

    const rowVirtualizer = useVirtualizer({
        count: rows.length,
        getScrollElement,
        estimateSize: () => 24,
        overscan: 8,
        scrollMargin,
    });

    React.useLayoutEffect(() => {
        const viewport = getScrollElement();
        const box = scrollBoxRef.current;
        if (viewport == null || box == null) {
            return;
        }
        const boxTop = box.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop;
        if (Math.abs(boxTop - scrollMargin) > 0.5) {
            setScrollMargin(boxTop);
        }
    });

    useEffect(() => {
        if (focusIndex == null || bodyRef.current == null) {
            return;
        }

        const viewport = getScrollElement();
        if (viewport == null) {
            return;
        }

        const rowElement = bodyRef.current.querySelector(`[data-rowindex="${focusIndex}"]`) as HTMLDivElement;
        if (!rowElement) {
            // 虚拟化后目标行可能不在当前渲染窗口里：交给 virtualizer 滚过去，而不是静默不动。
            rowVirtualizer.scrollToIndex(focusIndex, { align: "auto" });
            return;
        }

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

    const selectedFileInfos = useMemo(
        () => rows.map((row) => row.original).filter((fileInfo) => selectedPaths.has(fileInfo.path)),
        [rows, selectedPaths]
    );

    // W2-3: 行回调通过 ref 读最新状态，身份保持稳定 —— 否则 focusIndex / 选区变化会重建回调，
    // 击穿 TableRow 的 React.memo（虚拟化只省 DOM，不省 re-render）。
    const rowsRef = useRef(rows);
    rowsRef.current = rows;
    const focusIndexRef = useRef(focusIndex);
    focusIndexRef.current = focusIndex;
    const selectionAnchorRef = useRef(selectionAnchorPath);
    selectionAnchorRef.current = selectionAnchorPath;
    const selectedPathsRef = useRef(selectedPaths);
    selectedPathsRef.current = selectedPaths;
    const selectedFileInfosRef = useRef(selectedFileInfos);
    selectedFileInfosRef.current = selectedFileInfos;
    const connRef = useRef(conn);
    connRef.current = conn;
    const dirPathRef = useRef(dirPath);
    dirPathRef.current = dirPath;
    const blockMoveMenuItemsRef = useRef(blockMoveMenuItems);
    blockMoveMenuItemsRef.current = blockMoveMenuItems;

    const handleRowClick = useCallback(
        (e: React.MouseEvent<HTMLDivElement>, row: Row<FileInfo>, idx: number) => {
            const currentRows = rowsRef.current;
            const rowPath = row.getValue("path") as string;
            setFocusIndex(idx);
            if (e.shiftKey && selectionAnchorRef.current != null) {
                const anchorIndex = currentRows.findIndex(
                    (candidateRow) => candidateRow.getValue("path") === selectionAnchorRef.current
                );
                const startIndex = anchorIndex >= 0 ? anchorIndex : focusIndexRef.current;
                const [start, end] = [Math.min(startIndex, idx), Math.max(startIndex, idx)];
                const nextSelectedPaths = new Set<string>();
                currentRows.slice(start, end + 1).forEach((candidateRow) => {
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
        [setFocusIndex, setSelectedPaths]
    );

    // 框选：与 AI Sessions 列表共用同一套几何函数（@/util/selectionrect）。
    // 行标识用 data-file-path；表格是虚拟滚动的绝对定位元素，所以只对当前
    // 已挂载的行求交 —— 那正是用户肉眼可见、想要框选的那部分。
    const startMarquee = useCallback(
        (event: React.MouseEvent<HTMLDivElement>) => {
            if (event.button !== 0) return;
            const target = event.target as HTMLElement | null;
            if (target != null && typeof target.closest === "function") {
                if (target.closest("[data-rowindex], button, input") != null) {
                    return;
                }
            }
            marqueeStartRef.current = { x: event.clientX, y: event.clientY };
            marqueeAdditiveRef.current = event.ctrlKey || event.metaKey;
            marqueeBaseRef.current = event.ctrlKey || event.metaKey ? new Set(selectedPaths) : new Set();
        },
        [selectedPaths]
    );

    useEffect(() => {
        const handleMove = (event: MouseEvent) => {
            const start = marqueeStartRef.current;
            const container = bodyRef.current;
            if (start == null || container == null) return;
            if (!isDragMovement(event.clientX - start.x, event.clientY - start.y)) return;
            const rect: Rect = {
                left: Math.min(start.x, event.clientX),
                top: Math.min(start.y, event.clientY),
                right: Math.max(start.x, event.clientX),
                bottom: Math.max(start.y, event.clientY),
            };
            setMarqueeRect(rectToCss(rect));
            const rows = Array.from(container.querySelectorAll("[data-file-path]")).map((el) => ({
                key: (el as HTMLElement).dataset.filePath ?? "",
                el: el as HTMLElement,
            }));
            const hit = keysUnderRect(rect, rows.filter((row) => row.key !== ""));
            const next = new Set(marqueeBaseRef.current);
            for (const key of hit) next.add(key);
            setSelectedPaths(next);
        };
        const handleUp = () => {
            if (marqueeStartRef.current == null) return;
            marqueeStartRef.current = null;
            setMarqueeRect(null);
        };
        document.addEventListener("mousemove", handleMove);
        document.addEventListener("mouseup", handleUp);
        return () => {
            document.removeEventListener("mousemove", handleMove);
            document.removeEventListener("mouseup", handleUp);
        };
    }, [bodyRef, setSelectedPaths]);

    const handleFileContextMenu = useCallback(
        async (e: any, finfo: FileInfo, idx: number) => {
            e.preventDefault();
            e.stopPropagation();
            if (finfo == null) {
                return;
            }
            setFocusIndex(idx);
            const currentSelectedPaths = selectedPathsRef.current;
            const contextSelectedFileInfos = currentSelectedPaths.has(finfo.path)
                ? selectedFileInfosRef.current
                : [finfo];
            if (!currentSelectedPaths.has(finfo.path)) {
                setSelectedPaths(new Set([finfo.path]));
                setSelectionAnchorPath(finfo.path);
            }
            const menu = await makeDirectoryEntryMenuItems(
                model,
                finfo,
                connRef.current,
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
                    openInNewBlock: (isDir) => model.openPathInNewBlockSmart(finfo.path, isDir),
                    selectedFileInfos: contextSelectedFileInfos,
                    relativePathRoot: dirPathRef.current,
                }
            );
            ContextMenuModel.getInstance().showContextMenu(
                appendBlockMoveMenuItems(menu, blockMoveMenuItemsRef.current),
                e
            );
        },
        [model, setErrorMsg, setFocusIndex, setSelectedPaths, table]
    );

    // 行高测量回调：virtualizer 靠行上的 data-index 属性定位（见 TableRow）。
    const measureRow = useCallback(
        (node: HTMLElement | null) => {
            rowVirtualizer.measureElement(node);
        },
        [rowVirtualizer]
    );

    const virtualItems = rowVirtualizer.getVirtualItems();
    // 斑马纹（scss 里 .dir-table-body-row:nth-child(odd)）依赖 DOM 兄弟序：
    // 虚拟窗口起点为奇数时插入一个 0 尺寸占位元素把奇偶对齐，滚动中条纹才不会「爬行」。
    const needParitySpacer = virtualItems.length > 0 && virtualItems[0]!.index % 2 === 1;

    return (
        <div className="dir-table-body relative" ref={bodyRef} onMouseDown={startMarquee}>
            {marqueeRect != null ? (
                <div
                    aria-hidden="true"
                    className="pointer-events-none absolute z-20 border border-accent/60 bg-accent/10"
                    style={{
                        left: marqueeRect.left,
                        top: marqueeRect.top,
                        width: marqueeRect.width,
                        height: marqueeRect.height,
                    }}
                />
            ) : null}
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
            <div
                className="dir-table-body-scroll-box"
                ref={scrollBoxRef}
                style={{ height: rowVirtualizer.getTotalSize() }}
            >
                <div className="dummy dir-table-body-row" ref={dummyLineRef}>
                    <div className="dir-table-body-cell">dummy-data</div>
                </div>
                {needParitySpacer ? (
                    <div aria-hidden="true" style={{ position: "absolute", width: 0, height: 0 }} />
                ) : null}
                {virtualItems.map((virtualRow) => {
                    const row = rows[virtualRow.index];
                    if (row == null) {
                        return null;
                    }
                    return (
                        <TableRow
                            model={model}
                            row={row}
                            focused={focusIndex === virtualRow.index}
                            setSearch={setSearch}
                            idx={virtualRow.index}
                            selected={selectedPaths.has(row.getValue("path") as string)}
                            handleRowClick={handleRowClick}
                            handleFileContextMenu={handleFileContextMenu}
                            editingRenameAtom={editingRenameAtom}
                            measureRef={measureRow}
                            virtualStart={virtualRow.start - scrollMargin}
                            key={virtualRow.key}
                        />
                    );
                })}
            </div>
        </div>
    );
}

type TableRowProps = {
    model: PreviewModel;
    row: Row<FileInfo>;
    focused: boolean;
    setSearch: (_: string) => void;
    idx: number;
    selected: boolean;
    handleRowClick: (e: React.MouseEvent<HTMLDivElement>, row: Row<FileInfo>, idx: number) => void;
    handleFileContextMenu: (e: any, finfo: FileInfo, idx: number) => Promise<void>;
    editingRenameAtom: PrimitiveAtom<{ path: string; isDir: boolean } | null>;
    /** W2-3: virtualizer 行高测量回调（靠行上的 data-index 属性定位）。 */
    measureRef?: (node: HTMLElement | null) => void;
    /** W2-3: 行在 .dir-table-body-scroll-box 里的绝对定位偏移（px）。 */
    virtualStart: number;
};

// W2-3: React.memo —— 虚拟化后仍要避免整窗口逐行 re-render；配合 TableBody 里
// 经 ref 稳定化的回调，focusIndex / 选区变化时只有受影响的行重渲。
const TableRow = React.memo(function TableRow({
    model,
    row,
    focused,
    setSearch,
    idx,
    selected,
    handleRowClick,
    handleFileContextMenu,
    editingRenameAtom,
    measureRef,
    virtualStart,
}: TableRowProps) {
    const dirPath = useAtomValue(model.statFilePath);
    const connection = useAtomValue(model.connection);
    const setErrorMsg = useSetAtom(model.errorMsgAtom);
    const [editingRename, setEditingRename] = useAtom(editingRenameAtom);

    // W2-3: dragItem 用 useMemo 稳定身份 —— 原来每次 render 新对象，useDrag
    // 每帧重绑拖拽 connector，还击穿 memo。
    const dragItem = useMemo<DraggedFile>(
        () => ({
            relName: row.getValue("name") as string,
            absParent: dirPath,
            uri: formatRemoteUri(row.getValue("path") as string, connection),
            isDir: row.original.isdir,
        }),
        [row, dirPath, connection]
    );
    const [_, drag] = useDrag(
        () => ({
            type: "FILE_ITEM",
            canDrag: true,
            item: () => dragItem,
        }),
        [dragItem]
    );

    // 拖拽 connector 与 virtualizer 行测量二合一。
    const setRowRef = useCallback(
        (node: HTMLDivElement | null) => {
            drag(node);
            measureRef?.(node);
        },
        [drag, measureRef]
    );

    return (
        <div
            className={clsx("dir-table-body-row", { focused, selected })}
            data-rowindex={idx}
            data-index={idx}
            data-file-path={row.getValue("path") as string}
            style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualStart}px)`,
            }}
            onDoubleClick={(e) => {
                fireAndForget(() =>
                    openPreviewEntry(model, row.original, connection, { forceNewBlock: e.ctrlKey || e.metaKey })
                );
                setSearch("");
                globalStore.set(model.directorySearchActive, false);
            }}
            onClick={(e) => handleRowClick(e, row, idx)}
            onContextMenu={(e) => handleFileContextMenu(e, row.original, idx)}
            ref={setRowRef}
        >
            {row.getVisibleCells().map((cell) => {
                const isEditingName =
                    cell.column.id === "name" &&
                    editingRename != null &&
                    editingRename.path === (row.getValue("path") as string);
                return (
                    <div
                        className={clsx("dir-table-body-cell", "col-" + cell.column.id)}
                        key={cell.id}
                        style={{ width: `calc(var(--col-${cell.column.id}-size) * 1px)` }}
                    >
                        {isEditingName ? (
                            <InlineRenameInput
                                defaultValue={row.getValue("name") as string}
                                onCommit={(newName) => {
                                    const oldPath = row.getValue("path") as string;
                                    const fileName = row.getValue("name") as string;
                                    const trimmed = newName.trim();
                                    if (trimmed !== "" && trimmed !== fileName) {
                                        const lastInstance = oldPath.lastIndexOf(fileName);
                                        const newPath = oldPath.substring(0, lastInstance) + trimmed;
                                        console.log(`replacing ${fileName} with ${trimmed}: ${oldPath}`);
                                        handleRename(model, oldPath, newPath, row.original.isdir, setErrorMsg);
                                    }
                                    setEditingRename(null);
                                }}
                                onCancel={() => setEditingRename(null)}
                            />
                        ) : (
                            flexRender(cell.column.columnDef.cell, cell.getContext())
                        )}
                    </div>
                );
            })}
        </div>
    );
});

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
    const editingRenameAtom = useState(
        atom(null) as PrimitiveAtom<{ path: string; isDir: boolean } | null>
    )[0];
    const editingRename = useAtomValue(editingRenameAtom);

    // VCS 目录树状态（一次 RPC + 两套索引，见 ./vcs-tree-status.ts；与 Explorer 树共用 hook）
    const vcsStatus = useDirectoryVcsTreeStatus(model, env.rpc, dirPath, conn, refreshVersion);

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
            // Ctrl/Cmd+A：全选当前可见行（不含 `..` 上级行，与既有 dotdot 处理一致）。
            if (checkKeyPressed(waveEvent, "Cmd:a") || checkKeyPressed(waveEvent, "Ctrl:a")) {
                // 只用当前筛选结果；`..` 上级行的 path 指向父目录，不该进选区。
                const selectable = filteredData
                    .map((fileInfo) => fileInfo.path)
                    .filter((path) => path != null && path !== "");
                setSelectedPaths(new Set(selectable));
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
            if (checkKeyPressed(waveEvent, "Delete") || checkKeyPressed(waveEvent, "Cmd:Backspace")) {
                const selectedFileInfos = filteredData.filter((fileInfo) => selectedPaths.has(fileInfo.path));
                if (selectedFileInfos.length === 0) {
                    return true;
                }
                handleFileDeletes(model, selectedFileInfos, setErrorMsg);
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
                    if (!entryManagerProps && editingRename == null) {
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
                    editingRenameAtom={editingRenameAtom}
                    newFile={newFile}
                    newDirectory={newDirectory}
                    vcsStatus={vcsStatus}
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
