// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getMarkdownOrderedListFoldingRanges } from "@/app/element/markdown-ordered-list";
import type * as MonacoTypes from "monaco-editor";

export type MarkdownHeading = {
    lineNumber: number;
    level: number;
    text: string;
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
const MarkdownFilePattern = /\.md$/i;

function normalizeMarkdownText(text: string | null | undefined): string {
    return text ?? "";
}

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

function parseHeading(line: string): Pick<MarkdownHeading, "level" | "text"> | null {
    const match = line.match(/^ {0,3}(#{1,6})(?:[ \t]+(.*?)|[ \t]*)$/);
    if (!match) {
        return null;
    }
    const text = (match[2] ?? "").replace(/[ \t]+#+[ \t]*$/, "").trim();
    return {
        level: match[1].length,
        text,
    };
}

export function getMarkdownHeadings(text: string | null | undefined): MarkdownHeading[] {
    const lines = normalizeMarkdownText(text).split(/\r\n|\r|\n/);
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

        const heading = parseHeading(line);
        if (heading != null) {
            headings.push({ lineNumber: index + 1, ...heading });
        }
    });

    return headings;
}

export function getMarkdownHeadingFoldingRanges(text: string | null | undefined): MarkdownFoldingRange[] {
    const markdownText = normalizeMarkdownText(text);
    const lines = markdownText.split(/\r\n|\r|\n/);
    const headings = getMarkdownHeadings(markdownText);

    return headings.flatMap((heading, index) => {
        const nextHeading = headings.slice(index + 1).find((candidate) => candidate.level <= heading.level);
        const end = (nextHeading?.lineNumber ?? lines.length + 1) - 1;
        if (end <= heading.lineNumber) {
            return [];
        }
        return [{ start: heading.lineNumber, end }];
    });
}

export function getMarkdownFoldingRanges(text: string | null | undefined, filePath?: string | null): MarkdownFoldingRange[] {
    const markdownText = normalizeMarkdownText(text);
    const headingRanges = getMarkdownHeadingFoldingRanges(markdownText);
    if (!MarkdownFilePattern.test(filePath ?? "")) {
        return headingRanges;
    }
    const orderedListRanges = getMarkdownOrderedListFoldingRanges(markdownText).map((range) => ({
        start: range.startLineNumber,
        end: range.endLineNumber,
    }));
    return [...headingRanges, ...orderedListRanges];
}

export function registerMarkdownFolding(monacoApi: typeof MonacoTypes): void {
    if (markdownFoldingRegistered) {
        return;
    }
    markdownFoldingRegistered = true;

    monacoApi.languages.registerFoldingRangeProvider("markdown", {
        provideFoldingRanges(model: MonacoTypes.editor.ITextModel): MonacoTypes.languages.FoldingRange[] {
            return getMarkdownFoldingRanges(model.getValue(), model.uri.path).map((range) => ({
                ...range,
                kind: monacoApi.languages.FoldingRangeKind.Region,
            }));
        },
    });
}
