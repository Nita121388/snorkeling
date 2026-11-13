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
        // true = 模拟 initGlobalAtoms 已完成；false = 模拟模块求值早于 initGlobal（atoms === undefined）
        atomsAvailable: true,
        highlights: [] as Array<{ blockId: string; icon: string } | null>,
        refocused: [] as string[],
    };
});

vi.mock("@/app/store/global", () => ({
    get atoms() {
        return mockState.atomsAvailable ? { staticTabId: mockState.staticTabIdAtom } : undefined;
    },
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
        mockState.atomsAvailable = true;
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

    // 回归：2026-11-13 窗口黑屏死锁。真实故障是 blockframe 在模块求值期（早于 initGlobal）
    // 调用 install，此时 global-atoms 的 atoms 仍是 undefined；只要 localStorage 里残留一条
    // block-jump 信号，handleSignal 就会在模块顶层抛 TypeError，整个 renderer 不启动。
    it("atoms 未初始化时 install 不抛异常且信号被忽略（回归：黑屏死锁）", () => {
        mockState.atomsAvailable = false;
        window.localStorage.setItem(
            BlockJumpStorageKey,
            JSON.stringify({ tabId: "tab-owner", blockId: "block-early", seq: Date.now() })
        );
        expect(() => installBlockJumpSignalListener()).not.toThrow();
        expect(mockState.highlights).toHaveLength(0);

        // 同时也毒住 storage 事件路径，同样不能抛
        expect(() =>
            fireStorageEvent({ tabId: "tab-owner", blockId: "block-early", seq: Date.now() })
        ).not.toThrow();
        vi.runAllTimers();
        expect(mockState.highlights).toHaveLength(0);
        expect(mockState.refocused).toHaveLength(0);
    });
});
