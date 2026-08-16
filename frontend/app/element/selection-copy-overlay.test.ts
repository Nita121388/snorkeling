// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import {
    buildCopyContextText,
    clampSelectionCopyOverlayPosition,
    makeSelectionQuickActionMenu,
} from "@/app/element/selection-copy-overlay";
import { addSelectionToCommonText, findDuplicateCommonText } from "@/app/commontext/commontext-model";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/commontext/commontext-model", () => ({
    addSelectionToCommonText: vi.fn(),
    getCommonTextItems: () => [],
    findDuplicateCommonText: vi.fn(() => null),
}));

function findMenuItem(menu: Awaited<ReturnType<typeof makeSelectionQuickActionMenu>>, label: string) {
    const item = menu.find((i) => i.label === label);
    if (item == null || item.click == null) {
        throw new Error(`menu item not found: ${label}`);
    }
    return item.click;
}

describe("selection copy overlay helpers", () => {
    // 模块级 mock 的调用历史会在用例间累积，每个用例前清一次，避免前序调用污染断言。
    beforeEach(() => {
        vi.clearAllMocks();
    });

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

    it("formats markdown preview context with the source line", () => {
        expect(buildCopyContextText("/notes/readme.md", 12, "selected text")).toBe(
            "/notes/readme.md:12\n```markdown\nselected text\n```"
        );
    });

    it("add-to-common-text feedback passes the saved item id for tagging and keeps the overlay alive", async () => {
        const savedItem = { id: "item-1", title: "A title", text: "selected text", tags: [] as string[] };
        (addSelectionToCommonText as ReturnType<typeof vi.fn>).mockResolvedValue(savedItem);
        const onHide = vi.fn();
        const onCommonTextFeedback = vi.fn();
        const menu = makeSelectionQuickActionMenu("selected text", { onHide, onCommonTextFeedback });
        const click = findMenuItem(menu, "Add Selection to Common Text");

        await click();

        expect(onCommonTextFeedback).toHaveBeenCalledWith("Saved", "success", true, "item-1");
        // 保存成功后不再立即卸载 overlay —— 气泡要靠 overlay 存活来展示 (Tag) 按钮。
        expect(onHide).not.toHaveBeenCalled();
    });

    it("duplicate text keeps the existing item id and skips re-saving", async () => {
        const dupItem = { id: "item-dup", title: "Existing", text: "selected text", tags: [] as string[] };
        (findDuplicateCommonText as ReturnType<typeof vi.fn>).mockReturnValue(dupItem);
        const onCommonTextFeedback = vi.fn();
        const menu = makeSelectionQuickActionMenu("selected text", { onCommonTextFeedback });
        const click = findMenuItem(menu, "Add Selection to Common Text");

        await click();

        expect(onCommonTextFeedback).toHaveBeenCalledWith("Already exists", "warn", true, "item-dup");
        expect(addSelectionToCommonText).not.toHaveBeenCalled();
    });
});
