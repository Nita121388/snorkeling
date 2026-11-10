// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// TermAgentMessageRail 刷新调度的回归测试（jsdom + fake timers）。
//
// 回归背景：旧实现只在 sessionId 变化时拉一次 UserOutline。新会话「首拉时第一条
// 用户消息还没落盘 → 空结果 → 轨道永久消失」，恢复的会话因为首拉即有数据而正常
// 显示。这里的用例锁住新调度的三个契约：
//   1. 空结果/错误 → 3s 快重试；有 prompt 后转 30s 慢轮询；
//   2. agentstatus 事件 → 去抖后 forced 补拉（forceRefresh: true）；
//   3. 卸载后不再发请求。
//
// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    loadUserOutline: vi.fn(),
    getCachedUserOutline: vi.fn(),
    ensureSessionNote: vi.fn(),
    statusHandlers: [] as Array<(event: unknown) => void>,
}));

vi.mock("@/app/store/outline-cache", () => ({
    getCachedUserOutline: mocks.getCachedUserOutline,
    loadUserOutline: mocks.loadUserOutline,
}));

vi.mock("@/app/store/session-note-cache", () => ({
    ensureSessionNote: mocks.ensureSessionNote,
}));

vi.mock("@/app/store/wps", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/app/store/wps")>();
    return {
        ...actual,
        waveEventSubscribeSingle: (
            subscription: { eventType: string; handler: (event: unknown) => void } & Record<string, unknown>
        ) => {
            if (subscription.eventType === "agentstatus") {
                mocks.statusHandlers.push(subscription.handler);
            }
            return () => {};
        },
    };
});

import { TermAgentMessageRail } from "./term-agent-message-rail";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

type TestMessage = { role: string; text: string; seq: number };

function outline(messages: TestMessage[]): AISessionsUserOutlineResponse {
    return {
        summary: { id: "sess-1" },
        messages: messages,
        userMessageCount: messages.filter((message) => message.role === "user").length,
    } as AISessionsUserOutlineResponse;
}

function userMsg(seq: number): TestMessage {
    return { role: "user", text: `msg ${seq}`, seq };
}

function renderRail(sessionId: string): void {
    act(() => {
        root.render(
            <TermAgentMessageRail
                blockId="block-1"
                blockData={{ meta: { "agent:sessionid": sessionId, "agent:provider": "codex" } } as unknown as Block}
                termWrap={null}
            />
        );
    });
}

async function advance(ms: number): Promise<void> {
    await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
    });
}

function tickCount(): number {
    return container.querySelectorAll(".term-agent-msg-rail .overflow-y-auto > div").length;
}

function emitAgentStatus(): void {
    const handler = mocks.statusHandlers[mocks.statusHandlers.length - 1];
    if (handler == null) {
        throw new Error("no agentstatus handler captured");
    }
    act(() => {
        handler({ data: { state: "working" } });
    });
}

beforeEach(() => {
    vi.useFakeTimers();
    mocks.loadUserOutline.mockReset();
    mocks.getCachedUserOutline.mockReset().mockReturnValue(null);
    mocks.ensureSessionNote.mockReset();
    mocks.statusHandlers.length = 0;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => {
        root.unmount();
    });
    container.remove();
    vi.useRealTimers();
});

describe("TermAgentMessageRail outline refresh", () => {
    it("retries fast on an empty outline, then polls slowly once prompts appear", async () => {
        mocks.loadUserOutline
            .mockResolvedValueOnce(outline([]))
            .mockResolvedValueOnce(outline([userMsg(1)]))
            .mockResolvedValue(outline([userMsg(1)]));

        renderRail("sess-1");
        await advance(0);
        // 挂载首拉：新会话此刻还没有用户消息（旧实现到此为止，轨道永不出现）。
        expect(mocks.loadUserOutline).toHaveBeenCalledTimes(1);

        await advance(3000);
        expect(mocks.loadUserOutline).toHaveBeenCalledTimes(2);
        expect(tickCount()).toBe(1);

        // 有 prompt 后转 30s 慢轮询：29s 内不重拉。
        await advance(29000);
        expect(mocks.loadUserOutline).toHaveBeenCalledTimes(2);
        await advance(1000);
        expect(mocks.loadUserOutline).toHaveBeenCalledTimes(3);
    });

    it("treats an RPC error (session file not created yet) as an empty result", async () => {
        mocks.loadUserOutline
            .mockRejectedValueOnce(new Error("session not found"))
            .mockResolvedValue(outline([userMsg(1)]));

        renderRail("sess-2");
        await advance(0);
        expect(mocks.loadUserOutline).toHaveBeenCalledTimes(1);

        await advance(3000);
        expect(mocks.loadUserOutline).toHaveBeenCalledTimes(2);
        expect(tickCount()).toBe(1);
    });

    it("refreshes with forceRefresh after an agentstatus event (debounced)", async () => {
        mocks.loadUserOutline.mockResolvedValue(outline([userMsg(1)]));

        renderRail("sess-3");
        await advance(0);
        expect(mocks.loadUserOutline).toHaveBeenCalledTimes(1);

        emitAgentStatus();
        // 800ms 去抖窗口内不补发。
        await advance(500);
        expect(mocks.loadUserOutline).toHaveBeenCalledTimes(1);
        await advance(300);
        expect(mocks.loadUserOutline).toHaveBeenCalledTimes(2);
        const lastCall = mocks.loadUserOutline.mock.calls[mocks.loadUserOutline.mock.calls.length - 1];
        expect(lastCall[2]?.forceRefresh).toBe(true);
    });

    it("stops requesting after unmount", async () => {
        mocks.loadUserOutline.mockResolvedValue(outline([]));

        renderRail("sess-4");
        await advance(0);
        expect(mocks.loadUserOutline).toHaveBeenCalledTimes(1);

        act(() => {
            root.unmount();
        });
        await advance(30000);
        expect(mocks.loadUserOutline).toHaveBeenCalledTimes(1);
    });
});
