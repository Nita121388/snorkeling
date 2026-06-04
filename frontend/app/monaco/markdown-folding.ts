// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type * as MonacoTypes from "monaco-editor";

type MarkdownHeading = {
    lineNumber: number;
    level: number;
};

type MarkdownFence = {
    marker: "`" | "~";
    length: number;
};

export type MarkdownFoldingRange = {
    start: number;
    end: number;
};

let markdownFoldingRegistered = false;

function getFenceStart(line: string): MarkdownFence | null {
    const match = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (!match) {
        return null;
    }
    const fence = match[1];
    return {
        marker: fence[0] as "`" | "~",
        length: fence.length,
    };
}

function isFenceEnd(line: string, fence: MarkdownFence): boolean {
    const escapedMarker = fence.marker === "`" ? "`" : "~";
    const pattern = new RegExp(`^ {0,3}${escapedMarker}{${fence.length},}[ \\t]*$`);
    return pattern.test(line);
}

function getHeadingLevel(line: string): number | null {
    const match = line.match(/^ {0,3}(#{1,6})(?:[ \t]|$)/);
    return match ? match[1].length : null;
}

export function getMarkdownHeadingFoldingRanges(text: string): MarkdownFoldingRange[] {
    const lines = text.split(/\r\n|\r|\n/);
    const headings: MarkdownHeading[] = [];
    let fence: MarkdownFence | null = null;

    lines.forEach((line, index) => {
        if (fence) {
            if (isFenceEnd(line, fence)) {
                fence = null;
            }
            return;
        }

        const fenceStart = getFenceStart(line);
        if (fenceStart) {
            fence = fenceStart;
            return;
        }

        const level = getHeadingLevel(line);
        if (level != null) {
            headings.push({ lineNumber: index + 1, level });
        }
    });

    return headings.flatMap((heading, index) => {
        const nextHeading = headings.slice(index + 1).find((candidate) => candidate.level <= heading.level);
        const end = (nextHeading?.lineNumber ?? lines.length + 1) - 1;
        if (end <= heading.lineNumber) {
            return [];
        }
        return [{ start: heading.lineNumber, end }];
    });
}

export function registerMarkdownFolding(monacoApi: typeof MonacoTypes): void {
    if (markdownFoldingRegistered) {
        return;
    }
    markdownFoldingRegistered = true;

    monacoApi.languages.registerFoldingRangeProvider("markdown", {
        provideFoldingRanges(model: MonacoTypes.editor.ITextModel): MonacoTypes.languages.FoldingRange[] {
            return getMarkdownHeadingFoldingRanges(model.getValue()).map((range) => ({
                ...range,
                kind: monacoApi.languages.FoldingRangeKind.Region,
            }));
        },
    });
}
