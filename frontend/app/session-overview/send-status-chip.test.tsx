// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 发送状态 chip（11-24 R6）的 DOM 契约：
//   · 无行程 → 渲染 null（不占位）；
//   · sending → 秒数文案（data-board-send-status / data-row-send-status = phase）；
//   · 终态（submitted）3s 后自动淡出；
//   · 点击 chip 展开/重开该卡 composer（默认 toggleExpanded；onOpen 回调优先）；
//   · failed 也常驻可见（tone=danger）。

// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SendStatusChip } from "./send-status-chip";
import { CardSendContext, useCardSendState, type CardSendState } from "./overview-card-send-panel";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let stateRef: CardSendState;
const reload = vi.fn();

function ChipHarness(props: { blockId: string; onOpen?: (event: React.MouseEvent<HTMLButtonElement>) => void }) {
    const state = useCardSendState(reload);
    stateRef = state;
    return (
        <CardSendContext.Provider value={state}>
            <SendStatusChip blockId={props.blockId} surface="board" onOpen={props.onOpen} />
        </CardSendContext.Provider>
    );
}

type Mounted = { container: HTMLDivElement; root: Root };
const mounted: Mounted[] = [];

function mountChip(props: { blockId: string; onOpen?: (event: React.MouseEvent<HTMLButtonElement>) => void }) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push({ container, root });
    act(() => {
        root.render(<ChipHarness {...props} />);
    });
    return container;
}

afterEach(() => {
    for (const { container, root } of mounted.splice(0)) {
        act(() => root.unmount());
        container.remove();
    }
});

describe("SendStatusChip（11-24 R6）", () => {
    it("无行程 → 渲染 null（不占位）", () => {
        const container = mountChip({ blockId: "b-none" });
        expect(container.querySelector("[data-board-send-status]")).toBeNull();
        expect(container.querySelector(".session-overview-send-status-chip")).toBeNull();
    });

    it("markDispatching 后立即出现 sending 状态（投递不再隐形）", () => {
        const container = mountChip({ blockId: "b-dispatch" });
        act(() => {
            stateRef.markDispatching("b-dispatch");
        });
        const chip = container.querySelector<HTMLElement>("[data-board-send-status]");
        expect(chip).not.toBeNull();
        expect(chip!.getAttribute("data-board-send-status")).toBe("sending");
    });

    it("failed 常驻可见且 tone=danger", () => {
        const container = mountChip({ blockId: "b-fail" });
        act(() => {
            stateRef.applyDispatchReceipt("b-fail", { state: "failed", error: "boom" });
        });
        const chip = container.querySelector<HTMLElement>("[data-board-send-status]");
        expect(chip).not.toBeNull();
        expect(chip!.getAttribute("data-board-send-status")).toBe("failed");
        expect(chip!.className).toContain("is-danger");
    });

    it("submitted 终态 3s 后自动淡出", () => {
        vi.useFakeTimers();
        try {
            const container = mountChip({ blockId: "b-hide" });
            act(() => {
                stateRef.applyDispatchReceipt("b-hide", { state: "confirmed" });
            });
            expect(container.querySelector("[data-board-send-status]")!.getAttribute("data-board-send-status")).toBe(
                "submitted"
            );
            act(() => {
                vi.advanceTimersByTime(3100);
            });
            expect(container.querySelector("[data-board-send-status]")).toBeNull();
        } finally {
            vi.useRealTimers();
        }
    });

    it("点击 chip 默认 toggleExpanded；传 onOpen 则走回调", () => {
        const onOpen = vi.fn();
        const container = mountChip({ blockId: "b-click", onOpen });
        act(() => {
            stateRef.markDispatching("b-click");
        });
        const chip = container.querySelector<HTMLElement>("[data-board-send-status]")!;
        act(() => {
            chip.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });
        expect(onOpen).toHaveBeenCalledTimes(1);
        expect(stateRef.expandedBlockId).toBe(null);
    });

    it("surface=row 时挂 data-row-send-status", () => {
        const container = document.createElement("div");
        document.body.appendChild(container);
        const root = createRoot(container);
        mounted.push({ container, root });
        act(() => {
            root.render(<RowHarness blockId="b-row" />);
        });
        expect(container.querySelector("[data-row-send-status]")).toBeNull();
        act(() => {
            stateRef.markDispatching("b-row");
        });
        const chip = container.querySelector<HTMLElement>("[data-row-send-status]");
        expect(chip).not.toBeNull();
        expect(chip!.getAttribute("data-row-send-status")).toBe("sending");
    });
});

function RowHarness(props: { blockId: string }) {
    const state = useCardSendState(reload);
    stateRef = state;
    return (
        <CardSendContext.Provider value={state}>
            <SendStatusChip blockId={props.blockId} surface="row" />
        </CardSendContext.Provider>
    );
}
