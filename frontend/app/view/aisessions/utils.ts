// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
import { copyText as writeTextToClipboard } from "@/util/clipboard";
import { formatFileSize } from "@/util/fileformat";
import { isWindows } from "@/util/platformutil";
import { buildSessionTree, type SessionTreeNode } from "./session-tree";
import type {
    AttachMode,
    MarkedFilter,
    PathFilter,
    SessionGroupMode,
    SessionSortChain,
    SessionSortField,
} from "./types";
import {
    DefaultAttachMode,
    DefaultSortChain,
    PathFilterOtherRoot,
    attachModeStorageKey,
    expandAllTagsStorageKey,
    groupPreferenceStorageKey,
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
          /** 实时流式工具行的运行状态覆盖（历史工具由 exitCode 推断）。 */
          liveStatus?: "running" | "completed" | "failed";
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

/**
 * 按可见结果集统计每个会话的子会话数：`parentKey === key` 的行（含 subagent + fork）。
 *
 * 与行内 `+N` 徽标（`buildSessionTree` 的 `childCount`）同口径——都在当前结果集上算。
 */
export function countSubSessions(sessions: readonly SessionSummary[]): Map<string, number> {
    const known = new Set<string>();
    for (const session of sessions) {
        known.add(session.key);
    }
    const out = new Map<string, number>();
    for (const session of sessions) {
        const parentKey = (session.parentKey ?? "").trim();
        // 父不在本结果集时不计（与 buildSessionTree 把孤儿提升为顶层的口径一致）。
        if (parentKey === "" || parentKey === session.key || !known.has(parentKey)) continue;
        out.set(parentKey, (out.get(parentKey) ?? 0) + 1);
    }
    return out;
}

function compareByField(
    left: SessionSummary,
    right: SessionSummary,
    field: SessionSortField,
    subCounts: Map<string, number>
): number {
    let leftValue: number;
    let rightValue: number;
    if (field === "time") {
        leftValue = sessionSortTime(left);
        rightValue = sessionSortTime(right);
    } else if (field === "created") {
        leftValue = sessionCreatedTime(left);
        rightValue = sessionCreatedTime(right);
    } else if (field === "messages") {
        leftValue = left.messageCount ?? 0;
        rightValue = right.messageCount ?? 0;
    } else {
        leftValue = subCounts.get(left.key) ?? 0;
        rightValue = subCounts.get(right.key) ?? 0;
    }
    return leftValue - rightValue;
}

/**
 * 构造排序链比较器。
 *
 * 规则：逐键比较（链项前者优先级高），每键按 desc 翻向；全相等后隐式兜底——
 * `updatedAt` 降序（避免大量 0 值 / 相同时「没排序一样」），最后 `key` 升序保证稳定。
 */
export function makeSessionComparator(
    chain: SessionSortChain,
    subCounts: Map<string, number>
): (left: SessionSummary, right: SessionSummary) => number {
    const activeChain = chain.length > 0 ? chain : DefaultSortChain;
    return (left, right) => {
        for (const key of activeChain) {
            const delta = compareByField(left, right, key.field, subCounts) * (key.desc ? -1 : 1);
            if (delta !== 0) return delta;
        }
        const leftTime = sessionSortTime(left);
        const rightTime = sessionSortTime(right);
        if (leftTime !== rightTime) return rightTime - leftTime;
        return left.key.localeCompare(right.key);
    };
}

/** 按排序链排序（不修改入参）。subCounts 可省略，省略时子会话数按 0 处理。 */
export function sortSessions(
    sessions: SessionSummary[],
    chain: SessionSortChain,
    subCounts?: Map<string, number>
): SessionSummary[] {
    return [...sessions].sort(makeSessionComparator(chain, subCounts ?? new Map()));
}

export function sessionSortTime(session: SessionSummary): number {
    return session.updatedAt || session.createdAt || 0;
}

/**
 * 创建时间排序键。老数据可能只有 updatedAt（provider 没解析到 header.timestamp），
 * 此时回落到 updatedAt：把“时间信息”而不是 0 作为排序依据，避免这类会话全部
 * 沉到列表底部或顶部。
 */
export function sessionCreatedTime(session: SessionSummary): number {
    return session.createdAt || session.updatedAt || 0;
}

export function readSortPreference(): boolean {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem(sortPreferenceStorageKey) !== "0";
}

export function writeSortPreference(descending: boolean): void {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(sortPreferenceStorageKey, descending ? "1" : "0");
}

/**
 * 工具栏「展开全部标签」偏好（方案 B）。
 *
 * 默认 false：列表默认折叠到 4 个标签 + `+N`，避免每一行都被标签撑高。
 * 打开后**所有行**都铺开全部标签，偏好写入 localStorage，跨会话保持。
 * 单行的 `+N` / Show less 仍然可用，只是展开态的判定要同时看这个全局开关。
 */
export function readExpandAllTagsPreference(): boolean {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(expandAllTagsStorageKey) === "1";
}

export function writeExpandAllTagsPreference(expanded: boolean): void {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(expandAllTagsStorageKey, expanded ? "1" : "0");
}

/**
 * 一行是否应该铺开全部标签：全局开关打开，或者这一行自己点过 `+N`。
 * 全局开关打开时，单行「Show less」不能把整列偏好翻转，只能收起自己 —— 见
 * `session-row.tsx` 里对 collapseOverride 的处理。
 */
export function shouldExpandAllTags(globalExpanded: boolean, rowExpanded: boolean): boolean {
    return globalExpanded || rowExpanded;
}

export function readGroupPreference(): SessionGroupMode {
    if (typeof window === "undefined") return "project";
    return window.localStorage.getItem(groupPreferenceStorageKey) === "time" ? "time" : "project";
}

export function writeGroupPreference(mode: SessionGroupMode): void {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(groupPreferenceStorageKey, mode);
}

/** 读取「包含上下文」模式；未知/缺失 → 默认智能。 */
export function readAttachMode(): AttachMode {
    if (typeof window === "undefined") return DefaultAttachMode;
    const raw = window.localStorage.getItem(attachModeStorageKey);
    if (raw === "off" || raw === "both" || raw === "children") return raw;
    return DefaultAttachMode;
}

export function writeAttachMode(mode: AttachMode): void {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(attachModeStorageKey, mode);
}

/**
 * A project bucket produced by `groupSessionsByProject`.
 *
 * `name` is the folder's `basename(projectPath)`; the bucket whose sessions
 * carry no usable path is named after the absence of one, and rendered muted.
 */
export type ProjectSessionGroup = {
    /** Display name: basename of the project path, or the 未归类 label. */
    name: string;
    /** The raw projectPath the group is keyed on, or "" for 未归类. */
    path: string;
    /** Sessions in this project, newest first (by the same key as the flat list). */
    sessions: SessionSummary[];
    /** 该分组按父子关系组织好的树（父行 + 其子会话）；渲染用它，sessions 只用于计数。 */
    tree: SessionTreeNode[];
    /** Whether this bucket holds sessions with no usable project path. */
    unclassified: boolean;
};

export const UnclassifiedGroupName = "未归类";

/**
 * The trailing path segment of a disk path (or URL-ish string), across separators.
 *
 * Folders live at the end of an absolute path, so the basename is the identity a
 * user recognizes; grouping on the whole absolute path would split one checkout
 * across every machine it has been opened on.
 */
export function basenamePath(path: string): string {
    const trimmed = (path ?? "").trim().replace(/[/\\]+$/, "");
    if (!trimmed) return "";
    const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
    return idx >= 0 && idx < trimmed.length - 1 ? trimmed.slice(idx + 1) : trimmed;
}

/**
 * Bucket a flat list of sessions by their project folder.
 *
 * Pure and order-agnostic: the caller hands in sessions already sorted in the
 * flat list's order, and this only cuts them into buckets. Groups come back
 * ordered by their most-recently-touched session, so the project you worked in
 * two minutes ago floats to the top; 未归类 always sinks last.
 *
 * @param descending 旧的方向参数：只在 `compare` 缺省时生效（兼容旧调用点 / 测试）。
 * @param compare    排序链比较器。传了它，组内会话与顶层行都按它排；
 *                   **分组顺序仍按最近活跃时间**（不让文件夹随消息数乱跳）。
 */
export function groupSessionsByProject(
    sessions: SessionSummary[],
    descending = true,
    compare?: (left: SessionSummary, right: SessionSummary) => number,
    matchedKeys?: Set<string>
): ProjectSessionGroup[] {
    const buckets = new Map<string, ProjectSessionGroup>();
    for (const session of sessions) {
        const path = (session.projectPath ?? "").trim();
        const key = path === "" ? "" : basenamePath(path);
        const name = key === "" ? UnclassifiedGroupName : key;
        const existing = buckets.get(key);
        if (existing) {
            existing.sessions.push(session);
        } else {
            buckets.set(key, { name, path, sessions: [session], tree: [], unclassified: key === "" });
        }
    }
    const groups = [...buckets.values()];
    groups.sort((left, right) => {
        // 未归类 is not a project; it belongs at the very bottom.
        if (left.unclassified !== right.unclassified) return left.unclassified ? 1 : -1;
        // 不能假设 sessions[0] 是最新的：组内会话可能按消息数/子会话数重排过，
        // 分组顺序要的是「这个项目最近一次活跃」，所以取 max(updatedAt)。
        const leftTime = Math.max(...left.sessions.map(sessionSortTime));
        const rightTime = Math.max(...right.sessions.map(sessionSortTime));
        return rightTime - leftTime;
    });
    // 每个分组内部再按父子关系成树；父会话必然与子会话同 project（同一目录），
    // 所以树不会跨分组。父不在本组里的子会话由 buildSessionTree 提升为顶层。
    for (const group of groups) {
        group.tree = buildSessionTree(group.sessions, matchedKeys, descending, compare);
    }
    return groups;
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

/**
 * 会话列表用的紧凑日期：与当前时间同一年时省略年份（"03-14"），跨年才带年份
 * （"2025-03-14"）。年份基准是 now 所在的年，所以跨年后无需改代码。
 * `withTime` 为 true 时追加 " HH:mm"（"03-14 09:34"），列表行要精确到时间点用。
 * 0 / 无效时间戳返回 ""，让调用方可以直接不渲染。
 */
export function formatSessionDateCompact(timestamp: number, now = Date.now(), withTime = false): string {
    if (!timestamp) return "";
    const normalized = normalizeTimestamp(timestamp);
    if (!Number.isFinite(normalized) || normalized <= 0) return "";
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) return "";
    const monthDay = `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
    const datePart =
        date.getFullYear() === new Date(now).getFullYear() ? monthDay : `${date.getFullYear()}-${monthDay}`;
    if (!withTime) return datePart;
    return `${datePart} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/**
 * 消息数热力档位阈值（1..5 档的第 1~4 个分界）。
 *
 * 按本机真实分布定标（4634 条会话：中位数 5 条、p90 100 条、p99 867 条），
 * 不是等差数列。长尾分布下线性映射会让 95% 的会话落在同一档，热力就失去信息量。
 */
export const MessageHeatThresholds = [5, 20, 100, 500] as const;

/** 文件大小热力档位阈值（字节）。分布同 MessageHeatThresholds：中位 122KB、p90 1.9MB、p99 14MB。 */
export const SizeHeatThresholds = [100 * 1024, 460 * 1024, 2 * 1024 * 1024, 6 * 1024 * 1024] as const;

/**
 * 把数值映射成 1..5 的热力档位（1 = 最小，5 = 最大）。
 * 纯函数 + 显式阈值表：档位边界可以被单测钉死，也不会随渲染次数漂移。
 */
export function heatLevel(value: number, thresholds: readonly number[]): number {
    if (!Number.isFinite(value) || value <= 0) return 1;
    let level = 1;
    for (const threshold of thresholds) {
        if (value >= threshold) level += 1;
    }
    return Math.min(level, thresholds.length + 1);
}

/**
 * 更新时间的「新鲜度」档位（1 = 最新鲜/最亮，5 = 最陈旧/最淡）。
 *
 * 列表行用颜色编码这个维度：越旧越淡，让「刚动过」的会话自然浮出来。
 * 档位只有 5 档，所以颜色变化本身不需要秒级刷新 —— 行下次重渲染时更新即可。
 */
export function freshnessLevel(timestamp: number, now = Date.now()): number {
    if (!timestamp) return 5;
    const normalized = normalizeTimestamp(timestamp);
    if (!Number.isFinite(normalized) || normalized <= 0) return 5;
    const elapsedMs = Math.max(0, now - normalized);
    const hour = 60 * 60 * 1000;
    const day = 24 * hour;
    if (elapsedMs < hour) return 1;
    if (elapsedMs < day) return 2;
    if (elapsedMs < 7 * day) return 3;
    if (elapsedMs < 30 * day) return 4;
    return 5;
}

function sameCalendarDay(left: number, right: number): boolean {
    const a = new Date(normalizeTimestamp(left));
    const b = new Date(normalizeTimestamp(right));
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * 列表行的「创建 / 最近更新」两段文本。判定逻辑放在这里，JSX 只负责直出：
 *
 * - `updatedText` 形如 "03-15 09:34"（紧凑日期时间，不带 "2h ago" 这种相对描述 ——
 *   相对新旧改由行内那条迷你进度条的长度表达，文字只负责定点）。
 * - `createdText` 形如 "03-14 09:30"；缺省为 0、或与 updatedAt 落在同一自然日时返回 ""
 *   （同日不重复渲染，避免 "Created 03-15 / Updated 03-15" 的噪音）。
 * - `freshnessLevel` 是更新时间的 1..5 档新鲜度（1 最新），列表行据此决定进度条长度。
 * - `updatedRelative` 形如 "4d ago"：行内不渲染它（否则又回到老文案），只给进度条的
 *   hover tooltip 用 —— 进度条好看但不知道具体多久，悬停就能读出来。
 * - `updatedFull` / `createdFull` 是秒级完整时间，给 tooltip 用。
 */
export function describeSessionDates(
    createdAt: number,
    updatedAt: number,
    now = Date.now()
): {
    updatedText: string;
    createdText: string;
    freshnessLevel: number;
    updatedRelative: string;
    updatedFull: string;
    createdFull: string;
} {
    const createdBase = createdAt > 0 ? normalizeTimestamp(createdAt) : 0;
    const updatedBase = updatedAt > 0 ? normalizeTimestamp(updatedAt) : createdBase;
    const updatedDate = formatSessionDateCompact(updatedBase, now, true);
    const createdDate = formatSessionDateCompact(createdBase, now, true);
    const sameDay = createdBase > 0 && updatedBase > 0 && sameCalendarDay(createdBase, updatedBase);
    return {
        updatedText: updatedDate,
        createdText: createdDate && !sameDay ? createdDate : "",
        freshnessLevel: freshnessLevel(updatedBase, now),
        updatedRelative: updatedDate ? formatSessionRelativeTime(updatedBase, now) : "",
        updatedFull: formatDateTimeToSecond(updatedBase),
        createdFull: formatDateTimeToSecond(createdBase),
    };
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

// 实现已平移到 @/util/fileformat（叶子模块，供 Files 树 / Files 表格 / AI 会话列表共用）。
// 这里保留 re-export，既有 import 路径（./utils）零改动。
export { formatFileSize };

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

// Canonicalize one path prefix for the multi-select filter. Mirrors the Go
// normalizeProjectPrefix: root forms keep their trailing separator ("/", "E:\",
// "~/") because the backend relies on it to find the component boundary, and the
// Other sentinel passes through untouched.
export function normalizePathPrefix(raw: string): string {
    const p = raw?.trim() ?? "";
    if (p === "") return "";
    if (p === PathFilterOtherRoot) return p;
    if (p === "/") return "/";
    if (p === "~" || p === "~/" || p === "~\\") return "~/";
    if (/^[a-zA-Z]:$/.test(p)) return p[0].toUpperCase() + ":\\";
    if (/^[a-zA-Z]:[\\/]$/.test(p)) return p[0].toUpperCase() + ":\\";
    const trimmed = p.replace(/[\\/]+$/, "");
    return trimmed === "" ? p : trimmed;
}

// Normalize + dedupe (case-insensitively, keeping first-seen order) a path prefix
// list. Empty entries are dropped. Used for both the include and exclude sets.
export function normalizePathSelections(paths: readonly string[] | null | undefined): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const raw of paths ?? []) {
        const p = normalizePathPrefix(raw);
        if (p === "") continue;
        const key = p.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(p);
    }
    return out;
}

// Path sets must NOT be compared with tagsEqual: the tag normalizer rejects
// "/" and "\", so every real path would collapse to "" and compare equal.
export function pathSelectionsEqual(
    a: readonly string[] | null | undefined,
    b: readonly string[] | null | undefined
): boolean {
    const left = normalizePathSelections(a);
    const right = normalizePathSelections(b);
    if (left.length !== right.length) return false;
    return left.every((item, index) => item.toLowerCase() === right[index].toLowerCase());
}

// Keep the include and exclude path sets mutually exclusive: whatever was just
// added to one side is removed from the other. Returns both sides normalized so
// callers never have to think about case/separator variants.
export function reconcilePathSets(
    next: readonly string[],
    other: readonly string[]
): { next: string[]; other: string[] } {
    const normalizedNext = normalizePathSelections(next);
    const added = new Set(normalizedNext.map((p) => p.toLowerCase()));
    const normalizedOther = normalizePathSelections(other).filter((p) => !added.has(p.toLowerCase()));
    return { next: normalizedNext, other: normalizedOther };
}

/** Chip label for a selected path prefix (Other bucket uses its display name). */
export function pathSelectionLabel(prefix: string): string {
    if (prefix === PathFilterOtherRoot) return "Other";
    return shortenPathForChip(prefix);
}

// Whether `prefix` is already covered by one of the selected prefixes (used to
// hint "contained in a parent selection" without silently dropping selections).
export function pathPrefixCoveredBy(prefix: string, selected: readonly string[]): boolean {
    const target = normalizePathPrefix(prefix).toLowerCase();
    if (target === "") return false;
    for (const raw of selected) {
        const candidate = normalizePathPrefix(raw).toLowerCase();
        if (candidate === "" || candidate === PathFilterOtherRoot) continue;
        if (target === candidate) return true;
        const sep = candidate.endsWith("\\") ? "\\" : "/";
        if (target.startsWith(candidate + sep)) return true;
    }
    return false;
}

// ─────────────────────────────────────────────────────────────────────
// 多选与批量操作（batch actions）
//
// 选区（selectedKeys）是 widget 局部态，与筛选一样不落盘。下面三个纯函数
// 负责「选区裁剪 / 范围选择 / 批量复制文本」，均不依赖 jotai / react，
// 可直接单测；UI 与手势接入在 aisessions.tsx。
// ─────────────────────────────────────────────────────────────────────

/**
 * 把选区裁剪到当前可见 key 之内：筛选 / 刷新后消失的会话不该继续算在
 * 选区内，否则批量栏的「复制 5 个 ID」实际只有 2 条在结果里。
 * 保序、去重（选区里可能出现重复 key 的脏数据）。
 */
export function pruneSelectionToVisible(selection: readonly string[], visibleKeys: readonly string[]): string[] {
    const visible = new Set(visibleKeys);
    const out: string[] = [];
    const seen = new Set<string>();
    for (const key of selection) {
        if (key === "" || !visible.has(key) || seen.has(key)) continue;
        seen.add(key);
        out.push(key);
    }
    return out;
}

/**
 * Shift+范围选：按 visibleKeys 的当前顺序取 anchor 到 target 之间（含两端）。
 * anchor 为空或已不在可见集里 → 退化为单选 target（此时用户点不到合理区间，
 * 给他一个确定的结果比保留旧 anchor 更直观）。
 */
export function applySelectionRange(visibleKeys: readonly string[], anchor: string, target: string): string[] {
    if (target === "" || visibleKeys.indexOf(target) < 0) {
        return [];
    }
    const anchorIndex = anchor === "" ? -1 : visibleKeys.indexOf(anchor);
    if (anchorIndex < 0) {
        return [target];
    }
    const targetIndex = visibleKeys.indexOf(target);
    const [start, end] = [Math.min(anchorIndex, targetIndex), Math.max(anchorIndex, targetIndex)];
    return visibleKeys.slice(start, end + 1);
}

/** 批量复制的产物类型。 */
export type BatchCopyKind = "ids" | "filePaths" | "projectPaths" | "resumeCommands";

/**
 * 按用户点击顺序（而非列表顺序）产出复制文本，每项一行。
 *   ids              session.id
 *   filePaths        session.filePath
 *   projectPaths     session.projectPath（去重保序 —— 同目录多个会话只留一行）
 *   resumeCommands   restoreCommandForSession()（复用单行菜单同一函数）
 * 字段缺失的项跳过；全空返回 ""（copyText 已有空串保护）。
 */
export function buildBatchCopyText(sessions: readonly SessionSummary[], kind: BatchCopyKind): string {
    if (sessions.length === 0) return "";
    const seen = new Set<string>();
    const lines: string[] = [];
    for (const session of sessions) {
        if (session == null) continue;
        let value = "";
        switch (kind) {
            case "ids":
                value = session.id?.trim() ?? "";
                break;
            case "filePaths":
                value = session.filePath?.trim() ?? "";
                break;
            case "projectPaths":
                value = session.projectPath?.trim() ?? "";
                break;
            case "resumeCommands":
                value = restoreCommandForSession(session);
                break;
        }
        if (value === "") continue;
        if (kind === "projectPaths") {
            const dedupeKey = value.toLowerCase();
            if (seen.has(dedupeKey)) continue;
            seen.add(dedupeKey);
        }
        lines.push(value);
    }
    return lines.join("\n");
}
