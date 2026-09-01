// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Table toolbar (方案 04 §1): shown above the inline-edit overlay while editing a table
 * block. Row ops act on the caret's row, column ops on the caret's column, alignment
 * cycles the caret column's separator cell. Pure ops live in markdown-transform/table.ts.
 */

import { createPortal } from "react-dom";
import type { TableAlign } from "../../markdown-transform/table";

export type TableOp =
    | { type: "insert-row" }
    | { type: "delete-row" }
    | { type: "insert-col"; side: "left" | "right" }
    | { type: "delete-col" }
    | { type: "align"; align: TableAlign };

export interface TableToolbarProps {
    anchor: { top: number; left: number };
    /** Current alignment of the caret's column (for active-state styling). */
    currentAlign?: TableAlign | "default" | null;
    /** False when the caret isn't on a table row (buttons disabled). */
    contextValid: boolean;
    onOp: (op: TableOp) => void;
}

function Btn({
    label,
    title,
    disabled,
    active,
    onClick,
}: {
    label: string;
    title: string;
    disabled?: boolean;
    active?: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            className={"markdown-toolbar-btn" + (active ? " is-active" : "")}
            title={title}
            disabled={disabled}
            onClick={onClick}
        >
            {label}
        </button>
    );
}

export function TableToolbar({ anchor, currentAlign, contextValid, onOp }: TableToolbarProps) {
    const stopMouse = (e: React.MouseEvent) => e.preventDefault();
    return createPortal(
        <div className="markdown-floating-toolbar markdown-table-toolbar" style={{ top: anchor.top, left: anchor.left }} onMouseDown={stopMouse}>
            <Btn label="+ Row" title="Insert row below" disabled={!contextValid} onClick={() => onOp({ type: "insert-row" })} />
            <Btn label="− Row" title="Delete row" disabled={!contextValid} onClick={() => onOp({ type: "delete-row" })} />
            <span className="markdown-toolbar-divider" />
            <Btn label="+ Col" title="Insert column to the right" disabled={!contextValid} onClick={() => onOp({ type: "insert-col", side: "right" })} />
            <Btn label="− Col" title="Delete column" disabled={!contextValid} onClick={() => onOp({ type: "delete-col" })} />
            <span className="markdown-toolbar-divider" />
            <Btn
                label="⇤"
                title="Align left"
                disabled={!contextValid}
                active={currentAlign === "left"}
                onClick={() => onOp({ type: "align", align: "left" })}
            />
            <Btn
                label="⇹"
                title="Align center"
                disabled={!contextValid}
                active={currentAlign === "center"}
                onClick={() => onOp({ type: "align", align: "center" })}
            />
            <Btn
                label="⇥"
                title="Align right"
                disabled={!contextValid}
                active={currentAlign === "right"}
                onClick={() => onOp({ type: "align", align: "right" })}
            />
        </div>,
        document.body
    );
}
