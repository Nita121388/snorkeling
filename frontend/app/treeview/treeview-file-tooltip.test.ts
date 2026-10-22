// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { FileTooltipHoverDelayMs } from "@/app/element/hover-timing";
import { buildFileMetaRows, describeMimeType, type FileMetaNode } from "@/app/treeview/treeview-file-tooltip";
import { describe, expect, it } from "vitest";

function makeNode(overrides: Partial<FileMetaNode> = {}): FileMetaNode {
    return {
        label: "design.md",
        path: "/Users/mike/project/design.md",
        isDirectory: false,
        mimeType: "text/markdown",
        size: 4300,
        modtime: Date.parse("2026-03-10T09:00:00.000Z"),
        ...overrides,
    };
}

describe("describeMimeType", () => {
    it("maps well-known mimetypes to readable names", () => {
        expect(describeMimeType("text/markdown")).toBe("Markdown");
        expect(describeMimeType("application/json")).toBe("JSON");
        expect(describeMimeType("text/typescript")).toBe("TypeScript");
        expect(describeMimeType("application/typescript")).toBe("TypeScript");
        expect(describeMimeType("text/x-python")).toBe("Python");
        expect(describeMimeType("application/pdf")).toBe("PDF");
    });

    it("maps media prefixes", () => {
        expect(describeMimeType("image/png")).toBe("Image");
        expect(describeMimeType("video/mp4")).toBe("Video");
        expect(describeMimeType("audio/mpeg")).toBe("Audio");
    });

    it("treats directories as folders regardless of mimetype", () => {
        expect(describeMimeType("directory", true)).toBe("Folder");
        expect(describeMimeType(undefined, true)).toBe("Folder");
    });

    it("falls back for unknown or missing mimetypes", () => {
        expect(describeMimeType(undefined, false)).toBe("File");
        expect(describeMimeType("", false)).toBe("File");
        expect(describeMimeType("application/x-tar", false)).toBe("Archive");
        expect(describeMimeType("application/x-foo", false)).toBe("FOO");
        expect(describeMimeType("application/vnd.custom-thing", false)).toBe("VND.CUSTOM-THING");
    });
});

describe("buildFileMetaRows", () => {
    it("returns size and modified rows for a regular file", () => {
        const rows = buildFileMetaRows(makeNode());
        expect(rows.map((row) => row.label)).toEqual(["Size", "Modified"]);
        expect(rows[0].value).toBe("4.2 KB");
        expect(rows[1].value).toMatch(/^\w{3} \d{2} \d{2}:\d{2}$|^\d{4}-\d{2}-\d{2}$/);
    });

    it("omits the size row for directories", () => {
        const rows = buildFileMetaRows(makeNode({ isDirectory: true, mimeType: "directory" }));
        expect(rows.map((row) => row.label)).toEqual(["Modified"]);
    });

    it("omits rows whose data is missing", () => {
        expect(buildFileMetaRows(makeNode({ size: undefined })).map((row) => row.label)).toEqual(["Modified"]);
        expect(buildFileMetaRows(makeNode({ modtime: undefined })).map((row) => row.label)).toEqual(["Size"]);
        expect(buildFileMetaRows(makeNode({ size: undefined, modtime: undefined }))).toEqual([]);
    });

    it("keeps a zero-byte file visible", () => {
        const rows = buildFileMetaRows(makeNode({ size: 0 }));
        expect(rows[0]).toEqual({ label: "Size", value: "0 B" });
    });

    it("returns no rows for broken nodes", () => {
        expect(buildFileMetaRows(makeNode({ notfound: true }))).toEqual([]);
        expect(buildFileMetaRows(makeNode({ staterror: "permission denied" }))).toEqual([]);
    });
});

describe("FileTooltipHoverDelayMs", () => {
    it("is long enough to avoid firing on mouse sweeps", () => {
        expect(FileTooltipHoverDelayMs).toBe(700);
    });
});
