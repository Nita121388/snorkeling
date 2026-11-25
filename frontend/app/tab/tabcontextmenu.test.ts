// Copyright 2026, Command Line Inc.

// Tab 右键菜单「收起到更多」契约测试 (F-1118: 收起激活 Tab = 收起并切走).
//
// 锁定四件事:
// 1. 菜单项存在, 且点击后把该 tabId 交给 collapseTabIds (与「更多」下拉共用同一状态).
// 2. 激活 Tab 不再置灰: 点击时先 setActiveTab(相邻目标) 再 collapseTabIds —— 顺序必须
//    先切后收, 否则 isTabHiddenFromBar 会因「激活 > 收起」把 Tab 放回主栏 (视觉没收起).
// 3. 有未阅点的 Tab 必须置灰 (未读优先于收起, 收了用户就发现不了新结果);
//    激活但无可切目标 (仅剩一个 Tab) 也置灰, 禁用说明为「至少保留一个 Tab」.
// 4. 非激活且无未阅时保持可点且不触发切换; 未传 visibility 的旧调用点保持可点.
//
// Run: npx vitest run frontend/app/tab/tabcontextmenu.test.ts

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { mockCollapseTabIds, mockRecordTEvent, mockSetActiveTab, mockSetConfig, mockConfigValues } = vi.hoisted(() => ({
    mockCollapseTabIds: vi.fn(),
    mockRecordTEvent: vi.fn(),
    mockSetActiveTab: vi.fn(),
    mockSetConfig: vi.fn(async () => {}),
    mockConfigValues: {} as Record<string, unknown>,
}));

vi.mock("@/app/store/global", () => ({
    getOrefMetaKeyAtom: () => ({}) as never,
    globalStore: { get: (atom: any) => atom?.configKey ? mockConfigValues[atom.configKey] : undefined },
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
        SetConfigCommand: mockSetConfig,
        ActivityCommand: () => {},
    },
    atoms: { fullConfigAtom: {} },
    getSettingsKeyAtom: (key: string) => ({ configKey: key }),
    electron: {
        moveTabToNewWindow: async () => {},
        moveTabBack: async () => {},
        setActiveTab: mockSetActiveTab,
    },
} as never;

const renameRef = { current: null } as never;
const onClose = () => {};

function findCollapseItem(visibility?: { active?: boolean; hasUnreadDot?: boolean; switchTargetTabId?: string | null }) {
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
        mockSetActiveTab.mockClear();
        mockSetConfig.mockClear();
        mockConfigValues["tab:agent-status-mode"] = undefined;
    });

    it("普通 Tab: 菜单项存在且可点", () => {
        const item = findCollapseItem({ active: false, hasUnreadDot: false });
        expect(item).toBeDefined();
        expect(item?.enabled).toBe(true);
        expect(item?.sublabel).toBeUndefined();
    });

    it("点击后把单个 tabId 交给 collapseTabIds 并埋点, 不触发切换", () => {
        const item = findCollapseItem({ active: false, hasUnreadDot: false });
        item?.click?.();
        expect(mockCollapseTabIds).toHaveBeenCalledTimes(1);
        expect(mockCollapseTabIds).toHaveBeenCalledWith(["t1"]);
        expect(mockRecordTEvent).toHaveBeenCalledWith("action:collapsetab");
        expect(mockSetActiveTab).not.toHaveBeenCalled();
    });

    it("激活 Tab + 有切换目标: 可点, 先切走再收起 (顺序锁定)", () => {
        const item = findCollapseItem({ active: true, hasUnreadDot: false, switchTargetTabId: "t2" });
        expect(item?.enabled).toBe(true);
        expect(item?.sublabel).toBeUndefined();
        item?.click?.();
        expect(mockSetActiveTab).toHaveBeenCalledTimes(1);
        expect(mockSetActiveTab).toHaveBeenCalledWith("t2");
        expect(mockCollapseTabIds).toHaveBeenCalledTimes(1);
        expect(mockCollapseTabIds).toHaveBeenCalledWith(["t1"]);
        // 顺序不变量: 先切走激活态, 再收起 —— 反了会出现「激活 Tab 不在栏上」/被放回的中间帧.
        expect(mockSetActiveTab.mock.invocationCallOrder[0]).toBeLessThan(
            mockCollapseTabIds.mock.invocationCallOrder[0]
        );
    });

    it("激活 Tab + 无可切目标 (仅剩一个 Tab): 置灰, 带禁用说明", () => {
        const item = findCollapseItem({ active: true, hasUnreadDot: false, switchTargetTabId: null });
        expect(item?.enabled).toBe(false);
        expect(item?.sublabel).toBe(i18n.t("tab:contextMenu.collapseToMoreLastTabDisabled"));
    });

    it("有未阅状态点: 置灰优先 (未阅 > 激活可收), 带禁用说明", () => {
        const item = findCollapseItem({ active: true, hasUnreadDot: true, switchTargetTabId: "t2" });
        expect(item?.enabled).toBe(false);
        expect(item?.sublabel).toBe(i18n.t("tab:contextMenu.collapseToMoreUnreadDisabled"));
    });

    it("未传 visibility 时保持可点 (向后兼容旧调用点)", () => {
        const item = findCollapseItem();
        expect(item?.enabled).toBe(true);
    });
});

describe("buildTabContextMenu — Agent 状态编码", () => {
    beforeAll(async () => {
        await initI18n("en");
    });

    beforeEach(() => {
        mockSetConfig.mockClear();
        mockRecordTEvent.mockClear();
        mockConfigValues["tab:agent-status-mode"] = undefined;
    });

    function findModeItem() {
        return buildTabContextMenu("t1", renameRef, onClose, env).find(
            (item) => item.label === i18n.t("tab:contextMenu.agentStatusDisplay")
        );
    }

    it("提供 B / C / G 三个全局选项，默认勾选 G", () => {
        const item = findModeItem();
        expect(item?.type).toBe("submenu");
        expect(item?.sublabel).toBe(i18n.t("tab:contextMenu.agentStatusAllTabs"));
        expect(item?.submenu?.map((entry) => entry.label)).toEqual([
            i18n.t("tab:contextMenu.agentStatusAvatars"),
            i18n.t("tab:contextMenu.agentStatusRail"),
            i18n.t("tab:contextMenu.agentStatusHybrid"),
        ]);
        expect(item?.submenu?.map((entry) => entry.checked)).toEqual([false, false, true]);
    });

    it("已保存的模式决定勾选项", () => {
        mockConfigValues["tab:agent-status-mode"] = "rail";
        expect(findModeItem()?.submenu?.map((entry) => entry.checked)).toEqual([false, true, false]);
    });

    it("点击模式写入已注册的 settings key，不写 Tab meta", () => {
        const item = findModeItem()?.submenu?.find((entry) => entry.label === i18n.t("tab:contextMenu.agentStatusAvatars"));
        item?.click?.();
        expect(mockSetConfig).toHaveBeenCalledTimes(1);
        expect(mockSetConfig).toHaveBeenCalledWith({}, { "tab:agent-status-mode": "avatars" });
        expect(mockRecordTEvent).toHaveBeenCalledWith("action:settabagentstatusmode");
    });
});
