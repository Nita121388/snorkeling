// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Overview 看板「＋ 新建 Agent」入口（F-1120-overview-add-agent-card）DOM 回归。
//
// 锁三件事：
//   1. 分组守卫：tab 分组每列 1 个入口，status 分组 0 个（派生列不可加卡）。
//   2. 入口位置：落在该列 .session-overview-board-cards 的末尾（卡片之后）。
//   3. 回调：点入口回传从列 key（`tab:<tabId>`）解析出的 tabId + 列标题（Tab 名）。

// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OverviewBoard } from "./overview-board";
import type { OverviewBoardCard, OverviewBoardGroup } from "./overview-board-model";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NowMs = 1_700_000_000_000;

function makeCard(overrides: Partial<OverviewBoardCard> = {}): OverviewBoardCard {
    return {
        blockId: "block-1",
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
        propRows: { visible: [], hiddenCount: 0 },
        recentMessages: [],
        messagesOverflow: 0,
        ...overrides,
    };
}

const mounted: { container: HTMLDivElement; root: Root }[] = [];

afterEach(() => {
    for (const { container, root } of mounted.splice(0)) {
        act(() => root.unmount());
        container.remove();
    }
});

function mountBoard(opts: { group: OverviewBoardGroup; cards?: OverviewBoardCard[]; onAddAgent?: (tabId: string, tabName: string) => void }) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push({ container, root });
    const cards = opts.cards ?? [
        makeCard({ blockId: "block-1", tabId: "tab-1", tabName: "Tab 1" }),
        makeCard({ blockId: "block-2", tabId: "tab-2", tabName: "Tab 2", title: "claude agent" }),
        makeCard({ blockId: "block-3", tabId: "tab-1", tabName: "Tab 1", title: "codex agent" }),
    ];
    act(() => {
        root.render(
            <OverviewBoard
                cards={cards}
                presentedStatuses={{}}
                group={opts.group}
                now={NowMs}
                onOpenCard={vi.fn()}
                onAddAgent={opts.onAddAgent}
            />
        );
    });
    return container;
}

describe("OverviewBoard「＋ 新建 Agent」入口", () => {
    it("tab 分组：每个 Tab 列末尾各 1 个入口", () => {
        const container = mountBoard({ group: "tab", onAddAgent: vi.fn() });
        const columns = container.querySelectorAll(".session-overview-board-column");
        expect(columns).toHaveLength(2);
        expect(container.querySelectorAll(".session-overview-board-add")).toHaveLength(2);
        // 入口在卡片列表里、排在卡片之后
        for (const column of columns) {
            const cardsBox = column.querySelector(".session-overview-board-cards");
            const add = cardsBox?.querySelector(".session-overview-board-add");
            expect(add).not.toBeNull();
            expect(cardsBox?.lastElementChild).toBe(add);
        }
    });

    it("status 分组（派生列）：不渲染入口", () => {
        const container = mountBoard({ group: "status" });
        expect(container.querySelectorAll(".session-overview-board-column").length).toBeGreaterThan(0);
        expect(container.querySelectorAll(".session-overview-board-add")).toHaveLength(0);
    });

    it("provider / project / tags 分组：同样不渲染入口", () => {
        for (const group of ["provider", "project", "tags"] as const) {
            const container = mountBoard({ group });
            expect(container.querySelectorAll(".session-overview-board-add")).toHaveLength(0);
            container.remove();
        }
    });

    it("点击入口回传列 key 解析出的 tabId 与 Tab 名", () => {
        const onAddAgent = vi.fn();
        const container = mountBoard({ group: "tab", onAddAgent });
        const firstAdd = container.querySelector(".session-overview-board-add") as HTMLElement;
        act(() => {
            firstAdd.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        });
        expect(onAddAgent).toHaveBeenCalledTimes(1);
        const [tabId, tabName] = onAddAgent.mock.calls[0];
        expect(tabId).toBe("tab-1");
        expect(tabName).toBe("Tab 1");
    });

    it("不传 onAddAgent（嵌入/测试场景）：不渲染入口", () => {
        const container = mountBoard({ group: "tab" });
        // mountBoard 默认不传 onAddAgent
        expect(container.querySelectorAll(".session-overview-board-add")).toHaveLength(0);
    });
});
