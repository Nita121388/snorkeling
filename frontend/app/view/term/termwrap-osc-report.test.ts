// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Tests for the OSC 10/11 color-query reporting added for light-terminal support
// (Codex composer black-on-black upstream issue). The hex -> rgb:rrrr/gggg/bbbb
// conversion must mirror xterm.js toRgbString(pad, 16) exactly, since Codex parses
// it the same way it parses a native terminal response.
import { describe, expect, it } from "vitest";
import { hexToRgb16 } from "./termwrap";

describe("hexToRgb16", () => {
    it("converts a light theme background to xterm 16-bit rgb format", () => {
        // default-light background #faf7f0 -> rgb:fafa/f7f7/f0f0 (xterm duplicates the 8-bit byte)
        expect(hexToRgb16("#faf7f0")).toBe("rgb:fafa/f7f7/f0f0");
    });

    it("converts a dark theme background to xterm 16-bit rgb format", () => {
        // default-dark background #000000 -> rgb:0000/0000/0000
        expect(hexToRgb16("#000000")).toBe("rgb:0000/0000/0000");
    });

    it("pads single-digit channels", () => {
        // #0a0b0c -> 0a->0a0a, 0b->0b0b, 0c->0c0c
        expect(hexToRgb16("#0a0b0c")).toBe("rgb:0a0a/0b0b/0c0c");
    });

    it("falls back to black for malformed input", () => {
        expect(hexToRgb16("not-a-color")).toBe("rgb:0000/0000/0000");
        expect(hexToRgb16("#faf7f0ff")).toBe("rgb:0000/0000/0000");
    });
});
