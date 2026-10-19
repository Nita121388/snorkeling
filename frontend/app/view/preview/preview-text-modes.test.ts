// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import {
    formatPreviewByteSize,
    getHtmlOpenModeEntry,
    HtmlOpenModeEntries,
    HtmlOpenModeDefault,
    HtmlOpenModeStorageKey,
    isHtmlOpenMode,
    isHtmlPreviewPath,
    isTextPreviewOversize,
    readHtmlOpenModeMap,
    resolveHtmlOpenMode,
    resolveHtmlOpenModeFromMap,
    resolveTextPreviewKind,
    TextPreviewMaxBytes,
    writeHtmlOpenModeMap,
    type HtmlOpenModeMap,
    type HtmlOpenModeStorageLike,
} from "./preview-text-modes";
import { describe, expect, it } from "vitest";

function makeStorage(seed: Record<string, string> = {}): HtmlOpenModeStorageLike & { data: Record<string, string> } {
    const data: Record<string, string> = { ...seed };
    return {
        data,
        getItem: (key) => (key in data ? data[key] : null),
        setItem: (key, value) => {
            data[key] = value;
        },
    };
}

describe("resolveTextPreviewKind", () => {
    it("routes plain text to the read-only text lane", () => {
        expect(resolveTextPreviewKind("/tmp/notes.txt", "text/plain")).toBe("plaintext");
        expect(resolveTextPreviewKind("/tmp/build.log", "text/x-log")).toBe("plaintext");
        expect(resolveTextPreviewKind("/tmp/README.text", "text/plain")).toBe("plaintext");
    });

    it("routes html to the html lane", () => {
        expect(resolveTextPreviewKind("/tmp/page.html", "text/html")).toBe("html");
        expect(resolveTextPreviewKind("/tmp/page.htm", "text/html")).toBe("html");
        expect(resolveTextPreviewKind("/tmp/page.xhtml", "application/xhtml+xml")).toBe("html");
        // mime alone is enough when the extension is missing/unknown
        expect(resolveTextPreviewKind("/tmp/noext", "text/html")).toBe("html");
    });

    it("leaves everything else to the existing dispatch", () => {
        expect(resolveTextPreviewKind("/tmp/a.md", "text/markdown")).toBeNull();
        expect(resolveTextPreviewKind("/tmp/a.ts", "text/typescript")).toBeNull();
        expect(resolveTextPreviewKind("/tmp/data.csv", "text/csv")).toBeNull();
        expect(resolveTextPreviewKind("/tmp", "directory")).toBeNull();
        expect(resolveTextPreviewKind("/tmp/blob.bin", "application/octet-stream")).toBeNull();
    });
});

describe("isHtmlPreviewPath", () => {
    it("matches on extension, case-insensitively, ignoring directories", () => {
        expect(isHtmlPreviewPath("/a/b/c.HTML")).toBe(true);
        expect(isHtmlPreviewPath("C:\\site\\index.htm")).toBe(true);
        expect(isHtmlPreviewPath("/a/b.txt")).toBe(false);
        expect(isHtmlPreviewPath(null)).toBe(false);
        expect(isHtmlPreviewPath("")).toBe(false);
    });
});

describe("isTextPreviewOversize", () => {
    it("only trips above the threshold", () => {
        expect(isTextPreviewOversize(TextPreviewMaxBytes)).toBe(false);
        expect(isTextPreviewOversize(TextPreviewMaxBytes + 1)).toBe(true);
        expect(isTextPreviewOversize(undefined)).toBe(false);
        expect(isTextPreviewOversize(null)).toBe(false);
        expect(isTextPreviewOversize(Number.NaN)).toBe(false);
    });

    it("uses a 2MB default so the renderer cannot freeze on a huge text file", () => {
        expect(TextPreviewMaxBytes).toBe(2 * 1024 * 1024);
    });
});

describe("formatPreviewByteSize", () => {
    it("renders a readable notice", () => {
        expect(formatPreviewByteSize(512)).toBe("512 B");
        expect(formatPreviewByteSize(2 * 1024 * 1024)).toBe("2 MB");
        expect(formatPreviewByteSize(3 * 1024)).toBe("3 KB");
        expect(formatPreviewByteSize(undefined)).toBe("unknown size");
    });
});

describe("html open mode preference", () => {
    it("defaults to internal preview when nothing is remembered", () => {
        const storage = makeStorage();
        expect(resolveHtmlOpenMode(storage, "/tmp/a.html")).toBe(HtmlOpenModeDefault);
        expect(resolveHtmlOpenModeFromMap({}, "/tmp/a.html")).toBe(HtmlOpenModeDefault);
    });

    it("remembers per extension, not per path", () => {
        const storage = makeStorage();
        expect(writeHtmlOpenModeMap(storage, "/one/a.html", "source")?.html).toBe("source");
        // a different path with the same extension inherits the preference
        expect(resolveHtmlOpenMode(storage, "/two/b.html")).toBe("source");
        // a different extension does not
        expect(resolveHtmlOpenMode(storage, "/two/c.htm")).toBe(HtmlOpenModeDefault);
    });

    it("survives a reload through storage", () => {
        const storage = makeStorage();
        writeHtmlOpenModeMap(storage, "/a.html", "system");
        expect(JSON.parse(storage.data[HtmlOpenModeStorageKey])).toEqual({ html: "system" });
        expect(readHtmlOpenModeMap(storage)).toEqual({ html: "system" });
    });

    it("falls back to the default on corrupt or foreign storage content", () => {
        expect(readHtmlOpenModeMap(makeStorage({ [HtmlOpenModeStorageKey]: "{not json" }))).toEqual({});
        expect(readHtmlOpenModeMap(makeStorage({ [HtmlOpenModeStorageKey]: "[]" }))).toEqual({});
        expect(readHtmlOpenModeMap(makeStorage({ [HtmlOpenModeStorageKey]: '"str"' }))).toEqual({});
        expect(readHtmlOpenModeMap(makeStorage({ [HtmlOpenModeStorageKey]: '{"html":"bogus"}' }))).toEqual({});
        expect(readHtmlOpenModeMap(null)).toEqual({});
    });

    it("does not throw when storage writes fail", () => {
        const hostile: HtmlOpenModeStorageLike = {
            getItem: () => null,
            setItem: () => {
                throw new Error("quota");
            },
        };
        expect(writeHtmlOpenModeMap(hostile, "/a.html", "preview")).toBeNull();
    });

    it("ignores paths with no usable extension", () => {
        const storage = makeStorage();
        expect(writeHtmlOpenModeMap(storage, "/tmp/README", "source")).toBeNull();
        expect(writeHtmlOpenModeMap(storage, "", "source")).toBeNull();
    });

    it("exposes exactly the three explicit modes", () => {
        expect(HtmlOpenModeEntries.map((entry) => entry.id)).toEqual<HtmlOpenModeMap[string][]>([
            "source",
            "preview",
            "system",
        ]);
        for (const entry of HtmlOpenModeEntries) {
            expect(isHtmlOpenMode(entry.id)).toBe(true);
            expect(getHtmlOpenModeEntry(entry.id).id).toBe(entry.id);
        }
    });
});
