// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

type OrderedListMarker = {
    lineIndex: number;
    indent: number;
    number: number;
    delimiter: string;
    markerText: string;
};

type OrderedListItem = {
    startLineIndex: number;
    endLineIndex: number;
    marker: OrderedListMarker;
};

type OrderedListBlock = {
    startLineIndex: number;
    endLineIndex: number;
    items: OrderedListItem[];
};

export type OrderedListMoveState = {
    itemStartLineNumber: number;
    itemEndLineNumber: number;
    canMoveUp: boolean;
    canMoveDown: boolean;
};

export type OrderedListLineRange = {
    startLineNumber: number;
    endLineNumber: number;
};

export type OrderedListEditResult = {
    text: string;
    targetLineNumber?: number;
    movedRange?: OrderedListLineRange;
    swappedRange?: OrderedListLineRange;
};

export type OrderedListSwapPreview = {
    movedRange: OrderedListLineRange;
    swappedRange: OrderedListLineRange;
};

type TextLines = {
    lines: string[];
    eol: string;
};

const OrderedListMarkerPattern = /^(\s*)(\d+)([.)])(\s+|$)/;
const MarkdownPathPattern = /\.(?:md|markdown|mdx)$/i;

export function isMarkdownOrderedListPath(filePath: string | null | undefined): boolean {
    return MarkdownPathPattern.test(filePath ?? "");
}

export function getOrderedListMoveState(text: string, lineNumber: number): OrderedListMoveState | null {
    const { lines } = splitTextLines(text);
    const item = findOrderedListItemAtLine(lines, lineNumberToIndex(lineNumber));
    if (item == null) return null;
    const block = findOrderedListBlock(lines, item);
    const itemIndex = block.items.findIndex((candidate) => candidate.startLineIndex === item.startLineIndex);
    return {
        itemStartLineNumber: item.startLineIndex + 1,
        itemEndLineNumber: item.endLineIndex + 1,
        canMoveUp: itemIndex > 0,
        canMoveDown: itemIndex >= 0 && itemIndex < block.items.length - 1,
    };
}

export function moveOrderedListItem(
    text: string,
    lineNumber: number,
    direction: "up" | "down"
): OrderedListEditResult | null {
    const textLines = splitTextLines(text);
    const item = findOrderedListItemAtLine(textLines.lines, lineNumberToIndex(lineNumber));
    if (item == null) return null;
    const block = findOrderedListBlock(textLines.lines, item);
    const itemIndex = block.items.findIndex((candidate) => candidate.startLineIndex === item.startLineIndex);
    const swapIndex = direction === "up" ? itemIndex - 1 : itemIndex + 1;
    const swapItem = block.items[swapIndex];
    if (itemIndex < 0 || swapItem == null) return null;

    const lines = [...textLines.lines];
    const itemLines = lines.slice(item.startLineIndex, item.endLineIndex + 1);
    const swapLines = lines.slice(swapItem.startLineIndex, swapItem.endLineIndex + 1);
    const cursorLineOffset = Math.max(0, lineNumberToIndex(lineNumber) - item.startLineIndex);
    let targetLineIndex: number;
    let movedStartLineIndex: number;
    let swappedStartLineIndex: number;

    if (direction === "up") {
        if (swapItem.endLineIndex >= item.startLineIndex) return null;
        const betweenLines = lines.slice(swapItem.endLineIndex + 1, item.startLineIndex);
        lines.splice(
            swapItem.startLineIndex,
            swapLines.length + betweenLines.length + itemLines.length,
            ...itemLines,
            ...betweenLines,
            ...swapLines
        );
        movedStartLineIndex = swapItem.startLineIndex;
        swappedStartLineIndex = movedStartLineIndex + itemLines.length + betweenLines.length;
        targetLineIndex = movedStartLineIndex + Math.min(cursorLineOffset, itemLines.length - 1);
    } else {
        if (item.endLineIndex >= swapItem.startLineIndex) return null;
        const betweenLines = lines.slice(item.endLineIndex + 1, swapItem.startLineIndex);
        lines.splice(
            item.startLineIndex,
            itemLines.length + betweenLines.length + swapLines.length,
            ...swapLines,
            ...betweenLines,
            ...itemLines
        );
        swappedStartLineIndex = item.startLineIndex;
        movedStartLineIndex = swappedStartLineIndex + swapLines.length + betweenLines.length;
        targetLineIndex = movedStartLineIndex + Math.min(cursorLineOffset, itemLines.length - 1);
    }

    renumberOrderedListsInLines(lines, block.startLineIndex, block.endLineIndex);
    return {
        text: joinTextLines(lines, textLines.eol),
        targetLineNumber: targetLineIndex + 1,
        movedRange: {
            startLineNumber: movedStartLineIndex + 1,
            endLineNumber: movedStartLineIndex + itemLines.length,
        },
        swappedRange: {
            startLineNumber: swappedStartLineIndex + 1,
            endLineNumber: swappedStartLineIndex + swapLines.length,
        },
    };
}

export function getOrderedListSwapPreview(
    text: string,
    lineNumber: number,
    direction: "up" | "down"
): OrderedListSwapPreview | null {
    const { lines } = splitTextLines(text);
    const item = findOrderedListItemAtLine(lines, lineNumberToIndex(lineNumber));
    if (item == null) return null;
    const block = findOrderedListBlock(lines, item);
    const itemIndex = block.items.findIndex((candidate) => candidate.startLineIndex === item.startLineIndex);
    const swapIndex = direction === "up" ? itemIndex - 1 : itemIndex + 1;
    const swapItem = block.items[swapIndex];
    if (itemIndex < 0 || swapItem == null) return null;
    return {
        movedRange: makeLineRange(item),
        swappedRange: makeLineRange(swapItem),
    };
}

export function renumberOrderedListsInSelection(
    text: string,
    startLineNumber: number,
    endLineNumber: number
): OrderedListEditResult | null {
    const textLines = splitTextLines(text);
    const startLineIndex = lineNumberToIndex(Math.min(startLineNumber, endLineNumber));
    const endLineIndex = lineNumberToIndex(Math.max(startLineNumber, endLineNumber));
    const lines = [...textLines.lines];
    const changed = renumberOrderedListsInLines(lines, startLineIndex, endLineIndex);
    if (!changed) return null;
    return { text: joinTextLines(lines, textLines.eol) };
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

function parseOrderedListMarker(line: string, lineIndex: number): OrderedListMarker | null {
    const match = line.match(OrderedListMarkerPattern);
    if (!match) return null;
    return {
        lineIndex,
        indent: match[1].length,
        number: parseInt(match[2], 10),
        delimiter: match[3],
        markerText: match[0],
    };
}

function makeLineRange(item: OrderedListItem): OrderedListLineRange {
    return {
        startLineNumber: item.startLineIndex + 1,
        endLineNumber: item.endLineIndex + 1,
    };
}

function isHardBoundaryLine(line: string, indent: number): boolean {
    const leadingWhitespace = line.match(/^\s*/)?.[0].length ?? 0;
    if (leadingWhitespace > indent) return false;
    return /^#{1,6}\s+/.test(line.trimStart());
}

function findOrderedListItemAtLine(lines: string[], lineIndex: number): OrderedListItem | null {
    const boundedLineIndex = Math.max(0, Math.min(lines.length - 1, lineIndex));
    for (let idx = boundedLineIndex; idx >= 0; idx--) {
        const marker = parseOrderedListMarker(lines[idx], idx);
        if (marker == null) continue;
        const item = makeOrderedListItem(lines, marker);
        if (boundedLineIndex >= item.startLineIndex && boundedLineIndex <= item.endLineIndex) {
            return item;
        }
    }
    return null;
}

function makeOrderedListItem(lines: string[], marker: OrderedListMarker): OrderedListItem {
    let endLineIndex = lines.length - 1;
    for (let idx = marker.lineIndex + 1; idx < lines.length; idx++) {
        if (isHardBoundaryLine(lines[idx], marker.indent)) {
            endLineIndex = idx - 1;
            break;
        }
        const nextMarker = parseOrderedListMarker(lines[idx], idx);
        if (nextMarker != null && nextMarker.indent <= marker.indent) {
            endLineIndex = idx - 1;
            break;
        }
    }
    return {
        startLineIndex: marker.lineIndex,
        endLineIndex,
        marker,
    };
}

function findOrderedListBlock(lines: string[], item: OrderedListItem): OrderedListBlock {
    const startBoundary = findBlockStartBoundary(lines, item);
    const endBoundary = findBlockEndBoundary(lines, item);
    const items: OrderedListItem[] = [];
    for (let idx = startBoundary; idx <= endBoundary; idx++) {
        const marker = parseOrderedListMarker(lines[idx], idx);
        if (marker == null || marker.indent !== item.marker.indent) continue;
        const sibling = makeOrderedListItem(lines, marker);
        items.push(sibling);
        idx = sibling.endLineIndex;
    }
    return {
        startLineIndex: startBoundary,
        endLineIndex: endBoundary,
        items,
    };
}

function findBlockStartBoundary(lines: string[], item: OrderedListItem): number {
    for (let idx = item.startLineIndex - 1; idx >= 0; idx--) {
        if (isHardBoundaryLine(lines[idx], item.marker.indent)) {
            return idx + 1;
        }
        const marker = parseOrderedListMarker(lines[idx], idx);
        if (marker != null && marker.indent < item.marker.indent) {
            return idx + 1;
        }
    }
    return 0;
}

function findBlockEndBoundary(lines: string[], item: OrderedListItem): number {
    for (let idx = item.endLineIndex + 1; idx < lines.length; idx++) {
        if (isHardBoundaryLine(lines[idx], item.marker.indent)) {
            return idx - 1;
        }
        const marker = parseOrderedListMarker(lines[idx], idx);
        if (marker != null && marker.indent < item.marker.indent) {
            return idx - 1;
        }
    }
    return lines.length - 1;
}

function renumberOrderedListsInLines(lines: string[], startLineIndex: number, endLineIndex: number): boolean {
    const counters = new Map<number, number>();
    let changed = false;
    const boundedStart = Math.max(0, Math.min(lines.length - 1, startLineIndex));
    const boundedEnd = Math.max(0, Math.min(lines.length - 1, endLineIndex));
    for (let idx = boundedStart; idx <= boundedEnd; idx++) {
        const marker = parseOrderedListMarker(lines[idx], idx);
        if (marker == null) {
            if (isHardBoundaryLine(lines[idx], 0)) {
                counters.clear();
            }
            continue;
        }
        for (const indent of Array.from(counters.keys())) {
            if (indent > marker.indent) {
                counters.delete(indent);
            }
        }
        const nextNumber = (counters.get(marker.indent) ?? 0) + 1;
        counters.set(marker.indent, nextNumber);
        if (marker.number === nextNumber) {
            continue;
        }
        lines[idx] = replaceOrderedListMarkerNumber(lines[idx], marker, nextNumber);
        changed = true;
    }
    return changed;
}

function replaceOrderedListMarkerNumber(line: string, marker: OrderedListMarker, nextNumber: number): string {
    return line.replace(OrderedListMarkerPattern, `${" ".repeat(marker.indent)}${nextNumber}${marker.delimiter}$4`);
}
