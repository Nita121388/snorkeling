// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getMarkdownHeadings, type MarkdownHeading } from "@/app/monaco/markdown-folding";
import { MonacoCodeEditor } from "@/app/monaco/monaco-react";
import { useOverrideConfigAtom } from "@/app/store/global";
import { boundNumber, cn, makeIconClass } from "@/util/util";
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

function getHeadingLabel(heading: MarkdownHeading): string {
    return heading.text || "(untitled heading)";
}

function MarkdownOutline({
    headings,
    collapsed,
    pinned,
    hovered,
    onHoverChange,
    onToggleCollapsed,
    onTogglePinned,
    onSelectHeading,
}: {
    headings: MarkdownHeading[];
    collapsed: boolean;
    pinned: boolean;
    hovered: boolean;
    onHoverChange: (hovered: boolean) => void;
    onToggleCollapsed: () => void;
    onTogglePinned: () => void;
    onSelectHeading: (heading: MarkdownHeading) => void;
}) {
    const visible = pinned || hovered;
    const outlineOpacityClassName = visible ? "opacity-100" : "opacity-30";
    const collapsedOpacityClassName = visible ? "opacity-100" : "opacity-60";

    if (collapsed) {
        return (
            <div
                className={cn(
                    "absolute right-2 top-2 z-20 flex h-8 w-8 items-center justify-center rounded-md border border-border bg-panel/95 shadow-lg transition-opacity duration-150",
                    collapsedOpacityClassName
                )}
                onMouseEnter={() => onHoverChange(true)}
                onMouseLeave={() => onHoverChange(false)}
            >
                <button
                    type="button"
                    className="flex h-7 w-7 items-center justify-center rounded text-secondary hover:bg-hoverbg hover:text-foreground"
                    title="Show Markdown outline"
                    aria-label="Show Markdown outline"
                    onClick={onToggleCollapsed}
                >
                    <i className={makeIconClass("list-tree", false)} />
                </button>
            </div>
        );
    }

    return (
        <aside
            className={cn(
                "absolute right-2 top-2 z-20 flex max-h-[min(60vh,360px)] w-[236px] max-w-[min(236px,calc(100%-16px))] flex-col rounded-md border border-border bg-panel/95 text-xs shadow-xl backdrop-blur-sm transition-opacity duration-150",
                outlineOpacityClassName
            )}
            onMouseEnter={() => onHoverChange(true)}
            onMouseLeave={() => onHoverChange(false)}
        >
            <div className="flex h-8 shrink-0 items-center gap-1.5 border-b border-border px-2">
                <i className={cn(makeIconClass("list-tree", false), "text-secondary")} />
                <div className="min-w-0 flex-1 truncate font-medium text-foreground">Outline</div>
                <button
                    type="button"
                    className={cn(
                        "flex h-5 w-5 items-center justify-center rounded text-secondary hover:bg-hoverbg hover:text-foreground",
                        pinned && "text-accent"
                    )}
                    title={pinned ? "Unpin Markdown outline" : "Pin Markdown outline"}
                    aria-label={pinned ? "Unpin Markdown outline" : "Pin Markdown outline"}
                    aria-pressed={pinned}
                    onClick={onTogglePinned}
                >
                    <i className="fa-sharp fa-solid fa-thumbtack" />
                </button>
                <button
                    type="button"
                    className="flex h-5 w-5 items-center justify-center rounded text-secondary hover:bg-hoverbg hover:text-foreground"
                    title="Hide Markdown outline"
                    aria-label="Hide Markdown outline"
                    onClick={onToggleCollapsed}
                >
                    <i className={makeIconClass("chevron-right", false)} />
                </button>
            </div>
            <div className="min-h-0 overflow-auto py-1">
                {headings.length === 0 ? (
                    <div className="px-3 py-2 text-secondary">No headings found</div>
                ) : (
                    headings.map((heading, index) => (
                        <button
                            key={`${heading.lineNumber}-${index}`}
                            type="button"
                            className="flex w-full min-w-0 items-center gap-1.5 px-2 py-1 text-left text-secondary hover:bg-hoverbg hover:text-foreground"
                            style={{ paddingLeft: `${8 + Math.min(heading.level - 1, 5) * 10}px` }}
                            title={`${getHeadingLabel(heading)}: line ${heading.lineNumber}`}
                            onClick={() => onSelectHeading(heading)}
                        >
                            <span className="w-4 shrink-0 text-[9px] tabular-nums text-muted">{heading.level}</span>
                            <span className="min-w-0 flex-1 truncate">{getHeadingLabel(heading)}</span>
                        </button>
                    ))
                )}
            </div>
        </aside>
    );
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
    const showMarkdownOutline = isMarkdownLanguage(language);

    function handleSelectHeading(heading: MarkdownHeading) {
        const editor = editorRef.current;
        const editorModel = editor?.getModel();
        if (!editor || !editorModel) {
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
                        headings={markdownHeadings}
                        collapsed={outlineCollapsed}
                        pinned={outlinePinned}
                        hovered={outlineHovered}
                        onHoverChange={setOutlineHovered}
                        onToggleCollapsed={() => setOutlineCollapsed((value) => !value)}
                        onTogglePinned={() => setOutlinePinned((value) => !value)}
                        onSelectHeading={handleSelectHeading}
                    />
                ) : null}
            </div>
        </div>
    );
}
