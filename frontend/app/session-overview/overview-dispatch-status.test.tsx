// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 异步派发回执可见性（11-24 R7）的契约测试（「292/aaaa」事故根因修复）：
//   · 新建 agent 首发消息建块后立刻有「正在派发」状态（markDispatching）；
//   · 派发中（pending/delivering）按 3s 懒拉 AgentDispatchGetCommand，confirmed →
//     状态转 submitted 且**草稿被清**；failed → failed；
//   · 重查有次数上限（40 次），不引全局轮询；
//   · 重启后（派发记录纯内存，D4 不落盘）无记录不显示「未发送」—— 无行程 = 不占位。

// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RpcApi } from "@/app/store/wshclientapi";
import { CardSendContext, useCardSendState, type CardSendState } from "./overview-card-send-panel";
import { SendStatusChip } from "./send-status-chip";

vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: {
        AgentDispatchGetCommand: vi.fn(),
        AgentDispatchListCommand: vi.fn(),
    },
}));

vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let stateRef: CardSendState;
const reload = vi.fn();

function Harness(props: { blockId: string }) {
    const state = useCardSendState(reload);
    stateRef = state;
    return (
        <CardSendContext.Provider value={state}>
            <SendStatusChip blockId={props.blockId} surface="board" />
        </CardSendContext.Provider>
    );
}

type Mounted = { container: HTMLDivElement; root: Root };
const mounted: Mounted[] = [];

function mountHarness(blockId: string): HTMLDivElement {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push({ container, root });
    act(() => {
        root.render(<Harness blockId={blockId} />);
    });
    return container;
}

beforeEach(() => {
    vi.mocked(RpcApi.AgentDispatchGetCommand).mockReset();
});

afterEach(() => {
    for (const { container, root } of mounted.splice(0)) {
        act(() => root.unmount());
        container.remove();
    }
    vi.useRealTimers();
});

describe("异步派发回执（11-24 R7）", () => {
    it("建块后立即有「正在派发」状态，投递不再隐形", () => {
        const container = mountHarness("b-q");
        expect(container.querySelector("[data-board-send-status]")).toBeNull();
        act(() => {
            stateRef.markDispatching("b-q");
        });
        expect(container.querySelector("[data-board-send-status]")!.getAttribute("data-board-send-status")).toBe(
            "sending"
        );
    });

    it("派发中 3s 懒拉回执；confirmed → submitted 且草稿被清", async () => {
        vi.useFakeTimers();
        vi.mocked(RpcApi.AgentDispatchGetCommand).mockResolvedValue({ state: "delivering" } as never);
        const container = mountHarness("b-poll");
        act(() => {
            stateRef.markDispatching("b-poll");
            stateRef.setDraft("b-poll", "292/aaaa");
            stateRef.markDispatchReceipt("b-poll", { dispatchId: "d-1", state: "pending" });
        });
        expect(RpcApi.AgentDispatchGetCommand).not.toHaveBeenCalled();

        await act(async () => {
            vi.advanceTimersByTime(3100);
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(RpcApi.AgentDispatchGetCommand).toHaveBeenCalledWith(expect.anything(), { dispatchid: "d-1" });
        // 回执仍是 delivering：维持派发中。
        expect(container.querySelector("[data-board-send-status]")!.getAttribute("data-board-send-status")).toBe(
            "sending"
        );

        vi.mocked(RpcApi.AgentDispatchGetCommand).mockResolvedValue({ state: "confirmed" } as never);
        await act(async () => {
            vi.advanceTimersByTime(3100);
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(container.querySelector("[data-board-send-status]")!.getAttribute("data-board-send-status")).toBe(
            "submitted"
        );
        // confirmed = 已投递：草稿必须被清（否则用户看不到「已发出」的确定性）。
        expect(stateRef.draftByBlock["b-poll"]).toBeUndefined();
    });

    it("回执 failed → failed（可重试语义由 composer 承接）", async () => {
        vi.useFakeTimers();
        vi.mocked(RpcApi.AgentDispatchGetCommand).mockResolvedValue({ state: "failed", error: "E_BLOCK_NOT_READY" } as never);
        const container = mountHarness("b-f");
        act(() => {
            stateRef.markDispatching("b-f");
            stateRef.markDispatchReceipt("b-f", { dispatchId: "d-2", state: "pending" });
        });
        await act(async () => {
            vi.advanceTimersByTime(3100);
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(container.querySelector("[data-board-send-status]")!.getAttribute("data-board-send-status")).toBe(
            "failed"
        );
    });

    it("重查有上限：40 拍后不再打回执 RPC", async () => {
        vi.useFakeTimers();
        vi.mocked(RpcApi.AgentDispatchGetCommand).mockResolvedValue({ state: "pending" } as never);
        mountHarness("b-cap");
        act(() => {
            stateRef.markDispatching("b-cap");
            stateRef.markDispatchReceipt("b-cap", { dispatchId: "d-3", state: "pending" });
        });
        await act(async () => {
            vi.advanceTimersByTime(3100 * 45);
            await Promise.resolve();
            await Promise.resolve();
        });
        // 40 拍上限（第 41 拍起不再查询）。
        expect(RpcApi.AgentDispatchGetCommand).toHaveBeenCalledTimes(40);
    });

    it("重启后无派发记录不显示「未发送」：无行程 = 不占位（D4 内存态限制）", () => {
        const container = mountHarness("b-fresh");
        expect(container.querySelector("[data-board-send-status]")).toBeNull();
        expect(container.textContent ?? "").not.toContain("failed");
    });
});
