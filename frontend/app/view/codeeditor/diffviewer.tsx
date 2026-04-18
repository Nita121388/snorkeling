// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { MonacoDiffViewer } from "@/app/monaco/monaco-react";
import { useOverrideConfigAtom } from "@/app/store/global";
import { boundNumber } from "@/util/util";
import type * as MonacoTypes from "monaco-editor";
import { useMemo, useRef } from "react";

interface DiffViewerProps {
    blockId: string;
    original: string;
    modified: string;
    language?: string;
    fileName: string;
    mode?: "side-by-side" | "inline";
    copyContextFilePath?: string;
}

function defaultDiffEditorOptions(): MonacoTypes.editor.IDiffEditorOptions {
    const opts: MonacoTypes.editor.IDiffEditorOptions = {
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
        readOnly: true,
        renderSideBySide: true,
        originalEditable: false,
    };
    return opts;
}

function buildCopyContextText(absoluteFilePath: string, lineNumber: number, snippet: string, language?: string): string {
    const filePath = absoluteFilePath || "(unknown-path)";
    const codeFence = language ? `\`\`\`${language}` : "```";
    return `${filePath}:${lineNumber}\n${codeFence}\n${snippet}\n\`\`\``;
}

function makeCopyContextAction(
    targetEditor: MonacoTypes.editor.IStandaloneCodeEditor,
    actionId: string,
    copyContextFilePath: string,
    language?: string
): MonacoTypes.IDisposable {
    return targetEditor.addAction({
        id: actionId,
        label: "🪧 Copy Context",
        contextMenuGroupId: "navigation",
        contextMenuOrder: 0.5,
        run: async () => {
            const editorModel = targetEditor.getModel();
            if (!editorModel) {
                return;
            }
            const selection = targetEditor.getSelection();
            const cursorPosition = targetEditor.getPosition();
            const lineNumber = selection?.startLineNumber ?? cursorPosition?.lineNumber ?? 1;
            let snippet = selection ? editorModel.getValueInRange(selection) : "";
            if (!snippet) {
                snippet = editorModel.getLineContent(lineNumber);
            }
            const contextText = buildCopyContextText(copyContextFilePath, lineNumber, snippet, language);
            await navigator.clipboard.writeText(contextText);
        },
    });
}

export function DiffViewer({
    blockId,
    original,
    modified,
    language,
    fileName,
    mode,
    copyContextFilePath,
}: DiffViewerProps) {
    const minimapEnabled = useOverrideConfigAtom(blockId, "editor:minimapenabled") ?? false;
    const fontSize = boundNumber(useOverrideConfigAtom(blockId, "editor:fontsize"), 6, 64);
    const inlineDiff = useOverrideConfigAtom(blockId, "editor:inlinediff");
    const uuidRef = useRef(crypto.randomUUID()).current;
    let editorPath: string;
    if (fileName) {
        const separator = fileName.startsWith("/") ? "" : "/";
        editorPath = blockId + separator + fileName;
    } else {
        editorPath = uuidRef;
    }
    const contextFilePath = copyContextFilePath || fileName || "(unknown-path)";

    const editorOpts = useMemo(() => {
        const opts = defaultDiffEditorOptions();
        opts.minimap.enabled = minimapEnabled;
        opts.fontSize = fontSize;
        if (mode != null) {
            opts.renderSideBySide = mode !== "inline";
        } else if (inlineDiff != null) {
            opts.renderSideBySide = !inlineDiff;
        }
        return opts;
    }, [minimapEnabled, fontSize, inlineDiff, mode]);

    return (
        <div className="flex flex-col w-full h-full overflow-hidden items-center justify-center">
            <div className="flex flex-col h-full w-full">
                <MonacoDiffViewer
                    path={editorPath}
                    original={original}
                    modified={modified}
                    options={editorOpts}
                    language={language}
                    onMount={(diffEditor) => {
                        const originalEditor = diffEditor.getOriginalEditor();
                        const modifiedEditor = diffEditor.getModifiedEditor();
                        const originalDisposer = makeCopyContextAction(
                            originalEditor,
                            `snorkeling.copy-context.diff.original.${uuidRef}`,
                            contextFilePath,
                            language
                        );
                        const modifiedDisposer = makeCopyContextAction(
                            modifiedEditor,
                            `snorkeling.copy-context.diff.modified.${uuidRef}`,
                            contextFilePath,
                            language
                        );
                        return () => {
                            originalDisposer.dispose();
                            modifiedDisposer.dispose();
                        };
                    }}
                />
            </div>
        </div>
    );
}
