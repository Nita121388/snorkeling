// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 看板卡片 meta 行的 DOM 回归：没有状态就不要渲染空的状态标签。
//
// 背景（2026-11-09 nita 报）：pi agent 卡上出现
//   <span class="session-overview-board-card-view-label"></span>
// 该 class 带 border / padding / border-radius，空串也会画出一个小空胶囊。
// 列表视图早已按 status 判空，这里锁住看板视图不再漏同一步。

// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentStatus } from "@/app/agent-status/agent-status-types";
import { BoardCard } from "./overview-board";
import type { OverviewBoardCard } from "./overview-board-model";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NowMs = 1_700_000_000_000;

const workingStatus: AgentStatus = {
    blockId: "block-empty-label",
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
        blockId: "block-empty-label",
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

function mountCard(
    card: OverviewBoardCard,
    opts: { status?: AgentStatus | null; onAckStatus?: () => void } = {}
): HTMLDivElement {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push({ container, root });
    act(() => {
        root.render(
            <BoardCard
                card={card}
                status={opts.status ?? null}
                columnKey="status:idle"
                now={NowMs}
                onOpenCard={() => {}}
                onAckStatus={opts.onAckStatus}
            />
        );
    });
    return container;
}

function emptyLabels(container: HTMLElement): Element[] {
    return [...container.querySelectorAll(".session-overview-board-card-view-label")].filter(
        (element) => (element.textContent ?? "").trim() === ""
    );
}

describe("BoardCard meta label", () => {
    it("renders no label for an agent-like card without a status", () => {
        const container = mountCard(makeCard());
        expect(emptyLabels(container)).toHaveLength(0);
        expect(container.querySelectorAll(".session-overview-board-card-view-label")).toHaveLength(0);
    });

    it("keeps the view label for a non-agent card without a status", () => {
        const container = mountCard(makeCard({ isAgentLike: false, kindLabel: "Terminal" }));
        const labels = container.querySelectorAll(".session-overview-board-card-view-label");
        expect(labels).toHaveLength(1);
        expect((labels[0].textContent ?? "").trim()).toBe("Terminal");
        expect(emptyLabels(container)).toHaveLength(0);
    });

    it("lets the status chip own the meta row when a status is present", () => {
        const container = mountCard(makeCard({ isAgentLike: false, kindLabel: "Terminal" }), {
            status: workingStatus,
            onAckStatus: () => {},
        });
        expect(container.querySelectorAll(".session-overview-agent-status")).toHaveLength(1);
        expect(container.querySelectorAll(".session-overview-board-card-view-label")).toHaveLength(0);
    });

    it("keeps the view label when a status exists but no ack handler was passed", () => {
        const container = mountCard(makeCard({ isAgentLike: false, kindLabel: "Terminal" }), {
            status: workingStatus,
        });
        const labels = container.querySelectorAll(".session-overview-board-card-view-label");
        expect(labels).toHaveLength(1);
        expect((labels[0].textContent ?? "").trim()).toBe("Terminal");
        expect(emptyLabels(container)).toHaveLength(0);
    });
});
