// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Slash/Toolbar command execution (方案 02 §2.3 + 03 §1.1): compose the in-flight
 * inline-edit draft into the document — with the trigger text stripped — exactly the
 * way useInlineEdit.commit() would, then run the command against that base text. The
 * caller makes ONE handleInlineEditCommit call with the result, keeping every gesture
 * a single diff (and a single undo/autosave step).
 */

import {
    computeFenceSpans,
    detectBlockKind,
    transformBlockType,
    type BlockKind,
} from "../markdown-transform/block-type";
import type { BlockCtx, SlashCommandSpec, SlashCommandRunResult, TextReplaceResult } from "./registry";
import { normalizeSlashCommandResult } from "./registry";

/** The fields of an InlineEditSession that command execution needs (structural, so we
 *  don't import the React hook module at runtime). */
export interface ExecSessionInfo {
    startLine: number;
    endLine: number;
    placeholder?: boolean;
    placeholderInline?: boolean;
    insertMode?: "before" | "after";
}

export interface SlashInvocation {
    session: ExecSessionInfo;
    draftText: string;
    /** 0-based offset of the trigger char inside draftText. */
    triggerStart: number;
    /** 0-based caret offset inside draftText (end of the query). */
    caret: number;
}

export interface ExecResult {
    text: string;
    /** Absolute char offset where the caret should land. */
    caret?: number;
    /** 1-based line of the block to re-focus for continued editing (omitted = none). */
    focusLine?: number;
}

// --- mirror of commitPlaceholderBlock (markdown-inline-edit.tsx) ------------
// Duplicated minimally so exec math stays pure and independent of the hook; the two
// implementations are locked together by exec.test.ts fixtures.
function composePlaceholderBlock(fullText: string, s: number, e: number, draft: string): string {
    const lines = fullText.split(/\r\n|\n/);
    const safeStart = Math.max(1, Math.min(Math.trunc(s), lines.length || 1));
    const safeEnd = Math.max(safeStart, Math.min(Math.trunc(e), lines.length));
    const draftLines = draft.split(/\r\n|\n/);
    const out = [...lines.slice(0, safeStart - 1), ...draftLines, ...lines.slice(safeEnd)];
    let firstIdx = safeStart - 1;
    let lastIdx = firstIdx + draftLines.length - 1;
    if (draftLines.length > 0 && out[firstIdx] !== "" && firstIdx > 0 && out[firstIdx - 1] !== "") {
        out.splice(firstIdx, 0, "");
        firstIdx++;
        lastIdx++;
    }
    if (draftLines.length > 0 && out[lastIdx] !== "" && lastIdx + 1 < out.length && out[lastIdx + 1] !== "") {
        out.splice(lastIdx + 1, 0, "");
    }
    return out.join("\n");
}

/** 1-based line where the composed draft's FIRST line lands. */
export function composeBlockStartLine(session: ExecSessionInfo, fullText: string, draft: string): number {
    if (session.insertMode === "before") {
        return session.startLine;
    }
    if (session.insertMode === "after") {
        return session.endLine + 2; // separator blank lands at endLine+1
    }
    if (session.placeholder && !session.placeholderInline) {
        // commitPlaceholderBlock may push the draft down by one when it needs a front
        // separator blank (content directly above the placeholder row).
        const lines = fullText.split(/\r\n|\n/);
        const above = lines[session.startLine - 2];
        const draftFirst = draft.split(/\r\n|\n/)[0] ?? "";
        if (draftFirst !== "" && above != null && above.trim() !== "") {
            return session.startLine + 1;
        }
    }
    return session.startLine;
}

/** Compose the document as if the session committed `draft` right now. */
export function composeSessionText(fullText: string, session: ExecSessionInfo, draft: string): string {
    const s = session.startLine;
    const e = session.endLine;
    if (session.placeholder) {
        if (session.placeholderInline) {
            return replaceRange(fullText, s, e, draft);
        }
        return composePlaceholderBlock(fullText, s, e, draft);
    }
    if (session.insertMode != null) {
        const lines = fullText.split(/\r\n|\n/);
        const startIdx = Math.max(0, Math.min(s - 1, lines.length));
        const endIdx = Math.max(0, Math.min(e - 1, lines.length));
        const block = session.insertMode === "before" ? [...draft.split("\n"), ""] : ["", ...draft.split("\n")];
        const next = lines.slice();
        next.splice(session.insertMode === "before" ? startIdx : endIdx + 1, 0, ...block);
        return next.join("\n");
    }
    return replaceRange(fullText, s, e, draft);
}

function replaceRange(text: string, s: number, e: number, segment: string): string {
    const lines = text.split(/\r\n|\n/);
    const safeStart = Math.max(1, Math.min(Math.trunc(s), lines.length || 1));
    const safeEnd = Math.max(safeStart, Math.min(Math.trunc(e), lines.length));
    const before = lines.slice(0, safeStart - 1);
    const after = lines.slice(safeEnd);
    const replacement = segment.length > 0 ? segment.split(/\r\n|\n/) : [];
    return [...before, ...replacement, ...after].join("\n");
}

/**
 * Execute a slash command: strip `trigger…caret` from the draft, compose the base text,
 * then run the command with a correct BlockCtx on the (possibly shifted) block.
 *
 * Returns the NORMALIZED discriminated-union result (TextReplaceResult / OpenPickerResult /
 * CompositeResult) — legacy `{ text, caret?, focusLine? }` shapes are wrapped automatically
 * via normalizeSlashCommandResult.
 */
export function execSlashCommand(
    fullText: string,
    inv: SlashInvocation,
    cmd: SlashCommandSpec
): SlashCommandRunResult | null {
    const { session, draftText } = inv;
    const triggerStart = Math.max(0, Math.min(inv.triggerStart, draftText.length));
    const caret = Math.max(triggerStart, Math.min(inv.caret, draftText.length));
    const strippedDraft = draftText.slice(0, triggerStart) + draftText.slice(caret);
    const baseText = composeSessionText(fullText, session, strippedDraft);
    const line = composeBlockStartLine(session, fullText, strippedDraft);
    const baseLines = baseText.split("\n");
    const spans = computeFenceSpans(baseLines);
    const inFence = spans.some((sp) => line >= sp.start && line <= sp.end);
    const kind: BlockKind = detectBlockKind(baseLines, line) ?? "text";
    const ctx: BlockCtx = {
        text: baseText,
        line,
        endLine: line + Math.max(0, strippedDraft.split("\n").length - 1),
        kind,
        nested: /^\s+(?:[-+*]|\d+[.)])\s/.test(baseLines[line - 1] ?? ""),
    };
    if (inFence || kind === "code") {
        return null; // commands never fire with code context (方案 02 §2.4)
    }
    return normalizeSlashCommandResult(cmd.run(ctx));
}

/** Toolbar / keyboard block-type switch while an inline edit session is in flight:
 *  compose the current draft, transform the block, and re-focus the transformed block. */
export function transformSessionBlock(
    fullText: string,
    session: ExecSessionInfo,
    draftText: string,
    to: BlockKind
): TextReplaceResult | null {
    const baseText = composeSessionText(fullText, session, draftText);
    const line = composeBlockStartLine(session, fullText, draftText);
    const result = transformBlockType(baseText, line, to);
    if (result == null) {
        return null;
    }
    return { type: "text-replace", text: result.text, caret: result.caret, focusLine: line };
}

/** Absolute char offset of the START of 1-based `line` inside `text`. */
export function lineStartOffset(text: string, line: number): number {
    const lines = text.split("\n");
    let off = 0;
    for (let i = 0; i < Math.min(line - 1, lines.length); i++) {
        off += lines[i].length + 1;
    }
    return off;
}
