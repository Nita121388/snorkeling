// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { BlockNodeModel } from "@/app/block/blocktypes";
import type { UnsavedFileModalChoice } from "@/app/modals/unsavedfilemodal";
import type { FileConflictChoice } from "@/app/modals/file-conflict-modal";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { ConnectionOperationTimeoutMs } from "@/app/store/connection-timeout";
import { globalStore } from "@/app/store/jotaiStore";
import { modalsModel } from "@/app/store/modalmodel";
import type { TabModel } from "@/app/store/tab-model";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { SnorkelingBlockKindMetaKey, SnorkelingBlockKindNote } from "@/app/workspace/toggle-block";
import { getLayoutModelForStaticTab, NavigateDirection } from "@/layout/index";
import { getLayoutDataBlockIds } from "@/layout/lib/inlineTabs";
import {
    createBlock,
    createBlockSplitHorizontally,
    createBlockSplitVertically,
    getBlockComponentModel,
    getOverrideConfigAtom,
    refocusNode,
} from "@/store/global";
import { ObjectService } from "@/app/store/services";
import * as WOS from "@/store/wos";
import { goHistory, goHistoryBack, goHistoryForward } from "@/util/historyutil";
import { checkKeyPressed } from "@/util/keyutil";
import { addOpenMenuItems } from "@/util/previewutil";
import {
    base64ToString,
    basename,
    fireAndForget,
    isBlank,
    isLocalConnName,
    jotaiLoadableValue,
    stringToBase64,
} from "@/util/util";
import { formatRemoteUri } from "@/util/waveutil";
import clsx from "clsx";
import { Atom, atom, Getter, PrimitiveAtom, WritableAtom } from "jotai";
import { loadable } from "jotai/utils";
import type * as MonacoTypes from "monaco-editor";
import { createRef } from "react";
import { PreviewView } from "./preview";
import { makeDirectoryDefaultMenuItems } from "./preview-directory-utils";
import { isOpenableForObsidian, loadObsidianVaults, openInObsidianWithPicker } from "./obsidian";
import {
    PreviewLiveScrollSyncMetaKey,
    PreviewLiveSourceBlockMetaKey,
    resolveLivePreviewBlockIdForSource,
} from "./preview-live";
import {
    applyDirectoryNavigationMeta,
    PreviewDefaultDirectoryDisplaySettingKey,
    PreviewDirectoryDisplayMetaKey,
    PreviewDirectoryDisplayMode,
    PreviewExplorerRootMetaKey,
    PreviewOpenTargetDirection,
    PreviewPathIsDirMetaKey,
    resolvePreviewDirectoryDisplayMode,
    resolvePreviewOpenTargetDirectionForBlock,
} from "./preview-navigation";
import {
    discardPreviewSharedDraftIfUnshared,
    getOrCreatePreviewSharedDraftRecord,
    getPreviewSharedDraftRecord,
    getPreviewSharedDraftRecordVersionAtom,
    inlineEditingActiveAtom,
    makePreviewDraftKey,
    migratePreviewSharedDraftRecord,
    previewSharedDraftDebugLog,
    publishPreviewSharedDraftToStorage,
    registerPreviewSharedDraftEditor,
    summarizePreviewDraftContent,
    summarizePreviewSharedDraftRecord,
} from "./preview-shared-draft";
import { getPreviewDisplayPath, isWindowsDrivesPath } from "./preview-windows-drives";
import { resolvePreviewPlugin, shouldPreviewPluginTakeOver } from "./preview-plugin-registry";
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
const PreviewDefaultOpenTargetSettingKey = "preview:defaultopentarget";
const PreviewSearchLineMetaKey = "preview:searchline";
const liveScrollSourceLineAtoms = new Map<string, PrimitiveAtom<number | null>>();
const liveScrollSourceStateAtoms = new Map<string, PrimitiveAtom<LiveScrollSourceState>>();

// Survives BlockInner remount (inline-tab switch / top-level tab switch) so Monaco
// fold/scroll/cursor/selection are restored instead of reset. Keyed by blockId, same
// lifetime approach as liveScrollSource*Atoms above.
const editorViewStateCache = new Map<string, MonacoTypes.editor.ICodeEditorViewState>();

export function getEditorViewState(blockId: string): MonacoTypes.editor.ICodeEditorViewState | undefined {
    return editorViewStateCache.get(blockId);
}

export function setEditorViewState(blockId: string, vs: MonacoTypes.editor.ICodeEditorViewState | undefined): void {
    if (vs == null) {
        editorViewStateCache.delete(blockId);
    } else {
        editorViewStateCache.set(blockId, vs);
    }
}

export function clearEditorViewState(blockId: string): void {
    editorViewStateCache.delete(blockId);
}

// Markdown-preview heading/ordered-list collapse state. Same lifecycle approach as
// editorViewStateCache — survives BlockInner remount on inline-tab / top-level tab switch.
// The cached Set holds heading *element ids* (rehype-slug output with a stable idPrefix),
// so it only round-trips correctly if the Markdown instance regenerates ids deterministically
// (caller-supplied idPrefix derived from blockId+path).
const markdownCollapsedHeadingsCache = new Map<string, Set<string>>();
const markdownCollapsedOLItemsCache = new Map<string, Set<string>>();
const markdownCollapsedTablesCache = new Map<string, Set<string>>();

export function getMarkdownCollapsedHeadings(blockId: string): Set<string> | undefined {
    return markdownCollapsedHeadingsCache.get(blockId);
}

export function setMarkdownCollapsedHeadings(blockId: string, value: Set<string> | undefined): void {
    if (value == null) {
        markdownCollapsedHeadingsCache.delete(blockId);
    } else {
        markdownCollapsedHeadingsCache.set(blockId, value);
    }
}

export function getMarkdownCollapsedOLItems(blockId: string): Set<string> | undefined {
    return markdownCollapsedOLItemsCache.get(blockId);
}

export function setMarkdownCollapsedOLItems(blockId: string, value: Set<string> | undefined): void {
    if (value == null) {
        markdownCollapsedOLItemsCache.delete(blockId);
    } else {
        markdownCollapsedOLItemsCache.set(blockId, value);
    }
}

export function getMarkdownCollapsedTables(blockId: string): Set<string> | undefined {
    return markdownCollapsedTablesCache.get(blockId);
}

export function setMarkdownCollapsedTables(blockId: string, value: Set<string> | undefined): void {
    if (value == null) {
        markdownCollapsedTablesCache.delete(blockId);
    } else {
        markdownCollapsedTablesCache.set(blockId, value);
    }
}

// Markdown-preview viewport scrollTop (px). Survives BlockInner remount on inline-tab / top-level
// tab switch so the user's scroll position is restored when they come back. Disabled when a
// searchTargetLine (block.meta "preview:searchline") jump is pending — that takes precedence.
const markdownScrollPositionCache = new Map<string, number>();

export function getMarkdownScrollPosition(blockId: string): number | undefined {
    return markdownScrollPositionCache.get(blockId);
}

export function setMarkdownScrollPosition(blockId: string, value: number | undefined): void {
    if (value == null || !Number.isFinite(value)) {
        markdownScrollPositionCache.delete(blockId);
    } else {
        markdownScrollPositionCache.set(blockId, value);
    }
}

// Build a stable DOM-id prefix for rehype-slug. blockId is unique per block for the session;
// path disambiguates when the same md is opened in two blocks so their ids never collide.
// Falls back to a random prefix when no caller-supplied key is available (vdom/markdown.preview).
const mdIdPrefixCache = new Map<string, string>();

export function getMarkdownIdPrefix(stableKey: string): string {
    let prefix = mdIdPrefixCache.get(stableKey);
    if (prefix == null) {
        prefix = `m${stableKey.length.toString(36)}-${stableKey.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 24)}-`;
        mdIdPrefixCache.set(stableKey, prefix);
    }
    return prefix;
}

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
    forceInlineTabCurrentBlock?: boolean;
    editMode?: boolean;
    directoryPath?: string | null;
    pathIsDir?: boolean | null;
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
    fileEditKey: Atom<string | null>;
    fileContentSaved: WritableAtom<string | null, [string | null], void>;
    fileContent: WritableAtom<Promise<string>, [string], void>;
    fileContentLoadable: Atom<Loadable<string>>;
    newFileContent: WritableAtom<string | null, [string | null], void>;
    connectionError: PrimitiveAtom<string>;
    errorMsgAtom: PrimitiveAtom<ErrorMsg>;
    copyPathStatus: PrimitiveAtom<CopyPathStatus>;
    copyPathStatusResetTimer: number | null;
    diskBaseContent: PrimitiveAtom<string | null>;
    private _diskBaseUnsub: (() => void) | undefined;

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
        this.diskBaseContent = atom(null) as PrimitiveAtom<string | null>;
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
            const isKnownDirectory =
                loadableFileInfo.state == "hasData" &&
                (!!loadableFileInfo.data?.isdir || loadableFileInfo.data?.mimetype === "directory");
            const liveSourcePath = get(this.liveSourceFilePath);
            if (isLivePreviewView && !isBlank(liveSourcePath)) {
                headerPath = liveSourcePath;
            } else if (loadableFileInfo.state == "hasData") {
                headerPath = loadableFileInfo.data?.path;
                if (headerPath == "~") {
                    headerPath = "~";
                }
            }
            headerPath = getPreviewDisplayPath(headerPath);
            if (!isBlank(headerPath) && headerPath != "/" && headerPath.endsWith("/")) {
                headerPath = headerPath.slice(0, -1);
            }
            const displayName = isWindowsDrivesPath(headerPath) ? "This PC" : basename(headerPath);
            const tooltipText = headerPath == "~" ? "~ (C:/Users/chemclin)" : headerPath;
            // Shared across code-edit AND preview inline-edit dirty signals so the preview branch
            // can render a Save button with the same accent color the editor branch does — without
            // this, a para dblclick→blur commit shows up as "nothing changed in the header".
            let saveClassName = "grey";
            if (get(this.newFileContent) !== null) {
                saveClassName = "green";
            }
            const viewTextChildren: HeaderElem[] = [
                {
                    elemtype: "div",
                    className: "preview-filename-shell",
                    children: [
                        {
                            elemtype: "copytext",
                            text: tooltipText,
                            displayText: displayName,
                            tooltipText: tooltipText,
                            title: "Click to copy full path",
                            className: "preview-filename cursor-pointer",
                        },
                        // 悬浮文件夹名时浮现的路径跳转入口；hover-reveal 样式复用 block.scss
                        // 里 .preview-filename-copy-button 那套 opacity 过渡。
                        {
                            elemtype: "iconbutton",
                            icon: "magnifying-glass",
                            title: "Go to Path",
                            click: () => this.toggleOpenFileModal(),
                            className: "preview-filename-copy-button",
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
                    className: "preview-list-mode-toggle",
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
            } else if (!isLivePreviewView && get(this.canPreview) && !isKnownDirectory && mimeType !== "directory") {
                viewTextChildren.push({
                    elemtype: "iconbutton",
                    icon: "pen-to-square",
                    title: "Edit",
                    className: "grey",
                    click: () => fireAndForget(() => this.setEditMode(true)),
                });
                // Preview-only inline edit (dblclick a paragraph) commits the draft atom on blur
                // but never lands on disk without this — surface the same green Save affordance the
                // code-edit branch shows, so the user sees that their dblclick edit is staged-and-unsaved
                // and can flush it via one click. Revert / undo stays on the context-menu (line 2080),
                // same as the editor view.
                viewTextChildren.push({
                    elemtype: "iconbutton",
                    icon: "floppy-disk",
                    title: "Save",
                    iconColor: saveClassName === "green" ? "var(--accent-color)" : undefined,
                    click: () => fireAndForget(this.handleFileSave.bind(this)),
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
            if (mimeType == "directory" && (metaPath == "/" || isWindowsDrivesPath(metaPath))) {
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
            const filePath = get(this.metaFilePath);
            if (isLocalConnName(get(this.connectionImmediate)) && isOpenableForObsidian(filePath, mimeType)) {
                buttons.push({
                    elemtype: "iconbutton",
                    icon: "book-open",
                    title: "Open in Obsidian",
                    click: () => {
                        fireAndForget(async () => {
                            await loadObsidianVaults();
                            await openInObsidianWithPicker({ absPath: filePath });
                        });
                    },
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
                await this.env.rpc.ConnEnsureCommand(TabRpcClient, { connname: connName }, { timeout: ConnectionOperationTimeoutMs });
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
        this.loadableFileInfo = loadable(this.statFile);
        this.fileMimeType = atom<Promise<string>>(async (get) => {
            const fileInfo = await get(this.statFile);
            return fileInfo?.mimetype;
        });
        this.fileMimeTypeLoadable = loadable(this.fileMimeType);
        this.fileEditKey = atom((get) => {
            const connection = get(this.connectionImmediate);
            const metaFilePath = get(this.metaFilePath);
            const fileKey = makePreviewDraftKey(connection, metaFilePath);
            previewSharedDraftDebugLog("model:file-key", {
                blockId: this.blockId,
                connection,
                metaFilePath,
                fileKey,
            });
            return fileKey;
        });
        this.newFileContent = atom(
            (get) => {
                const fileKey = get(this.fileEditKey);
                get(getPreviewSharedDraftRecordVersionAtom(fileKey));
                const record = getPreviewSharedDraftRecord(fileKey);
                if (record == null) {
                    previewSharedDraftDebugLog("model:new-file-content:read-miss", {
                        blockId: this.blockId,
                        fileKey,
                    });
                    return null;
                }
                const state = get(record.stateAtom);
                previewSharedDraftDebugLog("model:new-file-content:read", {
                    blockId: this.blockId,
                    fileKey,
                    revision: state.revision,
                    draftContent: summarizePreviewDraftContent(state.draftContent),
                    savedContent: summarizePreviewDraftContent(state.savedContent),
                    editorRefs: record.editorRefs.size,
                });
                return state.draftContent;
            },
            (get, set, update: string | null) => {
                const fileKey = get(this.fileEditKey);
                const record = getOrCreatePreviewSharedDraftRecord(fileKey, set);
                if (record == null) {
                    previewSharedDraftDebugLog("model:new-file-content:write-skip", {
                        blockId: this.blockId,
                        fileKey,
                        update: summarizePreviewDraftContent(update),
                    });
                    return;
                }
                set(record.stateAtom, (prev) => {
                    const draftContent = update === prev.savedContent ? null : update;
                    if (prev.draftContent === draftContent) {
                        previewSharedDraftDebugLog("model:new-file-content:write-noop", {
                            blockId: this.blockId,
                            fileKey,
                            update: summarizePreviewDraftContent(update),
                            savedContent: summarizePreviewDraftContent(prev.savedContent),
                            revision: prev.revision,
                        });
                        return prev;
                    }
                    previewSharedDraftDebugLog("model:new-file-content:write", {
                        blockId: this.blockId,
                        fileKey,
                        update: summarizePreviewDraftContent(update),
                        previousDraftContent: summarizePreviewDraftContent(prev.draftContent),
                        savedContent: summarizePreviewDraftContent(prev.savedContent),
                        nextDraftContent: summarizePreviewDraftContent(draftContent),
                        nextRevision: prev.revision + 1,
                    });
                    publishPreviewSharedDraftToStorage(
                        fileKey,
                        {
                            draftContent,
                            savedContent: prev.savedContent,
                        },
                        "new-file-content"
                    );
                    return {
                        ...prev,
                        draftContent,
                        revision: prev.revision + 1,
                    };
                });
            }
        );
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
                throw e;
            }
        });

        this.fileContentSaved = atom(
            (get) => {
                const fileKey = get(this.fileEditKey);
                get(getPreviewSharedDraftRecordVersionAtom(fileKey));
                const record = getPreviewSharedDraftRecord(fileKey);
                if (record == null) {
                    previewSharedDraftDebugLog("model:file-content-saved:read-miss", {
                        blockId: this.blockId,
                        fileKey,
                    });
                    return null;
                }
                const state = get(record.stateAtom);
                previewSharedDraftDebugLog("model:file-content-saved:read", {
                    blockId: this.blockId,
                    fileKey,
                    revision: state.revision,
                    savedContent: summarizePreviewDraftContent(state.savedContent),
                    editorRefs: record.editorRefs.size,
                });
                return state.savedContent;
            },
            (get, set, update: string | null) => {
                const fileKey = get(this.fileEditKey);
                const record = getOrCreatePreviewSharedDraftRecord(fileKey, set);
                if (record == null) {
                    previewSharedDraftDebugLog("model:file-content-saved:write-skip", {
                        blockId: this.blockId,
                        fileKey,
                        update: summarizePreviewDraftContent(update),
                    });
                    return;
                }
                set(record.stateAtom, (prev) => {
                    if (prev.savedContent === update) {
                        previewSharedDraftDebugLog("model:file-content-saved:write-noop", {
                            blockId: this.blockId,
                            fileKey,
                            update: summarizePreviewDraftContent(update),
                            revision: prev.revision,
                        });
                        return prev;
                    }
                    previewSharedDraftDebugLog("model:file-content-saved:write", {
                        blockId: this.blockId,
                        fileKey,
                        previousSavedContent: summarizePreviewDraftContent(prev.savedContent),
                        nextSavedContent: summarizePreviewDraftContent(update),
                        revision: prev.revision,
                    });
                    return {
                        ...prev,
                        savedContent: update,
                    };
                });
            }
        );
        const fileContentAtom = atom(
            async (get) => {
                const fileKey = get(this.fileEditKey);
                get(getPreviewSharedDraftRecordVersionAtom(fileKey));
                const record = getPreviewSharedDraftRecord(fileKey);
                if (record != null) {
                    const state = get(record.stateAtom);
                    if (state.draftContent != null) {
                        previewSharedDraftDebugLog("model:file-content:read-draft", {
                            blockId: this.blockId,
                            fileKey,
                            revision: state.revision,
                            draftContent: summarizePreviewDraftContent(state.draftContent),
                            savedContent: summarizePreviewDraftContent(state.savedContent),
                            editorRefs: record.editorRefs.size,
                        });
                        return state.draftContent;
                    }
                    if (state.savedContent != null) {
                        previewSharedDraftDebugLog("model:file-content:read-saved", {
                            blockId: this.blockId,
                            fileKey,
                            revision: state.revision,
                            savedContent: summarizePreviewDraftContent(state.savedContent),
                            editorRefs: record.editorRefs.size,
                        });
                        return state.savedContent;
                    }
                }
                const fullFile = await get(fullFileAtom);
                const diskContent = base64ToString(fullFile?.data64);
                previewSharedDraftDebugLog("model:file-content:read-disk", {
                    blockId: this.blockId,
                    fileKey,
                    diskContent: summarizePreviewDraftContent(diskContent),
                    record: summarizePreviewSharedDraftRecord(record),
                });
                return diskContent;
            },
            (get, set, update: string) => {
                const fileKey = get(this.fileEditKey);
                const record = getOrCreatePreviewSharedDraftRecord(fileKey, set);
                if (record == null) {
                    previewSharedDraftDebugLog("model:file-content:write-skip", {
                        blockId: this.blockId,
                        fileKey,
                        update: summarizePreviewDraftContent(update),
                    });
                    return;
                }
                set(record.stateAtom, (prev) => {
                    if (prev.savedContent === update) {
                        previewSharedDraftDebugLog("model:file-content:write-noop", {
                            blockId: this.blockId,
                            fileKey,
                            update: summarizePreviewDraftContent(update),
                            revision: prev.revision,
                        });
                        return prev;
                    }
                    previewSharedDraftDebugLog("model:file-content:write", {
                        blockId: this.blockId,
                        fileKey,
                        previousSavedContent: summarizePreviewDraftContent(prev.savedContent),
                        nextSavedContent: summarizePreviewDraftContent(update),
                        revision: prev.revision,
                    });
                    return {
                        ...prev,
                        savedContent: update,
                    };
                });
            }
        );

        this.fullFile = fullFileAtom;
        // Capture the initial disk content for conflict detection (baseContent).
        // When the user first edits, their draft is based on the file as loaded.
        // If disk changes underneath before save, we compare against this snapshot.
        this._diskBaseUnsub = globalStore.sub(this.fullFile, () => {
            if (globalStore.get(this.diskBaseContent) != null) {
                return;
            }
            void globalStore.get(this.fullFile)?.then((ff) => {
                if (ff?.data64 != null && globalStore.get(this.diskBaseContent) == null) {
                    globalStore.set(this.diskBaseContent, base64ToString(ff.data64));
                }
            });
        });
        this.fileContent = fileContentAtom;
        this.fileContentLoadable = loadable(this.fileContent);
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
        // 内部插件接管：命中插件（如 .base 查看器）则返回插件 ID，否则回落既有分发逻辑。
        const pluginCtx = {
            fileInfo,
            mimeType: mimeType ?? "",
            fileName: fileName ?? "",
            filePath: fileInfo.path,
            editMode,
        };
        const plugin = resolvePreviewPlugin(pluginCtx);
        // 接管判定：编辑态下只读插件（canEdit = false）不接管 → 回落 codeedit 等编辑视图。
        if (plugin != null && shouldPreviewPluginTakeOver(plugin, pluginCtx)) {
            return { specializedView: plugin.id };
        }
        if (mimeType == null) {
            return { errorStr: `Unable to determine mimetype for: ${fileInfo.path}` };
        }
        if (isStreamingType(mimeType)) {
            return { specializedView: "streaming" };
        }
        // empty mimetype from extensionless files: show in code editor
        if (mimeType === "" && fileInfo != null && !fileInfo.notfound) {
            return { specializedView: "codeedit" };
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

    registerFileEditKey(fileKey: string | null): () => void {
        const editorRef = `${this.blockId}:${Date.now()}:${Math.random()}`;
        previewSharedDraftDebugLog("model:register-file-key", {
            blockId: this.blockId,
            fileKey,
            editorRef,
        });
        const unregister = registerPreviewSharedDraftEditor(fileKey, editorRef);
        return () => {
            previewSharedDraftDebugLog("model:unregister-file-key", {
                blockId: this.blockId,
                fileKey,
                editorRef,
            });
            unregister();
        };
    }

    migrateFileEditKey(previousFileKey: string | null, nextFileKey: string | null): void {
        previewSharedDraftDebugLog("model:migrate-file-key", {
            blockId: this.blockId,
            previousFileKey,
            nextFileKey,
        });
        migratePreviewSharedDraftRecord(previousFileKey, nextFileKey);
    }

    private async readCurrentFileContentFromDisk(filePath: string): Promise<string> {
        const file = await this.env.rpc.FileReadCommand(TabRpcClient, {
            info: {
                path: await this.formatRemoteUri(filePath, globalStore.get),
            },
        });
        return base64ToString(file?.data64) ?? "";
    }

    private applyOpenPathOptions(meta: MetaType, options?: PreviewOpenPathOptions): MetaType {
        const nextMeta: Record<string, any> = { ...meta };
        nextMeta[PreviewSearchLineMetaKey] = normalizeSearchTargetLine(options?.lineNumber);
        if (options?.editMode != null) {
            nextMeta.edit = options.editMode;
        }
        if (options?.pathIsDir !== undefined) {
            nextMeta[PreviewPathIsDirMetaKey] = options.pathIsDir;
        }
        return nextMeta as MetaType;
    }

    async goHistory(newPath: string, options?: PreviewOpenPathOptions, directoryPath?: string | null) {
        let fileName = globalStore.get(this.metaFilePath);
        if (fileName == null) {
            fileName = "";
        }
        const oldFileKey = globalStore.get(this.fileEditKey);
        const blockMeta = globalStore.get(this.blockAtom)?.meta;
        const updateMeta = applyDirectoryNavigationMeta(
            this.applyOpenPathOptions(goHistory("file", fileName, newPath, blockMeta), options) as Record<string, any>,
            this.getDirectoryDisplayMode(),
            directoryPath
        );
        if (updateMeta == null) {
            return;
        }
        const blockOref = WOS.makeORef("block", this.blockId);
        await this.env.services.object.UpdateObjectMeta(blockOref, updateMeta as MetaType);
        discardPreviewSharedDraftIfUnshared(oldFileKey);
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
        const fallback = blockMeta?.[SnorkelingBlockKindMetaKey] === SnorkelingBlockKindNote ? "off" : "right";
        return resolvePreviewOpenTargetDirectionForBlock(
            blockMeta?.[PreviewOpenTargetMetaKey],
            getFn(this.env.getSettingsKeyAtom(PreviewDefaultOpenTargetSettingKey)),
            fallback,
            blockMeta?.[SnorkelingBlockKindMetaKey]
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
        const updateMeta = applyDirectoryNavigationMeta(
            this.applyOpenPathOptions(
                goHistory("file", currentPath, newPath, targetBlockData.meta),
                options
            ) as Record<string, any>,
            resolvePreviewDirectoryDisplayMode(
                targetBlockData.meta?.[PreviewDirectoryDisplayMetaKey],
                globalStore.get(this.env.getSettingsKeyAtom(PreviewDefaultDirectoryDisplaySettingKey)),
                "tree"
            ),
            options?.directoryPath
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

    private findExistingPreviewBlockInInlineTab(
        targetNode: LayoutNode,
        newPath: string,
        connection: string
    ): string | null {
        for (const blockId of getLayoutDataBlockIds(targetNode.data)) {
            const block = globalStore.get(this.env.wos.getWaveObjectAtom<Block>(`block:${blockId}`));
            if (block?.meta?.view !== "preview") {
                continue;
            }
            const sameConnection =
                block?.meta?.connection === connection ||
                (isLocalConnName(block?.meta?.connection) && isLocalConnName(connection));
            if (!sameConnection) {
                continue;
            }
            if (normalizePath(block.meta.file ?? "") !== normalizePath(newPath)) {
                continue;
            }
            return blockId;
        }
        return null;
    }

    private async openPathInPreviewBlockAsTab(
        targetBlockId: string,
        newPath: string,
        connection: string,
        options?: PreviewOpenPathOptions
    ): Promise<boolean> {
        const layoutModel = getLayoutModelForStaticTab();
        const targetNode = layoutModel.getNodeByBlockId(targetBlockId);
        if (!targetNode) {
            return false;
        }
        const existingId = this.findExistingPreviewBlockInInlineTab(targetNode, newPath, connection);
        if (existingId != null) {
            return layoutModel.setActiveInlineTabBlock(targetNode.id, existingId);
        }
        const rtOpts: RuntimeOpts = { termsize: { rows: 25, cols: 80 } };
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
        if (options?.pathIsDir !== undefined) {
            blockMeta[PreviewPathIsDirMetaKey] = options.pathIsDir;
        }
        const blockDef: BlockDef = {
            meta: blockMeta,
        };
        const newBlockId = await ObjectService.CreateBlock(blockDef, rtOpts);
        if (!newBlockId) {
            return false;
        }
        const added = layoutModel.addBlockToInlineTab(targetNode.id, newBlockId);
        if (!added) {
            fireAndForget(() => ObjectService.DeleteBlock(newBlockId));
            return false;
        }
        return true;
    }

    private async openPathInCurrentBlockAsTab(
        newPath: string,
        connection: string,
        options?: PreviewOpenPathOptions
    ): Promise<boolean> {
        const layoutModel = getLayoutModelForStaticTab();
        const targetNode = layoutModel.getNodeByBlockId(this.blockId);
        if (!targetNode) {
            return false;
        }
        for (const blockId of getLayoutDataBlockIds(targetNode.data)) {
            const block = globalStore.get(this.env.wos.getWaveObjectAtom<Block>(`block:${blockId}`));
            const sameConnection =
                block?.meta?.connection === connection ||
                (isLocalConnName(block?.meta?.connection) && isLocalConnName(connection));
            if (block?.meta?.view !== "preview" || !sameConnection) {
                continue;
            }
            if (normalizePath(block.meta.file ?? "") !== normalizePath(newPath)) {
                continue;
            }
            await this.openPathInPreviewBlock(blockId, newPath, connection, options);
            return layoutModel.setActiveInlineTabBlock(targetNode.id, blockId);
        }
        return await this.openPathInPreviewBlockAsTab(this.blockId, newPath, connection, options);
    }

    private async openPathInCurrentBlock(newPath: string, options?: PreviewOpenPathOptions) {
        const currentPath = globalStore.get(this.metaFilePath);
        if (normalizePath(currentPath) === normalizePath(newPath)) {
            const blockMeta = globalStore.get(this.blockAtom)?.meta ?? {};
            const updateMeta = applyDirectoryNavigationMeta(
                this.applyOpenPathOptions(blockMeta, options) as Record<string, any>,
                this.getDirectoryDisplayMode(),
                options?.directoryPath
            );
            const blockOref = WOS.makeORef("block", this.blockId);
            await this.env.services.object.UpdateObjectMeta(blockOref, updateMeta);
            refocusNode(this.blockId);
            return;
        }
        await this.goHistory(newPath, options, options?.directoryPath);
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
        if (options?.pathIsDir !== undefined) {
            blockMeta[PreviewPathIsDirMetaKey] = options.pathIsDir;
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
        if (options?.forceInlineTabCurrentBlock) {
            const sourceConnection = await globalStore.get(this.connection);
            const opened = await this.openPathInCurrentBlockAsTab(newPath, sourceConnection, options);
            if (opened) {
                this.focusBlockById(this.blockId);
                return;
            }
            await this.openPathInNewBlock(newPath, this.getOpenTargetDirection(), options);
            return;
        }
        const direction = this.getOpenTargetDirection();
        if (direction === "off") {
            await this.goHistory(newPath, options, options?.directoryPath);
            refocusNode(this.blockId);
            return;
        }
        const targetBlockId = this.findDirectionalPreviewBlock(direction);
        if (!targetBlockId) {
            await this.openPathInNewBlock(newPath, direction, options);
            return;
        }
        const sourceConnection = await globalStore.get(this.connection);
        const opened = await this.openPathInPreviewBlockAsTab(targetBlockId, newPath, sourceConnection, options);
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
        const fileKey = globalStore.get(this.fileEditKey);
        const record = getPreviewSharedDraftRecord(fileKey);
        const stateBeforeSave = record == null ? null : globalStore.get(record.stateAtom);
        const newFileContent = stateBeforeSave?.draftContent;
        previewSharedDraftDebugLog("model:save:start", {
            blockId: this.blockId,
            filePath,
            fileKey,
            record: summarizePreviewSharedDraftRecord(record),
        });
        if (record == null || newFileContent == null) {
            console.log("not saving file, newFileContent is null");
            previewSharedDraftDebugLog("model:save:skip", {
                blockId: this.blockId,
                filePath,
                fileKey,
                reason: record == null ? "missing-record" : "missing-draft",
            });
            return;
        }
        const savingRevision = stateBeforeSave.revision;
        // Conflict detection: re-read disk before writing.
        // baseContent = savedContent from last save, or the initial disk snapshot
        // captured when the PreviewModel was created.
        let currentDiskContent: string | null = null;
        try {
            currentDiskContent = await this.readCurrentFileContentFromDisk(filePath);
        } catch {
            // If we can't read disk, skip conflict check and write anyway
        }
        const baseContent = stateBeforeSave?.savedContent ?? globalStore.get(this.diskBaseContent);
        if (
            baseContent != null &&
            currentDiskContent != null &&
            currentDiskContent !== baseContent
        ) {
            const choice = await this.promptFileConflict(filePath, {
                baseContent,
                myContent: newFileContent,
                theirsContent: currentDiskContent,
            });
            if (choice === "cancel") {
                return;
            }
            if (choice === "discard") {
                discardPreviewSharedDraftIfUnshared(fileKey);
                globalStore.set(this.refreshVersion, (v) => v + 1);
                return;
            }
            if (choice === "copy-diff") {
                // Diff was copied to clipboard by the modal; don't write to disk.
                return;
            }
            // choice === "overwrite" → proceed with write
        }
        try {
            await this.env.rpc.FileWriteCommand(TabRpcClient, {
                info: {
                    path: await this.formatRemoteUri(filePath, globalStore.get),
                },
                data64: stringToBase64(newFileContent),
            });
            globalStore.set(record.stateAtom, (prev) => {
                if (prev.revision === savingRevision && prev.draftContent === newFileContent) {
                    previewSharedDraftDebugLog("model:save:clear-current-draft", {
                        blockId: this.blockId,
                        filePath,
                        fileKey,
                        savingRevision,
                        savedContent: summarizePreviewDraftContent(newFileContent),
                    });
                    publishPreviewSharedDraftToStorage(
                        fileKey,
                        {
                            draftContent: null,
                            savedContent: newFileContent,
                        },
                        "save-clear-current-draft"
                    );
                    return {
                        ...prev,
                        draftContent: null,
                        savedContent: newFileContent,
                    };
                }
                previewSharedDraftDebugLog("model:save:preserve-newer-draft", {
                    blockId: this.blockId,
                    filePath,
                    fileKey,
                    savingRevision,
                    currentRevision: prev.revision,
                    savedContent: summarizePreviewDraftContent(newFileContent),
                    currentDraftContent: summarizePreviewDraftContent(prev.draftContent),
                });
                return {
                    ...prev,
                    savedContent: newFileContent,
                };
            });
            console.log("saved file", filePath);
            previewSharedDraftDebugLog("model:save:done", {
                blockId: this.blockId,
                filePath,
                fileKey,
                record: summarizePreviewSharedDraftRecord(record),
            });
        } catch (e) {
            const errorStatus: ErrorMsg = {
                status: "Save Failed",
                text: `${e}`,
            };
            globalStore.set(this.errorMsgAtom, errorStatus);
            previewSharedDraftDebugLog("model:save:error", {
                blockId: this.blockId,
                filePath,
                fileKey,
                error: `${e}`,
            });
        }
    }

    hasUnsavedChanges(): boolean {
        return globalStore.get(this.newFileContent) != null;
    }

    private promptFileConflict(
        filePath: string,
        opts: { baseContent: string; myContent: string; theirsContent: string }
    ): Promise<FileConflictChoice> {
        return new Promise<FileConflictChoice>((resolve) => {
            modalsModel.pushModal(
                "FileConflictModal",
                {
                    filePath,
                    baseContent: opts.baseContent,
                    myContent: opts.myContent,
                    theirsContent: opts.theirsContent,
                    onResolve: resolve,
                },
                () => resolve("cancel")
            );
        });
    }

    private async promptUnsavedFileChoice(filePath: string): Promise<UnsavedFileModalChoice> {
        return await new Promise<UnsavedFileModalChoice>((resolve) => {
            modalsModel.pushModal(
                "UnsavedFileModal",
                {
                    fileName: filePath || "this file",
                    onResolve: resolve,
                },
                () => resolve("cancel")
            );
        });
    }

    private async getUnsavedFileLabel(): Promise<string> {
        try {
            return (await globalStore.get(this.statFilePath)) || globalStore.get(this.metaFilePath) || "this file";
        } catch (_e) {
            return globalStore.get(this.metaFilePath) || "this file";
        }
    }

    async confirmClose(): Promise<boolean> {
        if (!this.hasUnsavedChanges()) {
            return true;
        }
        const filePath = await this.getUnsavedFileLabel();
        const choice = await this.promptUnsavedFileChoice(filePath);
        if (choice === "cancel") {
            return false;
        }
        if (choice === "discard") {
            discardPreviewSharedDraftIfUnshared(globalStore.get(this.fileEditKey));
            return true;
        }
        await this.handleFileSave();
        return !this.hasUnsavedChanges();
    }

    async handleFileRevert() {
        const filePath = await globalStore.get(this.statFilePath);
        if (filePath == null) {
            return;
        }
        try {
            const fileContent = await this.readCurrentFileContentFromDisk(filePath);
            const record = getOrCreatePreviewSharedDraftRecord(globalStore.get(this.fileEditKey));
            if (record != null) {
                previewSharedDraftDebugLog("model:revert", {
                    blockId: this.blockId,
                    filePath,
                    fileKey: globalStore.get(this.fileEditKey),
                    diskContent: summarizePreviewDraftContent(fileContent),
                    previousRecord: summarizePreviewSharedDraftRecord(record),
                });
                publishPreviewSharedDraftToStorage(
                    globalStore.get(this.fileEditKey),
                    {
                        draftContent: null,
                        savedContent: fileContent,
                    },
                    "revert"
                );
                globalStore.set(record.stateAtom, (prev) => ({
                    ...prev,
                    draftContent: null,
                    savedContent: fileContent,
                    revision: prev.revision + 1,
                }));
            }
            this.monacoRef.current?.setValue(fileContent);
        } catch (e) {
            const errorStatus: ErrorMsg = {
                status: "File Read Failed",
                text: `${e}`,
            };
            globalStore.set(this.errorMsgAtom, errorStatus);
        }
    }

    async handleOpenFile(filePath: string, pathIsDir?: boolean | null) {
        const fileInfo = await globalStore.get(this.statFile);
        this.updateOpenFileModalAndError(false);
        if (fileInfo == null) {
            return true;
        }
        try {
            await this.openPathWithTarget(filePath, { pathIsDir: pathIsDir ?? null });
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
        globalStore.set(this.errorMsgAtom, null);
        const fileKey = globalStore.get(this.fileEditKey);
        const record = getPreviewSharedDraftRecord(fileKey);
        previewSharedDraftDebugLog("model:refresh", {
            blockId: this.blockId,
            fileKey,
            record: summarizePreviewSharedDraftRecord(record),
        });
        if (record != null) {
            globalStore.set(record.stateAtom, (prev) => {
                if (prev.savedContent == null) {
                    previewSharedDraftDebugLog("model:refresh:no-saved-content", {
                        blockId: this.blockId,
                        fileKey,
                        revision: prev.revision,
                    });
                    return prev;
                }
                previewSharedDraftDebugLog("model:refresh:clear-saved-content", {
                    blockId: this.blockId,
                    fileKey,
                    revision: prev.revision,
                    savedContent: summarizePreviewDraftContent(prev.savedContent),
                });
                return {
                    ...prev,
                    savedContent: null,
                };
            });
        }
        globalStore.set(this.refreshVersion, (v) => v + 1);
    }

    getSettingsMenuItems(): ContextMenuItem[] {
        const defaultFontSize = globalStore.get(this.env.getSettingsKeyAtom("editor:fontsize")) ?? 12;
        const blockData = globalStore.get(this.blockAtom);
        const overrideFontSize = blockData?.meta?.["editor:fontsize"];
        const isNoteBlock = blockData?.meta?.[SnorkelingBlockKindMetaKey] === SnorkelingBlockKindNote;
        const menuItems: ContextMenuItem[] = [];
        menuItems.push({
            label: "Go to Path...",
            click: () => this.toggleOpenFileModal(),
        });
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
        if (isNoteBlock) {
            menuItems.push({ type: "separator" });
            menuItems.push({
                label: "Set Note Directory...",
                click: () => {
                    modalsModel.pushModal("NoteDirectoryModal", {
                        blockId: this.blockId,
                        initialDir: globalStore.get(this.metaFilePath),
                    });
                },
            });
        }
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
                // Suppress "toggle full-screen Monaco edit" while a markdown preview is in
                // Obsidian-style inline textarea edit on a single paragraph/heading. The
                // textarea overlay commits/cancels independently; Cmd+E here would yank the
                // whole block into Monaco mid-keystroke.
                if (globalStore.get(inlineEditingActiveAtom)) {
                    return true;
                }
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

    dispose(): void {
        this._diskBaseUnsub?.();
        this._diskBaseUnsub = undefined;
    }
}
