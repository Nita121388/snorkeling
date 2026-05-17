// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { ContextMenuModel } from "@/app/store/contextmenu";
import { fireAndForget } from "@/util/util";
import { useEffect, useRef, useState } from "react";
import { parseFileReference } from "./selection-reference-parser";
import { searchSelectionInFiles } from "./selection-search-in-files";

const SelectionCopyButtonSize = 24;
const SelectionCopyButtonMargin = 8;
const SelectionCopyFeedbackMs = 900;

export type SelectionCopyOverlayState = {
    x: number;
    y: number;
    text: string;
    contextText?: string;
};

export type SelectionQuickActionItem = ContextMenuItem;

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
    position?: "absolute" | "fixed";
    onHide?: () => void;
    onCopied?: () => void;
    extraMenuItems?: SelectionQuickActionItem[];
};

export function makeSelectionQuickActionMenu(
    text: string,
    options?: {
        onCopied?: () => void;
        onHide?: () => void;
        extraMenuItems?: SelectionQuickActionItem[];
    }
): ContextMenuItem[] {
    const handleCopyClick = async (): Promise<void> => {
        await navigator.clipboard.writeText(text);
        options?.onCopied?.();
        options?.onHide?.();
    };

    const handleSearchInFiles = async (): Promise<void> => {
        await searchSelectionInFilesText(text);
        options?.onHide?.();
    };

    const menu: ContextMenuItem[] = [
        {
            label: "Copy",
            click: () => {
                fireAndForget(handleCopyClick);
            },
        },
        {
            label: "Search In Files",
            click: () => {
                fireAndForget(handleSearchInFiles);
            },
        },
    ];
    if (options?.extraMenuItems != null && options.extraMenuItems.length > 0) {
        menu.push({ type: "separator" }, ...options.extraMenuItems);
    }
    return menu;
}

export function makeSelectionSearchInFilesMenuItem(text: string): ContextMenuItem {
    return {
        label: "Search In Files",
        click: () => {
            fireAndForget(() => searchSelectionInFilesText(text));
        },
    };
}

async function searchSelectionInFilesText(text: string): Promise<void> {
    const reference = parseFileReference(text);
    if (reference == null) {
        window.alert("No file reference found in the selected text.");
        return;
    }
    await searchSelectionInFiles(reference);
}

export function SelectionCopyOverlay({
    overlay,
    position = "absolute",
    onHide,
    onCopied,
    extraMenuItems,
}: SelectionCopyOverlayProps) {
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

    const handleCopiedFeedback = () => {
        onCopied?.();
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

    const handleQuickActionsClick = (event: React.MouseEvent<HTMLButtonElement>): void => {
        const menu = makeSelectionQuickActionMenu(overlay.text, {
            onCopied: handleCopiedFeedback,
            extraMenuItems,
        });
        ContextMenuModel.getInstance().showContextMenu(menu, event);
    };

    return (
        <button
            type="button"
            className={`${position} z-[1500] flex h-6 w-6 items-center justify-center rounded border border-border bg-modalbg/95 text-[11px] text-secondary shadow-md transition-colors hover:bg-hoverbg hover:text-white`}
            style={{ left: `${overlay.x}px`, top: `${overlay.y}px` }}
            title={copied ? "Copied" : "Quick actions"}
            tabIndex={-1}
            onMouseDown={(e) => e.preventDefault()}
            onClick={handleQuickActionsClick}
        >
            <i className={copied ? "fa fa-solid fa-check" : "fa fa-regular fa-lightbulb"} />
        </button>
    );
}
