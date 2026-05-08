// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import {
    collapsedMessagePreviewLength,
    collapsibleMessageCharCount,
    collapsibleMessageLineCount,
    sortPreferenceStorageKey,
} from "./types";

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
    if (/^\[Tool:\s*[^\]]+\]$/.test(text)) return false;
    return true;
}

export function outlinePreview(message: Message): string {
    const text = trimMessageText(message.text).replace(/\s+/g, " ").trim();
    if (!text) return "(empty)";
    if (text.length <= 96) return text;
    return text.slice(0, 96) + "...";
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
    if (!text) return;
    if (navigator?.clipboard?.writeText != null) {
        await navigator.clipboard.writeText(text);
        return;
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
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

function pad2(value: number): string {
    return value.toString().padStart(2, "0");
}

export function getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    return String(error);
}
