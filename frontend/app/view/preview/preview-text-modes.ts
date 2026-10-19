// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure logic for the text / html preview lanes:
//   1. read-only text view (`.txt` / `.log` / `text/plain`) and its large-file guard;
//   2. the three explicit `.html` open modes and their per-extension preference.
//
// No react / jotai / electron imports — directly unit-testable (same convention as
// `path-usage.ts`). Storage uses `localStorage`, matching the existing
// `preview-explorer.tsx` / `plugins/export` "remember last choice" pattern.

/** Above this, the text view truncates instead of freezing the renderer. */
export const TextPreviewMaxBytes = 2 * 1024 * 1024;

export type HtmlOpenMode = "source" | "preview" | "system";

/** First open with no remembered preference renders the page. */
export const HtmlOpenModeDefault: HtmlOpenMode = "preview";

export type HtmlOpenModeEntry = {
    id: HtmlOpenMode;
    label: string;
    icon: string;
    description: string;
};

/** The three explicit entries, in menu order. */
export const HtmlOpenModeEntries: readonly HtmlOpenModeEntry[] = [
    {
        id: "source",
        label: "Source",
        icon: "file-code",
        description: "Show the HTML text read-only inside this block",
    },
    {
        id: "preview",
        label: "Internal Preview",
        icon: "eye",
        description: "Render the page in a sandboxed frame",
    },
    {
        id: "system",
        label: "System Default App",
        icon: "arrow-up-right-from-square",
        description: "Open the file in your OS default browser",
    },
] as const;

export const HtmlOpenModeStorageKey = "snorkeling.preview.htmlOpenMode";

const PlainTextExtensions = new Set(["txt", "text", "log"]);
const HtmlExtensions = new Set(["html", "htm", "xhtml"]);
const HtmlMimeTypes = new Set(["text/html", "application/xhtml+xml", "application/xhtml"]);
const PlainTextMimeTypes = new Set(["text/plain"]);

export function getPathExtensionKey(pathOrName: string | null | undefined): string {
    if (pathOrName == null) {
        return "";
    }
    const base = pathOrName.trim().replace(/\\/g, "/").split("/").pop() ?? "";
    const dotIndex = base.lastIndexOf(".");
    if (dotIndex < 0 || dotIndex === base.length - 1) {
        return "";
    }
    return base.slice(dotIndex + 1).toLowerCase();
}

function normalizeMimeType(mimetype: string | null | undefined): string {
    return mimetype == null ? "" : mimetype.split(";")[0].trim().toLowerCase();
}

export function isHtmlPreviewPath(pathOrName: string | null | undefined): boolean {
    return HtmlExtensions.has(getPathExtensionKey(pathOrName));
}

export type TextPreviewKind = "plaintext" | "html";

/**
 * Which lane a file belongs to. Returns `null` when neither lane claims it, so existing
 * routing (markdown / csv / codeedit / directory / streaming) is untouched.
 *
 * `.html` keys off the extension *and* the mime: the static MIME map resolves `.html` to
 * `text/html`, so either alone is enough; both are checked so a mislabelled FileInfo still
 * lands in the right lane.
 */
export function resolveTextPreviewKind(
    pathOrName: string | null | undefined,
    mimetype: string | null | undefined
): TextPreviewKind | null {
    const mime = normalizeMimeType(mimetype);
    if (isHtmlPreviewPath(pathOrName) || HtmlMimeTypes.has(mime)) {
        return "html";
    }
    if (PlainTextExtensions.has(getPathExtensionKey(pathOrName)) || PlainTextMimeTypes.has(mime)) {
        return "plaintext";
    }
    return null;
}

/** True when the stat size says the text view will have to truncate. */
export function isTextPreviewOversize(size: number | null | undefined, maxBytes: number = TextPreviewMaxBytes): boolean {
    return typeof size === "number" && Number.isFinite(size) && size > maxBytes;
}

export function formatPreviewByteSize(bytes: number | null | undefined): string {
    if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) {
        return "unknown size";
    }
    if (bytes < 1024) {
        return `${bytes} B`;
    }
    const units = ["KB", "MB", "GB", "TB"];
    let value = bytes / 1024;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex++;
    }
    const rounded = value >= 10 ? Math.round(value).toString() : value.toFixed(1).replace(/\.0$/, "");
    return `${rounded} ${units[unitIndex]}`;
}

export type HtmlOpenModeStorageLike = {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
};

export type HtmlOpenModeMap = Record<string, HtmlOpenMode>;

export function getDefaultHtmlOpenModeStorage(): HtmlOpenModeStorageLike | null {
    if (typeof window === "undefined") {
        return null;
    }
    try {
        return window.localStorage ?? null;
    } catch {
        return null;
    }
}

export function isHtmlOpenMode(value: unknown): value is HtmlOpenMode {
    return value === "source" || value === "preview" || value === "system";
}

/**
 * Read the persisted per-extension map. Malformed data is dropped, never thrown: a corrupt
 * preference must not break opening a file.
 */
export function readHtmlOpenModeMap(storage: HtmlOpenModeStorageLike | null): HtmlOpenModeMap {
    if (storage == null) {
        return {};
    }
    try {
        const raw = storage.getItem(HtmlOpenModeStorageKey);
        if (raw == null || raw === "") {
            return {};
        }
        const parsed: unknown = JSON.parse(raw);
        if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
            return {};
        }
        const map: HtmlOpenModeMap = {};
        for (const [extension, value] of Object.entries(parsed as Record<string, unknown>)) {
            const key = extension.trim().toLowerCase();
            if (key !== "" && isHtmlOpenMode(value)) {
                map[key] = value;
            }
        }
        return map;
    } catch {
        return {};
    }
}

export function resolveHtmlOpenModeFromMap(
    map: HtmlOpenModeMap | null | undefined,
    pathOrName: string | null | undefined
): HtmlOpenMode {
    const extension = getPathExtensionKey(pathOrName);
    const stored = extension === "" ? undefined : map?.[extension];
    return isHtmlOpenMode(stored) ? stored : HtmlOpenModeDefault;
}

export function resolveHtmlOpenMode(
    storage: HtmlOpenModeStorageLike | null,
    pathOrName: string | null | undefined
): HtmlOpenMode {
    return resolveHtmlOpenModeFromMap(readHtmlOpenModeMap(storage), pathOrName);
}

/**
 * Persist one extension's mode. Returns the resulting map so the caller can publish it to
 * its atom; `null` means nothing was written (no storage, no extension, write failed).
 */
export function writeHtmlOpenModeMap(
    storage: HtmlOpenModeStorageLike | null,
    pathOrName: string | null | undefined,
    mode: HtmlOpenMode
): HtmlOpenModeMap | null {
    if (storage == null || !isHtmlOpenMode(mode)) {
        return null;
    }
    const extension = getPathExtensionKey(pathOrName);
    if (extension === "") {
        return null;
    }
    const next: HtmlOpenModeMap = { ...readHtmlOpenModeMap(storage), [extension]: mode };
    try {
        storage.setItem(HtmlOpenModeStorageKey, JSON.stringify(next));
    } catch {
        return null;
    }
    return next;
}

export function getHtmlOpenModeEntry(mode: HtmlOpenMode): HtmlOpenModeEntry {
    return HtmlOpenModeEntries.find((entry) => entry.id === mode) ?? HtmlOpenModeEntries[1];
}
