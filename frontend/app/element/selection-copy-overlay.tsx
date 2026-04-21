// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef, useState } from "react";

const SelectionCopyButtonSize = 24;
const SelectionCopyButtonMargin = 8;
const SelectionCopyFeedbackMs = 900;

export type SelectionCopyOverlayState = {
    x: number;
    y: number;
    text: string;
};

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

export function clampSelectionCopyOverlayPosition(
    containerWidth: number,
    containerHeight: number,
    desiredX: number,
    desiredY: number
): Pick<SelectionCopyOverlayState, "x" | "y"> {
    const maxX = Math.max(
        SelectionCopyButtonMargin,
        containerWidth - SelectionCopyButtonSize - SelectionCopyButtonMargin
    );
    const maxY = Math.max(
        SelectionCopyButtonMargin,
        containerHeight - SelectionCopyButtonSize - SelectionCopyButtonMargin
    );
    return {
        x: clamp(desiredX, SelectionCopyButtonMargin, maxX),
        y: clamp(desiredY, SelectionCopyButtonMargin, maxY),
    };
}

type SelectionCopyOverlayProps = {
    overlay: SelectionCopyOverlayState | null;
    onHide?: () => void;
};

export function SelectionCopyOverlay({ overlay, onHide }: SelectionCopyOverlayProps) {
    const [copied, setCopied] = useState(false);
    const copiedTimerRef = useRef<number | null>(null);

    useEffect(() => {
        setCopied(false);
        return () => {
            if (copiedTimerRef.current != null) {
                window.clearTimeout(copiedTimerRef.current);
                copiedTimerRef.current = null;
            }
        };
    }, [overlay?.x, overlay?.y, overlay?.text]);

    if (overlay == null || overlay.text.length === 0) {
        return null;
    }

    const handleCopyClick = async () => {
        await navigator.clipboard.writeText(overlay.text);
        setCopied(true);
        if (copiedTimerRef.current != null) {
            window.clearTimeout(copiedTimerRef.current);
        }
        copiedTimerRef.current = window.setTimeout(() => {
            setCopied(false);
            onHide?.();
            copiedTimerRef.current = null;
        }, SelectionCopyFeedbackMs);
    };

    return (
        <button
            type="button"
            className="absolute z-[1500] flex h-6 w-6 items-center justify-center rounded border border-border bg-modalbg/95 text-[11px] text-secondary shadow-md transition-colors hover:bg-hoverbg hover:text-white"
            style={{ left: `${overlay.x}px`, top: `${overlay.y}px` }}
            title={copied ? "Copied" : "Copy"}
            tabIndex={-1}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => void handleCopyClick()}
        >
            <i className={copied ? "fa fa-solid fa-check" : "fa fa-regular fa-copy"} />
        </button>
    );
}
