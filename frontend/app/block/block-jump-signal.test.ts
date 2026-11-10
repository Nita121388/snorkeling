// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 跨 renderer「定位到块」信号的单元测试（2026-11-10，任务 11-09-overview-card-jump 修复）。
//
// 锁定行为：
//   1. broadcast 写入 localStorage（tabId / blockId / seq）；
//   2. 本 tab 的信号 → 高亮 + 数拍 refocus + TTL 后撤高亮；
//   3. 非本 tab 的信号 → 完全忽略（避免 A tab 的跳转在无关 renderer 里闪高亮）；
//   4. 过期信号 → 忽略；
//   5. install 时补读最近信号（目标 view 在跳转后才创建的场景）。

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => {
    const staticTabIdAtom = { __atom: "staticTabId" };
    return {
        staticTabIdAtom,
        staticTabId: "tab-owner",
        highlights: [] as Array<{ blockId: string; icon: string } | null>,
        refocused: [] as string[],
    };
});

vi.mock("@/app/store/global", () => ({
    atoms: { staticTabId: mockState.staticTabIdAtom },
    globalStore: {
        get: (atom: unknown) => (atom === mockState.staticTabIdAtom ? mockState.staticTabId : undefined),
    },
    refocusNode: (blockId: string) => mockState.refocused.push(blockId),
}));

vi.mock("@/app/block/block-model", () => ({
    BlockModel: {
        getInstance: () => ({
            setBlockHighlight: (highlight: { blockId: string; icon: string } | null) =>
                mockState.highlights.push(highlight),
        }),
    },
}));

import {
    BlockJumpStorageKey,
    broadcastBlockJumpSignal,
    installBlockJumpSignalListener,
    resetBlockJumpSignalListenerForTest,
} from "./block-jump-signal";

function fireStorageEvent(signal: { tabId: string; blockId: string; seq: number }): void {
    window.dispatchEvent(
        new StorageEvent("storage", { key: BlockJumpStorageKey, newValue: JSON.stringify(signal) })
    );
}

describe("block-jump-signal", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        mockState.staticTabId = "tab-owner";
        mockState.highlights = [];
        mockState.refocused = [];
        window.localStorage.removeItem(BlockJumpStorageKey);
        resetBlockJumpSignalListenerForTest();
    });

    afterEach(() => {
        vi.useRealTimers();
        window.localStorage.removeItem(BlockJumpStorageKey);
        resetBlockJumpSignalListenerForTest();
    });

    it("broadcast 写入带 tabId/blockId/seq 的信号", () => {
        const before = Date.now();
        broadcastBlockJumpSignal("tab-target", "block-1");
        const raw = window.localStorage.getItem(BlockJumpStorageKey);
        expect(raw).not.toBeNull();
        const parsed = JSON.parse(raw as string);
        expect(parsed.tabId).toBe("tab-target");
        expect(parsed.blockId).toBe("block-1");
        expect(typeof parsed.seq).toBe("number");
        expect(parsed.seq).toBeGreaterThanOrEqual(before);
    });

    it("空 tabId / blockId 不写信号", () => {
        broadcastBlockJumpSignal("", "block-1");
        broadcastBlockJumpSignal("tab-target", "");
        expect(window.localStorage.getItem(BlockJumpStorageKey)).toBeNull();
    });

    it("本 tab 的信号 → 高亮 + refocus + TTL 后撤高亮", () => {
        installBlockJumpSignalListener();
        fireStorageEvent({ tabId: "tab-owner", blockId: "block-owner", seq: Date.now() });

        // 立即：高亮已设置（refocus 的 0ms 拍在微任务/定时器里）
        expect(mockState.highlights[0]).toEqual({ blockId: "block-owner", icon: "location-crosshairs" });
        vi.runAllTimers();
        expect(mockState.refocused.length).toBeGreaterThan(0);
        expect(mockState.refocused.every((id) => id === "block-owner")).toBe(true);
        // 最后一拍是撤高亮
        expect(mockState.highlights[mockState.highlights.length - 1]).toBeNull();
    });

    it("非本 tab 的信号 → 完全忽略", () => {
        installBlockJumpSignalListener();
        fireStorageEvent({ tabId: "tab-other", blockId: "block-other", seq: Date.now() });
        vi.runAllTimers();
        expect(mockState.highlights).toHaveLength(0);
        expect(mockState.refocused).toHaveLength(0);
    });

    it("过期信号（超过新鲜度窗口）→ 忽略", () => {
        installBlockJumpSignalListener();
        fireStorageEvent({ tabId: "tab-owner", blockId: "block-owner", seq: Date.now() - 60_000 });
        vi.runAllTimers();
        expect(mockState.highlights).toHaveLength(0);
    });

    it("install 时补读最近信号（目标 renderer 晚于跳转才创建）", () => {
        broadcastBlockJumpSignal("tab-owner", "block-late");
        installBlockJumpSignalListener();
        expect(mockState.highlights[0]).toEqual({ blockId: "block-late", icon: "location-crosshairs" });
    });

    it("只安装一次（重复 install 不会重复响应）", () => {
        installBlockJumpSignalListener();
        installBlockJumpSignalListener();
        fireStorageEvent({ tabId: "tab-owner", blockId: "block-owner", seq: Date.now() });
        // 一次信号只产生一轮高亮设置
        expect(mockState.highlights.filter((h) => h != null)).toHaveLength(1);
    });
});
