// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef, useState } from "react";
import {
    clampSelectionCopyOverlayPosition,
    getCopyContextTextFromDom,
    makeCopyContextMenuItem,
    SelectionCopyOverlay,
    type SelectionCopyOverlayState,
} from "./selection-copy-overlay";

const CopySelectionMinLength = 1;
const RecentCopyWindowMs = 45_000;
const PasteHintDelayMs = 150;
const PasteHintDisableStorageKey = "snorkeling:paste-hint:disabled";

type FloatPos = {
    x: number;
    y: number;
};

type PasteHintState = FloatPos & {
    target: HTMLElement;
};

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function getSelectionText(): string {
    const sel = window.getSelection();
    if (sel == null) {
        return "";
    }
    return sel.toString() ?? "";
}

function isEditableTarget(target: EventTarget | null): target is HTMLElement {
    if (!(target instanceof HTMLElement)) {
        return false;
    }
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        return true;
    }
    if (target.isContentEditable) {
        return true;
    }
    return false;
}

function shouldShowPasteHintForTarget(target: EventTarget | null): target is HTMLElement {
    if (!isEditableTarget(target)) {
        return false;
    }
    // xterm already has dedicated paste flow and we should avoid noisy overlays there.
    if (target.classList.contains("xterm-helper-textarea")) {
        return false;
    }
    return true;
}

function insertTextAtEditableTarget(target: HTMLElement, text: string): void {
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        const start = target.selectionStart ?? target.value.length;
        const end = target.selectionEnd ?? start;
        target.focus();
        target.setRangeText(text, start, end, "end");
        target.dispatchEvent(new Event("input", { bubbles: true }));
        return;
    }
    if (!target.isContentEditable) {
        return;
    }
    target.focus();
    const selection = window.getSelection();
    if (selection == null || selection.rangeCount === 0) {
        document.execCommand("insertText", false, text);
        return;
    }
    const range = selection.getRangeAt(0);
    range.deleteContents();
    const textNode = document.createTextNode(text);
    range.insertNode(textNode);
    range.setStartAfter(textNode);
    range.setEndAfter(textNode);
    selection.removeAllRanges();
    selection.addRange(range);
    target.dispatchEvent(new Event("input", { bubbles: true }));
}

function readPasteHintDisabled(): boolean {
    try {
        return localStorage.getItem(PasteHintDisableStorageKey) === "1";
    } catch {
        return false;
    }
}

function writePasteHintDisabled(value: boolean): void {
    try {
        if (value) {
            localStorage.setItem(PasteHintDisableStorageKey, "1");
        } else {
            localStorage.removeItem(PasteHintDisableStorageKey);
        }
    } catch {
        // ignore storage failures
    }
}

export function ClipboardFloatActions() {
    const [copyPos, setCopyPos] = useState<SelectionCopyOverlayState | null>(null);
    const [pasteHint, setPasteHint] = useState<PasteHintState>(null);
    const [pasteHintDisabled, setPasteHintDisabled] = useState<boolean>(() => readPasteHintDisabled());

    const pasteHintTimerRef = useRef<number>(null);
    const lastCopyAtRef = useRef<number>(0);
    const pendingPointerRef = useRef<FloatPos>(null);
    const pasteHintBubbleRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        return () => {
            if (pasteHintTimerRef.current != null) {
                window.clearTimeout(pasteHintTimerRef.current);
            }
        };
    }, []);

    useEffect(() => {
        const recordCopy = () => {
            lastCopyAtRef.current = Date.now();
        };
        document.addEventListener("copy", recordCopy, true);
        return () => document.removeEventListener("copy", recordCopy, true);
    }, []);

    useEffect(() => {
        const updateCopyButton = () => {
            const selection = window.getSelection();
            if (selection == null || selection.rangeCount === 0 || selection.isCollapsed) {
                setCopyPos(null);
                return;
            }
            const text = getSelectionText();
            if (text.length < CopySelectionMinLength) {
                setCopyPos(null);
                return;
            }
            const rect = selection.getRangeAt(0).getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) {
                setCopyPos(null);
                return;
            }
            const position = clampSelectionCopyOverlayPosition(
                window.innerWidth,
                window.innerHeight,
                rect.right + 8,
                rect.bottom + 8
            );
            setCopyPos({
                ...position,
                text,
                contextText: getCopyContextTextFromDom(selection),
            });
        };

        const hideCopyButton = () => {
            setCopyPos(null);
        };

        document.addEventListener("selectionchange", updateCopyButton);
        document.addEventListener("mouseup", updateCopyButton);
        document.addEventListener("keyup", updateCopyButton);
        document.addEventListener("scroll", hideCopyButton, true);
        window.addEventListener("resize", hideCopyButton);

        return () => {
            document.removeEventListener("selectionchange", updateCopyButton);
            document.removeEventListener("mouseup", updateCopyButton);
            document.removeEventListener("keyup", updateCopyButton);
            document.removeEventListener("scroll", hideCopyButton, true);
            window.removeEventListener("resize", hideCopyButton);
        };
    }, []);

    useEffect(() => {
        const clearPasteHintTimer = () => {
            if (pasteHintTimerRef.current != null) {
                window.clearTimeout(pasteHintTimerRef.current);
                pasteHintTimerRef.current = null;
            }
        };

        const onMouseDown = (event: MouseEvent) => {
            const target = event.target as Node | null;
            if (target != null && pasteHintBubbleRef.current?.contains(target)) {
                return;
            }
            setPasteHint(null);
            if (shouldShowPasteHintForTarget(event.target)) {
                pendingPointerRef.current = { x: event.clientX, y: event.clientY };
            } else {
                pendingPointerRef.current = null;
            }
        };

        const onFocusIn = (event: FocusEvent) => {
            clearPasteHintTimer();
            if (pasteHintDisabled) {
                return;
            }
            if (!shouldShowPasteHintForTarget(event.target)) {
                return;
            }
            if (Date.now() - lastCopyAtRef.current > RecentCopyWindowMs) {
                return;
            }
            const target = event.target as HTMLElement;
            pasteHintTimerRef.current = window.setTimeout(() => {
                if (document.activeElement !== target) {
                    return;
                }
                if (Date.now() - lastCopyAtRef.current > RecentCopyWindowMs) {
                    return;
                }
                const point = pendingPointerRef.current;
                const rect = target.getBoundingClientRect();
                const x = clamp(point?.x ?? rect.left + 10, 8, window.innerWidth - 112);
                const y = clamp((point?.y ?? rect.top) + 12, 8, window.innerHeight - 40);
                setPasteHint({ x, y, target });
            }, PasteHintDelayMs);
        };

        const dismissPasteHint = () => {
            setPasteHint(null);
            clearPasteHintTimer();
        };

        document.addEventListener("mousedown", onMouseDown, true);
        document.addEventListener("focusin", onFocusIn, true);
        document.addEventListener("keydown", dismissPasteHint, true);
        document.addEventListener("input", dismissPasteHint, true);
        document.addEventListener("scroll", dismissPasteHint, true);
        window.addEventListener("resize", dismissPasteHint);

        return () => {
            clearPasteHintTimer();
            document.removeEventListener("mousedown", onMouseDown, true);
            document.removeEventListener("focusin", onFocusIn, true);
            document.removeEventListener("keydown", dismissPasteHint, true);
            document.removeEventListener("input", dismissPasteHint, true);
            document.removeEventListener("scroll", dismissPasteHint, true);
            window.removeEventListener("resize", dismissPasteHint);
        };
    }, [pasteHintDisabled]);

    const hideCopyButton = () => {
        setCopyPos(null);
    };

    const recordOverlayCopy = () => {
        lastCopyAtRef.current = Date.now();
    };

    const handlePasteClick = async () => {
        if (pasteHint == null || pasteHint.target == null) {
            return;
        }
        const text = await navigator.clipboard.readText();
        if (text == null) {
            return;
        }
        insertTextAtEditableTarget(pasteHint.target, text);
        setPasteHint(null);
    };

    const handleDisablePasteHint = () => {
        writePasteHintDisabled(true);
        setPasteHintDisabled(true);
        setPasteHint(null);
    };

    return (
        <>
            <SelectionCopyOverlay
                overlay={copyPos}
                position="fixed"
                onHide={hideCopyButton}
                onCopied={recordOverlayCopy}
                copyMenuItems={
                    copyPos?.contextText ? [makeCopyContextMenuItem(copyPos.contextText, recordOverlayCopy)] : undefined
                }
            />
            {pasteHint && (
                <div
                    ref={pasteHintBubbleRef}
                    className="fixed z-[1500] flex items-center gap-1 rounded border border-border bg-modalbg/95 px-1 py-0.5 shadow-md"
                    style={{ left: `${pasteHint.x}px`, top: `${pasteHint.y}px` }}
                    onMouseDown={(e) => e.preventDefault()}
                >
                    <button
                        type="button"
                        className="h-5 rounded px-1.5 text-[11px] text-secondary hover:bg-hoverbg hover:text-white transition-colors"
                        title="Paste"
                        onClick={() => void handlePasteClick()}
                    >
                        <i className="fa fa-regular fa-paste mr-1" />
                        Paste
                    </button>
                    <button
                        type="button"
                        className="h-5 w-5 rounded text-[10px] text-secondary hover:bg-hoverbg hover:text-white transition-colors"
                        title="Don't show this paste hint again"
                        onClick={handleDisablePasteHint}
                    >
                        <i className="fa fa-solid fa-eye-slash" />
                    </button>
                </div>
            )}
        </>
    );
}
