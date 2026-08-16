// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";
import {
    commitPlaceholderBlock,
    deleteBlockRange,
    replaceSourceRange,
    resolveInlineEditTarget,
    spliceBlankRow,
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

describe("spliceBlankRow (placeholder-row pre-insert)", () => {
    const lines = ["# title", "", "hello", "", "tail"];

    it("inserts EXACTLY ONE blank row below the anchor line", () => {
        const next = spliceBlankRow(lines, 3, 3, "after");
        expect(next).toEqual(["# title", "", "hello", "", "", "tail"]);
    });

    it("inserts EXACTLY ONE blank row above the anchor line", () => {
        const next = spliceBlankRow(lines, 3, 3, "before");
        expect(next).toEqual(["# title", "", "", "hello", "", "tail"]);
    });

    it("splices below the END line for multi-line blocks (list stays closed)", () => {
        const list = ["# title", "", "- one", "- two", "", "tail"];
        const next = spliceBlankRow(list, 3, 4, "after");
        expect(next).toEqual(["# title", "", "- one", "- two", "", "", "tail"]);
    });

    it("splices above the START line for multi-line blocks", () => {
        const list = ["# title", "", "- one", "- two", "", "tail"];
        const next = spliceBlankRow(list, 3, 4, "before");
        expect(next).toEqual(["# title", "", "", "- one", "- two", "", "tail"]);
    });
});

describe("paragraph inline placeholder (click insert on a <p> → flush soft-broken line)", () => {
    // The paragraph-insert path: spliceBlankRow pre-inserts ONE blank row directly above /
    // below the paragraph's content, then the commit replaces that row with the draft using
    // replaceSourceRange (NO separator re-padding) — the paragraph's own surrounding blanks
    // already bracket it, so the new text reads as a soft-broken line flush with the
    // paragraph. These tests model the full click → type → commit chain on plain text.
    it("insert-below: new line sits flush under the paragraph, paragraph separator kept", () => {
        const doc = "line A\n\nline B";
        const afterClick = spliceBlankRow(doc.split(/\r\n|\n/), 1, 1, "after").join("\n");
        const committed = replaceSourceRange(afterClick, 2, 2, "new line");
        expect(committed).toBe("line A\nnew line\n\nline B"); // no blank between A and new line
    });

    it("insert-above: new line sits flush above the paragraph", () => {
        const doc = "line A\n\nline B";
        const afterClick = spliceBlankRow(doc.split(/\r\n|\n/), 1, 1, "before").join("\n");
        const committed = replaceSourceRange(afterClick, 1, 1, "new line");
        expect(committed).toBe("new line\nline A\n\nline B");
    });

    it("multi-line paragraph (soft-broken a/b): insert-below lands after b, flush", () => {
        const doc = "a\nb\n\nc"; // paragraph spans lines 1-2
        const afterClick = spliceBlankRow(doc.split(/\r\n|\n/), 1, 2, "after").join("\n");
        const committed = replaceSourceRange(afterClick, 3, 3, "X");
        expect(committed).toBe("a\nb\nX\n\nc"); // X flush under b, single blank before c
    });

    it("multi-line draft flushes too (no separator injected mid-draft)", () => {
        const doc = "line A\n\nline B";
        const afterClick = spliceBlankRow(doc.split(/\r\n|\n/), 1, 1, "after").join("\n");
        const committed = replaceSourceRange(afterClick, 2, 2, "one\ntwo");
        expect(committed).toBe("line A\none\ntwo\n\nline B");
    });

    it("empty draft on a paragraph insert reverts the pre-inserted row (zero trace)", () => {
        const doc = "line A\n\nline B";
        const afterClick = spliceBlankRow(doc.split(/\r\n|\n/), 1, 1, "after").join("\n");
        // The hook's empty-commit path calls insertRevert() → restores the pre-click text.
        expect(afterClick).toBe("line A\n\n\nline B"); // pre-insert visible (one extra blank)
        expect(doc).toBe("line A\n\nline B"); // revert lands back here
    });
});

describe("commitPlaceholderBlock (placeholder row → real block)", () => {
    // Original doc "# title / blank / hello / blank / tail"; after clicking "insert below"
    // on hello (line 3) a single blank row was spliced in at line 4, so the editor sits on
    // line 4 and the doc is hello / [line4 blank] / blank / tail.
    const afterInsert = "# title\n\nhello\n\n\ntail";

    it("replaces the placeholder row with content and restores the front separator", () => {
        // hello | [edited row] | blank | tail → hello/blank/edited/blank/tail
        expect(commitPlaceholderBlock(afterInsert, 4, 4, "edited")).toBe(
            "# title\n\nhello\n\nedited\n\ntail"
        );
    });

    it("keeps an existing front separator (no duplicate blank pushed in front)", () => {
        // hello already has a blank above the placeholder line → front blank NOT duplicated
        const doc = "# title\n\nhello\n\n\n\ntail"; // placeholder row = line 5
        expect(commitPlaceholderBlock(doc, 5, 5, "edited")).toBe(
            "# title\n\nhello\n\nedited\n\ntail"
        );
    });

    it("adds a rear separator when the row below is content", () => {
        // hello | blank | [edited row] | tail → replaced row sits directly above content
        expect(commitPlaceholderBlock("hello\n\n\ntail", 3, 3, "edited")).toBe(
            "hello\n\nedited\n\ntail"
        );
    });

    it("nets exactly one block under repeated inserts (no blank accumulation)", () => {
        const afterOnce = commitPlaceholderBlock(afterInsert, 4, 4, "one");
        expect(afterOnce).toBe("# title\n\nhello\n\none\n\ntail");
        // Insert again below "one" (line 5): splice 1 blank at line 6, commit "two" there.
        const preInsertTwo = spliceBlankRow(afterOnce.split(/\r\n|\n/), 5, 5, "after").join("\n");
        const afterTwice = commitPlaceholderBlock(preInsertTwo, 6, 6, "two");
        expect(afterTwice).toBe("# title\n\nhello\n\none\n\ntwo\n\ntail");
    });

    it("supports multi-line drafts (blank lines inside the draft survive)", () => {
        // Rear separator is added past the draft's LAST row, not its first.
        expect(commitPlaceholderBlock("hello\n\n\ntail", 3, 3, "a\n\nb")).toBe(
            "hello\n\na\n\nb\n\ntail"
        );
    });

    it("does not pad a placeholder row at the document head", () => {
        // title | blank | [placeholder line 3] | body — no content above to separate from
        expect(commitPlaceholderBlock("title\n\n\nbody", 3, 3, "new")).toBe(
            "title\n\nnew\n\nbody"
        );
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
        // placeholder path: exactly ONE blank row is pre-inserted (not two), newLine points at it
        expect(text).toBe("# title\n\nhello world\n\n\nend");
        expect(newLine).toBe(4);
    });

    it("caret at the start → blank line inserted above, original text becomes the after block", () => {
        const { text, newLine } = splitBlockAtCaretText(fullText, startLine, endLine, draft, 0);
        // placeholder path: exactly ONE blank row above
        expect(text).toBe("# title\n\n\nhello world\n\nend");
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
