// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 看板卡会话方块条（11-24 R1 卡列融合）的 DOM 契约：
//   · agent 卡有消息 → 渲染 [data-board-message-square]，数量 = recentMessages.length；
//   · 超出上限 → `+n`（.session-overview-more），卡高不随消息数无限增长；
//   · 点击方块 → onOpenMessage(card, seq)（复用列表消息弹窗链路），且不冒泡成整卡弹窗；
//   · 无消息 / 非 agent 卡 → 不渲染方块行（不留空行）；
//   · 恢复按钮已移除（11-24 R2）：[data-board-restore] 必须为 0。

// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentStatus } from "@/app/agent-status/agent-status-types";
import { BoardCard } from "./overview-board";
import type { OverviewBoardCard } from "./overview-board-model";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NowMs = 1_700_000_000_000;

const idleStatus: AgentStatus = {
    blockId: "block-squares",
    provider: "pi",
    state: "idle",
    phase: "none",
    source: "hook",
    confidence: "high",
    updatedAt: NowMs,
    activeSince: NowMs,
    phaseSince: NowMs,
};

function square(seq: number, role: "user" | "assistant") {
    return { seq, role, preview: `msg-${seq}`, label: `${role} #${seq}` };
}

function makeCard(overrides: Partial<OverviewBoardCard> = {}): OverviewBoardCard {
    return {
        blockId: "block-squares",
        tabId: "tab-1",
        sessionId: "session-1",
        tabName: "Tab 1",
        isAgentLike: true,
        title: "pi agent",
        avatar: { kind: "emoji", emoji: "🤖" },
        providerLabel: "pi",
        provider: "pi",
        propRows: { visible: [], hiddenCount: 0 },
        projectName: "",
        tags: [],
        kindLabel: "",
        preview: "",
        note: "",
        updatedAt: 0,
        recentMessages: [],
        messagesOverflow: 0,
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

type MountOpts = {
    card: OverviewBoardCard;
    onOpenCard?: (card: OverviewBoardCard) => void;
    onOpenMessage?: (card: OverviewBoardCard, seq: number) => void;
};

function mountCard(opts: MountOpts): HTMLDivElement {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push({ container, root });
    act(() => {
        root.render(
            <BoardCard
                card={opts.card}
                status={idleStatus}
                columnKey="status:idle"
                now={NowMs}
                onOpenCard={opts.onOpenCard ?? (() => {})}
                onOpenMessage={opts.onOpenMessage}
            />
        );
    });
    return container;
}

function squares(container: HTMLElement): NodeListOf<HTMLElement> {
    return container.querySelectorAll<HTMLElement>("[data-board-message-square]");
}

describe("BoardCard message squares (11-24 R1)", () => {
    it("agent 卡有消息 → 渲染 N 个方块 + 溢出计数", () => {
        const container = mountCard({
            card: makeCard({
                recentMessages: [square(1, "user"), square(2, "assistant"), square(3, "user")],
                messagesOverflow: 7,
            }),
        });
        expect(squares(container)).toHaveLength(3);
        const more = container.querySelector(".session-overview-more");
        expect(more).not.toBeNull();
        expect(more!.textContent).toBe("+7");
    });

    it("点击方块回传 seq，且不冒泡成整卡弹窗", () => {
        const onOpenCard = vi.fn();
        const onOpenMessage = vi.fn();
        const container = mountCard({
            card: makeCard({
                recentMessages: [square(1, "user"), square(2, "assistant")],
                messagesOverflow: 0,
            }),
            onOpenCard,
            onOpenMessage,
        });
        act(() => {
            squares(container)[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });
        expect(onOpenMessage).toHaveBeenCalledTimes(1);
        expect(onOpenMessage).toHaveBeenCalledWith(expect.objectContaining({ blockId: "block-squares" }), 2);
        expect(onOpenCard).not.toHaveBeenCalled();
    });

    it("未传 onOpenMessage 时方块只展示不响应", () => {
        const onOpenCard = vi.fn();
        const container = mountCard({
            card: makeCard({ recentMessages: [square(1, "user")] }),
            onOpenCard,
        });
        expect(squares(container)).toHaveLength(1);
        act(() => {
            squares(container)[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });
        expect(onOpenCard).not.toHaveBeenCalled();
    });

    it("无消息不渲染方块行（不留空行，卡高不跳）", () => {
        const container = mountCard({ card: makeCard() });
        expect(squares(container)).toHaveLength(0);
        expect(container.querySelector(".session-overview-message-strip")).toBeNull();
    });

    it("非 agent 卡不渲染方块条", () => {
        const container = mountCard({
            card: makeCard({
                isAgentLike: false,
                kindLabel: "Terminal",
                recentMessages: [square(1, "user")],
            }),
        });
        expect(squares(container)).toHaveLength(0);
    });

    it("恢复按钮已移除（11-24 R2）：[data-board-restore] 为 0", () => {
        const container = mountCard({
            card: makeCard({ recentMessages: [square(1, "user")] }),
        });
        expect(container.querySelectorAll("[data-board-restore]")).toHaveLength(0);
        expect(container.querySelectorAll("[data-board-restore-error]")).toHaveLength(0);
    });
});
