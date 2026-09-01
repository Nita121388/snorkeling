// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "vitest";
import { getCodeBlockLanguage, setCodeBlockLanguage } from "./code-block";

const DOC = "intro\n\n```ts\nconst a = 1;\n```\n\noutro\n\n~~~\nplain fence\n~~~";

describe("setCodeBlockLanguage", () => {
    test("sets a language on an unlang'd fence", () => {
        const out = setCodeBlockLanguage("```\ncode\n```", 2, "python");
        expect(out).toBe("```python\ncode\n```");
    });

    test("changes an existing language (from any line inside the block)", () => {
        expect(setCodeBlockLanguage(DOC, 4, "rs")).toBe(DOC.replace("```ts", "```rs"));
        expect(setCodeBlockLanguage(DOC, 3, "rs")).toBe(DOC.replace("```ts", "```rs"));
    });

    test("null / empty clears the language", () => {
        expect(setCodeBlockLanguage(DOC, 4, null)).toBe(DOC.replace("```ts", "```"));
        expect(setCodeBlockLanguage(DOC, 4, "")).toBe(DOC.replace("```ts", "```"));
    });

    test("tilde fences keep their marker character", () => {
        const out = setCodeBlockLanguage(DOC, 9, "text");
        expect(out).toContain("~~~text\nplain fence");
    });

    test("no-op when unchanged / not a fence", () => {
        expect(setCodeBlockLanguage(DOC, 4, "ts")).toBeNull();
        expect(setCodeBlockLanguage(DOC, 1, "ts")).toBeNull();
        expect(setCodeBlockLanguage(DOC, 99, "ts")).toBeNull();
    });

    test("language with spaces is normalized (single token)", () => {
        expect(setCodeBlockLanguage("```\nx\n```", 1, "c++")).toBe("```c++\nx\n```");
        expect(setCodeBlockLanguage("```\nx\n```", 1, "C plus plus")).toBe("```Cplusplus\nx\n```");
    });
});

describe("getCodeBlockLanguage", () => {
    test("reads the language from any line in the block", () => {
        expect(getCodeBlockLanguage(DOC, 3)).toBe("ts");
        expect(getCodeBlockLanguage(DOC, 4)).toBe("ts");
        expect(getCodeBlockLanguage(DOC, 5)).toBe("ts");
        expect(getCodeBlockLanguage(DOC, 9)).toBe("");
    });

    test("outside a fence → null", () => {
        expect(getCodeBlockLanguage(DOC, 1)).toBeNull();
        expect(getCodeBlockLanguage(DOC, 6)).toBeNull();
    });
});
