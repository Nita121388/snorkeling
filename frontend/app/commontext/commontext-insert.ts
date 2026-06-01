// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

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
