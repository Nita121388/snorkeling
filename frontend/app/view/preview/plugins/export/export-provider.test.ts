// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    registerMarkdownExportProvider,
    unregisterMarkdownExportProvider,
    getAllMarkdownExportProviders,
    getMarkdownExportProviders,
    getMarkdownExportProvider,
    type MarkdownExportProvider,
} from "./export-provider";
import { runMarkdownExport } from "./export-runner";
import { isMarkdownFile } from "./pdf-export";

const ctx = {
    fileInfo: null,
    mimeType: "text/markdown",
    fileName: "note.md",
    filePath: "/vault/note.md",
    editMode: false,
};

const makeProvider = (id: string): MarkdownExportProvider => ({
    id,
    displayName: id,
    formats: ["html"],
    match: isMarkdownFile,
    toHtml: async () => "<p/>",
});

describe("runMarkdownExport result semantics", () => {
    // 未注册 provider 在触碰 window.api 之前即返回结构化错误，无需浏览器环境。
    it("returns error result for unregistered provider", async () => {
        const res = await runMarkdownExport("missing", "html", "# hi", ctx);
        expect(res.ok).toBe(false);
        expect(res.canceled).toBe(false);
        expect(res.error).toBeTruthy();
    });
});

describe("registerMarkdownExportProvider registry", () => {
    it("registers, lists, and matches", () => {
        const unsub = registerMarkdownExportProvider(makeProvider("test-provider"));
        expect(getMarkdownExportProvider("test-provider")?.id).toBe("test-provider");
        expect(getAllMarkdownExportProviders().some((p) => p.id === "test-provider")).toBe(true);
        expect(getMarkdownExportProviders(ctx).some((p) => p.id === "test-provider")).toBe(true);
        unsub();
        expect(getMarkdownExportProvider("test-provider")).toBeNull();
    });

    it("dedupes same-id on re-register", () => {
        registerMarkdownExportProvider(makeProvider("dup"));
        registerMarkdownExportProvider(makeProvider("dup"));
        expect(getAllMarkdownExportProviders().filter((p) => p.id === "dup")).toHaveLength(1);
        unregisterMarkdownExportProvider("dup");
    });
});
