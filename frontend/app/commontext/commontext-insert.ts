// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getBlockComponentModel, getFocusedBlockId } from "@/app/store/global";
import type { TermViewModel } from "@/app/view/term/term-model";

export function isEditableElement(target: Element | null): target is HTMLElement {
    if (!(target instanceof HTMLElement)) {
        return false;
    }
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        return true;
    }
    return target.isContentEditable;
}

export function getCurrentEditableElement(): HTMLElement | null {
    const activeElement = document.activeElement;
    return isEditableElement(activeElement) ? activeElement : null;
}

export function insertTextAtEditableElement(target: HTMLElement, text: string): boolean {
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        const start = target.selectionStart ?? target.value.length;
        const end = target.selectionEnd ?? start;
        target.focus();
        target.setRangeText(text, start, end, "end");
        target.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
    }
    if (!target.isContentEditable) {
        return false;
    }
    target.focus();
    const selection = window.getSelection();
    if (selection == null || selection.rangeCount === 0) {
        document.execCommand("insertText", false, text);
        return true;
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
    return true;
}

export async function copyCommonText(text: string): Promise<void> {
    await navigator.clipboard.writeText(text);
}

export async function insertOrCopyCommonText(
    text: string,
    target?: HTMLElement | null
): Promise<"inserted" | "copied"> {
    const insertTarget = target ?? getCurrentEditableElement();
    if (insertTarget != null && insertTextAtEditableElement(insertTarget, text)) {
        return "inserted";
    }
    await copyCommonText(text);
    return "copied";
}

/**
 * Paste the given text into the terminal identified by `viewModel` using xterm's
 * own `paste` path. This is the same mechanism `termwrap.ts` uses for clipboard
 * paste (see `this.terminal.paste(data.text)`), so it correctly routes through
 * the PTY (bracketed paste, shell integration, etc.). Returns false if the
 * term doesn't currently have a live TermWrap instance.
 */
export function insertTextIntoTerm(viewModel: TermViewModel, text: string): boolean {
    const termWrap = viewModel.termRef?.current;
    if (termWrap?.terminal == null) {
        return false;
    }
    termWrap.terminal.paste(text);
    return true;
}

/**
 * Unified insert entry point. Inspects the current focused element:
 *   - input / textarea / contenteditable → insert at caret via setRangeText / Range
 *   - focused block is a terminal          → xterm `terminal.paste`
 *
 * Returns true if inserted. Callers that need a fallback (e.g. copy to clipboard
 * when nothing is focusable) should pass `text` to `copyCommonText` themselves.
 */
export function insertTextIntoFocused(text: string): boolean {
    const target = getCurrentEditableElement();
    if (target != null && insertTextAtEditableElement(target, text)) {
        return true;
    }
    const blockId = getFocusedBlockId();
    const bcm = blockId != null ? getBlockComponentModel(blockId) : null;
    const viewModel = bcm?.viewModel;
    if (viewModel != null && viewModel.viewType === "term") {
        return insertTextIntoTerm(viewModel as TermViewModel, text);
    }
    return false;
}

/**
 * Send `text` straight to a terminal block, bypassing any input/textarea that
 * currently holds DOM focus (e.g. the Compose modal's own editor). `candidates`
 * is an ordered list of term-block ids to try: callers put the focused term
 * first, then fallbacks for when focus isn't on a terminal or the focused
 * block's `TermWrap` isn't live yet (newly created panel, view transition,
 * etc. — see comment on `insertTextIntoTerm`). Returns the blockId that
 * actually received the text, or null if none of the candidates had a live
 * terminal — callers surface this so the failure is never silent.
 */
export function sendTextToFocusedTerm(text: string, candidates: string[]): string | null {
    const list = Array.isArray(candidates) ? candidates : candidates == null ? [] : [candidates];
    for (const blockId of list) {
        if (blockId == null) continue;
        const bcm = getBlockComponentModel(blockId);
        const viewModel = bcm?.viewModel;
        if (viewModel != null && viewModel.viewType === "term") {
            if (insertTextIntoTerm(viewModel as TermViewModel, text)) {
                return blockId;
            }
        }
    }
    return null;
}
