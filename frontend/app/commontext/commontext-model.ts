// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atoms, getApi, globalStore } from "@/app/store/global";
import { CommonTextService } from "@/app/store/services";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";

export const CommonTextConfigKey = "commontext:items";
const CommonTextAllowEmptySaveKey = "commontext:allow-empty-save";

export type CommonTextCreatedBy = {
    /** human = typed by a person, agent = written by an AI agent. */
    kind: "human" | "agent";
    /** OS user name for humans, agent name (pi / claude / codex) for agents. */
    name: string;
};

export type CommonTextOrigin = {
    /** Stable device id: generated once, never changes even if the device is renamed. */
    deviceid: string;
    /** Display name at creation time. Historical items keep the name they were created with. */
    devicename: string;
    platform: string;
};

export type CommonTextItem = {
    id: string;
    title: string;
    text: string;
    shortcut?: string;
    tags?: string[];
    pinned?: boolean;
    createdat: number;
    updatedat: number;
    lastusedat?: number;
    usagecount?: number;
    // Sync metadata. Optional because items written before sync existed have none of it;
    // normalizeCommonTextItem fills the same defaults the Go read path uses.
    /** Page icon (Notion-style page header). Empty/absent means no icon. */
    emoji?: string;
    createdby?: CommonTextCreatedBy;
    origin?: CommonTextOrigin;
    /** Per-item version used for conflict detection. */
    rev?: number;
    /** Tombstone: non-zero means deleted. */
    deletedat?: number;
    /**
     * 同步状态："pending" = 云端还没收到这一份内容，"synced" = 已确认。
     * 只读投影：由后端按 db_common_text_sync 的水位算出，保存时不回写（写路径会丢弃它）。
     */
    syncstate?: CommonTextSyncState;
    /** 云端确认过的该条目 rev（只读投影，用于详情展示）。 */
    syncedrev?: number;
};

export type CommonTextSyncState = "pending" | "synced";

/** Defaults for items written before sync metadata existed (mirrors the Go read path). */
export const LegacyCreatedBy: CommonTextCreatedBy = { kind: "human", name: "" };
export const LegacyOrigin: CommonTextOrigin = { deviceid: "local", devicename: "This machine", platform: "" };

/**
 * Current machine's platform, normalized to the same enum the Go side accepts
 * (win32 / darwin / linux). Unknown platforms fall back to "" so the property grid
 * just omits the platform segment instead of inventing a value.
 */
function currentPlatform(): string {
    try {
        const platform = getApi()?.getPlatform?.();
        if (platform === "win32" || platform === "darwin" || platform === "linux") return platform;
    } catch {
        // getApi is unavailable in tests / server-side renders; fall through.
    }
    return "";
}

/**
 * Origin stamped on an item created by this renderer.
 *
 * deviceid stays "local" until the sync transport layer starts minting stable device ids
 * (task 11-07-commontext-sync-transport). Writing the real platform now means the property
 * grid shows `This machine win32 · local` instead of a dangling separator, and the value
 * survives once device ids arrive without a migration.
 */
export function currentOrigin(): CommonTextOrigin {
    return { deviceid: LegacyOrigin.deviceid, devicename: LegacyOrigin.devicename, platform: currentPlatform() };
}

export type CommonTextDraft = {
    title: string;
    text: string;
    shortcut?: string;
    tags?: string[] | string;
    pinned?: boolean;
    emoji?: string;
};

export type CommonTextTagSummary = {
    tag: string;
    count: number;
};

export function normalizeCommonTextTitle(title: string, text: string): string {
    const normalizedTitle = title.trim();
    if (normalizedTitle !== "") {
        return normalizedTitle;
    }
    const firstLine = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line !== "");
    const fallback = firstLine || "Untitled text";
    return fallback.length > 48 ? `${fallback.slice(0, 45)}...` : fallback;
}

export function normalizeCommonTextTags(tags: unknown): string[] {
    const rawTags: unknown[] = Array.isArray(tags) ? tags : typeof tags === "string" ? tags.split(",") : [];
    const seen = new Set<string>();
    const rtn: string[] = [];
    for (const rawTag of rawTags) {
        if (typeof rawTag !== "string") {
            continue;
        }
        const normalized = rawTag.trim();
        if (normalized === "") {
            continue;
        }
        const lower = normalized.toLowerCase();
        if (seen.has(lower)) {
            continue;
        }
        seen.add(lower);
        rtn.push(normalized);
    }
    return rtn;
}

export function normalizeCommonTextItem(value: unknown): CommonTextItem | null {
    if (value == null || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }
    const raw = value as Record<string, unknown>;
    const text = typeof raw.text === "string" ? raw.text : "";
    if (text.trim() === "") {
        return null;
    }
    const now = Date.now();
    const id = typeof raw.id === "string" && raw.id !== "" ? raw.id : crypto.randomUUID();
    const title = normalizeCommonTextTitle(typeof raw.title === "string" ? raw.title : "", text);
    const shortcut = typeof raw.shortcut === "string" && raw.shortcut.trim() !== "" ? raw.shortcut.trim() : undefined;
    const tags = normalizeCommonTextTags(raw.tags as string[] | string | undefined);
    const createdat = typeof raw.createdat === "number" && Number.isFinite(raw.createdat) ? raw.createdat : now;
    const updatedat = typeof raw.updatedat === "number" && Number.isFinite(raw.updatedat) ? raw.updatedat : createdat;
    const lastusedat =
        typeof raw.lastusedat === "number" && Number.isFinite(raw.lastusedat) ? raw.lastusedat : undefined;
    const usagecount =
        typeof raw.usagecount === "number" && Number.isFinite(raw.usagecount) ? Math.max(0, raw.usagecount) : 0;
    const emoji = typeof raw.emoji === "string" && raw.emoji.trim() !== "" ? raw.emoji.trim() : undefined;
    const createdby = normalizeCommonTextCreatedBy(raw.createdby);
    const origin = normalizeCommonTextOrigin(raw.origin);
    const rev = typeof raw.rev === "number" && Number.isFinite(raw.rev) ? raw.rev : 0;
    const deletedat = typeof raw.deletedat === "number" && Number.isFinite(raw.deletedat) ? raw.deletedat : undefined;
    // 同步状态只认后端给出的两个值；其它（含缺失）一律按 pending —— 宁可多推一次，
    // 也不能把没上传的条目谎报成已同步。
    const syncstate: CommonTextSyncState = raw.syncstate === "synced" ? "synced" : "pending";
    const syncedrev =
        typeof raw.syncedrev === "number" && Number.isFinite(raw.syncedrev) ? raw.syncedrev : undefined;
    return {
        id,
        title,
        text,
        shortcut,
        tags,
        pinned: raw.pinned === true,
        createdat,
        updatedat,
        lastusedat,
        usagecount,
        emoji,
        createdby,
        origin,
        rev,
        deletedat,
        syncstate,
        syncedrev,
    };
}

function normalizeCommonTextCreatedBy(value: unknown): CommonTextCreatedBy {
    if (value == null || typeof value !== "object" || Array.isArray(value)) {
        return { ...LegacyCreatedBy };
    }
    const raw = value as Record<string, unknown>;
    const kind = raw.kind === "agent" ? "agent" : "human";
    const name = typeof raw.name === "string" ? raw.name : "";
    return { kind, name };
}

function normalizeCommonTextOrigin(value: unknown): CommonTextOrigin {
    if (value == null || typeof value !== "object" || Array.isArray(value)) {
        return { ...LegacyOrigin };
    }
    const raw = value as Record<string, unknown>;
    const deviceid = typeof raw.deviceid === "string" && raw.deviceid.trim() !== "" ? raw.deviceid : LegacyOrigin.deviceid;
    const devicename =
        typeof raw.devicename === "string" && raw.devicename.trim() !== "" ? raw.devicename : LegacyOrigin.devicename;
    const platform = typeof raw.platform === "string" ? raw.platform : "";
    return { deviceid, devicename, platform };
}

export function getCommonTextItemsFromSettings(settings: SettingsType | null | undefined): CommonTextItem[] {
    const rawItems = settings?.[CommonTextConfigKey] ?? [];
    if (!Array.isArray(rawItems)) {
        return [];
    }
    const items: CommonTextItem[] = [];
    const seenIds = new Set<string>();
    for (const rawItem of rawItems) {
        const item = normalizeCommonTextItem(rawItem);
        if (item == null || seenIds.has(item.id)) {
            continue;
        }
        seenIds.add(item.id);
        items.push(item);
    }
    return sortCommonTextItems(items);
}

export function getCommonTextItems(): CommonTextItem[] {
    return getCommonTextItemsFromSettings(globalStore.get(atoms.settingsAtom));
}

/** 墓碑（已删除待同步/已同步删除）不能在列表、重复检测和标签统计里出现。 */
export function isCommonTextTombstone(item: CommonTextItem): boolean {
    return (item.deletedat ?? 0) > 0;
}

/**
 * 可见条目 = 去掉墓碑。
 *
 * 与 `getCommonTextItems` 分开：那个函数是**写入源**（整表覆盖写盘），必须包含墓碑，
 * 否则一次普通保存就会把未上传的删除从库里抹掉，对端下次 pull 就把条目复活。
 */
export function getLiveCommonTextItems(items: CommonTextItem[]): CommonTextItem[] {
    return items.filter((item) => !isCommonTextTombstone(item));
}

/**
 * 列表排序键。`lastused-desc` 是历史行为，也是默认值；其余为用户在弹窗里可主动选的排序。
 * `created-asc`（Oldest first）不在图标控件里露出——没有既准确又不歧义的图标——但数据层
 * 保留该分支，需要时可加方向切换按钮。
 */
const CommonTextSortKeys = [
    "lastused-desc",
    "updated-desc",
    "created-desc",
    "created-asc",
    "usage-desc",
    "title-asc",
] as const;

// 类型从数组派生，避免"联合类型 + 运行期白名单"两份手写清单各自漂移。
export type CommonTextSortKey = (typeof CommonTextSortKeys)[number];

export const DefaultCommonTextSortKey: CommonTextSortKey = "lastused-desc";

/** 把来路不明的值（localStorage / 旧版本残留）收口成合法排序键。 */
export function normalizeCommonTextSortKey(value: unknown): CommonTextSortKey {
    return typeof value === "string" && (CommonTextSortKeys as readonly string[]).includes(value)
        ? (value as CommonTextSortKey)
        : DefaultCommonTextSortKey;
}

type CommonTextComparator = (a: CommonTextItem, b: CommonTextItem) => number;

const CommonTextPrimaryComparators: Record<CommonTextSortKey, CommonTextComparator> = {
    "lastused-desc": (a, b) => (b.lastusedat ?? 0) - (a.lastusedat ?? 0),
    "updated-desc": (a, b) => (b.updatedat ?? 0) - (a.updatedat ?? 0),
    "created-desc": (a, b) => (b.createdat ?? 0) - (a.createdat ?? 0),
    "created-asc": (a, b) => (a.createdat ?? 0) - (b.createdat ?? 0),
    "usage-desc": (a, b) => (b.usagecount ?? 0) - (a.usagecount ?? 0),
    "title-asc": (a, b) => a.title.localeCompare(b.title),
};

/**
 * 用户可选的排序。与 sortCommonTextItems 的两条不变量一致：
 * 1. `pinned` 恒在最前（浏览态与搜索态都保留该规则）；
 * 2. 主键并列时回落 `updatedat desc`，再回落 `title`，让「看起来一样新」的条目有稳定次序。
 *
 * 注意：不要把它塞进 sortCommonTextItems 的实现里当唯一入口——那个函数还决定
 * saveCommonTextItems 的写盘顺序与弹窗 selectedIndex / ↑↓ 落点，语义必须保持原样。
 */
export function sortCommonTextItemsBy(
    items: CommonTextItem[],
    key: CommonTextSortKey = DefaultCommonTextSortKey
): CommonTextItem[] {
    const primary = CommonTextPrimaryComparators[normalizeCommonTextSortKey(key)];
    return [...items].sort((a, b) => {
        if ((a.pinned ?? false) !== (b.pinned ?? false)) {
            return a.pinned ? -1 : 1;
        }
        const primaryDiff = primary(a, b);
        if (primaryDiff !== 0) {
            return primaryDiff;
        }
        const aUpdated = a.updatedat ?? 0;
        const bUpdated = b.updatedat ?? 0;
        if (aUpdated !== bUpdated) {
            return bUpdated - aUpdated;
        }
        return a.title.localeCompare(b.title);
    });
}

export function sortCommonTextItems(items: CommonTextItem[]): CommonTextItem[] {
    return sortCommonTextItemsBy(items, DefaultCommonTextSortKey);
}

export function getCommonTextTagSummaries(items: CommonTextItem[]): CommonTextTagSummary[] {
    const tagCounts = new Map<string, CommonTextTagSummary>();
    for (const item of items) {
        for (const normalizedTag of normalizeCommonTextTags(item.tags)) {
            const lower = normalizedTag.toLowerCase();
            const existing = tagCounts.get(lower);
            if (existing == null) {
                tagCounts.set(lower, { tag: normalizedTag, count: 1 });
            } else {
                existing.count += 1;
            }
        }
    }
    return Array.from(tagCounts.values()).sort((a, b) => {
        if (a.count !== b.count) {
            return b.count - a.count;
        }
        return a.tag.localeCompare(b.tag);
    });
}

export function filterCommonTextItemsByTags(
    items: CommonTextItem[],
    selectedTags: string[],
    opts?: { untagged?: boolean }
): CommonTextItem[] {
    // "untagged" 筛选与具体 tag 选择互斥：只看没有标签的条目，selectedTags 被忽略（
    // 否则"有 X 标签 AND 无标签"恒为空集）。空 tags 以 normalizeCommonTextTags 归一化
    // 后的长度为准，避免脏数据（如全空白字符串组成的 tags）误判为已打标签。
    if (opts?.untagged) {
        return items.filter((item) => normalizeCommonTextTags(item.tags).length === 0);
    }
    const normalizedSelectedTags = normalizeCommonTextTags(selectedTags).map((tag) => tag.toLowerCase());
    if (normalizedSelectedTags.length === 0) {
        return items;
    }
    return items.filter((item) => {
        const itemTagSet = new Set(normalizeCommonTextTags(item.tags).map((tag) => tag.toLowerCase()));
        return normalizedSelectedTags.every((tag) => itemTagSet.has(tag));
    });
}

function matchesToken(item: CommonTextItem, token: string): boolean {
    const target = [item.title, item.text, item.shortcut ?? "", ...(item.tags ?? [])].join("\n").toLowerCase();
    return target.includes(token.toLowerCase());
}

export function searchCommonTextItems(
    items: CommonTextItem[],
    query: string,
    limit = 40,
    selectedTags: string[] = [],
    untagged = false
): CommonTextItem[] {
    const tokens = query.trim().split(/\s+/).filter(Boolean);
    const tagFilteredItems = filterCommonTextItemsByTags(items, selectedTags, { untagged });
    const filtered =
        tokens.length === 0
            ? tagFilteredItems
            : tagFilteredItems.filter((item) => tokens.every((token) => matchesToken(item, token)));
    return sortCommonTextItems(filtered).slice(0, limit);
}

const WordSegmenter =
    typeof (Intl as any).Segmenter === "function"
        ? new (Intl as any).Segmenter(undefined, { granularity: "word" })
        : null;

export function tokenizeCommonTextQuery(
    query: string,
    minTokenLength = 2,
    segmentedMinTokenLength = minTokenLength
): string[] {
    const normalized = query.normalize("NFKC").trim().toLowerCase();
    if (normalized === "") {
        return [];
    }
    const tokens = new Set<string>();
    const addToken = (token: string, minLength: number) => {
        const normalizedToken = token.trim();
        if (Array.from(normalizedToken).length >= minLength) {
            tokens.add(normalizedToken);
        }
    };
    normalized.split(/\s+/).forEach((token) => addToken(token, minTokenLength));
    if (WordSegmenter != null) {
        for (const segment of WordSegmenter.segment(normalized)) {
            if (segment.isWordLike) {
                addToken(segment.segment, segmentedMinTokenLength);
            }
        }
    }
    return Array.from(tokens);
}

export type CommonTextCreatorFilter = "all" | "human" | "agent";

export type CommonTextComposeSearchOptions = {
    limit?: number;
    selectedTags?: string[];
    untagged?: boolean;
    caret?: number;
    insertedIds?: string[];
    // 浏览态（无搜索词）的列表次序。搜索态下由相关度决定，这里只当并列 tie-break。
    sortKey?: CommonTextSortKey;
    // 来源筛选：与 tag/查询正交叠加。creator 与 device 同时生效（AND）。
    creator?: CommonTextCreatorFilter;
    // "any" 与 "" 等价，都表示不限设备。
    device?: string;
};

/**
 * 条目的创建者类型。与 Go 读路径同规则：缺省即 human，未知值也按 human 处理
 * （宁可归到人类，也不要因为脏数据把条目从所有筛选里漏掉）。
 */
export function getCommonTextCreatorKind(item: CommonTextItem): "human" | "agent" {
    return item.createdby?.kind === "agent" ? "agent" : "human";
}

export function commonTextItemMatchesCreator(item: CommonTextItem, filter: CommonTextCreatorFilter | undefined): boolean {
    if (filter == null || filter === "all") return true;
    return getCommonTextCreatorKind(item) === filter;
}

export function commonTextItemMatchesDevice(item: CommonTextItem, device: string | undefined): boolean {
    const normalized = (device ?? "").trim();
    if (normalized === "" || normalized === "any") return true;
    return getCommonTextOriginDeviceId(item) === normalized;
}

export function getCommonTextOriginDeviceId(item: CommonTextItem): string {
    const id = item.origin?.deviceid?.trim();
    return id != null && id !== "" ? id : LegacyOrigin.deviceid;
}

export function getCommonTextOriginDeviceName(item: CommonTextItem): string {
    const name = item.origin?.devicename?.trim();
    return name != null && name !== "" ? name : LegacyOrigin.devicename;
}

/** 去重后的设备清单（按出现顺序），供筛选下拉与计数使用。 */
export function getCommonTextDeviceSummaries(items: CommonTextItem[]): { deviceid: string; devicename: string; count: number }[] {
    const byId = new Map<string, { deviceid: string; devicename: string; count: number }>();
    for (const item of items) {
        const id = getCommonTextOriginDeviceId(item);
        const existing = byId.get(id);
        if (existing == null) {
            byId.set(id, { deviceid: id, devicename: getCommonTextOriginDeviceName(item), count: 1 });
        } else {
            existing.count++;
        }
    }
    return [...byId.values()];
}

type CommonTextSearchFields = {
    title: string;
    text: string;
    shortcut: string;
    tags: string[];
};

function addWeightedTokens(
    tokens: Map<string, number>,
    text: string,
    contextTier: number,
    minTokenLength: number,
    segmentedMinTokenLength = minTokenLength
): void {
    for (const token of tokenizeCommonTextQuery(text, minTokenLength, segmentedMinTokenLength)) {
        tokens.set(token, Math.max(contextTier, tokens.get(token) ?? 0));
    }
}

function getCaretFragments(editor: string, caret: number): string[] {
    const boundedCaret = Math.max(0, Math.min(caret, editor.length));
    let start = boundedCaret;
    let end = boundedCaret;
    while (start > 0 && !/\s/.test(editor[start - 1])) start--;
    while (end < editor.length && !/\s/.test(editor[end])) end++;
    const rawFragment = editor.slice(start, end);
    const fragments = WordSegmenter == null || !/[\u3400-\u9fff]/.test(rawFragment) ? [rawFragment] : [];
    if (WordSegmenter == null) {
        return fragments;
    }
    for (const segment of WordSegmenter.segment(editor)) {
        const segmentEnd = segment.index + segment.segment.length;
        if (segment.isWordLike && segment.index <= boundedCaret && boundedCaret <= segmentEnd) {
            fragments.push(segment.segment);
            break;
        }
    }
    return fragments;
}

function getEditorTokenWeights(editor: string, caret: number): Map<string, number> {
    const tokens = new Map<string, number>();
    addWeightedTokens(tokens, editor, 1, 2);
    const boundedCaret = Math.max(0, Math.min(caret, editor.length));
    const lineStart = editor.lastIndexOf("\n", Math.max(0, boundedCaret - 1)) + 1;
    const nextNewline = editor.indexOf("\n", boundedCaret);
    const lineEnd = nextNewline === -1 ? editor.length : nextNewline;
    addWeightedTokens(tokens, editor.slice(lineStart, lineEnd), 2, 2);
    for (const fragment of getCaretFragments(editor, boundedCaret)) {
        addWeightedTokens(tokens, fragment, 3, 2);
    }
    return tokens;
}

function makeCommonTextSearchFields(item: CommonTextItem): CommonTextSearchFields {
    return {
        title: item.title.normalize("NFKC").toLowerCase(),
        text: item.text.normalize("NFKC").toLowerCase(),
        shortcut: (item.shortcut ?? "").normalize("NFKC").toLowerCase(),
        tags: (item.tags ?? []).map((tag) => tag.normalize("NFKC").toLowerCase()),
    };
}

function scoreCommonTextToken(fields: CommonTextSearchFields, token: string): number {
    if (fields.shortcut === token) return 12;
    if (fields.shortcut.includes(token)) return 10;
    if (fields.title === token) return 8;
    if (fields.title.includes(token)) return 6;
    if (fields.tags.some((tag) => tag === token)) return 5;
    if (fields.tags.some((tag) => tag.includes(token))) return 4;
    if (fields.text.includes(token)) return 2;
    return 0;
}

export function searchCommonTextComposeItems(
    items: CommonTextItem[],
    editor: string,
    manualQuery: string,
    options: CommonTextComposeSearchOptions = {}
): CommonTextItem[] {
    const {
        limit = 40,
        selectedTags = [],
        untagged = false,
        caret = editor.length,
        insertedIds = [],
        sortKey = DefaultCommonTextSortKey,
        creator = "all",
        device = "any",
    } = options;
    const isManualSearch = manualQuery.trim() !== "";
    const tokenWeights = new Map<string, number>();
    if (isManualSearch) {
        addWeightedTokens(tokenWeights, manualQuery, 1, 1, 2);
    } else {
        for (const [token, weight] of getEditorTokenWeights(editor, caret)) {
            tokenWeights.set(token, weight);
        }
    }
    // 来源筛选是硬过滤（AND），先于 tag/查询/排序执行：否则 limit 截断会把本该命中的行挤掉。
    const sourceFiltered = items.filter(
        (item) => commonTextItemMatchesCreator(item, creator) && commonTextItemMatchesDevice(item, device)
    );
    const baseItems = sortCommonTextItemsBy(filterCommonTextItemsByTags(sourceFiltered, selectedTags, { untagged }), sortKey);
    if (tokenWeights.size === 0) {
        return baseItems.slice(0, limit);
    }
    const baseOrder = new Map(baseItems.map((item, index) => [item.id, index]));
    const insertedIdSet = new Set(insertedIds);
    const scored: { item: CommonTextItem; contextScores: [number, number, number]; hits: number; inserted: boolean }[] =
        [];
    // ponytail: A local O(items * tokens) scan is enough for the <=500-item modal; add an index only if that ceiling changes.
    for (const item of baseItems) {
        const fields = makeCommonTextSearchFields(item);
        const contextScores: [number, number, number] = [0, 0, 0];
        let hits = 0;
        for (const [token, contextTier] of tokenWeights) {
            const fieldScore = scoreCommonTextToken(fields, token);
            if (fieldScore === 0) continue;
            contextScores[contextTier - 1] += fieldScore;
            hits++;
        }
        if (hits === 0) {
            continue;
        }
        scored.push({ item, contextScores, hits, inserted: !isManualSearch && insertedIdSet.has(item.id) });
    }
    scored.sort((a, b) => {
        if (b.contextScores[2] !== a.contextScores[2]) return b.contextScores[2] - a.contextScores[2];
        if (b.contextScores[1] !== a.contextScores[1]) return b.contextScores[1] - a.contextScores[1];
        if (a.inserted !== b.inserted) return a.inserted ? 1 : -1;
        if (b.contextScores[0] !== a.contextScores[0]) return b.contextScores[0] - a.contextScores[0];
        if (b.hits !== a.hits) return b.hits - a.hits;
        const baseDiff = (baseOrder.get(a.item.id) ?? 0) - (baseOrder.get(b.item.id) ?? 0);
        if (baseDiff !== 0) return baseDiff;
        return a.item.id.localeCompare(b.item.id);
    });
    return scored.slice(0, limit).map(({ item }) => item);
}

export type PagedSearchResult = {
    items: CommonTextItem[];
    total: number;
    hasMore: boolean;
};

const PAGE_SIZE = 20;

export async function searchCommonTextItemsPaged(
    query: string,
    selectedTags: string[],
    page: number
): Promise<PagedSearchResult> {
    const result = await CommonTextService.List({
        query,
        tagFilters: selectedTags,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
    });
    const items = (result?.items ?? [])
        .map(normalizeCommonTextItem)
        .filter((item): item is CommonTextItem => item != null);
    const total = items.length;
    const hasMore = total >= PAGE_SIZE;
    return { items, total, hasMore };
}

export function findDuplicateCommonText(
    items: CommonTextItem[],
    text: string,
    ignoreId?: string
): CommonTextItem | null {
    const normalized = text.trim();
    if (normalized === "") {
        return null;
    }
    return items.find((item) => item.id !== ignoreId && item.text.trim() === normalized) ?? null;
}

export async function saveCommonTextItems(items: CommonTextItem[], opts: { allowEmpty?: boolean } = {}): Promise<void> {
    await RpcApi.SetConfigCommand(TabRpcClient, {
        [CommonTextConfigKey]: sortCommonTextItems(items),
        ...(opts.allowEmpty ? { [CommonTextAllowEmptySaveKey]: true } : {}),
    } as SettingsType);
}

export async function upsertCommonTextItem(draft: CommonTextDraft, existingId?: string): Promise<CommonTextItem> {
    const items = getCommonTextItems();
    const now = Date.now();
    const existing = existingId ? items.find((item) => item.id === existingId) : null;
    const text = draft.text;
    // 重复检测只看活条目：一条已删（待同步墓碑）的旧内容不应该拦住用户重新添加同样的文本。
    const duplicate = findDuplicateCommonText(getLiveCommonTextItems(items), text, existingId);
    if (duplicate != null) {
        throw new Error(`Common text already exists: ${duplicate.title}`);
    }
    const item: CommonTextItem = {
        id: existing?.id ?? crypto.randomUUID(),
        title: normalizeCommonTextTitle(draft.title, text),
        text,
        shortcut: draft.shortcut?.trim() || undefined,
        tags: normalizeCommonTextTags(draft.tags),
        pinned: draft.pinned === true,
        createdat: existing?.createdat ?? now,
        updatedat: now,
        lastusedat: existing?.lastusedat,
        usagecount: existing?.usagecount ?? 0,
        emoji: draft.emoji !== undefined ? draft.emoji.trim() || undefined : existing?.emoji,
        // Provenance is set once at creation and preserved on edit: rewriting it on every save
        // would make an item look like it moved machines whenever it was touched.
        createdby: existing?.createdby ?? { ...LegacyCreatedBy },
        origin: existing?.origin ?? currentOrigin(),
        rev: existing?.rev ?? 0,
        deletedat: existing?.deletedat,
        // syncstate / syncedrev 刻意不拷：它们是后端投影，写路径会丢掉；带上只会让本地对象
        // 看起来“刚同步过”，而实际并没有。
    };
    const nextItems = existing == null ? [item, ...items] : items.map((cur) => (cur.id === item.id ? item : cur));
    await saveCommonTextItems(nextItems);
    return item;
}

export async function addSelectionToCommonText(text: string): Promise<CommonTextItem> {
    const cleanText = text.trim();
    if (cleanText === "") {
        throw new Error("Selected text is empty.");
    }
    return upsertCommonTextItem({ title: "", text: cleanText });
}

export async function deleteCommonTextItem(id: string): Promise<void> {
    // 删除 = 写墓碑（保留条目 + 时间戳），不是从数组里抹掉。
    // 抹掉的话同步层收不到任何信号：对端 pull 到它还比你「新」，于是已删条目被复活。
    const deletedAt = Date.now();
    const nextItems = getCommonTextItems().map((item) =>
        item.id === id ? { ...item, deletedat: deletedAt, updatedat: deletedAt } : item
    );
    await saveCommonTextItems(nextItems, { allowEmpty: nextItems.length === 0 });
}

export type RecordCommonTextUseOptions = {
    /**
     * 是否累加 usagecount，默认 true。新建条目时传 false：只刷新 lastusedat，让它排在
     * 「最近使用」默认排序的前排，但列表里显示的次数仍是 0 —— 新建不是一次使用。
     */
    countUsage?: boolean;
};

/** 纯函数：一次使用只会动 lastusedat（可选 usagecount），与写盘逻辑解耦、可单测。 */
export function markCommonTextUsed(item: CommonTextItem, now: number, countUsage = true): CommonTextItem {
    return {
        ...item,
        lastusedat: now,
        usagecount: countUsage ? (item.usagecount ?? 0) + 1 : (item.usagecount ?? 0),
    };
}

export async function recordCommonTextUse(id: string, opts: RecordCommonTextUseOptions = {}): Promise<void> {
    const countUsage = opts.countUsage ?? true;
    const now = Date.now();
    const nextItems = getCommonTextItems().map((item) =>
        item.id === id ? markCommonTextUsed(item, now, countUsage) : item
    );
    await saveCommonTextItems(nextItems);
}

/**
 * Returns the "current word" immediately before the caret in an input/textarea.
 * Used by the Compose Modal editor to drive the auto-association of the
 * Common Text list below it. Returns "" when the element has no caret info.
 */
export function getInlineQuery(target: HTMLInputElement | HTMLTextAreaElement): string {
    const text = target.value;
    const cursor = target.selectionStart ?? text.length;
    let start = cursor;
    while (start > 0 && !/\s/.test(text[start - 1])) {
        start--;
    }
    return text.slice(start, cursor).trim();
}
