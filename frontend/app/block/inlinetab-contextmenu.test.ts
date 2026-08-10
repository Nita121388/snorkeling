// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { buildInlineTabContextMenu } from "./inlinetab-contextmenu";

const noop = () => {};

// env 参数当前仅占位, 菜单构建不依赖它; 测试直接传 undefined。
const call = (blockId: string, blockIds: string[], locked: Set<string>) =>
    buildInlineTabContextMenu(
        blockId,
        blockIds,
        locked,
        noop,
        noop,
        noop,
        noop,
        noop,
        noop,
        undefined as never
    );

const labels = (menu: ReturnType<typeof buildInlineTabContextMenu>) => menu.map((item) => item.label);

describe("inline tab context menu lock", () => {
    it("shows lock toggle and lock-excluding variants when another tab is locked", () => {
        const menu = call("tab-b", ["tab-a", "tab-b", "tab-c"], new Set(["tab-c"]));
        const ls = labels(menu);
        expect(ls).toContain("锁定标签");
        expect(ls).toContain("关闭");
        expect(ls).toContain("关闭其他");
        expect(ls).toContain("关闭其他（锁定除外）");
        expect(ls).toContain("关闭全部");
        expect(ls).toContain("关闭全部（锁定除外）");
    });

    it("hides lock-excluding variants when nothing is locked (identical to plain close)", () => {
        const menu = call("tab-a", ["tab-a", "tab-b"], new Set());
        const ls = labels(menu);
        expect(ls).toContain("关闭其他");
        expect(ls).not.toContain("关闭其他（锁定除外）");
        expect(ls).toContain("关闭全部");
        expect(ls).not.toContain("关闭全部（锁定除外）");
    });

    it("checks the lock toggle on the locked tab itself", () => {
        const menu = call("tab-c", ["tab-a", "tab-b", "tab-c"], new Set(["tab-c"]));
        const lockItem = menu.find((item) => item.label === "锁定标签");
        expect(lockItem?.type).toBe("checkbox");
        expect(lockItem?.checked).toBe(true);
    });

    it("keeps close-all-excluding-locked for a lone locked tab but hides close-others", () => {
        const menu = call("tab-a", ["tab-a"], new Set(["tab-a"]));
        const ls = labels(menu);
        expect(ls).not.toContain("关闭其他");
        expect(ls).not.toContain("关闭其他（锁定除外）");
        expect(ls).toContain("关闭全部");
        expect(ls).toContain("关闭全部（锁定除外）");
    });
});
