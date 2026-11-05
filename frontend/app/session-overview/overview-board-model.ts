// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure logic for the Overview board view (status columns + view-mode persistence).
//
// Kept free of React so the grouping/ordering rules are directly unit-testable
// (same convention as `preview-text-modes.ts` / `session-overview-agent-status.ts`).
// The single rollout switch lives here: set `OVERVIEW_BOARD_ENABLED = false` and the
// panel goes back to the untouched list-only path.

import { basename, formatCompactDuration } from "@/util/util";
import { atomWithStorage } from "jotai/vanilla/utils";
import type { SyncStorage } from "jotai/vanilla/utils/atomWithStorage";
import type { ReactNode } from "react";

/** Single-file rollback switch: `false` restores the pure list view. */
export const OVERVIEW_BOARD_ENABLED = true;

/** Fixed column order: needs-attention first, then live work, then history. */
export const OverviewBoardStatuses = ["blocked", "working", "done", "idle", "stale"] as const;

export type OverviewBoardStatus = (typeof OverviewBoardStatuses)[number];

/** Hardcoded Chinese labels, matching the existing overview copy style. */
export const OverviewBoardColumnTitles: Record<OverviewBoardStatus, string> = {
    blocked: "待我处理",
    working: "进行中",
    done: "已完成",
    idle: "空闲",
    stale: "陈旧",
};

/**
 * Accepts either a raw state string or any object carrying a `state` (e.g. `AgentStatus`),
 * so callers can pass `AgentStatus | null` records straight through without mapping.
 */
export type OverviewBoardStatusInput = string | { state?: string | null } | null | undefined;

export type OverviewBoardBlockLike = {
    blockId: string;
};

export type OverviewBoardColumn<T extends OverviewBoardBlockLike = OverviewBoardBlockLike> = {
    status: OverviewBoardStatus;
    title: string;
    blocks: T[];
};

export type OverviewBoardGroupOptions = {
    /** Column order override (defaults to `OverviewBoardStatuses`). */
    statuses?: readonly OverviewBoardStatus[];
    /** Total card cap across all columns, applied in column order. `undefined` = no cap. */
    maxTotal?: number;
    /** Keep columns with zero cards (default false: empty columns are hidden). */
    includeEmpty?: boolean;
};

/** Unknown, missing, or out-of-set states all land in the calm `idle` column. */
export function normalizeOverviewBoardStatus(state: string | null | undefined): OverviewBoardStatus {
    // error / rate-limited 不是"未知状态"：列表里它们是红色/警告色独立 chip，
    // 灰成 idle 会让模型报错在看板上彻底消失。归到「待我处理」最贴近语义。
    if (state === "error" || state === "rate-limited") {
        return "blocked";
    }
    switch (state) {
        case "blocked":
        case "working":
        case "done":
        case "idle":
        case "stale":
            return state;
        default:
            return "idle";
    }
}

function resolveStatusInput(input: OverviewBoardStatusInput): string | null | undefined {
    if (input == null) return null;
    if (typeof input === "string") return input;
    return input.state ?? null;
}

/**
 * Bucket overview blocks into status columns.
 *
 * - Column order is fixed (`blocked → working → done → idle → stale`), independent of input order.
 * - Within a column, input order is preserved (the caller already sorted/filtered).
 * - `maxTotal` is a total cap, consumed column by column.
 * - Empty columns are dropped unless `includeEmpty` is set.
 */
export function groupBlocksByStatus<T extends OverviewBoardBlockLike>(
    blocks: readonly T[],
    presentedStatuses: Readonly<Record<string, OverviewBoardStatusInput>>,
    opts: OverviewBoardGroupOptions = {}
): OverviewBoardColumn<T>[] {
    const statuses = opts.statuses ?? OverviewBoardStatuses;
    const includeEmpty = opts.includeEmpty === true;
    const maxTotal =
        typeof opts.maxTotal === "number" && Number.isFinite(opts.maxTotal)
            ? Math.max(0, Math.floor(opts.maxTotal))
            : null;

    const grouped = new Map<OverviewBoardStatus, T[]>();
    for (const status of statuses) {
        grouped.set(status, []);
    }
    for (const block of blocks) {
        const status = normalizeOverviewBoardStatus(resolveStatusInput(presentedStatuses[block.blockId]));
        grouped.get(status)?.push(block);
    }

    const columns: OverviewBoardColumn<T>[] = [];
    let remaining = maxTotal;
    for (const status of statuses) {
        let columnBlocks = grouped.get(status) ?? [];
        if (remaining != null) {
            columnBlocks = columnBlocks.slice(0, remaining);
            remaining -= columnBlocks.length;
        }
        if (columnBlocks.length === 0 && !includeEmpty) continue;
        columns.push({ status, title: OverviewBoardColumnTitles[status], blocks: columnBlocks });
    }
    return columns;
}

// ---------------------------------------------------------------------------
// Board card model + pure display helpers
//
// The panel assembles `OverviewBoardCard[]` (identity, status, copy) and the
// board stays a dumb renderer. Everything below is pure so the title/name
// resolution rules are directly unit-testable.
// ---------------------------------------------------------------------------

/** How a card renders the agent identity (persona chain → brand logo → generic icon). */
export type OverviewBoardAvatar =
    | { kind: "emoji"; emoji: string }
    | { kind: "logo"; icon: ReactNode; color?: string }
    | { kind: "icon"; iconClass: string };

export type OverviewBoardCard = {
    blockId: string;
    tabId: string;
    /** Agent session id; empty for non-agent blocks. */
    sessionId: string;
    /** Already resolved for display: agent blocks carry the session title, never "Terminal". */
    title: string;
    isAgentLike: boolean;
    avatar: OverviewBoardAvatar;
    /** Display name ("Claude"/"Codex"); empty for non-agent blocks. */
    providerLabel: string;
    /** Fallback context chip: project basename, or the tab name when there is no project. */
    projectName: string;
    tabName: string;
    /** Non-agent blocks show their view name ("Terminal") as a muted chip; agents use "". */
    kindLabel: string;
    /** Last readable message, one line. Note lives on its own row. */
    preview: string;
    note: string;
    /** Recent-activity timestamp in ms; `0` hides the age label. */
    updatedAt: number;
};

export type ResolveBoardCardTitleInput = {
    isAgentLike: boolean;
    sessionTitle?: string | null;
    note?: string | null;
    projectName?: string | null;
    tabName?: string | null;
    providerLabel?: string | null;
    blockTitle?: string | null;
};

function cleanText(value: string | null | undefined): string {
    return value?.replace(/\s+/g, " ").trim() ?? "";
}

/** Known provider ids → display names. Unknown values are title-cased, never dropped. */
const ProviderDisplayLabels: Record<string, string> = {
    claude: "Claude",
    "claude-code": "Claude",
    codex: "Codex",
    openai: "OpenAI",
    gemini: "Gemini",
    "gemini-cli": "Gemini",
    opencode: "OpenCode",
    pi: "Pi",
    cursor: "Cursor",
    copilot: "Copilot",
    aider: "Aider",
    amp: "Amp",
    qwen: "Qwen",
    droid: "Droid",
    kimi: "Kimi",
    grok: "Grok",
};

export function providerDisplayLabel(provider: string | null | undefined): string {
    const normalized = cleanText(provider).toLowerCase();
    if (normalized === "" || normalized === "agent") return "";
    const known = ProviderDisplayLabels[normalized];
    if (known != null) return known;
    return normalized
        .split(/[-_\s]+/)
        .filter((part) => part !== "")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}

/** `~/projects/snorkeling` → `snorkeling`. Empty path stays empty. */
export function projectNameFromPath(path: string | null | undefined): string {
    const raw = cleanText(path);
    if (raw === "") return "";
    const name = basename(raw);
    // `basename("~")` === "~" and `basename("/")` === "/" — neither is a useful chip.
    if (name === "~" || name === "/" || name === ".") return "";
    return name;
}

/**
 * Agent cards show the session title, never the block view name ("Terminal").
 *
 * Chain: `sessionTitle → note → projectName → "Provider · tab" → "Agent"`.
 * Non-agent blocks keep the block title (which now falls back to the cwd basename).
 */
export function resolveBoardCardTitle(input: ResolveBoardCardTitleInput): string {
    const blockTitle = cleanText(input.blockTitle);
    const tabName = cleanText(input.tabName);
    if (!input.isAgentLike) {
        return blockTitle || tabName || "Untitled";
    }
    const sessionTitle = cleanText(input.sessionTitle);
    if (sessionTitle !== "") return sessionTitle;
    const note = cleanText(input.note);
    if (note !== "") return note;
    const projectName = cleanText(input.projectName);
    if (projectName !== "") return projectName;
    const providerLabel = cleanText(input.providerLabel);
    if (providerLabel !== "" && tabName !== "") return `${providerLabel} · ${tabName}`;
    return providerLabel || tabName || "Agent";
}

/** Compact age label for the card head (`now` / `12m` / `3h` / `2d`); "" hides it. */
export function formatBoardAge(updatedAtMs: number, nowMs: number): string {
    if (!updatedAtMs || updatedAtMs <= 0) return "";
    return formatCompactDuration(updatedAtMs, nowMs);
}

/** One-line preview used by the card body. Returns "" so callers can skip the node. */
export function truncateBoardPreview(text: string | null | undefined, maxLength = 120): string {
    const normalized = cleanText(text);
    if (normalized === "") return "";
    if (normalized.length <= maxLength) return normalized;
    return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
}

// ---------------------------------------------------------------------------
// View mode persistence (list | board), following the preview text-mode store.
// ---------------------------------------------------------------------------

export type OverviewViewMode = "list" | "board";

export const OverviewViewModeStorageKey = "snorkeling.overview.viewMode";

/** Default stays `list` so existing users see no behavior change on upgrade. */
export const OverviewViewModeDefault: OverviewViewMode = "list";

export type OverviewViewModeStorageLike = {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem?(key: string): void;
};

export function getDefaultOverviewViewModeStorage(): OverviewViewModeStorageLike | null {
    if (typeof window === "undefined") {
        return null;
    }
    try {
        return window.localStorage ?? null;
    } catch {
        return null;
    }
}

export function isOverviewViewMode(value: unknown): value is OverviewViewMode {
    return value === "list" || value === "board";
}

/** Corrupt / missing data falls back to the default, never throws. */
export function readOverviewViewMode(storage: OverviewViewModeStorageLike | null): OverviewViewMode {
    if (storage == null) return OverviewViewModeDefault;
    try {
        const raw = storage.getItem(OverviewViewModeStorageKey);
        return isOverviewViewMode(raw) ? raw : OverviewViewModeDefault;
    } catch {
        return OverviewViewModeDefault;
    }
}

/** Persist the mode. Returns the effective mode, or `null` when nothing was written. */
export function writeOverviewViewMode(
    storage: OverviewViewModeStorageLike | null,
    mode: OverviewViewMode
): OverviewViewMode | null {
    if (storage == null || !isOverviewViewMode(mode)) {
        return null;
    }
    try {
        storage.setItem(OverviewViewModeStorageKey, mode);
        return mode;
    } catch {
        return null;
    }
}

/** Cross-window sync: fires on `storage` events for our key (other renderers/windows). */
export function subscribeOverviewViewMode(
    callback: () => void,
    target: EventTarget | null = typeof window === "undefined" ? null : window
): () => void {
    if (target == null || typeof target.addEventListener !== "function") {
        return () => {};
    }
    const handleStorage = (event: Event) => {
        const key = (event as StorageEvent).key;
        if (key != null && key !== OverviewViewModeStorageKey) return;
        callback();
    };
    target.addEventListener("storage", handleStorage);
    return () => target.removeEventListener("storage", handleStorage);
}

const overviewViewModeStorage: SyncStorage<OverviewViewMode> = {
    getItem: () => readOverviewViewMode(getDefaultOverviewViewModeStorage()),
    setItem: (_key, value) => {
        writeOverviewViewMode(getDefaultOverviewViewModeStorage(), value);
    },
    removeItem: () => {
        const storage = getDefaultOverviewViewModeStorage();
        try {
            storage?.removeItem?.(OverviewViewModeStorageKey);
        } catch {
            // Ignore: a failed cleanup must not break rendering.
        }
    },
    subscribe: (_key, callback) =>
        subscribeOverviewViewMode(() => callback(readOverviewViewMode(getDefaultOverviewViewModeStorage()))),
};

export const overviewViewModeAtom = atomWithStorage<OverviewViewMode>(
    OverviewViewModeStorageKey,
    OverviewViewModeDefault,
    overviewViewModeStorage,
    { getOnInit: true }
);
