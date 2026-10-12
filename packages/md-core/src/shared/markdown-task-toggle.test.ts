// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "vitest";
import { toggleTaskCheckboxAtLine } from "./markdown-task-toggle";

describe("toggleTaskCheckboxAtLine", () => {
    test("toggles an unchecked unordered task to checked", () => {
        const text = "hello\n- [ ] buy milk\nbye";
        expect(toggleTaskCheckboxAtLine(text, 2)).toBe("hello\n- [x] buy milk\nbye");
    });

    test("toggles a checked task back to unchecked", () => {
        expect(toggleTaskCheckboxAtLine("- [x] done", 1)).toBe("- [ ] done");
    });

    test("accepts uppercase X marker", () => {
        expect(toggleTaskCheckboxAtLine("- [X] done", 1)).toBe("- [ ] done");
    });

    test("supports * and + bullet markers", () => {
        expect(toggleTaskCheckboxAtLine("* [ ] a", 1)).toBe("* [x] a");
        expect(toggleTaskCheckboxAtLine("+ [ ] b", 1)).toBe("+ [x] b");
    });

    test("supports ordered list tasks", () => {
        expect(toggleTaskCheckboxAtLine("3. [ ] third", 1)).toBe("3. [x] third");
    });

    test("supports blockquote-wrapped tasks", () => {
        expect(toggleTaskCheckboxAtLine("> - [ ] quoted", 1)).toBe("> - [x] quoted");
        expect(toggleTaskCheckboxAtLine("> > 1. [x] deep", 1)).toBe("> > 1. [ ] deep");
    });

    test("only flips the checkbox marker, leaving text intact", () => {
        const text = "- [ ] escape [x] literal in body";
        expect(toggleTaskCheckboxAtLine(text, 1)).toBe("- [x] escape [x] literal in body");
    });

    test("preserves a trailing CR on the flipped line", () => {
        const text = "- [ ] a\r\nnext";
        expect(toggleTaskCheckboxAtLine(text, 1)).toBe("- [x] a\r\nnext");
    });

    test("returns null for non-task lines", () => {
        expect(toggleTaskCheckboxAtLine("plain paragraph", 1)).toBeNull();
        expect(toggleTaskCheckboxAtLine("- just a bullet", 1)).toBeNull();
        expect(toggleTaskCheckboxAtLine("[ ] not at line start ok", 1)).toBeNull();
    });

    test("returns null for out-of-range lines", () => {
        const text = "- [ ] only line";
        expect(toggleTaskCheckboxAtLine(text, 0)).toBeNull();
        expect(toggleTaskCheckboxAtLine(text, 2)).toBeNull();
        expect(toggleTaskCheckboxAtLine(text, Number.NaN)).toBeNull();
    });

    test("does not mutate the input string", () => {
        const text = "- [ ] a";
        toggleTaskCheckboxAtLine(text, 1);
        expect(text).toBe("- [ ] a");
    });
});
