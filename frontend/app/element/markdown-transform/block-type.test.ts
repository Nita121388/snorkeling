// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "vitest";
import {
    applyTypingPatternAtLine,
    detectBlockKind,
    matchTypingPattern,
    rewriteDraftFirstLine,
    transformBlockType,
} from "./block-type";

describe("detectBlockKind", () => {
    test("plain paragraph → text", () => {
        expect(detectBlockKind(["hello world", "second line"], 1)).toBe("text");
        expect(detectBlockKind(["hello world", "second line"], 2)).toBe("text");
    });

    test("headings h1-h6", () => {
        const lines = ["# a", "## b", "### c", "#### d", "##### e", "###### f"];
        for (let i = 0; i < 6; i++) {
            expect(detectBlockKind(lines, i + 1)).toBe(`heading${i + 1}`);
        }
    });

    test("quote and callout", () => {
        expect(detectBlockKind(["> quoted", "> more"], 2)).toBe("quote");
        expect(detectBlockKind(["> [!note] hey", "> body"], 1)).toBe("callout");
        expect(detectBlockKind(["> [!note] hey", "> body"], 2)).toBe("callout");
    });

    test("list kinds", () => {
        expect(detectBlockKind(["- a", "- b"], 2)).toBe("bulleted");
        expect(detectBlockKind(["* a"], 1)).toBe("bulleted");
        expect(detectBlockKind(["1. a", "2. b"], 1)).toBe("numbered");
        expect(detectBlockKind(["3) a"], 1)).toBe("numbered");
        expect(detectBlockKind(["- [ ] task"], 1)).toBe("todo");
        expect(detectBlockKind(["- [x] done"], 1)).toBe("todo");
    });

    test("nested list item still detects as list", () => {
        const lines = ["- a", "  - nested", "    1. deep"];
        expect(detectBlockKind(lines, 2)).toBe("bulleted");
        expect(detectBlockKind(lines, 3)).toBe("bulleted");
    });

    test("code fence: opener, body and closer all report code", () => {
        const lines = ["```ts", "const x = 1;", "# not a heading", "```"];
        for (let i = 1; i <= 4; i++) {
            expect(detectBlockKind(lines, i)).toBe("code");
        }
    });

    test("table: header, separator and body rows report table", () => {
        const lines = ["| a | b |", "| --- | --- |", "| 1 | 2 |"];
        for (let i = 1; i <= 3; i++) {
            expect(detectBlockKind(lines, i)).toBe("table");
        }
    });

    test("a lone pipe line without a separator is text, not table", () => {
        expect(detectBlockKind(["| a | b |", "following"], 1)).toBe("text");
    });

    test("a pipe run whose separator is not the second line is text", () => {
        expect(detectBlockKind(["| a |", "| b |", "| c |"], 2)).toBe("text");
    });

    test("blank and out-of-range lines → null", () => {
        expect(detectBlockKind(["a", "", "b"], 2)).toBeNull();
        expect(detectBlockKind(["a"], 0)).toBeNull();
        expect(detectBlockKind(["a"], 5)).toBeNull();
    });

    test("list patterns inside a fence stay code", () => {
        const lines = ["```", "- not a list", "```"];
        expect(detectBlockKind(lines, 2)).toBe("code");
    });
});

describe("transformBlockType", () => {
    test("text → heading2 and back", () => {
        expect(transformBlockType("hello", 1, "heading2")?.text).toBe("## hello");
        expect(transformBlockType("## hello", 1, "text")?.text).toBe("hello");
    });

    test("heading level change keeps content", () => {
        expect(transformBlockType("# Title", 1, "heading4")?.text).toBe("#### Title");
    });

    test("multi-line paragraph → numbered list renumbers per indent", () => {
        const out = transformBlockType("alpha\nbeta\ngamma", 2, "numbered");
        expect(out?.text).toBe("1. alpha\n2. beta\n3. gamma");
    });

    test("text → bulleted / todo", () => {
        expect(transformBlockType("milk", 1, "bulleted")?.text).toBe("- milk");
        expect(transformBlockType("milk", 1, "todo")?.text).toBe("- [ ] milk");
    });

    test("bulleted list → text strips markers but keeps indent (nested)", () => {
        const out = transformBlockType("- root\n  - child\n- back", 1, "text");
        expect(out?.text).toBe("root\n  child\nback");
    });

    test("bulleted ⇄ numbered swaps markers, nested counters independent", () => {
        const list = "- a\n  - x\n  - y\n- b";
        const numbered = transformBlockType(list, 1, "numbered")?.text;
        expect(numbered).toBe("1. a\n  1. x\n  2. y\n2. b");
        expect(transformBlockType(numbered!, 1, "bulleted")?.text).toBe(list);
    });

    test("bulleted → todo adds checkbox; todo → bulleted drops it", () => {
        expect(transformBlockType("- a\n- b", 1, "todo")?.text).toBe("- [ ] a\n- [ ] b");
        expect(transformBlockType("- [x] a", 1, "bulleted")?.text).toBe("- a");
    });

    test("todo → todo is a no-op (null)", () => {
        expect(transformBlockType("- [ ] a", 1, "todo")).toBeNull();
    });

    test("text ⇄ quote", () => {
        expect(transformBlockType("line one\nline two", 1, "quote")?.text).toBe("> line one\n> line two");
        expect(transformBlockType("> line one\n> line two", 1, "text")?.text).toBe("line one\nline two");
    });

    test("quote ⇄ bulleted", () => {
        expect(transformBlockType("> a\n> b", 1, "bulleted")?.text).toBe("- a\n- b");
        // list → quote strips the markers first (plain-content semantics)
        expect(transformBlockType("- a\n- b", 1, "quote")?.text).toBe("> a\n> b");
    });

    test("paragraph ⇄ code block", () => {
        const toCode = transformBlockType("const a = 1;\nconsole.log(a);", 1, "code");
        expect(toCode?.text).toBe("```\nconst a = 1;\nconsole.log(a);\n```");
        const back = transformBlockType(toCode!.text, 2, "text");
        expect(back?.text).toBe("const a = 1;\nconsole.log(a);");
    });

    test("paragraph with pipes → table; plain paragraph → 1-col table", () => {
        expect(transformBlockType("a | b", 1, "table")?.text).toBe("| a | b |\n| --- | --- |");
        expect(transformBlockType("hello", 1, "table")?.text).toBe("| hello |\n| --- |");
    });

    test("table → text keeps cell contents, drops separator", () => {
        const tbl = "| h1 | h2 |\n| --- | --- |\n| 1 | 2 |";
        expect(transformBlockType(tbl, 2, "text")?.text).toBe("h1 | h2\n1 | 2");
    });

    test("same kind → null; blank anchor → null", () => {
        expect(transformBlockType("# a", 1, "heading1")).toBeNull();
        expect(transformBlockType("a\n\nb", 2, "quote")).toBeNull();
        expect(transformBlockType("a", 9, "quote")).toBeNull();
    });

    test("transforming a middle block leaves the rest of the document untouched", () => {
        const doc = "# Top\n\nmid para\n\n- tail\n";
        const out = transformBlockType(doc, 3, "heading3");
        expect(out?.text).toBe("# Top\n\n### mid para\n\n- tail\n");
    });

    test("caret lands at end of the first rewritten line", () => {
        const out = transformBlockType("hello", 1, "heading2");
        expect(out?.caret).toBe("## hello".length);
    });

    test("code target around a quote wraps the stripped text, not the > markers", () => {
        expect(transformBlockType("> quoted", 1, "code")?.text).toBe("```\nquoted\n```");
    });
});

describe("matchTypingPattern", () => {
    test("canonical half-width inputs rewrite to themselves (caller no-op)", () => {
        expect(matchTypingPattern("# Hello")).toEqual({ kind: "heading1", rewrittenLine: "# Hello" });
        expect(matchTypingPattern("### Deep")).toEqual({ kind: "heading3", rewrittenLine: "### Deep" });
        expect(matchTypingPattern("> quote")).toEqual({ kind: "quote", rewrittenLine: "> quote" });
        expect(matchTypingPattern("- item")).toEqual({ kind: "bulleted", rewrittenLine: "- item" });
        expect(matchTypingPattern("* item")).toEqual({ kind: "bulleted", rewrittenLine: "* item" });
        expect(matchTypingPattern("2. item")).toEqual({ kind: "numbered", rewrittenLine: "2. item" });
        expect(matchTypingPattern("- [ ] task")).toEqual({ kind: "todo", rewrittenLine: "- [ ] task" });
    });

    test("full-width variants canonicalize （＃ ＞ ＊ ＋ ···)", () => {
        expect(matchTypingPattern("＃ Title")).toEqual({ kind: "heading1", rewrittenLine: "# Title" });
        expect(matchTypingPattern("＃＃ Title")).toEqual({ kind: "heading2", rewrittenLine: "## Title" });
        expect(matchTypingPattern("＞ quote")).toEqual({ kind: "quote", rewrittenLine: "> quote" });
        expect(matchTypingPattern("＊ item")).toEqual({ kind: "bulleted", rewrittenLine: "- item" });
        expect(matchTypingPattern("＋ item")).toEqual({ kind: "bulleted", rewrittenLine: "- item" });
        expect(matchTypingPattern("＊ [ ] chore")).toEqual({ kind: "todo", rewrittenLine: "- [ ] chore" });
    });

    test("checkbox X canonicalizes to lowercase", () => {
        expect(matchTypingPattern("- [X] done")).toEqual({ kind: "todo", rewrittenLine: "- [x] done" });
        expect(matchTypingPattern("1. [X] done")).toEqual({ kind: "todo", rewrittenLine: "1. [x] done" });
    });

    test("code fence auto-closes; lang preserved", () => {
        expect(matchTypingPattern("```js")).toEqual({ kind: "code", rewrittenLine: "```js\n```" });
        expect(matchTypingPattern("```")).toEqual({ kind: "code", rewrittenLine: "```\n```" });
        expect(matchTypingPattern("~~~py")).toEqual({ kind: "code", rewrittenLine: "```py\n```" });
        expect(matchTypingPattern("···go")).toEqual({ kind: "code", rewrittenLine: "```go\n```" });
    });

    test("pipe line becomes header + separator", () => {
        expect(matchTypingPattern("| a | b |")).toEqual({
            kind: "table",
            rewrittenLine: "| a | b |\n| --- | --- |",
        });
    });

    test("callout is recognized when typed", () => {
        expect(matchTypingPattern("> [!warning] careful")).toEqual({
            kind: "callout",
            rewrittenLine: "> [!warning] careful",
        });
    });

    test("non-patterns return null", () => {
        expect(matchTypingPattern("#nospace")).toBeNull();
        expect(matchTypingPattern("plain text")).toBeNull();
        expect(matchTypingPattern("")).toBeNull();
        expect(matchTypingPattern("   ")).toBeNull();
    });

    test("4+ space indent is code context, not a trigger", () => {
        expect(matchTypingPattern("    # not heading")).toBeNull();
        expect(matchTypingPattern("    - not a list")).toBeNull();
    });

    test("small indents are preserved", () => {
        expect(matchTypingPattern("  # nested-ish")).toEqual({ kind: "heading1", rewrittenLine: "  # nested-ish" });
    });
});

describe("rewriteDraftFirstLine", () => {
    test("rewrites only when the first line changes", () => {
        expect(rewriteDraftFirstLine("# ok")).toBeNull();
        expect(rewriteDraftFirstLine("＃ fix")).toBe("# fix");
    });

    test("rest of the draft is preserved after a fence auto-close", () => {
        expect(rewriteDraftFirstLine("```js\nfollow-up text")).toBe("```js\n```\nfollow-up text");
    });

    test("empty draft → null", () => {
        expect(rewriteDraftFirstLine("")).toBeNull();
    });
});

describe("applyTypingPatternAtLine", () => {
    test("applies full-width heading rewrite on committed text", () => {
        const out = applyTypingPatternAtLine("intro\n＃ Title\n\nnext", 2);
        expect(out?.text).toBe("intro\n# Title\n\nnext");
        expect(out?.lineDelta).toBe(0);
    });

    test("auto-closes a freshly typed unclosed fence", () => {
        const out = applyTypingPatternAtLine("```js\n", 1);
        expect(out?.text).toBe("```js\n```\n");
        expect(out?.lineDelta).toBe(1);
    });

    test("does NOT double-close an already-closed fence", () => {
        expect(applyTypingPatternAtLine("```js\nx\n```", 1)).toBeNull();
    });

    test("never fires inside code", () => {
        expect(applyTypingPatternAtLine("```\n＃ inside code\n```", 2)).toBeNull();
    });

    test("never fires on an existing table row", () => {
        const tbl = "| a | b |\n| --- | --- |\n| 1 | 2 |";
        expect(applyTypingPatternAtLine(tbl, 1)).toBeNull();
        expect(applyTypingPatternAtLine(tbl, 3)).toBeNull();
    });

    test("blank / out-of-range lines are safe no-ops", () => {
        expect(applyTypingPatternAtLine("a\n\nb", 2)).toBeNull();
        expect(applyTypingPatternAtLine("a", 7)).toBeNull();
    });
});
