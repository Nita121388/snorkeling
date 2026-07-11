// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type * as TermTypes from "@xterm/xterm";
import { describe, expect, it } from "vitest";
import { terminalLogicalLinesForSelection, terminalSelectionToSingleLine } from "./termutil";

function makeBuffer(lines: Array<{ text: string; isWrapped?: boolean }>): TermTypes.IBuffer {
    return {
        length: lines.length,
        getLine: (index: number) => {
            const line = lines[index];
            if (line == null) {
                return undefined;
            }
            return {
                isWrapped: line.isWrapped ?? false,
                translateToString: (trimRight?: boolean) => (trimRight ? line.text.trimEnd() : line.text),
            };
        },
    } as TermTypes.IBuffer;
}

function makeSelection(startY: number, endY: number, endX = 1) {
    return {
        start: { x: 0, y: startY },
        end: { x: endX, y: endY },
    } as ReturnType<TermTypes.Terminal["getSelectionPosition"]>;
}

describe("terminalLogicalLinesForSelection", () => {
    it("expands a small selection to the complete soft-wrapped logical line", () => {
        const buffer = makeBuffer([
            { text: "npm install long-" },
            { text: "package-name", isWrapped: true },
            { text: "next command" },
        ]);

        expect(terminalLogicalLinesForSelection(buffer, makeSelection(1, 1))).toBe("npm install long-package-name");
    });

    it("preserves real newlines between all logical lines touched by the selection", () => {
        const buffer = makeBuffer([
            { text: "first-" },
            { text: "line", isWrapped: true },
            { text: "second-" },
            { text: "line", isWrapped: true },
        ]);

        expect(terminalLogicalLinesForSelection(buffer, makeSelection(1, 2))).toBe("first-line\nsecond-line");
    });

    it("does not include an end row when the selection ends at column zero", () => {
        const buffer = makeBuffer([{ text: "first" }, { text: "second" }]);

        expect(terminalLogicalLinesForSelection(buffer, makeSelection(0, 1, 0))).toBe("first");
    });
});

describe("terminalSelectionToSingleLine", () => {
    it("folds hard line breaks and their indentation into one space", () => {
        expect(terminalSelectionToSingleLine("  npm install  \n    package-a\r\n\tpackage-b  ")).toBe(
            "npm install package-a package-b"
        );
    });

    it("keeps spacing inside each physical line", () => {
        expect(terminalSelectionToSingleLine("echo  first\n  second")).toBe("echo  first second");
    });
});
