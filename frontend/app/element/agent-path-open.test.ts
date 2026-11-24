// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";
import { openAgentPathRef, type AgentPathOpenDeps } from "./agent-path-open";

function makeDeps(overrides: Partial<AgentPathOpenDeps> = {}) {
    const openFileLinkInPreview = vi.fn(async () => false);
    const searchSelectionInFiles = vi.fn(async () => undefined);
    const openLink = vi.fn();
    const deps: AgentPathOpenDeps = {
        openFileLinkInPreview,
        searchSelectionInFiles,
        openLink,
        ...overrides,
    };
    // 返回 deps 上的实际实现（override 生效后的那个），否则覆盖 mock 时断言会落在未使用的默认 mock 上。
    return {
        deps,
        openFileLinkInPreview: deps.openFileLinkInPreview,
        searchSelectionInFiles: deps.searchSelectionInFiles,
        openLink: deps.openLink,
    };
}

describe("openAgentPathRef", () => {
    it("opens in preview first and never falls through when it succeeds", async () => {
        const { deps, openFileLinkInPreview, searchSelectionInFiles } = makeDeps({
            openFileLinkInPreview: vi.fn(async () => true),
        });
        const result = await openAgentPathRef("file:///E:/code/a.html", { deps });
        expect(result).toBe("preview");
        expect(openFileLinkInPreview).toHaveBeenCalledWith("E:/code/a.html", expect.anything());
        expect(searchSelectionInFiles).not.toHaveBeenCalled();
    });

    it("falls back to the search-in-files pipeline when preview cannot open it", async () => {
        const { deps, openFileLinkInPreview, searchSelectionInFiles } = makeDeps();
        const result = await openAgentPathRef("file:///E:/code/a.html", { deps });
        expect(result).toBe("search");
        expect(openFileLinkInPreview).toHaveBeenCalled();
        expect(searchSelectionInFiles).toHaveBeenCalledWith(
            expect.objectContaining({ filePath: "E:/code/a.html" }),
            expect.anything()
        );
    });

    it("falls back to search for a relative reference with a line number", async () => {
        const { deps, searchSelectionInFiles } = makeDeps();
        const result = await openAgentPathRef("src/foo.ts:12", { deps });
        expect(result).toBe("search");
        expect(searchSelectionInFiles).toHaveBeenCalledWith(
            expect.objectContaining({ filePath: "src/foo.ts", lineNumber: 12 }),
            expect.anything()
        );
    });

    it("hands http links to the external opener", async () => {
        const { deps, openLink } = makeDeps();
        const result = await openAgentPathRef("https://example.com/x", { deps });
        expect(result).toBe("external");
        expect(openLink).toHaveBeenCalledWith("https://example.com/x");
    });

    it("refuses unsafe schemes without touching any opener", async () => {
        const { deps, openFileLinkInPreview, searchSelectionInFiles, openLink } = makeDeps();
        const result = await openAgentPathRef("javascript:alert(1)", { deps });
        expect(result).toBe("none");
        expect(openFileLinkInPreview).not.toHaveBeenCalled();
        expect(searchSelectionInFiles).not.toHaveBeenCalled();
        expect(openLink).not.toHaveBeenCalled();
    });

    it("returns none for text that carries no file reference", async () => {
        const { deps, openFileLinkInPreview, searchSelectionInFiles } = makeDeps();
        const result = await openAgentPathRef("hello world", { deps });
        expect(result).toBe("none");
        expect(openFileLinkInPreview).not.toHaveBeenCalled();
        expect(searchSelectionInFiles).not.toHaveBeenCalled();
    });
});
