// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 看板卡片「定位到块」动作的 DOM 回归（2026-11-09 任务 11-09-overview-card-jump）。
//
// 锁定的行为：
//   1. 传入 onJumpCard 且卡片有 tabId → 头部动作区渲染 [data-board-jump]；
//   2. 点击只触发 onJumpCard，不触发 onOpenCard（弹窗不弹、卡片点击语义不变）；
//   3. 未传 onJumpCard（缺省）或 tabId 为空 → 按钮不渲染，既有面不变。
// 复用 overview-board-empty-label.test.tsx 的挂载骨架（同一份 BoardCard props 形状）。

// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentStatus } from "@/app/agent-status/agent-status-types";
import { BoardCard } from "./overview-board";
import type { OverviewBoardCard } from "./overview-board-model";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NowMs = 1_700_000_000_000;

const workingStatus: AgentStatus = {
    blockId: "block-jump",
    provider: "pi",
    state: "working",
    phase: "none",
    source: "hook",
    confidence: "high",
    updatedAt: NowMs,
    activeSince: NowMs,
    phaseSince: NowMs,
};

function makeCard(overrides: Partial<OverviewBoardCard> = {}): OverviewBoardCard {
    return {
        blockId: "block-jump",
        tabId: "tab-1",
        sessionId: "session-1",
        tabName: "Tab 1",
        isAgentLike: true,
        title: "pi agent",
        avatar: { kind: "emoji", emoji: "🤖" },
        providerLabel: "pi",
        projectName: "",
        tags: [],
        kindLabel: "",
        preview: "",
        note: "",
        updatedAt: 0,
        ...overrides,
    };
}

type Mounted = { container: HTMLDivElement; root: Root };
const mounted: Mounted[] = [];

afterEach(() => {
    for (const { container, root } of mounted.splice(0)) {
        act(() => root.unmount());
        container.remove();
    }
});

function mountCard(card: OverviewBoardCard, props: { onJumpCard?: (card: OverviewBoardCard) => void } = {}): HTMLDivElement {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push({ container, root });
    act(() => {
        root.render(
            <BoardCard
                card={card}
                status={workingStatus}
                columnKey="status:working"
                now={NowMs}
                onOpenCard={() => {}}
                onAckStatus={() => {}}
                onJumpCard={props.onJumpCard}
            />
        );
    });
    return container;
}

function jumpButton(container: HTMLElement): HTMLButtonElement | null {
    return container.querySelector<HTMLButtonElement>("[data-board-jump]");
}

describe("BoardCard jump action", () => {
    it("renders the jump button when onJumpCard is provided", () => {
        const container = mountCard(makeCard(), { onJumpCard: () => {} });
        const button = jumpButton(container);
        expect(button).not.toBeNull();
        expect(button?.title).toBe("定位到块");
    });

    it("jump click fires onJumpCard and does not open the card", () => {
        const onJumpCard = vi.fn();
        const onOpenCard = vi.fn();
        const card = makeCard();
        const container = document.createElement("div");
        document.body.appendChild(container);
        const root = createRoot(container);
        mounted.push({ container, root });
        act(() => {
            root.render(
                <BoardCard
                    card={card}
                    status={workingStatus}
                    columnKey="status:working"
                    now={NowMs}
                    onOpenCard={onOpenCard}
                    onAckStatus={() => {}}
                    onJumpCard={onJumpCard}
                />
            );
        });
        const button = jumpButton(container);
        expect(button).not.toBeNull();
        act(() => {
            button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });
        expect(onJumpCard).toHaveBeenCalledTimes(1);
        expect(onJumpCard).toHaveBeenCalledWith(card);
        expect(onOpenCard).not.toHaveBeenCalled();
    });

    it("renders no jump button without onJumpCard", () => {
        const container = mountCard(makeCard());
        expect(jumpButton(container)).toBeNull();
    });

    it("renders no jump button for a card without a tab", () => {
        const container = mountCard(makeCard({ tabId: "" }), { onJumpCard: () => {} });
        expect(jumpButton(container)).toBeNull();
    });
});
