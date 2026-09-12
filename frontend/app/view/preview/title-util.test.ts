// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { extractFirstH1, resolveNoteTitle } from "./title-util";

describe("extractFirstH1", () => {
    it("returns null for empty / undefined text", () => {
        expect(extractFirstH1(undefined)).toBeNull();
        expect(extractFirstH1(null)).toBeNull();
        expect(extractFirstH1("")).toBeNull();
    });

    it("extracts the first H1 heading text", () => {
        expect(extractFirstH1("# Hello World\n\nbody")).toBe("Hello World");
    });

    it("skips an H2 and finds the first H1", () => {
        expect(extractFirstH1("## sub\n# Real Title\n")).toBe("Real Title");
    });

    it("ignores a leading frontmatter fenced block", () => {
        const text = `---\ntags:\n  - a\n---\n# After Fm Title\nbody`;
        expect(extractFirstH1(text)).toBe("After Fm Title");
    });

    it("does not mistake a YAML comment in frontmatter for a heading", () => {
        const text = `---\ntags: x\n# not a heading\n---\nbody`;
        expect(extractFirstH1(text)).toBeNull();
    });

    it("does not match a heading without a space after #", () => {
        expect(extractFirstH1("#NotAHeading\n")).toBeNull();
    });

    it("does not match an H2 as an H1", () => {
        expect(extractFirstH1("## Sub\n")).toBeNull();
    });
});

describe("resolveNoteTitle", () => {
    it("prefers the first H1 over the filename", () => {
        expect(resolveNoteTitle("# Doc Title\nbody", "/vault/note.md")).toBe("Doc Title");
    });

    it("falls back to the basename (without extension) when no H1", () => {
        expect(resolveNoteTitle("just body, no heading", "/vault/自定义命令片段-Snippets-.md")).toBe(
            "自定义命令片段-Snippets-"
        );
    });

    it("strips .mdx extension too", () => {
        expect(resolveNoteTitle("body", "/vault/doc.mdx")).toBe("doc");
    });

    it("returns null when there is no text and no usable path", () => {
        expect(resolveNoteTitle(null, null)).toBeNull();
        expect(resolveNoteTitle("", "  ")).toBeNull();
    });
});
