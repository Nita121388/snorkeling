// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 看板卡片 memo 与点击语义回归（11-10-overview-board-click-perf）。
//
// 1. BoardCard 必须是 React.memo 组件：面板一次无关重渲（如 markBlockViewed 写的
//    blockViewedAtAtom 整 map 换引用）不再带着整块看板全量重跑 —— 上百张卡是几十 ms
//    级 long task，会把 AgentCardModal 入场动画的首帧压在后面（「点了顿一下才弹」）。
//    memo 生效的前提（父级回调 useCallback 稳定）由 session-overview.tsx 保证，
//    本文件锁组件本身的 memo 结构不被退化。
// 2. 点击卡片本体开弹窗时必须 stopPropagation：不再冒泡到 block frame 触发
//    setBlockClickedTrue → setFocusTarget/focusNode 焦点搬运那一轮额外重渲。
// 3. 点击卡片内容区（标题/预览/头像…）与点卡片本体同义：都开弹窗（PRD 11-20 R1，
//    旧语义「子元素不开」正是 11-20 要修的 bug）。
// 4. 独立热区（动作按钮 / 状态 chip / emoji 头像）不被整卡点击接管。

// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BoardCard } from "./overview-board";
import type { OverviewBoardCard } from "./overview-board-model";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NowMs = 1_700_000_000_000;

function makeCard(overrides: Partial<OverviewBoardCard> = {}): OverviewBoardCard {
    return {
        blockId: "block-memo",
        tabId: "tab-1",
        sessionId: "session-1",
        tabName: "Tab 1",
        isAgentLike: true,
        title: "pi agent",
        avatar: { kind: "emoji", emoji: "🤖" },
        providerLabel: "pi",
        // raw provider key：emoji 头像热区判定用（卡片属性行 fixture 同步补齐 propRows）。
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

type MountOptions = {
    card?: OverviewBoardCard;
    onOpenCard?: (card: OverviewBoardCard) => void;
    onWrapperClick?: () => void;
};

/**
 * 卡片外面再套一层带 onClick 的 wrapper，模拟 block frame 的点击接客
 * （setBlockClickedTrue）：卡片开弹窗时的 stopPropagation 由 wrapper 是否收到
 * click 来判定（两个 spy 必须分开，共用一个就测不出冒泡）。
 */
function mountCardInWrapper(opts: MountOptions = {}): { container: HTMLDivElement; cardEl: HTMLElement } {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push({ container, root });
    const card = opts.card ?? makeCard();
    const onOpenCard = opts.onOpenCard ?? vi.fn();
    const onWrapperClick = opts.onWrapperClick ?? vi.fn();
    act(() => {
        root.render(
            <div onClick={onWrapperClick} data-testid="wrapper">
                <BoardCard
                    card={card}
                    status={null}
                    columnKey="status:working"
                    now={NowMs}
                    onOpenCard={onOpenCard}
                />
            </div>
        );
    });
    const cardEl = container.querySelector<HTMLElement>(".session-overview-board-card");
    expect(cardEl).not.toBeNull();
    return { container, cardEl: cardEl as HTMLElement };
}

describe("BoardCard memo structure", () => {
    it("is a React.memo component (unrelated panel re-renders must be able to bail out)", () => {
        // memo 组件对象带 react.memo 的 $$typeof 标记；退化回普通函数组件会让
        // SessionOverviewPanel 的每次重渲都全量重跑所有卡片。
        const memoType = (BoardCard as unknown as { $$typeof?: symbol }).$$typeof;
        expect(memoType).toBe(Symbol.for("react.memo"));
    });
});

describe("BoardCard click semantics", () => {
    it("opens the card on a direct click and stops propagation to the wrapper", () => {
        const onOpenCard = vi.fn();
        const onWrapperClick = vi.fn();
        const { cardEl } = mountCardInWrapper({ onOpenCard, onWrapperClick });
        act(() => {
            // target === currentTarget === 卡片容器：开弹窗路径。
            cardEl.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        });
        expect(onOpenCard).toHaveBeenCalledTimes(1);
        // stopPropagation：不再冒泡到 block frame → 不再多一轮焦点搬运重渲。
        expect(onWrapperClick).not.toHaveBeenCalled();
    });

    it("opens the card when clicking a child element (whole card is clickable)", () => {
        const onOpenCard = vi.fn();
        const onWrapperClick = vi.fn();
        const { container } = mountCardInWrapper({ onOpenCard, onWrapperClick });
        const title = container.querySelector<HTMLElement>(".session-overview-board-card-title");
        expect(title).not.toBeNull();
        act(() => {
            (title as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        });
        // 卡片内部全是子 span：点它们必须开弹窗（11-20 之前 target !== currentTarget 全丢弃）。
        expect(onOpenCard).toHaveBeenCalledTimes(1);
        expect(onWrapperClick).not.toHaveBeenCalled();
    });

    it("opens the card on Enter keydown (keyboard path unchanged)", () => {
        const onOpenCard = vi.fn();
        const { cardEl } = mountCardInWrapper({ onOpenCard });
        act(() => {
            cardEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
        });
        expect(onOpenCard).toHaveBeenCalledTimes(1);
    });
});
