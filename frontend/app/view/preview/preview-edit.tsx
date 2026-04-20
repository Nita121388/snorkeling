// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { tryReinjectKey } from "@/app/store/keymodel";
import { CodeEditor } from "@/app/view/codeeditor/codeeditor";
import { adaptFromReactOrNativeKeyEvent, checkKeyPressed } from "@/util/keyutil";
import { fireAndForget } from "@/util/util";
import { useAtomValue, useSetAtom } from "jotai";
import type * as MonacoTypes from "monaco-editor";
import * as monaco from "monaco-editor";
import { useEffect } from "react";
import type { SpecializedViewProps } from "./preview";

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

function buildCopyContextText(absoluteFilePath: string, lineNumber: number, snippet: string, language?: string): string {
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

function CodeEditPreview({ model }: SpecializedViewProps) {
    const fileContent = useAtomValue(model.fileContent);
    const setNewFileContent = useSetAtom(model.newFileContent);
    const fileInfo = useAtomValue(model.statFile);
    const searchTargetLine = useAtomValue(model.searchTargetLine);
    const fileName = fileInfo?.path || fileInfo?.name;

    const baseName = fileName ? fileName.split("/").pop() : null;
    const language = baseName && shellFileMap[baseName] ? shellFileMap[baseName] : undefined;

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
        if (searchTargetLine == null) {
            return;
        }
        const editor = model.monacoRef.current;
        if (!editor) {
            return;
        }
        revealSearchTargetLine(editor, searchTargetLine);
    }, [fileInfo?.path, model, searchTargetLine]);

    function onMount(editor: MonacoTypes.editor.IStandaloneCodeEditor, _monacoApi: typeof monaco): () => void {
        model.monacoRef.current = editor;

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

        const isFocused = globalStore.get(model.nodeModel.isFocused);
        if (isFocused) {
            editor.focus();
        }
        revealSearchTargetLine(editor, globalStore.get(model.searchTargetLine));

        return () => {
            keyDownDisposer.dispose();
            copyContextDisposer.dispose();
        };
    }

    return (
        <CodeEditor
            blockId={model.blockId}
            text={fileContent}
            fileName={fileName}
            language={language}
            readonly={fileInfo.readonly}
            onChange={(text) => setNewFileContent(text)}
            onMount={onMount}
        />
    );
}

export { CodeEditPreview };
