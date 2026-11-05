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
// Board grouping (status / tab / provider)
//
// 渲染层只认 `OverviewBoardColumnModel`：状态分组带 tone（列头色点），
// tab / provider 分组没有 tone，也不补空列（空列只在"状态列"这种固定列集合里才有意义）。
// ---------------------------------------------------------------------------

export type OverviewBoardColumnModel<T extends { blockId: string } = OverviewBoardCardRef> = {
    /** 稳定 key：`status:working` / `tab:<tabId>` / `provider:Claude`。 */
    key: string;
    title: string;
    /** 只有 status 分组有值：决定列头状态色点。 */
    tone?: OverviewBoardStatus;
    blocks: T[];
};

/** 分组函数只需要这三个字段（不依赖卡片其余展示字段）。 */
export type OverviewBoardCardRef = {
    blockId: string;
    tabId: string;
    tabName: string;
    providerLabel: string;
};

export const OverviewBoardProviderFallbackTitle = "非 Agent";

/** 状态分组：沿用固定 5 列 + `includeEmpty` 常显语义。 */
export function groupOverviewCardsByStatus<T extends OverviewBoardCardRef>(
    cards: readonly T[],
    presentedStatuses: Readonly<Record<string, OverviewBoardStatusInput>>,
    opts: OverviewBoardGroupOptions = {}
): OverviewBoardColumnModel<T>[] {
    const columns = groupBlocksByStatus(cards, presentedStatuses, opts);
    return columns.map((column) => ({
        key: `status:${column.status}`,
        title: column.title,
        tone: column.status,
        blocks: column.blocks,
    }));
}

/** Tab 分组：列序 = 卡片首次出现顺序（caller 传进来的就是 workspace Tab 顺序），不补空列。 */
export function groupOverviewCardsByTab<T extends OverviewBoardCardRef>(
    cards: readonly T[]
): OverviewBoardColumnModel<T>[] {
    const columns = new Map<string, OverviewBoardColumnModel<T>>();
    for (const card of cards) {
        const key = `tab:${card.tabId}`;
        let column = columns.get(key);
        if (column == null) {
            column = { key, title: cleanText(card.tabName) || "Untitled", blocks: [] };
            columns.set(key, column);
        }
        column.blocks.push(card);
    }
    return [...columns.values()];
}

/**
 * Provider 分组：列序 = 卡片数降序 → 标题升序（最活跃的 agent 排最左）。
 * 没有 provider 的块（普通 term / 未知）归「非 Agent」，不丢卡。
 */
export function groupOverviewCardsByProvider<T extends OverviewBoardCardRef>(
    cards: readonly T[]
): OverviewBoardColumnModel<T>[] {
    const columns = new Map<string, OverviewBoardColumnModel<T>>();
    for (const card of cards) {
        const title = cleanText(card.providerLabel) || OverviewBoardProviderFallbackTitle;
        const key = `provider:${title}`;
        let column = columns.get(key);
        if (column == null) {
            column = { key, title, blocks: [] };
            columns.set(key, column);
        }
        column.blocks.push(card);
    }
    return [...columns.values()].sort((a, b) => {
        // 「非 Agent」永远排最后（普通 term 块不该抢 agent 的位置），再按活跃度降序、名称升序。
        const aFallback = a.title === OverviewBoardProviderFallbackTitle;
        const bFallback = b.title === OverviewBoardProviderFallbackTitle;
        if (aFallback !== bFallback) return aFallback ? 1 : -1;
        if (b.blocks.length !== a.blocks.length) return b.blocks.length - a.blocks.length;
        return a.title.localeCompare(b.title);
    });
}

/**
 * 分组分发器。
 *
 * - `status`：固定列 + `includeEmpty`（看板常显 5 列）
 * - `tab` / `provider`：只渲染有卡的列（空列对它们没有语义）
 */
export function groupOverviewCards<T extends OverviewBoardCardRef>(
    cards: readonly T[],
    presentedStatuses: Readonly<Record<string, OverviewBoardStatusInput>>,
    group: OverviewBoardGroup,
    opts: OverviewBoardGroupOptions = {}
): OverviewBoardColumnModel<T>[] {
    if (group === "tab") return groupOverviewCardsByTab(cards);
    if (group === "provider") return groupOverviewCardsByProvider(cards);
    return groupOverviewCardsByStatus(cards, presentedStatuses, opts);
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
// View mode + board grouping persistence
//
// 两个枚举都走同一个「localStorage + atomWithStorage + storage 事件跨窗口同步」工厂，
// 免得每加一个开关就复制 60 行读写/回落/订阅样板。
//
// `timeline` 已经写进 ViewMode 联合类型（D 的接口预留），但**不在已实现集合里**：
// 校验只放行已实现值，未来版本写进来的 timeline 在旧版本降级成 list，而不是白屏。
// ---------------------------------------------------------------------------

export type OverviewViewMode = "list" | "board" | "timeline";

/** 真正有渲染分支的视图；D 接入 timeline 时把 "timeline" 加进来即可。 */
export const OverviewViewModesImplemented = ["list", "board"] as const;

export const OverviewViewModeStorageKey = "snorkeling.overview.viewMode";

/** Default stays `list` so existing users see no behavior change on upgrade. */
export const OverviewViewModeDefault: OverviewViewMode = "list";

/** 看板列的分组口径。 */
export const OverviewBoardGroups = ["status", "tab", "provider"] as const;

export type OverviewBoardGroup = (typeof OverviewBoardGroups)[number];

export const OverviewBoardGroupStorageKey = "snorkeling.overview.boardGroup";

export const OverviewBoardGroupDefault: OverviewBoardGroup = "status";

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
    return typeof value === "string" && (OverviewViewModesImplemented as readonly string[]).includes(value);
}

export function isOverviewBoardGroup(value: unknown): value is OverviewBoardGroup {
    return typeof value === "string" && (OverviewBoardGroups as readonly string[]).includes(value);
}

type PersistedEnum<T extends string> = {
    key: string;
    read: (storage: OverviewViewModeStorageLike | null) => T;
    write: (storage: OverviewViewModeStorageLike | null, value: T) => T | null;
    subscribe: (callback: () => void, target?: EventTarget | null) => () => void;
    syncStorage: SyncStorage<T>;
};

function createPersistedEnum<T extends string>(
    key: string,
    isValue: (value: unknown) => value is T,
    fallback: T
): PersistedEnum<T> {
    const read = (storage: OverviewViewModeStorageLike | null): T => {
        if (storage == null) return fallback;
        try {
            const raw = storage.getItem(key);
            return isValue(raw) ? raw : fallback;
        } catch {
            return fallback;
        }
    };
    const write = (storage: OverviewViewModeStorageLike | null, value: T): T | null => {
        if (storage == null || !isValue(value)) return null;
        try {
            storage.setItem(key, value);
            return value;
        } catch {
            return null;
        }
    };
    const subscribe = (
        callback: () => void,
        target: EventTarget | null = typeof window === "undefined" ? null : window
    ): (() => void) => {
        if (target == null || typeof target.addEventListener !== "function") {
            return () => {};
        }
        const handleStorage = (event: Event) => {
            const eventKey = (event as StorageEvent).key;
            if (eventKey != null && eventKey !== key) return;
            callback();
        };
        target.addEventListener("storage", handleStorage);
        return () => target.removeEventListener("storage", handleStorage);
    };
    const syncStorage: SyncStorage<T> = {
        getItem: () => read(getDefaultOverviewViewModeStorage()),
        setItem: (_key, value) => {
            write(getDefaultOverviewViewModeStorage(), value);
        },
        removeItem: () => {
            const storage = getDefaultOverviewViewModeStorage();
            try {
                storage?.removeItem?.(key);
            } catch {
                // Ignore: a failed cleanup must not break rendering.
            }
        },
        subscribe: (_key, callback) => subscribe(() => callback(read(getDefaultOverviewViewModeStorage()))),
    };
    return { key, read, write, subscribe, syncStorage };
}

const viewModeStorage = createPersistedEnum(OverviewViewModeStorageKey, isOverviewViewMode, OverviewViewModeDefault);

/** Corrupt / missing data falls back to the default, never throws. */
export function readOverviewViewMode(storage: OverviewViewModeStorageLike | null): OverviewViewMode {
    return viewModeStorage.read(storage);
}

/** Persist the mode. Returns the effective mode, or `null` when nothing was written. */
export function writeOverviewViewMode(
    storage: OverviewViewModeStorageLike | null,
    mode: OverviewViewMode
): OverviewViewMode | null {
    return viewModeStorage.write(storage, mode);
}

/** Cross-window sync: fires on `storage` events for our key (other renderers/windows). */
export function subscribeOverviewViewMode(
    callback: () => void,
    target: EventTarget | null = typeof window === "undefined" ? null : window
): () => void {
    return viewModeStorage.subscribe(callback, target);
}

export const overviewViewModeAtom = atomWithStorage<OverviewViewMode>(
    OverviewViewModeStorageKey,
    OverviewViewModeDefault,
    viewModeStorage.syncStorage,
    { getOnInit: true }
);

const boardGroupStorage = createPersistedEnum(
    OverviewBoardGroupStorageKey,
    isOverviewBoardGroup,
    OverviewBoardGroupDefault
);

export function readOverviewBoardGroup(storage: OverviewViewModeStorageLike | null): OverviewBoardGroup {
    return boardGroupStorage.read(storage);
}

export function writeOverviewBoardGroup(
    storage: OverviewViewModeStorageLike | null,
    group: OverviewBoardGroup
): OverviewBoardGroup | null {
    return boardGroupStorage.write(storage, group);
}

export const overviewBoardGroupAtom = atomWithStorage<OverviewBoardGroup>(
    OverviewBoardGroupStorageKey,
    OverviewBoardGroupDefault,
    boardGroupStorage.syncStorage,
    { getOnInit: true }
);
