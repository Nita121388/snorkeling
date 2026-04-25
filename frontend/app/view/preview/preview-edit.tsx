// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Search, useSearch } from "@/app/element/search";
import {
    clampSelectionCopyOverlayPosition,
    SelectionCopyOverlay,
    type SelectionCopyOverlayState,
} from "@/app/element/selection-copy-overlay";
import { globalStore } from "@/app/store/jotaiStore";
import { tryReinjectKey } from "@/app/store/keymodel";
import { CodeEditor } from "@/app/view/codeeditor/codeeditor";
import { adaptFromReactOrNativeKeyEvent, checkKeyPressed } from "@/util/keyutil";
import { fireAndForget, useAtomValueSafe } from "@/util/util";
import { useAtomValue, useSetAtom } from "jotai";
import type * as MonacoTypes from "monaco-editor";
import * as monaco from "monaco-editor";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SpecializedViewProps } from "./preview";
import "./preview-edit.scss";

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

function CodeEditPreview({ model }: SpecializedViewProps) {
    const fileContent = useAtomValue(model.fileContent);
    const setNewFileContent = useSetAtom(model.newFileContent);
    const fileInfo = useAtomValue(model.statFile);
    const searchTargetLine = useAtomValue(model.searchTargetLine);
    const [selectionCopyOverlay, setSelectionCopyOverlay] = useState<SelectionCopyOverlayState | null>(null);
    const editorContainerRef = useRef<HTMLDivElement>(null);
    const searchDecorationIdsRef = useRef<string[]>([]);
    const searchMatchesRef = useRef<MonacoFindMatch[]>([]);
    const currentSearchIndexRef = useRef(0);
    const searchValueRef = useRef("");
    const replaceValueRef = useRef("");
    const wasSearchOpenRef = useRef(false);
    const suppressSelectionCopyOverlayRef = useRef(false);
    const fileName = fileInfo?.path || fileInfo?.name;

    const baseName = fileName ? fileName.split("/").pop() : null;
    const language = baseName && shellFileMap[baseName] ? shellFileMap[baseName] : undefined;
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
                searchDecorationIdsRef.current = editor.deltaDecorations(
                    searchDecorationIdsRef.current,
                    makeSearchDecorations(matches, activeIndex)
                );
                if (matches.length === 0) {
                    return;
                }
                const activeRange = matches[activeIndex].range;
                suppressSelectionCopyOverlayRef.current = true;
                editor.setSelection(activeRange);
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
                return;
            }
            const nextIndex = wrapSearchIndex(currentSearchIndexRef.current + delta, matches.length);
            currentSearchIndexRef.current = nextIndex;
            setSearchIndex(nextIndex);
            searchDecorationIdsRef.current = editor.deltaDecorations(
                searchDecorationIdsRef.current,
                makeSearchDecorations(matches, nextIndex)
            );
            const activeRange = matches[nextIndex].range;
            suppressSelectionCopyOverlayRef.current = true;
            editor.setSelection(activeRange);
            editor.revealRangeInCenter(activeRange);
            requestAnimationFrame(() => {
                suppressSelectionCopyOverlayRef.current = false;
                setSelectionCopyOverlay(null);
            });
        },
        [model, setSearchIndex]
    );

    const replaceCurrentMatch = useCallback(() => {
        if (fileInfo?.readonly) {
            return;
        }
        const editor = model.monacoRef.current;
        const matches = searchMatchesRef.current;
        const match = matches[currentSearchIndexRef.current];
        if (!editor || !match) {
            return;
        }
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
            return;
        }
        const editor = model.monacoRef.current;
        const matches = [...searchMatchesRef.current];
        if (!editor || matches.length === 0) {
            return;
        }
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
        model.refreshCallback = () => {
            globalStore.set(model.refreshVersion, (v) => v + 1);
        };
        return () => {
            model.codeEditKeyDownHandler = null;
            model.monacoRef.current = null;
            model.refreshCallback = null;
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
    }, [fileInfo?.path]);

    function onMount(editor: MonacoTypes.editor.IStandaloneCodeEditor, _monacoApi: typeof monaco): () => void {
        model.monacoRef.current = editor;

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
        const selectionDisposer = editor.onDidChangeCursorSelection(updateSelectionCopyOverlay);
        const scrollDisposer = editor.onDidScrollChange(() => setSelectionCopyOverlay(null));
        const blurDisposer = editor.onDidBlurEditorText(() => setSelectionCopyOverlay(null));
        const mouseDownDisposer = editor.onMouseDown(() => setSelectionCopyOverlay(null));

        const isFocused = globalStore.get(model.nodeModel.isFocused);
        if (isFocused) {
            editor.focus();
        }
        revealSearchTargetLine(editor, globalStore.get(model.searchTargetLine));

        return () => {
            searchDecorationIdsRef.current = editor.deltaDecorations(searchDecorationIdsRef.current, []);
            keyDownDisposer.dispose();
            copyContextDisposer.dispose();
            selectionDisposer.dispose();
            scrollDisposer.dispose();
            blurDisposer.dispose();
            mouseDownDisposer.dispose();
        };
    }

    const hideSelectionCopyOverlay = useCallback(() => {
        setSelectionCopyOverlay(null);
    }, []);

    return (
        <div className="relative flex h-full w-full" ref={editorContainerRef}>
            <CodeEditor
                blockId={model.blockId}
                text={fileContent}
                fileName={fileName}
                language={language}
                readonly={fileInfo.readonly}
                onChange={(text) => setNewFileContent(text)}
                onMount={onMount}
            />
            <Search {...searchProps} />
            <SelectionCopyOverlay overlay={selectionCopyOverlay} onHide={hideSelectionCopyOverlay} />
        </div>
    );
}

export { CodeEditPreview };
