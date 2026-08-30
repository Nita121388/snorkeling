// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "vitest";
import { applyInlineStyle, hasInlineStyle } from "./inline-style";

describe("applyInlineStyle — wrap", () => {
    test("wraps a selection with bold markers", () => {
        expect(applyInlineStyle("make this bold", 5, 9, "bold")).toEqual({
            text: "make **this** bold",
            start: 7,
            end: 11,
        });
    });

    test("italic / strike / code / kbd", () => {
        expect(applyInlineStyle("word", 0, 4, "italic")?.text).toBe("*word*");
        expect(applyInlineStyle("word", 0, 4, "strike")?.text).toBe("~~word~~");
        expect(applyInlineStyle("word", 0, 4, "code")?.text).toBe("`word`");
        expect(applyInlineStyle("word", 0, 4, "kbd")?.text).toBe("<kbd>word</kbd>");
    });

    test("empty selection inserts an empty marker pair with caret inside", () => {
        expect(applyInlineStyle("ab", 1, 1, "bold")).toEqual({ text: "a****b", start: 3, end: 3 });
    });

    test("never wraps across a line break", () => {
        expect(applyInlineStyle("line one\nline two", 0, 12, "bold")).toBeNull();
    });
});

describe("applyInlineStyle — strip", () => {
    test("markers OUTSIDE the selection strip off", () => {
        const r = applyInlineStyle("**bold**", 2, 6, "bold");
        expect(r?.text).toBe("bold");
        expect(r?.start).toBe(0);
        expect(r?.end).toBe(4);
    });

    test("markers INSIDE the selection strip too", () => {
        expect(applyInlineStyle("x **bold** y", 2, 10, "bold")?.text).toBe("x bold y");
    });

    test("italic inside **bold** nests instead of stripping the bold pair", () => {
        expect(applyInlineStyle("**bold**", 2, 6, "italic")?.text).toBe("***bold***");
    });
});

describe("applyInlineStyle — link", () => {
    test("label selection gets parens with caret inside", () => {
        const r = applyInlineStyle("click here", 6, 10, "link");
        expect(r?.text).toBe("click [here]()");
        expect(r?.start).toBe(13); // inside the parens, ready to type the URL
        expect(r?.end).toBe(13);
    });

    test("url selection becomes the href, caret in label slot", () => {
        const r = applyInlineStyle("see https://a.b/c", 4, 17, "link");
        expect(r?.text).toBe("see [](https://a.b/c)");
        expect(r?.start).toBe(5);
        expect(r?.end).toBe(5);
    });

    test("full [label](url) selection strips back to label", () => {
        const r = applyInlineStyle("go [docs](https://x) now", 3, 20, "link");
        expect(r?.text).toBe("go docs now");
        expect(r?.end).toBe(r?.start! + 4);
    });
});

describe("hasInlineStyle", () => {
    test("detects wrapper around selection and around content", () => {
        expect(hasInlineStyle("**bold**", 2, 6, "bold")).toBe(true);
        expect(hasInlineStyle("**bold**", 0, 8, "bold")).toBe(true);
        expect(hasInlineStyle("plain", 0, 5, "bold")).toBe(false);
    });

    test("link detection: full form and label-inside form", () => {
        expect(hasInlineStyle("[docs](https://x)", 0, 18, "link")).toBe(true);
        expect(hasInlineStyle("[docs](https://x)", 1, 5, "link")).toBe(true);
        expect(hasInlineStyle("plain", 0, 5, "link")).toBe(false);
    });
});
