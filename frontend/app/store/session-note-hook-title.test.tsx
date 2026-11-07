// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// useSessionNoteState().renameTitle 行为测试（jsdom）。
//
// 锁定的回归点：
//  1. 名字 trim 后传给 service.Title，origin 传 connection（本地会话为空串）。
//  2. 成功 → dispatchAISessionNoteUpdated 被派发一次，返回值是写入后的 summary。
//  3. 空串 / 与现值相同 → 不调 service.Title，返回 null。
//  4. 失败 → 返回 null，error 有值。
//  5. 没有 summary（会话摘要未就绪）→ 不调 service.Title。
//
// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionNoteState, type SessionNoteState } from "./session-note-hook";
import { resetSessionNoteCache } from "./session-note-cache";
import { AiSessionNoteUpdatedEvent } from "@/app/view/aisessions/session-note-events";
import { AISessionsServiceType } from "@/app/store/services";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeSummary(key: string, title: string): SessionSummary {
    return { key, id: key, source: "test", title, note: "", tags: [] };
}

let current: SessionNoteState | null = null;

function Probe({ sessionId }: { sessionId: string }) {
    const state = useSessionNoteState(sessionId, "");
    current = state;
    return null;
}

function mount(sessionId: string): { unmount: () => void } {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
        root.render(<Probe sessionId={sessionId} />);
    });
    return {
        unmount: () => {
            act(() => root.unmount());
            container.remove();
        },
    };
}

async function flush(times = 3): Promise<void> {
    for (let i = 0; i < times; i++) {
        await act(async () => {
            await Promise.resolve();
        });
    }
}

async function waitFor(predicate: () => boolean, label: string, timeoutMs = 1500): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (predicate()) {
            return;
        }
        await flush(1);
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`timeout waiting for ${label}`);
}

describe("useSessionNoteState.renameTitle", () => {
    beforeEach(() => {
        current = null;
        resetSessionNoteCache();
    });

    afterEach(() => {
        resetSessionNoteCache();
        vi.restoreAllMocks();
    });

    it("trims and passes the new title to service.Title", async () => {
        const key = "rename-session";
        const titleFn = vi.fn(async (_id: string, next: string) => makeSummary(key, next));
        vi.spyOn(AISessionsServiceType.prototype, "Summary").mockImplementation(
            (async () => makeSummary(key, "Old Title")) as never
        );
        vi.spyOn(AISessionsServiceType.prototype, "Title").mockImplementation(titleFn as never);

        const h = mount(key);
        await waitFor(() => current?.summary?.title === "Old Title", "summary load");

        const result = await current.renameTitle("  New Title  ");
        expect(titleFn).toHaveBeenCalledTimes(1);
        expect(titleFn.mock.calls[0][1]).toBe("New Title");
        expect(result).not.toBeNull();
        h.unmount();
    });

    it("dispatches the note-updated event exactly once on success", async () => {
        const key = "rename-dispatch";
        vi.spyOn(AISessionsServiceType.prototype, "Summary").mockImplementation(
            (async () => makeSummary(key, "Old")) as never
        );
        vi.spyOn(AISessionsServiceType.prototype, "Title").mockImplementation(
            (async (_id: string, next: string) => makeSummary(key, next)) as never
        );
        const listener = vi.fn();
        window.addEventListener(AiSessionNoteUpdatedEvent, listener);

        const h = mount(key);
        await waitFor(() => current?.summary?.title === "Old", "summary load");
        await current.renameTitle("New");
        await flush();

        expect(listener).toHaveBeenCalledTimes(1);
        expect((listener.mock.calls[0][0] as CustomEvent).detail.summary.title).toBe("New");
        window.removeEventListener(AiSessionNoteUpdatedEvent, listener);
        h.unmount();
    });

    it("does not call the service for an empty title", async () => {
        const key = "rename-empty";
        const titleFn = vi.fn();
        vi.spyOn(AISessionsServiceType.prototype, "Summary").mockImplementation(
            (async () => makeSummary(key, "Old")) as never
        );
        vi.spyOn(AISessionsServiceType.prototype, "Title").mockImplementation(titleFn as never);

        const h = mount(key);
        await waitFor(() => current?.summary?.title === "Old", "summary load");
        expect(await current.renameTitle("   ")).toBeNull();
        expect(titleFn).not.toHaveBeenCalled();
        h.unmount();
    });

    it("does not call the service when the title is unchanged", async () => {
        const key = "rename-same";
        const titleFn = vi.fn();
        vi.spyOn(AISessionsServiceType.prototype, "Summary").mockImplementation(
            (async () => makeSummary(key, "Same")) as never
        );
        vi.spyOn(AISessionsServiceType.prototype, "Title").mockImplementation(titleFn as never);

        const h = mount(key);
        await waitFor(() => current?.summary?.title === "Same", "summary load");
        expect(await current.renameTitle("Same")).toBeNull();
        expect(titleFn).not.toHaveBeenCalled();
        h.unmount();
    });

    it("returns null and records an error when the write fails", async () => {
        const key = "rename-fail";
        vi.spyOn(AISessionsServiceType.prototype, "Summary").mockImplementation(
            (async () => makeSummary(key, "Old")) as never
        );
        vi.spyOn(AISessionsServiceType.prototype, "Title").mockImplementation(
            (async () => {
                throw new Error("backend exploded");
            }) as never
        );

        const h = mount(key);
        await waitFor(() => current?.summary?.title === "Old", "summary load");
        expect(await current.renameTitle("New")).toBeNull();
        await flush();
        expect(current?.error ?? "").toContain("backend exploded");
        h.unmount();
    });

    it("does nothing when the summary is not loaded yet", async () => {
        const key = "rename-nosummary";
        const titleFn = vi.fn();
        let release: ((value: SessionSummary) => void) | null = null;
        vi.spyOn(AISessionsServiceType.prototype, "Summary").mockImplementation(
            () =>
                new Promise<SessionSummary>((resolve) => {
                    release = resolve;
                }) as never
        );
        vi.spyOn(AISessionsServiceType.prototype, "Title").mockImplementation(titleFn as never);

        const h = mount(key);
        expect(await current.renameTitle("New")).toBeNull();
        expect(titleFn).not.toHaveBeenCalled();
        release?.(makeSummary(key, "Old"));
        h.unmount();
    });
});
