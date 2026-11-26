// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 看板重渲回流治理（Wave 2-2 / N-1126-perf-w2-2-overview-poll-storm）。
//
// 实测根因：`columns = groupOverviewCards(...)` 没有 memo，每次渲染都换数组引用，
// 于是 `columnKeys`（依赖 columns）也每次换引用 →
//   1. `useLayoutEffect` 依赖 `[layoutSignature, columnKeys]` 每渲染都重跑，
//      对全板每张卡做一次 `getBoundingClientRect()`（layout 强制同步回流）；
//   2. `rebaseline`（依赖 columnKeys）每渲染换引用 → `ResizeObserver` 销毁重建。
//
// 触发点极其日常：点一次卡片（markBlockViewed 写 atom）、30s `now` tick、
// 任何一个无关 state 更新，全板上百张卡就做一遍同步回流 + observer 重建。
//
// 本文件锁定：**同一批卡片/状态引用下，仅 `now` 变化的无关重渲不得再采样任何 rect，
// 也不得重建 ResizeObserver**。

// @vitest-environment jsdom

import { initI18n } from "@/i18n/config";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { OverviewBoard } from "./overview-board";
import type { OverviewBoardCard } from "./overview-board-model";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NowMs = 1_700_000_000_000;

class CountingResizeObserver {
    static constructions = 0;
    constructor(_callback: ResizeObserverCallback) {
        CountingResizeObserver.constructions += 1;
    }
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
}

function makeCard(overrides: Partial<OverviewBoardCard> = {}): OverviewBoardCard {
    return {
        blockId: "block-a",
        tabId: "tab-a",
        sessionId: "session-a",
        tabName: "Tab A",
        isAgentLike: true,
        title: "pi agent",
        avatar: { kind: "emoji", emoji: "🤖" },
        providerLabel: "pi",
        provider: "pi",
        projectName: "",
        tags: [],
        propRows: { visible: [], hiddenCount: 0 },
        kindLabel: "",
        preview: "",
        note: "",
        updatedAt: NowMs - 60_000,
        recentMessages: [],
        messagesOverflow: 0,
        ...overrides,
    };
}

const ZeroRect = {
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    width: 120,
    height: 80,
    right: 120,
    bottom: 80,
    toJSON: () => ({}),
} as unknown as DOMRect;

type Mounted = { container: HTMLDivElement; root: Root };
const mounted: Mounted[] = [];

afterEach(() => {
    for (const { container, root } of mounted.splice(0)) {
        act(() => root.unmount());
        container.remove();
    }
    CountingResizeObserver.constructions = 0;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

beforeAll(async () => {
    await initI18n("en");
    if (typeof (Element.prototype as { getAnimations?: unknown }).getAnimations !== "function") {
        (Element.prototype as unknown as { getAnimations: () => [] }).getAnimations = () => [];
    }
});

describe("OverviewBoard 无关重渲：不采样、不重建 observer（Wave 2-2）", () => {
    it("仅 now 变化的重渲：getBoundingClientRect 调用增量为 0，ResizeObserver 只建 1 次", () => {
        const rectSpy = vi
            .spyOn(Element.prototype, "getBoundingClientRect")
            .mockImplementation(() => ZeroRect);
        vi.stubGlobal("ResizeObserver", CountingResizeObserver);

        const cards: OverviewBoardCard[] = [
            makeCard({ blockId: "block-a" }),
            makeCard({ blockId: "block-b" }),
            makeCard({ blockId: "block-c" }),
        ];
        // 卡片与状态引用在两次渲染之间保持不变 —— 与生产一致（面板 useMemo 派生，点击不改引用）。
        const presentedStatuses = { "block-a": "working", "block-b": "done", "block-c": "idle" } as const;
        const onOpenCard = vi.fn();

        const container = document.createElement("div");
        document.body.appendChild(container);
        const root = createRoot(container);
        mounted.push({ container, root });

        act(() => {
            root.render(
                <OverviewBoard
                    cards={cards}
                    presentedStatuses={presentedStatuses}
                    agentStatuses={{}}
                    now={NowMs}
                    onOpenCard={onOpenCard}
                />
            );
        });

        const rectAfterMount = rectSpy.mock.calls.length;
        const observersAfterMount = CountingResizeObserver.constructions;
        expect(rectAfterMount).toBeGreaterThan(0);
        expect(observersAfterMount).toBe(1);

        // 模拟「点了一次卡片 / 30s now tick」：只有 now 变化，卡片与状态引用不变。
        act(() => {
            root.render(
                <OverviewBoard
                    cards={cards}
                    presentedStatuses={presentedStatuses}
                    agentStatuses={{}}
                    now={NowMs + 1_000}
                    onOpenCard={onOpenCard}
                />
            );
        });

        expect(rectSpy.mock.calls.length - rectAfterMount).toBe(0);
        expect(CountingResizeObserver.constructions).toBe(observersAfterMount);
    });
});
