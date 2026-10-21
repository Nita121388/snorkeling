// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { CancelledError, SubagentLoadConcurrency, SubagentLoadQueue, isCancelled } from "./subagent-load-queue";

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

describe("SubagentLoadConcurrency", () => {
    it("is serial so the main timeline always wins", () => {
        expect(SubagentLoadConcurrency).toBe(1);
    });
});

describe("SubagentLoadQueue", () => {
    it("runs one task at a time in FIFO order", async () => {
        const queue = new SubagentLoadQueue();
        const order: string[] = [];
        const first = deferred<string>();
        const second = deferred<string>();

        const firstOutcome = queue.submit({ id: "a", run: () => (order.push("a"), first.promise) });
        const secondOutcome = queue.submit({ id: "b", run: () => (order.push("b"), second.promise) });

        // 第二个任务还没开始
        expect(order).toEqual(["a"]);
        expect(queue.pending()).toBe(1);

        first.resolve("A");
        expect(await firstOutcome).toEqual({ status: "fulfilled", id: "a", value: "A" });
        expect(order).toEqual(["a", "b"]);

        second.resolve("B");
        expect(await secondOutcome).toEqual({ status: "fulfilled", id: "b", value: "B" });
        expect(queue.pending()).toBe(0);
        expect(queue.inFlight()).toBe(false);
    });

    it("propagates rejections without stalling the queue", async () => {
        const queue = new SubagentLoadQueue();
        const failing = queue.submit({
            id: "bad",
            run: () => Promise.reject(new Error("nope")),
        });
        const ok = queue.submit({ id: "good", run: () => Promise.resolve(1) });

        const first = await failing;
        expect(first.status).toBe("rejected");
        const second = await ok;
        expect(second).toEqual({ status: "fulfilled", id: "good", value: 1 });
    });

    it("cancels queued tasks so they never run", async () => {
        const queue = new SubagentLoadQueue();
        const started: string[] = [];
        const gate = deferred<string>();

        const running = queue.submit({ id: "keep", run: () => (started.push("keep"), gate.promise) });
        const queued = queue.submit({ id: "drop", run: () => (started.push("drop"), Promise.resolve("DROP")) });

        queue.cancel((id) => id === "drop");

        const dropped = await queued;
        expect(dropped.status).toBe("rejected");
        expect(isCancelled((dropped as { error: unknown }).error)).toBe(true);
        expect((dropped as { error: unknown }).error).toBeInstanceOf(CancelledError);

        gate.resolve("KEEP");
        await running;
        // 被取消的任务从未真正执行
        expect(started).toEqual(["keep"]);
    });

    it("invalidates the in-flight task when the generation changes", async () => {
        const queue = new SubagentLoadQueue();
        const gate = deferred<string>();
        const generationAtStart = queue.currentGeneration();

        const outcomePromise = queue.submit({ id: "inflight", run: () => gate.promise });
        // 切换会话：世代号变化
        queue.cancelAll();
        expect(queue.currentGeneration()).not.toBe(generationAtStart);

        gate.resolve("LATE");
        const outcome = await outcomePromise;
        expect(outcome.status).toBe("rejected");
        expect(isCancelled((outcome as { error: unknown }).error)).toBe(true);
    });

    it("keeps draining after a cancellation", async () => {
        const queue = new SubagentLoadQueue();
        const gate = deferred<string>();

        const running = queue.submit({ id: "a", run: () => gate.promise });
        queue.cancel((id) => id === "a");
        gate.resolve("A");
        await running;

        const next = await queue.submit({ id: "b", run: () => Promise.resolve("B") });
        expect(next).toEqual({ status: "fulfilled", id: "b", value: "B" });
    });

    it("resolves cancelled tasks instead of leaving promises dangling", async () => {
        const queue = new SubagentLoadQueue();
        const gate = deferred<string>();
        const running = queue.submit({ id: "x", run: () => gate.promise });
        queue.cancelAll();
        gate.resolve("X");
        // 必须 resolve（哪怕结果是 cancelled），否则 React effect 会永远等下去
        await expect(running).resolves.toMatchObject({ status: "rejected" });
    });
});

describe("isCancelled", () => {
    it("recognises the cancellation error only", () => {
        expect(isCancelled(new CancelledError("k"))).toBe(true);
        expect(isCancelled(new Error("boom"))).toBe(false);
        expect(isCancelled(null)).toBe(false);
    });
});
