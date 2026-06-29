// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import {
    captureMarkdownFoldSnapshot,
    resolveMarkdownFoldLines,
    type MarkdownFoldSnapshot,
    type MonacoCollapsedRegion,
} from "@/app/element/markdown-fold-state";
import {
    cutMarkdownHeadingSection,
    getMarkdownHeadingMoveState,
    getMarkdownHeadingSwapPreview,
    insertMarkdownHeadingSection,
    isMarkdownHeadingSectionPath,
    moveMarkdownHeadingSection,
    type MarkdownHeadingLineRange,
    type MarkdownHeadingMoveState,
} from "@/app/element/markdown-heading-section";
import {
    cutOrderedListItem,
    getOrderedListMoveState,
    getOrderedListSwapPreview,
    insertOrderedListItem,
    isMarkdownOrderedListPath,
    moveOrderedListItem,
    renumberOrderedListsInSelection,
    type OrderedListLineRange,
    type OrderedListMoveState,
} from "@/app/element/markdown-ordered-list";
import { CenteredDiv } from "@/app/element/quickelems";
import { Search, useSearch } from "@/app/element/search";
import {
    clampSelectionCopyOverlayPosition,
    SelectionCopyOverlay,
    type SelectionCopyOverlayState,
} from "@/app/element/selection-copy-overlay";
import { parseFileReference } from "@/app/element/selection-reference-parser";
import { searchSelectionInFiles } from "@/app/element/selection-search-in-files";
import { globalStore } from "@/app/store/jotaiStore";
import { tryReinjectKey } from "@/app/store/keymodel";
import { CodeEditor } from "@/app/view/codeeditor/codeeditor";
import { getElemAsStr } from "@/util/focusutil";
import { adaptFromReactOrNativeKeyEvent, checkKeyPressed } from "@/util/keyutil";
import { fireAndForget, useAtomValueSafe } from "@/util/util";
import debug from "debug";
import { useAtomValue, useSetAtom } from "jotai";
import type * as MonacoTypes from "monaco-editor";
import * as monaco from "monaco-editor";
import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    type PointerEvent as ReactPointerEvent,
} from "react";
import type { SpecializedViewProps } from "./preview";
import "./preview-edit.scss";
import { previewSharedDraftDebugLog, summarizePreviewDraftContent } from "./preview-shared-draft";

const dlog = debug("wave:preview:edit-search");
dlog.enabled = true;

function isLiveScrollDebugEnabled(): boolean {
    return typeof window !== "undefined" && window.localStorage?.getItem("snorkelingLiveScrollDebug") === "1";
}

function liveScrollDebug(message: string, details: Record<string, unknown> = {}) {
    if (!isLiveScrollDebugEnabled()) {
        return;
    }
    console.info("[live-scroll]", message, details);
}

function getActiveElementLog(): string {
    if (typeof document === "undefined") {
        return "no-document";
    }
    return getElemAsStr(document.activeElement);
}

function editorSearchLog(message: string, details: Record<string, unknown> = {}) {
    const payload = { ...details, activeElement: getActiveElementLog() };
    dlog(message, payload);
    console.info("[preview-edit-search]", message, payload);
}

export const shellFileMap: Record<string, string> = {
    ".bashrc": "shell",
    ".bash_profile": "shell",
    ".bash_login": "shell",
    ".bash_logout": "shell",
    ".profile": "shell",
    ".zshrc": "shell",
    ".zprofile": "shell",
    ".zshenv": "shell",
    ".zlogin": "shell",
    ".zlogout": "shell",
    ".kshrc": "shell",
    ".cshrc": "shell",
    ".tcshrc": "shell",
    ".xonshrc": "python",
    ".shrc": "shell",
    ".aliases": "shell",
    ".functions": "shell",
    ".exports": "shell",
    ".direnvrc": "shell",
    ".vimrc": "shell",
    ".gvimrc": "shell",
};

const extensionLanguageMap: Record<string, string> = {
    ".astro": "html",
    ".cts": "typescript",
    ".j2": "html",
    ".jinja": "html",
    ".jinja2": "html",
    ".jsonc": "json",
    ".svelte": "html",
    ".vue": "html",
};

function joinAbsolutePath(dir: string, name: string): string {
    if (!dir) {
        return name;
    }
    if (!name) {
        return dir;
    }
    return dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;
}

function getAbsoluteFilePath(fileInfo: FileInfo | null): string {
    if (!fileInfo) {
        return "";
    }
    if (fileInfo.dir && fileInfo.name) {
        return joinAbsolutePath(fileInfo.dir, fileInfo.name);
    }
    if (fileInfo.path) {
        return fileInfo.path;
    }
    return fileInfo.name ?? "";
}

function getFileLanguage(fileName: string | null): string | undefined {
    const baseName = fileName ? fileName.split("/").pop() : null;
    if (!baseName) {
        return undefined;
    }
    if (shellFileMap[baseName]) {
        return shellFileMap[baseName];
    }
    const extensionMatch = baseName.toLowerCase().match(/(\.[^.]+)$/);
    if (!extensionMatch) {
        return undefined;
    }
    if ([".md", ".markdown", ".mdx"].includes(extensionMatch[1])) {
        return "markdown";
    }
    return extensionLanguageMap[extensionMatch[1]];
}

function buildCopyContextText(
    absoluteFilePath: string,
    lineNumber: number,
    snippet: string,
    language?: string
): string {
    const filePath = absoluteFilePath || "(unknown-path)";
    const codeFence = language ? `\`\`\`${language}` : "```";
    return `${filePath}:${lineNumber}\n${codeFence}\n${snippet}\n\`\`\``;
}

function revealSearchTargetLine(editor: MonacoTypes.editor.IStandaloneCodeEditor, targetLine: number | null) {
    if (targetLine == null) {
        return;
    }
    const editorModel = editor.getModel();
    if (!editorModel) {
        return;
    }
    const lineNumber = Math.min(targetLine, editorModel.getLineCount());
    editor.revealLineInCenter(lineNumber);
    editor.setPosition({ lineNumber, column: 1 });
}

type MonacoFindMatch = ReturnType<MonacoTypes.editor.ITextModel["findMatches"]>[number];

const SearchMatchDecorationClass = "preview-editor-search-match";
const SearchActiveMatchDecorationClass = "preview-editor-search-active-match";
const OrderedListMovedDecorationClass = "preview-editor-list-moved";
const OrderedListSwappedDecorationClass = "preview-editor-list-swapped";
const OrderedListPreviewMovedDecorationClass = "preview-editor-list-preview-moved";
const OrderedListPreviewSwappedDecorationClass = "preview-editor-list-preview-swapped";
const MarkdownMovePreviewInsertBeforeDecorationClass = "preview-editor-node-preview-insert-before";
const MarkdownMovePreviewInsertAfterDecorationClass = "preview-editor-node-preview-insert-after";
const MarkdownNodeActionButtonOffset = 8;
const MarkdownNodeControlsWidth = 146;
const MarkdownNodeControlsHeight = 24;
const OrderedListMoveFeedbackMs = 900;
const MarkdownNodeDragMoveThresholdPx = 18;
const MarkdownListEnabledContextKey = "snorkelingMarkdownListEnabled";
const MarkdownListCanMoveUpContextKey = "snorkelingMarkdownListCanMoveUp";
const MarkdownListCanMoveDownContextKey = "snorkelingMarkdownListCanMoveDown";
const MarkdownListHasSelectionContextKey = "snorkelingMarkdownListHasSelection";

type MarkdownMoveControlState =
    | {
          kind: "ordered-list";
          state: OrderedListMoveState;
      }
    | {
          kind: "heading";
          state: MarkdownHeadingMoveState;
      };

type MarkdownMoveLineRange = OrderedListLineRange | MarkdownHeadingLineRange;

type MarkdownNodeEditResult = {
    text: string;
    targetLineNumber?: number;
    targetColumn?: number;
    movedRange?: MarkdownMoveLineRange;
    swappedRange?: MarkdownMoveLineRange;
    cutText?: string;
};

type MonacoFoldingContributionState = {
    collapsedRegions?: MonacoCollapsedRegion[];
};

const MonacoFoldingContributionId = "editor.contrib.folding";

function wrapSearchIndex(index: number, matchCount: number): number {
    if (matchCount <= 0) {
        return 0;
    }
    return ((index % matchCount) + matchCount) % matchCount;
}

function makeSearchDecorations(
    matches: MonacoFindMatch[],
    activeIndex: number
): MonacoTypes.editor.IModelDeltaDecoration[] {
    return matches.map((match, idx) => ({
        range: match.range,
        options: {
            inlineClassName: idx === activeIndex ? SearchActiveMatchDecorationClass : SearchMatchDecorationClass,
        },
    }));
}

function compareSearchMatchStartDescending(left: MonacoFindMatch, right: MonacoFindMatch): number {
    if (left.range.startLineNumber !== right.range.startLineNumber) {
        return right.range.startLineNumber - left.range.startLineNumber;
    }
    return right.range.startColumn - left.range.startColumn;
}

function clampMarkdownNodeControlsPosition(
    containerWidth: number,
    containerHeight: number,
    desiredX: number,
    desiredY: number
): Pick<SelectionCopyOverlayState, "x" | "y"> {
    return {
        x: Math.max(
            MarkdownNodeActionButtonOffset,
            Math.min(desiredX, containerWidth - MarkdownNodeControlsWidth - MarkdownNodeActionButtonOffset)
        ),
        y: Math.max(
            MarkdownNodeActionButtonOffset,
            Math.min(desiredY, containerHeight - MarkdownNodeControlsHeight - MarkdownNodeActionButtonOffset)
        ),
    };
}

function makeOrderedListMoveDecorations(
    movedRange: MarkdownMoveLineRange | undefined,
    swappedRange: MarkdownMoveLineRange | undefined,
    options?: { preview?: boolean }
): MonacoTypes.editor.IModelDeltaDecoration[] {
    const movedClassName = options?.preview ? OrderedListPreviewMovedDecorationClass : OrderedListMovedDecorationClass;
    const swappedClassName = options?.preview
        ? OrderedListPreviewSwappedDecorationClass
        : OrderedListSwappedDecorationClass;
    const decorations: MonacoTypes.editor.IModelDeltaDecoration[] = [];
    if (movedRange) {
        decorations.push({
            range: new monaco.Range(movedRange.startLineNumber, 1, movedRange.endLineNumber, 1),
            options: {
                isWholeLine: true,
                className: movedClassName,
            },
        });
    }
    if (swappedRange) {
        decorations.push({
            range: new monaco.Range(swappedRange.startLineNumber, 1, swappedRange.endLineNumber, 1),
            options: {
                isWholeLine: true,
                className: swappedClassName,
            },
        });
    }
    return decorations;
}

function getMarkdownNodeControlRange(controlState: MarkdownMoveControlState): MarkdownMoveLineRange {
    return controlState.kind === "ordered-list"
        ? {
              startLineNumber: controlState.state.itemStartLineNumber,
              endLineNumber: controlState.state.itemEndLineNumber,
          }
        : {
              startLineNumber: controlState.state.sectionStartLineNumber,
              endLineNumber: controlState.state.sectionEndLineNumber,
          };
}

function makeMarkdownNodeInsertPreviewDecorations(
    range: MarkdownMoveLineRange,
    placement: "above" | "below"
): MonacoTypes.editor.IModelDeltaDecoration[] {
    const lineNumber = placement === "above" ? range.startLineNumber : range.endLineNumber;
    return [
        {
            range: new monaco.Range(lineNumber, 1, lineNumber, 1),
            options: {
                isWholeLine: true,
                className:
                    placement === "above"
                        ? MarkdownMovePreviewInsertBeforeDecorationClass
                        : MarkdownMovePreviewInsertAfterDecorationClass,
            },
        },
    ];
}

function getMonacoCollapsedRegions(editor: MonacoTypes.editor.IStandaloneCodeEditor): MonacoCollapsedRegion[] {
    const viewState = editor.saveViewState();
    const foldingState = viewState?.contributionsState?.[MonacoFoldingContributionId] as
        | MonacoFoldingContributionState
        | undefined;
    return foldingState?.collapsedRegions ?? [];
}

function captureEditorMarkdownFoldSnapshot(
    editor: MonacoTypes.editor.IStandaloneCodeEditor,
    text: string
): MarkdownFoldSnapshot | null {
    const collapsedRegions = getMonacoCollapsedRegions(editor);
    if (collapsedRegions.length === 0) {
        return null;
    }
    return captureMarkdownFoldSnapshot(text, collapsedRegions);
}

function restoreEditorMarkdownFoldSnapshot(
    editor: MonacoTypes.editor.IStandaloneCodeEditor,
    text: string,
    snapshot: MarkdownFoldSnapshot | null
): void {
    const foldLines = resolveMarkdownFoldLines(text, snapshot);
    if (foldLines.length === 0) {
        return;
    }
    window.setTimeout(() => {
        editor.trigger("snorkeling.markdown-fold-restore", "editor.fold", {
            selectionLines: foldLines.map((lineNumber) => lineNumber - 1),
        });
    }, 0);
}

function CodeEditPreview({ model }: SpecializedViewProps) {
    const fileContentLoadable = useAtomValue(model.fileContentLoadable);
    const setNewFileContent = useSetAtom(model.newFileContent);
    const newFileContent = useAtomValue(model.newFileContent);
    const fileInfo = useAtomValue(model.statFile);
    const fileEditKey = useAtomValue(model.fileEditKey);
    const searchTargetLine = useAtomValue(model.searchTargetLine);
    const [selectionCopyOverlay, setSelectionCopyOverlay] = useState<SelectionCopyOverlayState | null>(null);
    const [markdownMoveControls, setMarkdownMoveControls] = useState<{
        x: number;
        y: number;
        controlState: MarkdownMoveControlState;
    } | null>(null);
    const editorContainerRef = useRef<HTMLDivElement>(null);
    const searchDecorationIdsRef = useRef<string[]>([]);
    const markdownMoveDecorationIdsRef = useRef<string[]>([]);
    const markdownMovePreviewDecorationIdsRef = useRef<string[]>([]);
    const markdownMoveFeedbackTimerRef = useRef<number | null>(null);
    const searchMatchesRef = useRef<MonacoFindMatch[]>([]);
    const currentSearchIndexRef = useRef(0);
    const searchValueRef = useRef("");
    const replaceValueRef = useRef("");
    const wasSearchOpenRef = useRef(false);
    const suppressSelectionCopyOverlayRef = useRef(false);
    const markdownMoveActionsEnabledRef = useRef(false);
    const markdownListActionsEnabledRef = useRef(false);
    const markdownHeadingActionsEnabledRef = useRef(false);
    const previousFileEditKeyRef = useRef<string | null>(null);
    const moveCurrentMarkdownBlockRef = useRef<(direction: "up" | "down") => void>(() => {});
    const renumberSelectedOrderedListRef = useRef<() => void>(() => {});
    const refreshMarkdownMoveStateRef = useRef<() => void>(() => {});
    const fileName = fileInfo?.path || fileInfo?.name;
    const fileContent = fileContentLoadable.state === "hasData" ? fileContentLoadable.data : "";

    const language = getFileLanguage(fileName);
    const markdownListActionsEnabled = isMarkdownOrderedListPath(fileName) && !fileInfo?.readonly;
    const markdownHeadingActionsEnabled = isMarkdownHeadingSectionPath(fileName) && !fileInfo?.readonly;
    const markdownMoveActionsEnabled = markdownListActionsEnabled || markdownHeadingActionsEnabled;

    useLayoutEffect(() => {
        previewSharedDraftDebugLog("edit:register-layout-effect", {
            blockId: model.blockId,
            previousFileEditKey: previousFileEditKeyRef.current,
            fileEditKey,
        });
        model.migrateFileEditKey(previousFileEditKeyRef.current, fileEditKey);
        previousFileEditKeyRef.current = fileEditKey;
        return model.registerFileEditKey(fileEditKey);
    }, [fileEditKey, model]);

    useEffect(() => {
        previewSharedDraftDebugLog("edit:render-state", {
            blockId: model.blockId,
            fileEditKey,
            fileName,
            readonly: fileInfo?.readonly,
            fileContent: summarizePreviewDraftContent(fileContent),
            fileContentState: fileContentLoadable.state,
            newFileContent: summarizePreviewDraftContent(newFileContent),
        });
    }, [
        fileContent,
        fileContentLoadable.state,
        fileEditKey,
        fileInfo?.readonly,
        fileName,
        model.blockId,
        newFileContent,
    ]);

    const searchProps = useSearch({
        anchorRef: editorContainerRef,
        viewModel: model,
        caseSensitive: false,
        wholeWord: false,
        regex: false,
        replace: true,
    });
    const searchIsOpen = useAtomValue<boolean>(searchProps.isOpen);
    const searchValue = useAtomValue<string>(searchProps.searchValue);
    const replaceValue = useAtomValueSafe<string>(searchProps.replaceValue) ?? "";
    const caseSensitive = useAtomValueSafe<boolean>(searchProps.caseSensitive) ?? false;
    const wholeWord = useAtomValueSafe<boolean>(searchProps.wholeWord) ?? false;
    const regex = useAtomValueSafe<boolean>(searchProps.regex) ?? false;
    const setSearchIndex = useSetAtom(searchProps.resultsIndex);
    const setNumSearchResults = useSetAtom(searchProps.resultsCount);

    const clearEditorSearch = useCallback(() => {
        editorSearchLog("clear");
        searchMatchesRef.current = [];
        currentSearchIndexRef.current = 0;
        setSearchIndex(0);
        setNumSearchResults(0);
        const editor = model.monacoRef.current;
        if (editor) {
            searchDecorationIdsRef.current = editor.deltaDecorations(searchDecorationIdsRef.current, []);
        } else {
            searchDecorationIdsRef.current = [];
        }
    }, [model, setNumSearchResults, setSearchIndex]);

    const runEditorSearch = useCallback(
        (searchText: string, preferredIndex = 0) => {
            searchValueRef.current = searchText;
            const editor = model.monacoRef.current;
            const editorModel = editor?.getModel();
            if (!editor || !editorModel || searchText === "") {
                editorSearchLog("run skipped", {
                    hasEditor: !!editor,
                    hasModel: !!editorModel,
                    queryLength: searchText.length,
                });
                clearEditorSearch();
                return;
            }
            try {
                const wordSeparators = wholeWord ? editor.getOption(monaco.editor.EditorOption.wordSeparators) : null;
                const matches = editorModel.findMatches(searchText, false, regex, caseSensitive, wordSeparators, false);
                const activeIndex = wrapSearchIndex(preferredIndex, matches.length);
                searchMatchesRef.current = matches;
                currentSearchIndexRef.current = activeIndex;
                setSearchIndex(activeIndex);
                setNumSearchResults(matches.length);
                editorSearchLog("run", {
                    activeIndex,
                    caseSensitive,
                    matches: matches.length,
                    queryLength: searchText.length,
                    regex,
                    wholeWord,
                });
                searchDecorationIdsRef.current = editor.deltaDecorations(
                    searchDecorationIdsRef.current,
                    makeSearchDecorations(matches, activeIndex)
                );
                if (matches.length === 0) {
                    return;
                }
                const activeRange = matches[activeIndex].range;
                suppressSelectionCopyOverlayRef.current = true;
                editor.revealRangeInCenter(activeRange);
                requestAnimationFrame(() => {
                    suppressSelectionCopyOverlayRef.current = false;
                    setSelectionCopyOverlay(null);
                });
            } catch (e) {
                console.warn("editor search failed", e);
                clearEditorSearch();
            }
        },
        [caseSensitive, clearEditorSearch, model, regex, setNumSearchResults, setSearchIndex, wholeWord]
    );

    const goToSearchMatch = useCallback(
        (delta: number) => {
            const matches = searchMatchesRef.current;
            const editor = model.monacoRef.current;
            if (!editor || matches.length === 0) {
                editorSearchLog("navigate skipped", { delta, hasEditor: !!editor, matches: matches.length });
                return;
            }
            const nextIndex = wrapSearchIndex(currentSearchIndexRef.current + delta, matches.length);
            currentSearchIndexRef.current = nextIndex;
            setSearchIndex(nextIndex);
            setNumSearchResults(matches.length);
            editorSearchLog("navigate", { delta, nextIndex, matches: matches.length });
            searchDecorationIdsRef.current = editor.deltaDecorations(
                searchDecorationIdsRef.current,
                makeSearchDecorations(matches, nextIndex)
            );
            const activeRange = matches[nextIndex].range;
            suppressSelectionCopyOverlayRef.current = true;
            editor.revealRangeInCenter(activeRange);
            requestAnimationFrame(() => {
                suppressSelectionCopyOverlayRef.current = false;
                setSelectionCopyOverlay(null);
            });
        },
        [model, setNumSearchResults, setSearchIndex]
    );

    const replaceCurrentMatch = useCallback(() => {
        if (fileInfo?.readonly) {
            editorSearchLog("replace current skipped: readonly");
            return;
        }
        const editor = model.monacoRef.current;
        const matches = searchMatchesRef.current;
        const match = matches[currentSearchIndexRef.current];
        if (!editor || !match) {
            editorSearchLog("replace current skipped", {
                hasEditor: !!editor,
                hasMatch: !!match,
                matches: matches.length,
            });
            return;
        }
        editorSearchLog("replace current", {
            index: currentSearchIndexRef.current,
            matches: matches.length,
            replacementLength: replaceValueRef.current.length,
        });
        editor.pushUndoStop();
        editor.executeEdits("preview-editor-replace", [
            {
                range: match.range,
                text: replaceValueRef.current,
                forceMoveMarkers: true,
            },
        ]);
        editor.pushUndoStop();
        runEditorSearch(searchValueRef.current, currentSearchIndexRef.current);
    }, [fileInfo?.readonly, model, runEditorSearch]);

    const replaceAllMatches = useCallback(() => {
        if (fileInfo?.readonly) {
            editorSearchLog("replace all skipped: readonly");
            return;
        }
        const editor = model.monacoRef.current;
        const matches = [...searchMatchesRef.current];
        if (!editor || matches.length === 0) {
            editorSearchLog("replace all skipped", { hasEditor: !!editor, matches: matches.length });
            return;
        }
        editorSearchLog("replace all", { matches: matches.length, replacementLength: replaceValueRef.current.length });
        editor.pushUndoStop();
        editor.executeEdits(
            "preview-editor-replace-all",
            matches.sort(compareSearchMatchStartDescending).map((match) => ({
                range: match.range,
                text: replaceValueRef.current,
                forceMoveMarkers: true,
            }))
        );
        editor.pushUndoStop();
        runEditorSearch(searchValueRef.current, 0);
    }, [fileInfo?.readonly, model, runEditorSearch]);

    searchProps.onSearch = useCallback(
        (nextSearchValue: string) => {
            runEditorSearch(nextSearchValue, 0);
        },
        [runEditorSearch]
    );
    searchProps.onPrev = useCallback(() => goToSearchMatch(-1), [goToSearchMatch]);
    searchProps.onNext = useCallback(() => goToSearchMatch(1), [goToSearchMatch]);
    searchProps.onReplace = replaceCurrentMatch;
    searchProps.onReplaceAll = replaceAllMatches;
    searchProps.replaceDisabled = !!fileInfo?.readonly;

    const clearMarkdownMoveFeedback = useCallback(
        (editor?: MonacoTypes.editor.IStandaloneCodeEditor): void => {
            if (markdownMoveFeedbackTimerRef.current != null) {
                window.clearTimeout(markdownMoveFeedbackTimerRef.current);
                markdownMoveFeedbackTimerRef.current = null;
            }
            const targetEditor = editor ?? model.monacoRef.current;
            if (targetEditor) {
                markdownMoveDecorationIdsRef.current = targetEditor.deltaDecorations(
                    markdownMoveDecorationIdsRef.current,
                    []
                );
            } else {
                markdownMoveDecorationIdsRef.current = [];
            }
        },
        [model]
    );

    const clearMarkdownMovePreview = useCallback(
        (editor?: MonacoTypes.editor.IStandaloneCodeEditor): void => {
            const targetEditor = editor ?? model.monacoRef.current;
            if (targetEditor) {
                markdownMovePreviewDecorationIdsRef.current = targetEditor.deltaDecorations(
                    markdownMovePreviewDecorationIdsRef.current,
                    []
                );
            } else {
                markdownMovePreviewDecorationIdsRef.current = [];
            }
        },
        [model]
    );

    const showMarkdownMovePreview = useCallback(
        (direction: "up" | "down", kind: MarkdownMoveControlState["kind"]): void => {
            if (!markdownMoveActionsEnabled) return;
            const editor = model.monacoRef.current;
            const editorModel = editor?.getModel();
            const position = editor?.getPosition();
            if (!editor || !editorModel || !position) return;
            const text = editorModel.getValue();
            const preview =
                kind === "ordered-list"
                    ? getOrderedListSwapPreview(text, position.lineNumber, direction)
                    : getMarkdownHeadingSwapPreview(text, position.lineNumber, direction);
            clearMarkdownMovePreview(editor);
            if (preview == null) return;
            markdownMovePreviewDecorationIdsRef.current = editor.deltaDecorations(
                [],
                makeOrderedListMoveDecorations(preview.movedRange, preview.swappedRange, { preview: true })
            );
        },
        [clearMarkdownMovePreview, markdownMoveActionsEnabled, model]
    );

    const showMarkdownMoveFeedback = useCallback(
        (
            editor: MonacoTypes.editor.IStandaloneCodeEditor,
            movedRange: MarkdownMoveLineRange | undefined,
            swappedRange: MarkdownMoveLineRange | undefined
        ): void => {
            clearMarkdownMoveFeedback(editor);
            const decorations = makeOrderedListMoveDecorations(movedRange, swappedRange);
            if (decorations.length === 0) return;
            markdownMoveDecorationIdsRef.current = editor.deltaDecorations([], decorations);
            markdownMoveFeedbackTimerRef.current = window.setTimeout(() => {
                markdownMoveDecorationIdsRef.current = editor.deltaDecorations(
                    markdownMoveDecorationIdsRef.current,
                    []
                );
                markdownMoveFeedbackTimerRef.current = null;
            }, OrderedListMoveFeedbackMs);
        },
        [clearMarkdownMoveFeedback]
    );

    const applyFullEditorText = useCallback(
        (
            editor: MonacoTypes.editor.IStandaloneCodeEditor,
            nextText: string,
            targetLineNumber?: number,
            targetColumn?: number,
            moveFeedback?: { movedRange?: MarkdownMoveLineRange; swappedRange?: MarkdownMoveLineRange }
        ): void => {
            const editorModel = editor.getModel();
            if (!editorModel) return;
            editor.pushUndoStop();
            editor.executeEdits("preview-editor-markdown-list", [
                {
                    range: editorModel.getFullModelRange(),
                    text: nextText,
                    forceMoveMarkers: true,
                },
            ]);
            if (targetLineNumber != null) {
                const lineNumber = Math.max(1, Math.min(targetLineNumber, editorModel.getLineCount()));
                const column = Math.max(1, Math.min(targetColumn ?? 1, editorModel.getLineMaxColumn(lineNumber)));
                editor.setPosition({ lineNumber, column });
                editor.revealLineInCenter(lineNumber);
            }
            if (moveFeedback) {
                showMarkdownMoveFeedback(editor, moveFeedback.movedRange, moveFeedback.swappedRange);
            }
            editor.pushUndoStop();
            model.monacoRef.current?.focus();
        },
        [model, showMarkdownMoveFeedback]
    );

    const moveCurrentMarkdownBlock = useCallback(
        (direction: "up" | "down"): void => {
            if (!markdownMoveActionsEnabled) return;
            const editor = model.monacoRef.current;
            const editorModel = editor?.getModel();
            const position = editor?.getPosition();
            if (!editor || !editorModel || !position) return;
            clearMarkdownMovePreview(editor);
            const text = editorModel.getValue();
            const listState = markdownListActionsEnabled ? getOrderedListMoveState(text, position.lineNumber) : null;
            const movingHeadingSection = listState == null && markdownHeadingActionsEnabled;
            const foldSnapshot = movingHeadingSection ? captureEditorMarkdownFoldSnapshot(editor, text) : null;
            const result =
                listState != null
                    ? moveOrderedListItem(text, position.lineNumber, direction)
                    : movingHeadingSection
                      ? moveMarkdownHeadingSection(text, position.lineNumber, direction)
                      : null;
            if (result == null) return;
            applyFullEditorText(editor, result.text, result.targetLineNumber, result.targetColumn, {
                movedRange: result.movedRange,
                swappedRange: result.swappedRange,
            });
            if (movingHeadingSection) {
                restoreEditorMarkdownFoldSnapshot(editor, result.text, foldSnapshot);
            }
            setSelectionCopyOverlay(null);
        },
        [
            applyFullEditorText,
            clearMarkdownMovePreview,
            markdownHeadingActionsEnabled,
            markdownListActionsEnabled,
            markdownMoveActionsEnabled,
            model,
        ]
    );

    const showMarkdownInsertPreview = useCallback(
        (controlState: MarkdownMoveControlState, placement: "above" | "below"): void => {
            if (!markdownMoveActionsEnabled) return;
            const editor = model.monacoRef.current;
            if (!editor) return;
            clearMarkdownMovePreview(editor);
            markdownMovePreviewDecorationIdsRef.current = editor.deltaDecorations(
                [],
                makeMarkdownNodeInsertPreviewDecorations(getMarkdownNodeControlRange(controlState), placement)
            );
        },
        [clearMarkdownMovePreview, markdownMoveActionsEnabled, model]
    );

    const showMarkdownMoveOrInsertPreview = useCallback(
        (
            controlState: MarkdownMoveControlState,
            preview: { kind: "move"; direction: "up" | "down" } | { kind: "insert"; placement: "above" | "below" }
        ): void => {
            if (preview.kind === "move") {
                showMarkdownMovePreview(preview.direction, controlState.kind);
                return;
            }
            showMarkdownInsertPreview(controlState, preview.placement);
        },
        [showMarkdownInsertPreview, showMarkdownMovePreview]
    );

    const runCurrentMarkdownNodeEdit = useCallback(
        (
            makeEdit: (
                text: string,
                lineNumber: number,
                editKind: MarkdownMoveControlState["kind"]
            ) => MarkdownNodeEditResult | null,
            options?: { copyCutText?: boolean; preserveHeadingFolds?: boolean }
        ): void => {
            if (!markdownMoveActionsEnabled) return;
            const editor = model.monacoRef.current;
            const editorModel = editor?.getModel();
            const position = editor?.getPosition();
            if (!editor || !editorModel || !position) return;

            const text = editorModel.getValue();
            const listState = markdownListActionsEnabled ? getOrderedListMoveState(text, position.lineNumber) : null;
            const editingHeadingSection = listState == null && markdownHeadingActionsEnabled;
            const editKind: MarkdownMoveControlState["kind"] = listState != null ? "ordered-list" : "heading";
            if (listState == null && !editingHeadingSection) return;

            const foldSnapshot =
                editingHeadingSection && options?.preserveHeadingFolds
                    ? captureEditorMarkdownFoldSnapshot(editor, text)
                    : null;
            const result = makeEdit(text, position.lineNumber, editKind);
            if (result == null) return;

            clearMarkdownMovePreview(editor);
            clearMarkdownMoveFeedback(editor);
            if (options?.copyCutText && result.cutText) {
                fireAndForget(async () => {
                    await navigator.clipboard.writeText(result.cutText ?? "");
                });
            }
            applyFullEditorText(editor, result.text, result.targetLineNumber, result.targetColumn, {
                movedRange: result.movedRange,
                swappedRange: result.swappedRange,
            });
            if (editingHeadingSection && foldSnapshot) {
                restoreEditorMarkdownFoldSnapshot(editor, result.text, foldSnapshot);
            }
            setSelectionCopyOverlay(null);
        },
        [
            applyFullEditorText,
            clearMarkdownMoveFeedback,
            clearMarkdownMovePreview,
            markdownHeadingActionsEnabled,
            markdownListActionsEnabled,
            markdownMoveActionsEnabled,
            model,
        ]
    );

    const insertCurrentMarkdownNode = useCallback(
        (placement: "above" | "below"): void => {
            runCurrentMarkdownNodeEdit(
                (text, lineNumber, editKind) =>
                    editKind === "ordered-list"
                        ? insertOrderedListItem(text, lineNumber, placement)
                        : insertMarkdownHeadingSection(text, lineNumber, placement),
                { preserveHeadingFolds: true }
            );
        },
        [runCurrentMarkdownNodeEdit]
    );

    const cutCurrentMarkdownNode = useCallback((): void => {
        runCurrentMarkdownNodeEdit(
            (text, lineNumber, editKind) =>
                editKind === "ordered-list"
                    ? cutOrderedListItem(text, lineNumber)
                    : cutMarkdownHeadingSection(text, lineNumber),
            { copyCutText: true, preserveHeadingFolds: true }
        );
    }, [runCurrentMarkdownNodeEdit]);

    const startMarkdownNodeDrag = useCallback(
        (event: ReactPointerEvent<HTMLButtonElement>, controlState: MarkdownMoveControlState): void => {
            if (!markdownMoveActionsEnabled) return;
            event.preventDefault();
            event.stopPropagation();
            const previousCursor = document.body.style.cursor;
            const previousUserSelect = document.body.style.userSelect;
            document.body.style.cursor = "grabbing";
            document.body.style.userSelect = "none";
            let lastY = event.clientY;
            let canMoveUp = controlState.state.canMoveUp;
            let canMoveDown = controlState.state.canMoveDown;

            const refreshCanMove = () => {
                const editor = model.monacoRef.current;
                const editorModel = editor?.getModel();
                const position = editor?.getPosition();
                if (!editor || !editorModel || !position) return;
                const text = editorModel.getValue();
                const state =
                    controlState.kind === "ordered-list"
                        ? getOrderedListMoveState(text, position.lineNumber)
                        : getMarkdownHeadingMoveState(text, position.lineNumber);
                canMoveUp = state?.canMoveUp ?? false;
                canMoveDown = state?.canMoveDown ?? false;
            };

            const handlePointerMove = (moveEvent: PointerEvent) => {
                moveEvent.preventDefault();
                const deltaY = moveEvent.clientY - lastY;
                if (Math.abs(deltaY) < MarkdownNodeDragMoveThresholdPx) {
                    return;
                }
                const direction = deltaY < 0 ? "up" : "down";
                if ((direction === "up" && !canMoveUp) || (direction === "down" && !canMoveDown)) {
                    return;
                }
                moveCurrentMarkdownBlock(direction);
                lastY = moveEvent.clientY;
                window.setTimeout(refreshCanMove, 0);
            };

            const handlePointerUp = () => {
                document.body.style.cursor = previousCursor;
                document.body.style.userSelect = previousUserSelect;
                clearMarkdownMovePreview();
                window.removeEventListener("pointermove", handlePointerMove);
                window.removeEventListener("pointerup", handlePointerUp);
                window.removeEventListener("pointercancel", handlePointerUp);
            };

            window.addEventListener("pointermove", handlePointerMove);
            window.addEventListener("pointerup", handlePointerUp);
            window.addEventListener("pointercancel", handlePointerUp);
        },
        [clearMarkdownMovePreview, markdownMoveActionsEnabled, model, moveCurrentMarkdownBlock]
    );

    const renumberSelectedOrderedList = useCallback((): void => {
        if (!markdownListActionsEnabled) return;
        const editor = model.monacoRef.current;
        const editorModel = editor?.getModel();
        const selection = editor?.getSelection();
        if (!editor || !editorModel || !selection || selection.isEmpty()) return;
        const result = renumberOrderedListsInSelection(
            editorModel.getValue(),
            selection.startLineNumber,
            selection.endLineNumber
        );
        if (result == null) return;
        applyFullEditorText(editor, result.text);
        setSelectionCopyOverlay(null);
    }, [applyFullEditorText, markdownListActionsEnabled, model]);

    useEffect(() => {
        markdownMoveActionsEnabledRef.current = markdownMoveActionsEnabled;
        markdownListActionsEnabledRef.current = markdownListActionsEnabled;
        markdownHeadingActionsEnabledRef.current = markdownHeadingActionsEnabled;
        moveCurrentMarkdownBlockRef.current = moveCurrentMarkdownBlock;
        renumberSelectedOrderedListRef.current = renumberSelectedOrderedList;
    }, [
        markdownHeadingActionsEnabled,
        markdownListActionsEnabled,
        markdownMoveActionsEnabled,
        moveCurrentMarkdownBlock,
        renumberSelectedOrderedList,
    ]);

    useEffect(() => {
        refreshMarkdownMoveStateRef.current();
    }, [fileInfo?.path, markdownMoveActionsEnabled]);

    function codeEditKeyDownHandler(e: WaveKeyboardEvent): boolean {
        if (checkKeyPressed(e, "Cmd:e")) {
            fireAndForget(() => model.setEditMode(false));
            return true;
        }
        if (checkKeyPressed(e, "Cmd:s") || checkKeyPressed(e, "Ctrl:s")) {
            fireAndForget(model.handleFileSave.bind(model));
            return true;
        }
        if (checkKeyPressed(e, "Cmd:r")) {
            fireAndForget(model.handleFileRevert.bind(model));
            return true;
        }
        return false;
    }

    useEffect(() => {
        model.codeEditKeyDownHandler = codeEditKeyDownHandler;
        return () => {
            model.codeEditKeyDownHandler = null;
            model.monacoRef.current = null;
        };
    }, []);

    useEffect(() => {
        searchValueRef.current = searchValue;
    }, [searchValue]);

    useEffect(() => {
        replaceValueRef.current = replaceValue;
    }, [replaceValue]);

    useEffect(() => {
        if (!searchIsOpen) {
            if (wasSearchOpenRef.current) {
                clearEditorSearch();
                model.monacoRef.current?.focus();
            }
            wasSearchOpenRef.current = false;
            return;
        }
        wasSearchOpenRef.current = true;
    }, [clearEditorSearch, model, searchIsOpen]);

    useEffect(() => {
        if (!searchIsOpen) {
            return;
        }
        runEditorSearch(searchValueRef.current, currentSearchIndexRef.current);
    }, [caseSensitive, fileContent, regex, runEditorSearch, searchIsOpen, wholeWord]);

    useEffect(() => {
        if (searchTargetLine == null) {
            return;
        }
        const editor = model.monacoRef.current;
        if (!editor) {
            return;
        }
        revealSearchTargetLine(editor, searchTargetLine);
    }, [fileInfo?.path, model, searchTargetLine]);

    useEffect(() => {
        setSelectionCopyOverlay(null);
        clearMarkdownMovePreview();
    }, [clearMarkdownMovePreview, fileInfo?.path]);

    function onMount(editor: MonacoTypes.editor.IStandaloneCodeEditor, _monacoApi: typeof monaco): () => void {
        model.monacoRef.current = editor;
        const markdownListEnabledKey = editor.createContextKey<boolean>(MarkdownListEnabledContextKey, false);
        const markdownListCanMoveUpKey = editor.createContextKey<boolean>(MarkdownListCanMoveUpContextKey, false);
        const markdownListCanMoveDownKey = editor.createContextKey<boolean>(MarkdownListCanMoveDownContextKey, false);
        const markdownListHasSelectionKey = editor.createContextKey<boolean>(MarkdownListHasSelectionContextKey, false);

        const updateMarkdownMoveState = () => {
            const editorModel = editor.getModel();
            const position = editor.getPosition();
            const selection = editor.getSelection();
            const container = editorContainerRef.current;
            const enabled = markdownMoveActionsEnabledRef.current;
            const listEnabled = markdownListActionsEnabledRef.current;
            const headingEnabled = markdownHeadingActionsEnabledRef.current;
            markdownListEnabledKey.set(enabled);
            markdownListHasSelectionKey.set(listEnabled && !!selection && !selection.isEmpty());
            if (!enabled || !editorModel || !position || !container) {
                markdownListCanMoveUpKey.set(false);
                markdownListCanMoveDownKey.set(false);
                setMarkdownMoveControls(null);
                return;
            }
            const text = editorModel.getValue();
            const orderedListState = listEnabled ? getOrderedListMoveState(text, position.lineNumber) : null;
            const headingState =
                orderedListState == null && headingEnabled
                    ? getMarkdownHeadingMoveState(text, position.lineNumber)
                    : null;
            const controlState: MarkdownMoveControlState | null =
                orderedListState != null
                    ? { kind: "ordered-list", state: orderedListState }
                    : headingState != null
                      ? { kind: "heading", state: headingState }
                      : null;
            const state = controlState?.state;
            if (state == null) {
                markdownListCanMoveUpKey.set(false);
                markdownListCanMoveDownKey.set(false);
                setMarkdownMoveControls(null);
                return;
            }
            markdownListCanMoveUpKey.set(state.canMoveUp);
            markdownListCanMoveDownKey.set(state.canMoveDown);
            const visiblePosition = editor.getScrolledVisiblePosition(position);
            if (!visiblePosition) {
                setMarkdownMoveControls(null);
                return;
            }
            const controlsPosition = clampMarkdownNodeControlsPosition(
                container.clientWidth,
                container.clientHeight,
                visiblePosition.left + MarkdownNodeActionButtonOffset,
                visiblePosition.top + visiblePosition.height + MarkdownNodeActionButtonOffset
            );
            setMarkdownMoveControls({
                ...controlsPosition,
                controlState,
            });
        };
        refreshMarkdownMoveStateRef.current = updateMarkdownMoveState;

        const getLiveScrollEditorState = (
            directionOverride?: "up" | "down" | "none"
        ): {
            scrollTop: number;
            previousScrollTop: number;
            scrollHeight: number;
            viewportHeight: number;
            direction: "up" | "down" | "none";
            isAtBottom: boolean;
            remainingPx: number;
        } => {
            const previousState = globalStore.get(model.liveScrollSourceState);
            const scrollTop = editor.getScrollTop();
            const scrollHeight = editor.getScrollHeight();
            const viewportHeight = editor.getLayoutInfo().height;
            const remainingPx = Math.max(0, scrollHeight - viewportHeight - scrollTop);
            const lineHeight = editor.getOption(monaco.editor.EditorOption.lineHeight);
            return {
                scrollTop,
                previousScrollTop: previousState.scrollTop,
                scrollHeight,
                viewportHeight,
                direction:
                    directionOverride ??
                    (scrollTop > previousState.scrollTop
                        ? "down"
                        : scrollTop < previousState.scrollTop
                          ? "up"
                          : "none"),
                isAtBottom: remainingPx <= lineHeight * 1.5,
                remainingPx,
            };
        };

        const publishLiveScrollSourceState = (directionOverride?: "up" | "down" | "none") => {
            const previousState = globalStore.get(model.liveScrollSourceState);
            const previewOwnsScroll =
                previousState.origin === "preview" && Date.now() < previousState.previewControlUntil;
            globalStore.set(model.liveScrollSourceState, {
                sequence: previousState.sequence + 1,
                origin: previewOwnsScroll ? "preview" : "editor",
                previewControlUntil: previewOwnsScroll ? previousState.previewControlUntil : 0,
                bottomScrollIntent: false,
                ...getLiveScrollEditorState(directionOverride),
            });
        };

        const updateLiveScrollSourceLine = () => {
            const editorModel = editor.getModel();
            if (!editorModel || !globalStore.get(model.liveScrollSyncEnabled)) {
                liveScrollDebug("skip editor publish", {
                    blockId: model.blockId,
                    hasEditorModel: !!editorModel,
                    syncEnabled: globalStore.get(model.liveScrollSyncEnabled),
                });
                return;
            }
            publishLiveScrollSourceState();
            const visibleRanges = editor.getVisibleRanges();
            const firstVisibleLine = visibleRanges[0]?.startLineNumber;
            if (firstVisibleLine == null) {
                liveScrollDebug("skip editor publish: no visible line", { blockId: model.blockId });
                return;
            }
            if (globalStore.get(model.liveScrollSourceLine) === firstVisibleLine) {
                liveScrollDebug("skip editor publish: duplicate line", {
                    blockId: model.blockId,
                    firstVisibleLine,
                });
                return;
            }
            globalStore.set(model.liveScrollSourceLine, firstVisibleLine);
            liveScrollDebug("publish editor line", {
                blockId: model.blockId,
                firstVisibleLine,
                visibleRanges: visibleRanges.map((range) => ({
                    startLineNumber: range.startLineNumber,
                    endLineNumber: range.endLineNumber,
                })),
            });
        };

        const handleEditorWheel = (event: WheelEvent) => {
            if (event.deltaY <= 0 || !globalStore.get(model.liveScrollSyncEnabled)) {
                return;
            }
            const editorModel = editor.getModel();
            if (!editorModel) {
                return;
            }
            const nextState = getLiveScrollEditorState("down");
            if (!nextState.isAtBottom) {
                return;
            }
            const previousState = globalStore.get(model.liveScrollSourceState);
            globalStore.set(model.liveScrollSourceState, {
                sequence: previousState.sequence + 1,
                origin: "editor",
                previewControlUntil: 0,
                bottomScrollIntent: previousState.isAtBottom,
                ...nextState,
            });
            liveScrollDebug("publish editor bottom wheel", {
                blockId: model.blockId,
                deltaY: event.deltaY,
                remainingPx: nextState.remainingPx,
                sequence: previousState.sequence + 1,
            });
        };

        const updateSelectionCopyOverlay = () => {
            const editorModel = editor.getModel();
            const selection = editor.getSelection();
            const container = editorContainerRef.current;
            if (suppressSelectionCopyOverlayRef.current) {
                setSelectionCopyOverlay(null);
                return;
            }
            if (!editorModel || !selection || selection.isEmpty() || !container) {
                setSelectionCopyOverlay(null);
                return;
            }
            const text = editorModel.getValueInRange(selection);
            if (text.length === 0) {
                setSelectionCopyOverlay(null);
                return;
            }
            const visiblePosition = editor.getScrolledVisiblePosition(selection.getEndPosition());
            if (!visiblePosition) {
                setSelectionCopyOverlay(null);
                return;
            }
            const position = clampSelectionCopyOverlayPosition(
                container.clientWidth,
                container.clientHeight,
                visiblePosition.left + 8,
                visiblePosition.top + visiblePosition.height + 8
            );
            setSelectionCopyOverlay({
                ...position,
                text,
                contextText: buildCopyContextText(
                    getAbsoluteFilePath(fileInfo),
                    selection.startLineNumber,
                    text,
                    language
                ),
            });
        };

        const keyDownDisposer = editor.onKeyDown((e: MonacoTypes.IKeyboardEvent) => {
            const waveEvent = adaptFromReactOrNativeKeyEvent(e.browserEvent);
            const handled = tryReinjectKey(waveEvent);
            if (handled) {
                e.stopPropagation();
                e.preventDefault();
            }
        });
        const copyContextDisposer = editor.addAction({
            id: "snorkeling.copy-context",
            label: "🪧 Copy Context",
            contextMenuGroupId: "navigation",
            contextMenuOrder: 0.5,
            run: async () => {
                const editorModel = editor.getModel();
                if (!editorModel) {
                    return;
                }
                const selection = editor.getSelection();
                const cursorPosition = editor.getPosition();
                const lineNumber = selection?.startLineNumber ?? cursorPosition?.lineNumber ?? 1;
                let snippet = selection ? editorModel.getValueInRange(selection) : "";
                if (!snippet) {
                    snippet = editorModel.getLineContent(lineNumber);
                }
                const absoluteFilePath = getAbsoluteFilePath(fileInfo);
                const contextText = buildCopyContextText(absoluteFilePath, lineNumber, snippet, language);
                await navigator.clipboard.writeText(contextText);
            },
        });
        const searchInFilesDisposer = editor.addAction({
            id: "snorkeling.search-in-files",
            label: "Search In Files",
            contextMenuGroupId: "navigation",
            contextMenuOrder: 0.6,
            run: async () => {
                const editorModel = editor.getModel();
                if (!editorModel) {
                    return;
                }
                const selection = editor.getSelection();
                const cursorPosition = editor.getPosition();
                const lineNumber = selection?.startLineNumber ?? cursorPosition?.lineNumber ?? 1;
                let text = selection ? editorModel.getValueInRange(selection) : "";
                if (!text) {
                    text = editorModel.getLineContent(lineNumber);
                }
                const reference = parseFileReference(text);
                if (reference == null) {
                    window.alert("No file reference found in the selected text.");
                    return;
                }
                await searchSelectionInFiles(reference);
            },
        });
        const moveUpDisposer = editor.addAction({
            id: "snorkeling.markdown-block-move-up",
            label: "Move Markdown Block Up",
            contextMenuGroupId: "navigation",
            contextMenuOrder: 0.7,
            precondition: `${MarkdownListEnabledContextKey} && ${MarkdownListCanMoveUpContextKey}`,
            run: async () => moveCurrentMarkdownBlockRef.current("up"),
        });
        const moveDownDisposer = editor.addAction({
            id: "snorkeling.markdown-block-move-down",
            label: "Move Markdown Block Down",
            contextMenuGroupId: "navigation",
            contextMenuOrder: 0.71,
            precondition: `${MarkdownListEnabledContextKey} && ${MarkdownListCanMoveDownContextKey}`,
            run: async () => moveCurrentMarkdownBlockRef.current("down"),
        });
        const renumberDisposer = editor.addAction({
            id: "snorkeling.markdown-list-renumber",
            label: "Renumber Ordered List",
            contextMenuGroupId: "navigation",
            contextMenuOrder: 0.72,
            precondition: `${MarkdownListEnabledContextKey} && ${MarkdownListHasSelectionContextKey}`,
            run: async () => renumberSelectedOrderedListRef.current(),
        });
        const selectionDisposer = editor.onDidChangeCursorSelection(() => {
            updateSelectionCopyOverlay();
            updateMarkdownMoveState();
            clearMarkdownMovePreview(editor);
        });
        const orderedListCursorDisposer = editor.onDidChangeCursorPosition(() => {
            updateMarkdownMoveState();
            clearMarkdownMovePreview(editor);
        });
        const contentDisposer = editor.onDidChangeModelContent(() => {
            updateMarkdownMoveState();
            clearMarkdownMovePreview(editor);
        });
        const scrollDisposer = editor.onDidScrollChange(() => {
            setSelectionCopyOverlay(null);
            updateMarkdownMoveState();
            clearMarkdownMovePreview(editor);
            updateLiveScrollSourceLine();
        });
        const blurDisposer = editor.onDidBlurEditorText(() => {
            setSelectionCopyOverlay(null);
            clearMarkdownMovePreview(editor);
        });
        const mouseDownDisposer = editor.onMouseDown(() => {
            setSelectionCopyOverlay(null);
            clearMarkdownMovePreview(editor);
        });
        const editorDomNode = editor.getDomNode();
        editorDomNode?.addEventListener("wheel", handleEditorWheel, { passive: true });

        const isFocused = globalStore.get(model.nodeModel.isFocused);
        if (isFocused) {
            editor.focus();
        }
        revealSearchTargetLine(editor, globalStore.get(model.searchTargetLine));
        updateMarkdownMoveState();
        updateLiveScrollSourceLine();

        return () => {
            searchDecorationIdsRef.current = editor.deltaDecorations(searchDecorationIdsRef.current, []);
            clearMarkdownMoveFeedback(editor);
            clearMarkdownMovePreview(editor);
            refreshMarkdownMoveStateRef.current = () => {};
            keyDownDisposer.dispose();
            copyContextDisposer.dispose();
            searchInFilesDisposer.dispose();
            moveUpDisposer.dispose();
            moveDownDisposer.dispose();
            renumberDisposer.dispose();
            selectionDisposer.dispose();
            orderedListCursorDisposer.dispose();
            contentDisposer.dispose();
            scrollDisposer.dispose();
            blurDisposer.dispose();
            mouseDownDisposer.dispose();
            editorDomNode?.removeEventListener("wheel", handleEditorWheel);
        };
    }

    const hideSelectionCopyOverlay = useCallback(() => {
        setSelectionCopyOverlay(null);
    }, []);

    if (fileContentLoadable.state === "loading") {
        return <CenteredDiv>Loading file...</CenteredDiv>;
    }
    if (fileContentLoadable.state === "hasError") {
        return <CenteredDiv>File Read Failed: {`${fileContentLoadable.error}`}</CenteredDiv>;
    }

    return (
        <div className="relative flex h-full w-full" ref={editorContainerRef}>
            <CodeEditor
                blockId={model.blockId}
                text={fileContent}
                fileName={fileName}
                language={language}
                readonly={fileInfo.readonly}
                onChange={(text) => {
                    previewSharedDraftDebugLog("edit:on-change", {
                        blockId: model.blockId,
                        fileEditKey,
                        fileName,
                        text: summarizePreviewDraftContent(text),
                    });
                    setNewFileContent(text);
                }}
                onMount={onMount}
            />
            <Search {...searchProps} />
            <SelectionCopyOverlay
                overlay={selectionCopyOverlay}
                onHide={hideSelectionCopyOverlay}
                extraMenuItems={
                    selectionCopyOverlay?.contextText
                        ? [
                              ...(markdownListActionsEnabled
                                  ? [
                                        {
                                            label: "Renumber Ordered List",
                                            click: () => renumberSelectedOrderedList(),
                                        },
                                    ]
                                  : []),
                              {
                                  label: "Copy Context",
                                  click: () =>
                                      fireAndForget(() =>
                                          navigator.clipboard.writeText(selectionCopyOverlay.contextText)
                                      ),
                              },
                          ]
                        : undefined
                }
            />
            {markdownMoveControls ? (
                <div
                    className="preview-editor-list-controls"
                    style={{ left: `${markdownMoveControls.x}px`, top: `${markdownMoveControls.y}px` }}
                    onMouseDown={(e) => e.preventDefault()}
                >
                    <button
                        type="button"
                        className="preview-editor-list-drag-handle"
                        title={
                            markdownMoveControls.controlState.kind === "heading"
                                ? "Drag heading section"
                                : "Drag list item"
                        }
                        onPointerDown={(event) => startMarkdownNodeDrag(event, markdownMoveControls.controlState)}
                    >
                        <i className="fa-sharp fa-solid fa-grip-vertical" />
                    </button>
                    <button
                        type="button"
                        title={
                            markdownMoveControls.controlState.kind === "heading"
                                ? "Cut heading section"
                                : "Cut list item"
                        }
                        onClick={() => cutCurrentMarkdownNode()}
                    >
                        <i className="fa-sharp fa-solid fa-scissors" />
                    </button>
                    <button
                        type="button"
                        title={
                            markdownMoveControls.controlState.kind === "heading"
                                ? "Insert heading above"
                                : "Insert list item above"
                        }
                        onMouseEnter={() => showMarkdownInsertPreview(markdownMoveControls.controlState, "above")}
                        onMouseLeave={() => clearMarkdownMovePreview()}
                        onClick={() => insertCurrentMarkdownNode("above")}
                    >
                        <i className="fa-sharp fa-solid fa-plus" />
                        <i className="fa-sharp fa-solid fa-arrow-up preview-editor-list-secondary-icon" />
                    </button>
                    <button
                        type="button"
                        title={
                            markdownMoveControls.controlState.kind === "heading"
                                ? "Insert heading below"
                                : "Insert list item below"
                        }
                        onMouseEnter={() => showMarkdownInsertPreview(markdownMoveControls.controlState, "below")}
                        onMouseLeave={() => clearMarkdownMovePreview()}
                        onClick={() => insertCurrentMarkdownNode("below")}
                    >
                        <i className="fa-sharp fa-solid fa-plus" />
                        <i className="fa-sharp fa-solid fa-arrow-down preview-editor-list-secondary-icon" />
                    </button>
                    <button
                        type="button"
                        title={
                            markdownMoveControls.controlState.kind === "heading"
                                ? "Move heading section up"
                                : "Move list item up"
                        }
                        disabled={!markdownMoveControls.controlState.state.canMoveUp}
                        onMouseEnter={() =>
                            showMarkdownMoveOrInsertPreview(markdownMoveControls.controlState, {
                                kind: "move",
                                direction: "up",
                            })
                        }
                        onMouseLeave={() => clearMarkdownMovePreview()}
                        onClick={() => moveCurrentMarkdownBlock("up")}
                    >
                        <i className="fa-sharp fa-solid fa-arrow-up" />
                    </button>
                    <button
                        type="button"
                        title={
                            markdownMoveControls.controlState.kind === "heading"
                                ? "Move heading section down"
                                : "Move list item down"
                        }
                        disabled={!markdownMoveControls.controlState.state.canMoveDown}
                        onMouseEnter={() =>
                            showMarkdownMoveOrInsertPreview(markdownMoveControls.controlState, {
                                kind: "move",
                                direction: "down",
                            })
                        }
                        onMouseLeave={() => clearMarkdownMovePreview()}
                        onClick={() => moveCurrentMarkdownBlock("down")}
                    >
                        <i className="fa-sharp fa-solid fa-arrow-down" />
                    </button>
                </div>
            ) : null}
        </div>
    );
}

export { CodeEditPreview };
