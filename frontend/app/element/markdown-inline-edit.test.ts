// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";
import {
    deleteBlockRange,
    resolveInlineEditTarget,
    spliceInsertBlock,
    splitBlockAtCaretText,
    type InlineEditSession,
} from "./markdown-inline-edit";

describe("markdown inline edit target", () => {
    it("resolves the current block after React replaces the clicked element, kind-agnostic", () => {
        const staleTarget = { isConnected: false } as HTMLElement;
        const currentTarget = {} as HTMLElement;
        const querySelector = vi.fn(() => currentTarget);
        const viewport = {
            contains: vi.fn(() => false),
            querySelector,
        } as unknown as HTMLElement;
        const session = {
            blockKind: "p",
            startLine: 4,
            targetEl: staleTarget,
        } as InlineEditSession;

        expect(resolveInlineEditTarget(viewport, session)).toBe(currentTarget);
        // p/h/ul/ol/li/table/pre all carry data-source-line; the resolver no longer special-cases
        // block class — it queries by attribute alone so list/table/code blocks resolve too.
        expect(querySelector).toHaveBeenCalledWith('.markdown-render-root [data-source-line="4"]');
    });

    it("resolves list/table/code blocks through the same generic selector", () => {
        const target = {} as HTMLElement;
        const querySelector = vi.fn(() => target);
        const viewport = {
            contains: vi.fn(() => false),
            querySelector,
        } as unknown as HTMLElement;
        for (const blockKind of ["list", "table", "code"] as const) {
            querySelector.mockClear();
            const session = { blockKind, startLine: 9, targetEl: { isConnected: false } as HTMLElement } as InlineEditSession;
            expect(resolveInlineEditTarget(viewport, session)).toBe(target);
            expect(querySelector).toHaveBeenCalledWith('.markdown-render-root [data-source-line="9"]');
        }
    });

    it("keeps using the clicked element while it remains in the viewport", () => {
        const target = { isConnected: true } as HTMLElement;
        const querySelector = vi.fn();
        const viewport = {
            contains: vi.fn(() => true),
            querySelector,
        } as unknown as HTMLElement;
        const session = {
            blockKind: "h",
            startLine: 2,
            targetEl: target,
        } as InlineEditSession;

        expect(resolveInlineEditTarget(viewport, session)).toBe(target);
        expect(querySelector).not.toHaveBeenCalled();
    });
});

describe("spliceInsertBlock (block-edge insert buttons)", () => {
    const lines = ["# title", "", "hello", "", "tail"];

    it("inserts below the anchor line, bracketed by a blank line", () => {
        const next = spliceInsertBlock(lines, 3, 3, "after", ["new"]);
        expect(next).toEqual(["# title", "", "hello", "", "new", "", "tail"]);
    });

    it("inserts above the anchor line, bracketed by a blank line", () => {
        const next = spliceInsertBlock(lines, 3, 3, "before", ["new"]);
        expect(next).toEqual(["# title", "", "new", "", "hello", "", "tail"]);
    });

    it("keeps multi-line drafts verbatim (blank lines inside the draft stay)", () => {
        const next = spliceInsertBlock(lines, 3, 3, "after", ["a", "", "b"]);
        expect(next).toEqual(["# title", "", "hello", "", "a", "", "b", "", "tail"]);
    });

    it("inserts below the END line for multi-line blocks (list stays closed)", () => {
        // block spans lines 3..4 (e.g. a 2-item list); "after" must splice below line 4
        const list = ["# title", "", "- one", "- two", "", "tail"];
        const next = spliceInsertBlock(list, 3, 4, "after", ["new"]);
        expect(next).toEqual(["# title", "", "- one", "- two", "", "new", "", "tail"]);
    });

    it("inserts above the START line for multi-line blocks", () => {
        const list = ["# title", "", "- one", "- two", "", "tail"];
        const next = spliceInsertBlock(list, 3, 4, "before", ["new"]);
        expect(next).toEqual(["# title", "", "new", "", "- one", "- two", "", "tail"]);
    });

    it("clamps out-of-range anchor lines", () => {
        expect(spliceInsertBlock(lines, 99, 99, "after", ["x"])).toEqual([
            "# title",
            "",
            "hello",
            "",
            "tail",
            "",
            "x",
        ]);
    });
});

describe("splitBlockAtCaretText (Enter splits the paragraph at caret)", () => {
    const fullText = "# title\n\nhello world\n\nend";
    const startLine = 3; // "hello world"
    const endLine = 3;
    const draft = "hello world";

    it("splits at caret in the middle → before stays, after becomes a new block below", () => {
        const { text, newLine } = splitBlockAtCaretText(fullText, startLine, endLine, draft, 5);
        // before="hello" after=" world"
        expect(text).toBe("# title\n\nhello\n\n world\n\nend");
        expect(newLine).toBe(5);
    });

    it("caret at the end → blank line inserted below", () => {
        const { text, newLine } = splitBlockAtCaretText(fullText, startLine, endLine, draft, draft.length);
        // after mode adds a separator blank + the content blank = 2 new blanks → 3 between blocks
        expect(text).toBe("# title\n\nhello world\n\n\n\nend");
        expect(newLine).toBe(5);
    });

    it("caret at the start → blank line inserted above, original text becomes the after block", () => {
        const { text, newLine } = splitBlockAtCaretText(fullText, startLine, endLine, draft, 0);
        // before mode adds separator blank + content blank = 2 new blanks on top
        expect(text).toBe("# title\n\n\n\nhello world\n\nend");
        expect(newLine).toBe(3);
    });

    it("splits multi-line block (span 3..4) at end of first line → rest stays as text below", () => {
        const { text, newLine } = splitBlockAtCaretText(
            "# title\n\nline A\nline B\n\nend",
            3, 4, "line A\nline B", 6
        );
        expect(text).toBe("# title\n\nline A\n\n\nline B\n\nend");
        expect(newLine).toBe(5);
    });
});

describe("deleteBlockRange (block menu delete)", () => {
    it("deletes a single-line block and one separator blank (keeps one blank between blocks)", () => {
        const text = "# title\n\nhello world\n\nend";
        // block has a separator blank before AND after → drop one, keep one
        expect(deleteBlockRange(text, 3, 3)).toBe("# title\n\nend");
    });

    it("deletes a multi-line block (span 3..4) cleanly", () => {
        const text = "# title\n\nline A\nline B\n\nend";
        expect(deleteBlockRange(text, 3, 4)).toBe("# title\n\nend");
    });

    it("deletes the first block (no leading blank to remove)", () => {
        const text = "# title\n\nbody";
        expect(deleteBlockRange(text, 1, 1)).toBe("body");
    });

    it("deletes the last block (no trailing blank to remove)", () => {
        const text = "a\n\nb";
        expect(deleteBlockRange(text, 3, 3)).toBe("a");
    });

    it("clamps end beyond the text length", () => {
        const text = "a\n\nb";
        expect(deleteBlockRange(text, 1, 99)).toBe(""); // deletes every remaining line
    });
});
