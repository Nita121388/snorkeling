// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// available-session-tags 的契约测试。
//
// 锁定的回归点：
//  1. 命中 TTL 时不重复发 RPC（hover 风暴保护）。
//  2. 并发 ensure 合并成同一个 in-flight 请求。
//  3. 不同 connection 分桶互不污染。
//  4. RPC 失败不缓存错误态：下一次 ensure 会重试。
//  5. 清单内容变化才换快照引用（useSyncExternalStore 同一性要求）。

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AISessionsServiceType } from "@/app/store/services";
import {
    __resetAvailableTagsCacheForTest,
    availableTagsCacheKey,
    ensureAvailableTags,
    getAvailableTagsSnapshot,
    subscribeAvailableTags,
} from "./available-session-tags";

function makeTags(...pairs: [string, number][]): SessionTagSummary[] {
    return pairs.map(([tag, count]) => ({ tag, count }));
}

/** 假 service：记录调用参数，按队列返回预设结果。 */
function fakeService(responses: (() => Promise<{ tags: SessionTagSummary[] }>)[]) {
    const calls: AISessionsTagsRequest[] = [];
    let index = 0;
    const service = {
        Tags: vi.fn(async (request: AISessionsTagsRequest) => {
            calls.push(request);
            const next = responses[Math.min(index, responses.length - 1)];
            index++;
            return next();
        }),
    } as unknown as AISessionsServiceType;
    return { service, calls };
}

describe("available-session-tags", () => {
    beforeEach(() => {
        __resetAvailableTagsCacheForTest();
    });

    it("桶键把 connection 与 origin 分开，不会互相串", () => {
        expect(availableTagsCacheKey({ connection: "a", origin: "b" })).not.toBe(
            availableTagsCacheKey({ connection: "a:b", origin: "" })
        );
        expect(availableTagsCacheKey({ connection: " local ", origin: "" })).toBe(
            availableTagsCacheKey({ connection: "local", origin: "" })
        );
    });

    it("首次 ensure 发一次 RPC，命中 TTL 后不再发", async () => {
        const { service, calls } = fakeService([async () => ({ tags: makeTags(["fix", 3]) })]);
        const key = { connection: "local", origin: "" };

        const first = await ensureAvailableTags(key, { service });
        expect(first).toEqual(makeTags(["fix", 3]));
        expect(calls).toHaveLength(1);
        // 最小过滤：只带 connection，不带任何 aisessions 的筛选参数。
        expect(calls[0].connection).toBe("local");
        expect(calls[0].since).toBeUndefined();
        expect(calls[0].marked).toBeUndefined();
        expect(calls[0].tagFilters).toBeUndefined();

        const second = await ensureAvailableTags(key, { service });
        expect(second).toEqual(makeTags(["fix", 3]));
        expect(calls).toHaveLength(1); // TTL 内命中缓存
    });

    it("refresh=true 绕过 TTL 重新拉取", async () => {
        const { service, calls } = fakeService([
            async () => ({ tags: makeTags(["fix", 3]) }),
            async () => ({ tags: makeTags(["fix", 4]) }),
        ]);
        const key = { connection: "local", origin: "" };

        await ensureAvailableTags(key, { service });
        const refreshed = await ensureAvailableTags(key, { service, refresh: true });
        expect(calls).toHaveLength(2);
        expect(refreshed).toEqual(makeTags(["fix", 4]));
    });

    it("并发 ensure 合并成同一个 in-flight 请求", async () => {
        let resolve: ((value: { tags: SessionTagSummary[] }) => void) | null = null;
        const { service, calls } = fakeService([
            () =>
                new Promise((res) => {
                    resolve = res;
                }),
        ]);
        const key = { connection: "local", origin: "" };

        const a = ensureAvailableTags(key, { service });
        const b = ensureAvailableTags(key, { service });
        expect(calls).toHaveLength(1);

        resolve!({ tags: makeTags(["fix", 2]) });
        const [ra, rb] = await Promise.all([a, b]);
        expect(ra).toEqual(makeTags(["fix", 2]));
        expect(rb).toEqual(makeTags(["fix", 2]));
    });

    it("不同 connection 分桶互不污染", async () => {
        const { service } = fakeService([
            async () => ({ tags: makeTags(["local-tag", 5]) }),
            async () => ({ tags: makeTags(["remote-tag", 9]) }),
        ]);

        const local = await ensureAvailableTags({ connection: "local", origin: "" }, { service });
        const remote = await ensureAvailableTags({ connection: "ssh:box", origin: "" }, { service });

        expect(local).toEqual(makeTags(["local-tag", 5]));
        expect(remote).toEqual(makeTags(["remote-tag", 9]));
        expect(getAvailableTagsSnapshot({ connection: "local", origin: "" })).toEqual(
            makeTags(["local-tag", 5])
        );
        expect(getAvailableTagsSnapshot({ connection: "ssh:box", origin: "" })).toEqual(
            makeTags(["remote-tag", 9])
        );
    });

    it("RPC 失败返回空清单且不缓存错误态（下次会重试）", async () => {
        const { service, calls } = fakeService([
            async () => {
                throw new Error("rpc down");
            },
            async () => ({ tags: makeTags(["fix", 1]) }),
        ]);
        const key = { connection: "local", origin: "" };

        const failed = await ensureAvailableTags(key, { service });
        expect(failed).toEqual([]);
        expect(calls).toHaveLength(1);

        // 失败没有写 loadedAt → 下一次 ensure 不会被 TTL 挡回，会真的重试。
        const retried = await ensureAvailableTags(key, { service });
        expect(calls).toHaveLength(2);
        expect(retried).toEqual(makeTags(["fix", 1]));
    });

    it("内容变化才换快照引用；内容不变保持同一引用", async () => {
        const { service } = fakeService([
            async () => ({ tags: makeTags(["fix", 1]) }),
            async () => ({ tags: makeTags(["fix", 1]) }),
            async () => ({ tags: makeTags(["fix", 2]) }),
        ]);
        const key = { connection: "local", origin: "" };

        const first = await ensureAvailableTags(key, { service });
        const afterSame = await ensureAvailableTags(key, { service, refresh: true });
        expect(afterSame).toBe(first); // 内容相同 → 同一引用

        const afterChanged = await ensureAvailableTags(key, { service, refresh: true });
        expect(afterChanged).not.toBe(first);
        expect(afterChanged).toEqual(makeTags(["fix", 2]));
    });

    it("订阅者在清单变化时被通知，且 unsubscribe 后不再通知", async () => {
        const { service } = fakeService([
            async () => ({ tags: makeTags(["fix", 1]) }),
            async () => ({ tags: makeTags(["fix", 2]) }),
        ]);
        const key = { connection: "local", origin: "" };
        const seen: number[] = [];
        const unsubscribe = subscribeAvailableTags(key, () => seen.push(1));

        await ensureAvailableTags(key, { service });
        expect(seen).toHaveLength(1);

        unsubscribe();
        await ensureAvailableTags(key, { service, refresh: true });
        expect(seen).toHaveLength(1);
    });
});
