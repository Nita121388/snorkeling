// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// block 菜单里「Move to Tab」的守卫测试。
//
// 为什么要守：这个入口历史上被拆成 4 条（Move/Copy × New/Existing），其中「新建」两条立刻执行、
// tab 名字不可见。收敛成 1 条后必须锁住，防止以后又把「新建」拆回菜单。
// 同时锁住「不依赖 block 类型 / view」——入口漏接是「只支持 agent 块」的真实成因。
//
// Run: npx vitest run frontend/app/block/blockframe-header.menu.test.ts

import { describe, expect, it, vi } from "vitest";

// blockframe-header.tsx 顶层 import 会拉起整个 block 运行时（React 组件 + jotai + WOS），
// 这里只测纯函数，故用 vi.mock 把它需要的重量级模块置空。
vi.mock("@/app/block/blockutil", () => ({
    getViewIconElem: () => null,
}));
vi.mock("@/app/block/connectionbutton", () => ({ ConnectionButton: () => null }));
vi.mock("@/app/block/durable-session-flyover", () => ({ DurableSessionFlyover: () => null }));
vi.mock("@/app/store/badge", () => ({ getBlockBadgeAtom: () => null }));
vi.mock("@/app/store/global", () => ({
    createBlockSplitHorizontally: () => {},
    createBlockSplitVertically: () => {},
    globalStore: { get: () => undefined },
    refocusNode: () => {},
}));
// globalStore 需要 get + set 两个方法：只给 get 会让后台 tick（agent-status-second-tick）
// 在定时器里抛 "globalStore.set is not a function" → vitest 记为 unhandled error（实测踩到）。
vi.mock("@/app/store/jotaiStore", () => ({ globalStore: { get: () => undefined, set: () => {} } }));
vi.mock("@/app/store/keymodel", () => ({ uxCloseBlock: async () => {} }));
vi.mock("@/app/store/tab-model", () => ({ useTabModel: () => ({ tabId: "t1" }) }));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));
vi.mock("@/app/store/wos", () => ({ makeORef: (otype: string, oid: string) => `${otype}:${oid}`, getWaveObjectAtom: () => null }));
vi.mock("@/app/waveenv/waveenv", () => ({
    useWaveEnv: () => ({}) as never,
}));
vi.mock("@/app/element/iconbutton", () => ({ IconButton: () => null }));
vi.mock("@/app/layout/index", () => ({ getLayoutModelForTabById: () => null }));
vi.mock("@/app/layout/lib/inlineTabs", () => ({ getLayoutDataBlockIds: () => [] }));
vi.mock("@/app/tab/tab-target-modal", () => ({ TabTargetModal: () => null }));
vi.mock("@/app/view/term/agent-folder", () => ({ canOpenAgentFolder: () => false, openAgentFolderInCurrentTab: () => {} }));
vi.mock("@/app/view/term/agent-session", () => ({ resolveAgentSessionIdFromMeta: () => "" }));
vi.mock("@/app/workspace/toggle-block", () => ({
    SnorkelingBlockKindMetaKey: "snorkeling:blockkind",
    SnorkelingBlockKindNote: "note",
}));
vi.mock("@/app/block/block-minimize", () => ({
    minimizeBlockToFloat: () => {},
    restoreMinimizedBlockToLayout: () => null,
}));

import { makeBlockMoveMenuItems, type MoveBlockMenuContext } from "./blockframe-header";

const blockEnv = { services: { object: {} } } as never;

function makeContext(): MoveBlockMenuContext {
    return {
        currentTabId: "t1",
        sourceTabName: "Snorkeling",
        workspace: { tabids: ["t1", "t2"] } as Workspace,
        onOpenMoveModal: () => {},
        onMoved: () => {},
        onCopied: () => {},
    };
}

/** 只取可读 label 的菜单项（separator 没有 label）。 */
const labels = (items: ReturnType<typeof makeBlockMoveMenuItems>) =>
    items.map((item) => (item as { label?: string }).label).filter((l): l is string => typeof l === "string");

describe("makeBlockMoveMenuItems — 入口收敛守卫", () => {
    it("emits exactly one item, labelled Move to Tab…", () => {
        const items = makeBlockMoveMenuItems("block-1", blockEnv, makeContext());
        expect(items).toHaveLength(1);
        const ls = labels(items);
        expect(ls).toHaveLength(1);
        expect(ls[0]).toMatch(/^Move to Tab/);
    });

    it("no longer emits the four split entries (New/Existing × Move/Copy)", () => {
        const ls = labels(makeBlockMoveMenuItems("block-1", blockEnv, makeContext()));
        expect(ls).not.toContain("Move to New Tab");
        expect(ls).not.toContain("Move to Existing Tab...");
        expect(ls).not.toContain("Copy to New Tab");
        expect(ls).not.toContain("Copy to Existing Tab...");
    });

    it("does not depend on the target block type or view (regression lock for agent-only)", () => {
        // 同一个纯函数对任意 blockId 都返回同一条入口；入口是否可见只由 moveContext 是否存在决定，
        // 与 block 的 meta.view / agent 元数据无关。
        for (const blockId of ["term-block", "agent-block", "preview-block", "note-block"]) {
            const ls = labels(makeBlockMoveMenuItems(blockId, blockEnv, makeContext()));
            expect(ls).toEqual(["Move to Tab…"]);
        }
    });

    it("returns an empty array when there is no move context (preview / ephemeral)", () => {
        expect(makeBlockMoveMenuItems("block-1", blockEnv, null)).toEqual([]);
        expect(makeBlockMoveMenuItems("block-1", blockEnv, undefined)).toEqual([]);
    });
});
