// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { isMdPropertiesMatch } from "./md-properties-match";
import type { PreviewMatchContext } from "@/app/view/preview/preview-plugin-registry";

const ctx = (overrides: Partial<PreviewMatchContext> = {}): PreviewMatchContext => ({
    fileInfo: null,
    mimeType: "text/markdown",
    fileName: "note.md",
    filePath: "/vault/note.md",
    editMode: false,
    ...overrides,
});

describe("isMdPropertiesMatch", () => {
    it("matches .md files in readonly preview", () => {
        expect(isMdPropertiesMatch(ctx())).toBe(true);
    });

    it("matches .mdx files", () => {
        expect(isMdPropertiesMatch(ctx({ fileName: "doc.mdx", filePath: "/vault/doc.mdx" }))).toBe(true);
    });

    it("does not match in edit mode (falls back to code editor)", () => {
        expect(isMdPropertiesMatch(ctx({ editMode: true }))).toBe(false);
    });

    it("does not match non-markdown files", () => {
        expect(isMdPropertiesMatch(ctx({ fileName: "note.base" }))).toBe(false);
        expect(isMdPropertiesMatch(ctx({ fileName: "readme.txt" }))).toBe(false);
        expect(isMdPropertiesMatch(ctx({ fileName: "image.png" }))).toBe(false);
    });
});