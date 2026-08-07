// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Markdown } from "@/element/markdown";
import { getBlockComponentModel, getOverrideConfigAtom } from "@/store/global";
import { fireAndForget } from "@/util/util";
import { globalStore } from "@/store/jotaiStore";
import { useAtomValue } from "jotai";
import { loadable } from "jotai/utils";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SpecializedViewProps } from "./preview";
import {
    getLiveScrollSourceLineAtom,
    getLiveScrollSourceStateAtom,
    getMarkdownCollapsedHeadings,
    getMarkdownCollapsedOLItems,
    getMarkdownCollapsedTables,
    getMarkdownIdPrefix,
    getMarkdownScrollPosition,
    setMarkdownCollapsedHeadings,
    setMarkdownCollapsedOLItems,
    setMarkdownCollapsedTables,
    setMarkdownScrollPosition,
    type PreviewModel,
} from "./preview-model";

const LivePreviewDebounceMs = 2000;
const LivePreviewSourceModelRetryMs = 100;
const PreviewUserScrollSuppressMs = 350;
const MarkdownFilePattern = /\.md$/i;

type LivePreviewBuffer = {
    id: number;
    text: string;
};

function isLiveScrollDebugEnabled(): boolean {
    return typeof window !== "undefined" && window.localStorage?.getItem("snorkelingLiveScrollDebug") === "1";
}

function liveScrollDebug(message: string, details: Record<string, unknown> = {}) {
    if (!isLiveScrollDebugEnabled()) {
        return;
    }
    console.info("[live-scroll]", message, details);
}

function MarkdownPreview({ model }: SpecializedViewProps) {
    const connName = useAtomValue(model.connection);
    const fileInfo = useAtomValue(model.statFile);
    const searchTargetLine = useAtomValue(model.searchTargetLine);
    const fontSizeOverride = useAtomValue(getOverrideConfigAtom(model.blockId, "markdown:fontsize"));
    const fixedFontSizeOverride = useAtomValue(getOverrideConfigAtom(model.blockId, "markdown:fixedfontsize"));
    const collapsibleOrderedLists = MarkdownFilePattern.test(fileInfo.path ?? fileInfo.name ?? "");
    // Stable heading-id prefix + collapse snapshot so the rehype-slug ids (and the Set of collapsed
    // heading ids) survive BlockInner remount on tab switch. We only seed the initial snapshot here
    // (read once on mount) and write back live via the toggle callbacks — Markdown owns local
    // useState; we never need to push updates downward after mount.
    const mdPath = fileInfo.path ?? fileInfo.name ?? "";
    const idPrefix = useMemo(() => (mdPath ? getMarkdownIdPrefix(`${model.blockId}|${mdPath}`) : undefined), [
        model.blockId,
        mdPath,
    ]);
    const collapseSeed = useMemo(() => getMarkdownCollapsedHeadings(model.blockId), [model.blockId]);
    const olCollapseSeed = useMemo(() => getMarkdownCollapsedOLItems(model.blockId), [model.blockId]);
    const tableCollapseSeed = useMemo(() => getMarkdownCollapsedTables(model.blockId), [model.blockId]);
    // Saved viewport scrollTop from the last time this block was mounted; restores the user's
    // scroll position when they switch back to this inline/top-level tab.
    const savedScrollTop = useMemo(() => getMarkdownScrollPosition(model.blockId), [model.blockId]);
    const blockIdRef = useRef(model.blockId);
    blockIdRef.current = model.blockId;
    const onCollapsedHeadingsChange = useCallback((next: Set<string>) => {
        setMarkdownCollapsedHeadings(blockIdRef.current, next);
    }, []);
    const onCollapsedOrderedListItemsChange = useCallback((next: Set<string>) => {
        setMarkdownCollapsedOLItems(blockIdRef.current, next);
    }, []);
    const onCollapsedTablesChange = useCallback((next: Set<string>) => {
        setMarkdownCollapsedTables(blockIdRef.current, next);
    }, []);
    const onScrollTopChange = useCallback((scrollTop: number) => {
        setMarkdownScrollPosition(blockIdRef.current, scrollTop);
    }, []);
    // Inline-edit commit: write the patched full text to the shared draft atom. The atom's own
    // writer (preview-model.tsx newFileContent) handles draft saving, localStorage publish, and
    // dirty-flag/Save-highlight; we do NOT call handleFileSave from here — keep the "blur commits
    // to draft, Cmd+S/Cmd+click-Save lands to disk" semantics so Revert stays available.
    const handleInlineEditCommit = useCallback((newText: string) => {
        globalStore.set(model.newFileContent, newText);
    }, [model]);
    // Inline-edit ⌘/Ctrl+S: commit synchronously patched the draft atom above (the keydown
    // handler calls commit → handleInlineEditCommit before us), so by the time we run here the
    // draft is staged. Preview mode registers no global ⌘S listener, so bubble-saving wouldn't
    // work — drive the flush ourselves.
    const handleInlineEditSave = useCallback(() => {
        fireAndForget(model.handleFileSave.bind(model));
    }, [model]);
    const resolveOpts: MarkdownResolveOpts = useMemo<MarkdownResolveOpts>(() => {
        return {
            connName: connName,
            baseDir: fileInfo.dir,
            openLink: async (path, options) => {
                await model.openPathWithTarget(path, {
                    lineNumber: options.lineNumber,
                    forceNewBlock: options.forceNewBlock,
                    forceInlineTabCurrentBlock: !options.forceNewBlock,
                });
            },
        };
    }, [connName, fileInfo.dir, model]);
    return (
        <div className="flex flex-row h-full overflow-auto items-start justify-start">
            <Markdown
                textAtom={model.fileContent}
                showTocAtom={model.markdownShowToc}
                resolveOpts={resolveOpts}
                fontSizeOverride={fontSizeOverride}
                fixedFontSizeOverride={fixedFontSizeOverride}
                scrollTargetLine={searchTargetLine}
                collapsibleOrderedLists={collapsibleOrderedLists}
                copyContextPath={fileInfo.path}
                onInlineEditCommit={handleInlineEditCommit}
                onInlineEditSave={handleInlineEditSave}
                idPrefix={idPrefix}
                collapsedHeadings={collapseSeed}
                onCollapsedHeadingsChange={onCollapsedHeadingsChange}
                collapsedOrderedListItems={olCollapseSeed}
                onCollapsedOrderedListItemsChange={onCollapsedOrderedListItemsChange}
                collapsedTables={tableCollapseSeed}
                onCollapsedTablesChange={onCollapsedTablesChange}
                savedScrollTop={savedScrollTop}
                onScrollTopChange={onScrollTopChange}
                contentClassName="pt-[5px] pr-[15px] pb-[10px] pl-[15px]"
            />
        </div>
    );
}

function MarkdownLivePreview({ model }: SpecializedViewProps) {
    const sourceBlockId = useAtomValue(model.liveSourceBlockId);
    const sourceBlock = useAtomValue(model.liveSourceBlock);
    const [sourceModel, setSourceModel] = useState<PreviewModel | null>(null);
    useEffect(() => {
        if (sourceBlockId == null) {
            setSourceModel(null);
            return;
        }
        const updateSourceModel = () => {
            const nextSourceModel = getBlockComponentModel(sourceBlockId)?.viewModel;
            if (nextSourceModel?.viewType !== "preview") {
                setSourceModel(null);
                return false;
            }
            setSourceModel(nextSourceModel as PreviewModel);
            return true;
        };
        if (updateSourceModel()) {
            return;
        }
        const timer = window.setInterval(() => {
            if (updateSourceModel()) {
                window.clearInterval(timer);
            }
        }, LivePreviewSourceModelRetryMs);
        return () => window.clearInterval(timer);
    }, [sourceBlockId]);

    const sourceTextAtom = sourceModel?.fileContent ?? model.liveSourceFileContent;
    const sourcePathAtom = sourceModel?.metaFilePath ?? model.liveSourceFilePath;
    const sourceConnectionAtom = sourceModel?.connectionImmediate ?? model.liveSourceConnection;
    const syncScrollEnabledAtom = sourceModel?.liveScrollSyncEnabled ?? model.liveSourceScrollSyncEnabled;
    const scrollSourceLineAtom = useMemo(
        () => (sourceBlockId == null ? model.liveSourceScrollLine : getLiveScrollSourceLineAtom(sourceBlockId)),
        [model, sourceBlockId]
    );
    const scrollSourceStateAtom = useMemo(
        () => (sourceBlockId == null ? model.liveSourceScrollState : getLiveScrollSourceStateAtom(sourceBlockId)),
        [model, sourceBlockId]
    );
    const sourceTextLoadableAtom = useMemo(() => loadable(sourceTextAtom), [sourceTextAtom]);
    const sourceTextLoadable = useAtomValue(sourceTextLoadableAtom);
    const sourcePath = useAtomValue(sourcePathAtom);
    const sourceConnName = useAtomValue(sourceConnectionAtom);
    const syncScrollEnabled = useAtomValue(syncScrollEnabledAtom);
    const scrollSourceLine = useAtomValue(scrollSourceLineAtom);
    const scrollSourceState = useAtomValue(scrollSourceStateAtom);
    const fontSizeOverride = useAtomValue(getOverrideConfigAtom(model.blockId, "markdown:fontsize"));
    const fixedFontSizeOverride = useAtomValue(getOverrideConfigAtom(model.blockId, "markdown:fixedfontsize"));
    const collapsibleOrderedLists = MarkdownFilePattern.test(sourcePath ?? "");
    const previewScrollLineRef = useRef<number | null>(null);
    const previewUserScrollUntilRef = useRef(0);
    const lastSourceTextRef = useRef("");
    if (sourceTextLoadable.state === "hasData") {
        lastSourceTextRef.current = sourceTextLoadable.data;
    }
    const sourceText = lastSourceTextRef.current;
    const [debouncedText, setDebouncedText] = useState(sourceText);
    const nextBufferIdRef = useRef(1);
    const [visibleBuffer, setVisibleBuffer] = useState<LivePreviewBuffer | null>(null);
    const [pendingBuffer, setPendingBuffer] = useState<LivePreviewBuffer | null>(null);
    const resolveOpts: MarkdownResolveOpts = useMemo<MarkdownResolveOpts>(() => {
        const baseDir = sourcePath?.includes("/") ? sourcePath.slice(0, sourcePath.lastIndexOf("/")) || "/" : "";
        return {
            connName: sourceConnName,
            baseDir,
            openLink: async (path, options) => {
                await model.openPathWithTarget(path, {
                    lineNumber: options.lineNumber,
                    forceNewBlock: options.forceNewBlock,
                    forceInlineTabCurrentBlock: !options.forceNewBlock,
                });
            },
        };
    }, [model, sourceConnName, sourcePath]);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            setDebouncedText(sourceText);
        }, LivePreviewDebounceMs);
        return () => window.clearTimeout(timer);
    }, [sourceText]);

    useEffect(() => {
        if (!syncScrollEnabled) {
            setVisibleBuffer({ id: nextBufferIdRef.current++, text: debouncedText });
            setPendingBuffer(null);
            return;
        }
        if (scrollSourceLine == null) {
            return;
        }
        if (visibleBuffer?.text === debouncedText || pendingBuffer?.text === debouncedText) {
            return;
        }
        setPendingBuffer({ id: nextBufferIdRef.current++, text: debouncedText });
    }, [debouncedText, pendingBuffer?.text, scrollSourceLine, syncScrollEnabled, visibleBuffer?.text]);

    const handleBufferInitialScrollReady = useCallback((bufferId: number) => {
        requestAnimationFrame(() => {
            setPendingBuffer((currentPendingBuffer) => {
                if (currentPendingBuffer?.id !== bufferId) {
                    return currentPendingBuffer;
                }
                setVisibleBuffer(currentPendingBuffer);
                return null;
            });
        });
    }, []);
    const shouldWaitForInitialScrollTarget = syncScrollEnabled && scrollSourceLine == null;

    useEffect(() => {
        liveScrollDebug("live preview received line", {
            livePreviewBlockId: model.blockId,
            sourceBlockId,
            syncScrollEnabled,
            scrollSourceLine,
            hasSourceModel: sourceModel != null,
            sourceTextState: sourceTextLoadable.state,
        });
    }, [model.blockId, scrollSourceLine, sourceBlockId, sourceModel, sourceTextLoadable.state, syncScrollEnabled]);

    const handlePreviewUserScrollSourceLine = (line: number) => {
        if (!syncScrollEnabled || previewScrollLineRef.current === line) {
            liveScrollDebug("skip preview to editor reveal", {
                livePreviewBlockId: model.blockId,
                sourceBlockId,
                line,
                syncScrollEnabled,
                previousLine: previewScrollLineRef.current,
            });
            return;
        }
        previewScrollLineRef.current = line;
        previewUserScrollUntilRef.current = Date.now() + PreviewUserScrollSuppressMs;
        const sourceEditor = sourceModel?.monacoRef.current;
        if (sourceModel != null) {
            const previousState = globalStore.get(sourceModel.liveScrollSourceState);
            globalStore.set(sourceModel.liveScrollSourceState, {
                ...previousState,
                sequence: previousState.sequence + 1,
                origin: "preview",
                previewControlUntil: previewUserScrollUntilRef.current,
                bottomScrollIntent: false,
                direction: "none",
            });
        }
        liveScrollDebug("preview reveals editor line", {
            livePreviewBlockId: model.blockId,
            sourceBlockId,
            line,
            hasSourceModel: sourceModel != null,
            hasEditor: !!sourceEditor,
        });
        const visibleRanges = sourceEditor?.getVisibleRanges();
        const isLineVisible =
            visibleRanges?.some((range) => line >= range.startLineNumber && line <= range.endLineNumber) ?? false;
        if (!isLineVisible) {
            sourceEditor?.revealLineNearTop(line);
        }
    };

    if (sourceBlock == null) {
        return (
            <div className="flex h-full w-full items-center justify-center text-secondary">Source editor closed</div>
        );
    }

    if (shouldWaitForInitialScrollTarget) {
        return <div className="flex h-full w-full overflow-hidden bg-transparent" />;
    }

    const buffers: LivePreviewBuffer[] = [];
    if (visibleBuffer != null) {
        buffers.push(visibleBuffer);
    }
    if (pendingBuffer != null && pendingBuffer.id !== visibleBuffer?.id) {
        buffers.push(pendingBuffer);
    }
    if (buffers.length === 0) {
        return <div className="flex h-full w-full overflow-hidden bg-transparent" />;
    }

    return (
        <div className="relative h-full w-full overflow-hidden">
            {buffers.map((buffer) => {
                const isVisibleBuffer = visibleBuffer?.id === buffer.id;
                const bufferScrollSourceText =
                    scrollSourceLine == null ? null : (buffer.text.split(/\r?\n/)[scrollSourceLine - 1] ?? null);
                return (
                    <div
                        key={buffer.id}
                        className={`absolute inset-0 flex flex-row overflow-auto items-start justify-start ${
                            isVisibleBuffer ? "" : "invisible pointer-events-none"
                        }`}
                    >
                        <Markdown
                            text={buffer.text}
                            showTocAtom={model.markdownShowToc}
                            resolveOpts={resolveOpts}
                            fontSizeOverride={fontSizeOverride}
                            fixedFontSizeOverride={fixedFontSizeOverride}
                            scrollTargetLine={syncScrollEnabled ? scrollSourceLine : null}
                            scrollTargetText={syncScrollEnabled ? bufferScrollSourceText : null}
                            scrollTargetSourceState={syncScrollEnabled ? scrollSourceState : null}
                            scrollTargetBehavior="auto"
                            hideUntilInitialScroll={syncScrollEnabled && !isVisibleBuffer}
                            copyContextPath={sourcePath}
                            onInitialScrollReady={
                                isVisibleBuffer ? undefined : () => handleBufferInitialScrollReady(buffer.id)
                            }
                            onUserScrollSourceLine={isVisibleBuffer ? handlePreviewUserScrollSourceLine : undefined}
                            collapsibleOrderedLists={collapsibleOrderedLists}
                            contentClassName="pt-[5px] pr-[15px] pb-[10px] pl-[15px]"
                        />
                    </div>
                );
            })}
        </div>
    );
}

export { MarkdownLivePreview, MarkdownPreview };
