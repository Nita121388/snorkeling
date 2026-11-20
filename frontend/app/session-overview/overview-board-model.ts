// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure logic for the Overview board view (status columns + view-mode persistence).
//
// Kept free of React so the grouping/ordering rules are directly unit-testable
// (same convention as `preview-text-modes.ts` / `session-overview-agent-status.ts`).
// The single rollout switch lives here: set `OVERVIEW_BOARD_ENABLED = false` and the
// panel goes back to the untouched list-only path.

import { i18n } from "@/i18n/config";
import { basename, formatCompactDuration } from "@/util/util";
import { formatDateTimeToSecond } from "@/app/view/aisessions/utils";
import type { ReactNode } from "react";
import {
    createPersistedEnum,
    getDefaultPersistedEnumStorage,
    type PersistedEnumStorageLike,
} from "./persisted-enum";

/** Single-file rollback switch: `false` restores the pure list view. */
export const OVERVIEW_BOARD_ENABLED = true;

/** Fixed column order: needs-attention first, then live work, then history. */
export const OverviewBoardStatuses = ["blocked", "working", "done", "idle", "stale"] as const;

export type OverviewBoardStatus = (typeof OverviewBoardStatuses)[number];

/** Column title keys (i18n Pattern F: translate at read time so a locale switch is picked up). */
const OverviewBoardColumnTitleKeys = {
    blocked: "session-overview:board.statusBlocked",
    working: "session-overview:board.statusWorking",
    done: "session-overview:board.statusDone",
    idle: "session-overview:board.statusIdle",
    stale: "session-overview:board.statusStale",
} as const satisfies Record<OverviewBoardStatus, string>;

/** 状态列标题；读时翻译（跟随当前 locale）。 */
export function getOverviewBoardColumnTitle(status: OverviewBoardStatus): string {
    return i18n.t(OverviewBoardColumnTitleKeys[status]);
}

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
        columns.push({ status, title: getOverviewBoardColumnTitle(status), blocks: columnBlocks });
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

/** 分组函数只需要这几个字段（不依赖卡片其余展示字段）。 */
export type OverviewBoardCardRef = {
    blockId: string;
    tabId: string;
    tabName: string;
    providerLabel: string;
    /** `basename(projectPath)`；空 = 无项目（目录分组里归「无项目」尾列）。 */
    projectName?: string;
    /** 会话 tags（已去 `#` 前缀）；空数组 = 无标签。 */
    tags?: readonly string[];
};

export function getOverviewBoardProviderFallbackTitle(): string {
    return i18n.t("session-overview:board.providerFallback");
}

export function getOverviewBoardProjectFallbackTitle(): string {
    return i18n.t("session-overview:board.projectFallback");
}

export function getOverviewBoardTagFallbackTitle(): string {
    return i18n.t("session-overview:board.tagFallback");
}

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
            column = {
                key,
                title: cleanText(card.tabName) || i18n.t("session-overview:dialog.untitled"),
                blocks: [],
            };
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
        const title = cleanText(card.providerLabel) || getOverviewBoardProviderFallbackTitle();
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
        const aFallback = a.title === getOverviewBoardProviderFallbackTitle();
        const bFallback = b.title === getOverviewBoardProviderFallbackTitle();
        if (aFallback !== bFallback) return aFallback ? 1 : -1;
        if (b.blocks.length !== a.blocks.length) return b.blocks.length - a.blocks.length;
        return a.title.localeCompare(b.title);
    });
}

/**
 * 目录分组：列 = `basename(projectPath)`。
 *
 * 列序 = 卡片数降序 → 标题升序；「无项目」永远最后（同 provider 的 fallback 规则）。
 * 不补空列：没有会话的项目不占屏。
 */
export function groupOverviewCardsByProject<T extends OverviewBoardCardRef>(
    cards: readonly T[]
): OverviewBoardColumnModel<T>[] {
    const columns = new Map<string, OverviewBoardColumnModel<T>>();
    for (const card of cards) {
        const project = cleanText(card.projectName);
        const title = project === "" ? getOverviewBoardProjectFallbackTitle() : project;
        const key = `project:${title}`;
        let column = columns.get(key);
        if (column == null) {
            column = { key, title, blocks: [] };
            columns.set(key, column);
        }
        column.blocks.push(card);
    }
    return [...columns.values()].sort((a, b) => {
        const aFallback = a.title === getOverviewBoardProjectFallbackTitle();
        const bFallback = b.title === getOverviewBoardProjectFallbackTitle();
        if (aFallback !== bFallback) return aFallback ? 1 : -1;
        if (b.blocks.length !== a.blocks.length) return b.blocks.length - a.blocks.length;
        return a.title.localeCompare(b.title);
    });
}

/**
 * 标签分组：列 = tags 并集。
 *
 * **一张卡可出现在多列**（多标签）：这是与其它分组唯一的语义差别 ——
 * 因此「列计数之和 = 卡片数」在这个口径下不成立（是 `>=`）。
 * 列序 = 字母序；「无标签」永远最后。
 */
export function groupOverviewCardsByTags<T extends OverviewBoardCardRef>(
    cards: readonly T[]
): OverviewBoardColumnModel<T>[] {
    const columns = new Map<string, OverviewBoardColumnModel<T>>();
    const add = (card: T, title: string) => {
        const key = `tag:${title}`;
        let column = columns.get(key);
        if (column == null) {
            column = { key, title, blocks: [] };
            columns.set(key, column);
        }
        // 同一张卡在同一个 tag 列里只出现一次（tags 里去重过了，这里再兜一层）。
        if (!column.blocks.includes(card)) column.blocks.push(card);
    };
    for (const card of cards) {
        const tags = [...new Set((card.tags ?? []).map((tag) => cleanText(tag).replace(/^#+/, "")).filter((t) => t !== ""))];
        if (tags.length === 0) {
            add(card, getOverviewBoardTagFallbackTitle());
            continue;
        }
        for (const tag of tags) add(card, tag);
    }
    return [...columns.values()].sort((a, b) => {
        const aFallback = a.title === getOverviewBoardTagFallbackTitle();
        const bFallback = b.title === getOverviewBoardTagFallbackTitle();
        if (aFallback !== bFallback) return aFallback ? 1 : -1;
        return a.title.localeCompare(b.title);
    });
}

/**
 * 分组分发器。
 *
 * - `status`：固定列 + `includeEmpty`（看板常显 5 列）
 * - `tab` / `provider` / `project` / `tags`：只渲染有卡的列（空列对它们没有语义）
 */
export function groupOverviewCards<T extends OverviewBoardCardRef>(
    cards: readonly T[],
    presentedStatuses: Readonly<Record<string, OverviewBoardStatusInput>>,
    group: OverviewBoardGroup,
    opts: OverviewBoardGroupOptions = {}
): OverviewBoardColumnModel<T>[] {
    if (group === "tab") return groupOverviewCardsByTab(cards);
    if (group === "provider") return groupOverviewCardsByProvider(cards);
    if (group === "project") return groupOverviewCardsByProject(cards);
    if (group === "tags") return groupOverviewCardsByTags(cards);
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
    /**
     * Raw provider key ("pi"/"codex"/…), NOT the display label. The emoji avatar
     * hotzone needs it (`openAgentEmojiPicker` keys off the raw provider); empty
     * for non-agent blocks and for agent blocks without a resolvable provider.
     */
    provider?: string;
    /** Fallback context chip: project basename, or the tab name when there is no project. */
    projectName: string;
    /** Session tags (no `#` prefix). Empty for non-agent blocks and untagged sessions. */
    tags: readonly string[];
    /** 自定义属性（有值才显示）：归一后行 + 溢出计数（resolveBoardPropRows 产物）。 */
    propRows: BoardPropRows;
    tabName: string;
    /** Non-agent blocks show their view name ("Terminal") as a muted chip; agents use "". */
    kindLabel: string;
    /** Last readable message, one line. Note lives on its own row. */
    preview: string;
    note: string;
    /** Recent-activity timestamp in ms; `0` hides the age label. */
    updatedAt: number;
    /** Session creation timestamp in ms（已归一化）; `0` hides the created metric. */
    createdAt?: number;
    /** `SessionSummary.messageCount`; `0`/undefined hides the heat cell. */
    messageCount?: number;
    /** `SessionSummary.size` in bytes; `0`/undefined hides the heat cell. */
    size?: number;
    /** `SessionSummary.live`：活跃跨度的终点走到 now，而不是停在最后一次活动。 */
    live?: boolean;
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
        return blockTitle || tabName || i18n.t("session-overview:dialog.untitled");
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

/**
 * 会话 tags 归一：去 `#` 前缀、去空白、去重、保序。
 *
 * 与 aisessions 的 `normalizeSessionTags` 同口径（那边是列表/Badge 用），但这里不 import
 * view 层模块 —— overview 的纯函数不能反向依赖 aisessions。
 */
export function normalizeBoardTags(tags: readonly string[] | null | undefined): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const raw of tags ?? []) {
        const tag = cleanText(raw).replace(/^#+/, "");
        if (tag === "" || seen.has(tag)) continue;
        seen.add(tag);
        result.push(tag);
    }
    return result;
}

export type BoardTagChips = {
    visible: string[];
    hiddenCount: number;
};

/**
 * 卡片上最多显示几个标签 + 溢出的 `+n` 计数。
 *
 * 卡片高度不能因为标签多而跳动（`flex-wrap: nowrap` + 截断），所以这里给硬上限。
 */
export function resolveBoardTagChips(
    tags: readonly string[] | null | undefined,
    max = 3
): BoardTagChips {
    const normalized = normalizeBoardTags(tags);
    const limit = Number.isFinite(max) ? Math.max(0, Math.floor(max)) : normalized.length;
    if (normalized.length <= limit) {
        return { visible: normalized, hiddenCount: 0 };
    }
    return { visible: normalized.slice(0, limit), hiddenCount: normalized.length - limit };
}

/** Compact age label for the card head (`now` / `12m` / `3h` / `2d`); "" hides it. */
export function formatBoardAge(updatedAtMs: number, nowMs: number): string {
    if (!updatedAtMs || updatedAtMs <= 0) return "";
    return formatCompactDuration(updatedAtMs, nowMs);
}

/**
 * 卡头 age 的完整说法（`title` / `aria-label`）。
 *
 * 动机（真机抓到）：卡片右上只有一个裸的 `1d`，既无 tooltip 也无 aria-label，用户无法判断
 * 它与状态 chip 的 `Working 12m`、度量轨的 `↔3d` 有什么区别。三者起点不同
 * （最后一次活动 / 当前 phase / 创建），文字上必须能各自说清。
 */
export function formatBoardAgeTitle(updatedAtMs: number, nowMs: number): string {
    const age = formatBoardAge(updatedAtMs, nowMs);
    if (age === "") return "";
    const relative =
        age === "now"
            ? i18n.t("session-overview:board.ageNow")
            : i18n.t("session-overview:board.ageAgo", { age });
    return i18n.t("session-overview:board.lastActivity", {
        datetime: formatDateTimeToSecond(updatedAtMs),
        relative,
    });
}

/**
 * 卡片 meta 行的「视图名兜底标签」文案；返回 "" 表示整个节点不渲染。
 *
 * 2026-11-09 真机：agent-like 卡的 kindLabel 恒为 ""（状态 chip 接管），
 * 但无 AgentStatus 时看板仍无条件渲染兜底 span —— 该 class 带 border/padding，
 * 空串也会画成一个空胶囊。列表视图早已按 status 判空，这里把同一收口收成纯函数。
 */
export function resolveBoardMetaLabel({
    hasStatusChip,
    kindLabel,
}: {
    hasStatusChip: boolean;
    kindLabel: string;
}): string {
    if (hasStatusChip) return "";
    return cleanText(kindLabel);
}

/** One-line preview used by the card body. Returns "" so callers can skip the node. */export function truncateBoardPreview(text: string | null | undefined, maxLength = 120): string {
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

/** 真正有渲染分支的视图。新增视图时：这里加值 + panel 加渲染分支 + validator 自动跟着放行。 */
export const OverviewViewModesImplemented = ["list", "board", "timeline"] as const;

export type OverviewViewModeImplemented = (typeof OverviewViewModesImplemented)[number];

export const OverviewViewModeStorageKey = "snorkeling.overview.viewMode";

/** Default stays `list` so existing users see no behavior change on upgrade. */
export const OverviewViewModeDefault: OverviewViewMode = "list";

/** 看板列的分组口径。project / tags 是 2026-11-06 新增的两种“按归属看”的口径。 */
export const OverviewBoardGroups = ["status", "tab", "provider", "project", "tags"] as const;

export type OverviewBoardGroup = (typeof OverviewBoardGroups)[number];

export const OverviewBoardGroupStorageKey = "snorkeling.overview.boardGroup";

export const OverviewBoardGroupDefault: OverviewBoardGroup = "status";

/** @deprecated 使用 `persisted-enum.ts` 的 `PersistedEnumStorageLike`；保留别名避免老测试改动。 */
export type OverviewViewModeStorageLike = PersistedEnumStorageLike;

export function getDefaultOverviewViewModeStorage(): OverviewViewModeStorageLike | null {
    return getDefaultPersistedEnumStorage();
}

export function isOverviewViewMode(value: unknown): value is OverviewViewMode {
    return typeof value === "string" && (OverviewViewModesImplemented as readonly string[]).includes(value);
}

export function isOverviewBoardGroup(value: unknown): value is OverviewBoardGroup {
    return typeof value === "string" && (OverviewBoardGroups as readonly string[]).includes(value);
}

const viewModeStorage = createPersistedEnum(
    OverviewViewModeStorageKey,
    isOverviewViewMode,
    OverviewViewModeDefault
);

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

export const overviewViewModeAtom = viewModeStorage.atom;

export const boardGroupStorage = createPersistedEnum(
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

export const overviewBoardGroupAtom = boardGroupStorage.atom;

// ---------------------------------------------------------------------------
// 看板卡自定义属性（props）归一 —— 纯函数，无反向依赖。
//
// PropertyCell 自描述（type/name/order 冗余在 cell 上，schema 只是可选补全），
// 因此即使全局模板缺失，老数据也能正确渲染（零迁移）。
// 不 import aisessions view 层：结构兼容 + 本地 humanize/hash 双拷贝，
// 保持本文件可被任何渲染面独立引用。
// ---------------------------------------------------------------------------

/** 内置属性 key（note/tags/starred/title_source/created_at/updated_at 已由卡片既有行渲染）；含驼峰变体以兼容历史数据。 */
const BoardBuiltinPropKeys: ReadonlySet<string> = new Set([
    "note",
    "tags",
    "starred",
    "title_source",
    "titleSource",
    "created_at",
    "createdAt",
    "updated_at",
    "updatedAt",
]);

/** Notion 9 色调色板（与 aisessions property-model 同序）——哈希上色保证同值同色。 */
const BoardPropTagColors = ["blue", "green", "yellow", "orange", "red", "purple", "pink", "brown", "gray"] as const;

export type BoardPropColorToken = (typeof BoardPropTagColors)[number];

/** `my_custom_field` → `My Custom Field`（与 property-model.humanizeKey 同口径的本地拷贝）。 */
export function humanizeBoardPropKey(key: string): string {
    return key
        .replace(/[_-]+/g, " ")
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/\b\w/g, (c) => c.toUpperCase())
        .trim();
}

/** 稳定字符串 → 调色板颜色（与 property-model.tagToOption 同哈希，跨面同值同色）。 */
export function boardPropColorFor(value: string): BoardPropColorToken {
    const clean = value.replace(/^#+/, "").trim().toLowerCase();
    let hash = 0;
    for (let i = 0; i < clean.length; i++) {
        hash = (hash * 31 + clean.charCodeAt(i)) >>> 0;
    }
    return BoardPropTagColors[hash % BoardPropTagColors.length];
}

/** 自定义属性的一行展示形态（卡片渲染只读；编辑在整卡弹窗里）。 */
export type BoardPropRow = {
    key: string;
    /** cell.name || humanizeKey(key)。 */
    name: string;
    /** 归一后的类型字符串（select/status/multi_select/person/checkbox/text/number/url/date）。 */
    type: string;
    /** select / status 单值：着色胶囊 + 哈希色。 */
    single?: { value: string; color: BoardPropColorToken };
    /** multi_select / person / relation 多值 chips。 */
    multi?: readonly string[];
    /** checkbox：仅 true（false 已在空值过滤中剔除）。 */
    checked?: boolean;
    /** text / number / url：单行文本（已 String 化）。 */
    text?: string;
};

export type BoardPropRows = {
    visible: BoardPropRow[];
    hiddenCount: number;
};

/** 与 PropertyCell 结构兼容的本地形状（避免反向依赖）。 */
type BoardPropCellLike = {
    value: unknown;
    name?: string;
    type?: string;
    order?: number;
};

type BoardPropSchemaLike = {
    key?: string;
    name?: string;
    type?: string;
    options?: readonly string[];
};

function isBoardPropEmpty(type: string, value: unknown): boolean {
    if (type === "checkbox") return value !== true;
    if (Array.isArray(value)) return value.length === 0;
    if (value == null) return true;
    return String(value).trim() === "";
}

function boardPropStrings(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value.map((v) => String(v)).filter((v) => v.trim() !== "");
    }
    if (value == null || String(value).trim() === "") return [];
    return [String(value)];
}

function boardPropTypeOf(cellType: string | null | undefined, value: unknown): string {
    const known: ReadonlySet<string> = new Set([
        "text",
        "number",
        "select",
        "multi_select",
        "status",
        "date",
        "person",
        "checkbox",
        "url",
        "formula",
        "relation",
    ]);
    const t = (cellType ?? "").trim();
    if (known.has(t)) return t;
    if (Array.isArray(value)) return "multi_select";
    if (typeof value === "boolean") return "checkbox";
    if (typeof value === "number") return "number";
    return "text";
}

function boardPropTypeName(type: string): string {
    return type;
}
/**
 * props → 卡片可渲染的属性行（有值才显示）。
 *
 * - 过滤内置 key（卡片已有 note/tags 等行）与空值（null/""/[]/checkbox false）
 * - 排序：order > 0 按 order，否则保持插入序（Object.keys 稳定）
 * - select/status 单值单色胶囊；multi 变 chips；checkbox 只留 true；其余单行文本
 * - max 上限截断，溢出进 hiddenCount（卡片高度不因属性多而跳动，与 tags 同策略）
 */
export function resolveBoardPropRows(
    props: { [key: string]: BoardPropCellLike } | null | undefined,
    _schema?: readonly BoardPropSchemaLike[] | null | undefined,
    max = 3
): BoardPropRows {
    const limit = Number.isFinite(max) ? Math.max(0, Math.floor(max)) : Number.MAX_SAFE_INTEGER;
    if (props == null) return { visible: [], hiddenCount: 0 };

    const rows: BoardPropRow[] = [];
    const orderBy: Map<string, number> = new Map();
    const insertionIndex: Map<string, number> = new Map();
    let seq = 0;
    for (const key of Object.keys(props)) {
        if (BoardBuiltinPropKeys.has(key)) continue;
        const cell = props[key];
        if (cell == null) continue;
        const type = boardPropTypeOf(cell.type, cell.value);
        if (isBoardPropEmpty(type, cell.value)) continue;
        const name = (cell.name ?? "").trim() || humanizeBoardPropKey(key);
        const row: BoardPropRow = { key, name, type };
        if (type === "multi_select" || type === "person" || type === "relation") {
            row.multi = boardPropStrings(cell.value);
        } else if (type === "checkbox") {
            row.checked = cell.value === true;
        } else if (type === "select" || type === "status") {
            const single = boardPropStrings(cell.value)[0];
            if (single != null) row.single = { value: single, color: boardPropColorFor(single) };
        } else if (type === "formula" || type === "created_time" || type === "updated_time") {
            continue; // 只读派生行，卡片上不占位置
        } else {
            const text = boardPropStrings(cell.value)[0] ?? "";
            if (text !== "") row.text = text;
        }
        if (row.single == null && row.multi == null && row.checked == null && row.text == null) continue;
        const rawOrder = typeof cell.order === "number" && cell.order > 0 ? cell.order : 0;
        orderBy.set(key, rawOrder);
        insertionIndex.set(key, seq++);
        rows.push(row);
    }

    // 有 order（>0）的按 order 升序在前；无 order 的按插入序在后。
    rows.sort((a, b) => {
        const ao = orderBy.get(a.key) ?? 0;
        const bo = orderBy.get(b.key) ?? 0;
        const aHas = ao > 0 ? 0 : 1;
        const bHas = bo > 0 ? 0 : 1;
        if (aHas !== bHas) return aHas - bHas;
        if (ao !== bo) return ao - bo;
        return (insertionIndex.get(a.key) ?? 0) - (insertionIndex.get(b.key) ?? 0);
    });

    const visible = rows.length <= limit ? rows : rows.slice(0, limit);
    const hiddenCount = rows.length > limit ? rows.length - limit : 0;
    return { visible, hiddenCount };
}
