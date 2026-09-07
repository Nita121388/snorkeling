// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// session-note-cache 模块行为测试. 锁定必须保留的行为:
//   1. 加载成功: Summary RPC 结果进入缓存, 状态 loaded.
//   2. 会话文件未落盘时自动重试: 失败后按 NoteLoadRetryDelayMs 重试, 上限后进入 error.
//   3. 重试与组件挂载解耦: 无订阅者时重试依旧进行.
//   4. connection 隔离: 不同 connection 的同一 sessionId 不共享缓存.
//   5. saveSessionNote: 写后端 → 更新缓存 → 派发 AiSessionNoteUpdatedEvent.
//   6. 外部 note 更新事件同步缓存 (其他组件保存时本缓存立即更新).
//
// 隔离策略: 模块级单例 Map, 每个用例用 resetSessionNoteCache() 清空.
// store 使用 window.setTimeout / CustomEvent, 需要 jsdom 环境.
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    ensureSessionNote,
    getSessionNoteSnapshot,
    resetSessionNoteCache,
    saveSessionNote,
    subscribeSessionNote,
} from "./session-note-cache";
import { AiSessionNoteUpdatedEvent } from "@/app/view/aisessions/session-note-events";
import type { AISessionsServiceType } from "@/app/store/services";

const RetryDelayMs = 3000;
const MaxRetries = 10;

let idCounter = 0;
function nextId(prefix: string): string {
    idCounter += 1;
    return `${prefix}-${process.pid}-${idCounter}`;
}

function makeSummary(sessionId: string, note: string): SessionSummary {
    return {
        key: `key-${sessionId}`,
        id: sessionId,
        source: "test",
        updatedAt: 0,
        messageCount: 1,
        note,
    };
}

function makeMockService(): {
    service: AISessionsServiceType;
    summaryFn: ReturnType<typeof vi.fn>;
    noteAndTagsFn: ReturnType<typeof vi.fn>;
} {
    const summaryFn = vi.fn();
    const noteAndTagsFn = vi.fn();
    const service = {
        Summary: summaryFn,
        NoteAndTags: noteAndTagsFn,
    } as unknown as AISessionsServiceType;
    return { service, summaryFn, noteAndTagsFn };
}

describe("session-note-cache (behavior baseline)", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        resetSessionNoteCache();
    });

    afterEach(() => {
        resetSessionNoteCache();
        vi.useRealTimers();
    });

    it("loads summary and caches it; second ensure does not re-fetch", async () => {
        const { service, summaryFn } = makeMockService();
        const sessionId = nextId("s");
        summaryFn.mockResolvedValue(makeSummary(sessionId, "hello"));

        ensureSessionNote(service, sessionId);
        expect(summaryFn).toHaveBeenCalledTimes(1);
        await vi.waitFor(() => {
            expect(getSessionNoteSnapshot(sessionId).status).toBe("loaded");
        });
        expect(getSessionNoteSnapshot(sessionId).summary?.note).toBe("hello");

        ensureSessionNote(service, sessionId);
        expect(summaryFn).toHaveBeenCalledTimes(1);
    });

    it("retries when session file not yet created, independent of subscribers", async () => {
        const { service, summaryFn } = makeMockService();
        const sessionId = nextId("s");
        summaryFn.mockRejectedValueOnce(new Error("not found"));
        summaryFn.mockResolvedValueOnce(makeSummary(sessionId, "late note"));

        // 无订阅者: ensure 后立即"卸载" (不等 promise), 重试仍要继续.
        ensureSessionNote(service, sessionId);
        expect(summaryFn).toHaveBeenCalledTimes(1);
        expect(getSessionNoteSnapshot(sessionId).status).toBe("loading");

        await vi.advanceTimersByTimeAsync(RetryDelayMs);
        expect(summaryFn).toHaveBeenCalledTimes(2);
        await vi.waitFor(() => {
            expect(getSessionNoteSnapshot(sessionId).status).toBe("loaded");
        });
        expect(getSessionNoteSnapshot(sessionId).summary?.note).toBe("late note");
    });

    it("enters error state after exhausting retries and reloads on explicit ensure", async () => {
        const { service, summaryFn } = makeMockService();
        const sessionId = nextId("s");
        summaryFn.mockRejectedValue(new Error("still missing"));

        ensureSessionNote(service, sessionId);
        await vi.advanceTimersByTimeAsync(RetryDelayMs * (MaxRetries + 1));
        expect(summaryFn).toHaveBeenCalledTimes(MaxRetries + 1);
        expect(getSessionNoteSnapshot(sessionId).status).toBe("error");

        // 显式 ensure 重置重试计数, 再来一轮.
        summaryFn.mockResolvedValueOnce(makeSummary(sessionId, "recovered"));
        ensureSessionNote(service, sessionId);
        await vi.waitFor(() => {
            expect(getSessionNoteSnapshot(sessionId).status).toBe("loaded");
        });
        expect(getSessionNoteSnapshot(sessionId).summary?.note).toBe("recovered");
    });

    it("isolates cache entries by connection", async () => {
        const { service, summaryFn } = makeMockService();
        const sessionId = nextId("s");
        summaryFn.mockResolvedValue(makeSummary(sessionId, "conn-a"));

        ensureSessionNote(service, sessionId, "conn-a");
        ensureSessionNote(service, sessionId, "conn-b");
        expect(summaryFn).toHaveBeenCalledTimes(2);
    });

    it("saveSessionNote writes backend, updates cache, and dispatches update event", async () => {
        const { service, summaryFn, noteAndTagsFn } = makeMockService();
        const sessionId = nextId("s");
        const summary = makeSummary(sessionId, "old");
        summaryFn.mockResolvedValue(summary);
        const updated = { ...summary, note: "new note" };
        noteAndTagsFn.mockResolvedValue(updated);

        ensureSessionNote(service, sessionId);
        await vi.waitFor(() => {
            expect(getSessionNoteSnapshot(sessionId).status).toBe("loaded");
        });

        const events: SessionSummary[] = [];
        window.addEventListener(AiSessionNoteUpdatedEvent, (e) => {
            const detail = (e as CustomEvent<{ summary: SessionSummary }>).detail;
            events.push(detail.summary);
        });

        const result = await saveSessionNote(service, sessionId, undefined, "new note", ["tag1"]);
        expect(result.status).toBe("ok");
        expect(noteAndTagsFn).toHaveBeenCalledWith({ id: summary.key, note: "new note", tags: ["tag1"] });
        expect(getSessionNoteSnapshot(sessionId).summary?.note).toBe("new note");
        expect(events).toHaveLength(1);
        expect(events[0].note).toBe("new note");
    });

    it("external note-updated event syncs the cache without refetch", async () => {
        const { service, summaryFn } = makeMockService();
        const sessionId = nextId("s");
        summaryFn.mockResolvedValue(makeSummary(sessionId, "v1"));

        ensureSessionNote(service, sessionId);
        await vi.waitFor(() => {
            expect(getSessionNoteSnapshot(sessionId).status).toBe("loaded");
        });

        const listener = vi.fn();
        const unsub = subscribeSessionNote(sessionId, undefined, listener);

        const updated = makeSummary(sessionId, "v2-from-elsewhere");
        window.dispatchEvent(
            new CustomEvent(AiSessionNoteUpdatedEvent, { detail: { summary: updated } })
        );

        expect(listener).toHaveBeenCalled();
        expect(getSessionNoteSnapshot(sessionId).summary?.note).toBe("v2-from-elsewhere");
        expect(summaryFn).toHaveBeenCalledTimes(1); // 未重新拉取
        unsub();
    });
});
