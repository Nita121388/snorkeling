// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// W2-1 follow-up（性能）：文件名 → Monaco 语言的纯映射。
//
// 为什么要单独一个模块：`aifilediff` / `vcsdiff` 只需要这个纯函数把语言传给代码块，
// 但历史上它们从 `preview-edit.tsx` import —— 而 preview-edit 静态 import 了
// monaco-editor。结果：每个终端 Tab 的入口 chunk 被迫静态加载 7.78MB 的 monaco
// chunk（只为拿一个 30 行的 switch）。纯映射搬到本文件后 monaco 只在编辑器真正
// 打开时加载。
//
// 约束：本文件不得 import 任何重型依赖（monaco / react / jotai），只放纯数据与纯函数。

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

export const extensionLanguageMap: Record<string, string> = {
    ".astro": "html",
    ".cts": "typescript",
    ".j2": "html",
    ".jinja": "html",
    ".jinja2": "html",
    ".jsonc": "json",
    ".svelte": "html",
    ".vue": "html",
};

export function getFileLanguage(fileName: string | null): string | undefined {
    const baseName = fileName ? fileName.split("/").pop() : null;
    if (!baseName) {
        return undefined;
    }
    if (shellFileMap[baseName]) {
        return shellFileMap[baseName];
    }
    const extensionMatch = baseName.toLowerCase().match(/(\.[^.]+)$/);
    if (!extensionMatch) {
        return "plaintext";
    }
    if ([".md", ".markdown", ".mdx"].includes(extensionMatch[1])) {
        return "markdown";
    }
    return extensionLanguageMap[extensionMatch[1]];
}
