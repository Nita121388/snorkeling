// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { clampSelectionCopyOverlayPosition, makeSelectionQuickActionMenu } from "@/app/element/selection-copy-overlay";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/commontext/commontext-model", () => ({
    addSelectionToCommonText: vi.fn(),
    getCommonTextItems: () => [],
    openCommonTextManager: vi.fn(),
}));

describe("selection copy overlay helpers", () => {
    it("keeps the copy button inside the container bounds", () => {
        expect(clampSelectionCopyOverlayPosition(100, 60, 90, 50)).toEqual({ x: 68, y: 28 });
    });

    it("applies a minimum inset from the top-left corner", () => {
        expect(clampSelectionCopyOverlayPosition(100, 60, 0, 1)).toEqual({ x: 8, y: 8 });
    });

    it("places copy variants directly after the default copy action", () => {
        const menu = makeSelectionQuickActionMenu("selected", {
            copyMenuItems: [{ label: "Copy Logical Line" }, { label: "Copy Selection as One Line" }],
        });

        expect(menu.slice(0, 4).map((item) => item.label)).toEqual([
            "Copy",
            "Copy Logical Line",
            "Copy Selection as One Line",
            "Search In Files",
        ]);
    });
});
