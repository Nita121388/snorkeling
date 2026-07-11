// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { classifyMacOSFirstMouseTarget, shouldPassThroughMacOSFirstMouse } from "./macos-first-click";

function makeTarget(matches: string[]): EventTarget {
    return {
        closest: (selector: string) => (selector.split(", ").some((part) => matches.includes(part)) ? {} : null),
    } as unknown as EventTarget;
}

describe("classifyMacOSFirstMouseTarget", () => {
    it("lets selection quick actions receive the first click", () => {
        expect(classifyMacOSFirstMouseTarget(makeTarget(["[data-selection-quick-action]", "button"]))).toBe(
            "quick-action"
        );
    });

    it("lets a terminal without mouse tracking start a first-mouse selection", () => {
        expect(classifyMacOSFirstMouseTarget(makeTarget([".term-connectelem"]))).toBe("selection-surface");
    });

    it("lets the terminal gesture router receive the first mouse while tracking is active", () => {
        expect(classifyMacOSFirstMouseTarget(makeTarget([".term-connectelem", ".xterm.enable-mouse-events"]))).toBe(
            "selection-surface"
        );
    });

    it("keeps unrelated content on the guarded path", () => {
        expect(classifyMacOSFirstMouseTarget(makeTarget([]))).toBe("default");
        expect(classifyMacOSFirstMouseTarget(new EventTarget())).toBe("default");
    });
});

describe("shouldPassThroughMacOSFirstMouse", () => {
    it("only passes through an unmodified primary click", () => {
        expect(shouldPassThroughMacOSFirstMouse("selection-surface", 0, false, false)).toBe(true);
        expect(shouldPassThroughMacOSFirstMouse("quick-action", 0, false, false)).toBe(true);
        expect(shouldPassThroughMacOSFirstMouse("selection-surface", 2, false, false)).toBe(false);
        expect(shouldPassThroughMacOSFirstMouse("selection-surface", 0, true, false)).toBe(false);
        expect(shouldPassThroughMacOSFirstMouse("selection-surface", 0, false, true)).toBe(false);
    });
});
