// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { copyText as writeTextToClipboard } from "@/util/clipboard";
import {
    collapsedMessagePreviewLength,
    collapsibleMessageCharCount,
    collapsibleMessageLineCount,
    sortPreferenceStorageKey,
} from "./types";

const ExactToolCallAnchorPattern = /^\[Tool:\s*[^\]]+\]$/;
const ToolCallAnchorPattern = /\[Tool:\s*[^\]]+\]/;

export function emptySessionsText(markedOnly: boolean, remoteFilterActive: boolean): string {
    if (markedOnly && remoteFilterActive) return "No marked sessions match.";
    if (markedOnly) return "No marked sessions.";
    return "No sessions found.";
}

export function trimMessageText(text: string): string {
    if (!text) return "";
    if (text.length <= 2400) return text;
    return text.slice(0, 2400) + "\n...";
}

export function isCollapsibleMessage(text: string): boolean {
    if (!text) return false;
    if (text.length >= collapsibleMessageCharCount) return true;
    return text.split(/\r\n|\r|\n/).length >= collapsibleMessageLineCount;
}

export function collapsedMessagePreview(text: string): string {
    const normalized = text.trim();
    if (normalized.length <= collapsedMessagePreviewLength) return normalized;
    return normalized.slice(0, collapsedMessagePreviewLength).trimEnd() + "\n...";
}

export function isReadableMessage(message: Message): boolean {
    const text = message.text.trim();
    if (!text) return false;
    if (message.role === "tool") return false;
    if (isToolCallAnchorMessage(message)) return false;
    return true;
}

export function isToolCallAnchorMessage(message: Message): boolean {
    const text = message.text.trim();
    if (!text || message.role === "tool") return false;
    return ExactToolCallAnchorPattern.test(text);
}

function hasToolCallAnchor(message: Message): boolean {
    const text = message.text.trim();
    if (!text || message.role === "tool") return false;
    return ToolCallAnchorPattern.test(text);
}

export type SessionDetailTimelineItem =
    | {
          kind: "message";
          message: Message;
      }
    | {
          kind: "tool";
          toolCall: ToolCall;
          anchorSeq: number;
      };

export function buildSessionDetailTimeline(
    allMessages: Message[],
    visibleMessages: Message[],
    toolCalls: ToolCall[] | null | undefined,
    showToolCalls: boolean
): SessionDetailTimelineItem[] {
    const visibleMessageSeqs = new Set(visibleMessages.map((message) => message.seq));
    const firstVisibleSeq = visibleMessages[0]?.seq;
    const lastVisibleSeq = allMessages[allMessages.length - 1]?.seq;
    const toolCallByAnchorSeq = new Map<number, ToolCall>();

    if (showToolCalls && toolCalls != null && toolCalls.length > 0) {
        let toolCallIdx = 0;
        for (const message of allMessages) {
            if (!hasToolCallAnchor(message)) {
                continue;
            }
            const toolCall = toolCalls[toolCallIdx];
            toolCallIdx++;
            if (toolCall != null) {
                toolCallByAnchorSeq.set(message.seq, toolCall);
            }
        }
    }

    const timelineItems: SessionDetailTimelineItem[] = [];
    for (const message of allMessages) {
        if (visibleMessageSeqs.has(message.seq) && isReadableMessage(message)) {
            timelineItems.push({ kind: "message", message });
        }
        const toolCall = toolCallByAnchorSeq.get(message.seq);
        if (
            toolCall != null &&
            firstVisibleSeq != null &&
            lastVisibleSeq != null &&
            message.seq >= firstVisibleSeq &&
            message.seq <= lastVisibleSeq
        ) {
            timelineItems.push({ kind: "tool", toolCall, anchorSeq: message.seq });
        }
    }

    if (timelineItems.length === 0 && visibleMessages.length > 0) {
        return visibleMessages.map((message) => ({ kind: "message", message }));
    }
    return timelineItems;
}

export function outlinePreview(message: Message): string {
    const text = trimMessageText(message.text).replace(/\s+/g, " ").trim();
    if (!text) return "(empty)";
    if (text.length <= 96) return text;
    return text.slice(0, 96) + "...";
}

export function formatToolCallPreview(toolCall: ToolCall): string {
    const summary = toolCall.summary?.replace(/\s+/g, " ").trim();
    const output = toolCall.output?.replace(/\s+/g, " ").trim();
    if (summary) {
        return summary.length <= 120 ? summary : `${summary.slice(0, 120)}...`;
    }
    if (output) {
        return output.length <= 120 ? output : `${output.slice(0, 120)}...`;
    }
    return "No details";
}

export function outlineRoleClass(message: Message): string {
    switch (message.role) {
        case "user":
            return "border-l-2 border-accent/30 bg-accent/10 pl-2";
        case "assistant":
            return "border-l-2 border-border bg-bg pl-3";
        case "system":
            return "border-l-2 border-border/70 bg-bg/60 pl-4 text-secondary";
        default:
            return "border-l-2 border-border bg-bg pl-3";
    }
}

export function displayRole(role: string): string {
    return role === "assistant" ? "AI" : role;
}

export function sortSessionsByTime(sessions: SessionSummary[], descending: boolean): SessionSummary[] {
    return [...sessions].sort((left, right) => {
        const leftTime = sessionSortTime(left);
        const rightTime = sessionSortTime(right);
        if (leftTime === rightTime) {
            return left.key.localeCompare(right.key);
        }
        return descending ? rightTime - leftTime : leftTime - rightTime;
    });
}

export function sessionSortTime(session: SessionSummary): number {
    return session.updatedAt || session.createdAt || 0;
}

export function readSortPreference(): boolean {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(sortPreferenceStorageKey) === "1";
}

export function writeSortPreference(descending: boolean): void {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(sortPreferenceStorageKey, descending ? "1" : "0");
}

export async function copyText(text: string): Promise<void> {
    await writeTextToClipboard(text);
}

export function dirname(path: string): string {
    const normalized = path.trim();
    if (!normalized) return "";
    const idx = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
    if (idx <= 0) return normalized;
    return normalized.slice(0, idx);
}

export function restoreCommandForSession(summary: SessionSummary): string {
    if (summary.source === "claude") {
        return `claude --resume ${summary.id}`;
    }
    return `codex resume ${summary.id}`;
}

export function shortSessionId(id: string): string {
    if (!id) return "";
    if (id.length <= 14) return id;
    return `${id.slice(0, 8)}...${id.slice(-4)}`;
}

export function formatDateTimeToSecond(timestamp: number): string {
    if (!timestamp) return "never";
    const normalized = timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) return "invalid time";
    const year = date.getFullYear();
    const month = pad2(date.getMonth() + 1);
    const day = pad2(date.getDate());
    const hour = pad2(date.getHours());
    const minute = pad2(date.getMinutes());
    const second = pad2(date.getSeconds());
    return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

export function formatFileSize(bytes: number | null | undefined): string {
    if (bytes == null || Number.isNaN(bytes)) return "";
    if (bytes < 0) return "";
    if (bytes === 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB", "PB"];
    const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / Math.pow(1024, unitIndex);
    const display =
        unitIndex === 0 ? Math.round(value).toString() : value.toFixed(value < 10 ? 1 : 0).replace(/\.0$/, "");
    return `${display} ${units[unitIndex]}`;
}

function pad2(value: number): string {
    return value.toString().padStart(2, "0");
}

export function getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    return String(error);
}
