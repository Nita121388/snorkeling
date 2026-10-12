// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "vitest";
import { detectInlineTrigger, normalizeTriggerChar } from "./triggers";

describe("normalizeTriggerChar", () => {
    test("full-width chars map to half-width; everything else unchanged", () => {
        expect(normalizeTriggerChar("：")).toBe(":");
        expect(normalizeTriggerChar("／")).toBe("/");
        expect(normalizeTriggerChar("＃")).toBe("#");
        expect(normalizeTriggerChar("·")).toBe("`");
        expect(normalizeTriggerChar("a")).toBe("a");
    });
});

describe("detectInlineTrigger", () => {
    test("slash at line start fires with query", () => {
        const m = detectInlineTrigger("/head", 5);
        expect(m).toEqual({ command: "slash", triggerStart: 0, queryStart: 1, query: "head" });
    });

    test("full-width slash fires the same", () => {
        const m = detectInlineTrigger("／tab", 4);
        expect(m?.command).toBe("slash");
        expect(m?.query).toBe("tab");
    });

    test("slash NOT at line start does not fire", () => {
        expect(detectInlineTrigger("a/b", 3)).toBeNull();
        expect(detectInlineTrigger("go /home", 8)).toBeNull();
    });

    test("emoji double-colon after a boundary char fires", () => {
        const m = detectInlineTrigger("hello ::smi", 11);
        expect(m).toEqual({ command: "emoji", triggerStart: 6, queryStart: 8, query: "smi" });
    });

    test("single colon does NOT fire", () => {
        expect(detectInlineTrigger("hello :smi", 10)).toBeNull();
        expect(detectInlineTrigger(":", 1)).toBeNull();
        expect(detectInlineTrigger("：心", 2)).toBeNull();
    });

    test("full-width double-colon fires (IME-open case)", () => {
        const m = detectInlineTrigger("：：心", 3);
        expect(m?.command).toBe("emoji");
        expect(m?.query).toBe("心");
    });

    test("mixed half+full width double-colon fires", () => {
        expect(detectInlineTrigger(":：smi", 5)?.command).toBe("emoji");
        expect(detectInlineTrigger("：:smi", 5)?.command).toBe("emoji");
    });

    test("double colon inside a URL does NOT fire (no boundary before '::')", () => {
        expect(detectInlineTrigger("https://example.com", 19)).toBeNull();
    });

    test("double colon directly after a word char does NOT fire", () => {
        expect(detectInlineTrigger("a::b", 4)).toBeNull();
    });

    test("emoji double-colon that is actually triple-colon: first valid pair from right wins", () => {
        // "hello :::smi" — pair [7,8] fails boundary (':' at pos 6 not a boundary),
        // so pair [6,7] wins, query becomes ":smi" (3rd colon absorbed into query).
        const m = detectInlineTrigger("hello :::smi", 12);
        expect(m?.command).toBe("emoji");
        expect(m?.triggerStart).toBe(6);
        expect(m?.query).toBe(":smi");
    });

    test("a space between trigger and caret dismisses (query contains whitespace)", () => {
        expect(detectInlineTrigger("/he llo", 7)).toBeNull();
        expect(detectInlineTrigger("::smi le", 8)).toBeNull();
    });

    test("triggers never fire inside a fenced code block", () => {
        const draft = "```\n::smi\n```";
        const caret = 4 + "::smi".length; // after "::smi" on line 2
        expect(detectInlineTrigger(draft, caret)).toBeNull();
    });

    test("no trigger char before caret on the line → null", () => {
        expect(detectInlineTrigger("plain", 5)).toBeNull();
        expect(detectInlineTrigger("", 0)).toBeNull();
    });

    test("caret at double-colon boundary: empty query is still a trigger", () => {
        const m = detectInlineTrigger("::", 2);
        expect(m).toEqual({ command: "emoji", triggerStart: 0, queryStart: 2, query: "" });
    });

    test("emoji trigger ignores chars on OTHER lines", () => {
        const draft = "::old\nnewline";
        // caret at end of "newline": line 2 has no trigger
        expect(detectInlineTrigger(draft, draft.length)).toBeNull();
    });

    test("nearest trigger wins: last one before the caret on the line", () => {
        const m = detectInlineTrigger("::a ::b", 7);
        expect(m?.triggerStart).toBe(4);
        expect(m?.query).toBe("b");
    });
});
