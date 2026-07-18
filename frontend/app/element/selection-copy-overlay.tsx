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
const CommonTextFeedbackMs = 1600;
const QuickActionsHoverDelayMs = 120;

export type SelectionCopyOverlayState = {
    x: number;
    y: number;
    text: string;
    contextText?: string;
};

export type SelectionQuickActionItem = ContextMenuItem;

export function buildCopyContextText(filePath: string, sourceLine: number, text: string): string {
    return `${filePath}:${sourceLine}\n\`\`\`markdown\n${text}\n\`\`\``;
}

function getElementFromNode(node: Node | null): HTMLElement | null {
    if (typeof HTMLElement !== "undefined" && node instanceof HTMLElement) {
        return node;
    }
    return node?.parentElement ?? null;
}

function getClosestCopyContextRoot(node: Node | null): HTMLElement | null {
    return getElementFromNode(node)?.closest<HTMLElement>("[data-copy-context-path]") ?? null;
}

function getClosestSourceLineElement(node: Node | null): HTMLElement | null {
    return getElementFromNode(node)?.closest<HTMLElement>("[data-source-line]") ?? null;
}

export function getCopyContextTextFromDom(selection: Selection | null, target?: EventTarget | null): string | null {
    const range = selection != null && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    const sourceNode = range?.startContainer ?? (typeof Node !== "undefined" && target instanceof Node ? target : null);
    const root = getClosestCopyContextRoot(sourceNode);
    if (root == null) {
        return null;
    }

    const sourceLineElement = getClosestSourceLineElement(sourceNode);
    const sourceLine = Number(sourceLineElement?.dataset.sourceLine);
    if (!Number.isInteger(sourceLine) || sourceLine < 1) {
        return null;
    }

    const text =
        selection != null && !selection.isCollapsed ? selection.toString() : (sourceLineElement?.textContent ?? "");
    if (text.trim().length === 0) {
        return null;
    }

    const filePath = root.dataset.copyContextPath;
    if (filePath == null || filePath.length === 0) {
        return null;
    }
    return buildCopyContextText(filePath, sourceLine, text);
}

export function makeCopyContextMenuItem(contextText: string, onCopied?: () => void): ContextMenuItem {
    return {
        label: "Copy Context",
        click: () => {
            fireAndForget(async () => {
                await navigator.clipboard.writeText(contextText);
                onCopied?.();
            });
        },
    };
}

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
    copyMenuItems?: SelectionQuickActionItem[];
    extraMenuItems?: SelectionQuickActionItem[];
};

export function makeSelectionQuickActionMenu(
    text: string,
    options?: {
        onCopied?: () => void;
        onHide?: () => void;
        copyMenuItems?: SelectionQuickActionItem[];
        extraMenuItems?: SelectionQuickActionItem[];
        onCommonTextFeedback?: (msg: string, kind: string) => void;
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

    const handleAddCommonText = (onCommonTextFeedback: (msg: string, kind: string) => void): void => {
        fireAndForget(async () => {
            try {
                await addSelectionToCommonText(text);
                onCommonTextFeedback("Saved", "success");
            } catch (e) {
                const message = e instanceof Error ? e.message : String(e);
                onCommonTextFeedback(
                    message.startsWith("Common text already exists") ? "Already exists" : "Failed to save",
                    "error"
                );
            }
            options?.onHide?.();
        });
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
        ...(options?.copyMenuItems ?? []),
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
                handleAddCommonText((msg, kind) => options?.onCommonTextFeedback?.(msg, kind));
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
    copyMenuItems,
    extraMenuItems,
}: SelectionCopyOverlayProps) {
    const [copied, setCopied] = useState(false);
    const [commonTextFeedback, setCommonTextFeedback] = useState<{ msg: string; kind: string } | null>(null);
    const copiedTimerRef = useRef<number | null>(null);
    const commonTextTimerRef = useRef<number | null>(null);
    const quickActionsHoverTimerRef = useRef<number | null>(null);
    const quickActionsMenuOpenRef = useRef(false);

    useEffect(() => {
        setCopied(false);
        setCommonTextFeedback(null);
        quickActionsMenuOpenRef.current = false;
        return () => {
            if (copiedTimerRef.current != null) {
                window.clearTimeout(copiedTimerRef.current);
                copiedTimerRef.current = null;
            }
            if (commonTextTimerRef.current != null) {
                window.clearTimeout(commonTextTimerRef.current);
                commonTextTimerRef.current = null;
            }
            if (quickActionsHoverTimerRef.current != null) {
                window.clearTimeout(quickActionsHoverTimerRef.current);
                quickActionsHoverTimerRef.current = null;
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

    const handleCommonTextFeedback = (msg: string, kind: string) => {
        setCommonTextFeedback({ msg, kind });
        if (commonTextTimerRef.current != null) {
            window.clearTimeout(commonTextTimerRef.current);
        }
        commonTextTimerRef.current = window.setTimeout(() => {
            setCommonTextFeedback(null);
            commonTextTimerRef.current = null;
        }, CommonTextFeedbackMs);
    };

    const showQuickActionsMenu = (event: React.MouseEvent<HTMLButtonElement>): void => {
        if (quickActionsMenuOpenRef.current) {
            return;
        }
        quickActionsMenuOpenRef.current = true;
        const menu = makeSelectionQuickActionMenu(overlay.text, {
            onCopied: handleCopiedFeedback,
            onCommonTextFeedback: handleCommonTextFeedback,
            copyMenuItems,
            extraMenuItems,
        });
        ContextMenuModel.getInstance().showContextMenu(menu, event, {
            onClose: () => {
                quickActionsMenuOpenRef.current = false;
            },
        });
    };

    const clearQuickActionsHoverTimer = (): void => {
        if (quickActionsHoverTimerRef.current == null) {
            return;
        }
        window.clearTimeout(quickActionsHoverTimerRef.current);
        quickActionsHoverTimerRef.current = null;
    };

    const handleQuickActionsMouseEnter = (event: React.MouseEvent<HTMLButtonElement>): void => {
        if (quickActionsMenuOpenRef.current || quickActionsHoverTimerRef.current != null) {
            return;
        }
        quickActionsHoverTimerRef.current = window.setTimeout(() => {
            quickActionsHoverTimerRef.current = null;
            showQuickActionsMenu(event);
        }, QuickActionsHoverDelayMs);
    };

    const handleQuickActionsMouseDown = (event: React.MouseEvent<HTMLButtonElement>): void => {
        clearQuickActionsHoverTimer();
        event.preventDefault();
    };

    const handleQuickActionsClick = (event: React.MouseEvent<HTMLButtonElement>): void => {
        clearQuickActionsHoverTimer();
        showQuickActionsMenu(event);
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

    const feedbackBubbleClassName =
        commonTextFeedback != null
            ? [
                  position,
                  "z-[1501]",
                  "whitespace-nowrap rounded-md px-3 py-1 text-xs leading-none shadow-md",
                  "pointer-events-none select-none",
                  commonTextFeedback.kind === "success"
                      ? "bg-accent/15 text-accent border border-accent/30"
                      : commonTextFeedback.kind === "warn"
                        ? "bg-amber-600/15 text-amber-600/90 border border-amber-600/30"
                        : "bg-error/15 text-error border border-error/30",
              ].join(" ")
            : null;

    return (
        <>
            <button
                type="button"
                data-selection-quick-action="true"
                className={quickActionButtonClassName}
                style={{ left: `${overlay.x}px`, top: `${overlay.y}px` }}
                title={copied ? "Copied" : "Quick actions"}
                tabIndex={-1}
                onMouseEnter={handleQuickActionsMouseEnter}
                onMouseLeave={clearQuickActionsHoverTimer}
                onMouseDown={handleQuickActionsMouseDown}
                onClick={handleQuickActionsClick}
            >
                <i className={copied ? "fa fa-solid fa-check" : "fa fa-regular fa-lightbulb"} />
            </button>
            {commonTextFeedback != null && (
                <div
                    className={feedbackBubbleClassName}
                    style={{
                        left: `${overlay.x}px`,
                        top: `${overlay.y + 28}px`,
                    }}
                >
                    {commonTextFeedback.kind === "success" && <i className="fa-solid fa-check mr-1" />}
                    {commonTextFeedback.kind === "warn" && <i className="fa-solid fa-rotate mr-1" />}
                    {commonTextFeedback.kind === "error" && <i className="fa-solid fa-xmark mr-1" />}
                    {commonTextFeedback.msg}
                </div>
            )}
        </>
    );
}
