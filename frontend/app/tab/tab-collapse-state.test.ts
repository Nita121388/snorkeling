// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 「收起到更多」跨 renderer 同步契约测试 (F-1119: collapsed 集合主进程化).
//
// 背景: 每个 Tab 是独立 renderer, Tab 栏各渲染一份。tab-collapse-state 现在是主进程
// 真源的 renderer 投影 —— 本地乐观写 + IPC 写穿 + 广播回写。
//
// 锁定四件事:
// 1. 写函数走本地乐观更新: collapse/expand/clear 有实际变更才发对应 IPC, 无变更不打扰主进程。
// 2. collapseTabIds 过滤空 id / 全空数组为 no-op。
// 3. initCollapsedTabIdsSync: 初值同步读 api.getCollapsedTabIds, 并订阅广播回写 atom。
// 4. 广播回写更新 collapsedTabIdsAtom (供 TabBar / VTabBar / 更多下拉一致消费)。
//
// Run: npx vitest run frontend/app/tab/tab-collapse-state.test.ts

// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

type CollapseApi = {
    getCollapsedTabIds: ReturnType<typeof vi.fn>;
    collapseTabIds: ReturnType<typeof vi.fn>;
    expandCollapsedTabId: ReturnType<typeof vi.fn>;
    clearCollapsedTabIds: ReturnType<typeof vi.fn>;
    onCollapsedTabIdsChange: ReturnType<typeof vi.fn>;
};

let broadcastCallback: ((tabIds: string[]) => void) | null = null;

function installMockApi(initialCollapsed: string[]): CollapseApi {
    const api: CollapseApi = {
        getCollapsedTabIds: vi.fn(() => initialCollapsed),
        collapseTabIds: vi.fn(),
        expandCollapsedTabId: vi.fn(),
        clearCollapsedTabIds: vi.fn(),
        onCollapsedTabIdsChange: vi.fn((cb: (tabIds: string[]) => void) => {
            broadcastCallback = cb;
        }),
    };
    (window as any).api = api;
    return api;
}

type CollapseModule = Awaited<typeof import("./tab-collapse-state")>;
type GlobalStore = typeof import("@/app/store/jotaiStore")["globalStore"];

let globalStore: GlobalStore;

async function importModule(): Promise<CollapseModule> {
    // 每个用例重置模块注册表, 保证 atom 初值读取在 mock api 安装之后发生;
    // store 也随之重新解析, 与被测模块拿到同一实例。
    vi.resetModules();
    ({ globalStore } = await import("@/app/store/jotaiStore"));
    return await import("./tab-collapse-state");
}

beforeEach(() => {
    broadcastCallback = null;
    delete (window as any).api;
});

describe("tab-collapse-state (跨 renderer 投影)", () => {
    it("collapseTabIds: 本地乐观更新 + 有变更才发 IPC; 重复收起与全空数组不打扰主进程", async () => {
        const api = installMockApi([]);
        const mod = await importModule();
        globalStore.set(mod.collapsedTabIdsAtom, new Set());

        mod.collapseTabIds(["t1", "t1", "", "t2"]);
        expect(globalStore.get(mod.collapsedTabIdsAtom)).toEqual(new Set(["t1", "t2"]));
        expect(api.collapseTabIds).toHaveBeenCalledTimes(1);
        expect(api.collapseTabIds).toHaveBeenCalledWith(["t1", "t2"]);

        // 幂等: 集合已含 t1/t2, 再收不产生 IPC
        mod.collapseTabIds(["t1", "t2"]);
        expect(api.collapseTabIds).toHaveBeenCalledTimes(1);

        // 全空数组 no-op
        mod.collapseTabIds([]);
        mod.collapseTabIds(["", ""]);
        expect(api.collapseTabIds).toHaveBeenCalledTimes(1);
        expect(globalStore.get(mod.collapsedTabIdsAtom)).toEqual(new Set(["t1", "t2"]));
    });

    it("expandCollapsedTabId: 在集合内才展开并发 IPC; 不在集合内不打扰主进程", async () => {
        const api = installMockApi([]);
        const mod = await importModule();
        globalStore.set(mod.collapsedTabIdsAtom, new Set(["t1", "t2"]));

        mod.expandCollapsedTabId("t1");
        expect(globalStore.get(mod.collapsedTabIdsAtom)).toEqual(new Set(["t2"]));
        expect(api.expandCollapsedTabId).toHaveBeenCalledTimes(1);
        expect(api.expandCollapsedTabId).toHaveBeenCalledWith("t1");

        // 已展开的 id: no-op
        mod.expandCollapsedTabId("t1");
        mod.expandCollapsedTabId("t9");
        mod.expandCollapsedTabId("");
        expect(api.expandCollapsedTabId).toHaveBeenCalledTimes(1);
    });

    it("clearCollapsedTabIds: 仅非空集合时清理并发 IPC", async () => {
        const api = installMockApi([]);
        const mod = await importModule();

        globalStore.set(mod.collapsedTabIdsAtom, new Set());
        mod.clearCollapsedTabIds();
        expect(api.clearCollapsedTabIds).not.toHaveBeenCalled();

        globalStore.set(mod.collapsedTabIdsAtom, new Set(["t1"]));
        mod.clearCollapsedTabIds();
        expect(globalStore.get(mod.collapsedTabIdsAtom)).toEqual(new Set());
        expect(api.clearCollapsedTabIds).toHaveBeenCalledTimes(1);
    });

    it("initCollapsedTabIdsSync: 初值同步读主进程, 广播回写 atom", async () => {
        const api = installMockApi(["t1", "t3"]);
        const mod = await importModule();

        mod.initCollapsedTabIdsSync();
        expect(api.getCollapsedTabIds).toHaveBeenCalled();
        expect(globalStore.get(mod.collapsedTabIdsAtom)).toEqual(new Set(["t1", "t3"]));
        expect(api.onCollapsedTabIdsChange).toHaveBeenCalledTimes(1);

        // 重复 init 幂等: 不重复订阅
        mod.initCollapsedTabIdsSync();
        expect(api.onCollapsedTabIdsChange).toHaveBeenCalledTimes(1);

        // 主进程广播 (例如其他 renderer 发起的收起) → 本视图 atom 同步
        expect(broadcastCallback).toBeTruthy();
        broadcastCallback!(["t1", "t2"]);
        expect(globalStore.get(mod.collapsedTabIdsAtom)).toEqual(new Set(["t1", "t2"]));
    });
});
