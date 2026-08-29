// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { copyText as writeTextToClipboard } from "@/util/clipboard";
import { isWindows } from "@/util/platformutil";
import type { MarkedFilter, PathFilter } from "./types";
import { PathFilterOtherRoot, sortPreferenceStorageKey } from "./types";

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

export function shouldStartEmptyChat(
    loading: boolean,
    visibleSessionCount: number,
    hasDetail: boolean,
    filterActive: boolean,
    error: string
): boolean {
    return !loading && visibleSessionCount === 0 && !hasDetail && !filterActive && error === "";
}

export function trimMessageText(text: string): string {
    if (!text) return "";
    if (text.length <= 2400) return text;
    return text.slice(0, 2400) + "\n...";
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

function quotePowerShellValue(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
}

// Agent resume binaries by source. Non-claude sources previously fell through to
// "codex", which launched the wrong agent when resuming an opencode/pi session.
const AgentResumeCmdBySource: Record<string, string> = {
    claude: "claude",
    codex: "codex",
    opencode: "opencode",
    pi: "pi",
};

export function restoreMetaForSession(context: AISessionsRestoreContextResponse): MetaType & Record<string, unknown> {
    const meta: MetaType & Record<string, unknown> = {
        view: "term",
        controller: "cmd",
        cmd: AgentResumeCmdBySource[context.source] ?? "codex",
        "cmd:shell": false,
        "cmd:runonstart": true,
        "cmd:jwt": true,
        "agent:autoresume": true,
        "agent:provider": context.source,
        "agent:sessionid": context.sessionid,
    };
    if (context.projectpath) {
        meta["cmd:cwd"] = context.projectpath;
    }
    if (context.configdir) {
        meta["cmd:env"] = { CLAUDE_CONFIG_DIR: context.configdir };
        meta["agent:claudevendorid"] = context.vendorid;
        meta["agent:claudevendorname"] = context.vendorname;
    }
    return meta;
}

export function restoreCommandForSession(summary: SessionSummary): string {
    if (summary.source === "claude") {
        let resumeCommand = `claude --resume ${summary.id}`;
        if (summary.configdir) {
            resumeCommand = isWindows()
                ? `$env:CLAUDE_CONFIG_DIR = ${quotePowerShellValue(summary.configdir)}\n${resumeCommand}`
                : `CLAUDE_CONFIG_DIR=${quoteShellPath(summary.configdir)} ${resumeCommand}`;
        }
        if (!summary.projectPath) return resumeCommand;
        const quotedPath = isWindows() ? quoteWindowsPath(summary.projectPath) : quoteShellPath(summary.projectPath);
        return `cd ${quotedPath}\n${resumeCommand}`;
    }
    if (summary.source === "opencode") {
        let resumeCommand = `opencode --session ${summary.id}`;
        if (summary.configdir) {
            resumeCommand = isWindows()
                ? `$env:OPENCODE_HOME = ${quotePowerShellValue(summary.configdir)}\n${resumeCommand}`
                : `OPENCODE_HOME=${quoteShellPath(summary.configdir)} ${resumeCommand}`;
        }
        if (!summary.projectPath) return resumeCommand;
        const quotedPath = isWindows() ? quoteWindowsPath(summary.projectPath) : quoteShellPath(summary.projectPath);
        return `cd ${quotedPath}\n${resumeCommand}`;
    }
    if (summary.source === "pi") {
        let resumeCommand = `pi --session-id ${summary.id}`;
        if (summary.configdir) {
            resumeCommand = isWindows()
                ? `$env:PI_CODING_AGENT_SESSION_DIR = ${quotePowerShellValue(summary.configdir)}\n${resumeCommand}`
                : `PI_CODING_AGENT_SESSION_DIR=${quoteShellPath(summary.configdir)} ${resumeCommand}`;
        }
        if (!summary.projectPath) return resumeCommand;
        const quotedPath = isWindows() ? quoteWindowsPath(summary.projectPath) : quoteShellPath(summary.projectPath);
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

export type PathCountGroup = {
    name: string;
    count: number;
};

export type PathAncestorSegment = {
    name: string;
    fullSubPath: string;
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

// Split on either separator, drop empty segments (handles trailing slash and
// double separators). Keeps interior segments intact.
function splitPathSegments(path: string): string[] {
    return (path ?? "").split(/[\\/]/).filter((seg) => seg.length > 0);
}

// Whether projectPath is rooted at the given root string. Handles case-insensitive
// drive letters (E:\ vs e:/), *nix "/" absolute and "~/" home prefixes.
function rootBelongs(projectPath: string, root: string): boolean {
    if (root === "" || root === PathFilterOtherRoot) return false;
    const p = projectPath ?? "";
    if (root === "/") return p.startsWith("/");
    if (root === "~/") {
        const pl = p.toLowerCase();
        return pl === "~" || pl.startsWith("~/") || pl.startsWith("~\\");
    }
    if (root.length === 3 && /^[a-zA-Z]:[\\/]$/.test(root)) {
        const m = /^([a-z]):[\\/]/.exec(p.toLowerCase());
        return m != null && m[1] === root[0].toLowerCase();
    }
    return false;
}

// Separator native to the root: Windows "\\", *nix "/".
function rootNativeSep(root: string): string {
    return root.endsWith("\\") ? "\\" : "/";
}

// Case-insensitive array prefix equality.
function arrayPrefixEq(a: string[], b: string[], n: number): boolean {
    for (let i = 0; i < n; i++) {
        if ((a[i] ?? "").toLowerCase() !== b[i].toLowerCase()) return false;
    }
    return true;
}

// How many leading components the root itself occupies in splitPathSegments.
// "/Users" splits to ["Users"] (root "/" is not a component); "E:\code" splits
// to ["E:", "code"] (root "E:\" occupies one component); "~/proj" splits to
// ["~", "proj"] (root "~/" occupies one component).
function rootStripCount(root: string): number {
    return root === "/" ? 0 : 1;
}

/**
 * extractPathRoots aggregates distinct root options from a full projectPath
 * distribution (NOT from the truncated sessions list, which is limited to 200
 * and would under-count old projects / the Other bucket).
 */
export function extractPathRoots(dist: ProjectPathSummary[]): PathRootOption[] {
    const counts = new Map<string, number>();
    let otherCount = 0;
    for (const d of dist) {
        const root = extractRootOfPath(d.path);
        if (root === "") {
            otherCount += d.count;
        } else {
            counts.set(root, (counts.get(root) ?? 0) + d.count);
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

/**
 * extractPathChildren returns the direct children of the currently selected
 * path (filter) from the full distribution, each with aggregated session counts.
 * Children are extracted by finding the next component after the current path
 * length in paths that share the same prefix. Uses path-component boundary
 * matching (not a plain string prefix), so selecting ".../snorkeling" will never
 * surface sibling ".../snorkeling-light-theme" as a child.
 */
export function extractPathChildren(filter: PathFilter, dist: ProjectPathSummary[]): PathCountGroup[] {
    if (!filter || filter.root === "" || filter.root === PathFilterOtherRoot) return [];
    const cur = splitPathSegments(filter.subPath ?? "");
    const strip = rootStripCount(filter.root);
    const counts = new Map<string, number>();
    for (const d of dist) {
        if (!rootBelongs(d.path, filter.root)) continue;
        const segs = splitPathSegments(d.path).slice(strip);
        if (segs.length <= cur.length) continue;
        if (!arrayPrefixEq(segs, cur, cur.length)) continue;
        const child = segs[cur.length];
        counts.set(child, (counts.get(child) ?? 0) + d.count);
    }
    return Array.from(counts.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/**
 * pathAncestorSegments returns each ancestor of the currently selected subPath
 * (including the current level itself) as clickable crumbs with their relative
 * subPath. Clicking one pops the navigation to that level.
 */
export function pathAncestorSegments(filter: PathFilter): PathAncestorSegment[] {
    const cur = splitPathSegments(filter.subPath ?? "");
    const sep = rootNativeSep(filter.root);
    return cur.map((name, i) => ({
        name,
        fullSubPath: cur.slice(0, i + 1).join(sep),
    }));
}

/**
 * shortenPathForChip truncates a full path for the ActiveChip display: ≤44
 * chars shows as-is; longer paths show "…/lastTwoSegments", with CSS
 * text-overflow:ellipsis as a width guard for extremely long individual segment
 * names. Hover title shows the full path.
 */
export function shortenPathForChip(path: string, maxLen = 44): string {
    const p = path?.trim() ?? "";
    if (!p || p.length <= maxLen) return p;
    const segs = splitPathSegments(p);
    if (segs.length === 0) return "…";
    if (segs.length >= 2) {
        const tail = `${segs[segs.length - 2]}/${segs[segs.length - 1]}`;
        if (tail.length + 1 <= maxLen) return `…/${tail}`;
    }
    return `…/${segs[segs.length - 1]}`;
}

// Local filter for the "Other" root: keep sessions whose projectPath is empty or
// does not start with any recognized root prefix.
export function otherRootMatcher(sessions: { projectPath?: string }[]): { projectPath?: string }[] {
    return sessions.filter((session) => extractRootOfPath(session.projectPath ?? "") === "");
}
