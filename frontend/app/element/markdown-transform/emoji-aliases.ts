// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * User-defined emoji meanings ("aliases").
 *
 * Right-clicking an emoji inside the shared `EmojiPicker` lets the user attach
 * their own words to it (e.g. ✅ → 已解决 / done). Those aliases feed the picker
 * search and are ranked above every built-in match (shortcode / keywords /
 * pinyin), which is the whole point: you remember the meaning, not the glyph.
 *
 * Scope is deliberately GLOBAL — one personal emoji dictionary, not per session
 * or per provider. A per-scope split would make "which alias am I editing?"
 * unanswerable from a right-click inside a shared picker.
 *
 * Storage: localStorage `snorkeling:emoji-aliases`, versioned envelope so a
 * future format change can be detected instead of silently overwritten.
 *
 * Plain external store (mirror pattern shared with `.agent-persona/session-persona-store.ts`):
 * memory snapshot + monotonic version + listeners + one cross-window `storage` hook.
 */

export interface EmojiAliasEntry {
    /** User words for this emoji. Normalized (see `normalizeAliases`). */
    aliases: string[];
    /** Optional one-line explanation, shown in the picker tooltip. */
    note: string;
    /** Write timestamp (ms). Written but not read by the UI yet. */
    updatedAt: number;
}

/** key = emoji char exactly as it appears in `EmojiEntry.char`. */
export type EmojiAliasMap = Record<string, EmojiAliasEntry>;

export const EMOJI_ALIAS_STORAGE_KEY = "snorkeling:emoji-aliases";
export const EMOJI_ALIAS_MAX_COUNT = 12;
export const EMOJI_ALIAS_MAX_LENGTH = 24;
export const EMOJI_ALIAS_MAX_NOTE_LENGTH = 80;

const STORAGE_VERSION = 1;

interface StoredShape {
    version: number;
    byChar: EmojiAliasMap;
}

// --- normalization ------------------------------------------------------------------

/**
 * Canonical alias list: trim, drop empties, de-duplicate case-insensitively while
 * keeping the first spelling the user typed, cap the count, cap each length.
 */
export function normalizeAliases(raw: readonly string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of raw) {
        if (typeof item !== "string") {
            continue;
        }
        const trimmed = item.trim().replace(/\s+/g, " ").slice(0, EMOJI_ALIAS_MAX_LENGTH);
        if (trimmed === "") {
            continue;
        }
        const key = trimmed.toLowerCase();
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        out.push(trimmed);
        if (out.length >= EMOJI_ALIAS_MAX_COUNT) {
            break;
        }
    }
    return out;
}

/** Split a free-text input ("已解决, done  验收通过") into alias candidates. */
export function splitAliasInput(raw: string): string[] {
    return raw
        .split(/[,，;；\n\t]+/)
        .map((part) => part.trim())
        .filter((part) => part !== "");
}

function normalizeNote(note: unknown): string {
    if (typeof note !== "string") {
        return "";
    }
    return note.trim().replace(/\s+/g, " ").slice(0, EMOJI_ALIAS_MAX_NOTE_LENGTH);
}

// --- emoji char normalization (skin-tone / variation-selector fallback) --------------

const SKIN_TONE_RE = /[\u{1F3FB}-\u{1F3FF}]/gu;
const VARIATION_SELECTOR_RE = /\u{FE0F}/gu;

/**
 * Candidate storage keys for one char, most specific first:
 *   `👍🏻` → [`👍🏻`, `👍`]   skin-tone fallback
 *   `❤️` → [`❤️`, `❤`]     variation-selector strip
 *   `✅`  → [`✅`, `✅️`]     variation-selector ADD
 *
 * The ADD direction is not cosmetic: the catalog spells many symbols WITH VS16
 * (`white_check_mark` is `✅️`), so a caller holding the bare char would otherwise
 * never find the record. Both directions are needed.
 */
export function emojiBaseCandidates(char: string): string[] {
    if (typeof char !== "string" || char === "") {
        return [];
    }
    const out: string[] = [char];
    const noSkin = char.replace(SKIN_TONE_RE, "");
    if (noSkin !== char && !out.includes(noSkin)) {
        out.push(noSkin);
    }
    for (const candidate of [...out]) {
        const noVs = candidate.replace(VARIATION_SELECTOR_RE, "");
        if (noVs !== candidate && !out.includes(noVs)) {
            out.push(noVs);
        }
    }
    for (const candidate of [...out]) {
        // Adding the emoji presentation selector is harmless for chars that ignore it;
        // nothing ever stores that spelling, so it cannot create false hits.
        if (!candidate.includes("\uFE0F")) {
            const withVs = candidate + "\uFE0F";
            if (!out.includes(withVs)) {
                out.push(withVs);
            }
        }
    }
    return out.length > 0 ? out : [char];
}

// --- persistence --------------------------------------------------------------------

function safeStorage(): Storage | null {
    try {
        return typeof window !== "undefined" ? window.localStorage : null;
    } catch {
        return null;
    }
}

function sanitizeEntry(raw: unknown): EmojiAliasEntry | null {
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
        return null;
    }
    const record = raw as Record<string, unknown>;
    const aliases = Array.isArray(record.aliases)
        ? normalizeAliases(record.aliases.filter((x): x is string => typeof x === "string"))
        : [];
    const note = normalizeNote(record.note);
    if (aliases.length === 0 && note === "") {
        return null;
    }
    const updatedAt = typeof record.updatedAt === "number" && Number.isFinite(record.updatedAt) ? record.updatedAt : 0;
    return { aliases, note, updatedAt };
}

function parseAliasEnvelope(raw: string | null): { map: EmojiAliasMap; version: number | null } {
    if (raw == null) {
        return { map: {}, version: null };
    }
    try {
        const parsed: unknown = JSON.parse(raw);
        if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
            return { map: {}, version: null };
        }
        const envelope = parsed as Partial<StoredShape>;
        const version = typeof envelope.version === "number" ? envelope.version : null;
        // Unknown / future version: ignore the data but DO NOT overwrite it.
        if (version !== STORAGE_VERSION) {
            return { map: {}, version };
        }
        const byCharRaw = envelope.byChar;
        if (byCharRaw == null || typeof byCharRaw !== "object" || Array.isArray(byCharRaw)) {
            return { map: {}, version };
        }
        const result: EmojiAliasMap = {};
        for (const [char, value] of Object.entries(byCharRaw as Record<string, unknown>)) {
            if (char === "") {
                continue;
            }
            const entry = sanitizeEntry(value);
            if (entry != null) {
                result[char] = entry;
            }
        }
        return { map: result, version };
    } catch {
        return { map: {}, version: null };
    }
}

function readAliasMap(): { map: EmojiAliasMap; version: number | null } {
    const store = safeStorage();
    if (store == null) {
        return { map: {}, version: null };
    }
    try {
        return parseAliasEnvelope(store.getItem(EMOJI_ALIAS_STORAGE_KEY));
    } catch {
        return { map: {}, version: null };
    }
}

// Stable snapshot identity between writes (useSyncExternalStore requirement).
let snapshot: EmojiAliasMap = {};
let snapshotVersion = 0;
let storageVersion: number | null = null;
let loaded = false;
const listeners = new Set<() => void>();
let storageListenerAttached = false;

function load(): void {
    if (loaded) {
        return;
    }
    const read = readAliasMap();
    snapshot = read.map;
    storageVersion = read.version;
    loaded = true;
}

function emit(): void {
    for (const listener of [...listeners]) {
        listener();
    }
}

function ensureStorageListener(): void {
    if (storageListenerAttached) {
        return;
    }
    if (typeof window === "undefined" || typeof window.addEventListener !== "function") {
        return;
    }
    storageListenerAttached = true;
    window.addEventListener("storage", (event: StorageEvent) => {
        if (event.key !== EMOJI_ALIAS_STORAGE_KEY) {
            return;
        }
        if (event.storageArea != null && event.storageArea !== window.localStorage) {
            return;
        }
        const read = readAliasMap();
        snapshot = read.map;
        storageVersion = read.version;
        loaded = true;
        snapshotVersion++;
        emit();
    });
}

/** Whole alias table (memory snapshot — never hits localStorage after first read). */
export function getEmojiAliasMap(): EmojiAliasMap {
    load();
    return snapshot;
}

/** Alias record for one emoji, with skin-tone / variation-selector fallback. */
export function getEmojiAlias(char: string): EmojiAliasEntry | null {
    load();
    for (const candidate of emojiBaseCandidates(char)) {
        const entry = snapshot[candidate];
        if (entry != null) {
            return entry;
        }
    }
    return null;
}

/** Monotonic counter — use as a `useMemo` dependency so writes invalidate derived lists. */
export function getEmojiAliasVersion(): number {
    return snapshotVersion;
}

export function subscribeEmojiAliases(listener: () => void): () => void {
    ensureStorageListener();
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

function persist(next: EmojiAliasMap): void {
    const store = safeStorage();
    if (store != null) {
        try {
            if (Object.keys(next).length === 0) {
                store.removeItem(EMOJI_ALIAS_STORAGE_KEY);
            } else {
                const envelope: StoredShape = { version: STORAGE_VERSION, byChar: next };
                store.setItem(EMOJI_ALIAS_STORAGE_KEY, JSON.stringify(envelope));
            }
            storageVersion = STORAGE_VERSION;
        } catch {
            /* storage full / private mode — keep the in-memory snapshot usable */
        }
    }
    snapshot = next;
    snapshotVersion++;
    emit();
}

/** Create/overwrite the alias record. Empty aliases + empty note removes it. */
export function setEmojiAliases(char: string, next: { aliases: readonly string[]; note?: string }): void {
    if (typeof char !== "string" || char === "") {
        return;
    }
    load();
    const aliases = normalizeAliases(next.aliases ?? []);
    const note = normalizeNote(next.note);
    const map: EmojiAliasMap = { ...snapshot };
    if (aliases.length === 0 && note === "") {
        delete map[char];
        persist(map);
        return;
    }
    map[char] = { aliases, note, updatedAt: Date.now() };
    persist(map);
}

export function removeEmojiAliases(char: string): void {
    if (typeof char !== "string" || char === "") {
        return;
    }
    load();
    if (snapshot[char] == null) {
        return;
    }
    const map: EmojiAliasMap = { ...snapshot };
    delete map[char];
    persist(map);
}

/** True when the stored envelope version is not the one this build understands. */
export function isEmojiAliasStorageForeign(): boolean {
    load();
    return storageVersion != null && storageVersion !== STORAGE_VERSION;
}

// Test-only reset.
export function __resetEmojiAliasesForTests(): void {
    listeners.clear();
    storageListenerAttached = false;
    snapshot = {};
    snapshotVersion = 0;
    storageVersion = null;
    loaded = false;
    const store = safeStorage();
    try {
        store?.removeItem(EMOJI_ALIAS_STORAGE_KEY);
    } catch {
        /* ignore */
    }
}
