// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * TableBlock — milkdown-style WYSIWYG table wrapper (方案 07).
 * When the `tablecell` flag is ON, the table stays in rendered form: cell editing
 * is in-place contentEditable; hovering shows pill/line handles for insert/delete/
 * align; drag handles move rows/columns. All mutations flow through the single
 * `TableEditContext.commitFullText` channel (undo-friendly, autosave).
 */

import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { createPortal } from "react-dom";
import { clsx } from "clsx";

import {
    getTableCellText,
    setTableCellText,
    insertTableRowAtBoundary,
    insertTableColumnAtBoundary,
    deleteTableRenderedRow,
    deleteTableColumn,
    setColumnAlign,
    moveTableRow,
    moveTableColumn,
    tableRenderedRowCount,
    type TableAlign,
} from "../../markdown-transform/table";
import { tableCellDomToMarkdown } from "../../markdown-transform/table-cell";
import { isBlockEditorFeatureEnabled } from "../flags";

// ---------------------------------------------------------------------------
// Context — provided by Markdown component, consumed by TableBlock.
// Stable across react-markdown remounts so pending focus survives re-renders.
// ---------------------------------------------------------------------------

export interface TableCellFocus {
    /** 1-based source line of the table's first line (header). */
    line: number;
    /** Rendered row index (0 = header, 1+ = data). */
    row: number;
    /** 0-based column index. */
    col: number;
}

export interface TableEditContextValue {
    getFullText: () => string;
    commitFullText: (text: string) => void;
    pendingFocusRef: React.MutableRefObject<TableCellFocus | null>;
}

export const TableEditContext = createContext<TableEditContextValue | null>(null);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const THRESHOLD_PX = 8;
const PILL_W = 32;
const PILL_H = 20;

function getSourceLine(props: any): number | undefined {
    const line = props?.node?.position?.start?.line;
    return Number.isInteger(line) && line > 0 ? line : undefined;
}

function cellCoords(table: HTMLTableElement, target: HTMLElement): { row: number; col: number } | null {
    const td = target.closest<HTMLElement>("td, th");
    if (td == null || !table.contains(td)) return null;
    const tr = td.parentElement as HTMLTableRowElement | null;
    if (tr == null) return null;
    const row = Array.from(table.querySelectorAll("tr")).indexOf(tr);
    return row >= 0 ? { row, col: (td as HTMLTableCellElement).cellIndex } : null;
}

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface TableBlockProps {
    props: React.HTMLAttributes<HTMLTableElement>;
    collapsed: boolean;
    onToggle: () => void;
}

export function TableBlock({ props, collapsed, onToggle }: TableBlockProps) {
    const ctx = useContext(TableEditContext);
    const editable = ctx != null && isBlockEditorFeatureEnabled("tablecell");
    const tableLine = getSourceLine(props) ?? 0;

    // --- refs ---
    const wrapperRef = useRef<HTMLDivElement>(null);
    const tableRef = useRef<HTMLTableElement>(null);
    const editSnapshotRef = useRef<string>("");
    const activeCellRef = useRef<{ row: number; col: number; cell: HTMLElement } | null>(null);
    const hoverLeaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // --- state ---
    const [hover, setHover] = useState<{ mode: "cell"; row: number; col: number } | { mode: "lineV"; boundary: number } | { mode: "lineH"; boundary: number } | null>(null);
    const hoverRef = useRef<typeof hover>(null); // hysteresis: track last hover to prevent mode oscillation
    const [selectedCol, setSelectedCol] = useState<number | null>(null);
    const [selectedRow, setSelectedRow] = useState<number | null>(null);
    const [drag, setDrag] = useState<{ axis: "col" | "row"; from: number; boundary: number | null; px: number; py: number } | null>(null);

    // Stable fullText getter (never stale)
    const getFullText = useCallback(() => ctx?.getFullText() ?? "", [ctx]);

    // --- activate / commit / cancel cell editing ---
    function activateCell(cell: HTMLElement, row: number, col: number) {
        commitActiveCell();
        cell.contentEditable = "true";
        editSnapshotRef.current = cell.innerHTML;
        cell.focus();
        activeCellRef.current = { row, col, cell };
        // place caret at end
        const range = document.createRange();
        const sel = window.getSelection();
        if (sel && cell.childNodes.length > 0) {
            range.selectNodeContents(cell);
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
        }
    }

    function commitActiveCell() {
        const ac = activeCellRef.current;
        if (ac == null || tableLine <= 0) return;
        ac.cell.removeAttribute("contentEditable");
        const md = tableCellDomToMarkdown(ac.cell);
        const cur = getTableCellText(getFullText(), tableLine, ac.row, ac.col);
        if (md !== cur && ctx != null) {
            const next = setTableCellText(getFullText(), tableLine, ac.row, ac.col, md);
            if (next != null) ctx.commitFullText(next);
        }
        activeCellRef.current = null;
    }

    function cancelEdit() {
        const ac = activeCellRef.current;
        if (ac == null) return;
        ac.cell.innerHTML = editSnapshotRef.current;
        ac.cell.removeAttribute("contentEditable");
        activeCellRef.current = null;
    }

    // --- blur ---
    const handleBlur = useCallback((e: React.FocusEvent) => {
        const related = e.relatedTarget as HTMLElement | null;
        // Don't commit if focus stays inside our wrapper (clicking another cell, button)
        if (related != null && wrapperRef.current?.contains(related)) return;
        // Commit after a frame (allows mousedown on another cell to fire first)
        requestAnimationFrame(() => { commitActiveCell(); });
    }, [tableLine, ctx]);

    // --- pointer move (hover detection) ---
    const handlePointerMove = useCallback((e: React.PointerEvent) => {
        if (!editable) return;
        const table = tableRef.current;
        if (table == null) return;
        // Pointer re-entered the wrapper — cancel any pending leave timeout
        if (hoverLeaveTimerRef.current != null) { clearTimeout(hoverLeaveTimerRef.current); hoverLeaveTimerRef.current = null; }

        const coords = cellCoords(table, e.target as HTMLElement);
        if (coords == null) { setHover(null); hoverRef.current = null; setSelectedCol(null); setSelectedRow(null); return; }
        const cell = (e.target as HTMLElement).closest("td,th") as HTMLElement;
        const cr = cell.getBoundingClientRect();
        const dxL = e.clientX - cr.left;
        const dxR = cr.right - e.clientX;
        const dyT = e.clientY - cr.top;
        const dyB = cr.bottom - e.clientY;
        const maxRow = tableRenderedRowCount(getFullText(), tableLine) - 1;
        const maxCol = (table.querySelector("tr:last-child")?.children.length ?? 2) - 2;
        const prevHover = hoverRef.current;

        // Hysteresis: once locked into a line mode, keep it until the pointer moves
        // well past the threshold (2× the entry threshold). This prevents rapid
        // oscillation between lineV / lineH / cell when the pointer is near a corner
        // or edge intersection.
        const LOCKED_EXIT_PX = THRESHOLD_PX * 2;

        // --- try to enter lineV (vertical column boundary) ---
        if (Math.min(dxL, dxR) <= THRESHOLD_PX) {
            const boundary = dxL < dxR ? coords.col : coords.col + 1;
            if (boundary >= 0 && boundary <= maxCol + 1) {
                // Stay locked if already lineV with the same boundary
                if (prevHover?.mode === "lineV" && prevHover.boundary === boundary) return;
                // Hysteresis: only switch *away* from lineV if pointer is clearly past the lock zone
                if (prevHover?.mode === "lineV" && Math.min(dxL, dxR) > LOCKED_EXIT_PX) {
                    // fall through to other checks below
                } else {
                    if (prevHover?.mode !== "lineV" || prevHover.boundary !== boundary) {
                        setSelectedCol(null); setSelectedRow(null);
                    }
                    setHover({ mode: "lineV", boundary }); hoverRef.current = { mode: "lineV", boundary };
                    return;
                }
            }
        }

        // --- try to enter lineH (horizontal row boundary) ---
        // skip header top (boundary 0)
        if (Math.min(dyT, dyB) <= THRESHOLD_PX) {
            const boundary = dyT < dyB ? coords.row : coords.row + 1;
            if (boundary > 0 && boundary <= maxRow + 1) {
                if (prevHover?.mode === "lineH" && prevHover.boundary === boundary) return;
                if (prevHover?.mode === "lineH" && Math.min(dyT, dyB) > LOCKED_EXIT_PX) {
                    // fall through
                } else {
                    if (prevHover?.mode !== "lineH" || prevHover.boundary !== boundary) {
                        setSelectedCol(null); setSelectedRow(null);
                    }
                    setHover({ mode: "lineH", boundary }); hoverRef.current = { mode: "lineH", boundary };
                    return;
                }
            }
        }

        // --- default: cell hover ---
        if (prevHover?.mode === "cell" && prevHover.row === coords.row && prevHover.col === coords.col) return;
        if (prevHover != null) { setSelectedCol(null); setSelectedRow(null); }
        setHover({ mode: "cell", row: coords.row, col: coords.col });
        hoverRef.current = { mode: "cell", row: coords.row, col: coords.col };
    }, [editable, ctx, tableLine, getFullText]);

    const handlePointerLeave = useCallback(() => {
        // Delay clearing hover so the pointer can reach portaled chrome elements
        // (line handles, pills, action buttons) without the UI disappearing first.
        hoverLeaveTimerRef.current = setTimeout(() => {
            hoverLeaveTimerRef.current = null;
            setHover(null);
            hoverRef.current = null;
        }, 80);
    }, []);

    const cancelHoverLeave = useCallback(() => {
        if (hoverLeaveTimerRef.current != null) {
            clearTimeout(hoverLeaveTimerRef.current);
            hoverLeaveTimerRef.current = null;
        }
    }, []);

    // Cleanup timer on unmount
    useEffect(() => {
        return () => { if (hoverLeaveTimerRef.current != null) clearTimeout(hoverLeaveTimerRef.current); };
    }, []);

    // --- scroll: hide chrome ---
    useEffect(() => {
        if (!editable) return;
        let raf: number | null = null;
        const onScroll = () => { setHover(null); hoverRef.current = null; };
        window.addEventListener("scroll", onScroll, { capture: true, passive: true });
        return () => { window.removeEventListener("scroll", onScroll); if (raf != null) cancelAnimationFrame(raf); };
    }, [editable]);

    // --- cell mousedown: activate editing ---
    const handleWrapperMouseDown = useCallback((e: React.MouseEvent) => {
        if (!editable || tableLine <= 0) return;
        const td = (e.target as HTMLElement).closest<HTMLElement>("td, th");
        if (td == null || !wrapperRef.current?.contains(td)) return;
        const table = tableRef.current;
        if (table == null) return;
        const coords = cellCoords(table, td);
        if (coords == null) return;
        commitActiveCell();
        td.contentEditable = "true";
        editSnapshotRef.current = td.innerHTML;
        activeCellRef.current = { ...coords, cell: td };
    }, [editable, tableLine, getFullText, ctx]);

    // --- keydown on wrapper (delegated for contentEditable cells) ---
    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (!editable || activeCellRef.current == null || tableLine <= 0 || ctx == null) return;
        const ac = activeCellRef.current;
        const ft = getFullText();
        const rowCount = tableRenderedRowCount(ft, tableLine);
        const table = tableRef.current;
        const maxCol = (table?.querySelector("tr:last-child")?.children.length ?? 2) - 2;

        if (e.key === "Escape") { e.preventDefault(); cancelEdit(); return; }

        if (e.key === "Tab") {
            e.preventDefault();
            const md = tableCellDomToMarkdown(ac.cell);
            let nextRow = ac.row, nextCol = e.shiftKey ? ac.col - 1 : ac.col + 1;
            if (nextCol > maxCol) { nextRow++; nextCol = 0; }
            else if (nextCol < 0) { nextRow--; nextCol = maxCol; }
            let fullNext = ft;
            const cur = getTableCellText(ft, tableLine, ac.row, ac.col);
            if (md !== cur) { const u = setTableCellText(ft, tableLine, ac.row, ac.col, md); if (u != null) fullNext = u; }
            if (nextRow >= rowCount) {
                const ins = insertTableRowAtBoundary(fullNext, tableLine, rowCount + 1);
                if (ins != null) { fullNext = ins; nextCol = e.shiftKey ? maxCol : 0; }
                else { nextRow = rowCount - 1; }
            }
            nextRow = Math.max(0, nextRow);
            nextCol = clamp(nextCol, 0, maxCol);
            ctx.pendingFocusRef.current = { line: tableLine, row: nextRow, col: nextCol };
            ctx.commitFullText(fullNext);
            return;
        }

        if (e.key === "Enter" && !e.nativeEvent?.isComposing) {
            e.preventDefault();
            document.execCommand("insertLineBreak");
            return;
        }

        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            const sel = window.getSelection();
            if (sel?.rangeCount !== 1) return;
            const range = sel.getRangeAt(0);
            const atStart = range.collapsed && range.startOffset === 0 && range.startContainer === ac.cell.firstChild;
            const atEnd = range.collapsed && range.endOffset === (ac.cell.textContent?.length ?? 0) && range.endContainer === ac.cell.lastChild;
            if ((e.key === "ArrowUp" && !atStart) || (e.key === "ArrowDown" && !atEnd)) return;
            e.preventDefault();
            const targetRow = e.key === "ArrowUp" ? ac.row - 1 : ac.row + 1;
            if (targetRow < 0 || targetRow >= rowCount) return;
            const md = tableCellDomToMarkdown(ac.cell);
            let fullNext = ft;
            const cur = getTableCellText(ft, tableLine, ac.row, ac.col);
            if (md !== cur) { const u = setTableCellText(ft, tableLine, ac.row, ac.col, md); if (u != null) fullNext = u; }
            ctx.pendingFocusRef.current = { line: tableLine, row: targetRow, col: clamp(ac.col, 0, maxCol) };
            ctx.commitFullText(fullNext);
        }
    }, [editable, ctx, tableLine, getFullText]);

    // --- action handlers ---
    const handleInsertRow = useCallback((boundary: number) => {
        if (tableLine <= 0) return;
        const next = insertTableRowAtBoundary(getFullText(), tableLine, boundary);
        if (next != null) ctx?.commitFullText(next);
        setHover(null);
    }, [ctx, tableLine, getFullText]);

    const handleInsertCol = useCallback((boundary: number) => {
        if (tableLine <= 0) return;
        const next = insertTableColumnAtBoundary(getFullText(), tableLine, boundary);
        if (next != null) ctx?.commitFullText(next);
        setHover(null);
    }, [ctx, tableLine, getFullText]);

    const handleDeleteRow = useCallback(() => {
        if (tableLine <= 0 || selectedRow == null) return;
        const next = deleteTableRenderedRow(getFullText(), tableLine, selectedRow);
        if (next != null) ctx?.commitFullText(next);
        setSelectedRow(null);
    }, [ctx, tableLine, selectedRow, getFullText]);

    const handleDeleteCol = useCallback(() => {
        if (tableLine <= 0 || selectedCol == null) return;
        const next = deleteTableColumn(getFullText(), tableLine, selectedCol);
        if (next != null) ctx?.commitFullText(next);
        setSelectedCol(null);
    }, [ctx, tableLine, selectedCol, getFullText]);

    const handleAlign = useCallback((align: TableAlign) => {
        if (tableLine <= 0 || selectedCol == null) return;
        const next = setColumnAlign(getFullText(), tableLine, selectedCol, align);
        if (next != null) ctx?.commitFullText(next);
    }, [ctx, tableLine, selectedCol, getFullText]);

    // --- drag (phase 2: pointer events) ---
    const dragRef = useRef(drag);
    dragRef.current = drag;

    const handlePillPointerDown = useCallback((e: React.PointerEvent, axis: "col" | "row", from: number) => {
        e.preventDefault();
        e.stopPropagation();
        setDrag({ axis, from, boundary: null, px: e.clientX, py: e.clientY });
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
    }, []);

    const handlePillPointerMove = useCallback((e: React.PointerEvent, axis: "col" | "row", from: number) => {
        const d = dragRef.current;
        if (d == null || d.axis !== axis || d.from !== from) return;
        const table = tableRef.current;
        if (table == null) return;
        let boundary: number | null = null;
        if (axis === "col") {
            const cells = Array.from(table.querySelectorAll("tr:last-child > td, tr:last-child > th")) as HTMLElement[];
            const tr = table.getBoundingClientRect();
            let cumX = tr.left;
            for (let i = 0; i < cells.length; i++) {
                const w = cells[i].getBoundingClientRect().width;
                if (e.clientX < cumX + w / 2) { boundary = i; break; }
                cumX += w;
            }
            if (boundary == null) boundary = cells.length;
        } else {
            const rows = Array.from(table.querySelectorAll("tr")) as HTMLElement[];
            const tr = table.getBoundingClientRect();
            let cumY = tr.top;
            for (let i = 0; i < rows.length; i++) {
                const h = rows[i].getBoundingClientRect().height;
                if (e.clientY < cumY + h / 2) { boundary = i; break; }
                cumY += h;
            }
            if (boundary == null) boundary = rows.length;
        }
        setDrag({ axis, from, boundary, px: e.clientX, py: e.clientY });
    }, []);

    const handlePillPointerUp = useCallback((e: React.PointerEvent, axis: "col" | "row", from: number) => {
        const d = dragRef.current;
        if (d == null || d.axis !== axis || d.from !== from || tableLine <= 0) { setDrag(null); return; }
        const b = d.boundary;
        if (b != null && b !== from && b !== from + 1 && ctx != null) {
            const ft = getFullText();
            const next = axis === "col"
                ? moveTableColumn(ft, tableLine, from, b)
                : moveTableRow(ft, tableLine, from, b);
            if (next != null) ctx.commitFullText(next);
        }
        setDrag(null);
    }, [ctx, tableLine, getFullText]);

    // --- pill click → show action groups ---
    const handleColPillClick = useCallback((e: React.MouseEvent, col: number) => {
        e.stopPropagation();
        setSelectedCol(prev => prev === col ? null : col);
        setSelectedRow(null);
    }, []);

    const handleRowPillClick = useCallback((e: React.MouseEvent, row: number) => {
        e.stopPropagation();
        setSelectedRow(prev => prev === row ? null : row);
        setSelectedCol(null);
    }, []);

    // Dismiss selection on outside click
    useEffect(() => {
        if (selectedCol == null && selectedRow == null) return;
        const dismiss = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            if (target.closest(".tb-actions, .tb-pill, .tb-line-plus")) return;
            setSelectedCol(null);
            setSelectedRow(null);
        };
        window.addEventListener("mousedown", dismiss, { capture: true });
        return () => window.removeEventListener("mousedown", dismiss);
    }, [selectedCol, selectedRow]);

    // --- postCommitFocus: restore cell focus after commit triggers remount ---
    useEffect(() => {
        if (!editable || tableLine <= 0 || ctx == null) return;
        const pf = ctx.pendingFocusRef.current;
        if (pf == null || pf.line !== tableLine) return;
        ctx.pendingFocusRef.current = null;
        const table = tableRef.current;
        if (table == null) return;
        const tr = table.querySelectorAll("tr")[pf.row];
        if (tr == null) return;
        const cell = tr.children[pf.col] as HTMLElement | undefined;
        if (cell == null) return;
        activateCell(cell, pf.row, pf.col);
    });

    // ========================================================================
    // Render
    // ========================================================================

    const srcLineAttrs: Record<string, number> = {};
    if (tableLine > 0) {
        srcLineAttrs["data-source-line"] = tableLine;
        const endLine = (props as any)?.node?.position?.end?.line;
        if (Number.isInteger(endLine) && endLine >= tableLine) srcLineAttrs["data-source-line-end"] = endLine;
    }

    const tableEl = <table {...props} ref={tableRef as any} />;

    // Non-editable: just CollapsibleTable behavior
    if (!editable) {
        return (
            <div className={clsx("table-wrapper", collapsed && "collapsed")} {...props} style={props.style}>
                <button type="button" className="table-collapse-button" title={collapsed ? "Expand table" : "Collapse table"} aria-label={collapsed ? "Expand table" : "Collapse table"} onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggle(); }}>
                    <i className={clsx("fa-sharp fa-solid", collapsed ? "fa-chevron-right" : "fa-chevron-down")} />
                </button>
                {tableEl}
            </div>
        );
    }

    const table = tableRef.current;
    const hoverMode = hover?.mode;

    // --- Compute chrome positions ---
    let colPillStyle: React.CSSProperties | undefined;
    let rowPillStyle: React.CSSProperties | undefined;
    let lineVStyle: React.CSSProperties | undefined;
    let lineHStyle: React.CSSProperties | undefined;

    if (table != null && hover != null) {
        const tr = table.getBoundingClientRect();
        if (hoverMode === "cell") {
            const cells = Array.from(table.querySelectorAll(`tr:nth-child(${hover.row + 1}) > td, tr:nth-child(${hover.row + 1}) > th`)) as HTMLElement[];
            const cellEl = cells[hover.col];
            if (cellEl) {
                const cr = cellEl.getBoundingClientRect();
                colPillStyle = { position: "fixed", left: cr.left + cr.width / 2 - PILL_W / 2, top: tr.top - PILL_H - 4, width: PILL_W, height: PILL_H };
                if (hover.row > 0) {
                    rowPillStyle = { position: "fixed", left: tr.left - PILL_H - 6, top: cr.top + cr.height / 2 - PILL_W / 2, width: PILL_H, height: PILL_W };
                }
            }
        } else if (hoverMode === "lineV") {
            let x = tr.left;
            const allCells = Array.from(table.querySelectorAll("tr:last-child > td, tr:last-child > th")) as HTMLElement[];
            for (let i = 0; i < hover.boundary && i < allCells.length; i++) x += allCells[i].getBoundingClientRect().width;
            lineVStyle = { position: "fixed", left: x - 1, top: tr.top, width: 2, height: tr.height };
        } else if (hoverMode === "lineH") {
            let y = tr.top;
            const allRows = Array.from(table.querySelectorAll("tr")) as HTMLElement[];
            for (let i = 0; i < hover.boundary && i < allRows.length; i++) y += allRows[i].getBoundingClientRect().height;
            lineHStyle = { position: "fixed", left: tr.left, top: y - 1, width: tr.width, height: 2 };
        }
    }

    // Drag chrome
    let dragPreviewStyle: React.CSSProperties | undefined;
    let dropIndicatorStyle: React.CSSProperties | undefined;
    let dragLabel = "";
    if (drag != null && table != null) {
        dragLabel = drag.axis === "col" ? `Column ${drag.from + 1}` : `Row ${drag.from + 1}`;
        dragPreviewStyle = { position: "fixed", left: drag.px - 20, top: drag.py - 10, padding: "4px 10px", borderRadius: 4, background: "var(--accent-color, #5a8080)", color: "#fff", fontSize: 11, pointerEvents: "none" as const, opacity: 0.8, zIndex: 9999 };
        if (drag.boundary != null && drag.boundary !== drag.from && drag.boundary !== drag.from + 1) {
            const tr = table.getBoundingClientRect();
            if (drag.axis === "col") {
                let x = tr.left;
                const cells = Array.from(table.querySelectorAll("tr:last-child > td, tr:last-child > th")) as HTMLElement[];
                for (let i = 0; i < drag.boundary && i < cells.length; i++) x += cells[i].getBoundingClientRect().width;
                dropIndicatorStyle = { position: "fixed", left: x - 1, top: tr.top, width: 2, height: tr.height, background: "var(--accent-color, #5a8080)", pointerEvents: "none" as const, zIndex: 9998 };
            } else {
                let y = tr.top;
                const allRows = Array.from(table.querySelectorAll("tr")) as HTMLElement[];
                for (let i = 0; i < drag.boundary && i < allRows.length; i++) y += allRows[i].getBoundingClientRect().height;
                dropIndicatorStyle = { position: "fixed", left: tr.left, top: y - 1, width: tr.width, height: 2, background: "var(--accent-color, #5a8080)", pointerEvents: "none" as const, zIndex: 9998 };
            }
        }
    }

    // Action group portals
    let colActionsEl: React.ReactPortal | null = null;
    let rowActionsEl: React.ReactPortal | null = null;
    if (selectedCol != null && table != null) {
        const th = table.getBoundingClientRect();
        const cells = Array.from(table.querySelectorAll("tr:first-child > th, tr:first-child > td")) as HTMLElement[];
        let x = th.left;
        for (let i = 0; i < selectedCol && i < cells.length; i++) x += cells[i].getBoundingClientRect().width;
        colActionsEl = createPortal(
            <div className="tb-actions" style={{ position: "fixed", left: x, top: th.top - 36, zIndex: 9999 }}>
                <button className="tb-action-btn" title="Align left" onClick={() => handleAlign("left")}><i className="fa-solid fa-align-left" /></button>
                <button className="tb-action-btn" title="Align center" onClick={() => handleAlign("center")}><i className="fa-solid fa-align-center" /></button>
                <button className="tb-action-btn" title="Align right" onClick={() => handleAlign("right")}><i className="fa-solid fa-align-right" /></button>
                <button className="tb-action-btn tb-action-delete" title="Delete column" onClick={handleDeleteCol}><i className="fa-solid fa-trash-can" /></button>
            </div>,
            document.body
        );
    }
    if (selectedRow != null && table != null) {
        const tr2 = table.getBoundingClientRect();
        const rows = Array.from(table.querySelectorAll("tr")) as HTMLElement[];
        let y = tr2.top;
        for (let i = 0; i < selectedRow && i < rows.length; i++) y += rows[i].getBoundingClientRect().height;
        const rowH = (rows[selectedRow] as HTMLElement)?.getBoundingClientRect().height ?? 0;
        rowActionsEl = createPortal(
            <div className="tb-actions" style={{ position: "fixed", left: tr2.left - 80, top: y + rowH / 2 - 12, zIndex: 9999 }}>
                <button className="tb-action-btn tb-action-delete" title="Delete row" onClick={handleDeleteRow}><i className="fa-solid fa-trash-can" /></button>
            </div>,
            document.body
        );
    }

    return (
        <>
            <div
                ref={wrapperRef}
                className={clsx("table-wrapper", collapsed && "collapsed", "tb-wrapper")}
                {...srcLineAttrs}
                data-selected-col={selectedCol != null ? selectedCol + 1 : undefined}
                data-selected-row={selectedRow != null ? selectedRow : undefined}
                onPointerMove={handlePointerMove}
                onPointerLeave={handlePointerLeave}
                onMouseDown={handleWrapperMouseDown as any}
                onBlur={handleBlur}
                onKeyDown={handleKeyDown}
            >
                <button type="button" className="table-collapse-button" title={collapsed ? "Expand table" : "Collapse table"} aria-label={collapsed ? "Expand table" : "Collapse table"} onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggle(); }}>
                    <i className={clsx("fa-sharp fa-solid", collapsed ? "fa-chevron-right" : "fa-chevron-down")} />
                </button>
                {tableEl}
            </div>
            {/* Chrome portals */}
            {colPillStyle && <div className="tb-pill" style={colPillStyle}
                onPointerEnter={cancelHoverLeave}
                onPointerDown={(e) => handlePillPointerDown(e, "col", hover!.mode === "cell" ? hover!.col : 0)}
                onPointerMove={(e) => handlePillPointerMove(e, "col", hover!.mode === "cell" ? hover!.col : 0)}
                onPointerUp={(e) => handlePillPointerUp(e, "col", hover!.mode === "cell" ? hover!.col : 0)}
                onClick={(e) => hover!.mode === "cell" && handleColPillClick(e, hover!.col)}
            ><svg width="14" height="10" viewBox="0 0 14 10" fill="none"><path d="M4 1h6M4 5h6M4 9h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg></div>}
            {rowPillStyle && <div className="tb-pill" style={rowPillStyle}
                onPointerEnter={cancelHoverLeave}
                onPointerDown={(e) => handlePillPointerDown(e, "row", hover!.mode === "cell" ? hover!.row : 0)}
                onPointerMove={(e) => handlePillPointerMove(e, "row", hover!.mode === "cell" ? hover!.row : 0)}
                onPointerUp={(e) => handlePillPointerUp(e, "row", hover!.mode === "cell" ? hover!.row : 0)}
                onClick={(e) => hover!.mode === "cell" && handleRowPillClick(e, hover!.row)}
            ><svg width="10" height="14" viewBox="0 0 10 14" fill="none"><path d="M1 4v6M5 4v6M9 4v6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg></div>}
            {lineVStyle && createPortal(
                <div className="tb-line-handle tb-line-v" style={lineVStyle} onPointerEnter={cancelHoverLeave}>
                    <button className="tb-line-plus" style={{ position: "absolute", top: "50%", left: -11, width: 22, height: 22, marginTop: -11 }}
                        onPointerEnter={cancelHoverLeave}
                        onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); handleInsertCol(hover!.mode === "lineV" ? hover!.boundary : 0); }}>+</button>
                </div>,
                document.body
            )}
            {lineHStyle && createPortal(
                <div className="tb-line-handle tb-line-h" style={lineHStyle} onPointerEnter={cancelHoverLeave}>
                    <button className="tb-line-plus" style={{ position: "absolute", left: "50%", top: -11, width: 22, height: 22, marginLeft: -11 }}
                        onPointerEnter={cancelHoverLeave}
                        onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); handleInsertRow(hover!.mode === "lineH" ? hover!.boundary : 0); }}>+</button>
                </div>,
                document.body
            )}
            {dragPreviewStyle && createPortal(
                <div className="tb-drag-preview" style={dragPreviewStyle}>{dragLabel}</div>,
                document.body
            )}
            {dropIndicatorStyle && createPortal(
                <div className="tb-drop-indicator" style={dropIndicatorStyle} />,
                document.body
            )}
            {colActionsEl}
            {rowActionsEl}
        </>
    );
}
