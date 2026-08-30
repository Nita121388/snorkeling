// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Emoji catalog + search (方案 05 §1). Source of truth: emojibase-data (en + zh labels,
 * github shortcodes), pinyin derivation via pinyin-pro for Chinese-first-letter search.
 * Everything here is pure once loaded; loading is lazy (dynamic import) so the ~500KB
 * payload only enters memory on first trigger.
 */

export interface EmojiEntry {
    char: string;
    labelEn: string;
    labelZh: string;
    shortcode: string; // github shortcode, e.g. "smile"
    keywords: string[]; // en label words + tags + zh label
    group: number;
    /** Skin-tone variants (["👍🏻", …]); empty when unsupported. */
    skins: string[];
    /** Derived pinyin forms of labelZh: full ("weixiao") and initials ("wx"). */
    pinyin: string[];
}

export interface EmojiCatalog {
    entries: EmojiEntry[];
}

export const EMOJI_GROUP_LABELS: Record<number, string> = {
    0: "Smileys",
    1: "People",
    2: "Animals & Nature",
    3: "Food & Drink",
    4: "Travel & Places",
    5: "Activities",
    6: "Objects",
    7: "Symbols",
    8: "Flags",
};

const RECENT_KEY = "snorkeling:recent-emoji";
const RECENT_MAX = 24;

let catalogCache: EmojiCatalog | null = null;
let catalogPromise: Promise<EmojiCatalog> | null = null;

/** Lazily load + build the catalog. Idempotent; safe to call repeatedly. */
export function loadEmojiCatalog(): Promise<EmojiCatalog> {
    if (catalogCache != null) {
        return Promise.resolve(catalogCache);
    }
    if (catalogPromise != null) {
        return catalogPromise;
    }
    catalogPromise = (async () => {
        const [en, zh, shortcodes, pinyinMod] = await Promise.all([
            import("emojibase-data/en/data.json"),
            import("emojibase-data/zh/data.json"),
            import("emojibase-data/en/shortcodes/github.json"),
            import("pinyin-pro"),
        ]);
        const zhLabel = new Map<string, string>();
        for (const z of (zh as any).default ?? zh) {
            if (z.hexcode != null && z.label != null) {
                zhLabel.set(z.hexcode, z.label);
            }
        }
        const scMap: Record<string, string[] | string> = (shortcodes as any).default ?? shortcodes;
        const pinyinFn = (pinyinMod as any).pinyin as (
            text: string,
            opts?: Record<string, unknown>
        ) => string[] | string;
        const derivePinyin = (label: string): string[] => {
            try {
                const full = pinyinFn(label, { toneType: "none", type: "array" });
                const first = pinyinFn(label, { pattern: "first", toneType: "none", type: "array" });
                const compact = (arr: string[] | string) =>
                    (Array.isArray(arr) ? arr.join("") : String(arr)).replace(/[^a-z]/g, "");
                const fullS = compact(full);
                const firstS = compact(first);
                return firstS !== "" && firstS !== fullS ? [fullS, firstS] : fullS !== "" ? [fullS] : [];
            } catch {
                return [];
            }
        };
        const entries: EmojiEntry[] = [];
        for (const e of ((en as any).default ?? en) as any[]) {
            if (e.emoji == null || e.hexcode == null || e.group == null) {
                continue;
            }
            const labelEn: string = e.label ?? "";
            const labelZh = zhLabel.get(e.hexcode) ?? "";
            const scRaw = scMap[e.hexcode];
            const shortcode = Array.isArray(scRaw) ? scRaw[0] : scRaw ?? "";
            const keywords = [
                ...labelEn.toLowerCase().split(/\s+/).filter(Boolean),
                ...((e.tags as string[]) ?? []),
                ...(labelZh !== "" ? [labelZh] : []),
            ];
            entries.push({
                char: e.emoji,
                labelEn,
                labelZh,
                shortcode,
                keywords,
                group: e.group,
                skins: Array.isArray(e.skins) ? e.skins.map((s: any) => s.emoji ?? s) : [],
                pinyin: labelZh !== "" ? derivePinyin(labelZh) : [],
            });
        }
        catalogCache = { entries };
        return catalogCache;
    })();
    return catalogPromise;
}

/** Catalog if already loaded (else null — call loadEmojiCatalog() first). */
export function getLoadedEmojiCatalog(): EmojiCatalog | null {
    return catalogCache;
}

/**
 * Search the catalog. Scoring (lower is better):
 *   shortcode prefix (0) > keyword prefix (1) > pinyin prefix (2) > substring (3).
 * Empty query returns the first `limit` entries (group order preserved).
 */
export function searchEmoji(catalog: EmojiCatalog, query: string, limit = 24): EmojiEntry[] {
    const q = query.trim().toLowerCase();
    if (q === "") {
        return catalog.entries.slice(0, limit);
    }
    const scored: Array<{ e: EmojiEntry; s: number; i: number }> = [];
    catalog.entries.forEach((e, i) => {
        let s: number | null = null;
        if (e.shortcode === q) {
            s = -1; // exact shortcode beats every prefix
        } else if (e.shortcode !== "" && e.shortcode.startsWith(q)) {
            s = 0;
        } else if (e.keywords.some((k) => k.toLowerCase().startsWith(q))) {
            s = 1;
        } else if (e.pinyin.some((p) => p.startsWith(q))) {
            s = 2;
        } else if (e.labelEn.toLowerCase().includes(q) || e.labelZh.includes(q) || e.shortcode.includes(q)) {
            s = 3;
        }
        if (s != null) {
            scored.push({ e, s, i });
        }
    });
    scored.sort((a, b) => a.s - b.s || a.i - b.i);
    return scored.slice(0, limit).map((x) => x.e);
}

// --- Recents (MRU, localStorage) -----------------------------------------------------

function safeStorage(): Storage | null {
    try {
        return typeof window !== "undefined" ? window.localStorage : null;
    } catch {
        return null;
    }
}

export function getRecentEmojis(): string[] {
    const store = safeStorage();
    if (store == null) {
        return [];
    }
    try {
        const raw = store.getItem(RECENT_KEY);
        if (raw == null) {
            return [];
        }
        const parsed: unknown = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string").slice(0, RECENT_MAX) : [];
    } catch {
        return [];
    }
}

export function recordRecentEmoji(char: string): string[] {
    const store = safeStorage();
    const next = [char, ...getRecentEmojis().filter((c) => c !== char)].slice(0, RECENT_MAX);
    if (store != null) {
        try {
            store.setItem(RECENT_KEY, JSON.stringify(next));
        } catch {
            /* storage full / private mode — recents simply don't persist */
        }
    }
    return next;
}

// --- Picker item model (drives both the component render and keyboard navigation) ----

export type EmojiPickerItem =
    | { key: string; header: string }
    | { key: string; entry: EmojiEntry; recent?: boolean };

/**
 * Items for the emoji picker grid: search results when a query is present, otherwise a
 * Recent section (if any) followed by per-group sections with headers.
 */
export function buildEmojiPickerItems(catalog: EmojiCatalog, query: string, recents: string[]): EmojiPickerItem[] {
    if (query.trim() !== "") {
        return searchEmoji(catalog, query, 48).map((entry) => ({
            key: `s:${entry.char}:${entry.shortcode}`,
            entry,
        }));
    }
    const items: EmojiPickerItem[] = [];
    if (recents.length > 0) {
        items.push({ key: "h:recent", header: "Recent" });
        const byChar = new Map(catalog.entries.map((e) => [e.char, e]));
        for (const ch of recents) {
            const entry = byChar.get(ch);
            if (entry != null) {
                items.push({ key: `r:${ch}`, entry, recent: true });
            }
        }
    }
    const groups = new Map<number, EmojiEntry[]>();
    for (const e of catalog.entries) {
        const arr = groups.get(e.group) ?? [];
        arr.push(e);
        groups.set(e.group, arr);
    }
    for (const [group, entries] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
        items.push({ key: `h:${group}`, header: EMOJI_GROUP_LABELS[group] ?? `Group ${group}` });
        for (const e of entries) {
            items.push({ key: `g:${e.char}`, entry: e });
        }
    }
    return items;
}

/** The selectable subset of picker items, in render order — what arrow keys walk over. */
export function emojiPickerEntries(items: EmojiPickerItem[]): EmojiEntry[] {
    return items.flatMap((it) => ("entry" in it && it.entry != null ? [it.entry] : []));
}
