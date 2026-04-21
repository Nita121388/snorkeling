// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { clampSelectionCopyOverlayPosition } from "@/app/element/selection-copy-overlay";
import { describe, expect, it } from "vitest";

describe("selection copy overlay helpers", () => {
    it("keeps the copy button inside the container bounds", () => {
        expect(clampSelectionCopyOverlayPosition(100, 60, 90, 50)).toEqual({ x: 68, y: 28 });
    });

    it("applies a minimum inset from the top-left corner", () => {
        expect(clampSelectionCopyOverlayPosition(100, 60, 0, 1)).toEqual({ x: 8, y: 8 });
    });
});
