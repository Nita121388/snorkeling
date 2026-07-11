// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atoms, createBlock, globalStore } from "@/app/store/global";
import { CommonTextService } from "@/app/store/services";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";

export const CommonTextConfigKey = "commontext:items";
const CommonTextAllowEmptySaveKey = "commontext:allow-empty-save";

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
};

export type CommonTextDraft = {
    title: string;
    text: string;
    shortcut?: string;
    tags?: string[] | string;
    pinned?: boolean;
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
    };
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

export function sortCommonTextItems(items: CommonTextItem[]): CommonTextItem[] {
    return [...items].sort((a, b) => {
        if ((a.pinned ?? false) !== (b.pinned ?? false)) {
            return a.pinned ? -1 : 1;
        }
        const aUsed = a.lastusedat ?? 0;
        const bUsed = b.lastusedat ?? 0;
        if (aUsed !== bUsed) {
            return bUsed - aUsed;
        }
        const aUpdated = a.updatedat ?? 0;
        const bUpdated = b.updatedat ?? 0;
        if (aUpdated !== bUpdated) {
            return bUpdated - aUpdated;
        }
        return a.title.localeCompare(b.title);
    });
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

export function filterCommonTextItemsByTags(items: CommonTextItem[], selectedTags: string[]): CommonTextItem[] {
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
    selectedTags: string[] = []
): CommonTextItem[] {
    const tokens = query.trim().split(/\s+/).filter(Boolean);
    const tagFilteredItems = filterCommonTextItemsByTags(items, selectedTags);
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

export type CommonTextComposeSearchOptions = {
    limit?: number;
    selectedTags?: string[];
    caret?: number;
    insertedIds?: string[];
};

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
    const { limit = 40, selectedTags = [], caret = editor.length, insertedIds = [] } = options;
    const isManualSearch = manualQuery.trim() !== "";
    const tokenWeights = new Map<string, number>();
    if (isManualSearch) {
        addWeightedTokens(tokenWeights, manualQuery, 1, 1, 2);
    } else {
        for (const [token, weight] of getEditorTokenWeights(editor, caret)) {
            tokenWeights.set(token, weight);
        }
    }
    const baseItems = sortCommonTextItems(filterCommonTextItemsByTags(items, selectedTags));
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
    const duplicate = findDuplicateCommonText(items, text, existingId);
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
    const nextItems = getCommonTextItems().filter((item) => item.id !== id);
    await saveCommonTextItems(nextItems, { allowEmpty: nextItems.length === 0 });
}

export async function recordCommonTextUse(id: string): Promise<void> {
    const items = getCommonTextItems();
    const now = Date.now();
    const nextItems = items.map((item) =>
        item.id === id
            ? {
                  ...item,
                  lastusedat: now,
                  usagecount: (item.usagecount ?? 0) + 1,
              }
            : item
    );
    await saveCommonTextItems(nextItems);
}

export async function openCommonTextManager(): Promise<void> {
    await createBlock(
        {
            meta: {
                view: "waveconfig",
                file: "commontext",
            },
        },
        false,
        true
    );
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
