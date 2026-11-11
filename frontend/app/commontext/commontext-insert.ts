// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getBlockComponentModel, getFocusedBlockId } from "@/app/store/global";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { stripSessionTagHashes } from "@/app/view/aisessions/session-tags";
import type { TermViewModel } from "@/app/view/term/term-model";
import { stringToBase64 } from "@/util/util";

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
    // 复制时不带走正文里的 #tag 字面：剥掉 #tag 后再写入剪贴板，让 Common Text 的 chip
    // 仅作为编辑/筛选的元数据存在，不会再泄漏到外部输入框/终端/邮件正文里。
    // strip 是恒等 + 额外空格规整的，不带 #tag 的纯正文走过它也安全。
    const cleanText = stripSessionTagHashes(text);
    await navigator.clipboard.writeText(cleanText);
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
 * 注入后补「回车提交」的延时：paste 只把内容放进 TUI 输入框，TUI 需要一点时间吃进 bracketed paste
 * 才会把回车当作提交（太早按会被当成粘贴内容的一部分）。
 */
export const SubmitAfterPasteDelayMs = 150;

/**
 * 向 term 块发一个真正的回车键（经 PTY，同 termsticker / term-model 的按键路径）。
 * CommonText 的语义是「发送」——只 paste 不回车，agent 永远收不到（用户实测 bug）。
 */
export function submitTermInput(blockId: string): void {
    if (blockId == null || blockId === "") return;
    const b64data = stringToBase64("\r");
    RpcApi.ControllerInputCommand(TabRpcClient, { blockid: blockId, inputdata64: b64data }).catch((error) => {
        console.warn("[commontext] submit (enter) failed", { blockId, error });
    });
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
    // Send 与 copy 走同一套 strip 语义：Common Text 的 #tag 是元数据，发到终端时也剥掉，
    // 避免在 shell 里误把 #fix 当注释/参数/裸字符串送出。strip 对不含 #tag 的文本是恒等的。
    const cleanText = stripSessionTagHashes(text);
    const list = Array.isArray(candidates) ? candidates : candidates == null ? [] : [candidates];
    for (const blockId of list) {
        if (blockId == null) continue;
        const bcm = getBlockComponentModel(blockId);
        const viewModel = bcm?.viewModel;
        if (viewModel != null && viewModel.viewType === "term") {
            if (insertTextIntoTerm(viewModel as TermViewModel, cleanText)) {
                // 只 paste 不回车 = agent 收不到。补一个延时提交（见 submitTermInput）。
                window.setTimeout(() => submitTermInput(blockId), SubmitAfterPasteDelayMs);
                return blockId;
            }
        }
    }
    return null;
}
