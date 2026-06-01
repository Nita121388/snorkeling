// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { BlockNodeModel } from "@/app/block/blocktypes";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { globalStore } from "@/app/store/jotaiStore";
import type { TabModel } from "@/app/store/tab-model";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { getLayoutModelForStaticTab, NavigateDirection } from "@/layout/index";
import {
    createBlock,
    createBlockSplitHorizontally,
    createBlockSplitVertically,
    getBlockComponentModel,
    getOverrideConfigAtom,
    refocusNode,
} from "@/store/global";
import * as WOS from "@/store/wos";
import { goHistory, goHistoryBack, goHistoryForward } from "@/util/historyutil";
import { checkKeyPressed } from "@/util/keyutil";
import { addOpenMenuItems } from "@/util/previewutil";
import { base64ToString, fireAndForget, isBlank, jotaiLoadableValue, stringToBase64 } from "@/util/util";
import { formatRemoteUri } from "@/util/waveutil";
import clsx from "clsx";
import { Atom, atom, Getter, PrimitiveAtom, WritableAtom } from "jotai";
import { loadable } from "jotai/utils";
import type * as MonacoTypes from "monaco-editor";
import { createRef } from "react";
import { PreviewView } from "./preview";
import { makeDirectoryDefaultMenuItems } from "./preview-directory-utils";
import {
    PreviewLiveScrollSyncMetaKey,
    PreviewLiveSourceBlockMetaKey,
    resolveLivePreviewBlockIdForSource,
} from "./preview-live";
import {
    applyExplorerRootForDirectoryNavigation,
    PreviewDirectoryDisplayMode,
    PreviewExplorerRootMetaKey,
    PreviewOpenTargetDirection,
    resolvePreviewDirectoryDisplayMode,
    resolvePreviewOpenTargetDirection,
} from "./preview-navigation";
import type { PreviewEnv } from "./previewenv";

// TODO drive this using config
const BOOKMARKS: { label: string; path: string }[] = [
    { label: "Home", path: "~" },
    { label: "Desktop", path: "~/Desktop" },
    { label: "Downloads", path: "~/Downloads" },
    { label: "Documents", path: "~/Documents" },
    { label: "Root", path: "/" },
];

const MaxFileSize = 1024 * 1024 * 10; // 10MB
const MaxCSVSize = 1024 * 1024 * 1; // 1MB

const PreviewOpenTargetMetaKey = "preview:open-target";
const PreviewDirectoryDisplayMetaKey = "preview:directory-display";
const PreviewDefaultOpenTargetSettingKey = "preview:defaultopentarget";
const PreviewDefaultDirectoryDisplaySettingKey = "preview:defaultdirectorydisplay";
const PreviewSearchLineMetaKey = "preview:searchline";
const liveScrollSourceLineAtoms = new Map<string, PrimitiveAtom<number | null>>();
const liveScrollSourceStateAtoms = new Map<string, PrimitiveAtom<LiveScrollSourceState>>();

export type LiveScrollSourceState = {
    sequence: number;
    origin: "editor" | "preview" | "none";
    previewControlUntil: number;
    bottomScrollIntent: boolean;
    scrollTop: number;
    previousScrollTop: number;
    scrollHeight: number;
    viewportHeight: number;
    direction: "up" | "down" | "none";
    isAtBottom: boolean;
    remainingPx: number;
};

const DefaultLiveScrollSourceState: LiveScrollSourceState = {
    sequence: 0,
    origin: "none",
    previewControlUntil: 0,
    bottomScrollIntent: false,
    scrollTop: 0,
    previousScrollTop: 0,
    scrollHeight: 0,
    viewportHeight: 0,
    direction: "none",
    isAtBottom: false,
    remainingPx: Number.POSITIVE_INFINITY,
};

type PreviewOpenPathOptions = {
    lineNumber?: number;
    forceNewBlock?: boolean;
    forceCurrentBlock?: boolean;
    editMode?: boolean;
};

type CopyPathStatus = "idle" | "copied" | "failed";

function openTargetToNavigateDirection(direction: PreviewOpenTargetDirection): NavigateDirection | null {
    switch (direction) {
        case "left":
            return NavigateDirection.Left;
        case "right":
            return NavigateDirection.Right;
        case "up":
            return NavigateDirection.Up;
        case "down":
            return NavigateDirection.Down;
        default:
            return null;
    }
}

function openTargetSymbol(direction: PreviewOpenTargetDirection): string {
    switch (direction) {
        case "left":
            return "←";
        case "right":
            return "→";
        case "up":
            return "↑";
        case "down":
            return "↓";
        default:
            return "🧭";
    }
}

function openTargetLabel(direction: PreviewOpenTargetDirection): string {
    switch (direction) {
        case "left":
            return "← Left Block";
        case "right":
            return "→ Right Block";
        case "up":
            return "↑ Upper Block";
        case "down":
            return "↓ Lower Block";
        default:
            return "🧭 Current Block";
    }
}

const textApplicationMimetypes = [
    "application/sql",
    "application/x-subrip",
    "application/x-php",
    "application/x-pem-file",
    "application/x-httpd-php",
    "application/liquid",
    "application/graphql",
    "application/javascript",
    "application/typescript",
    "application/x-javascript",
    "application/x-typescript",
    "application/dart",
    "application/vnd.dart",
    "application/x-ruby",
    "application/sql",
    "application/wasm",
    "application/x-latex",
    "application/x-sh",
    "application/x-python",
    "application/x-awk",
];

function isTextFile(mimeType: string): boolean {
    if (mimeType == null) {
        return false;
    }
    return (
        mimeType.startsWith("text/") ||
        textApplicationMimetypes.includes(mimeType) ||
        (mimeType.startsWith("application/") &&
            (mimeType.includes("json") || mimeType.includes("yaml") || mimeType.includes("toml"))) ||
        mimeType.includes("xml")
    );
}

function isStreamingType(mimeType: string): boolean {
    if (mimeType == null) {
        return false;
    }
    return (
        mimeType.startsWith("application/pdf") ||
        mimeType.startsWith("video/") ||
        mimeType.startsWith("audio/") ||
        mimeType.startsWith("image/")
    );
}

function isMarkdownLike(mimeType: string): boolean {
    if (mimeType == null) {
        return false;
    }
    return mimeType.startsWith("text/markdown") || mimeType.startsWith("text/mdx");
}

function iconForFile(mimeType: string): string {
    if (mimeType == null) {
        mimeType = "unknown";
    }
    if (mimeType == "application/pdf") {
        return "file-pdf";
    } else if (mimeType.startsWith("image/")) {
        return "image";
    } else if (mimeType.startsWith("video/")) {
        return "film";
    } else if (mimeType.startsWith("audio/")) {
        return "headphones";
    } else if (isMarkdownLike(mimeType)) {
        return "file-lines";
    } else if (mimeType == "text/csv") {
        return "file-csv";
    } else if (isTextFile(mimeType)) {
        return "file-code";
    } else {
        return "file";
    }
}

export function getLiveScrollSourceLineAtom(blockId: string): PrimitiveAtom<number | null> {
    let lineAtom = liveScrollSourceLineAtoms.get(blockId);
    if (lineAtom == null) {
        lineAtom = atom(null) as PrimitiveAtom<number | null>;
        liveScrollSourceLineAtoms.set(blockId, lineAtom);
    }
    return lineAtom;
}

export function getLiveScrollSourceStateAtom(blockId: string): PrimitiveAtom<LiveScrollSourceState> {
    let stateAtom = liveScrollSourceStateAtoms.get(blockId);
    if (stateAtom == null) {
        stateAtom = atom(DefaultLiveScrollSourceState) as PrimitiveAtom<LiveScrollSourceState>;
        liveScrollSourceStateAtoms.set(blockId, stateAtom);
    }
    return stateAtom;
}

function deriveExplorerRootPath(fileInfo: FileInfo | null, fallbackPath: string): string {
    if (fileInfo?.isdir && !isBlank(fileInfo.path)) {
        return fileInfo.path;
    }
    if (!isBlank(fileInfo?.dir)) {
        return fileInfo.dir;
    }
    if (!isBlank(fallbackPath)) {
        return fallbackPath;
    }
    return "~";
}

function normalizeSearchTargetLine(val: any): number | null {
    if (typeof val !== "number" || !Number.isFinite(val)) {
        return null;
    }
    return Math.max(1, Math.floor(val));
}

function normalizePath(filePath: string): string {
    return (filePath ?? "").replace(/\\/g, "/").replace(/\/+/g, "/");
}

export class PreviewModel implements ViewModel {
    viewType: string;
    blockId: string;
    nodeModel: BlockNodeModel;
    tabModel: TabModel;
    noPadding?: Atom<boolean>;
    blockAtom: Atom<Block>;
    viewIcon: Atom<string | IconButtonDecl>;
    viewName: Atom<string>;
    viewText: Atom<HeaderElem[]>;
    preIconButton: Atom<IconButtonDecl>;
    endIconButtons: Atom<IconButtonDecl[]>;
    hideViewName: Atom<boolean>;
    previewTextRef: React.RefObject<HTMLDivElement>;
    editMode: Atom<boolean>;
    canPreview: PrimitiveAtom<boolean>;
    specializedView: Atom<Promise<{ specializedView?: string; errorStr?: string }>>;
    loadableSpecializedView: Atom<Loadable<{ specializedView?: string; errorStr?: string }>>;
    manageConnection: Atom<boolean>;
    connStatus: Atom<ConnStatus>;
    filterOutNowsh?: Atom<boolean>;

    metaFilePath: Atom<string>;
    statFilePath: Atom<Promise<string>>;
    loadableFileInfo: Atom<Loadable<FileInfo>>;
    connection: Atom<Promise<string>>;
    connectionImmediate: Atom<string>;
    statFile: Atom<Promise<FileInfo>>;
    fullFile: Atom<Promise<FileData>>;
    fileMimeType: Atom<Promise<string>>;
    fileMimeTypeLoadable: Atom<Loadable<string>>;
    fileContentSaved: PrimitiveAtom<string | null>;
    fileContent: WritableAtom<Promise<string>, [string], void>;
    newFileContent: PrimitiveAtom<string | null>;
    connectionError: PrimitiveAtom<string>;
    errorMsgAtom: PrimitiveAtom<ErrorMsg>;
    copyPathStatus: PrimitiveAtom<CopyPathStatus>;
    copyPathStatusResetTimer: number | null;

    openFileModal: PrimitiveAtom<boolean>;
    openFileModalDelay: PrimitiveAtom<boolean>;
    openFileError: PrimitiveAtom<string>;
    openFileModalGiveFocusRef: React.RefObject<() => boolean>;

    markdownShowToc: PrimitiveAtom<boolean>;
    liveSourceBlockId: Atom<string | null>;
    liveSourceBlock: Atom<Block | null>;
    liveSourceModel: Atom<PreviewModel | null>;
    liveSourceFilePath: Atom<string | null>;
    liveSourceConnection: Atom<string | null>;
    liveSourceFileContent: Atom<Promise<string>>;
    liveSourceScrollSyncEnabled: Atom<boolean>;
    liveSourceScrollLine: Atom<number | null>;
    liveSourceScrollState: Atom<LiveScrollSourceState>;
    livePreviewBlockId: PrimitiveAtom<string | null>;
    livePreviewOpenBlockId: Atom<string | null>;
    liveScrollSyncEnabled: Atom<boolean>;
    liveScrollSourceLine: PrimitiveAtom<number | null>;
    liveScrollSourceState: PrimitiveAtom<LiveScrollSourceState>;

    monacoRef: React.RefObject<MonacoTypes.editor.IStandaloneCodeEditor>;
    searchTargetLine: Atom<number | null>;

    directoryDisplayMode: Atom<PreviewDirectoryDisplayMode>;
    explorerRootPath: Atom<string>;
    showHiddenFiles: PrimitiveAtom<boolean>;
    refreshVersion: PrimitiveAtom<number>;
    directorySearchActive: PrimitiveAtom<boolean>;
    directoryKeyDownHandler: (waveEvent: WaveKeyboardEvent) => boolean;
    codeEditKeyDownHandler: (waveEvent: WaveKeyboardEvent) => boolean;
    env: PreviewEnv;

    constructor({ blockId, nodeModel, tabModel, waveEnv }: ViewModelInitType) {
        this.viewType = "preview";
        this.blockId = blockId;
        this.nodeModel = nodeModel;
        this.tabModel = tabModel;
        this.env = waveEnv;
        const showHiddenFiles = globalStore.get(this.env.getSettingsKeyAtom("preview:showhiddenfiles")) ?? true;
        this.showHiddenFiles = atom<boolean>(showHiddenFiles);
        this.refreshVersion = atom(0);
        this.directorySearchActive = atom(false);
        this.previewTextRef = createRef();
        this.openFileModal = atom(false);
        this.openFileModalDelay = atom(false);
        this.openFileError = atom(null) as PrimitiveAtom<string>;
        this.copyPathStatus = atom("idle") as PrimitiveAtom<CopyPathStatus>;
        this.copyPathStatusResetTimer = null;
        this.openFileModalGiveFocusRef = createRef();
        this.manageConnection = atom(true);
        this.blockAtom = this.env.wos.getWaveObjectAtom<Block>(`block:${blockId}`);
        this.directoryDisplayMode = atom((get) => this.getDirectoryDisplayMode(get));
        this.explorerRootPath = atom((get) => {
            const storedRoot = get(this.blockAtom)?.meta?.[PreviewExplorerRootMetaKey];
            if (!isBlank(storedRoot)) {
                return storedRoot;
            }
            const fallbackPath = get(this.metaFilePath);
            const fileInfo = jotaiLoadableValue(get(this.loadableFileInfo), null);
            return deriveExplorerRootPath(fileInfo, fallbackPath);
        });
        this.markdownShowToc = atom(false);
        this.filterOutNowsh = atom(true);
        this.monacoRef = createRef();
        this.searchTargetLine = atom((get) =>
            normalizeSearchTargetLine(get(this.blockAtom)?.meta?.[PreviewSearchLineMetaKey])
        );
        this.liveSourceBlockId = atom((get) => get(this.blockAtom)?.meta?.[PreviewLiveSourceBlockMetaKey] ?? null);
        this.liveSourceBlock = atom((get) => {
            const sourceBlockId = get(this.liveSourceBlockId);
            if (isBlank(sourceBlockId)) {
                return null;
            }
            const sourceBlock = get(this.env.wos.getWaveObjectAtom<Block>(`block:${sourceBlockId}`));
            if (sourceBlock == null || sourceBlock.meta?.view !== "preview") {
                return null;
            }
            return sourceBlock;
        });
        this.liveSourceModel = atom((get) => {
            const sourceBlockId = get(this.liveSourceBlockId);
            if (isBlank(sourceBlockId) || get(this.liveSourceBlock) == null) {
                return null;
            }
            const sourceModel = getBlockComponentModel(sourceBlockId)?.viewModel;
            if (sourceModel?.viewType !== "preview") {
                return null;
            }
            return sourceModel as PreviewModel;
        });
        this.liveSourceFilePath = atom((get) => {
            const sourceModel = get(this.liveSourceModel);
            if (sourceModel != null) {
                return get(sourceModel.metaFilePath);
            }
            return get(this.liveSourceBlock)?.meta?.file ?? null;
        });
        this.liveSourceConnection = atom((get) => {
            const sourceModel = get(this.liveSourceModel);
            if (sourceModel != null) {
                return get(sourceModel.connectionImmediate);
            }
            return get(this.liveSourceBlock)?.meta?.connection ?? null;
        });
        this.liveSourceScrollSyncEnabled = atom((get) => {
            const sourceBlock = get(this.liveSourceBlock);
            if (sourceBlock == null) {
                return false;
            }
            return sourceBlock.meta?.[PreviewLiveScrollSyncMetaKey] !== false;
        });
        this.liveSourceScrollLine = atom((get) => {
            const sourceBlockId = get(this.liveSourceBlockId);
            if (isBlank(sourceBlockId)) {
                return null;
            }
            return get(getLiveScrollSourceLineAtom(sourceBlockId));
        });
        this.liveSourceScrollState = atom((get) => {
            const sourceBlockId = get(this.liveSourceBlockId);
            if (isBlank(sourceBlockId)) {
                return DefaultLiveScrollSourceState;
            }
            return get(getLiveScrollSourceStateAtom(sourceBlockId));
        });
        this.livePreviewBlockId = atom(null) as PrimitiveAtom<string | null>;
        globalStore.set(this.livePreviewBlockId, this.findLivePreviewBlockForSource());
        this.livePreviewOpenBlockId = atom((get) => {
            const tabBlockIds = get(this.tabModel.tabAtom)?.blockids ?? [];
            const cachedBlockId = get(this.livePreviewBlockId);
            return resolveLivePreviewBlockIdForSource(
                this.blockId,
                tabBlockIds,
                (candidateBlockId) => get(this.env.wos.getWaveObjectAtom<Block>(`block:${candidateBlockId}`)),
                cachedBlockId
            );
        });
        this.liveScrollSyncEnabled = atom((get) => get(this.blockAtom)?.meta?.[PreviewLiveScrollSyncMetaKey] !== false);
        this.liveScrollSourceLine = getLiveScrollSourceLineAtom(this.blockId);
        this.liveScrollSourceState = getLiveScrollSourceStateAtom(this.blockId);
        this.connectionError = atom("");
        this.errorMsgAtom = atom(null) as PrimitiveAtom<ErrorMsg | null>;
        this.viewIcon = atom((get) => {
            const blockData = get(this.blockAtom);
            if (blockData?.meta?.icon) {
                return blockData.meta.icon;
            }
            const connStatus = get(this.connStatus);
            if (connStatus?.status != "connected") {
                return null;
            }
            const mimeTypeLoadable = get(this.fileMimeTypeLoadable);
            const mimeType = jotaiLoadableValue(mimeTypeLoadable, "");
            if (mimeType == "directory") {
                return {
                    elemtype: "iconbutton",
                    icon: "folder-open",
                    longClick: (e: React.MouseEvent<any>) => {
                        const menuItems: ContextMenuItem[] = BOOKMARKS.map((bookmark) => ({
                            label: `Go to ${bookmark.label} (${bookmark.path})`,
                            click: () => this.goHistory(bookmark.path, undefined, bookmark.path),
                        }));
                        ContextMenuModel.getInstance().showContextMenu(menuItems, e);
                    },
                };
            }
            return iconForFile(mimeType);
        });
        this.editMode = atom((get) => {
            const blockData = get(this.blockAtom);
            return blockData?.meta?.edit ?? false;
        });
        this.viewName = atom("Preview");
        this.hideViewName = atom(true);
        this.viewText = atom((get) => {
            let headerPath = get(this.metaFilePath);
            const connStatus = get(this.connStatus);
            if (connStatus?.status != "connected") {
                return [
                    {
                        elemtype: "text",
                        text: headerPath,
                        className: "preview-filename",
                    },
                ];
            }
            const loadableSV = get(this.loadableSpecializedView);
            const isCeView = loadableSV.state == "hasData" && loadableSV.data.specializedView == "codeedit";
            const isDirectoryView = loadableSV.state == "hasData" && loadableSV.data.specializedView == "directory";
            const isLivePreviewView =
                loadableSV.state == "hasData" && loadableSV.data.specializedView == "markdownlivepreview";
            const mimeType = jotaiLoadableValue(get(this.fileMimeTypeLoadable), "");
            const isMarkdownView = isMarkdownLike(mimeType);
            const directoryDisplayMode = get(this.directoryDisplayMode);
            const explorerActive = directoryDisplayMode === "tree" && isDirectoryView;
            const loadableFileInfo = get(this.loadableFileInfo);
            const liveSourcePath = get(this.liveSourceFilePath);
            if (isLivePreviewView && !isBlank(liveSourcePath)) {
                headerPath = liveSourcePath;
            } else if (loadableFileInfo.state == "hasData") {
                headerPath = loadableFileInfo.data?.path;
                if (headerPath == "~") {
                    headerPath = `~ (${loadableFileInfo.data?.dir + "/" + loadableFileInfo.data?.name})`;
                }
            }
            if (!isBlank(headerPath) && headerPath != "/" && headerPath.endsWith("/")) {
                headerPath = headerPath.slice(0, -1);
            }
            const copyPathStatus = get(this.copyPathStatus);
            const viewTextChildren: HeaderElem[] = [
                {
                    elemtype: "div",
                    className: "preview-filename-shell",
                    children: [
                        {
                            elemtype: "text",
                            text: headerPath,
                            ref: this.previewTextRef,
                            className: "preview-filename",
                            onClick: () => this.toggleOpenFileModal(),
                        },
                        {
                            elemtype: "iconbutton",
                            icon:
                                copyPathStatus === "copied"
                                    ? "check"
                                    : copyPathStatus === "failed"
                                      ? "triangle-exclamation"
                                      : "copy",
                            title:
                                copyPathStatus === "copied"
                                    ? "Copied"
                                    : copyPathStatus === "failed"
                                      ? "Copy Failed"
                                      : "Copy Full Path",
                            iconColor:
                                copyPathStatus === "copied"
                                    ? "var(--success-color)"
                                    : copyPathStatus === "failed"
                                      ? "var(--error-color)"
                                      : undefined,
                            className: clsx("preview-filename-copy-button", copyPathStatus),
                            click: () => {
                                fireAndForget(() => this.copyCurrentPathToClipboardWithFeedback());
                            },
                        },
                    ],
                },
            ];
            if (isDirectoryView) {
                viewTextChildren.push({
                    elemtype: "iconbutton",
                    icon: <span className="text-[12px] leading-none">{explorerActive ? "☰" : "🌳"}</span>,
                    iconColor: explorerActive ? "var(--accent-color)" : undefined,
                    title: explorerActive ? "Switch To List View" : "Switch To Tree View",
                    click: () => {
                        fireAndForget(() => this.toggleDirectoryDisplayMode());
                    },
                });
            }
            if (isDirectoryView || explorerActive) {
                const currentDirection = this.getOpenTargetDirection(get);
                viewTextChildren.push({
                    elemtype: "menubutton",
                    text: openTargetSymbol(currentDirection),
                    title: "Open files/folders in directional block",
                    className: "compact-open-target-menubutton",
                    items: this.makeOpenTargetMenuItems(currentDirection),
                });
            }
            let saveClassName = "grey";
            if (get(this.newFileContent) !== null) {
                saveClassName = "green";
            }
            if (isCeView) {
                const fileInfo = globalStore.get(this.loadableFileInfo);
                if (fileInfo.state != "hasData") {
                    viewTextChildren.push({
                        elemtype: "textbutton",
                        text: "Loading ...",
                        className: clsx(`grey rounded-[4px] !py-[2px] !px-[10px] text-[11px] font-[500]`),
                        onClick: () => {},
                    });
                } else if (fileInfo.data.readonly) {
                    viewTextChildren.push({
                        elemtype: "textbutton",
                        text: "Read Only",
                        className: clsx(`yellow rounded-[4px] !py-[2px] !px-[10px] text-[11px] font-[500]`),
                        onClick: () => {},
                    });
                } else {
                    viewTextChildren.push({
                        elemtype: "iconbutton",
                        icon: "floppy-disk",
                        title: "Save",
                        iconColor: saveClassName === "green" ? "var(--accent-color)" : undefined,
                        click: () => fireAndForget(this.handleFileSave.bind(this)),
                    });
                }
                if (get(this.canPreview)) {
                    const previewMenuItems: MenuItem[] = [
                        {
                            label: "Preview Here",
                            onClick: () => fireAndForget(() => this.setEditMode(false)),
                        },
                    ];
                    if (isMarkdownView) {
                        previewMenuItems.push({
                            label: "Open Live Preview Block",
                            onClick: () => fireAndForget(() => this.openLivePreviewBlock()),
                        });
                    }
                    viewTextChildren.push({
                        elemtype: "menubutton",
                        text: "Preview",
                        icon: "eye",
                        title: "Preview Options",
                        className: "compact-open-target-menubutton",
                        items: previewMenuItems,
                    });
                }
                if (!isBlank(get(this.livePreviewOpenBlockId)) && isMarkdownView) {
                    const syncEnabled = get(this.liveScrollSyncEnabled);
                    viewTextChildren.push({
                        elemtype: "iconbutton",
                        icon: syncEnabled ? "link" : "link-slash",
                        title: syncEnabled ? "Disable Live Preview Scroll Sync" : "Enable Live Preview Scroll Sync",
                        iconColor: syncEnabled ? "var(--accent-color)" : undefined,
                        click: () => fireAndForget(() => this.setLiveScrollSyncEnabled(!syncEnabled)),
                    });
                }
            } else if (!isLivePreviewView && get(this.canPreview)) {
                viewTextChildren.push({
                    elemtype: "iconbutton",
                    icon: "pen-to-square",
                    title: "Edit",
                    className: "grey",
                    click: () => fireAndForget(() => this.setEditMode(true)),
                });
            }
            return [
                {
                    elemtype: "div",
                    children: viewTextChildren,
                },
            ] as HeaderElem[];
        });
        this.preIconButton = atom((get) => {
            const connStatus = get(this.connStatus);
            if (connStatus?.status != "connected") {
                return null;
            }
            const mimeType = jotaiLoadableValue(get(this.fileMimeTypeLoadable), "");
            const metaPath = get(this.metaFilePath);
            if (mimeType == "directory" && metaPath == "/") {
                return null;
            }
            return {
                elemtype: "iconbutton",
                icon: "chevron-left",
                click: this.goParentDirectory.bind(this),
            };
        });
        this.endIconButtons = atom((get) => {
            const connStatus = get(this.connStatus);
            if (connStatus?.status != "connected") {
                return null;
            }
            const mimeType = jotaiLoadableValue(get(this.fileMimeTypeLoadable), "");
            const loadableSV = get(this.loadableSpecializedView);
            const isCeView = loadableSV.state == "hasData" && loadableSV.data.specializedView == "codeedit";
            const hasUnsavedChanges = get(this.newFileContent) != null;
            const explorerActive = get(this.directoryDisplayMode) === "tree" && mimeType == "directory";
            const directorySearchActive = get(this.directorySearchActive);
            const vcsButton: IconButtonDecl = {
                elemtype: "iconbutton",
                icon: "code-branch",
                title: "Version Control",
                click: () => fireAndForget(() => this.openVersionControlBlock()),
            };
            if (!explorerActive && !mimeType) {
                return null;
            }
            const buttons: IconButtonDecl[] = [vcsButton];
            if (mimeType == "directory") {
                buttons.push({
                    elemtype: "iconbutton",
                    icon: "magnifying-glass",
                    iconColor: directorySearchActive ? "var(--accent-color)" : undefined,
                    title: directorySearchActive ? "Show Explorer Tree" : "Search File Contents",
                    click: () => fireAndForget(() => this.toggleDirectorySearch()),
                });
            }
            if (mimeType == "directory") {
                const showHiddenFiles = get(this.showHiddenFiles);
                buttons.push({
                    elemtype: "iconbutton",
                    icon: showHiddenFiles ? "eye" : "eye-slash",
                    title: showHiddenFiles ? "Hide Hidden Files" : "Show Hidden Files",
                    click: () => {
                        globalStore.set(this.showHiddenFiles, (prev) => !prev);
                    },
                });
            }
            if (!isCeView && isMarkdownLike(mimeType)) {
                buttons.push({
                    elemtype: "iconbutton",
                    icon: "book",
                    title: "Table of Contents",
                    click: () => this.markdownShowTocToggle(),
                });
            }
            if ((!isCeView && mimeType) || explorerActive || (isCeView && mimeType && !hasUnsavedChanges)) {
                buttons.push({
                    elemtype: "iconbutton",
                    icon: "arrows-rotate",
                    title: "Refresh",
                    click: () => this.refresh(),
                });
            }
            if (buttons.length > 0) {
                return buttons;
            }
            return null;
        });
        this.metaFilePath = atom<string>((get) => {
            const file = get(this.blockAtom)?.meta?.file;
            if (isBlank(file)) {
                return "~";
            }
            return file;
        });
        this.statFilePath = atom<Promise<string>>(async (get) => {
            const fileInfo = await get(this.statFile);
            return fileInfo?.path;
        });
        this.connection = atom<Promise<string>>(async (get) => {
            const connName = get(this.blockAtom)?.meta?.connection;
            try {
                await this.env.rpc.ConnEnsureCommand(TabRpcClient, { connname: connName }, { timeout: 60000 });
                globalStore.set(this.connectionError, "");
            } catch (e) {
                globalStore.set(this.connectionError, e as string);
            }
            return connName;
        });
        this.connectionImmediate = atom<string>((get) => {
            return get(this.blockAtom)?.meta?.connection;
        });
        this.statFile = atom<Promise<FileInfo>>(async (get) => {
            get(this.refreshVersion);
            const fileName = get(this.metaFilePath);
            const path = await this.formatRemoteUri(fileName, get);
            if (fileName == null) {
                return null;
            }
            try {
                const statFile = await this.env.rpc.FileInfoCommand(TabRpcClient, {
                    info: {
                        path,
                    },
                });
                return statFile;
            } catch (e) {
                const errorStatus: ErrorMsg = {
                    status: "File Read Failed",
                    text: `${e}`,
                };
                globalStore.set(this.errorMsgAtom, errorStatus);
            }
        });
        this.fileMimeType = atom<Promise<string>>(async (get) => {
            const fileInfo = await get(this.statFile);
            return fileInfo?.mimetype;
        });
        this.fileMimeTypeLoadable = loadable(this.fileMimeType);
        this.newFileContent = atom(null) as PrimitiveAtom<string | null>;
        this.goParentDirectory = this.goParentDirectory.bind(this);

        const fullFileAtom = atom<Promise<FileData>>(async (get) => {
            get(this.refreshVersion); // Subscribe to refreshVersion to trigger re-fetch
            const fileName = get(this.metaFilePath);
            const path = await this.formatRemoteUri(fileName, get);
            if (fileName == null) {
                return null;
            }
            try {
                const file = await this.env.rpc.FileReadCommand(TabRpcClient, {
                    info: {
                        path,
                    },
                });
                return file;
            } catch (e) {
                const errorStatus: ErrorMsg = {
                    status: "File Read Failed",
                    text: `${e}`,
                };
                globalStore.set(this.errorMsgAtom, errorStatus);
            }
        });

        this.fileContentSaved = atom(null) as PrimitiveAtom<string | null>;
        const fileContentAtom = atom(
            async (get) => {
                const newContent = get(this.newFileContent);
                if (newContent != null) {
                    return newContent;
                }
                const savedContent = get(this.fileContentSaved);
                if (savedContent != null) {
                    return savedContent;
                }
                const fullFile = await get(fullFileAtom);
                return base64ToString(fullFile?.data64);
            },
            (_, set, update: string) => {
                set(this.fileContentSaved, update);
            }
        );

        this.fullFile = fullFileAtom;
        this.fileContent = fileContentAtom;
        this.liveSourceFileContent = atom(async (get) => {
            const sourceModel = get(this.liveSourceModel);
            if (sourceModel != null) {
                return await get(sourceModel.fileContent);
            }
            const sourcePath = get(this.liveSourceFilePath);
            if (isBlank(sourcePath)) {
                return "";
            }
            const sourceConnection = get(this.liveSourceConnection);
            const path = formatRemoteUri(sourcePath, sourceConnection);
            try {
                const file = await this.env.rpc.FileReadCommand(TabRpcClient, {
                    info: {
                        path,
                    },
                });
                return base64ToString(file?.data64);
            } catch (e) {
                const errorStatus: ErrorMsg = {
                    status: "File Read Failed",
                    text: `${e}`,
                };
                globalStore.set(this.errorMsgAtom, errorStatus);
                return "";
            }
        });

        this.specializedView = atom<Promise<{ specializedView?: string; errorStr?: string }>>(async (get) => {
            return this.getSpecializedView(get);
        });
        this.loadableSpecializedView = loadable(this.specializedView);
        this.canPreview = atom(false);
        this.loadableFileInfo = loadable(this.statFile);
        this.connStatus = atom((get) => {
            const blockData = get(this.blockAtom);
            const connName = blockData?.meta?.connection;
            const connAtom = this.env.getConnStatusAtom(connName);
            return get(connAtom);
        });

        this.noPadding = atom(true);
    }

    markdownShowTocToggle() {
        globalStore.set(this.markdownShowToc, !globalStore.get(this.markdownShowToc));
    }

    get viewComponent(): ViewComponent {
        return PreviewView;
    }

    async getSpecializedView(getFn: Getter): Promise<{ specializedView?: string; errorStr?: string }> {
        const liveSourceBlockId = getFn(this.liveSourceBlockId);
        if (!isBlank(liveSourceBlockId)) {
            const sourceModel = getFn(this.liveSourceModel);
            if (sourceModel == null) {
                return { specializedView: "markdownlivepreview" };
            }
            const sourceMimeType = await getFn(sourceModel.fileMimeType);
            if (!isMarkdownLike(sourceMimeType)) {
                return { errorStr: "Live Preview Block only supports Markdown files." };
            }
            return { specializedView: "markdownlivepreview" };
        }

        const mimeType = await getFn(this.fileMimeType);
        const fileInfo = await getFn(this.statFile);
        const fileName = fileInfo?.name;
        const connErr = getFn(this.connectionError);
        const editMode = getFn(this.editMode);
        const genErr = getFn(this.errorMsgAtom);

        if (!fileInfo) {
            return { errorStr: `Load Error: ${genErr?.text}` };
        }
        if (connErr != "") {
            return { errorStr: `Connection Error: ${connErr}` };
        }
        if (fileInfo?.notfound) {
            return { specializedView: "codeedit" };
        }
        if (mimeType == null) {
            return { errorStr: `Unable to determine mimetype for: ${fileInfo.path}` };
        }
        if (isStreamingType(mimeType)) {
            return { specializedView: "streaming" };
        }
        if (!fileInfo) {
            const fileNameStr = fileName ? " " + JSON.stringify(fileName) : "";
            return { errorStr: "File Not Found" + fileNameStr };
        }
        if (fileInfo.size > MaxFileSize) {
            return { errorStr: "File Too Large to Preview (10 MB Max)" };
        }
        if (mimeType == "text/csv" && fileInfo.size > MaxCSVSize) {
            return { errorStr: "CSV File Too Large to Preview (1 MB Max)" };
        }
        if (mimeType == "directory") {
            return { specializedView: "directory" };
        }
        if (mimeType == "text/csv") {
            if (editMode) {
                return { specializedView: "codeedit" };
            }
            return { specializedView: "csv" };
        }
        if (isMarkdownLike(mimeType)) {
            if (editMode) {
                return { specializedView: "codeedit" };
            }
            return { specializedView: "markdown" };
        }
        if (isTextFile(mimeType) || fileInfo.size == 0) {
            return { specializedView: "codeedit" };
        }
        return { errorStr: `Preview (${mimeType})` };
    }

    updateOpenFileModalAndError(isOpen, errorMsg = null) {
        globalStore.set(this.openFileModal, isOpen);
        globalStore.set(this.openFileError, errorMsg);
        if (isOpen) {
            globalStore.set(this.openFileModalDelay, true);
        } else {
            const delayVal = globalStore.get(this.openFileModalDelay);
            if (delayVal) {
                setTimeout(() => {
                    globalStore.set(this.openFileModalDelay, false);
                }, 200);
            }
        }
    }

    toggleOpenFileModal() {
        const modalOpen = globalStore.get(this.openFileModal);
        const delayVal = globalStore.get(this.openFileModalDelay);
        if (!modalOpen && delayVal) {
            return;
        }
        this.updateOpenFileModalAndError(!modalOpen);
    }

    private applyOpenPathOptions(meta: MetaType, options?: PreviewOpenPathOptions): MetaType {
        const nextMeta: Record<string, any> = { ...meta };
        nextMeta[PreviewSearchLineMetaKey] = normalizeSearchTargetLine(options?.lineNumber);
        if (options?.editMode != null) {
            nextMeta.edit = options.editMode;
        }
        return nextMeta as MetaType;
    }

    async goHistory(newPath: string, options?: PreviewOpenPathOptions, directoryPath?: string | null) {
        let fileName = globalStore.get(this.metaFilePath);
        if (fileName == null) {
            fileName = "";
        }
        const blockMeta = globalStore.get(this.blockAtom)?.meta;
        const updateMeta = applyExplorerRootForDirectoryNavigation(
            this.applyOpenPathOptions(goHistory("file", fileName, newPath, blockMeta), options) as Record<string, any>,
            this.getDirectoryDisplayMode(),
            directoryPath
        );
        if (updateMeta == null) {
            return;
        }
        const blockOref = WOS.makeORef("block", this.blockId);
        await this.env.services.object.UpdateObjectMeta(blockOref, updateMeta as MetaType);

        // Clear the saved file buffers
        globalStore.set(this.fileContentSaved, null);
        globalStore.set(this.newFileContent, null);
    }

    private makeOpenTargetMenuItems(currentDirection: PreviewOpenTargetDirection): MenuItem[] {
        const options: PreviewOpenTargetDirection[] = ["off", "left", "right", "up", "down"];
        return options.map((direction) => {
            const activeMark = direction === currentDirection ? "✓ " : "";
            return {
                label: `${activeMark}${openTargetLabel(direction)}`,
                onClick: () => {
                    fireAndForget(() => this.setOpenTargetDirection(direction));
                },
            };
        });
    }

    private async toggleDirectoryDisplayMode() {
        const currentMode = this.getDirectoryDisplayMode();
        await this.setDirectoryDisplayMode(currentMode === "tree" ? "list" : "tree");
    }

    private getDirectoryDisplayMode(getFn: Getter = globalStore.get): PreviewDirectoryDisplayMode {
        const blockMeta = getFn(this.blockAtom)?.meta;
        return resolvePreviewDirectoryDisplayMode(
            blockMeta?.[PreviewDirectoryDisplayMetaKey],
            getFn(this.env.getSettingsKeyAtom(PreviewDefaultDirectoryDisplaySettingKey)),
            "tree"
        );
    }

    private async setDirectoryDisplayMode(mode: PreviewDirectoryDisplayMode) {
        const blockMeta = globalStore.get(this.blockAtom)?.meta ?? {};
        const nextMeta: Record<string, any> = {
            ...(blockMeta as Record<string, any>),
            [PreviewDirectoryDisplayMetaKey]: mode,
        };
        if (mode === "tree") {
            const fileInfo = await globalStore.get(this.statFile);
            const fallbackPath = fileInfo?.path ?? globalStore.get(this.metaFilePath);
            nextMeta[PreviewExplorerRootMetaKey] = deriveExplorerRootPath(fileInfo, fallbackPath);
        } else {
            globalStore.set(this.directorySearchActive, false);
        }
        const blockOref = WOS.makeORef("block", this.blockId);
        await this.env.services.object.UpdateObjectMeta(blockOref, nextMeta as any);
    }

    async toggleDirectorySearch() {
        const explorerActive = this.getDirectoryDisplayMode() === "tree";
        if (!explorerActive) {
            await this.setDirectoryDisplayMode("tree");
            globalStore.set(this.directorySearchActive, true);
            return;
        }
        globalStore.set(this.directorySearchActive, (prev) => !prev);
    }

    private getOpenTargetDirection(getFn: Getter = globalStore.get): PreviewOpenTargetDirection {
        const blockMeta = getFn(this.blockAtom)?.meta;
        return resolvePreviewOpenTargetDirection(
            blockMeta?.[PreviewOpenTargetMetaKey],
            getFn(this.env.getSettingsKeyAtom(PreviewDefaultOpenTargetSettingKey)),
            "right"
        );
    }

    private async setOpenTargetDirection(direction: PreviewOpenTargetDirection) {
        const blockMeta = globalStore.get(this.blockAtom)?.meta ?? {};
        const blockOref = WOS.makeORef("block", this.blockId);
        await this.env.services.object.UpdateObjectMeta(blockOref, {
            ...blockMeta,
            [PreviewOpenTargetMetaKey]: direction,
        } as any);
    }

    private findDirectionalPreviewBlock(direction: PreviewOpenTargetDirection): string {
        const navDirection = openTargetToNavigateDirection(direction);
        if (navDirection == null) {
            return null;
        }
        const layoutModel = getLayoutModelForStaticTab();
        const targetBlockIds = layoutModel.findBlockIdsInDirection(this.blockId, navDirection);
        for (const targetBlockId of targetBlockIds) {
            const targetBlock = globalStore.get(this.env.wos.getWaveObjectAtom<Block>(`block:${targetBlockId}`));
            if (targetBlock?.meta?.view !== "preview") {
                continue;
            }
            if (targetBlock?.meta?.edit) {
                continue;
            }
            return targetBlockId;
        }
        return null;
    }

    private focusBlockById(blockId: string) {
        const layoutModel = getLayoutModelForStaticTab();
        const layoutNode = layoutModel.getNodeByBlockId(blockId);
        if (!layoutNode?.id) {
            return;
        }
        layoutModel.focusNode(layoutNode.id);
    }

    private async openPathInPreviewBlock(
        blockId: string,
        newPath: string,
        connection: string,
        options?: PreviewOpenPathOptions
    ): Promise<boolean> {
        const targetBlockAtom = this.env.wos.getWaveObjectAtom<Block>(`block:${blockId}`);
        const targetBlockData = globalStore.get(targetBlockAtom);
        if (!targetBlockData || targetBlockData.meta?.view !== "preview") {
            return false;
        }
        const currentPath = targetBlockData.meta?.file ?? "";
        const updateMeta = this.applyOpenPathOptions(
            goHistory("file", currentPath, newPath, targetBlockData.meta),
            options
        );
        if (updateMeta == null) {
            return false;
        }
        if (options?.editMode == null) {
            updateMeta.edit = false;
        }
        updateMeta.connection = connection;
        await this.env.services.object.UpdateObjectMeta(WOS.makeORef("block", blockId), updateMeta);
        return true;
    }

    private async openPathInCurrentBlock(newPath: string, options?: PreviewOpenPathOptions) {
        const currentPath = globalStore.get(this.metaFilePath);
        if (normalizePath(currentPath) === normalizePath(newPath)) {
            const blockMeta = globalStore.get(this.blockAtom)?.meta ?? {};
            const updateMeta = this.applyOpenPathOptions(blockMeta, options);
            const blockOref = WOS.makeORef("block", this.blockId);
            await this.env.services.object.UpdateObjectMeta(blockOref, updateMeta);
            refocusNode(this.blockId);
            return;
        }
        await this.goHistory(newPath, options);
        refocusNode(this.blockId);
    }

    private async openPathInNewBlock(
        newPath: string,
        direction: PreviewOpenTargetDirection = "off",
        options?: PreviewOpenPathOptions
    ) {
        const connection = await globalStore.get(this.connection);
        const blockMeta: Record<string, any> = {
            view: "preview",
            file: newPath,
            connection,
        };
        const lineNumber = normalizeSearchTargetLine(options?.lineNumber);
        if (lineNumber != null) {
            blockMeta[PreviewSearchLineMetaKey] = lineNumber;
        }
        if (options?.editMode != null) {
            blockMeta.edit = options.editMode;
        }
        const blockDef: BlockDef = {
            meta: blockMeta,
        };
        if (direction === "left") {
            await createBlockSplitHorizontally(blockDef, this.blockId, "before");
            return;
        }
        if (direction === "right") {
            await createBlockSplitHorizontally(blockDef, this.blockId, "after");
            return;
        }
        if (direction === "up") {
            await createBlockSplitVertically(blockDef, this.blockId, "before");
            return;
        }
        if (direction === "down") {
            await createBlockSplitVertically(blockDef, this.blockId, "after");
            return;
        }
        await createBlock(blockDef);
    }

    async openVersionControlBlock() {
        const fileInfo = await globalStore.get(this.statFile);
        if (!fileInfo) {
            return;
        }
        const connection = await globalStore.get(this.connection);
        const selectedFile = fileInfo?.mimetype === "directory" ? "" : fileInfo.path;
        const vcsPath = fileInfo?.mimetype === "directory" ? fileInfo.path : fileInfo.dir;
        const blockDef: BlockDef = {
            meta: {
                view: "vcs",
                connection,
                "vcs:path": vcsPath,
                "vcs:selectedfile": selectedFile,
            } as any,
        };
        await createBlock(blockDef);
    }

    async openPathWithTarget(newPath: string, options?: PreviewOpenPathOptions) {
        if (options?.forceCurrentBlock) {
            await this.openPathInCurrentBlock(newPath, options);
            return;
        }
        if (options?.forceNewBlock) {
            const direction = this.getOpenTargetDirection();
            await this.openPathInNewBlock(newPath, direction, options);
            return;
        }
        const direction = this.getOpenTargetDirection();
        if (direction === "off") {
            await this.goHistory(newPath, options);
            refocusNode(this.blockId);
            return;
        }
        const targetBlockId = this.findDirectionalPreviewBlock(direction);
        if (!targetBlockId) {
            await this.openPathInNewBlock(newPath, direction, options);
            return;
        }
        const sourceConnection = await globalStore.get(this.connection);
        const opened = await this.openPathInPreviewBlock(targetBlockId, newPath, sourceConnection, options);
        if (opened) {
            this.focusBlockById(targetBlockId);
            return;
        }
        await this.openPathInNewBlock(newPath, direction, options);
    }

    async goParentDirectory({ fileInfo = null }: { fileInfo?: FileInfo | null }) {
        // optional parameter needed for recursive case
        const defaultFileInfo = await globalStore.get(this.statFile);
        if (fileInfo === null) {
            fileInfo = defaultFileInfo;
        }
        if (fileInfo == null) {
            this.updateOpenFileModalAndError(false);
            return true;
        }
        try {
            this.updateOpenFileModalAndError(false);
            await this.goHistory(fileInfo.dir, undefined, fileInfo.dir);
            refocusNode(this.blockId);
        } catch (e) {
            globalStore.set(this.openFileError, e.message);
            console.error("Error opening file", fileInfo.dir, e);
        }
    }

    async goHistoryBack() {
        const blockMeta = globalStore.get(this.blockAtom)?.meta;
        const curPath = globalStore.get(this.metaFilePath);
        const updateMeta = goHistoryBack("file", curPath, blockMeta, true);
        if (updateMeta == null) {
            return;
        }
        updateMeta.edit = false;
        (updateMeta as Record<string, any>)[PreviewSearchLineMetaKey] = null;
        const blockOref = WOS.makeORef("block", this.blockId);
        await this.env.services.object.UpdateObjectMeta(blockOref, updateMeta);
    }

    async goHistoryForward() {
        const blockMeta = globalStore.get(this.blockAtom)?.meta;
        const curPath = globalStore.get(this.metaFilePath);
        const updateMeta = goHistoryForward("file", curPath, blockMeta);
        if (updateMeta == null) {
            return;
        }
        updateMeta.edit = false;
        (updateMeta as Record<string, any>)[PreviewSearchLineMetaKey] = null;
        const blockOref = WOS.makeORef("block", this.blockId);
        await this.env.services.object.UpdateObjectMeta(blockOref, updateMeta);
    }

    async setEditMode(edit: boolean) {
        const blockMeta = globalStore.get(this.blockAtom)?.meta;
        const blockOref = WOS.makeORef("block", this.blockId);
        await this.env.services.object.UpdateObjectMeta(blockOref, { ...blockMeta, edit });
    }

    private findLivePreviewBlockForSource(): string {
        const layoutModel = getLayoutModelForStaticTab();
        for (const blockId of layoutModel.findBlockIdsInDirection(this.blockId, NavigateDirection.Right)) {
            if (blockId === this.blockId) {
                continue;
            }
            const blockData = globalStore.get(this.env.wos.getWaveObjectAtom<Block>(`block:${blockId}`));
            if (
                blockData?.meta?.view === "preview" &&
                blockData.meta?.[PreviewLiveSourceBlockMetaKey] === this.blockId
            ) {
                return blockId;
            }
        }
        return null;
    }

    async openLivePreviewBlock() {
        const fileInfo = await globalStore.get(this.statFile);
        const mimeType = await globalStore.get(this.fileMimeType);
        if (!fileInfo || !isMarkdownLike(mimeType)) {
            globalStore.set(this.errorMsgAtom, {
                status: "Live Preview Unavailable",
                text: "Live Preview Block only supports Markdown files.",
            });
            return;
        }
        const existingBlockId = globalStore.get(this.livePreviewOpenBlockId) ?? this.findLivePreviewBlockForSource();
        if (existingBlockId != null) {
            globalStore.set(this.livePreviewBlockId, existingBlockId);
            this.publishCurrentVisibleEditorLine();
            await this.setLiveScrollSyncEnabled(true);
            this.focusBlockById(existingBlockId);
            return;
        }
        const connection = await globalStore.get(this.connection);
        const blockDef: BlockDef = {
            meta: {
                view: "preview",
                file: fileInfo.path,
                connection,
                edit: false,
                [PreviewLiveSourceBlockMetaKey]: this.blockId,
            } as any,
        };
        const livePreviewBlockId = await createBlockSplitHorizontally(blockDef, this.blockId, "after");
        globalStore.set(this.livePreviewBlockId, livePreviewBlockId);
        this.publishCurrentVisibleEditorLine();
        await this.setLiveScrollSyncEnabled(true);
    }

    async setLiveScrollSyncEnabled(enabled: boolean) {
        const blockOref = WOS.makeORef("block", this.blockId);
        await this.env.services.object.UpdateObjectMeta(blockOref, { [PreviewLiveScrollSyncMetaKey]: enabled });
    }

    publishCurrentVisibleEditorLine() {
        const visibleRanges = this.monacoRef.current?.getVisibleRanges();
        const firstVisibleLine = visibleRanges?.[0]?.startLineNumber;
        if (firstVisibleLine != null) {
            globalStore.set(this.liveScrollSourceLine, firstVisibleLine);
        }
    }

    async handleFileSave() {
        const filePath = await globalStore.get(this.statFilePath);
        if (filePath == null) {
            return;
        }
        const newFileContent = globalStore.get(this.newFileContent);
        if (newFileContent == null) {
            console.log("not saving file, newFileContent is null");
            return;
        }
        try {
            await this.env.rpc.FileWriteCommand(TabRpcClient, {
                info: {
                    path: await this.formatRemoteUri(filePath, globalStore.get),
                },
                data64: stringToBase64(newFileContent),
            });
            globalStore.set(this.fileContent, newFileContent);
            globalStore.set(this.newFileContent, null);
            console.log("saved file", filePath);
        } catch (e) {
            const errorStatus: ErrorMsg = {
                status: "Save Failed",
                text: `${e}`,
            };
            globalStore.set(this.errorMsgAtom, errorStatus);
        }
    }

    async handleFileRevert() {
        const fileContent = await globalStore.get(this.fileContent);
        this.monacoRef.current?.setValue(fileContent);
        globalStore.set(this.newFileContent, null);
    }

    async handleOpenFile(filePath: string) {
        const fileInfo = await globalStore.get(this.statFile);
        this.updateOpenFileModalAndError(false);
        if (fileInfo == null) {
            return true;
        }
        try {
            await this.openPathWithTarget(filePath);
        } catch (e) {
            globalStore.set(this.openFileError, e.message);
            console.error("Error opening file", filePath, e);
        }
    }

    async copyCurrentPathToClipboard(): Promise<boolean> {
        const filePath = await globalStore.get(this.statFilePath);
        if (filePath == null) {
            return false;
        }
        const conn = await globalStore.get(this.connection);
        if (conn) {
            await navigator.clipboard.writeText(formatRemoteUri(filePath, conn));
            return true;
        }
        await navigator.clipboard.writeText(filePath);
        return true;
    }

    setCopyPathStatus(status: CopyPathStatus) {
        globalStore.set(this.copyPathStatus, status);
        if (this.copyPathStatusResetTimer != null) {
            window.clearTimeout(this.copyPathStatusResetTimer);
            this.copyPathStatusResetTimer = null;
        }
        if (status === "idle") {
            return;
        }
        this.copyPathStatusResetTimer = window.setTimeout(
            () => {
                globalStore.set(this.copyPathStatus, "idle");
                this.copyPathStatusResetTimer = null;
            },
            status === "copied" ? 1200 : 1600
        );
    }

    async copyCurrentPathToClipboardWithFeedback() {
        try {
            const copied = await this.copyCurrentPathToClipboard();
            this.setCopyPathStatus(copied ? "copied" : "failed");
        } catch (e) {
            this.setCopyPathStatus("failed");
            throw e;
        }
    }

    isSpecializedView(sv: string): boolean {
        const loadableSV = globalStore.get(this.loadableSpecializedView);
        return loadableSV.state == "hasData" && loadableSV.data.specializedView == sv;
    }

    refresh(): void {
        globalStore.set(this.fileContentSaved, null);
        globalStore.set(this.refreshVersion, (v) => v + 1);
    }

    getSettingsMenuItems(): ContextMenuItem[] {
        const defaultFontSize = globalStore.get(this.env.getSettingsKeyAtom("editor:fontsize")) ?? 12;
        const blockData = globalStore.get(this.blockAtom);
        const overrideFontSize = blockData?.meta?.["editor:fontsize"];
        const menuItems: ContextMenuItem[] = [];
        menuItems.push({
            label: "Copy Full Path",
            click: () => fireAndForget(() => this.copyCurrentPathToClipboard()),
        });
        menuItems.push({
            label: "Copy File Name",
            click: () =>
                fireAndForget(async () => {
                    const fileInfo = await globalStore.get(this.statFile);
                    if (fileInfo == null || fileInfo.name == null) {
                        return;
                    }
                    await navigator.clipboard.writeText(fileInfo.name);
                }),
        });
        menuItems.push({ type: "separator" });
        const finfo = jotaiLoadableValue(globalStore.get(this.loadableFileInfo), null);
        addOpenMenuItems(menuItems, globalStore.get(this.connectionImmediate), finfo);
        const loadableSV = globalStore.get(this.loadableSpecializedView);
        const wordWrapAtom = getOverrideConfigAtom(this.blockId, "editor:wordwrap");
        const wordWrap = globalStore.get(wordWrapAtom) ?? false;
        menuItems.push({ type: "separator" });
        if (loadableSV.state == "hasData" && loadableSV.data.specializedView == "codeedit") {
            const fontSizeSubMenu: ContextMenuItem[] = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18].map(
                (fontSize: number) => {
                    return {
                        label: fontSize.toString() + "px",
                        type: "checkbox",
                        checked: overrideFontSize == fontSize,
                        click: () => {
                            this.env.rpc.SetMetaCommand(TabRpcClient, {
                                oref: WOS.makeORef("block", this.blockId),
                                meta: { "editor:fontsize": fontSize },
                            });
                        },
                    };
                }
            );
            fontSizeSubMenu.unshift({
                label: "Default (" + defaultFontSize + "px)",
                type: "checkbox",
                checked: overrideFontSize == null,
                click: () => {
                    this.env.rpc.SetMetaCommand(TabRpcClient, {
                        oref: WOS.makeORef("block", this.blockId),
                        meta: { "editor:fontsize": null },
                    });
                },
            });
            menuItems.push({
                label: "Editor Font Size",
                submenu: fontSizeSubMenu,
            });
            if (globalStore.get(this.newFileContent) != null) {
                menuItems.push({ type: "separator" });
                menuItems.push({
                    label: "Save File",
                    click: () => fireAndForget(this.handleFileSave.bind(this)),
                });
                menuItems.push({
                    label: "Revert File",
                    click: () => fireAndForget(this.handleFileRevert.bind(this)),
                });
            }
            menuItems.push({ type: "separator" });
            menuItems.push({
                label: "Word Wrap",
                type: "checkbox",
                checked: wordWrap,
                click: () =>
                    fireAndForget(async () => {
                        const blockOref = WOS.makeORef("block", this.blockId);
                        await this.env.services.object.UpdateObjectMeta(blockOref, {
                            "editor:wordwrap": !wordWrap,
                        });
                    }),
            });
        }
        if (loadableSV.state == "hasData" && loadableSV.data.specializedView == "directory") {
            menuItems.push({ type: "separator" });
            menuItems.push({ label: "Default Settings", enabled: false });
            menuItems.push(...makeDirectoryDefaultMenuItems(this));
        }
        return menuItems;
    }

    giveFocus(): boolean {
        const openModalOpen = globalStore.get(this.openFileModal);
        if (openModalOpen) {
            this.openFileModalGiveFocusRef.current?.();
            return true;
        }
        if (this.monacoRef.current) {
            this.monacoRef.current.focus();
            return true;
        }
        return false;
    }

    keyDownHandler(e: WaveKeyboardEvent): boolean {
        if (checkKeyPressed(e, "Cmd:ArrowLeft")) {
            fireAndForget(this.goHistoryBack.bind(this));
            return true;
        }
        if (checkKeyPressed(e, "Cmd:ArrowRight")) {
            fireAndForget(this.goHistoryForward.bind(this));
            return true;
        }
        if (checkKeyPressed(e, "Cmd:ArrowUp")) {
            // handle up directory
            fireAndForget(() => this.goParentDirectory({}));
            return true;
        }
        if (checkKeyPressed(e, "Cmd:o")) {
            this.toggleOpenFileModal();
            return true;
        }
        const canPreview = globalStore.get(this.canPreview);
        if (canPreview) {
            if (checkKeyPressed(e, "Cmd:e")) {
                const editMode = globalStore.get(this.editMode);
                fireAndForget(() => this.setEditMode(!editMode));
                return true;
            }
        }
        if (this.directoryKeyDownHandler) {
            const handled = this.directoryKeyDownHandler(e);
            if (handled) {
                return true;
            }
        }
        if (this.codeEditKeyDownHandler) {
            const handled = this.codeEditKeyDownHandler(e);
            if (handled) {
                return true;
            }
        }
        return false;
    }

    async formatRemoteUri(path: string, get: Getter): Promise<string> {
        return formatRemoteUri(path, await get(this.connection));
    }
}
