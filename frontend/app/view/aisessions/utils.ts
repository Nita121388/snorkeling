// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { copyText as writeTextToClipboard } from "@/util/clipboard";
import { isWindows } from "@/util/platformutil";
import type { MarkedFilter, PathFilter } from "./types";
import {
    collapsedMessagePreviewLength,
    collapsibleMessageCharCount,
    collapsibleMessageLineCount,
    PathFilterOtherRoot,
    sortPreferenceStorageKey,
} from "./types";

const ExactToolCallAnchorPattern = /^\[Tool:\s*[^\]]+\]$/;
const ToolCallAnchorPattern = /\[Tool:\s*[^\]]+\]/;

export function emptySessionsText(markedFilter: MarkedFilter, remoteFilterActive: boolean): string {
    if (markedFilter === "starred") {
        return remoteFilterActive ? "No starred sessions match." : "No starred sessions.";
    }
    if (markedFilter === "unstarred") {
        return remoteFilterActive ? "No unstarred sessions match." : "No unstarred sessions.";
    }
    return remoteFilterActive ? "No matching sessions." : "No sessions found.";
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
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem(sortPreferenceStorageKey) !== "0";
}

export function writeSortPreference(descending: boolean): void {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(sortPreferenceStorageKey, descending ? "1" : "0");
}

export function formatRelativeRefreshTime(timestamp: number, now = Date.now()): string {
    if (!timestamp) return "";
    const normalized = normalizeTimestamp(timestamp);
    if (!Number.isFinite(normalized)) return "";
    const elapsedSeconds = Math.floor(Math.max(0, now - normalized) / 1000);
    if (elapsedSeconds < 10) return "Refreshed just now";
    if (elapsedSeconds < 60) return `Refreshed ${elapsedSeconds}s ago`;
    const elapsedMinutes = Math.floor(elapsedSeconds / 60);
    if (elapsedMinutes < 60) return `Refreshed ${elapsedMinutes}m ago`;
    const elapsedHours = Math.floor(elapsedMinutes / 60);
    if (elapsedHours < 24) return `Refreshed ${elapsedHours}h ago`;
    return `Refreshed ${Math.floor(elapsedHours / 24)}d ago`;
}

export function formatSessionRelativeTime(timestamp: number, now = Date.now()): string {
    const normalized = normalizeTimestamp(timestamp);
    if (!normalized) return "never";
    const elapsedSeconds = Math.floor(Math.max(0, now - normalized) / 1000);
    if (elapsedSeconds < 10) return "just now";
    if (elapsedSeconds < 60) return `${elapsedSeconds}s ago`;
    const elapsedMinutes = Math.floor(elapsedSeconds / 60);
    if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;
    const elapsedHours = Math.floor(elapsedMinutes / 60);
    if (elapsedHours < 24) return `${elapsedHours}h ago`;
    return `${Math.floor(elapsedHours / 24)}d ago`;
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

function quoteShellPath(path: string): string {
    if (/^[A-Za-z0-9_@%:,./=+-]+$/.test(path)) {
        return path;
    }
    return `'${path.replace(/'/g, `'"'"'`)}'`;
}

function quoteWindowsPath(path: string): string {
    if (/^[A-Za-z0-9_@%:,./=+-]+$/.test(path)) {
        return path;
    }
    return `"${path}"`;
}

export function restoreCommandForSession(summary: SessionSummary): string {
    if (summary.source === "claude") {
        const resumeCommand = `claude --resume ${summary.id}`;
        if (!summary.projectPath) return resumeCommand;
        const quotedPath = isWindows()
            ? quoteWindowsPath(summary.projectPath)
            : quoteShellPath(summary.projectPath);
        return `cd ${quotedPath}\n${resumeCommand}`;
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
    const normalized = normalizeTimestamp(timestamp);
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

export function formatSessionDate(timestamp: number): string {
    if (!timestamp) return "never";
    const normalized = normalizeTimestamp(timestamp);
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) return "invalid time";
    const year = date.getFullYear();
    const month = pad2(date.getMonth() + 1);
    const day = pad2(date.getDate());
    return `${year}-${month}-${day}`;
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

function normalizeTimestamp(timestamp: number): number {
    const normalized = timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
    return Number.isFinite(normalized) ? normalized : 0;
}

export function getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    return String(error);
}

// ── Path filter helpers ──
// Roots are clustered by disk drive / home prefix. Windows drive letter is
// case-insensitive but we keep canonical uppercase form for display, lowercase
// for match.

const PathMaxRealRoots = 6;

const RootColorPalette = ["#74a7cb", "#cc685c", "#e0b956", "#8bbf72", "#b58fcc", "#c97fa3"];

export type PathRootOption = {
    root: string;
    label: string;
    count: number;
    color: string;
    isOther?: boolean;
    isMore?: boolean;
};

export type BreadcrumbSegment = {
    label: string;
    fullPrefix: string;
    count: number;
    isLeaf: boolean;
};

function hashStringToIndex(s: string, mod: number): number {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
        h = (h * 31 + s.charCodeAt(i)) >>> 0;
    }
    return mod > 0 ? h % mod : 0;
}

// Extracts the canonical root prefix of a projectPath: Windows "X:\", *nix "/"
// absolute, or "~/" home prefix. Returns "" if the path is empty or has no
// recognized root.
function extractRootOfPath(projectPath: string): string {
    const trimmed = (projectPath ?? "").trim();
    if (trimmed === "") return "";
    // Windows drive: X:\...  (case-insensitive)
    const driveMatch = /^([a-zA-Z]):[\\/]/.exec(trimmed);
    if (driveMatch) {
        return driveMatch[1].toUpperCase() + ":\\";
    }
    // *nix home
    if (trimmed.startsWith("~") && (trimmed.length === 1 || trimmed[1] === "/" || trimmed[1] === "\\")) {
        return "~/";
    }
    // *nix root
    if (trimmed.startsWith("/")) {
        return "/";
    }
    return "";
}

export function normalizePathForMatch(p: string): string {
    return (p ?? "").replace(/[\\/]+$/g, "").toLowerCase();
}

export function pathFilterToPrefix(filter: PathFilter): string {
    if (!filter) return "";
    if (filter.root === "" || filter.root === PathFilterOtherRoot) return "";
    const sub = filter.subPath ?? "";
    return filter.root + sub;
}

export function pathFilterEqual(a: PathFilter, b: PathFilter): boolean {
    if (!a || !b) return a === b;
    return a.root === b.root && a.subPath === b.subPath;
}

export function extractPathRoots(sessions: { projectPath?: string }[]): PathRootOption[] {
    const counts = new Map<string, number>();
    let otherCount = 0;
    for (const session of sessions) {
        const root = extractRootOfPath(session.projectPath ?? "");
        if (root === "") {
            otherCount++;
        } else {
            counts.set(root, (counts.get(root) ?? 0) + 1);
        }
    }
    const realRoots = Array.from(counts.entries())
        .map(([root, count]) => ({
            root,
            count,
            label: root,
            color: RootColorPalette[hashStringToIndex(root.toLowerCase(), RootColorPalette.length)],
        }))
        .sort((a, b) => b.count - a.count);
    const capped = realRoots.slice(0, PathMaxRealRoots);
    const overflow = realRoots.length - capped.length;
    // Overflow counts collapse into the Other bucket so its count stays accurate.
    for (const dropped of realRoots.slice(PathMaxRealRoots)) {
        otherCount += dropped.count;
    }
    const result: PathRootOption[] = capped.map((entry) => ({
        root: entry.root,
        label: entry.label,
        count: entry.count,
        color: entry.color,
    }));
    if (otherCount > 0) {
        result.push({
            root: PathFilterOtherRoot,
            label: "Other",
            count: otherCount,
            color: RootColorPalette[hashStringToIndex("other", RootColorPalette.length)],
            isOther: true,
        });
    }
    if (overflow > 0) {
        result.push({
            root: "__more__",
            label: "…",
            count: 0,
            color: "#888888",
            isMore: true,
        });
    }
    return result;
}

// Split on either separator, drop empty leading/trailing segments (handles
// trailing slash and double separators). Keeps interior segments intact.
function splitPathSegments(path: string): string[] {
    return (path ?? "")
        .split(/[\\/]/)
        .map((seg) => seg)
        .filter((seg) => seg.length > 0);
}

// Lowercased full string for prefix comparison — keeps the trailing separator
// (e.g. "E:\", "/", "~/") so it prefixes correctly instead of matching all.
function toMatchLower(p: string): string {
    return (p ?? "").toLowerCase();
}

// Compute breadcrumb segments under a selected root by finding the longest
// common path-prefix of every session whose projectPath starts with root.
// Each returned segment is one ancestor level below root, with count = number
// of sessions whose normalized projectPath starts with that prefix.
export function computeBreadcrumb(filter: PathFilter, sessions: { projectPath?: string }[]): BreadcrumbSegment[] {
    if (!filter || filter.root === "" || filter.root === PathFilterOtherRoot) return [];
    const rootMatch = toMatchLower(filter.root);
    if (rootMatch === "") return [];
    const underRoot = sessions.filter((s) => toMatchLower(s.projectPath ?? "").startsWith(rootMatch));
    if (underRoot.length === 0) return [];
    // segment tails (the part of projectPath after the root), split into segments
    const tailSegmentsList = underRoot.map((s) => {
        const p = s.projectPath ?? "";
        const tail = p.slice(filter.root.length);
        return splitPathSegments(tail);
    });
    // longest common prefix of segment arrays
    let commonLen = tailSegmentsList[0].length;
    for (let i = 1; i < tailSegmentsList.length; i++) {
        commonLen = Math.min(commonLen, tailSegmentsList[i].length);
        let j = 0;
        for (; j < commonLen; j++) {
            if (tailSegmentsList[i][j].toLowerCase() !== tailSegmentsList[0][j].toLowerCase()) {
                commonLen = j;
                break;
            }
        }
        if (commonLen === 0) break;
    }
    // Build prefixes by appending segments to the root string directly so the
    // root's trailing separator (E:\ / ~/ / /) is preserved verbatim.
    const sep = filter.root.endsWith("\\") ? "\\" : "/";
    const segments: BreadcrumbSegment[] = [];
    let acc = filter.root;
    for (let level = 0; level < commonLen; level++) {
        acc = acc + (acc.endsWith(sep) || acc === "" ? "" : sep) + tailSegmentsList[0][level];
        const prefixLower = normalizePathForMatch(acc);
        const count = underRoot.filter((s) => normalizePathForMatch(s.projectPath ?? "").startsWith(prefixLower)).length;
        segments.push({
            label: tailSegmentsList[0][level],
            fullPrefix: acc,
            count,
            isLeaf: level === commonLen - 1,
        });
    }
    return segments;
}

// Local filter for the "Other" root: keep sessions whose projectPath is empty or
// does not start with any recognized root prefix.
export function otherRootMatcher(sessions: { projectPath?: string }[]): { projectPath?: string }[] {
    return sessions.filter((session) => extractRootOfPath(session.projectPath ?? "") === "");
}
