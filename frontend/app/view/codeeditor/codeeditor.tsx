// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { MarkdownOutline, type MarkdownOutlineItem } from "@/app/element/markdown-outline";
import { getMarkdownHeadings } from "@/app/monaco/markdown-folding";
import { MonacoCodeEditor } from "@/app/monaco/monaco-react";
import { useOverrideConfigAtom } from "@/app/store/global";
import { boundNumber } from "@/util/util";
import type * as MonacoTypes from "monaco-editor";
import * as MonacoModule from "monaco-editor";
import React, { useMemo, useRef, useState } from "react";

function defaultEditorOptions(): MonacoTypes.editor.IEditorOptions {
    const opts: MonacoTypes.editor.IEditorOptions = {
        scrollBeyondLastLine: false,
        fontSize: 12,
        fontFamily: "Hack",
        smoothScrolling: true,
        scrollbar: {
            useShadows: false,
            verticalScrollbarSize: 5,
            horizontalScrollbarSize: 5,
        },
        minimap: {
            enabled: true,
        },
        stickyScroll: {
            enabled: false,
        },
    };
    return opts;
}

function isMarkdownLanguage(language?: string): boolean {
    return language === "markdown";
}

interface CodeEditorProps {
    blockId: string;
    text: string;
    readonly: boolean;
    language?: string;
    fileName?: string;
    onChange?: (text: string) => void;
    onMount?: (monacoPtr: MonacoTypes.editor.IStandaloneCodeEditor, monaco: typeof MonacoModule) => () => void;
}

export function CodeEditor({ blockId, text, language, fileName, readonly, onChange, onMount }: CodeEditorProps) {
    const divRef = useRef<HTMLDivElement>(null);
    const unmountRef = useRef<() => void>(null);
    const editorRef = useRef<MonacoTypes.editor.IStandaloneCodeEditor | null>(null);
    const [outlineCollapsed, setOutlineCollapsed] = useState(false);
    const [outlinePinned, setOutlinePinned] = useState(false);
    const [outlineHovered, setOutlineHovered] = useState(false);
    const minimapEnabled = useOverrideConfigAtom(blockId, "editor:minimapenabled") ?? false;
    const stickyScrollEnabled = useOverrideConfigAtom(blockId, "editor:stickyscrollenabled") ?? false;
    const wordWrap = useOverrideConfigAtom(blockId, "editor:wordwrap") ?? false;
    const fontSize = boundNumber(useOverrideConfigAtom(blockId, "editor:fontsize"), 6, 64);
    const uuidRef = useRef(crypto.randomUUID()).current;
    let editorPath: string;
    if (fileName) {
        const separator = fileName.startsWith("/") ? "" : "/";
        editorPath = blockId + separator + fileName;
    } else {
        editorPath = uuidRef;
    }

    React.useEffect(() => {
        return () => {
            // unmount function
            if (unmountRef.current) {
                unmountRef.current();
            }
        };
    }, []);

    function handleEditorChange(text: string) {
        if (onChange) {
            onChange(text);
        }
    }

    function handleEditorOnMount(
        editor: MonacoTypes.editor.IStandaloneCodeEditor,
        monaco: typeof MonacoModule
    ): () => void {
        editorRef.current = editor;
        if (onMount) {
            const cleanup = onMount(editor, monaco);
            const wrappedCleanup = () => {
                editorRef.current = null;
                cleanup?.();
            };
            unmountRef.current = wrappedCleanup;
            return wrappedCleanup;
        }
        const cleanup = () => {
            editorRef.current = null;
        };
        unmountRef.current = cleanup;
        return cleanup;
    }

    const editorOpts = useMemo(() => {
        const opts = defaultEditorOptions();
        opts.minimap.enabled = minimapEnabled;
        opts.stickyScroll.enabled = stickyScrollEnabled;
        opts.wordWrap = wordWrap ? "on" : "off";
        opts.fontSize = fontSize;
        opts.copyWithSyntaxHighlighting = false;
        opts.folding = true;
        opts.foldingStrategy = "auto";
        opts.showFoldingControls = language === "markdown" ? "always" : "mouseover";
        return opts;
    }, [minimapEnabled, stickyScrollEnabled, wordWrap, fontSize, readonly, language]);
    const markdownHeadings = useMemo(
        () => (isMarkdownLanguage(language) ? getMarkdownHeadings(text) : []),
        [language, text]
    );
    const markdownOutlineItems = useMemo<MarkdownOutlineItem[]>(
        () =>
            markdownHeadings.map((heading, index) => ({
                id: `${heading.lineNumber}-${index}`,
                label: heading.text,
                level: heading.level,
                lineNumber: heading.lineNumber,
            })),
        [markdownHeadings]
    );
    const showMarkdownOutline = isMarkdownLanguage(language);

    function handleSelectHeading(heading: MarkdownOutlineItem) {
        const editor = editorRef.current;
        const editorModel = editor?.getModel();
        if (!editor || !editorModel || heading.lineNumber == null) {
            return;
        }
        const lineNumber = Math.min(Math.max(heading.lineNumber, 1), editorModel.getLineCount());
        editor.revealLineInCenter(lineNumber);
        editor.setPosition({ lineNumber, column: 1 });
        editor.focus();
    }

    return (
        <div className="flex flex-col w-full h-full items-center justify-center">
            <div className="relative flex h-full w-full min-w-0" ref={divRef}>
                <div className="min-w-0 flex-1">
                    <MonacoCodeEditor
                        readonly={readonly}
                        text={text}
                        options={editorOpts}
                        onChange={handleEditorChange}
                        onMount={handleEditorOnMount}
                        path={editorPath}
                        language={language}
                    />
                </div>
                {showMarkdownOutline ? (
                    <MarkdownOutline
                        items={markdownOutlineItems}
                        collapsed={outlineCollapsed}
                        pinned={outlinePinned}
                        hovered={outlineHovered}
                        resizeAxes={{ width: true, height: true }}
                        resizeStorageKey="snorkeling.markdownOutline.editor.size"
                        onHoverChange={setOutlineHovered}
                        onToggleCollapsed={() => setOutlineCollapsed((value) => !value)}
                        onTogglePinned={() => setOutlinePinned((value) => !value)}
                        onSelectItem={handleSelectHeading}
                    />
                ) : null}
            </div>
        </div>
    );
}
