// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export type MarkdownHeadingLineRange = {
    startLineNumber: number;
    endLineNumber: number;
};

export type MarkdownHeadingMoveState = {
    sectionStartLineNumber: number;
    sectionEndLineNumber: number;
    canMoveUp: boolean;
    canMoveDown: boolean;
};

export type MarkdownHeadingEditResult = {
    text: string;
    targetLineNumber?: number;
    movedRange?: MarkdownHeadingLineRange;
    swappedRange?: MarkdownHeadingLineRange;
};

export type MarkdownHeadingSwapPreview = {
    movedRange: MarkdownHeadingLineRange;
    swappedRange: MarkdownHeadingLineRange;
};

type MarkdownFence = {
    marker: "`" | "~";
    length: number;
};

type MarkdownHeading = {
    lineIndex: number;
    level: number;
};

type MarkdownHeadingSection = {
    startLineIndex: number;
    endLineIndex: number;
    heading: MarkdownHeading;
};

type TextLines = {
    lines: string[];
    eol: string;
};

const MarkdownPathPattern = /\.(?:md|markdown|mdx)$/i;

export function isMarkdownHeadingSectionPath(filePath: string | null | undefined): boolean {
    return MarkdownPathPattern.test(filePath ?? "");
}

export function getMarkdownHeadingMoveState(text: string, lineNumber: number): MarkdownHeadingMoveState | null {
    const { lines } = splitTextLines(text);
    const section = findHeadingSectionAtLine(lines, lineNumberToIndex(lineNumber));
    if (section == null) return null;
    return {
        sectionStartLineNumber: section.startLineIndex + 1,
        sectionEndLineNumber: section.endLineIndex + 1,
        canMoveUp: findSiblingHeadingSection(lines, section, "up") != null,
        canMoveDown: findSiblingHeadingSection(lines, section, "down") != null,
    };
}

export function moveMarkdownHeadingSection(
    text: string,
    lineNumber: number,
    direction: "up" | "down"
): MarkdownHeadingEditResult | null {
    const textLines = splitTextLines(text);
    const section = findHeadingSectionAtLine(textLines.lines, lineNumberToIndex(lineNumber));
    if (section == null) return null;
    const swapSection = findSiblingHeadingSection(textLines.lines, section, direction);
    if (swapSection == null) return null;

    const lines = [...textLines.lines];
    const sectionLines = lines.slice(section.startLineIndex, section.endLineIndex + 1);
    const swapLines = lines.slice(swapSection.startLineIndex, swapSection.endLineIndex + 1);
    const cursorLineOffset = Math.max(0, lineNumberToIndex(lineNumber) - section.startLineIndex);
    let targetLineIndex: number;
    let movedStartLineIndex: number;
    let swappedStartLineIndex: number;

    if (direction === "up") {
        if (swapSection.endLineIndex >= section.startLineIndex) return null;
        const betweenLines = lines.slice(swapSection.endLineIndex + 1, section.startLineIndex);
        const crossesParentBoundary = hasHigherLevelHeading(betweenLines, section.heading.level);
        if (crossesParentBoundary) {
            lines.splice(
                swapSection.startLineIndex,
                swapLines.length + betweenLines.length + sectionLines.length,
                ...swapLines,
                ...sectionLines,
                ...betweenLines
            );
            swappedStartLineIndex = swapSection.startLineIndex;
            movedStartLineIndex = swappedStartLineIndex + swapLines.length;
        } else {
            lines.splice(
                swapSection.startLineIndex,
                swapLines.length + betweenLines.length + sectionLines.length,
                ...sectionLines,
                ...betweenLines,
                ...swapLines
            );
            movedStartLineIndex = swapSection.startLineIndex;
            swappedStartLineIndex = movedStartLineIndex + sectionLines.length + betweenLines.length;
        }
        targetLineIndex = movedStartLineIndex + Math.min(cursorLineOffset, sectionLines.length - 1);
    } else {
        if (section.endLineIndex >= swapSection.startLineIndex) return null;
        const betweenLines = lines.slice(section.endLineIndex + 1, swapSection.startLineIndex);
        const crossesParentBoundary = hasHigherLevelHeading(betweenLines, section.heading.level);
        if (crossesParentBoundary) {
            lines.splice(
                section.startLineIndex,
                sectionLines.length + betweenLines.length + swapLines.length,
                ...betweenLines,
                ...sectionLines,
                ...swapLines
            );
            movedStartLineIndex = section.startLineIndex + betweenLines.length;
            swappedStartLineIndex = movedStartLineIndex + sectionLines.length;
        } else {
            lines.splice(
                section.startLineIndex,
                sectionLines.length + betweenLines.length + swapLines.length,
                ...swapLines,
                ...betweenLines,
                ...sectionLines
            );
            swappedStartLineIndex = section.startLineIndex;
            movedStartLineIndex = swappedStartLineIndex + swapLines.length + betweenLines.length;
        }
        targetLineIndex = movedStartLineIndex + Math.min(cursorLineOffset, sectionLines.length - 1);
    }

    return {
        text: joinTextLines(lines, textLines.eol),
        targetLineNumber: targetLineIndex + 1,
        movedRange: {
            startLineNumber: movedStartLineIndex + 1,
            endLineNumber: movedStartLineIndex + sectionLines.length,
        },
        swappedRange: {
            startLineNumber: swappedStartLineIndex + 1,
            endLineNumber: swappedStartLineIndex + swapLines.length,
        },
    };
}

export function getMarkdownHeadingSwapPreview(
    text: string,
    lineNumber: number,
    direction: "up" | "down"
): MarkdownHeadingSwapPreview | null {
    const { lines } = splitTextLines(text);
    const section = findHeadingSectionAtLine(lines, lineNumberToIndex(lineNumber));
    if (section == null) return null;
    const swapSection = findSiblingHeadingSection(lines, section, direction);
    if (swapSection == null) return null;
    return {
        movedRange: makeLineRange(section),
        swappedRange: makeLineRange(swapSection),
    };
}

function splitTextLines(text: string): TextLines {
    return {
        lines: text.split(/\r\n|\n/),
        eol: text.includes("\r\n") ? "\r\n" : "\n",
    };
}

function joinTextLines(lines: string[], eol: string): string {
    return lines.join(eol);
}

function lineNumberToIndex(lineNumber: number): number {
    return Math.max(0, Math.trunc(lineNumber) - 1);
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

function parseHeading(line: string, lineIndex: number): MarkdownHeading | null {
    const match = line.match(/^ {0,3}(#{1,6})(?:[ \t]|$)/);
    if (!match) {
        return null;
    }
    return {
        lineIndex,
        level: match[1].length,
    };
}

function collectHeadings(lines: string[]): MarkdownHeading[] {
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

        const heading = parseHeading(line, index);
        if (heading) {
            headings.push(heading);
        }
    });

    return headings;
}

function makeHeadingSection(
    lines: string[],
    headings: MarkdownHeading[],
    headingIndex: number
): MarkdownHeadingSection {
    const heading = headings[headingIndex];
    const nextBoundary = headings
        .slice(headingIndex + 1)
        .find((candidate) => candidate.level <= heading.level)?.lineIndex;
    return {
        startLineIndex: heading.lineIndex,
        endLineIndex: (nextBoundary ?? lines.length) - 1,
        heading,
    };
}

function findHeadingSectionAtLine(lines: string[], lineIndex: number): MarkdownHeadingSection | null {
    const headings = collectHeadings(lines);
    const boundedLineIndex = Math.max(0, Math.min(lines.length - 1, lineIndex));
    const headingIndex = headings.findIndex((heading) => heading.lineIndex === boundedLineIndex);
    if (headingIndex < 0) {
        return null;
    }
    return makeHeadingSection(lines, headings, headingIndex);
}

function findSiblingHeadingSection(
    lines: string[],
    section: MarkdownHeadingSection,
    direction: "up" | "down"
): MarkdownHeadingSection | null {
    const headings = collectHeadings(lines);
    const headingIndex = headings.findIndex((heading) => heading.lineIndex === section.heading.lineIndex);
    if (headingIndex < 0) {
        return null;
    }
    const step = direction === "up" ? -1 : 1;
    for (let idx = headingIndex + step; idx >= 0 && idx < headings.length; idx += step) {
        if (headings[idx].level === section.heading.level) {
            return makeHeadingSection(lines, headings, idx);
        }
    }
    return null;
}

function hasHigherLevelHeading(lines: string[], level: number): boolean {
    return collectHeadings(lines).some((heading) => heading.level < level);
}

function makeLineRange(section: MarkdownHeadingSection): MarkdownHeadingLineRange {
    return {
        startLineNumber: section.startLineIndex + 1,
        endLineNumber: section.endLineIndex + 1,
    };
}
