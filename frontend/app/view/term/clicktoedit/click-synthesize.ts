// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Host-side "click to position cursor" synthesis for TUI agents that do not
// support mouse reporting themselves (codex / pi / opencode, unlike Claude
// fullscreen or Grok Build which implement it natively).
//
// Strategy: translate a click inside the terminal into a key sequence
// (Home + Right×N, optionally UP/DOWN to switch lines) that the agent's own
// input buffer understands, then inject it into the PTY. This is approximate
// by design — exactness is bounded by the agent's internal cursor model
// (see clicktoedit/README.md for precision expectations and limits).

// ANSI key sequences recognized by crossterm / ink / ratatui text inputs.
export const KEY_HOME = "\x1b[H";
export const KEY_UP = "\x1b[A";
export const KEY_DOWN = "\x1b[B";
export const KEY_RIGHT = "\x1b[C";

export interface TermCell {
    row: number; // 0-based buffer row
    col: number; // 0-based buffer column
}

export interface CellDims {
    cw: number; // css px per cell column
    ch: number; // css px per cell row
}

/** Query the xterm renderer's cell dimensions (css px). Falls back to a
 *  geometric estimate from the container rect when the internal viewport is
 *  unavailable (private API, tolerate absence). */
export function getCellDims(terminal: unknown, containerRect: DOMRectReadOnly | DOMRect): CellDims {
    const vp = (terminal as { _core?: { viewport?: { dimensions?: CellDims } } })?._core?.viewport;
    const d = vp?.dimensions;
    if (d != null && d.cw > 0 && d.ch > 0 && Number.isFinite(d.cw) && Number.isFinite(d.ch)) {
        return { cw: d.cw, ch: d.ch };
    }
    // Fallback: derive from container geometry (accurate when the xterm canvas
    // fills the container edge-to-edge; small padding shifts are tolerated).
    const cols = (terminal as { cols?: number })?.cols ?? 80;
    const rows = (terminal as { rows?: number })?.rows ?? 24;
    return {
        cw: containerRect.width / Math.max(1, cols),
        ch: containerRect.height / Math.max(1, rows),
    };
}

/** Translate a client (viewport-relative) coordinate into a terminal buffer
 *  cell. Returns null when the click is outside the terminal area. */
export function cellFromClientXY(
    terminal: unknown,
    containerRect: DOMRectReadOnly | DOMRect,
    clientX: number,
    clientY: number
): TermCell | null {
    if (clientX < containerRect.left || clientX >= containerRect.right || clientY < containerRect.top || clientY >= containerRect.bottom) {
        return null;
    }
    const { cw, ch } = getCellDims(terminal, containerRect);
    const cols = (terminal as { cols?: number })?.cols ?? 80;
    const rows = (terminal as { rows?: number })?.rows ?? 24;
    const col = Math.floor((clientX - containerRect.left) / cw);
    const row = Math.floor((clientY - containerRect.top) / ch);
    return {
        row: Math.max(0, Math.min(rows - 1, row)),
        col: Math.max(0, Math.min(cols - 1, col)),
    };
}

/** Plan a key sequence that moves the agent's input cursor from its current
 *  cell to `target`. Line switching first, then Home + Right within the target
 *  line. `target.col` of 0 yields just Home (start of line). */
export function planCursorMoveKeys(cursorRow: number, cursorCol: number, target: TermCell): string {
    let keys = "";
    if (target.row !== cursorRow) {
        const delta = target.row - cursorRow;
        const dir = delta > 0 ? KEY_DOWN : KEY_UP;
        keys += dir.repeat(Math.abs(delta));
    }
    keys += KEY_HOME;
    keys += KEY_RIGHT.repeat(Math.max(0, target.col));
    return keys;
}

/** Convert a click into an injectable key sequence, or null when the click is
 *  outside the terminal area. Callers apply their own activation guard
 *  (modifier held, agent provider, mouse mode) before injecting. */
export function synthesizeClickKeys(input: {
    terminal: unknown;
    containerRect: DOMRectReadOnly | DOMRect;
    clientX: number;
    clientY: number;
    cursorRow: number;
    cursorCol: number;
}): string | null {
    const cell = cellFromClientXY(input.terminal, input.containerRect, input.clientX, input.clientY);
    if (cell == null) {
        return null;
    }
    return planCursorMoveKeys(input.cursorRow, input.cursorCol, cell);
}
