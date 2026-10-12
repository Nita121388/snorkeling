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

type MarkdownFence = {
    marker: "`" | "~";
    length: number;
};

type MarkdownParseOptions = {
    ignoredLineIndexes?: Set<number>;
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
    targetColumn?: number;
    movedRange?: OrderedListLineRange;
    swappedRange?: OrderedListLineRange;
    cutText?: string;
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

function getParseOptions(lines: string[]): MarkdownParseOptions {
    return { ignoredLineIndexes: getMarkdownFenceLineIndexes(lines) };
}

export function getOrderedListMoveState(text: string, lineNumber: number): OrderedListMoveState | null {
    const { lines } = splitTextLines(text);
    const options = getParseOptions(lines);
    const item = findOrderedListItemAtLine(lines, lineNumberToIndex(lineNumber), options);
    if (item == null) return null;
    const block = findOrderedListBlock(lines, item, options);
    const itemIndex = block.items.findIndex((candidate) => candidate.startLineIndex === item.startLineIndex);
    return {
        itemStartLineNumber: item.startLineIndex + 1,
        itemEndLineNumber: item.endLineIndex + 1,
        canMoveUp: itemIndex > 0,
        canMoveDown: itemIndex >= 0 && itemIndex < block.items.length - 1,
    };
}

export function getMarkdownOrderedListFoldingRanges(text: string): OrderedListLineRange[] {
    const { lines } = splitTextLines(text);
    const ignoredLineIndexes = getMarkdownFenceLineIndexes(lines);
    const ranges: OrderedListLineRange[] = [];
    lines.forEach((line, lineIndex) => {
        const marker = parseOrderedListMarker(line, lineIndex, { ignoredLineIndexes });
        if (marker == null) {
            return;
        }
        const item = makeOrderedListItem(lines, marker, { ignoredLineIndexes });
        if (item.endLineIndex <= item.startLineIndex) {
            return;
        }
        ranges.push(makeLineRange(item));
    });
    return ranges;
}

export function moveOrderedListItem(
    text: string,
    lineNumber: number,
    direction: "up" | "down"
): OrderedListEditResult | null {
    const textLines = splitTextLines(text);
    const options = getParseOptions(textLines.lines);
    const item = findOrderedListItemAtLine(textLines.lines, lineNumberToIndex(lineNumber), options);
    if (item == null) return null;
    const block = findOrderedListBlock(textLines.lines, item, options);
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

    renumberOrderedListsInLines(lines, block.startLineIndex, block.endLineIndex, options);
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
    const options = getParseOptions(lines);
    const item = findOrderedListItemAtLine(lines, lineNumberToIndex(lineNumber), options);
    if (item == null) return null;
    const block = findOrderedListBlock(lines, item, options);
    const itemIndex = block.items.findIndex((candidate) => candidate.startLineIndex === item.startLineIndex);
    const swapIndex = direction === "up" ? itemIndex - 1 : itemIndex + 1;
    const swapItem = block.items[swapIndex];
    if (itemIndex < 0 || swapItem == null) return null;
    return {
        movedRange: makeLineRange(item),
        swappedRange: makeLineRange(swapItem),
    };
}

export function insertOrderedListItem(
    text: string,
    lineNumber: number,
    placement: "above" | "below"
): OrderedListEditResult | null {
    const textLines = splitTextLines(text);
    const options = getParseOptions(textLines.lines);
    const item = findOrderedListItemAtLine(textLines.lines, lineNumberToIndex(lineNumber), options);
    if (item == null) return null;
    const block = findOrderedListBlock(textLines.lines, item, options);
    const insertLineIndex = placement === "above" ? item.startLineIndex : item.endLineIndex + 1;
    const insertNumber = placement === "above" ? item.marker.number : item.marker.number + 1;
    const insertLine = `${" ".repeat(item.marker.indent)}${insertNumber}${item.marker.delimiter} `;
    const lines = [...textLines.lines];
    lines.splice(insertLineIndex, 0, insertLine);
    renumberOrderedListsInLines(lines, block.startLineIndex, block.endLineIndex + 1, options);

    return {
        text: joinTextLines(lines, textLines.eol),
        targetLineNumber: insertLineIndex + 1,
        targetColumn: getListItemContentColumn(lines[insertLineIndex], insertLine.length + 1),
    };
}

/**
 * Renumber just the ordered-list BLOCK containing `lineNumber` (1-based). Fence-aware and
 * bounded by the same block-boundary rules used for move/cut, so stray line-start
 * "NN." paragraphs elsewhere in the document are never touched. Returns null when the
 * line is not inside an ordered list or nothing changed.
 */
export function renumberOrderedListBlockAtLine(text: string, lineNumber: number): OrderedListEditResult | null {
    const textLines = splitTextLines(text);
    const options = getParseOptions(textLines.lines);
    const item = findOrderedListItemAtLine(textLines.lines, lineNumberToIndex(lineNumber), options);
    if (item == null) return null;
    const block = findOrderedListBlock(textLines.lines, item, options);
    const lines = [...textLines.lines];
    // Passive path (after an inline edit): respect blank-line group starts.
    const changed = renumberOrderedListsInLines(lines, block.startLineIndex, block.endLineIndex, options, true);
    if (!changed) return null;
    return { text: joinTextLines(lines, textLines.eol) };
}

export function cutOrderedListItem(text: string, lineNumber: number): OrderedListEditResult | null {
    const textLines = splitTextLines(text);
    const options = getParseOptions(textLines.lines);
    const item = findOrderedListItemAtLine(textLines.lines, lineNumberToIndex(lineNumber), options);
    if (item == null) return null;
    const block = findOrderedListBlock(textLines.lines, item, options);
    const lines = [...textLines.lines];
    const deleteCount = item.endLineIndex - item.startLineIndex + 1;
    const cutText = lines.slice(item.startLineIndex, item.endLineIndex + 1).join(textLines.eol);
    lines.splice(item.startLineIndex, deleteCount);
    const renumberEndLineIndex = block.endLineIndex - deleteCount;
    if (lines.length > 0 && block.startLineIndex <= renumberEndLineIndex) {
        renumberOrderedListsInLines(lines, block.startLineIndex, renumberEndLineIndex, options);
    }
    const targetLineNumber = Math.max(1, Math.min(item.startLineIndex + 1, lines.length || 1));

    return {
        text: joinTextLines(lines, textLines.eol),
        targetLineNumber,
        targetColumn: 1,
        cutText,
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
    // Passive path: respect blank-line group starts (their first number is user-authored).
    const changed = renumberOrderedListsInLines(lines, startLineIndex, endLineIndex, getParseOptions(lines), true);
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

function parseOrderedListMarker(
    line: string,
    lineIndex: number,
    options?: MarkdownParseOptions
): OrderedListMarker | null {
    if (options?.ignoredLineIndexes?.has(lineIndex)) {
        return null;
    }
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

function isHardBoundaryLine(line: string, indent: number, lineIndex?: number, options?: MarkdownParseOptions): boolean {
    if (lineIndex != null && options?.ignoredLineIndexes?.has(lineIndex)) {
        return false;
    }
    const leadingWhitespace = line.match(/^\s*/)?.[0].length ?? 0;
    if (leadingWhitespace > indent) return false;
    return /^#{1,6}\s+/.test(line.trimStart());
}

function findOrderedListItemAtLine(
    lines: string[],
    lineIndex: number,
    options?: MarkdownParseOptions
): OrderedListItem | null {
    const boundedLineIndex = Math.max(0, Math.min(lines.length - 1, lineIndex));
    for (let idx = boundedLineIndex; idx >= 0; idx--) {
        const marker = parseOrderedListMarker(lines[idx], idx, options);
        if (marker == null) continue;
        const item = makeOrderedListItem(lines, marker, options);
        if (boundedLineIndex >= item.startLineIndex && boundedLineIndex <= item.endLineIndex) {
            return item;
        }
    }
    return null;
}

function makeOrderedListItem(
    lines: string[],
    marker: OrderedListMarker,
    options?: MarkdownParseOptions
): OrderedListItem {
    // Item extent rules (CommonMark-ish):
    //   - sibling/shallower marker → item ends before it
    //   - heading hard boundary → ends before it
    //   - fenced code content is opaque (ignored lines count as item content)
    //   - non-blank content without a preceding blank is lazy continuation → belongs to item
    //   - after a blank line, only deeper-indented content continues the item; any
    //     shallower/equal content ends the item BEFORE the blank run. This stops the old
    //     behavior where a trailing paragraph/code block got swallowed into the last item and
    //     insert-below landed at EOF.
    let endLineIndex = marker.lineIndex;
    let lastContentLineIndex = marker.lineIndex;
    let pendingBlank = false;
    for (let idx = marker.lineIndex + 1; idx < lines.length; idx++) {
        const line = lines[idx];
        if (options?.ignoredLineIndexes?.has(idx)) {
            // A fence after a blank line starts a separate top-level block — stop before it.
            // A fence directly attached (no blank) folds into the item like other content.
            if (pendingBlank) {
                break;
            }
            endLineIndex = idx;
            lastContentLineIndex = idx;
            pendingBlank = false;
            continue;
        }
        if (line.trim() === "") {
            pendingBlank = true;
            continue;
        }
        if (isHardBoundaryLine(line, marker.indent, idx, options)) {
            break;
        }
        const leadingWhitespace = line.match(/^\s*/)?.[0].length ?? 0;
        if (pendingBlank && leadingWhitespace <= marker.indent) {
            break;
        }
        const nextMarker = parseOrderedListMarker(line, idx, options);
        if (!pendingBlank && nextMarker != null && nextMarker.indent <= marker.indent) {
            break;
        }
        endLineIndex = idx;
        lastContentLineIndex = idx;
        pendingBlank = false;
    }
    return {
        startLineIndex: marker.lineIndex,
        endLineIndex: pendingBlank ? lastContentLineIndex : endLineIndex,
        marker,
    };
}

function findOrderedListBlock(
    lines: string[],
    item: OrderedListItem,
    options?: MarkdownParseOptions
): OrderedListBlock {
    const startBoundary = findBlockStartBoundary(lines, item, options);
    const endBoundary = findBlockEndBoundary(lines, item, options);
    const items: OrderedListItem[] = [];
    for (let idx = startBoundary; idx <= endBoundary; idx++) {
        const marker = parseOrderedListMarker(lines[idx], idx, options);
        if (marker == null || marker.indent !== item.marker.indent) continue;
        const sibling = makeOrderedListItem(lines, marker, options);
        items.push(sibling);
        idx = sibling.endLineIndex;
    }
    return {
        startLineIndex: startBoundary,
        endLineIndex: endBoundary,
        items,
    };
}

// ponytail: same-indent marker after a blank line starts a NEW list when its number goes
// backwards relative to what we've seen (CommonMark treats it as a fresh list, loose lists
// keep ascending numbers). Misfires on hand-written decreasing loose lists — acceptable;
// upgrade path: full markdown AST block mapping.
function findBlockStartBoundary(lines: string[], item: OrderedListItem, options?: MarkdownParseOptions): number {
    let pendingBlank = false;
    for (let idx = item.startLineIndex - 1; idx >= 0; idx--) {
        if (options?.ignoredLineIndexes?.has(idx)) {
            pendingBlank = false;
            continue;
        }
        if (lines[idx].trim() === "") {
            pendingBlank = true;
            continue;
        }
        if (isHardBoundaryLine(lines[idx], item.marker.indent)) {
            return idx + 1;
        }
        const marker = parseOrderedListMarker(lines[idx], idx, options);
        if (marker != null && marker.indent < item.marker.indent) {
            return idx + 1;
        }
        if (
            marker != null &&
            marker.indent === item.marker.indent &&
            pendingBlank &&
            marker.number >= item.marker.number
        ) {
            return idx + 1;
        }
        pendingBlank = false;
    }
    return 0;
}

function findBlockEndBoundary(lines: string[], item: OrderedListItem, options?: MarkdownParseOptions): number {
    let pendingBlank = false;
    let prevNumber = item.marker.number;
    for (let idx = item.endLineIndex + 1; idx < lines.length; idx++) {
        if (options?.ignoredLineIndexes?.has(idx)) {
            pendingBlank = false;
            continue;
        }
        if (lines[idx].trim() === "") {
            pendingBlank = true;
            continue;
        }
        if (isHardBoundaryLine(lines[idx], item.marker.indent)) {
            return idx - 1;
        }
        const marker = parseOrderedListMarker(lines[idx], idx, options);
        if (marker != null && marker.indent < item.marker.indent) {
            return idx - 1;
        }
        if (marker != null && marker.indent === item.marker.indent && pendingBlank && marker.number <= prevNumber) {
            return idx - 1;
        }
        if (marker != null) {
            prevNumber = marker.number;
        }
        pendingBlank = false;
    }
    return lines.length - 1;
}

function renumberOrderedListsInLines(
    lines: string[],
    startLineIndex: number,
    endLineIndex: number,
    options?: MarkdownParseOptions,
    // preserveBlankGroupStarts: a marker whose gap to the previous marker contains >=1 blank
    // line opens a NEW visual group — for passive passes (inline-edit commits, mount-time
    // normalize) its user-written number is honored as the group start and only following
    // items are resequenced. Active structure ops (move/cut/insert) keep the old flat
    // renumber since the user is reshaping the list and expects a continuous run.
    preserveBlankGroupStarts = false
): boolean {
    const counters = new Map<number, number>();
    let changed = false;
    let blankBeforeNextMarker = false;
    const boundedStart = Math.max(0, Math.min(lines.length - 1, startLineIndex));
    const boundedEnd = Math.max(0, Math.min(lines.length - 1, endLineIndex));
    for (let idx = boundedStart; idx <= boundedEnd; idx++) {
        const marker = parseOrderedListMarker(lines[idx], idx, options);
        if (marker == null) {
            if (lines[idx].trim() === "") {
                blankBeforeNextMarker = true;
            }
            if (isHardBoundaryLine(lines[idx], 0)) {
                counters.clear();
                blankBeforeNextMarker = false;
            }
            continue;
        }
        for (const indent of Array.from(counters.keys())) {
            if (indent > marker.indent) {
                counters.delete(indent);
            }
        }
        let expected: number;
        if (preserveBlankGroupStarts && blankBeforeNextMarker) {
            // Group start — keep what the user wrote; render honors it via <ol start=N>.
            expected = marker.number;
        } else {
            expected = (counters.get(marker.indent) ?? 0) + 1;
        }
        counters.set(marker.indent, expected);
        blankBeforeNextMarker = false;
        if (marker.number === expected) {
            continue;
        }
        lines[idx] = replaceOrderedListMarkerNumber(lines[idx], marker, expected);
        changed = true;
    }
    return changed;
}

function replaceOrderedListMarkerNumber(line: string, marker: OrderedListMarker, nextNumber: number): string {
    return line.replace(OrderedListMarkerPattern, `${" ".repeat(marker.indent)}${nextNumber}${marker.delimiter}$4`);
}

function getListItemContentColumn(line: string, fallbackColumn: number): number {
    const match = line.match(OrderedListMarkerPattern);
    return match ? match[0].length + 1 : fallbackColumn;
}

function getMarkdownFenceLineIndexes(lines: string[]): Set<number> {
    const ignoredLineIndexes = new Set<number>();
    let fence: MarkdownFence | null = null;
    lines.forEach((line, lineIndex) => {
        if (fence) {
            ignoredLineIndexes.add(lineIndex);
            if (isFenceEnd(line, fence)) {
                fence = null;
            }
            return;
        }

        const fenceStart = getFenceStart(line);
        if (fenceStart) {
            ignoredLineIndexes.add(lineIndex);
            fence = fenceStart;
        }
    });
    return ignoredLineIndexes;
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

/**
 * Whole-document renumbering pass: walks the ENTIRE file and normalizes every ordered
 * list's source numbering to match what CommonMark renders (the renderer always displays
 * 1,2,3… regardless of the source digits). Used to keep source and rendered view in sync
 * when a markdown preview opens — the user sees the renumbered list and expects the file
 * to say the same. Fence-aware (code blocks never touched) via the same parser options as
 * the targeted helpers above. Returns null when nothing needs changing (idempotent).
 */
export function normalizeOrderedListNumbering(text: string): OrderedListEditResult | null {
    const lineCount = text.split(/\r\n|\n/).length;
    if (lineCount === 0) {
        return null;
    }
    return renumberOrderedListsInSelection(text, 1, lineCount);
}

/**
 * Rewrite ONLY the marker number of the ordered-list item at `lineNumber` (1-based).
 * Used by the group-start chip's three actions — writes exactly one line, everything
 * else untouched (the line-range contract of the note surface).
 * Returns null when the line is not an ordered-list marker.
 */
export function setOrderedListMarkerNumberAtLine(
    text: string,
    lineNumber: number,
    newNumber: number
): OrderedListEditResult | null {
    const textLines = splitTextLines(text);
    const idx = lineNumberToIndex(lineNumber);
    if (idx < 0 || idx >= textLines.lines.length) {
        return null;
    }
    const options = getParseOptions(textLines.lines);
    const marker = parseOrderedListMarker(textLines.lines[idx], idx, options);
    if (marker == null) {
        return null;
    }
    if (!Number.isFinite(newNumber) || newNumber < 0) {
        return null;
    }
    const lines = [...textLines.lines];
    lines[idx] = replaceOrderedListMarkerNumber(lines[idx], marker, Math.trunc(newNumber));
    return { text: joinTextLines(lines, textLines.eol) };
}

/**
 * The number a new group after a blank gap should continue from: the most recent
 * same-or-shallower ordered marker ABOVE the blank run before `lineNumber`, + 1.
 * Returns null when nothing sensible exists above (chip hides the "continue" action).
 */
export function getPreviousOrderedListContinuation(text: string, lineNumber: number): number | null {
    const lines = splitTextLines(text).lines;
    const idx = lineNumberToIndex(lineNumber);
    if (idx <= 0) {
        return null;
    }
    const options = getParseOptions(lines);
    const anchor = parseOrderedListMarker(lines[idx], idx, options);
    if (anchor == null) {
        return null;
    }
    // Walk up past the blank run; the FIRST non-blank line decides:
    // same/shallower-indent marker → continue from it; anything else (heading, paragraph,
    // fence opening) → no continuation. Fence-internal marker-looking lines are already
    // excluded by options.ignoredLineIndexes.
    for (let i = idx - 1; i >= 0; i--) {
        const line = lines[i];
        if (line.trim() === "") {
            continue;
        }
        const marker = parseOrderedListMarker(line, i, options);
        if (marker != null && marker.indent <= anchor.indent) {
            return marker.number + 1;
        }
        return null;
    }
    return null;
}
