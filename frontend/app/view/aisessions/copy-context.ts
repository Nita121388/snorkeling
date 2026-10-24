// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Copy Context formatting — "this quote + where it came from" as one pasteable
// block ready to hand back to an agent.
//
// Why: the 💡 selection quick-action menu already owns a `Copy Context` item,
// but it only resolves for renderers annotating themselves with
// `data-copy-context-path` + `data-source-line` (markdown preview, code editor,
// tables). AI session detail had no way to describe its provenance, so the item
// never appeared there.
//
// Everything here is pure (no React, no DOM, no jotai): the format is
// unit-tested, and every entry point (💡 Copy Context, the hover button,
// Quote to Input) is guaranteed to emit byte-identical text.

import type { SessionCopyMeta, SessionContextResolver } from "@/app/element/copy-context-contract";
import { formatDateTimeToSecond } from "./utils";

/** Hard cap for the body text; exceeding it appends a truncation note. */
export const CopyContextMaxChars = 8000;

/** Minimal message shape needed to rebuild a multi-message range. */
export type SessionCopyMessage = {
    seq: number;
    role?: string;
    text: string;
    model?: string;
    timestamp?: number;
    /** Backend record id inside the session file — exact locator for an agent. */
    entryId?: string;
    /** Stable per-item key (entry/tool pairing) — secondary locator. */
    itemKey?: string;
};

/**
 * Session-level provenance. Everything here exists to let a receiving agent
 * find the conversation again without a round of "which session was that?" —
 * `filePath` is the strongest locator, the timestamps disambiguate same-titled
 * sessions, and `parentKey` lets a subagent quote point back at its parent.
 */
export type SessionCopySummary = {
    id: string;
    source?: string;
    title?: string;
    projectPath?: string;
    /** On-disk session file (JSONL); the single best locator. */
    filePath?: string;
    createdAt?: number;
    updatedAt?: number;
    /** Total messages in the session, not just the quoted range. */
    messageCount?: number;
    /** Set for sub-sessions spawned by a subagent tool call. */
    parentKey?: string;
};

export type SessionCopySource = {
    summary: SessionCopySummary;
    /** Messages covering at least [seqStart, seqEnd]; order is not trusted. */
    messages: readonly SessionCopyMessage[];
    seqStart: number;
    seqEnd: number;
    /**
     * Text of the live DOM selection. Used verbatim when the selection covers a
     * single message (so partial selections are respected), and as a fallback
     * when the model range resolves to nothing.
     */
    selectedText: string;
    /** Set when the selection anchor sits inside a tool call card. */
    toolName?: string;
    exitCode?: number;
};

export type TermCopyMeta = {
    blockId: string;
    agent?: string;
    cwd?: string;
    connection?: string;
    /** Absolute buffer line numbers (viewport row + baseY). */
    selectedLines?: { start: number; end: number } | null;
    text: string;
};

/** Collapse newlines so a value can never break out of the `<context>` block. */
function oneLine(value: string | undefined | null): string {
    if (value == null) {
        return "";
    }
    return value.replace(/\r?\n/g, " ").trim();
}

function pushLine(lines: string[], key: string, value: string | undefined | null): void {
    const normalized = oneLine(value);
    // Missing fields drop the whole line — never emit `key:` with an empty value.
    if (normalized.length === 0) {
        return;
    }
    lines.push(`${key}: ${normalized}`);
}

/** Longest run of consecutive backticks in `text` (drives fence width). */
export function longestBacktickRun(text: string): number {
    let longest = 0;
    let current = 0;
    for (const char of text) {
        if (char === "`") {
            current += 1;
            if (current > longest) {
                longest = current;
            }
        } else {
            current = 0;
        }
    }
    return longest;
}

/**
 * Wrap `text` in a code fence its own content cannot terminate.
 * Grows the fence past the longest backtick run inside the text.
 */
export function fencedBlock(text: string, language = ""): string {
    const fence = "`".repeat(Math.max(3, longestBacktickRun(text) + 1));
    const lang = language.trim();
    return `${fence}${lang}\n${text}\n${fence}`;
}

function truncateBody(body: string): string {
    if (body.length <= CopyContextMaxChars) {
        return body;
    }
    const omitted = body.length - CopyContextMaxChars;
    return `${body.slice(0, CopyContextMaxChars)}\n\n… (truncated, ${omitted} chars omitted)`;
}

function coveredMessages(src: SessionCopySource): SessionCopyMessage[] {
    const start = Math.min(src.seqStart, src.seqEnd);
    const end = Math.max(src.seqStart, src.seqEnd);
    return src.messages
        .filter((message) => message.seq >= start && message.seq <= end)
        .slice()
        .sort((a, b) => a.seq - b.seq);
}

function firstNonEmpty(values: readonly (string | undefined)[]): string | undefined {
    for (const value of values) {
        const normalized = value?.trim();
        if (normalized) {
            return normalized;
        }
    }
    return undefined;
}

/**
 * Role to report for the range: the single message's role, or the shared role
 * when every covered message agrees. Mixed roles are omitted on purpose —
 * `role: user` on a user+assistant range would be a lie.
 */
function rangeRole(messages: readonly SessionCopyMessage[]): string | undefined {
    if (messages.length === 0) {
        return undefined;
    }
    const roles = new Set(messages.map((message) => (message.role ?? "").trim()).filter((role) => role.length > 0));
    if (roles.size !== 1) {
        return undefined;
    }
    return roles.values().next().value;
}

function messageSeqLabel(src: SessionCopySource, covered: readonly SessionCopyMessage[]): string {
    const start = Math.min(src.seqStart, src.seqEnd);
    const end = Math.max(src.seqStart, src.seqEnd);
    if (start === end) {
        return String(covered[0]?.seq ?? start);
    }
    return `${start}-${end}`;
}

function buildSessionBody(src: SessionCopySource, covered: readonly SessionCopyMessage[]): string {
    const selectedText = src.selectedText.trim();
    if (covered.length <= 1) {
        // Single message: respect exactly what the user highlighted.
        if (selectedText.length > 0) {
            return selectedText;
        }
        return covered[0]?.text.trim() ?? "";
    }
    // Range: rebuild full messages from the model. DOM fragments would be
    // partial, and virtualization may have unmounted the offscreen rows.
    return covered
        .map((message) => `**${message.role || "assistant"}:**\n\n${message.text.trim()}`)
        .join("\n\n");
}

/**
 * Format a session-detail selection as a pasteable context block.
 * Field order is part of the contract — see the task PRD (R2).
 */
function formatTimeRange(covered: readonly SessionCopyMessage[]): { start?: string; end?: string } {
    const stamps = covered.map((message) => message.timestamp).filter((value): value is number => Boolean(value));
    if (stamps.length === 0) {
        return {};
    }
    return {
        start: formatDateTimeToSecond(stamps[0]),
        end: formatDateTimeToSecond(stamps[stamps.length - 1]),
    };
}

/**
 * Format a session-detail selection as a pasteable context block.
 *
 * Field order is part of the contract. Locator fields come first so an agent
 * can jump straight to the session file / record before reading the quote.
 */
export function formatSessionContext(src: SessionCopySource): string {
    const covered = coveredMessages(src);
    const lines: string[] = [];
    // Title is the only field with a fallback rather than a drop, and it
    // still needs newline collapsing to stay inside the block.
    lines.push(`session: ${oneLine(src.summary.title) || src.summary.id}`);
    pushLine(lines, "session-id", src.summary.id);
    pushLine(lines, "source", src.summary.source);
    pushLine(lines, "model", firstNonEmpty(covered.map((message) => message.model)));
    pushLine(lines, "project", src.summary.projectPath);
    // Locators: where the conversation actually lives, and when.
    pushLine(lines, "session-file", src.summary.filePath);
    if (src.summary.createdAt) {
        pushLine(lines, "created", formatDateTimeToSecond(src.summary.createdAt));
    }
    if (src.summary.updatedAt) {
        pushLine(lines, "updated", formatDateTimeToSecond(src.summary.updatedAt));
    }
    pushLine(lines, "parent-session", src.summary.parentKey);

    // Which slice of the conversation this quote covers.
    if (covered.length > 0) {
        pushLine(lines, "message-seq", messageSeqLabel(src, covered));
    } else if (Number.isFinite(src.seqStart)) {
        pushLine(lines, "message-seq", String(src.seqStart));
    }
    if (covered.length > 0) {
        pushLine(lines, "messages-referenced", String(covered.length));
    }
    if (src.summary.messageCount != null && src.summary.messageCount > 0) {
        pushLine(lines, "session-messages", String(src.summary.messageCount));
    }
    // Exact record locator inside the session file (anchor message only —
    // a range spans several entry ids and would be noise).
    if (covered.length === 1) {
        pushLine(lines, "entry-id", covered[0].entryId);
        pushLine(lines, "item-key", covered[0].itemKey);
    }
    pushLine(lines, "role", rangeRole(covered));
    const timeRange = formatTimeRange(covered);
    pushLine(lines, "time", timeRange.start);
    pushLine(lines, "time-end", covered.length > 1 ? timeRange.end : undefined);
    pushLine(lines, "tool", src.toolName);
    if (src.exitCode != null && src.exitCode !== 0) {
        pushLine(lines, "tool-exit", String(src.exitCode));
    }

    const body = truncateBody(buildSessionBody(src, covered));
    const header = ["<context>", ...lines, "</context>"].join("\n");
    return body.length > 0 ? `${header}\n\n${body}` : header;
}

/**
 * Format a terminal (agent TUI) selection. The terminal renders to canvas, so
 * there is no DOM selection to annotate — callers pass the buffer line range.
 */
export function formatTermContext(meta: TermCopyMeta): string {
    const lines: string[] = [];
    pushLine(lines, "block", meta.blockId);
    pushLine(lines, "agent", meta.agent);
    pushLine(lines, "cwd", meta.cwd);
    pushLine(lines, "connection", meta.connection || "local");
    if (meta.selectedLines != null) {
        const start = Math.min(meta.selectedLines.start, meta.selectedLines.end);
        const end = Math.max(meta.selectedLines.start, meta.selectedLines.end);
        pushLine(lines, "selected-lines", `${start}-${end}`);
        pushLine(lines, "lines", String(end - start + 1));
    }

    const header = ["<context>", ...lines, "</context>"].join("\n");
    const body = truncateBody(meta.text.trim());
    return body.length > 0 ? `${header}\n\n${fencedBlock(body)}` : header;
}

// ── Resolver for the DOM layer ──

/** Snapshot the resolver needs; captured lazily so it never goes stale. */
export type SessionContextState = {
    summary: SessionCopySummary;
    messages: readonly SessionCopyMessage[];
    /** Tracked across `selectionchange` so offscreen (virtualized) rows survive. */
    seqRange?: { start: number; end: number } | null;
    toolName?: string;
    exitCode?: number;
};

/**
 * Build the formatter registered for one session panel.
 * `getState` is called at resolve time so the resolver always sees fresh data
 * without re-registering on every appended message.
 */
export function makeSessionContextResolver(getState: () => SessionContextState | null): SessionContextResolver {
    return (meta: SessionCopyMeta, selectedText: string) => {
        const state = getState();
        if (state == null) {
            return null;
        }
        // Tracked range wins over the anchor message: it is the only source that
        // knows the drag crossed rows no longer present in the DOM.
        const seqStart = state.seqRange?.start ?? meta.seq ?? Number.NaN;
        const seqEnd = state.seqRange?.end ?? meta.seq ?? Number.NaN;
        if (!Number.isFinite(seqStart) || !Number.isFinite(seqEnd)) {
            return null;
        }
        return formatSessionContext({
            summary: state.summary,
            messages: state.messages,
            seqStart,
            seqEnd,
            selectedText,
            toolName: state.toolName ?? meta.toolName,
            exitCode: state.exitCode ?? meta.exitCode,
        });
    };
}
