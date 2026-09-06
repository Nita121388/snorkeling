// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// outline-cache 模块行为测试. 锁定必须保留的行为:
//   1. TTL 命中/过期: 新鲜缓存不发 RPC, 过期重新发.
//   2. in-flight Promise 复用: 同一会话并发两次只发一个 RPC.
//   3. forceRefresh 跳过缓存/在途, 强制发 RPC.
//   4. connection 隔离: 不同 connection 的同一 sessionId 不共享缓存.
//   5. invalidate 使缓存失效, 下次重新发 RPC.
//
// 隔离策略: 模块级单例 Map, 每个用例用 resetUserOutlineCache() 清空, 避免跨用例污染.
// 用 vi.useFakeTimers 控制 OutlineTtlMs=12s 的过期边界.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    getCachedUserOutline,
    invalidateUserOutline,
    loadUserOutline,
    resetUserOutlineCache,
} from "./outline-cache";
import type { AISessionsServiceType } from "@/app/store/services";

// 唯一 id 计数器, 保证每个用例互不干扰.
let idCounter = 0;
function nextId(prefix: string): string {
    idCounter += 1;
    return `${prefix}-${process.pid}-${idCounter}`;
}

// 构造最小 outline 响应.
function makeOutline(sessionId: string, messageCount: number): AISessionsUserOutlineResponse {
    return {
        summary: {
            key: `key-${sessionId}`,
            id: sessionId,
            source: "test",
            updatedAt: 0,
            messageCount,
        },
        messages: [],
        userMessageCount: messageCount,
    };
}

// Mock service: 只实现 UserOutline, 走 unknown 双重 cast 绕过编译期检查.
function makeMockService(): {
    service: AISessionsServiceType;
    outlineFn: ReturnType<typeof vi.fn>;
} {
    const outlineFn = vi.fn();
    const service = {
        UserOutline: outlineFn,
    } as unknown as AISessionsServiceType;
    return { service, outlineFn };
}

describe("outline-cache (behavior baseline)", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        resetUserOutlineCache();
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("TTL 命中: 新鲜时直接返回缓存, 不再发 RPC", async () => {
        const sessionId = nextId("hit");
        const { service, outlineFn } = makeMockService();
        const outline = makeOutline(sessionId, 2);
        outlineFn.mockResolvedValue(outline);

        await loadUserOutline(service, sessionId, {});
        expect(outlineFn).toHaveBeenCalledTimes(1);

        const cached = await loadUserOutline(service, sessionId, {});
        expect(cached).toEqual(outline);
        expect(outlineFn).toHaveBeenCalledTimes(1);
        // getCachedUserOutline 同步读同一份缓存.
        expect(getCachedUserOutline(sessionId)).toEqual(outline);
    });

    it("TTL 过期: 超过 12s 重新发 RPC", async () => {
        const sessionId = nextId("expire");
        const { service, outlineFn } = makeMockService();
        const v1 = makeOutline(sessionId, 1);
        const v2 = makeOutline(sessionId, 2);
        outlineFn.mockResolvedValueOnce(v1).mockResolvedValueOnce(v2);

        await loadUserOutline(service, sessionId, {});
        expect(outlineFn).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(12_001);

        const refreshed = await loadUserOutline(service, sessionId, {});
        expect(refreshed).toEqual(v2);
        expect(outlineFn).toHaveBeenCalledTimes(2);
    });

    it("in-flight 复用: 同一会话并发两次只发一个 RPC", async () => {
        const sessionId = nextId("inflight");
        const { service, outlineFn } = makeMockService();
        const outline = makeOutline(sessionId, 3);
        let resolveRpc: (value: AISessionsUserOutlineResponse) => void = () => undefined;
        outlineFn.mockReturnValue(
            new Promise<AISessionsUserOutlineResponse>((resolve) => {
                resolveRpc = resolve;
            })
        );

        const p1 = loadUserOutline(service, sessionId, {});
        const p2 = loadUserOutline(service, sessionId, {});
        // 在途未返回前, 第二个调用应复用同一 Promise, 不新增 RPC.
        expect(outlineFn).toHaveBeenCalledTimes(1);

        resolveRpc(outline);
        const [r1, r2] = await Promise.all([p1, p2]);
        expect(r1).toEqual(outline);
        expect(r2).toEqual(outline);
        expect(outlineFn).toHaveBeenCalledTimes(1);
    });

    it("forceRefresh 跳过缓存与在途, 强制重新发 RPC", async () => {
        const sessionId = nextId("force");
        const { service, outlineFn } = makeMockService();
        const v1 = makeOutline(sessionId, 1);
        const v2 = makeOutline(sessionId, 2);
        outlineFn.mockResolvedValueOnce(v1).mockResolvedValueOnce(v2);

        await loadUserOutline(service, sessionId, {});
        expect(outlineFn).toHaveBeenCalledTimes(1);

        // 仍在 TTL 内, 但 forceRefresh 应跳过缓存直接重发.
        const forced = await loadUserOutline(service, sessionId, { forceRefresh: true });
        expect(forced).toEqual(v2);
        expect(outlineFn).toHaveBeenCalledTimes(2);
    });

    it("connection 隔离: 不同 connection 同一 sessionId 不共享缓存", async () => {
        const sessionId = nextId("conn");
        const { service, outlineFn } = makeMockService();
        const local = makeOutline(sessionId, 1);
        const remote = makeOutline(sessionId, 2);
        outlineFn.mockResolvedValueOnce(local).mockResolvedValueOnce(remote);

        await loadUserOutline(service, sessionId, { connection: "" });
        const remoteOutline = await loadUserOutline(service, sessionId, { connection: "remote" });
        expect(remoteOutline).toEqual(remote);
        expect(outlineFn).toHaveBeenCalledTimes(2);
    });

    it("invalidate 使缓存失效, 下次重新发 RPC", async () => {
        const sessionId = nextId("invalidate");
        const { service, outlineFn } = makeMockService();
        const v1 = makeOutline(sessionId, 1);
        const v2 = makeOutline(sessionId, 2);
        outlineFn.mockResolvedValueOnce(v1).mockResolvedValueOnce(v2);

        await loadUserOutline(service, sessionId, {});
        expect(outlineFn).toHaveBeenCalledTimes(1);

        invalidateUserOutline(sessionId);
        const after = await loadUserOutline(service, sessionId, {});
        expect(after).toEqual(v2);
        expect(outlineFn).toHaveBeenCalledTimes(2);
    });
});
