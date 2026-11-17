// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Tab 右键菜单「收起到更多」契约测试.
//
// 锁定三件事:
// 1. 菜单项存在, 且点击后把该 tabId 交给 collapseTabIds (与「更多」下拉共用同一状态).
// 2. 激活 Tab / 有未阅点的 Tab 必须置灰 (enabled=false) —— 收起会被
//    isTabHiddenFromBar 的优先级覆盖, 允许点击等于"点了没反应".
// 3. 非激活且无未阅时保持可点.
//
// Run: npx vitest run frontend/app/tab/tabcontextmenu.test.ts

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { mockCollapseTabIds, mockRecordTEvent } = vi.hoisted(() => ({
    mockCollapseTabIds: vi.fn(),
    mockRecordTEvent: vi.fn(),
}));

vi.mock("@/app/store/global", () => ({
    getOrefMetaKeyAtom: () => ({}) as never,
    globalStore: { get: () => undefined },
    recordTEvent: mockRecordTEvent,
}));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));
vi.mock("@/app/store/wos", () => ({
    makeORef: (otype: string, oid: string) => `${otype}:${oid}`,
}));
vi.mock("./tab-collapse-state", () => ({ collapseTabIds: mockCollapseTabIds }));

import { i18n, initI18n } from "@/i18n/config";
import { buildTabContextMenu } from "./tabcontextmenu";

const env = {
    rpc: {
        SetMetaCommand: async () => {},
        SetConfigCommand: async () => {},
        ActivityCommand: () => {},
    },
    atoms: { fullConfigAtom: {} },
    getSettingsKeyAtom: () => ({}),
    electron: { moveTabToNewWindow: async () => {}, moveTabBack: async () => {} },
} as never;

const renameRef = { current: null } as never;
const onClose = () => {};

function findCollapseItem(visibility?: { active?: boolean; hasUnreadDot?: boolean }) {
    const menu = buildTabContextMenu("t1", renameRef, onClose, env, visibility);
    return menu.find((item) => item.label === i18n.t("tab:contextMenu.collapseToMore"));
}

describe("buildTabContextMenu — 收起到更多", () => {
    beforeAll(async () => {
        await initI18n("en");
    });

    beforeEach(() => {
        mockCollapseTabIds.mockClear();
        mockRecordTEvent.mockClear();
    });

    it("普通 Tab: 菜单项存在且可点", () => {
        const item = findCollapseItem({ active: false, hasUnreadDot: false });
        expect(item).toBeDefined();
        expect(item?.enabled).toBe(true);
        expect(item?.sublabel).toBeUndefined();
    });

    it("点击后把单个 tabId 交给 collapseTabIds 并埋点", () => {
        const item = findCollapseItem({ active: false, hasUnreadDot: false });
        item?.click?.();
        expect(mockCollapseTabIds).toHaveBeenCalledTimes(1);
        expect(mockCollapseTabIds).toHaveBeenCalledWith(["t1"]);
        expect(mockRecordTEvent).toHaveBeenCalledWith("action:collapsetab");
    });

    it("激活 Tab: 置灰, 带禁用说明", () => {
        const item = findCollapseItem({ active: true, hasUnreadDot: false });
        expect(item?.enabled).toBe(false);
        expect(item?.sublabel).toBe(i18n.t("tab:contextMenu.collapseToMoreActiveDisabled"));
    });

    it("有未阅状态点: 置灰, 带禁用说明", () => {
        const item = findCollapseItem({ active: false, hasUnreadDot: true });
        expect(item?.enabled).toBe(false);
        expect(item?.sublabel).toBe(i18n.t("tab:contextMenu.collapseToMoreUnreadDisabled"));
    });

    it("未传 visibility 时保持可点 (向后兼容旧调用点)", () => {
        const item = findCollapseItem();
        expect(item?.enabled).toBe(true);
    });
});
