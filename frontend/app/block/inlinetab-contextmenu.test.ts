// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { initI18n } from "@/i18n/config";
import { beforeAll, describe, expect, it } from "vitest";
import { buildInlineTabContextMenu } from "./inlinetab-contextmenu";

const noop = () => {};

// env 参数当前仅占位, 菜单构建不依赖它; 测试直接传 undefined。
const call = (blockId: string, blockIds: string[], locked: Set<string>) =>
    buildInlineTabContextMenu(blockId, blockIds, locked, noop, noop, noop, noop, noop, noop, noop, undefined as never);

const labels = (menu: ReturnType<typeof buildInlineTabContextMenu>) => menu.map((item) => item.label);

describe("inline tab context menu lock", () => {
    beforeAll(async () => {
        // 菜单文案走 i18n（en 为真源），先初始化再断言（Pattern I）。
        await initI18n("en");
    });

    it("shows lock toggle and lock-excluding variants when another tab is locked", () => {
        const menu = call("tab-b", ["tab-a", "tab-b", "tab-c"], new Set(["tab-c"]));
        const ls = labels(menu);
        expect(ls).toContain("Lock Tab");
        expect(ls).toContain("Close");
        expect(ls).toContain("Close Others");
        expect(ls).toContain("Close Others (Except Locked)");
        expect(ls).toContain("Close All");
        expect(ls).toContain("Close All (Except Locked)");
    });

    it("hides lock-excluding variants when nothing is locked (identical to plain close)", () => {
        const menu = call("tab-a", ["tab-a", "tab-b"], new Set());
        const ls = labels(menu);
        expect(ls).toContain("Close Others");
        expect(ls).not.toContain("Close Others (Except Locked)");
        expect(ls).toContain("Close All");
        expect(ls).not.toContain("Close All (Except Locked)");
    });

    it("checks the lock toggle on the locked tab itself", () => {
        const menu = call("tab-c", ["tab-a", "tab-b", "tab-c"], new Set(["tab-c"]));
        const lockItem = menu.find((item) => item.label === "Lock Tab");
        expect(lockItem?.type).toBe("checkbox");
        expect(lockItem?.checked).toBe(true);
    });

    it("keeps close-all-excluding-locked for a lone locked tab but hides close-others", () => {
        const menu = call("tab-a", ["tab-a"], new Set(["tab-a"]));
        const ls = labels(menu);
        expect(ls).not.toContain("Close Others");
        expect(ls).not.toContain("Close Others (Except Locked)");
        expect(ls).toContain("Close All");
        expect(ls).toContain("Close All (Except Locked)");
    });
});
