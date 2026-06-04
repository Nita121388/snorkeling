// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atoms, createBlock, globalStore } from "@/app/store/global";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";

export const CommonTextConfigKey = "commontext:items";

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

export async function saveCommonTextItems(items: CommonTextItem[]): Promise<void> {
    await RpcApi.SetConfigCommand(TabRpcClient, {
        [CommonTextConfigKey]: sortCommonTextItems(items),
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
    await saveCommonTextItems(nextItems);
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
