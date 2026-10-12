// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Table operations (方案 04 §1): row/column add-delete and column alignment. Pure
 * functions on the document (or on a table-session draft — same thing there, since the
 * editor always spans the whole table). Every op rewrites only the lines it must and
 * returns the new full text; null = no-op (caller drops the gesture).
 *
 * Row lines are detected by `findBlockRangeAtLine` (kind === "table"), which requires a
 * GFM separator row as line 2 of the pipe-run.
 */

import { findBlockRangeAtLine, isTableSeparatorLine, splitTableCells } from "./block-type";

export type TableAlign = "left" | "center" | "right";

export type TableBounds = { start: number; end: number }; // 0-based, inclusive

/** Table bounds containing 1-based `line`, or null when the line isn't in a table. */
export function findTableBounds(text: string, line: number): TableBounds | null {
    const lines = text.split(/\r\n|\n/);
    const range = findBlockRangeAtLine(lines, line);
    if (range == null || range.kind !== "table") {
        return null;
    }
    return { start: range.start, end: range.end };
}

function columnCountOf(sepLine: string): number {
    return splitTableCells(sepLine).length;
}

function makeEmptyRow(cols: number): string {
    return `| ${Array(cols).fill("").join(" | ")} |`;
}

function rowCellAt(line: string, caretOffset: number): number {
    // Cells split on "|"; a leading "|" means the caret before the first pipe is column 0.
    const upto = line.slice(0, Math.max(0, Math.min(caretOffset, line.length)));
    const pipes = (upto.match(/\|/g) ?? []).length;
    return Math.max(0, pipes - (line.trimStart().startsWith("|") ? 1 : 0));
}

/** (row 0-based offset inside the table, column index) for a caret offset — exported for
 *  the table toolbar, which maps a textarea selection to a table coordinate. */
export function caretToTableCoord(tableText: string, caret: number): { row: number; col: number } | null {
    if (caret < 0 || caret > tableText.length) {
        return null;
    }
    const lines = tableText.split("\n");
    let off = 0;
    for (let i = 0; i < lines.length; i++) {
        const lineEnd = off + lines[i].length;
        if (caret <= lineEnd) {
            return { row: i, col: rowCellAt(lines[i], caret - off) };
        }
        off = lineEnd + 1;
    }
    return null;
}

/**
 * Insert an empty row. Anchor semantics: header row → row becomes the FIRST data row;
 * the separator row → also the first data row (directly below it); a data row → directly
 * below that row.
 */
export function insertTableRow(text: string, line: number): string | null {
    const bounds = findTableBounds(text, line);
    if (bounds == null) {
        return null;
    }
    const lines = text.split(/\r\n|\n/);
    const cols = columnCountOf(lines[bounds.start + 1]);
    const idx = Math.trunc(line) - 1;
    const insertAt =
        idx === bounds.start || idx === bounds.start + 1 ? bounds.start + 2 : Math.min(idx + 1, bounds.end + 1);
    lines.splice(insertAt, 0, makeEmptyRow(cols));
    return lines.join("\n");
}

/**
 * Delete the row at 1-based `line`. Deleting the header PROMOTES the first data row
 * (a table without a header is invalid GFM); deleting the last data row leaves the
 * header+separator intact. Deleting a separator row is refused (would break the table).
 */
export function deleteTableRow(text: string, line: number): string | null {
    const bounds = findTableBounds(text, line);
    if (bounds == null) {
        return null;
    }
    const lines = text.split(/\r\n|\n/);
    const idx = Math.trunc(line) - 1;
    if (idx === bounds.start + 1) {
        return null; // separator row
    }
    const dataRowCount = bounds.end - (bounds.start + 1);
    if (idx === bounds.start) {
        if (dataRowCount < 1) {
            return null; // header-only table: nothing to promote
        }
        // promote first data row to header
        lines.splice(bounds.start, 1); // drop old header
        // (the former first data row now sits at bounds.start + 1? no: it shifted up.)
        // After removing the header, layout is [sep, data1, data2…]; rotate sep below data1.
        const sep = lines.splice(bounds.start, 1)[0]; // remove separator (now directly above data1)
        lines.splice(bounds.start + 1, 0, sep); // …and park it below the new header
        return lines.join("\n");
    }
    lines.splice(idx, 1);
    return lines.join("\n");
}

/** Insert a column at `colIdx`, to its left or right. Header/data cells are blank, the
 *  separator cell is "---". */
export function insertTableColumn(
    text: string,
    line: number,
    colIdx: number,
    side: "left" | "right"
): string | null {
    const bounds = findTableBounds(text, line);
    if (bounds == null || !Number.isFinite(colIdx) || colIdx < 0) {
        return null;
    }
    const lines = text.split(/\r\n|\n/);
    const cols = columnCountOf(lines[bounds.start + 1]);
    const at = Math.min(colIdx + (side === "right" ? 1 : 0), cols);
    for (let i = bounds.start; i <= bounds.end; i++) {
        const cells = splitTableCells(lines[i]);
        while (cells.length < cols) {
            cells.push("");
        }
        cells.splice(at, 0, i === bounds.start + 1 ? "---" : "");
        lines[i] = `| ${cells.join(" | ")} |`;
    }
    return lines.join("\n");
}

/** Delete column `colIdx`. Refuses to remove the LAST remaining column. */
export function deleteTableColumn(text: string, line: number, colIdx: number): string | null {
    const bounds = findTableBounds(text, line);
    if (bounds == null || !Number.isFinite(colIdx) || colIdx < 0) {
        return null;
    }
    const lines = text.split(/\r\n|\n/);
    const cols = columnCountOf(lines[bounds.start + 1]);
    if (cols <= 1 || colIdx >= cols) {
        return null;
    }
    for (let i = bounds.start; i <= bounds.end; i++) {
        const cells = splitTableCells(lines[i]);
        while (cells.length < cols) {
            cells.push("");
        }
        cells.splice(colIdx, 1);
        lines[i] = `| ${cells.join(" | ")} |`;
    }
    return lines.join("\n");
}

/** Set one column's alignment (rewrites only the separator row's cell). */
export function setColumnAlign(text: string, line: number, colIdx: number, align: TableAlign): string | null {
    const bounds = findTableBounds(text, line);
    if (bounds == null || !Number.isFinite(colIdx) || colIdx < 0) {
        return null;
    }
    const lines = text.split(/\r\n|\n/);
    const sepIdx = bounds.start + 1;
    const cells = splitTableCells(lines[sepIdx]);
    if (colIdx >= cells.length) {
        return null;
    }
    cells[colIdx] = align === "left" ? ":---" : align === "center" ? ":---:" : "---:";
    lines[sepIdx] = `| ${cells.join(" | ")} |`;
    return lines.join("\n");
}

/** Current alignment of column `colIdx` ("default" = bare ---). */
export function getColumnAlign(text: string, line: number, colIdx: number): TableAlign | "default" | null {
    const bounds = findTableBounds(text, line);
    if (bounds == null) {
        return null;
    }
    const lines = text.split(/\r\n|\n/);
    const cells = splitTableCells(lines[bounds.start + 1]);
    const cell = cells[colIdx];
    if (cell == null) {
        return null;
    }
    const c = cell.trim();
    if (c.startsWith(":") && c.endsWith(":")) {
        return "center";
    }
    if (c.startsWith(":")) {
        return "left";
    }
    if (c.endsWith(":")) {
        return "right";
    }
    return "default";
}

// ---------------------------------------------------------------------------
// Rendered-coordinate addressing (M7: milkdown-style table chrome).
// Rendered row indices: 0 = header row, 1..n = data rows (the separator line is
// NOT rendered). Boundary indices point at the GAP before a rendered row/column:
// column boundary 0 = left of the first column, boundary cols = right of last.
// ---------------------------------------------------------------------------

/** Rendered row count (header + data rows; separator line excluded). 0 when not a table. */
export function tableRenderedRowCount(text: string, line: number): number {
    const bounds = findTableBounds(text, line);
    if (bounds == null) {
        return 0;
    }
    return bounds.end - bounds.start;
}

/** Raw source text of one cell, or null when the coordinate is out of range. */
export function getTableCellText(text: string, line: number, row: number, col: number): string | null {
    const bounds = findTableBounds(text, line);
    if (bounds == null || row < 0 || col < 0 || row >= bounds.end - bounds.start) {
        return null;
    }
    const lines = text.split(/\r\n|\n/);
    const idx = row === 0 ? bounds.start : bounds.start + 1 + row;
    const cells = splitTableCells(lines[idx]);
    return col < cells.length ? cells[col] : null;
}

/** Rewrite exactly one cell's text. The row is re-emitted in canonical `| a | b |` form;
 *  every other line is untouched. Returns null when out of range or unchanged. */
export function setTableCellText(text: string, line: number, row: number, col: number, value: string): string | null {
    const bounds = findTableBounds(text, line);
    if (bounds == null || row < 0 || col < 0 || row >= bounds.end - bounds.start) {
        return null;
    }
    const lines = text.split(/\r\n|\n/);
    const idx = row === 0 ? bounds.start : bounds.start + 1 + row;
    const cells = splitTableCells(lines[idx]);
    if (col >= cells.length || cells[col] === value) {
        return null;
    }
    cells[col] = value;
    lines[idx] = `| ${cells.join(" | ")} |`;
    return lines.join("\n");
}

/** Insert a row at the GAP before rendered row `boundary` (milkdown line-handle semantics).
 *  boundary ∈ [1, renderedRowCount]: 1 = first data row (never above the header),
 *  renderedRowCount = append as the last row. */
export function insertTableRowAtBoundary(text: string, line: number, boundary: number): string | null {
    const bounds = findTableBounds(text, line);
    if (bounds == null || !Number.isInteger(boundary)) {
        return null;
    }
    const rows = bounds.end - bounds.start;
    if (boundary < 1 || boundary > rows) {
        return null;
    }
    const lines = text.split(/\r\n|\n/);
    const cols = columnCountOf(lines[bounds.start + 1]);
    lines.splice(bounds.start + 1 + boundary, 0, makeEmptyRow(cols));
    return lines.join("\n");
}

/** Insert a column at the GAP before column `boundary` ∈ [0, cols]. */
export function insertTableColumnAtBoundary(text: string, line: number, boundary: number): string | null {
    const bounds = findTableBounds(text, line);
    if (bounds == null || !Number.isInteger(boundary)) {
        return null;
    }
    const lines = text.split(/\r\n|\n/);
    const cols = columnCountOf(lines[bounds.start + 1]);
    if (boundary < 0 || boundary > cols) {
        return null;
    }
    for (let i = bounds.start; i <= bounds.end; i++) {
        const cells = splitTableCells(lines[i]);
        while (cells.length < cols) {
            cells.push("");
        }
        cells.splice(boundary, 0, i === bounds.start + 1 ? "---" : "");
        lines[i] = `| ${cells.join(" | ")} |`;
    }
    return lines.join("\n");
}

/**
 * Move rendered row `from` into the GAP `boundary` (drop-indicator position).
 * No-op (null) when boundary === from or from+1. The separator line always stays second,
 * so whatever row lands first becomes the header — identical to milkdown's visual move,
 * expressed in GFM.
 */
export function moveTableRow(text: string, line: number, from: number, boundary: number): string | null {
    const bounds = findTableBounds(text, line);
    if (bounds == null || !Number.isInteger(from) || !Number.isInteger(boundary)) {
        return null;
    }
    const rows = bounds.end - bounds.start;
    if (from < 0 || from >= rows || boundary < 0 || boundary > rows || boundary === from || boundary === from + 1) {
        return null;
    }
    const lines = text.split(/\r\n|\n/);
    // Source idx per rendered row: header → start, data r → start + 1 + r. Separator pinned.
    const rowIdxs: number[] = [bounds.start];
    for (let r = 1; r < rows; r++) {
        rowIdxs.push(bounds.start + 1 + r);
    }
    const entries = rowIdxs.map((i) => lines[i]);
    const [moved] = entries.splice(from, 1);
    const insertAt = boundary > from ? boundary - 1 : boundary;
    entries.splice(insertAt, 0, moved);
    for (let r = 0; r < rows; r++) {
        lines[rowIdxs[r]] = entries[r];
    }
    return lines.join("\n");
}

/** Move column `from` into the GAP `boundary` (header, separator and data cells move together). */
export function moveTableColumn(text: string, line: number, from: number, boundary: number): string | null {
    const bounds = findTableBounds(text, line);
    if (bounds == null || !Number.isInteger(from) || !Number.isInteger(boundary)) {
        return null;
    }
    const lines = text.split(/\r\n|\n/);
    const cols = columnCountOf(lines[bounds.start + 1]);
    if (from < 0 || from >= cols || boundary < 0 || boundary > cols || boundary === from || boundary === from + 1) {
        return null;
    }
    for (let i = bounds.start; i <= bounds.end; i++) {
        const cells = splitTableCells(lines[i]);
        while (cells.length < cols) {
            cells.push("");
        }
        const [moved] = cells.splice(from, 1);
        const insertAt = boundary > from ? boundary - 1 : boundary;
        cells.splice(insertAt, 0, moved);
        lines[i] = `| ${cells.join(" | ")} |`;
    }
    return lines.join("\n");
}

/** Delete rendered row `row` (0 = header, which promotes the first data row, per deleteTableRow). */
export function deleteTableRenderedRow(text: string, line: number, row: number): string | null {
    const bounds = findTableBounds(text, line);
    if (bounds == null || row < 0 || row >= bounds.end - bounds.start) {
        return null;
    }
    const srcLine = (row === 0 ? bounds.start : bounds.start + 1 + row) + 1;
    return deleteTableRow(text, srcLine);
}
