// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { openCommonTextSearch } from "@/app/commontext/commontext-events";
import { addSelectionToCommonText, getCommonTextItems, openCommonTextManager } from "@/app/commontext/commontext-model";
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

    const handleAddCommonText = async (): Promise<void> => {
        try {
            await addSelectionToCommonText(text);
        } catch (e) {
            window.alert(e instanceof Error ? e.message : String(e));
        }
        options?.onHide?.();
    };

    const handleFindCommonText = (): void => {
        openCommonTextSearch({ query: text.slice(0, 120), mode: "copy" });
        options?.onHide?.();
    };

    const commonTextItems = getCommonTextItems();

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
        { type: "separator" },
        {
            label: "Add Selection to Common Text",
            click: () => {
                fireAndForget(handleAddCommonText);
            },
        },
        {
            label: "Find Related Common Text",
            enabled: commonTextItems.length > 0,
            click: handleFindCommonText,
        },
        {
            label: "Manage Common Text",
            click: () => {
                fireAndForget(openCommonTextManager);
                options?.onHide?.();
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

    const quickActionButtonClassName = [
        position,
        "z-[1500]",
        "flex h-6 w-6 items-center justify-center rounded",
        "border border-[rgba(255,170,45,0.8)]",
        "bg-[rgba(255,170,45,0.16)]",
        "text-[11px] text-[rgb(255,184,66)]",
        "shadow-md shadow-black/30 transition-colors",
        "hover:border-[rgba(255,197,92,0.95)]",
        "hover:bg-[rgba(255,170,45,0.26)]",
        "hover:text-[rgb(255,213,116)]",
    ].join(" ");

    return (
        <button
            type="button"
            className={quickActionButtonClassName}
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
