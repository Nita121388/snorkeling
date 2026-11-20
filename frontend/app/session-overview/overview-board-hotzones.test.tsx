// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 看板卡片点击交互矩阵回归（任务 11-20-overview-board-card-click-hotzones）。
//
// 锁定的行为：
//   R1 整卡默认可点：标题 / 预览 / 展示态头像等子元素点击都触发 onOpenCard（1 次），
//      且命中时 stopPropagation（不冒泡到 block frame 的点击接管层）；
//   R2 独立热区各走各的：emoji 头像按钮 → openAgentEmojiPicker（不弹卡片）、
//      动作按钮（定位 / 删除 / 关闭）与状态 chip → 各自回调（不弹卡片）；
//   R4 emoji 热区只在 `isAgentLike && provider !== ""` 时生效，否则仍是纯展示 span；
//   R5 键盘双触发修复：根 Enter 开卡片，emoji 按钮上 Enter 只走它自己（不冒泡开卡片）；
//   R6 选区保护：`getSelection().isCollapsed === false` 时点击不开卡片。
//
// 挂载骨架沿用 overview-board-jump.test.tsx（jsdom + createRoot + act）；
// 卡片 fixture 必须补齐 `propRows`（BoardCard 直接读 `card.propRows.visible`）。

// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { i18n, initI18n } from "@/i18n/config";
import type { AgentStatus } from "@/app/agent-status/agent-status-types";
import { BoardCard } from "./overview-board";
import type { OverviewBoardCard } from "./overview-board-model";

// picker-host 是全局单例状态机：这里只关心「有没有按契约参数被调起」，直接 mock 掉。
const picker = vi.hoisted(() => ({ openAgentEmojiPicker: vi.fn() }));
vi.mock("@/app/agent-persona/picker-host", () => picker);

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NowMs = 1_700_000_000_000;

// 按钮 title / aria-label 走 i18n（与 jump 用例同一 Pattern I：先把实例初始化到 en）。
beforeAll(async () => {
    await initI18n("en");
});

const workingStatus: AgentStatus = {
    blockId: "block-hotzone",
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
        blockId: "block-hotzone",
        tabId: "tab-1",
        sessionId: "session-1",
        tabName: "Tab 1",
        isAgentLike: true,
        title: "pi agent",
        avatar: { kind: "emoji", emoji: "🤖" },
        providerLabel: "pi",
        provider: "pi",
        projectName: "",
        tags: [],
        propRows: { visible: [], hiddenCount: 0 },
        kindLabel: "",
        preview: "last message preview",
        note: "",
        updatedAt: 0,
        ...overrides,
    };
}

type MountProps = {
    status?: AgentStatus | null;
    onOpenCard?: (card: OverviewBoardCard) => void;
    onJumpCard?: (card: OverviewBoardCard) => void;
    onCloseCard?: (card: OverviewBoardCard) => void;
    onDeleteSession?: (card: OverviewBoardCard) => void;
    onAckStatus?: (blockId: string, status: AgentStatus) => void;
    onWrapperClick?: () => void;
};

type Mounted = { container: HTMLDivElement; root: Root };
const mounted: Mounted[] = [];

afterEach(() => {
    for (const { container, root } of mounted.splice(0)) {
        act(() => root.unmount());
        container.remove();
    }
    vi.clearAllMocks();
});

function mountCard(card: OverviewBoardCard, props: MountProps = {}): { container: HTMLDivElement; cardEl: HTMLElement } {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push({ container, root });
    act(() => {
        root.render(
            // 外层 wrapper 模拟 block frame 的点击接管（setBlockClickedTrue）：
            // 开卡片必须 stopPropagation，wrapper 不该收到这次 click。
            <div onClick={props.onWrapperClick} data-testid="wrapper">
                <BoardCard
                    card={card}
                    status={props.status ?? null}
                    columnKey="status:working"
                    now={NowMs}
                    onOpenCard={props.onOpenCard ?? (() => {})}
                    onJumpCard={props.onJumpCard}
                    onCloseCard={props.onCloseCard}
                    onDeleteSession={props.onDeleteSession}
                    onAckStatus={props.onAckStatus}
                />
            </div>
        );
    });
    const cardEl = container.querySelector<HTMLElement>(".session-overview-board-card");
    expect(cardEl).not.toBeNull();
    return { container, cardEl: cardEl as HTMLElement };
}

function click(element: Element | null) {
    expect(element).not.toBeNull();
    act(() => {
        (element as Element).dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
}

function query(container: HTMLElement, selector: string): HTMLElement | null {
    return container.querySelector<HTMLElement>(selector);
}

describe("BoardCard R1: the whole card is clickable", () => {
    it("opens the card when clicking the title (and stops bubbling to the wrapper)", () => {
        const onOpenCard = vi.fn();
        const onWrapperClick = vi.fn();
        const { container } = mountCard(makeCard(), { onOpenCard, onWrapperClick });
        click(query(container, ".session-overview-board-card-title"));
        expect(onOpenCard).toHaveBeenCalledTimes(1);
        expect(onWrapperClick).not.toHaveBeenCalled();
    });

    it("opens the card when clicking the preview text", () => {
        const onOpenCard = vi.fn();
        const { container } = mountCard(makeCard(), { onOpenCard });
        click(query(container, ".session-overview-board-card-preview"));
        expect(onOpenCard).toHaveBeenCalledTimes(1);
    });

    it("opens the card when clicking a display-only avatar (no provider)", () => {
        const onOpenCard = vi.fn();
        const { container } = mountCard(makeCard({ provider: "" }), { onOpenCard });
        const avatar = query(container, ".session-overview-board-card-avatar");
        expect(avatar?.tagName).toBe("SPAN");
        click(avatar);
        expect(onOpenCard).toHaveBeenCalledTimes(1);
    });

    it("opens the card when clicking the card padding itself", () => {
        const onOpenCard = vi.fn();
        const { cardEl } = mountCard(makeCard(), { onOpenCard });
        click(cardEl);
        expect(onOpenCard).toHaveBeenCalledTimes(1);
    });
});

describe("BoardCard R2/R4: emoji avatar is an independent hotzone", () => {
    it("renders a picker button when the card carries a raw provider", () => {
        const { container } = mountCard(makeCard());
        const button = query(container, ".session-overview-board-card-avatar-btn");
        expect(button?.tagName).toBe("BUTTON");
        // 兼容契约：verify 探针读 class + data-avatar-kind，不能因为改成 button 就丢。
        expect(button?.getAttribute("data-avatar-kind")).toBe("emoji");
        expect(button?.getAttribute("data-card-interactive")).toBe("true");
        expect(button?.getAttribute("aria-label")).toBe(i18n.t("term:hoverCard.setPersonaEmoji"));
    });

    it("opens the picker instead of the card (with the session scope + raw provider)", () => {
        const onOpenCard = vi.fn();
        const card = makeCard();
        const { container } = mountCard(card, { onOpenCard });
        click(query(container, ".session-overview-board-card-avatar-btn"));
        expect(picker.openAgentEmojiPicker).toHaveBeenCalledTimes(1);
        const args = picker.openAgentEmojiPicker.mock.calls[0];
        expect(args[0]).toBe(card.blockId);
        expect(args[1]).toBe("pi");
        // rect 由被点元素的 getBoundingClientRect 传入（jsdom 全 0，只断言形状）。
        expect(typeof (args[2] as DOMRect).top).toBe("number");
        expect(args[3]).toBe("session");
        expect(args[4]).toBe(card.sessionId);
        expect(onOpenCard).not.toHaveBeenCalled();
    });

    it("keeps a plain span when the card is not agent-like (no dead button)", () => {
        const onOpenCard = vi.fn();
        const { container } = mountCard(makeCard({ isAgentLike: false, provider: "pi" }), { onOpenCard });
        expect(query(container, ".session-overview-board-card-avatar-btn")).toBeNull();
        click(query(container, ".session-overview-board-card-avatar"));
        expect(picker.openAgentEmojiPicker).not.toHaveBeenCalled();
        expect(onOpenCard).toHaveBeenCalledTimes(1);
    });
});

describe("BoardCard R2: action buttons and status chip keep their own handlers", () => {
    it("jump button fires onJumpCard only", () => {
        const onJumpCard = vi.fn();
        const onOpenCard = vi.fn();
        const card = makeCard();
        const { container } = mountCard(card, { onJumpCard, onOpenCard });
        click(query(container, "[data-board-jump]"));
        expect(onJumpCard).toHaveBeenCalledTimes(1);
        expect(onJumpCard).toHaveBeenCalledWith(card);
        expect(onOpenCard).not.toHaveBeenCalled();
    });

    it("delete button fires onDeleteSession only", () => {
        const onDeleteSession = vi.fn();
        const onOpenCard = vi.fn();
        const card = makeCard();
        const { container } = mountCard(card, { onDeleteSession, onOpenCard });
        click(query(container, ".session-overview-board-card-action.danger"));
        expect(onDeleteSession).toHaveBeenCalledTimes(1);
        expect(onDeleteSession).toHaveBeenCalledWith(card);
        expect(onOpenCard).not.toHaveBeenCalled();
    });

    it("close button fires onCloseCard only", () => {
        const onCloseCard = vi.fn();
        const onOpenCard = vi.fn();
        const card = makeCard();
        const { container } = mountCard(card, { onCloseCard, onOpenCard });
        const actions = container.querySelectorAll<HTMLElement>(".session-overview-board-card-action");
        // 顺序：定位 / 删除 / 关闭（见 overview-board.tsx 的 head 动作区）。
        click(actions[actions.length - 1]);
        expect(onCloseCard).toHaveBeenCalledTimes(1);
        expect(onCloseCard).toHaveBeenCalledWith(card);
        expect(onOpenCard).not.toHaveBeenCalled();
    });

    it("status chip fires onAckStatus only", () => {
        const onAckStatus = vi.fn();
        const onOpenCard = vi.fn();
        const card = makeCard();
        const { container } = mountCard(card, { onAckStatus, onOpenCard, status: workingStatus });
        click(query(container, ".session-overview-agent-status"));
        expect(onAckStatus).toHaveBeenCalledTimes(1);
        expect(onAckStatus).toHaveBeenCalledWith(card.blockId, workingStatus);
        expect(onOpenCard).not.toHaveBeenCalled();
    });
});

describe("BoardCard R5/R6: keyboard + selection guards", () => {
    it("opens the card on Enter at the card root (keyboard path unchanged)", () => {
        const onOpenCard = vi.fn();
        const { cardEl } = mountCard(makeCard(), { onOpenCard });
        act(() => {
            cardEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
        });
        expect(onOpenCard).toHaveBeenCalledTimes(1);
    });

    it("does not open the card on Enter at the emoji button (no double trigger)", () => {
        const onOpenCard = vi.fn();
        const { container } = mountCard(makeCard(), { onOpenCard });
        const button = query(container, ".session-overview-board-card-avatar-btn");
        act(() => {
            (button as HTMLElement).dispatchEvent(
                new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })
            );
        });
        expect(onOpenCard).not.toHaveBeenCalled();
    });

    it("does not open the card when the click ends a text selection", () => {
        const onOpenCard = vi.fn();
        const { container } = mountCard(makeCard(), { onOpenCard });
        const original = window.getSelection;
        // 拖选预览文本后松手：isCollapsed === false，这一下不算点击。
        window.getSelection = (() =>
            ({ isCollapsed: false }) as unknown as Selection) as typeof window.getSelection;
        try {
            click(query(container, ".session-overview-board-card-preview"));
        } finally {
            window.getSelection = original;
        }
        expect(onOpenCard).not.toHaveBeenCalled();
    });
});
