// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";
import {
    commitPlaceholderBlock,
    deleteBlockRange,
    expandBlockSelection,
    isSelectingRange,
    makeInlineEditKeydown,
    moveBlockRange,
    replaceSourceRange,
    resolveInlineEditTarget,
    spliceBlankRow,
    spliceInsertBlock,
    splitBlockAtCaretText,
    splitListItemDraft,
    makeListItemInsertMarker,
    type InlineEditSession,
} from "./markdown-inline-edit";

describe("makeInlineEditKeydown — merge-up on an emptied line", () => {
    // The handler only DETECTS the intent (empty draft + Backspace/Delete) and forwards to
    // onNavigateUp; the DOM navigation itself lives in markdown.tsx (focusEditedLine). This
    // keeps the decision pure and testable without a rendered editor.
    type KeyEv = Parameters<ReturnType<typeof makeInlineEditKeydown>>[0];
    const makeKeyEvent = (opts: {
        key: string;
        value?: string;
        selectionStart?: number;
        selectionEnd?: number;
        composing?: boolean;
        meta?: boolean;
        ctrl?: boolean;
        shift?: boolean;
    }): KeyEv => {
        const currentTarget = {
            value: opts.value ?? "",
            selectionStart: opts.selectionStart ?? 0,
            selectionEnd: opts.selectionEnd ?? 0,
        } as HTMLTextAreaElement;
        return {
            key: opts.key,
            metaKey: opts.meta ?? false,
            ctrlKey: opts.ctrl ?? false,
            shiftKey: opts.shift ?? false,
            currentTarget,
            nativeEvent: { isComposing: opts.composing ?? false } as KeyboardEvent,
            preventDefault: vi.fn(),
            stopPropagation: vi.fn(),
        } as unknown as KeyEv;
    };

    it("forwards Backspace on an empty draft to onNavigateUp", () => {
        const onNavigateUp = vi.fn();
        const handler = makeInlineEditKeydown({ commit: vi.fn(), cancel: vi.fn(), onNavigateUp });
        handler(makeKeyEvent({ key: "Backspace", value: "" }));
        expect(onNavigateUp).toHaveBeenCalledTimes(1);
    });

    it("forwards Delete on an empty draft to onNavigateUp", () => {
        const onNavigateUp = vi.fn();
        const handler = makeInlineEditKeydown({ commit: vi.fn(), cancel: vi.fn(), onNavigateUp });
        handler(makeKeyEvent({ key: "Delete", value: "" }));
        expect(onNavigateUp).toHaveBeenCalledTimes(1);
    });

    it("does NOT navigate up when the draft has content (native delete preserved)", () => {
        const onNavigateUp = vi.fn();
        const handler = makeInlineEditKeydown({ commit: vi.fn(), cancel: vi.fn(), onNavigateUp });
        handler(makeKeyEvent({ key: "Backspace", value: "hello", selectionStart: 0, selectionEnd: 0 }));
        expect(onNavigateUp).not.toHaveBeenCalled();
    });

    it("does NOT navigate up while IME is composing", () => {
        const onNavigateUp = vi.fn();
        const handler = makeInlineEditKeydown({ commit: vi.fn(), cancel: vi.fn(), onNavigateUp });
        handler(makeKeyEvent({ key: "Backspace", value: "", composing: true }));
        expect(onNavigateUp).not.toHaveBeenCalled();
    });

    it("does NOT navigate up with Cmd/Ctrl held (system delete, not merge-up)", () => {
        const onNavigateUp = vi.fn();
        const handler = makeInlineEditKeydown({ commit: vi.fn(), cancel: vi.fn(), onNavigateUp });
        handler(makeKeyEvent({ key: "Backspace", value: "", meta: true }));
        expect(onNavigateUp).not.toHaveBeenCalled();
    });
});
describe("isSelectingRange (click-to-edit drag suppression)", () => {
    it("only treats an active non-collapsed Range selection as an in-progress select gesture", () => {
        expect(isSelectingRange({ type: "Range", rangeCount: 1 })).toBe(true);
        expect(isSelectingRange(null)).toBe(false);
        expect(isSelectingRange({ type: "None", rangeCount: 0 })).toBe(false);
        expect(isSelectingRange({ type: "Caret", rangeCount: 1 })).toBe(false);
        expect(isSelectingRange({ type: "Range", rangeCount: 0 })).toBe(false);
        // missing Selection API (prerender / jsdom without Selection support)
        expect(isSelectingRange({ type: undefined, rangeCount: 0 })).toBe(false);
    });
});

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

    it("caret at end + MODIFIED draft → typed content is committed (Enter-loses-input bug)", () => {
        // Regression: user types in a fresh placeholder row, presses Enter to confirm —
        // the draft must land in the document instead of being silently discarded.
        const blankDoc = "# title\n\nhello world\n\n\n\nend"; // line 6 is the blank placeholder row, line 7 = end
        const { text, newLine } = splitBlockAtCaretText(blankDoc, 6, 6, "1. 测试内容", "1. 测试内容".length);
        expect(text).toBe("# title\n\nhello world\n\n\n1. 测试内容\n\nend");
        expect(newLine).toBe(7); // follow-up editor lands on the blank row below the content
    });

    it("caret at start + MODIFIED draft → typed content survives above-split", () => {
        const { text, newLine } = splitBlockAtCaretText(fullText, startLine, endLine, "HELLO world", 0);
        expect(text).toBe("# title\n\n\nHELLO world\n\nend");
        expect(newLine).toBe(3);
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

describe("splitListItemDraft (list Enter behavior)", () => {
    it("increments the marker number when splitting at line end", () => {
        const { text, newPos } = splitListItemDraft("5. Five", 7);
        expect(text).toBe("5. Five\n6. ");
        expect(newPos).toBe("5. Five\n".length + "6. ".length);
    });

    it("never copies content when the caret is at line start (the duplicated-1 bug)", () => {
        const item = "1. chatchat release notes";
        const { text } = splitListItemDraft(item, 0);
        // Old buggy behavior produced "\n1. 1. chatchat release notes" — a full copy.
        expect(text).toBe("1. \n" + item);
        expect(text.split("chatchat").length - 1).toBe(1);
    });

    it("splits mid-line text into the next item with an incremented marker", () => {
        const { text, newPos } = splitListItemDraft("2. helloworld", 8); // caret after "hello"
        expect(text).toBe("2. hello\n3. world");
        expect(newPos).toBe("2. hello\n".length + "3. ".length);
    });

    it("keeps bullet markers without inventing numbers", () => {
        expect(splitListItemDraft("- task", 6).text).toBe("- task\n- ");
    });

    it("uses a bare newline on continuation lines without a marker", () => {
        const draft = "3. item\ncontinuation";
        expect(splitListItemDraft(draft, draft.length)).toEqual({ text: `${draft}\n`, newPos: draft.length + 1 });
    });

    it("preserves indentation and delimiter style", () => {
        const { text } = splitListItemDraft("  1) indented", 13);
        expect(text).toBe("  1) indented\n  2) ");
    });
});

describe("makeListItemInsertMarker (+ button prefill)", () => {
    it("increments the number when inserting below", () => {
        expect(makeListItemInsertMarker("5. Five", "after")).toBe("6. ");
    });

    it("reuses the number when inserting above (renumbering normalizes later)", () => {
        expect(makeListItemInsertMarker("5. Five", "before")).toBe("5. ");
    });

    it("keeps bullet style without inventing numbers", () => {
        expect(makeListItemInsertMarker("- task", "after")).toBe("- ");
        expect(makeListItemInsertMarker("* task", "before")).toBe("* ");
    });

    it("preserves indentation and paren delimiters", () => {
        expect(makeListItemInsertMarker("  3) item", "after")).toBe("  4) ");
    });

    it("yields empty string for non-marker lines", () => {
        expect(makeListItemInsertMarker("plain text", "after")).toBe("");
    });
});

describe("expandBlockSelection (Ctrl/Cmd + drag range)", () => {
    it("anchors at the start and grows downward", () => {
        expect(expandBlockSelection(3, 5, 7)).toEqual({ startLine: 3, endLine: 7 });
    });

    it("anchors at the end and grows upward", () => {
        expect(expandBlockSelection(7, 3, 4)).toEqual({ startLine: 3, endLine: 7 });
    });

    it("normalizes min/max even when the crossed block straddles the anchor", () => {
        expect(expandBlockSelection(4, 2, 9)).toEqual({ startLine: 2, endLine: 9 });
    });

    it("a single crossed block equals the anchor → collapses to one line", () => {
        expect(expandBlockSelection(3, 3, 3)).toEqual({ startLine: 3, endLine: 3 });
    });
});

describe("moveBlockRange (drag-and-drop reorder)", () => {
    it("moves a block below its neighbor (before → after)", () => {
        // "hello" (line3) moved after "tail" (line5)
        const { text, newStartLine } = moveBlockRange("# title\n\nhello\n\ntail", 3, 3, 5, "after");
        expect(text).toBe("# title\n\ntail\n\nhello");
        expect(newStartLine).toBe(5);
    });

    it("moves a block above its neighbor (before → before)", () => {
        // "tail" (line5) moved before "hello" (line3)
        const { text, newStartLine } = moveBlockRange("# title\n\nhello\n\ntail", 5, 5, 3, "before");
        expect(text).toBe("# title\n\ntail\n\nhello");
        expect(newStartLine).toBe(3);
    });

    it("is a no-op when dropping a block onto itself", () => {
        const doc = "# title\n\nhello\n\ntail";
        const result = moveBlockRange(doc, 3, 3, 3, "after");
        expect(result.text).toBe(doc);
    });

    it("is a no-op when dropping within the source range", () => {
        const doc = "a\n\nb\nc\n\nd";
        const result = moveBlockRange(doc, 2, 3, 2, "before");
        expect(result.text).toBe(doc);
    });

    it("preserves a code block's internal blank lines during the move", () => {
        const doc = "# title\n\n\`\`\`\ncode line 1\n\ncode line 2\n\`\`\`\n\nhello";
        const { text } = moveBlockRange(doc, 2, 7, 9, "after");
        // The fence block (2 blank lines + ``` + 4 lines + ```) moves after hello,
        // and its internal blank lines survive intact.
        expect(text).toBe("# title\n\nhello\n\n\`\`\`\ncode line 1\n\ncode line 2\n\`\`\`");
    });

    it("collapses excess blank separators but never drops block internals", () => {
        const doc = "a\n\n\nb"; // line1=a, line2=blank, line3=blank, line4=b
        const { text, newStartLine } = moveBlockRange(doc, 1, 1, 4, "before");
        expect(text).toBe("b\n\na");
        expect(newStartLine).toBe(3);
    });

    it("moves a contiguous multi-block range (e.g. a Ctrl-selected span) as one unit", () => {
        // Blocks B (line3) + C (line5) are the dragged range [3..5]; drop after D (line7).
        const doc = "# title\n\nB\n\nC\n\nD";
        const { text, newStartLine } = moveBlockRange(doc, 3, 5, 7, "after");
        expect(text).toBe("# title\n\nD\n\nB\n\nC");
        expect(newStartLine).toBe(5); // B..C now occupy lines 5..7
    });

    it("moves a multi-block range upward (before a higher block)", () => {
        const doc = "A\n\nB\n\nC\n\nD";
        // range [5..7] (C + D) moved before A (line1)
        const { text, newStartLine } = moveBlockRange(doc, 5, 7, 1, "before");
        expect(text).toBe("C\n\nD\n\nA\n\nB");
        expect(newStartLine).toBe(1);
    });

    it("trims leading/trailing blanks after the move", () => {
        const doc = "hello\n\nworld";
        const { text, newStartLine } = moveBlockRange(doc, 3, 3, 1, "before");
        // world moved before hello (line 1); source [3..3] removed, world inserted at top.
        expect(text).toBe("world\n\nhello");
        expect(newStartLine).toBe(1);
    });
});

